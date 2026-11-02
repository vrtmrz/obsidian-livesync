import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import type { FilePathWithPrefix, ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { encodeTimeBoundSetupURI } from "@vrtmrz/livesync-commonlib/setup-uri";
import { createNewVaultSettings, P2P_DEFAULT_SETTINGS, PREFERRED_BASE } from "@vrtmrz/livesync-commonlib/settings";
import { upsertRemoteConfigurationInPlace } from "@vrtmrz/livesync-commonlib/remote-configurations";
import { path2id_base } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    acknowledgeDisabledOptionalFeatures,
    captureAndStartInitialisation,
    confirmFastFetch,
    confirmRebuild,
    enterSetupURI,
    finishInitialisation,
    modalByTitle,
    resumeCompatibilityReviewIfShown,
    type SetupArtifact,
    type SetupCaptureNames,
} from "../runner/setupUri.ts";
import {
    assertEqual,
    waitForLocalDatabaseEntry,
    waitForLiveSyncCoreReady,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianPage, obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "90000";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_P2P_NFC_UI_TIMEOUT_MS ?? 60000);
const syncTimeoutMs = Number(process.env.E2E_OBSIDIAN_P2P_NFC_TIMEOUT_MS ?? 120000);
const pathNfd = "E2E/p2p-nfc/Cafe\u0301/re\u0301sume\u0301.md";
const pathNfc = pathNfd.normalize("NFC");
const sourceContent = "# NFC identity\n\nThis NFD-named source note keeps one Metadata identity across P2P.\n";
const editedContent = "# NFC identity\n\nThis update came from the NFC spelling on the receiving peer.\n";
const restartedContent = "# NFC identity\n\nThis edit was sent after the receiving Obsidian process restarted.\n";
const sentinelPath = "E2E/p2p-nfc/local-sentinel.md";
const sentinelContent = "# Local sentinel\n\nKeep this local file when a mode 0 peer is refused.\n";

type CaseDefinition = { name: "plain" | "encrypted"; encrypted: boolean };
type EntryState = LocalDatabaseEntry & { content: string; chunksPresent: boolean };
type VaultFileState = { found: boolean; path: string | null; content: string | null };
type RunnerContext = {
    binary: string;
    cliBinary: string;
    activeSessions: Set<ObsidianLiveSyncSession>;
};
type SharedSettings = {
    encrypted: boolean;
    e2eePassphrase: string;
    idKey: string;
    p2pPassphrase: string;
    relay: string;
    roomId: string;
};

function sessionPorts(): readonly [number, number] {
    const first = obsidianRemoteDebuggingPort(process.env);
    const second = Number(process.env.E2E_OBSIDIAN_SECONDARY_REMOTE_DEBUGGING_PORT ?? first + 1);
    if (!Number.isInteger(second) || second < 1 || second > 65535 || second === first) {
        throw new Error("Invalid secondary Obsidian remote debugging port: " + second);
    }
    return [first, second];
}

function selectedCases(arguments_: readonly string[]): CaseDefinition[] {
    let requested = process.env.E2E_P2P_NFC_CASE?.trim() || "all";
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === "--help" || argument === "-h") {
            console.log("Usage: p2p-nfc-sync.ts [--case all|plain|encrypted] [--migration]");
            process.exit(0);
        }
        if (argument === "--migration") continue;
        if (argument === "--case") {
            const value = arguments_[index + 1];
            if (!value) throw new Error("--case requires all, plain, or encrypted.");
            requested = value;
            index += 1;
            continue;
        }
        if (argument.startsWith("--case=")) {
            requested = argument.slice("--case=".length);
            continue;
        }
        throw new Error("Unknown P2P NFC scenario argument: " + argument);
    }
    const cases: CaseDefinition[] = [
        { name: "plain", encrypted: false },
        { name: "encrypted", encrypted: true },
    ];
    if (requested === "all") return cases;
    const selected = cases.filter((candidate) => candidate.name === requested);
    if (selected.length === 0) throw new Error("Unsupported P2P NFC case: " + requested);
    return selected;
}

function createSettings(shared: SharedSettings, pathNormalizationVersion: 0 | 1): ObsidianLiveSyncSettings {
    const settings = createNewVaultSettings();
    Object.assign(settings, PREFERRED_BASE, P2P_DEFAULT_SETTINGS, {
        isConfigured: true,
        liveSync: false,
        syncOnStart: false,
        syncOnSave: false,
        useEden: false,
        customChunkSize: 60,
        readChunksOnline: true,
        E2EEAlgorithm: "v2",
        encrypt: shared.encrypted,
        passphrase: shared.encrypted ? shared.e2eePassphrase : "",
        usePathObfuscation: shared.encrypted,
        idDerivationVersion: shared.encrypted ? 1 : 0,
        idDerivationKey: shared.encrypted ? shared.idKey : "",
        pathNormalizationVersion,
        P2P_Enabled: true,
        P2P_AutoStart: false,
        P2P_AutoBroadcast: false,
        P2P_roomID: shared.roomId,
        P2P_passphrase: shared.p2pPassphrase,
        P2P_relays: shared.relay,
        P2P_AppID: "self-hosted-livesync-real-obsidian-p2p-nfc-e2e",
    });
    upsertRemoteConfigurationInPlace(settings, "p2p", {
        id: "e2e-p2p-nfc",
        name: "P2P NFC E2E",
        activate: true,
        activateForP2P: true,
    });
    return settings;
}

