import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchCouchDbDocument,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
    type CouchDbConfig,
    type CouchDbDocument,
} from "../runner/couchdb.ts";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
    installBuiltPlugin,
    launchObsidian,
    openVaultWithObsidianCli,
    preseedLocalStorage,
    preseedTrustedVaultState,
    trustVaultIfPrompted,
    waitForObsidianVault,
    waitForPluginCatalogue,
    type ObsidianProcess,
} from "@vrtmrz/obsidian-test-session";
import {
    assertE2eCompatibilityUnpaused,
    assertEqual,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

const notePath = "Issue1224/waiting-note.md";
const initialContent = "# Waiting file\n\nThis content arrived after the network returned.\n";
const followUpContent = "# Waiting file\n\nA later edit arrived through continuous synchronisation.\n";
const recoverySnapshotKey = "replicationResultProcessorSnapshot";
// Only the exact published 1.0.51 baseline is allowed to lack the diagnostic getter.
const diagnosticAbsentBaselineHash = "ba64782cd2a5a1c32b761b31530e76af361d8c29ebbb9168753b7eee04b04c96";
const timeoutMs = Number(process.env.E2E_OBSIDIAN_NETWORK_RECOVERY_TIMEOUT_MS ?? 30_000);
const networkControllers = new Map<number, NetworkController>();

function logPhase(phase: string, details: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({ scenario: "issue1224-network-recovery", phase, ...details }));
}

type RemoteMetadata = CouchDbDocument & {
    _rev: string;
    _revisions: { start: number; ids: string[] };
    path: string;
    children: string[];
};

type PendingReflection = {
    documentId: string;
    revision: string;
    source: string;
    state: string;
    automaticAttempted: boolean;
    resources: string[];
    reason: string;
};

type NetworkWindow = Window & { __issue1224NetworkEvents?: string[] };
type NetworkController = { browser: Browser; context: BrowserContext; page: Page };
type SessionControl = {
    app: ObsidianProcess;
    remoteDebuggingPort: number;
};
type OfflineReceiverSession = SessionControl & { page: Page };

type ReceiverState = {
    online: boolean;
    visibilityState: DocumentVisibilityState;
    focused: boolean;
    syncStatus: string | null;
    content: string | null;
    pendingReflections: PendingReflection[];
    localChunkCount: number;
    hasPendingContinuousStart: boolean;
    pendingContinuousStart: { reason: string; hostOnlineAtFailure: boolean; failedAt: number } | null;
    hasReplicationScheduling: boolean;
};

type DiagnosticExpectation = "required" | "absent";

async function localSessionEnvironment(vault: TemporaryVault, slot: number): Promise<NodeJS.ProcessEnv> {
    // Each simultaneously running Obsidian process owns a distinct CDP port.
    const port = 20_000 + (process.pid % 20_000) + slot;
    const runtimeDirectory = join(vault.statePath, "xdg-runtime");
    await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
    return {
        ...process.env,
        E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT: String(port),
        XDG_RUNTIME_DIR: runtimeDirectory,
    };
}

function createPluginData(config: CouchDbConfig, dbName: string, liveSync: boolean): Record<string, unknown> {
    return createE2eCouchDbPluginData(
        { uri: config.uri, username: config.username, password: config.password, dbName },
        {
            encrypt: false,
            encryptInternalMetadata: false,
            usePathObfuscation: false,
            liveSync,
            syncOnStart: false,
            syncOnSave: false,
            periodicReplication: false,
            readChunksOnline: true,
            useOnlyLocalChunk: false,
            useRequestAPI: false,
            maxMTimeForReflectEvents: 0,
        }
    );
}

function assertLocalCouchDb(config: CouchDbConfig): void {
    const hostname = new URL(config.uri).hostname.toLowerCase();
    assert(
        hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]",
        "Issue #1224 E2E requires a disposable loopback CouchDB fixture."
    );
}

function assertDiagnosticShape(state: ReceiverState, phase: string, expectation: DiagnosticExpectation): void {
    assertEqual(
        state.hasPendingContinuousStart,
        expectation === "required",
        expectation === "required"
            ? `${phase}: the plug-in does not expose the start diagnostic.`
            : `${phase}: the legacy plug-in unexpectedly exposes the start diagnostic.`
    );
    if (expectation === "absent") {
        assertEqual(state.pendingContinuousStart, null, `${phase}: the legacy plug-in returned a diagnostic value.`);
    }
}