async function createSetupArtifact(shared: SharedSettings, pathNormalizationVersion: 0 | 1): Promise<SetupArtifact> {
    const setupPassphrase = randomBytes(24).toString("base64url");
    const result = await encodeTimeBoundSetupURI(createSettings(shared, pathNormalizationVersion), setupPassphrase, {
        mode: "persistent",
        removeProperties: ["pluginSyncExtendedSetting", "doNotUseFixedRevisionForChunks"],
        skipDefaultValue: true,
    });
    const setupURI = result.uri.trim();
    if (!setupURI.startsWith("obsidian://setuplivesync?settings=")) {
        throw new Error("Commonlib did not create a valid P2P Setup URI.");
    }
    return { setupURI, setupPassphrase };
}

async function waitForRelay(relay: string): Promise<void> {
    const endpoint = new URL(relay);
    if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
        throw new Error("P2P relay must use ws: or wss:, received " + endpoint.protocol);
    }
    const port = Number(endpoint.port || (endpoint.protocol === "wss:" ? 443 : 80));
    const host = endpoint.hostname;
    const deadline = Date.now() + Number(process.env.E2E_P2P_RELAY_READY_TIMEOUT_MS ?? 30000);
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            await new Promise<void>((resolve, reject) => {
                const socket = connect({ host, port });
                socket.setTimeout(1000);
                socket.once("connect", () => {
                    socket.destroy();
                    resolve();
                });
                socket.once("timeout", () => {
                    socket.destroy();
                    reject(new Error("connection timed out"));
                });
                socket.once("error", reject);
            });
            await new Promise((resolve) => setTimeout(resolve, 1500));
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
    throw new Error(
        "P2P relay is not ready at " +
            relay +
            ": " +
            (lastError instanceof Error ? lastError.message : String(lastError))
    );
}

function sessionEnvironment(port: number): NodeJS.ProcessEnv {
    return { ...process.env, E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT: String(port) };
}

async function startSession(
    context: RunnerContext,
    vault: TemporaryVault,
    port: number
): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        env: sessionEnvironment(port),
    });
    context.activeSessions.add(session);
    return session;
}

async function stopSession(context: RunnerContext, session: ObsidianLiveSyncSession | undefined): Promise<void> {
    if (!session) return;
    await session.app.stop();
    context.activeSessions.delete(session);
}

async function stopSessions(context: RunnerContext): Promise<void> {
    for (const session of [...context.activeSessions]) await stopSession(context, session);
}

async function writeVaultFile(vaultPath: string, path: string, content: string): Promise<void> {
    const target = join(vaultPath, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

async function assertSourceNameIsNfd(vaultPath: string, expectedContent: string): Promise<void> {
    const nfdFile = join(vaultPath, pathNfd);
    const nfcFile = join(vaultPath, pathNfc);
    assertEqual(await readFile(nfdFile, "utf8"), expectedContent, "The source NFD file has unexpected content.");
    if (pathNfd !== pathNfc && (await pathExists(nfcFile))) {
        throw new Error("NFC reflection created a second physical source file beside the NFD file.");
    }
}

async function readVaultFileState(vaultPath: string, requestedPath: string): Promise<VaultFileState> {
    try {
        let physicalPath = "";
        for (const component of requestedPath.split("/")) {
            const names = await readdir(join(vaultPath, physicalPath));
            const matches = names.filter((name) => name.normalize("NFC") === component.normalize("NFC"));
            if (matches.length > 1) throw new Error("Ambiguous physical names at " + join(physicalPath, component));
            if (matches.length === 0) return { found: false, path: null, content: null };
            physicalPath = join(physicalPath, matches[0]);
        }
        return { found: true, path: physicalPath, content: await readFile(join(vaultPath, physicalPath), "utf8") };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return { found: false, path: null, content: null };
    }
}

async function waitForVaultContent(
    vaultPath: string,
    requestedPath: string,
    expectedContent: string
): Promise<VaultFileState> {
    const deadline = Date.now() + syncTimeoutMs;
    let lastState: VaultFileState = { found: false, path: null, content: null };
    while (Date.now() < deadline) {
        lastState = await readVaultFileState(vaultPath, requestedPath);
        if (lastState.found && lastState.content === expectedContent) return lastState;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
        "Timed out waiting for NFC path content: " + JSON.stringify({ requestedPath, expectedContent, lastState })
    );
}

async function modifyVaultNote(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    requestedPath: string,
    content: string
): Promise<string> {
    return await evalObsidianJson<string>(
        cliBinary,
        [
            "(async()=>{",
            "const requestedPath=" + JSON.stringify(requestedPath) + ";",
            "const content=" + JSON.stringify(content) + ";",
            "const file=app.vault.getFiles().find(candidate=>candidate.path.normalize('NFC')===requestedPath);",
            "if(!file) throw new Error('Could not find the NFC-equivalent file: '+requestedPath);",
            "await app.vault.modify(file,content);",
            "return JSON.stringify(file.path);",
            "})()",
        ].join(""),
        environment
    );
}

async function readEntryState(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    path: string,
    revision?: string,
    documentId?: string
): Promise<EntryState> {
    return await evalObsidianJson<EntryState>(
        cliBinary,
        [
            "(async()=>{",
            "const path=" + JSON.stringify(path) + ";",
            "const revision=" + JSON.stringify(revision ?? null) + ";",
            "const documentId=" + JSON.stringify(documentId ?? null) + ";",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const entry=documentId?await core.localDatabase.getDBEntryFromMeta(await core.localDatabase.getRaw(documentId,revision?{rev:revision}:undefined),false,true):await core.localDatabase.getDBEntry(path,revision?{rev:revision}:undefined,false,true,true);",
            "if(!entry||!entry._id||!entry._rev) throw new Error('Metadata was not available at '+path);",
            "const children=Array.isArray(entry.children)?entry.children:[];",
            "const chunkRows=children.length?await core.localDatabase.allDocsRaw({keys:children,include_docs:true}):{rows:[]};",
            "const chunksPresent=children.length>0&&chunkRows.rows.filter(row=>Boolean(row.doc)&&!Boolean(row.value?.deleted)&&!Boolean(row.doc?.deleted)&&!Boolean(row.doc?._deleted)).length===children.length;",
            "const content=Array.isArray(entry.data)?entry.data.join(''):typeof entry.data==='string'?entry.data:'';",
            "return JSON.stringify({id:entry._id,rev:entry._rev,path:entry.path,children,content,chunksPresent});",
            "})()",
        ].join(""),
        environment
    );
}

async function writeEntryStateWhenReady(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    path: string,
    expectedContent: string
): Promise<EntryState> {
    await waitForLocalDatabaseEntry(cliBinary, environment, path, { timeoutMs: syncTimeoutMs });
    const deadline = Date.now() + syncTimeoutMs;
    let state: EntryState;
    do {
        state = await readEntryState(cliBinary, environment, path);
        if (state.content === expectedContent && state.chunksPresent) return state;
        await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assertEqual(state.content, expectedContent, "The local Metadata body differs from the expected note bytes.");
    throw new Error("The Metadata entry is missing one or more referenced Chunk documents.");
}

async function readCurrentSettings(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    expectedIdKey: string
): Promise<{
    pathNormalizationVersion: number;
    encrypt: boolean;
    usePathObfuscation: boolean;
    idDerivationVersion: number;
    idKeyMatches: boolean;
    p2pEnabled: boolean;
}> {
    return await evalObsidianJson<{
        pathNormalizationVersion: number;
        encrypt: boolean;
        usePathObfuscation: boolean;
        idDerivationVersion: number;
        idKeyMatches: boolean;
        p2pEnabled: boolean;
    }>(
        cliBinary,
        [
            "(async()=>{",
            "const settings=app.plugins.plugins['obsidian-livesync'].core.services.setting.currentSettings();",
            "const expectedIdKey=" + JSON.stringify(expectedIdKey) + ";",
            "return JSON.stringify({pathNormalizationVersion:settings.pathNormalizationVersion??0,encrypt:settings.encrypt,usePathObfuscation:settings.usePathObfuscation,idDerivationVersion:settings.idDerivationVersion??0,idKeyMatches:settings.idDerivationKey===expectedIdKey,p2pEnabled:settings.P2P_Enabled});",
            "})()",
        ].join(""),
        environment
    );
}

async function assertCaseSettings(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    definition: CaseDefinition,
    expectedIdKey: string,
    pathNormalizationVersion: 0 | 1
): Promise<void> {
    const settings = await readCurrentSettings(cliBinary, environment, expectedIdKey);
    assertEqual(
        settings.pathNormalizationVersion,
        pathNormalizationVersion,
        "The P2P Setup URI lost path identity mode."
    );
    assertEqual(settings.encrypt, definition.encrypted, "The P2P Setup URI changed the E2EE setting.");
    assertEqual(settings.usePathObfuscation, definition.encrypted, "The P2P Setup URI changed Path Obfuscation.");
    assertEqual(settings.idDerivationVersion, definition.encrypted ? 1 : 0, "The ID derivation version differs.");
    assertEqual(settings.idKeyMatches, true, "The independent ID key did not reach this device.");
    assertEqual(settings.p2pEnabled, true, "The P2P Setup URI did not enable P2P.");
}

async function executeCommand(port: number, commandId: string): Promise<void> {
    const executed = await withObsidianPage(
        port,
        async (page) =>
            await page.evaluate(
                (id) =>
                    (
                        globalThis as typeof globalThis & {
                            app?: { commands?: { executeCommandById(commandId: string): boolean } };
                        }
                    ).app?.commands?.executeCommandById(id) === true,
                commandId
            )
    );
    if (!executed) throw new Error("Obsidian command was not available: " + commandId);
}

async function openP2PStatus(port: number): Promise<void> {
    await executeCommand(port, "obsidian-livesync:open-p2p-server-status");
    await withObsidianPage(port, async (page) => {
        const heading = page.getByRole("heading", { name: "Signalling Status" }).last();
        await heading.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const pane = heading.locator(
            "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' workspace-leaf-content ')][1]"
        );
        const open = pane.getByRole("button", { name: "Open connection", exact: true });
        if (await open.isVisible()) await open.click({ timeout: uiTimeoutMs });
        await pane.locator(".status-value.connected").waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
}

async function reconnectP2PStatus(port: number): Promise<void> {
    await executeCommand(port, "obsidian-livesync:open-p2p-server-status");
    await withObsidianPage(port, async (page) => {
        const heading = page.getByRole("heading", { name: "Signalling Status" }).last();
        await heading.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const pane = heading.locator(
            "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' workspace-leaf-content ')][1]"
        );
        const disconnect = pane.getByRole("button", { name: "Disconnect", exact: true });
        if (await disconnect.isVisible()) await disconnect.click({ timeout: uiTimeoutMs });
        const open = pane.getByRole("button", { name: "Open connection", exact: true });
        await open.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await open.click({ timeout: uiTimeoutMs });
        await pane.locator(".status-value.connected").waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
}

async function waitForDetectedPeer(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const heading = page.getByRole("heading", { name: "Detected Peers" }).last();
        await heading.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const pane = heading.locator(
            "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' workspace-leaf-content ')][1]"
        );
        await pane.getByRole("button", { name: "Refresh", exact: true }).click({ timeout: uiTimeoutMs });
        const peer = pane.locator(".peer-item").first();
        await peer.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const allow = peer.getByRole("button", { name: "Allow in session", exact: true });
        if (await allow.isVisible()) await allow.click({ timeout: uiTimeoutMs });
        await pane.getByRole("button", { name: "Replicate now" }).first().waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
    });
}

async function replicateFromStatusPane(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const heading = page.getByRole("heading", { name: "Detected Peers" }).last();
        await heading.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const pane = heading.locator(
            "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' workspace-leaf-content ')][1]"
        );
        await pane.getByRole("button", { name: "Refresh", exact: true }).click({ timeout: uiTimeoutMs });
        await pane.getByRole("button", { name: "Replicate now" }).first().click({ timeout: uiTimeoutMs });
    });
}

async function acceptConnectionRequests(ports: readonly number[], shouldStop: () => boolean): Promise<void> {
    while (!shouldStop()) {
        for (const port of ports) {
            const visible = await withObsidianPage(
                port,
                async (page) => await modalByTitle(page, "P2P Connection Request").isVisible()
            ).catch(() => false);
            if (!visible) continue;
            await withObsidianPage(port, async (page) => {
                await modalByTitle(page, "P2P Connection Request")
                    .getByRole("button", { name: "Accept", exact: true })
                    .click({ timeout: uiTimeoutMs });
            });
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

async function fetchFromFirstPeer(portA: number, portB: number): Promise<void> {
    await withObsidianPage(portB, async (page) => {
        const modal = modalByTitle(page, "P2P Rebuild");
        await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await modal.locator(".peer-item").first().waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
    let finished = false;
    const acceptor = acceptConnectionRequests([portA, portB], () => finished);
    try {
        await withObsidianPage(portB, async (page) => {
            const modal = modalByTitle(page, "P2P Rebuild");
            await modal
                .locator(".peer-item")
                .first()
                .getByRole("button", { name: "Sync", exact: true })
                .click({ timeout: uiTimeoutMs });
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });
    } finally {
        finished = true;
        await acceptor;
    }
    await withObsidianPage(portB, async (page) => {
        const modal = modalByTitle(page, "P2P Rebuild");
        if (await modal.isVisible()) {
            await modal.getByRole("button", { name: "Skip and close" }).click({ timeout: uiTimeoutMs });
        }
    });
}

async function replicateAndWait(
    sourcePort: number,
    receiverPort: number,
    receiverVaultPath: string,
    expectedPath: string,
    expectedContent: string
): Promise<void> {
    let finished = false;
    const acceptor = acceptConnectionRequests([sourcePort, receiverPort], () => finished);
    try {
        await replicateFromStatusPane(receiverPort);
        await waitForVaultContent(receiverVaultPath, expectedPath, expectedContent);
    } finally {
        finished = true;
        await acceptor;
    }
}

async function waitForTweakMismatchNotice(port: number, session: ObsidianLiveSyncSession): Promise<string> {
    const deadline = Date.now() + syncTimeoutMs;
    let lastNotices: string[] = [];
    while (Date.now() < deadline) {
        lastNotices = await withObsidianPage(
            port,
            async (page) => await page.locator(".notice").allTextContents()
        ).catch(() => lastNotices);
        const mismatch = lastNotices.find((notice) =>
            notice.includes("The path identity mode does not match this peer")
        );
        if (mismatch) return mismatch;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const output = session.app.output();
    throw new Error(
        "The incompatible P2P attempt did not show its tweak refusal. Notices: " +
            JSON.stringify(lastNotices) +
            "\nObsidian stdout: " +
            output.stdout.slice(-2000) +
            "\nObsidian stderr: " +
            output.stderr.slice(-2000)
    );
}

async function readMetadataIds(
    cliBinary: string,
    environment: NodeJS.ProcessEnv
): Promise<{ ids: string[]; paths: string[] }> {
    return await evalObsidianJson<{ ids: string[]; paths: string[] }>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "const entries=rows.map(row=>row.doc).filter(doc=>doc&&Array.isArray(doc.children)&&typeof doc._id==='string'&&!doc._deleted);",
            "return JSON.stringify({ids:entries.map(entry=>entry._id),paths:entries.map(entry=>typeof entry.path==='string'?entry.path.normalize('NFC'):'')});",
            "})()",
        ].join(""),
        environment
    );
}

async function seedLegacyNfdMetadata(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    shared: SharedSettings,
    currentId: string
): Promise<EntryState> {
    // Obsidian's file cache normalises names even in legacy mode. Seed the
    // legacy ID of an NFD-writing host while retaining real Chunk documents.
    const legacyId = await path2id_base(
        pathNfd as FilePathWithPrefix,
        shared.encrypted ? shared.e2eePassphrase : false,
        true,
        shared.encrypted ? shared.idKey : undefined
    );
    if (legacyId === currentId) throw new Error("The legacy NFD fixture did not change the Metadata ID.");
    await evalObsidianJson<boolean>(
        context.cliBinary,
        [
            "(async()=>{",
            "const db=app.plugins.plugins['obsidian-livesync'].core.localDatabase.localDatabase;",
            "const original=await db.get(" + JSON.stringify(currentId) + ");",
            "const legacy={...original,_id:" + JSON.stringify(legacyId) + ",path:" + JSON.stringify(pathNfd) + "};",
            "delete legacy._rev;delete legacy._revisions;delete legacy._conflicts;",
            "await db.put(legacy);await db.remove(original);",
            "return JSON.stringify(true);",
            "})()",
        ].join(""),
        session.cliEnv
    );
    const legacy = await readEntryState(context.cliBinary, session.cliEnv, pathNfd, undefined, legacyId);
    assertEqual(legacy.content, sourceContent, "The legacy NFD fixture lost its Chunk-backed body.");
    assertEqual(legacy.chunksPresent, true, "The legacy NFD fixture lost its Chunk documents.");
    return legacy;
}

async function startReconstruction(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    operation: "rebuild" | "fetch",
    pathNormalizationVersion: 0 | 1 = 1
): Promise<void> {
    await evalObsidianJson<boolean>(
        cliBinary,
        [
            "(()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "globalThis.__p2pNfcReconstruction={done:false,error:null};",
            "void(async()=>{",
            "await core.services.setting.applyPartial({pathNormalizationVersion:" + pathNormalizationVersion + "});",
            "await core.services.setting.saveSettingData();",
            "if(core.settings.pathNormalizationVersion!==" +
                pathNormalizationVersion +
                ")throw new Error('The test did not apply the selected identity: '+core.settings.pathNormalizationVersion);",
            operation === "rebuild"
                ? "await core.rebuilder.$rebuildEverything();"
                : "await core.rebuilder.$fetchLocal(false,true);",
            "})().then(()=>{globalThis.__p2pNfcReconstruction.done=true;},error=>{globalThis.__p2pNfcReconstruction.error=String(error?.stack??error);});",
            "return JSON.stringify(true);",
            "})()",
        ].join(""),
        environment
    );
}

async function waitForReconstruction(cliBinary: string, environment: NodeJS.ProcessEnv): Promise<void> {
    const deadline = Date.now() + syncTimeoutMs;
    while (Date.now() < deadline) {
        const state = await evalObsidianJson<{ done: boolean; error: string | null }>(
            cliBinary,
            "JSON.stringify(globalThis.__p2pNfcReconstruction)",
            environment
        );
        if (state.error) throw new Error(state.error);
        if (state.done) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("The P2P reconstruction did not finish.");
}

async function waitForVaultAbsence(vaultPath: string, path: string): Promise<void> {
    const deadline = Date.now() + syncTimeoutMs;
    while (Date.now() < deadline) {
        if (!(await readVaultFileState(vaultPath, path)).found) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("The retired path is still present: " + path);
}

async function verifyRenameAndDeletion(
    context: RunnerContext,
    sessionA: ObsidianLiveSyncSession,
    sessionB: ObsidianLiveSyncSession,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault,
    portA: number,
    portB: number
): Promise<void> {
    const oldPath = pathNfc.replace(/[^/]+$/, "a\u0301rbol.md").normalize("NFC");
    const newPath = pathNfc.replace(/[^/]+$/, "renamed-e\u0301.md").normalize("NFC");
    const content = "# Rename and deletion\n\nPreserve these exact bytes through the P2P rename.\n";
    await evalObsidianJson<boolean>(
        context.cliBinary,
        `(async()=>{const source=app.vault.getFiles().find(file=>file.path.normalize('NFC')===${JSON.stringify(pathNfc)});if(!source)throw new Error('Missing source note');await app.vault.create(source.path.replace(/[^/]+$/,'a\\u0301rbol.md'),${JSON.stringify(content)});return JSON.stringify(true);})()`,
        sessionA.cliEnv
    );
    const before = await writeEntryStateWhenReady(context.cliBinary, sessionA.cliEnv, oldPath, content);
    await replicateAndWait(portA, portB, vaultB.path, oldPath, content);
    const received = await writeEntryStateWhenReady(context.cliBinary, sessionB.cliEnv, oldPath, content);
    assertEqual(received.id, before.id, "The new Unicode note has different peer IDs.");
    await evalObsidianJson<boolean>(
        context.cliBinary,
        `(async()=>{const file=app.vault.getFiles().find(file=>file.path.normalize('NFC')===${JSON.stringify(oldPath)});if(!file)throw new Error('Missing rename source');await app.fileManager.renameFile(file,file.path.replace(/[^/]+$/,'renamed-e\\u0301.md'));return JSON.stringify(true);})()`,
        sessionB.cliEnv
    );
    const renamed = await writeEntryStateWhenReady(context.cliBinary, sessionB.cliEnv, newPath, content);
    if (renamed.id === before.id) throw new Error("The cross-path rename retained the old Metadata ID.");
    await replicateAndWait(portB, portA, vaultA.path, newPath, content);
    const renamedAtSource = await writeEntryStateWhenReady(context.cliBinary, sessionA.cliEnv, newPath, content);
    assertEqual(renamedAtSource.id, renamed.id, "The renamed note has different peer IDs.");
    await waitForVaultAbsence(vaultA.path, oldPath);
    await waitForVaultAbsence(vaultB.path, oldPath);
    await evalObsidianJson<boolean>(
        context.cliBinary,
        `(async()=>{const file=app.vault.getFiles().find(file=>file.path.normalize('NFC')===${JSON.stringify(newPath)});if(!file)throw new Error('Missing deletion source');await app.vault.delete(file);return JSON.stringify(true);})()`,
        sessionA.cliEnv
    );
    let finished = false;
    const acceptor = acceptConnectionRequests([portA, portB], () => finished);
    try {
        const deadline = Date.now() + syncTimeoutMs;
        while ((await readVaultFileState(vaultB.path, newPath)).found && Date.now() < deadline) {
            await replicateFromStatusPane(portB);
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        await waitForVaultAbsence(vaultA.path, newPath);
        await waitForVaultAbsence(vaultB.path, newPath);
    } finally {
        finished = true;
        await acceptor;
    }
    console.log("P2P NFC rename and deletion: canonical IDs, exact content, and both physical removals verified.");
}

async function runCase(definition: CaseDefinition, migration: boolean): Promise<void> {
    if (pathNfd === pathNfc) throw new Error("The test fixture path did not produce distinct NFC and NFD spellings.");
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error("Could not find obsidian-cli. Checked paths: " + cli.checked.join(", "));
    const context: RunnerContext = { binary, cliBinary: cli.binary, activeSessions: new Set() };
    const [portA, portB] = sessionPorts();
    const relay = process.env.E2E_P2P_RELAY_URL ?? "ws://p2p-relay:7777/";
    const shared: SharedSettings = {
        encrypted: definition.encrypted,
        e2eePassphrase: randomBytes(24).toString("base64url"),
        idKey: definition.encrypted ? randomBytes(32).toString("hex") : "",
        p2pPassphrase: randomBytes(24).toString("base64url"),
        relay,
        roomId: "real-obsidian-p2p-nfc-" + randomBytes(12).toString("hex"),
    };
    const initialVersion = migration ? 0 : 1;
    const initialPath = migration ? pathNfd : pathNfc;
    const artifact = await createSetupArtifact(shared, initialVersion);
    const incompatibleArtifact = await createSetupArtifact(shared, 0);
    const captures: SetupCaptureNames = {
        scenario: "p2p-nfc-" + definition.name,
        guide: "p2p-setup",
    };
    const vaults: TemporaryVault[] = [];
    let sessionA: ObsidianLiveSyncSession | undefined;
    let sessionB: ObsidianLiveSyncSession | undefined;
    let sessionMode0: ObsidianLiveSyncSession | undefined;

    try {
        const vaultA = await createTemporaryVault("obsidian-livesync-p2p-nfc-source-");
        vaults.push(vaultA);
        const vaultB = await createTemporaryVault("obsidian-livesync-p2p-nfc-receiver-");
        vaults.push(vaultB);
        await writeVaultFile(vaultA.path, pathNfd, sourceContent);
        if (migration) await writeVaultFile(vaultB.path, pathNfd, sourceContent);

        console.log("P2P NFC case: " + definition.name);
        console.log("Temporary source and receiving Vaults: " + vaultA.name + ", " + vaultB.name);
        await waitForRelay(relay);

        sessionA = await startSession(context, vaultA, portA);
        await enterSetupURI(portA, "new", artifact, captures);
        await captureAndStartInitialisation(portA, "new", captures);
        await confirmRebuild(portA, captures);
        await acknowledgeDisabledOptionalFeatures(portA, captures);
        const firstState = await finishInitialisation(portA, context.cliBinary, sessionA.cliEnv);
        await resumeCompatibilityReviewIfShown(portA);
        assertEqual(firstState.p2pEnabled, true, "The first device did not enable P2P.");
        await assertCaseSettings(context.cliBinary, sessionA.cliEnv, definition, shared.idKey, initialVersion);
        await waitForVaultContent(vaultA.path, pathNfc, sourceContent);
        let sourceEntry = await writeEntryStateWhenReady(
            context.cliBinary,
            sessionA.cliEnv,
            initialPath,
            sourceContent
        );
        assertEqual(sourceEntry.path.normalize("NFC"), pathNfc, "The source Metadata path is not NFC-equivalent.");
        await assertSourceNameIsNfd(vaultA.path, sourceContent);

        await openP2PStatus(portA);
        sessionB = await startSession(context, vaultB, portB);
        await enterSetupURI(portB, "existing", artifact, captures);
        await captureAndStartInitialisation(portB, "existing", captures);
        await confirmFastFetch(portB, captures);
        await fetchFromFirstPeer(portA, portB);
        await waitForLocalDatabaseEntry(context.cliBinary, sessionB.cliEnv, initialPath, { timeoutMs: syncTimeoutMs });
        const secondState = await finishInitialisation(portB, context.cliBinary, sessionB.cliEnv);
        await resumeCompatibilityReviewIfShown(portB);
        assertEqual(secondState.p2pEnabled, true, "The second device did not enable P2P.");
        await assertCaseSettings(context.cliBinary, sessionB.cliEnv, definition, shared.idKey, initialVersion);
        await waitForVaultContent(vaultB.path, pathNfc, sourceContent);
        let receiverEntry = await writeEntryStateWhenReady(
            context.cliBinary,
            sessionB.cliEnv,
            initialPath,
            sourceContent
        );
        assertEqual(
            receiverEntry.id,
            sourceEntry.id,
            "The NFD source and NFC peer paths produced different Metadata IDs."
        );
        assertEqual(receiverEntry.content, sourceContent, "The NFC peer did not receive the exact source body.");

        if (migration) {
            sourceEntry = await seedLegacyNfdMetadata(context, sessionA, shared, sourceEntry.id);
            receiverEntry = await seedLegacyNfdMetadata(context, sessionB, shared, receiverEntry.id);
            assertEqual(receiverEntry.id, sourceEntry.id, "The legacy NFD peers have different IDs.");
            const legacyId = sourceEntry.id;
            await assertSourceNameIsNfd(vaultB.path, sourceContent);
            await stopSession(context, sessionB);
            await startReconstruction(context.cliBinary, sessionA.cliEnv, "rebuild");
            await acknowledgeDisabledOptionalFeatures(portA, captures);
            await waitForReconstruction(context.cliBinary, sessionA.cliEnv);
            sourceEntry = await writeEntryStateWhenReady(context.cliBinary, sessionA.cliEnv, pathNfc, sourceContent);
            if (sourceEntry.id === legacyId)
                throw new Error(
                    "P2P Rebuild did not replace the legacy Metadata ID: " +
                        JSON.stringify({
                            legacyId,
                            sourceEntry,
                            settings: await readCurrentSettings(context.cliBinary, sessionA.cliEnv, shared.idKey),
                        })
                );
            assertEqual(
                (await readMetadataIds(context.cliBinary, sessionA.cliEnv)).ids.includes(legacyId),
                false,
                "The rebuilt source retained active legacy Metadata."
            );
            await assertSourceNameIsNfd(vaultA.path, sourceContent);
            await stopSession(context, sessionA);
            sessionA = await startSession(context, vaultA, portA);
            await waitForLiveSyncCoreReady(context.cliBinary, sessionA.cliEnv);
            await assertCaseSettings(context.cliBinary, sessionA.cliEnv, definition, shared.idKey, 1);
            sessionB = await startSession(context, vaultB, portB);
            await waitForLiveSyncCoreReady(context.cliBinary, sessionB.cliEnv);
            await assertCaseSettings(context.cliBinary, sessionB.cliEnv, definition, shared.idKey, 0);
            await openP2PStatus(portA);
            await openP2PStatus(portB);
            await waitForDetectedPeer(portB);
            let finished = false;
            const acceptor = acceptConnectionRequests([portA, portB], () => finished);
            try {
                await replicateFromStatusPane(portB);
                await waitForTweakMismatchNotice(portB, sessionB);
            } finally {
                finished = true;
                await acceptor;
            }
            const refused = await readEntryState(context.cliBinary, sessionB.cliEnv, pathNfd, undefined, legacyId);
            assertEqual(refused.id, receiverEntry.id, "The refused legacy receiver changed its Metadata ID.");
            assertEqual(refused.rev, receiverEntry.rev, "The refused legacy receiver changed its revision.");
            assertEqual(refused.content, sourceContent, "The refused legacy receiver changed its content.");

            await withObsidianPage(portB, async (page) => {
                await page.locator(".notice").evaluateAll((notices) => notices.forEach((notice) => notice.remove()));
            });
            await startReconstruction(context.cliBinary, sessionB.cliEnv, "fetch", 0);
            await withObsidianPage(portB, async (page) => {
                await modalByTitle(page, "P2P Rebuild").locator(".peer-item").first().waitFor({
                    state: "visible",
                    timeout: uiTimeoutMs,
                });
            });
            finished = false;
            const fetchAcceptor = acceptConnectionRequests([portA, portB], () => finished);
            try {
                await withObsidianPage(portB, async (page) => {
                    await modalByTitle(page, "P2P Rebuild")
                        .locator(".peer-item")
                        .first()
                        .getByRole("button", { name: "Sync", exact: true })
                        .click({ timeout: uiTimeoutMs });
                });
                await waitForTweakMismatchNotice(portB, sessionB);
                await withObsidianPage(portB, async (page) => {
                    const modal = modalByTitle(page, "P2P Rebuild");
                    if (await modal.isVisible()) {
                        await modal.getByRole("button", { name: "Skip and close" }).click({ timeout: uiTimeoutMs });
                    }
                });
            } finally {
                finished = true;
                await fetchAcceptor;
            }
            let fetchFailure = "";
            try {
                await waitForReconstruction(context.cliBinary, sessionB.cliEnv);
            } catch (error) {
                fetchFailure = error instanceof Error ? error.message : String(error);
            }
            if (!fetchFailure.includes("The first Standard Fetch pass did not complete.")) {
                throw new Error("The incompatible P2P Fetch did not report its expected failure: " + fetchFailure);
            }
            const refusedFetchMetadata = await readMetadataIds(context.cliBinary, sessionB.cliEnv);
            assertEqual(
                refusedFetchMetadata.ids.includes(legacyId),
                false,
                "P2P Fetch did not replace the old local database before peer selection."
            );
            assertEqual(
                refusedFetchMetadata.ids.includes(sourceEntry.id),
                false,
                "The incompatible Fetch imported source Metadata."
            );
            await assertSourceNameIsNfd(vaultB.path, sourceContent);
            console.log(
                "P2P incompatible Fetch: local database reset preceded refusal; physical NFD note and exact bytes retained for retry."
            );

            await startReconstruction(context.cliBinary, sessionB.cliEnv, "fetch");
            await fetchFromFirstPeer(portA, portB);
            await waitForReconstruction(context.cliBinary, sessionB.cliEnv);
            await waitForLiveSyncCoreReady(context.cliBinary, sessionB.cliEnv);
            const migrated = await writeEntryStateWhenReady(context.cliBinary, sessionB.cliEnv, pathNfc, sourceContent);
            assertEqual(migrated.id, sourceEntry.id, "P2P Fetch did not converge to the rebuilt source ID.");
            assertEqual(
                (await readMetadataIds(context.cliBinary, sessionB.cliEnv)).ids.includes(legacyId),
                false,
                "The migrated receiver retained active legacy Metadata."
            );
            await assertSourceNameIsNfd(vaultB.path, sourceContent);
            console.log(
                "P2P legacy-to-NFC migration: source Rebuild and restart, legacy refusal, receiver Fetch, matching IDs, exact content, and NFD physical names verified."
            );
        }

        console.log("P2P NFC initial Fetch: matching IDs and exact content verified.");
        await reconnectP2PStatus(portA);
        await reconnectP2PStatus(portB);
        await waitForDetectedPeer(portA);
        await modifyVaultNote(context.cliBinary, sessionB.cliEnv, pathNfc, editedContent);
        const locallyEditedEntry = await writeEntryStateWhenReady(
            context.cliBinary,
            sessionB.cliEnv,
            pathNfc,
            editedContent
        );
        assertEqual(locallyEditedEntry.id, sourceEntry.id, "The NFC peer edit changed the Metadata ID.");
        await replicateAndWait(portB, portA, vaultA.path, pathNfc, editedContent);

        const sourceAfterEdit = await writeEntryStateWhenReady(
            context.cliBinary,
            sessionA.cliEnv,
            pathNfc,
            editedContent
        );
        assertEqual(sourceAfterEdit.id, sourceEntry.id, "The reverse edit changed the source Metadata ID.");
        assertEqual(sourceAfterEdit.content, editedContent, "The source did not receive the exact reverse edit.");
        const originalRevision = await readEntryState(context.cliBinary, sessionA.cliEnv, pathNfc, sourceEntry.rev);
        assertEqual(originalRevision.rev, sourceEntry.rev, "The original source revision was not retained.");
        assertEqual(originalRevision.content, sourceContent, "P2P discarded the original revision body.");
        await assertSourceNameIsNfd(vaultA.path, editedContent);

        console.log("P2P NFC reverse transfer: stable ID and original revision verified.");
        await stopSession(context, sessionB);
        sessionB = await startSession(context, vaultB, portB);
        await waitForLiveSyncCoreReady(context.cliBinary, sessionB.cliEnv);
        await waitForVaultContent(vaultB.path, pathNfc, editedContent);
        const afterRestart = await writeEntryStateWhenReady(context.cliBinary, sessionB.cliEnv, pathNfc, editedContent);
        assertEqual(afterRestart.id, sourceEntry.id, "A full Obsidian restart changed the Metadata ID.");
        assertEqual(afterRestart.content, editedContent, "A full Obsidian restart changed the local Metadata body.");
        const originalAfterRestart = await readEntryState(context.cliBinary, sessionB.cliEnv, pathNfc, sourceEntry.rev);
        assertEqual(
            originalAfterRestart.content,
            sourceContent,
            "A full restart discarded the original revision body."
        );

        await reconnectP2PStatus(portA);
        await openP2PStatus(portB);
        await waitForDetectedPeer(portA);
        await modifyVaultNote(context.cliBinary, sessionB.cliEnv, pathNfc, restartedContent);
        await writeEntryStateWhenReady(context.cliBinary, sessionB.cliEnv, pathNfc, restartedContent);
        await replicateAndWait(portB, portA, vaultA.path, pathNfc, restartedContent);
        const afterRestartTransfer = await writeEntryStateWhenReady(
            context.cliBinary,
            sessionA.cliEnv,
            pathNfc,
            restartedContent
        );
        assertEqual(afterRestartTransfer.id, sourceEntry.id, "A post-restart transfer changed the Metadata ID.");
        await assertSourceNameIsNfd(vaultA.path, restartedContent);

        console.log("P2P NFC full restart: persisted data and another transfer verified.");
        await verifyRenameAndDeletion(context, sessionA, sessionB, vaultA, vaultB, portA, portB);
        await stopSession(context, sessionB);
        sessionB = undefined;
        const vaultMode0 = await createTemporaryVault("obsidian-livesync-p2p-nfc-mode0-");
        vaults.push(vaultMode0);
        await writeVaultFile(vaultMode0.path, sentinelPath, sentinelContent);
        sessionMode0 = await startSession(context, vaultMode0, portB);
        await enterSetupURI(portB, "new", incompatibleArtifact, captures);
        await captureAndStartInitialisation(portB, "new", captures);
        await confirmRebuild(portB, captures);
        await acknowledgeDisabledOptionalFeatures(portB, captures);
        await finishInitialisation(portB, context.cliBinary, sessionMode0.cliEnv);
        await resumeCompatibilityReviewIfShown(portB);
        await assertCaseSettings(context.cliBinary, sessionMode0.cliEnv, definition, shared.idKey, 0);
        const sentinelBefore = await writeEntryStateWhenReady(
            context.cliBinary,
            sessionMode0.cliEnv,
            sentinelPath,
            sentinelContent
        );

        await reconnectP2PStatus(portA);
        await openP2PStatus(portB);
        await waitForDetectedPeer(portB);
        const sourceMetadataBefore = await readMetadataIds(context.cliBinary, sessionA.cliEnv);
        if (!sourceMetadataBefore.ids.includes(sourceEntry.id)) {
            throw new Error("The source Metadata entry was absent before the incompatible peer attempted replication.");
        }
        let finished = false;
        const acceptor = acceptConnectionRequests([portA, portB], () => finished);
        try {
            await replicateFromStatusPane(portB);
            await waitForTweakMismatchNotice(portB, sessionMode0);
        } finally {
            finished = true;
            await acceptor;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        const mode0MetadataAfter = await readMetadataIds(context.cliBinary, sessionMode0.cliEnv);
        if (mode0MetadataAfter.ids.includes(sourceEntry.id)) {
            throw new Error("The mode 0 peer imported source Metadata after the visible P2P tweak refusal.");
        }
        if (mode0MetadataAfter.paths.includes(pathNfc)) {
            throw new Error("The mode 0 peer created source-path Metadata after the visible P2P tweak refusal.");
        }
        const absentSourceFile = await readVaultFileState(vaultMode0.path, pathNfc);
        assertEqual(absentSourceFile.found, false, "The mode 0 peer reflected the rejected source file.");
        const sentinelAfter = await writeEntryStateWhenReady(
            context.cliBinary,
            sessionMode0.cliEnv,
            sentinelPath,
            sentinelContent
        );
        assertEqual(sentinelAfter.id, sentinelBefore.id, "The failed P2P attempt changed the local sentinel ID.");
        assertEqual(
            sentinelAfter.rev,
            sentinelBefore.rev,
            "The failed P2P attempt changed the local sentinel revision."
        );
        assertEqual(sentinelAfter.content, sentinelContent, "The failed P2P attempt changed the local sentinel body.");

        console.log(
            "P2P NFC case passed: NFD source identity, NFC lookup, exact Chunk-backed transfer, reverse edit, revision retention, full restart, mode 0 refusal, and sentinel preservation."
        );
    } catch (error) {
        for (const session of context.activeSessions) {
            const port = session.remoteDebuggingPort;
            await captureObsidianPage(port, `p2p-nfc-${definition.name}-${port}-failure.png`, (page) =>
                page.locator("body").waitFor({ state: "visible" })
            ).catch(() => undefined);
            const state = await withObsidianPage(
                port,
                async (page) => await page.locator(".workspace-leaf-content").allTextContents()
            ).catch(() => []);
            console.error(`P2P NFC failure UI on ${port}: ${JSON.stringify(state).slice(-6000)}`);
        }
        throw error;
    } finally {
        await stopSessions(context).catch((error: unknown) => {
            console.warn(error instanceof Error ? error.message : error);
        });
        for (const vault of vaults) await vault.dispose();
    }
}

async function main(): Promise<void> {
    const cases = selectedCases(process.argv.slice(2));
    const migration = process.argv.includes("--migration");
    for (const definition of cases) await runCase(definition, migration);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