function assertNoReplicationScheduling(state: ReceiverState, phase: string): void {
    assertEqual(state.hasReplicationScheduling, false, `${phase}: plugin.replicationScheduling is exposed.`);
}

function assertOfflineContinuousStartDiagnostic(state: ReceiverState, phase: string): void {
    assertDiagnosticShape(state, phase, "required");
    const diagnostic = state.pendingContinuousStart;
    assert(diagnostic, `${phase}: the offline start did not retain its failure diagnostic.`);
    assert(
        diagnostic.reason === "offline" || diagnostic.reason === "remote-transport",
        `${phase}: unexpected offline start failure reason: ${diagnostic.reason}`
    );
    assertEqual(diagnostic.hostOnlineAtFailure, false, `${phase}: the failed start did not observe the offline host.`);
    assert(Number.isFinite(diagnostic.failedAt), `${phase}: the diagnostic has no finite failure timestamp.`);
}

async function fetchRemoteMetadataWithHistory(
    config: CouchDbConfig,
    dbName: string,
    documentId: string
): Promise<RemoteMetadata> {
    const url = `${config.uri.replace(/\/+$/u, "")}/${encodeURIComponent(dbName)}/${encodeURIComponent(documentId)}?revs=true`;
    const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
    const response = await globalThis.fetch(url, { headers: { authorization } });
    if (!response.ok) {
        throw new Error(`Could not read the issue #1224 Metadata fixture. HTTP ${response.status}.`);
    }
    return (await response.json()) as RemoteMetadata;
}

async function waitFor<T>(
    read: () => Promise<T>,
    accept: (value: T) => boolean,
    description: string
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let value: T;
    do {
        value = await read();
        if (accept(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(value)}`);
}

async function startSession(
    binary: string,
    cliBinary: string,
    vault: TemporaryVault,
    config: CouchDbConfig,
    dbName: string,
    liveSync: boolean,
    portSlot: number,
    beforePluginStart?: (remoteDebuggingPort: number) => Promise<void>
): Promise<ObsidianLiveSyncSession> {
    const environment = await localSessionEnvironment(vault, portSlot);
    const session = await startObsidianLiveSyncSession({
        binary,
        cliBinary,
        vault,
        artifactRoot: resolve(process.env.E2E_OBSIDIAN_ARTIFACT_ROOT?.trim() || process.cwd()),
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        pluginData: createPluginData(config, dbName, liveSync),
        localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        env: environment,
        ...(beforePluginStart
            ? { lifecycle: { beforePluginStart: async ({ remoteDebuggingPort }) => await beforePluginStart(remoteDebuggingPort) } }
            : {}),
    });
    await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
    await assertE2eCompatibilityUnpaused(cliBinary, session.cliEnv, session.remoteDebuggingPort);
    return session;
}

async function startOfflineReceiverSession(
    binary: string,
    cliBinary: string,
    vault: TemporaryVault,
    config: CouchDbConfig,
    dbName: string,
    portSlot: number
): Promise<OfflineReceiverSession> {
    const environment = await localSessionEnvironment(vault, portSlot);
    const remoteDebuggingPort = Number(environment.E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT);
    const cliEnv = {
        ...environment,
        HOME: vault.homePath,
        XDG_CONFIG_HOME: vault.xdgConfigPath,
        XDG_CACHE_HOME: vault.xdgCachePath,
        XDG_DATA_HOME: vault.xdgDataPath,
    };
    await installBuiltPlugin(vault.path, {
        pluginId: "obsidian-livesync",
        artifactRoot: resolve(process.env.E2E_OBSIDIAN_ARTIFACT_ROOT?.trim() || process.cwd()),
        pluginData: createPluginData(config, dbName, true),
        enableOnStartup: false,
    });
    const app = await launchObsidian({
        binary,
        vaultPath: vault.path,
        homePath: vault.homePath,
        xdgConfigPath: vault.xdgConfigPath,
        xdgCachePath: vault.xdgCachePath,
        xdgDataPath: vault.xdgDataPath,
        userDataPath: vault.userDataPath,
        remoteDebuggingPort,
        env: cliEnv,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        staleProcessPattern: vault.processMarker,
    });
    logPhase("receiver-process-launched", { offlineStart: true, portSlot });

    try {
        await preseedTrustedVaultState(remoteDebuggingPort, vault.id);
        const storageController = await connectNetworkController(remoteDebuggingPort);
        try {
            await preseedLocalStorage(storageController.page, createE2eObsidianDeviceLocalState(vault.name));
        } finally {
            await storageController.browser.close();
        }
        await openVaultWithObsidianCli(cliBinary, vault.path, cliEnv);
        await waitForObsidianVault(remoteDebuggingPort, vault.path);
        await trustVaultIfPrompted(remoteDebuggingPort);
        await waitForPluginCatalogue(remoteDebuggingPort, "obsidian-livesync");

        await setNetworkOffline(remoteDebuggingPort);
        logPhase("receiver-network-offline", { offlineEventObserved: true, portSlot });
        const controller = networkControllers.get(remoteDebuggingPort);
        if (!controller) throw new Error("The receiver lost its held CDP network session before plug-in start.");
        const { page } = controller;
        await page.evaluate(async () => {
            const host = window as unknown as {
                app: {
                    plugins: {
                        plugins: Record<string, unknown>;
                        setEnable(enabled: boolean): Promise<void>;
                        enablePluginAndSave(id: string): Promise<void>;
                        saveConfig(): Promise<void>;
                    };
                };
            };
            const plugins = host.app.plugins;
            if (plugins.plugins["obsidian-livesync"] !== undefined) {
                throw new Error("The receiver plug-in loaded before CDP put the renderer offline.");
            }
            await plugins.setEnable(true);
            await plugins.enablePluginAndSave("obsidian-livesync");
            await plugins.saveConfig();
        });
        logPhase("receiver-plugin-loaded-offline", { portSlot });
        await page.waitForFunction(
            () => {
                const host = window as unknown as {
                    app?: {
                        plugins?: {
                            plugins?: Record<
                                string,
                                { core?: { services?: { database?: { isDatabaseReady(): boolean }; appLifecycle?: { isReady(): boolean } } } }
                            >;
                        };
                    };
                };
                const core = host.app?.plugins?.plugins?.["obsidian-livesync"]?.core;
                return core?.services?.database?.isDatabaseReady() === true && core.services.appLifecycle?.isReady() === true;
            },
            undefined,
            { timeout: timeoutMs }
        );
        const versionUpFlash = await page.evaluate(() => {
            const host = window as unknown as {
                app: { plugins: { plugins: Record<string, { core: { services: { setting: { currentSettings(): { versionUpFlash: string } } } } }> } };
            };
            return host.app.plugins.plugins["obsidian-livesync"].core.services.setting.currentSettings().versionUpFlash;
        });
        assertEqual(versionUpFlash, "", "Compatibility review unexpectedly paused the offline-started receiver.");
        assertEqual(
            await page.locator(".notice.livesync-compatibility-review-notice:visible").count(),
            0,
            "An unexpected compatibility review reminder appeared in the offline-started receiver."
        );
        logPhase("receiver-core-ready-offline", { portSlot, versionUpFlash });
        return { app, page, remoteDebuggingPort };
    } catch (error) {
        await app.stop();
        await closeNetworkController(remoteDebuggingPort);
        throw error;
    }
}

async function connectNetworkController(port: number): Promise<NetworkController> {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if (!context) {
        await browser.close();
        throw new Error("Obsidian did not expose a browser context for network emulation.");
    }
    const page = context.pages()[0] ?? (await context.waitForEvent("page", { timeout: timeoutMs }));
    return { browser, context, page };
}

async function closeNetworkController(port: number): Promise<void> {
    const controller = networkControllers.get(port);
    networkControllers.delete(port);
    await controller?.browser.close().catch(() => undefined);
}

async function setNetworkOffline(port: number): Promise<void> {
    await closeNetworkController(port);
    const controller = await connectNetworkController(port);
    networkControllers.set(port, controller);
    const { page, context } = controller;
    await page.bringToFront();
    await page.evaluate(() => {
        const host = window as NetworkWindow;
        host.__issue1224NetworkEvents = [];
        window.addEventListener("offline", () => host.__issue1224NetworkEvents?.push("offline"), { once: true });
    });
    await context.setOffline(true);
    await page.waitForFunction(() => navigator.onLine === false, undefined, { timeout: timeoutMs });
    const offlineEventObserved = await page.evaluate(() =>
        (window as NetworkWindow).__issue1224NetworkEvents?.includes("offline") === true
    );
    assertEqual(offlineEventObserved, true, "CDP offline emulation did not dispatch window.offline.");
}

async function restoreNetwork(port: number): Promise<void> {
    let controller = networkControllers.get(port);
    if (!controller) {
        controller = await connectNetworkController(port);
        networkControllers.set(port, controller);
    }
    const { page, context } = controller;
    await page.bringToFront();
    await page.evaluate(() => {
        const host = window as NetworkWindow;
        host.__issue1224NetworkEvents ??= [];
        window.addEventListener("online", () => host.__issue1224NetworkEvents?.push("online"), { once: true });
    });
    await context.setOffline(false);
    await page.waitForFunction(
        () =>
            navigator.onLine === true &&
            document.visibilityState === "visible" &&
            document.hasFocus() &&
            (window as NetworkWindow).__issue1224NetworkEvents?.includes("online") === true,
        undefined,
        { timeout: timeoutMs }
    );
}

async function readReceiverState(page: Page, metadata: RemoteMetadata): Promise<ReceiverState> {
    const result = await page.evaluate(async ({ receivedMetadata, snapshotKey }) => {
        const host = window as unknown as {
            app: {
                plugins: { plugins: Record<string, { core: unknown; pendingContinuousStart?: unknown }> };
                vault: { getAbstractFileByPath(path: string): unknown; read(file: unknown): Promise<string> };
            };
        };
        const plugin = host.app.plugins.plugins["obsidian-livesync"] as unknown as {
            core: {
                kvDB: { get<T>(key: string): Promise<T | undefined> };
                localDatabase: { localDatabase: { get(id: string): Promise<{ _deleted?: boolean }> } };
                services: { replicator: { getActiveReplicator(): { syncStatus?: string } | undefined } };
            };
            pendingContinuousStart?: { reason: string; hostOnlineAtFailure: boolean; failedAt: number };
        };
        const core = plugin.core;
        const snapshot = await core.kvDB.get<{ pendingReflections?: PendingReflection[] }>(snapshotKey);
        const file = host.app.vault.getAbstractFileByPath(receivedMetadata.path);
        const db = core.localDatabase.localDatabase;
        let localChunkCount = 0;
        for (const id of receivedMetadata.children) {
            const doc = await db.get(id).catch(() => undefined);
            if (doc && !doc._deleted) localChunkCount++;
        }
        const replicator = core.services.replicator.getActiveReplicator();
        return JSON.stringify({
            online: navigator.onLine,
            visibilityState: document.visibilityState,
            focused: document.hasFocus(),
            syncStatus: replicator?.syncStatus ?? null,
            content: file ? await host.app.vault.read(file) : null,
            pendingReflections: snapshot?.pendingReflections ?? [],
            localChunkCount,
            hasPendingContinuousStart: "pendingContinuousStart" in plugin,
            pendingContinuousStart: plugin.pendingContinuousStart ?? null,
            hasReplicationScheduling: "replicationScheduling" in plugin,
        });
    }, {
        receivedMetadata: { _id: metadata._id, _rev: metadata._rev, path: metadata.path, children: metadata.children },
        snapshotKey: recoverySnapshotKey,
    });
    return JSON.parse(result) as ReceiverState;
}

async function deliverReceivedMetadataOffline(page: Page, metadata: RemoteMetadata): Promise<void> {
    logPhase("received-metadata-injection-starting");
    const result = await page.evaluate(async (receivedMetadata) => {
        const host = window as unknown as {
            app: {
                plugins: { plugins: Record<string, { core: unknown }> };
            };
        };
        const core = host.app.plugins.plugins["obsidian-livesync"].core as {
            localDatabase: { localDatabase: { bulkDocs(docs: unknown[], options: { new_edits: boolean }): Promise<unknown>; get(id: string): Promise<{ _rev: string }> } };
            services: { replication: { parseSynchroniseResult(documents: unknown[]): Promise<boolean> } };
        };
        const db = core.localDatabase.localDatabase;
        await db.bulkDocs([receivedMetadata], { new_edits: false });
        const stored = await db.get(receivedMetadata._id);
        if (stored._rev !== receivedMetadata._rev) {
            throw new Error("The local Metadata revision differs from the remote revision.");
        }
        const localChunkCount = (
            await Promise.all(
                receivedMetadata.children.map((id) => db.get(id).then(() => true).catch(() => false))
            )
        ).filter(Boolean).length;
        if (localChunkCount !== 0) throw new Error("The received Metadata fixture already contains local Chunks.");
        const accepted = await core.services.replication.parseSynchroniseResult([receivedMetadata]);
        return { accepted: !!accepted, localRevision: stored._rev, localChunkCount };
    }, metadata);
    assertEqual(result.accepted, true, "The plug-in did not accept the received Metadata fixture.");
    assertEqual(result.localRevision, metadata._rev, "The received Metadata fixture lost its remote revision.");
    assertEqual(result.localChunkCount, 0, "The received Metadata fixture already contains Chunk data.");
    logPhase("received-handler-accepted", { revision: result.localRevision, localChunkCount: result.localChunkCount });
}

async function waitForVaultContent(vaultPath: string, expected: string, description: string): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let actual: string | undefined;
    do {
        try {
            actual = await readFile(join(vaultPath, notePath), "utf8");
            if (actual === expected) return actual;
        } catch {
            actual = undefined;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${description}. Expected ${JSON.stringify(expected)}; actual ${JSON.stringify(actual)}.`);
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked: ${cli.checked.join(", ")}`);
    const cliBinary = cli.binary;
    const config = await loadCouchDbConfig();
    assertLocalCouchDb(config);
    await assertCouchDbReachable(config);
    logPhase("loopback-couchdb-ready");

    const dbName = makeUniqueDatabaseName(config.dbPrefix, "issue1224-network-recovery");
    const artifactRoot = resolve(process.env.E2E_OBSIDIAN_ARTIFACT_ROOT?.trim() || process.cwd());
    const artifactManifest = JSON.parse(await readFile(join(artifactRoot, "manifest.json"), "utf8")) as {
        version?: string;
    };
    const artifactHash = createHash("sha256")
        .update(new Uint8Array(await readFile(join(artifactRoot, "main.js"))))
        .digest("hex");
    const diagnosticExpectation: DiagnosticExpectation =
        artifactHash === diagnosticAbsentBaselineHash ? "absent" : "required";
    logPhase("diagnostic-contract-selected", {
        expectation: diagnosticExpectation,
        legacyBaseline: diagnosticExpectation === "absent",
        mainSha256: artifactHash,
    });
    let databaseCreated = false;
    let seedSession: ObsidianLiveSyncSession | undefined;
    let receiverSession: OfflineReceiverSession | undefined;
    let seedVault: TemporaryVault | undefined;
    let receiverVault: TemporaryVault | undefined;
    const activeSessions: SessionControl[] = [];

    try {
        await createCouchDbDatabase(config, dbName);
        databaseCreated = true;
        logPhase("unique-database-created");
        const seed = await createTemporaryVault("obsidian-issue1224-seed-");
        seedVault = seed;
        const receiver = await createTemporaryVault("obsidian-issue1224-receiver-");
        receiverVault = receiver;

        logPhase("seed-session-starting");
        seedSession = await startSession(binary, cliBinary, seed, config, dbName, false, 1);
        activeSessions.push(seedSession);
        logPhase("seed-session-ready");
        logPhase("seed-remote-preparing");
        await prepareRemote(cliBinary, seedSession.cliEnv);
        logPhase("seed-remote-ready");
        await evalObsidianJson<unknown>(
            cliBinary,
            [
                "(async()=>{",
                `const path=${JSON.stringify(notePath)};`,
                `const content=${JSON.stringify(initialContent)};`,
                "if(!(await app.vault.adapter.exists('Issue1224'))) await app.vault.createFolder('Issue1224');",
                "await app.vault.create(path,content);",
                "return JSON.stringify({path,content});",
                "})()",
            ].join(""),
            seedSession.cliEnv
        );
        logPhase("seed-upload-starting");
        await pushLocalChanges(cliBinary, seedSession.cliEnv);
        logPhase("seed-upload-complete");
        const metadataSummary = await waitForCouchDbDocs(
            config,
            dbName,
            (documents) => documents.some((doc) => doc.path === notePath && Array.isArray(doc.children) && doc.children.length > 0)
        );
        const summary = metadataSummary.find(
            (doc) => doc.path === notePath && Array.isArray(doc.children) && doc.children.length > 0
        );
        if (!summary) throw new Error("The seed device did not upload the Waiting note Metadata.");
        const metadata = await fetchRemoteMetadataWithHistory(config, dbName, summary._id);
        assertEqual(metadata.path, notePath, "The remote Metadata path differs from the Waiting fixture.");
        const remoteChunks = await Promise.all(metadata.children.map((id) => fetchCouchDbDocument(config, dbName, id)));
        assertEqual(remoteChunks.length, metadata.children.length, "The remote note is missing one or more Chunks.");
        logPhase("seed-metadata-and-chunks-verified", { chunkCount: remoteChunks.length });
        await seedSession.app.stop();
        activeSessions.splice(activeSessions.indexOf(seedSession), 1);
        seedSession = undefined;
        logPhase("seed-session-stopped");

        receiverSession = await startOfflineReceiverSession(binary, cliBinary, receiver, config, dbName, 2);
        activeSessions.push(receiverSession);
        logPhase("receiver-offline-started");
        const offlineBeforeWaiting = await waitFor(
            () => readReceiverState(receiverSession!.page, metadata),
            (state) =>
                state.syncStatus !== "CONNECTED" &&
                (diagnosticExpectation === "absent" ||
                    (state.hasPendingContinuousStart && state.pendingContinuousStart !== null)),
            "the offline continuous-start attempt to settle"
        );
        assertDiagnosticShape(offlineBeforeWaiting, "first offline startup", diagnosticExpectation);
        assertNoReplicationScheduling(offlineBeforeWaiting, "first offline startup");
        assertEqual(offlineBeforeWaiting.online, false, "The receiver was not offline before the Waiting fixture was delivered.");
        assert(
            offlineBeforeWaiting.syncStatus !== "CONNECTED",
            `Continuous replication unexpectedly connected while offline: ${offlineBeforeWaiting.syncStatus}`
        );
        assertEqual(offlineBeforeWaiting.content, null, "The receiver already has the remote file before reconnection.");

        await deliverReceivedMetadataOffline(receiverSession.page, metadata);
        logPhase("received-metadata-injected");
        const waiting = await waitFor(
            () => readReceiverState(receiverSession!.page, metadata),
            (state) =>
                state.pendingReflections.some(
                    (pending) =>
                        pending.documentId === metadata._id &&
                        pending.revision === metadata._rev &&
                        pending.source === "received" &&
                        pending.state === "waiting" &&
                        pending.resources.includes("remote")
                ),
            "the received file to remain Waiting for its remote Chunks"
        );
        assertEqual(waiting.online, false, "The receiver unexpectedly came online before the recovery event.");
        assertDiagnosticShape(waiting, "Waiting state before restart", diagnosticExpectation);
        assertNoReplicationScheduling(waiting, "Waiting state before restart");
        assertEqual(waiting.localChunkCount, 0, "The receiver unexpectedly had the missing Chunks before reconnection.");
        assertEqual(waiting.content, null, "The Waiting note was reflected before the network returned.");
        logPhase("waiting-record-saved", { state: "waiting", contentPresent: waiting.content !== null });

        const firstReceiverSession = receiverSession;
        await firstReceiverSession.app.stop();
        await closeNetworkController(firstReceiverSession.remoteDebuggingPort);
        activeSessions.splice(activeSessions.indexOf(firstReceiverSession), 1);
        receiverSession = undefined;
        receiverSession = await startOfflineReceiverSession(binary, cliBinary, receiver, config, dbName, 3);
        activeSessions.push(receiverSession);
        logPhase("receiver-restarted-offline");
        const restoredWaiting = await waitFor(
            () => readReceiverState(receiverSession!.page, metadata),
            (state) =>
                state.online === false &&
                state.syncStatus !== "CONNECTED" &&
                (diagnosticExpectation === "absent" ||
                    (state.hasPendingContinuousStart && state.pendingContinuousStart !== null)) &&
                state.pendingReflections.some(
                    (pending) =>
                        pending.documentId === metadata._id &&
                        pending.revision === metadata._rev &&
                        pending.source === "received" &&
                        pending.state === "waiting" &&
                        pending.resources.includes("remote")
                ),
            "the actual Waiting record to restore from the same Vault while offline"
        );
        assertDiagnosticShape(restoredWaiting, "offline startup with restored Waiting state", diagnosticExpectation);
        assertNoReplicationScheduling(restoredWaiting, "offline startup with restored Waiting state");
        assertEqual(restoredWaiting.localChunkCount, 0, "The restored Waiting fixture unexpectedly has Chunks.");
        assertEqual(restoredWaiting.content, null, "The restored Waiting file was reflected before reconnection.");
        logPhase("waiting-record-restored", { state: "waiting", contentPresent: restoredWaiting.content !== null });

        console.log(
            JSON.stringify(
                {
                    phase: "offline-waiting-restored",
                    artifact: { version: artifactManifest.version ?? "unknown", mainSha256: artifactHash },
                    firstOfflineStart: {
                        online: offlineBeforeWaiting.online,
                        syncStatus: offlineBeforeWaiting.syncStatus,
                        hasDiagnostic: offlineBeforeWaiting.hasPendingContinuousStart,
                        pendingContinuousStart: offlineBeforeWaiting.pendingContinuousStart,
                    },
                    waiting: {
                        path: notePath,
                        state: "waiting",
                        resource: "remote",
                        content: restoredWaiting.content,
                        localChunkCount: restoredWaiting.localChunkCount,
                    },
                    offlineRestartStart: {
                        online: restoredWaiting.online,
                        syncStatus: restoredWaiting.syncStatus,
                        hasDiagnostic: restoredWaiting.hasPendingContinuousStart,
                        pendingContinuousStart: restoredWaiting.pendingContinuousStart,
                    },
                    setup: "Remote Metadata was passed through the real received-document handler; the result processor created the Waiting record before the same Vault was reopened offline.",
                },
                null,
                2
            )
        );

        await restoreNetwork(receiverSession.remoteDebuggingPort);
        const onlineState = await readReceiverState(receiverSession.page, metadata);
        assertDiagnosticShape(onlineState, "online event", diagnosticExpectation);
        assertNoReplicationScheduling(onlineState, "online event");
        assertEqual(onlineState.online, true, "The receiver did not report online after CDP restored its network.");
        assertEqual(onlineState.visibilityState, "visible", "The receiver was not visible when the network returned.");
        assertEqual(onlineState.focused, true, "The receiver did not have focus when the network returned.");
        console.log(
            JSON.stringify({
                phase: "online-event-observed",
                networkEvents: ["offline", "online"],
                foreground: { visibilityState: onlineState.visibilityState, focused: onlineState.focused },
                hasDiagnostic: onlineState.hasPendingContinuousStart,
                pendingContinuousStart: onlineState.pendingContinuousStart,
            })
        );

        const receivedContent = await waitForVaultContent(receiver.path, initialContent, "the Waiting file content");
        const recovered = await waitFor(
            () => readReceiverState(receiverSession!.page, metadata),
            (state) =>
                state.content === initialContent &&
                state.localChunkCount === metadata.children.length &&
                !state.pendingReflections.some((pending) => pending.documentId === metadata._id),
            "automatic Chunk transfer and reflection of the Waiting file"
        );
        assertDiagnosticShape(recovered, "recovered continuous connection", diagnosticExpectation);
        assertNoReplicationScheduling(recovered, "recovered continuous connection");
        assertEqual(recovered.content, initialContent, "Obsidian read different content from the recovered Vault file.");
        logPhase("waiting-file-reflected", { content: recovered.content });

        seedSession = await startSession(binary, cliBinary, seed, config, dbName, true, 1);
        activeSessions.push(seedSession);
        const seedContent = await evalObsidianJson<string>(
            cliBinary,
            [
                "(async()=>{",
                `const file=app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});`,
                "if(!file) throw new Error('The source note is missing after its LiveSync restart.');",
                "return JSON.stringify(await app.vault.read(file));",
                "})()",
            ].join(""),
            seedSession.cliEnv
        );
        assertEqual(seedContent, initialContent, "The source note changed before the follow-up edit.");
        await evalObsidianJson<unknown>(
            cliBinary,
            [
                "(async()=>{",
                `const file=app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});`,
                "if(!file) throw new Error('The source note is missing before its follow-up edit.');",
                `await app.vault.modify(file,${JSON.stringify(followUpContent)});`,
                "return JSON.stringify(true);",
                "})()",
            ].join(""),
            seedSession.cliEnv
        );
        logPhase("later-edit-saved-in-source", { expected: followUpContent });
        const updatedMetadata = await waitForCouchDbDocs(
            config,
            dbName,
            (documents) =>
                documents.some(
                    (doc) =>
                        doc.path === notePath &&
                        Array.isArray(doc.children) &&
                        doc._rev !== metadata._rev
                )
        );
        const remoteUpdate = updatedMetadata.find((doc) => doc.path === notePath && doc._rev !== metadata._rev);
        if (!remoteUpdate) throw new Error("The source device did not send its follow-up edit to CouchDB.");
        logPhase("later-edit-uploaded", { revision: remoteUpdate._rev });
        const receivedFollowUp = await waitForVaultContent(
            receiver.path,
            followUpContent,
            "the follow-up edit through continuous synchronisation"
        );
        logPhase("later-edit-reflected", { content: receivedFollowUp });
        const receiverFinal = await receiverSession.page.evaluate(async (path) => {
            const host = window as unknown as {
                app: { vault: { getAbstractFileByPath(path: string): unknown; read(file: unknown): Promise<string> } };
            };
            const file = host.app.vault.getAbstractFileByPath(path);
            if (!file) throw new Error("The receiver note disappeared after the follow-up edit.");
            return await host.app.vault.read(file);
        }, notePath);
        assertEqual(receiverFinal, followUpContent, "Obsidian read different content after the follow-up edit.");
        if (diagnosticExpectation === "required") {
            assertOfflineContinuousStartDiagnostic(offlineBeforeWaiting, "first offline startup");
            assertOfflineContinuousStartDiagnostic(restoredWaiting, "offline startup with restored Waiting state");
            assertEqual(recovered.pendingContinuousStart, null, "The recovered continuous-start diagnostic was not cleared.");
        }

        console.log(
            JSON.stringify(
                {
                    scenario: "issue1224-network-recovery",
                    artifact: { version: artifactManifest.version ?? "unknown", mainSha256: artifactHash },
                    diagnosticExpectation,
                    obsidian: basename(binary),
                    couchDb: "loopback fixture; unique database removed after the run",
                    receiverStartup: { online: offlineBeforeWaiting.online, syncStatus: offlineBeforeWaiting.syncStatus },
                    offlineStartDiagnostic: offlineBeforeWaiting.pendingContinuousStart,
                    waitingRestartDiagnostic: restoredWaiting.pendingContinuousStart,
                    recoveredDiagnostic: recovered.pendingContinuousStart,
                    waiting: {
                        path: notePath,
                        state: "waiting",
                        resource: "remote",
                        contentBeforeNetworkReturn: waiting.content,
                    },
                    networkEvents: ["offline", "online"],
                    initialContent: { expected: initialContent, receiverVault: receivedContent, recovered },
                    followUpEdit: { remoteRevision: remoteUpdate._rev, expected: followUpContent, receiverVault: receivedFollowUp },
                },
                null,
                2
            )
        );
    } finally {
        const stops = activeSessions.splice(0).map(async (session) => await session.app.stop());
        const stopResults = await Promise.allSettled(stops);
        for (const result of stopResults) {
            if (result.status === "rejected") console.error("Could not stop an isolated Obsidian session:", result.reason);
        }
        await Promise.all([...networkControllers.keys()].map((port) => closeNetworkController(port)));
        const vaultDisposals: Promise<void>[] = [];
        if (receiverVault) vaultDisposals.push(receiverVault.dispose());
        if (seedVault) vaultDisposals.push(seedVault.dispose());
        const vaultResults = await Promise.allSettled(vaultDisposals);
        for (const result of vaultResults) {
            if (result.status === "rejected") console.error("Could not dispose an isolated E2E Vault:", result.reason);
        }
        if (databaseCreated) {
            await deleteCouchDbDatabase(config, dbName).catch((error: unknown) => {
                console.error(`Could not delete the unique CouchDB fixture ${dbName}:`, error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
