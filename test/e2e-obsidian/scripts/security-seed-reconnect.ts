/**
 * Provides release evidence for the Security Seed refresh behaviour shared by
 * supported platforms in real Obsidian. It verifies that an already-open
 * device keeps its deliberately stale cached Seed until replication, refreshes
 * from the managed CouchDB fixture before encrypting, and never restores the
 * old Seed to the remote synchronisation-parameter document.
 *
 * The scenario uses isolated Vaults, profiles, and a random database because
 * settings, the local database, the renderer process, and CouchDB must all
 * participate in the result. Device A is restarted with the same Vault and
 * profile, while device B is fresh. The devices run sequentially after the
 * same-process stale-cache assertion because desktop Obsidian may enforce a
 * single application instance; running them concurrently would test launcher
 * behaviour rather than LiveSync's shared plug-in implementation.
 *
 * Seed replacement, A-to-B decryption, B-to-A return synchronisation, final
 * remote-document comparison, error-log inspection, screenshots, and strict
 * teardown remain one scenario. Together they prove that the same replacement
 * Seed was used across the complete encrypted round trip and was not later
 * rolled back. Independent passing checks would not establish that continuity.
 * The result records fingerprints only and does not claim to cover an
 * iPadOS-specific background or reconnect lifecycle.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    couchDbDatabaseExists,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchAllCouchDbDocs,
    fetchCouchDbDocument,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    putCouchDbDocument,
    waitForCouchDbDocs,
    type CouchDbConfig,
    type CouchDbDocument,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import {
    SECURITY_SEED_DOCUMENT_ID,
    changedSynchronisationParameterFields,
    createSecuritySeed,
    fingerprintSecuritySeed,
    replaceSecuritySeed,
    requireSecuritySeedDocument,
    snapshotSecuritySeedDocument,
    type SecuritySeedDocument,
    type SecuritySeedDocumentSnapshot,
} from "../runner/securitySeed.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";
process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ??= "20000";
process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ??= "15000";

const outboundPath = "E2E/security-seed/device-a.md";
const returnPath = "E2E/security-seed/device-b.md";
const hkdfErrorMessages = [
    "Encryption with HKDF failed",
    "Decryption with HKDF failed",
    "Failed to initialise the encryption key",
    "Failed to obtain PBKDF2 salt",
] as const;

type RunnerContext = {
    binary: string;
    cliBinary: string;
    artifactRoot: string;
    couchDb: CouchDbConfig;
    dbName: string;
    activeSessions: Set<ObsidianLiveSyncSession>;
    allSessions: ObsidianLiveSyncSession[];
    screenshots: string[];
};

type DeviceLabel = "device-a" | "device-a-return" | "device-b";

type SourceEvidence = {
    exactCommit: string;
    revisionSource: "git-worktree" | "provided-artifact";
    workingTreeClean: boolean | null;
    pluginVersion: string;
    pluginArtifactSha256: string;
};

type ReplicationSettingsState = {
    liveSync: boolean;
    syncOnStart: boolean;
    syncOnSave: boolean;
    periodicReplication: boolean;
    syncOnFileOpen: boolean;
    syncOnEditorSave: boolean;
};

type SessionHealth = {
    matchingErrorMessages: string[];
};

type ScenarioEvidence = {
    source: SourceEvidence;
    securitySeed: {
        initial: SecuritySeedDocumentSnapshot;
        replacement: SecuritySeedDocumentSnapshot;
        final: SecuritySeedDocumentSnapshot;
        cachedBeforeReplacement: string;
        cachedAfterRemoteReplacement: string;
        cachedAfterReplication: string;
        replacementChangedFields: string[];
        finalChangedFields: string[];
    };
    synchronisation: {
        deviceAToDeviceB: boolean;
        deviceBToDeviceA: boolean;
        deviceAEncryptedPayload: boolean;
        deviceBEncryptedPayload: boolean;
    };
    health: {
        deviceA: SessionHealth;
        deviceB: SessionHealth;
    };
    screenshots: string[];
};

type TeardownEvidence = {
    sessionsStopped: boolean;
    vaultRemoved: boolean;
    profileRemoved: boolean;
    databaseRemoved: boolean;
    remainingTrackedSessions: number;
};

class MultipleErrors extends Error {
    readonly errors: unknown[];

    constructor(message: string, errors: unknown[]) {
        super(message);
        this.name = "MultipleErrors";
        this.errors = errors;
    }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
}

function inspectGitRevision(
    artifactRoot: string
): Pick<SourceEvidence, "exactCommit" | "revisionSource" | "workingTreeClean"> {
    try {
        const exactCommit = execFileSync("git", ["-C", artifactRoot, "rev-parse", "HEAD"], {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        const status = execFileSync("git", ["-C", artifactRoot, "status", "--porcelain"], {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        return {
            exactCommit,
            revisionSource: "git-worktree",
            workingTreeClean: status.length === 0,
        };
    } catch {
        const exactCommit = process.env.E2E_OBSIDIAN_ARTIFACT_REVISION?.trim();
        if (!exactCommit) {
            throw new Error(
                "E2E_OBSIDIAN_ARTIFACT_REVISION is required when the plug-in artefact is not in a Git worktree."
            );
        }
        return {
            exactCommit,
            revisionSource: "provided-artifact",
            workingTreeClean: null,
        };
    }
}

async function inspectSourceEvidence(artifactRoot: string): Promise<SourceEvidence> {
    const manifest = JSON.parse(await readFile(join(artifactRoot, "manifest.json"), "utf-8")) as {
        version?: unknown;
    };
    if (typeof manifest.version !== "string" || manifest.version.length === 0) {
        throw new Error("The plug-in manifest does not have a version.");
    }
    const mainJs = await readFile(join(artifactRoot, "main.js"));
    return {
        ...inspectGitRevision(artifactRoot),
        pluginVersion: manifest.version,
        pluginArtifactSha256: createHash("sha256").update(Uint8Array.from(mainJs)).digest("hex"),
    };
}

function e2eeSettings(passphrase: string): Record<string, unknown> {
    return {
        encrypt: true,
        passphrase,
        usePathObfuscation: true,
        E2EEAlgorithm: "v2",
    };
}

async function captureStage(context: RunnerContext, session: ObsidianLiveSyncSession, filename: string): Promise<void> {
    const screenshot = await captureObsidianPage(session.remoteDebuggingPort, filename, async () => undefined);
    context.screenshots.push(screenshot);
    console.log(`Security Seed E2E screenshot: ${screenshot}`);
}

async function startConfiguredSession(
    context: RunnerContext,
    vault: TemporaryVault,
    passphrase: string,
    deviceLabel: DeviceLabel
): Promise<ObsidianLiveSyncSession> {
    const couchDbSettings = {
        uri: context.couchDb.uri,
        username: context.couchDb.username,
        password: context.couchDb.password,
        dbName: context.dbName,
    };
    const overrides = e2eeSettings(passphrase);
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        artifactRoot: context.artifactRoot,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        pluginData: createE2eCouchDbPluginData(couchDbSettings, overrides),
        localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
    });
    context.activeSessions.add(session);
    context.allSessions.push(session);
    try {
        await captureStage(context, session, `security-seed-${deviceLabel}-startup.png`);
        await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
        await prepareRemote(context.cliBinary, session.cliEnv);
        await captureStage(context, session, `security-seed-${deviceLabel}-configured.png`);
        return session;
    } catch (error) {
        await captureStage(context, session, `security-seed-${deviceLabel}-setup-failure.png`).catch(() => undefined);
        await stopTrackedSession(context, session);
        throw error;
    }
}

async function stopTrackedSession(context: RunnerContext, session: ObsidianLiveSyncSession): Promise<void> {
    if (!context.activeSessions.has(session)) {
        return;
    }
    await session.app.stop();
    context.activeSessions.delete(session);
}

async function stopTrackedSessions(context: RunnerContext): Promise<void> {
    const errors: unknown[] = [];
    for (const session of [...context.activeSessions]) {
        try {
            await stopTrackedSession(context, session);
        } catch (error) {
            errors.push(error);
        }
    }
    if (errors.length > 0) {
        throw new MultipleErrors("Could not stop every Real Obsidian session.", errors);
    }
}

async function pauseAutomaticReplication(cliBinary: string, env: NodeJS.ProcessEnv): Promise<ReplicationSettingsState> {
    const state = await evalObsidianJson<ReplicationSettingsState>(
        cliBinary,
        [
            "(()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "core.services.replicator.getActiveReplicator()?.closeReplication();",
            "const settings=core.services.setting.currentSettings();",
            "return JSON.stringify({",
            "liveSync:Boolean(settings.liveSync),",
            "syncOnStart:Boolean(settings.syncOnStart),",
            "syncOnSave:Boolean(settings.syncOnSave),",
            "periodicReplication:Boolean(settings.periodicReplication),",
            "syncOnFileOpen:Boolean(settings.syncOnFileOpen),",
            "syncOnEditorSave:Boolean(settings.syncOnEditorSave),",
            "});",
            "})()",
        ].join(""),
        env
    );
    for (const [name, enabled] of Object.entries(state)) {
        if (enabled) {
            throw new Error(`Automatic replication remained enabled through ${name}.`);
        }
    }
    return state;
}

async function cachedSecuritySeedFingerprint(cliBinary: string, env: NodeJS.ProcessEnv): Promise<string> {
    const result = await evalObsidianJson<{ fingerprint: string }>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const settings=core.services.setting.currentSettings();",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "const seed=await replicator.getReplicationPBKDF2Salt(settings,false);",
            "const digest=await crypto.subtle.digest('SHA-256',seed);",
            "const fingerprint='sha256:'+Array.from(new Uint8Array(digest))",
            ".map((value)=>value.toString(16).padStart(2,'0')).join('').slice(0,16);",
            "return JSON.stringify({fingerprint});",
            "})()",
        ].join(""),
        env
    );
    return result.fingerprint;
}

async function writeNoteViaObsidian(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    content: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(content)};`,
            "const folder=path.split('/').slice(0,-1).join('/');",
            "if(folder&&!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);",
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.modify(existing,content);",
            "else await app.vault.create(path,content);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function openNoteViaObsidian(cliBinary: string, env: NodeJS.ProcessEnv, path: string): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const file=app.vault.getAbstractFileByPath(path);",
            "if(!file) throw new Error(`Could not find note to open: ${path}`);",
            "await app.workspace.getLeaf(false).openFile(file);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function waitForPathContent(
    vaultPath: string,
    path: string,
    expected: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 15000)
): Promise<void> {
    const fullPath = join(vaultPath, path);
    const deadline = Date.now() + timeoutMs;
    let lastContent = "";
    while (Date.now() < deadline) {
        if (await pathExists(fullPath)) {
            lastContent = await readFile(fullPath, "utf-8");
            if (lastContent === expected) {
                return;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${path}. Last content:\n${lastContent}`);
}

function remoteContainsEntry(documents: CouchDbDocument[], entry: LocalDatabaseEntry): boolean {
    const ids = new Set(documents.map((document) => document._id));
    return ids.has(entry.id) && entry.children.every((childId) => ids.has(childId));
}

async function assertEntryNotRemote(context: RunnerContext, entry: LocalDatabaseEntry): Promise<void> {
    const response = await fetchAllCouchDbDocs(context.couchDb, context.dbName);
    const documents = response.rows.flatMap((row) => (row.doc ? [row.doc] : []));
    if (remoteContainsEntry(documents, entry)) {
        throw new Error("The pending device-A document reached CouchDB before the Security Seed replacement.");
    }
}

async function waitForEncryptedRemoteEntry(context: RunnerContext, entry: LocalDatabaseEntry): Promise<boolean> {
    const documents = await waitForCouchDbDocs(context.couchDb, context.dbName, (docs) =>
        remoteContainsEntry(docs, entry)
    );
    const byId = new Map(documents.map((document) => [document._id, document]));
    const encrypted = entry.children.every((childId) => {
        const data = byId.get(childId)?.data;
        return typeof data === "string" && data.startsWith("%=");
    });
    if (!encrypted) {
        throw new Error("A replicated chunk did not use the expected HKDF-encrypted payload format.");
    }
    return true;
}

async function inspectSessionHealth(cliBinary: string, env: NodeJS.ProcessEnv): Promise<SessionHealth> {
    return await evalObsidianJson<SessionHealth>(
        cliBinary,
        [
            "(async()=>{",
            `const patterns=${JSON.stringify(hkdfErrorMessages)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.API.showWindow('log-log');",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "let text='';",
            "for(let i=0;i<20;i++){",
            "text=Array.from(document.querySelectorAll('.logpane .log pre'))",
            ".map((element)=>element.textContent??'').join('\\n');",
            "if(text.length>0) break;",
            "await sleep(50);",
            "}",
            "const unresolved=JSON.stringify((await core.services.appLifecycle.getUnresolvedMessages()).flat());",
            "const matchingErrorMessages=patterns.filter((pattern)=>text.includes(pattern)||unresolved.includes(pattern));",
            "for(const leaf of app.workspace.getLeavesOfType('log-log')) leaf.detach();",
            "return JSON.stringify({matchingErrorMessages});",
            "})()",
        ].join(""),
        env
    );
}

async function fetchSecuritySeedDocument(context: RunnerContext): Promise<SecuritySeedDocument> {
    return requireSecuritySeedDocument(
        await fetchCouchDbDocument(context.couchDb, context.dbName, SECURITY_SEED_DOCUMENT_ID)
    );
}

async function replaceRemoteSecuritySeed(
    context: RunnerContext,
    before: SecuritySeedDocument,
    replacementSeed: string
): Promise<SecuritySeedDocument> {
    const replacement = replaceSecuritySeed(before, replacementSeed);
    const putResult = await putCouchDbDocument(context.couchDb, context.dbName, replacement);
    const after = await fetchSecuritySeedDocument(context);
    assertEqual(after._rev, putResult.rev, "The replacement Security Seed revision was not stored.");
    assertEqual(
        fingerprintSecuritySeed(after.pbkdf2salt),
        fingerprintSecuritySeed(replacementSeed),
        "The replacement Security Seed was not stored."
    );
    const changedFields = changedSynchronisationParameterFields(before, after);
    assertEqual(
        JSON.stringify(changedFields),
        JSON.stringify(["pbkdf2salt"]),
        "Replacing the remote Security Seed changed another synchronisation parameter."
    );
    return after;
}

async function runScenario(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<ScenarioEvidence> {
    const passphrase = `security-seed-e2e-${randomUUID()}`;
    const source = await inspectSourceEvidence(context.artifactRoot);
    let sessionA = await startConfiguredSession(context, vaultA, passphrase, "device-a");

    await pushLocalChanges(context.cliBinary, sessionA.cliEnv);
    await captureStage(context, sessionA, "security-seed-device-a-initial-sync.png");
    const initialDocument = await fetchSecuritySeedDocument(context);
    const initial = snapshotSecuritySeedDocument(initialDocument);
    const cachedBeforeReplacement = await cachedSecuritySeedFingerprint(context.cliBinary, sessionA.cliEnv);
    assertEqual(
        cachedBeforeReplacement,
        initial.fingerprint,
        "Device A did not cache the initial remote Security Seed."
    );

    await pauseAutomaticReplication(context.cliBinary, sessionA.cliEnv);
    const outboundContent = `Encrypted from device A: ${randomUUID()}\n`;
    await writeNoteViaObsidian(context.cliBinary, sessionA.cliEnv, outboundPath, outboundContent);
    const outboundEntry = await waitForLocalDatabaseEntry(context.cliBinary, sessionA.cliEnv, outboundPath);
    await assertEntryNotRemote(context, outboundEntry);

    const replacementSeed = createSecuritySeed();
    const replacementDocument = await replaceRemoteSecuritySeed(context, initialDocument, replacementSeed);
    const replacement = snapshotSecuritySeedDocument(replacementDocument);
    await openNoteViaObsidian(context.cliBinary, sessionA.cliEnv, outboundPath);
    await captureStage(context, sessionA, "security-seed-device-a-replacement-pending.png");
    const cachedAfterRemoteReplacement = await cachedSecuritySeedFingerprint(context.cliBinary, sessionA.cliEnv);
    assertEqual(
        cachedAfterRemoteReplacement,
        initial.fingerprint,
        "Device A did not retain the deliberately stale Security Seed before replication."
    );
    assertEqual(
        replacement.fingerprint,
        fingerprintSecuritySeed(replacementSeed),
        "The runner did not install the intended replacement Security Seed."
    );

    await pushLocalChanges(context.cliBinary, sessionA.cliEnv);
    const cachedAfterReplication = await cachedSecuritySeedFingerprint(context.cliBinary, sessionA.cliEnv);
    assertEqual(
        cachedAfterReplication,
        replacement.fingerprint,
        "Device A did not refresh the Security Seed before replication."
    );
    const deviceAEncryptedPayload = await waitForEncryptedRemoteEntry(context, outboundEntry);
    await captureStage(context, sessionA, "security-seed-device-a-refreshed-sync.png");
    const deviceAHealthBeforeRestart = await inspectSessionHealth(context.cliBinary, sessionA.cliEnv);
    await stopTrackedSession(context, sessionA);

    const sessionB = await startConfiguredSession(context, vaultB, passphrase, "device-b");
    await pushLocalChanges(context.cliBinary, sessionB.cliEnv);
    await waitForPathContent(vaultB.path, outboundPath, outboundContent);
    await openNoteViaObsidian(context.cliBinary, sessionB.cliEnv, outboundPath);
    await captureStage(context, sessionB, "security-seed-device-b-received.png");

    await pauseAutomaticReplication(context.cliBinary, sessionB.cliEnv);
    const returnContent = `Encrypted from device B: ${randomUUID()}\n`;
    await writeNoteViaObsidian(context.cliBinary, sessionB.cliEnv, returnPath, returnContent);
    const returnEntry = await waitForLocalDatabaseEntry(context.cliBinary, sessionB.cliEnv, returnPath);
    await pushLocalChanges(context.cliBinary, sessionB.cliEnv);
    const deviceBEncryptedPayload = await waitForEncryptedRemoteEntry(context, returnEntry);
    const deviceBHealth = await inspectSessionHealth(context.cliBinary, sessionB.cliEnv);
    await stopTrackedSession(context, sessionB);

    sessionA = await startConfiguredSession(context, vaultA, passphrase, "device-a-return");
    await pushLocalChanges(context.cliBinary, sessionA.cliEnv);
    await waitForPathContent(vaultA.path, returnPath, returnContent);
    await openNoteViaObsidian(context.cliBinary, sessionA.cliEnv, returnPath);
    await captureStage(context, sessionA, "security-seed-device-a-return-received.png");

    const finalDocument = await fetchSecuritySeedDocument(context);
    const final = snapshotSecuritySeedDocument(finalDocument);
    assertEqual(
        final.fingerprint,
        replacement.fingerprint,
        "A client rolled the remote Security Seed back after reconnecting."
    );
    const finalChangedFields = changedSynchronisationParameterFields(replacementDocument, finalDocument);
    if (finalChangedFields.length > 0) {
        throw new Error(
            `A client rewrote unexpected synchronisation-parameter fields: ${finalChangedFields.join(", ")}`
        );
    }

    const deviceAHealthAfterRestart = await inspectSessionHealth(context.cliBinary, sessionA.cliEnv);
    const deviceAHealth = {
        matchingErrorMessages: [
            ...new Set([
                ...deviceAHealthBeforeRestart.matchingErrorMessages,
                ...deviceAHealthAfterRestart.matchingErrorMessages,
            ]),
        ],
    };
    if (deviceAHealth.matchingErrorMessages.length > 0 || deviceBHealth.matchingErrorMessages.length > 0) {
        throw new Error(
            `HKDF or Security Seed errors were logged: ${JSON.stringify({
                deviceA: deviceAHealth.matchingErrorMessages,
                deviceB: deviceBHealth.matchingErrorMessages,
            })}`
        );
    }

    return {
        source,
        securitySeed: {
            initial,
            replacement,
            final,
            cachedBeforeReplacement,
            cachedAfterRemoteReplacement,
            cachedAfterReplication,
            replacementChangedFields: changedSynchronisationParameterFields(initialDocument, replacementDocument),
            finalChangedFields,
        },
        synchronisation: {
            deviceAToDeviceB: true,
            deviceBToDeviceA: true,
            deviceAEncryptedPayload,
            deviceBEncryptedPayload,
        },
        health: {
            deviceA: deviceAHealth,
            deviceB: deviceBHealth,
        },
        screenshots: [...context.screenshots],
    };
}

async function cleanupResources(
    context: RunnerContext,
    vaults: TemporaryVault[],
    databaseCreated: boolean
): Promise<TeardownEvidence> {
    const errors: unknown[] = [];
    try {
        await stopTrackedSessions(context);
    } catch (error) {
        errors.push(error);
    }
    for (const vault of vaults) {
        try {
            await vault.dispose();
        } catch (error) {
            errors.push(error);
        }
    }
    if (databaseCreated) {
        try {
            await deleteCouchDbDatabase(context.couchDb, context.dbName);
        } catch (error) {
            errors.push(error);
        }
    }

    const sessionsStopped = context.allSessions.every(
        (session) => session.app.process.exitCode !== null || session.app.process.signalCode !== null
    );
    const vaultRemoved = (await Promise.all(vaults.map(async (vault) => !(await pathExists(vault.path))))).every(
        Boolean
    );
    const profileRemoved = (await Promise.all(vaults.map(async (vault) => !(await pathExists(vault.statePath))))).every(
        Boolean
    );
    let databaseRemoved = !databaseCreated;
    if (databaseCreated) {
        try {
            databaseRemoved = !(await couchDbDatabaseExists(context.couchDb, context.dbName));
        } catch (error) {
            errors.push(error);
        }
    }
    const evidence = {
        sessionsStopped,
        vaultRemoved,
        profileRemoved,
        databaseRemoved,
        remainingTrackedSessions: context.activeSessions.size,
    };
    if (!sessionsStopped || !vaultRemoved || !profileRemoved || !databaseRemoved || context.activeSessions.size > 0) {
        errors.push(new Error(`Security Seed E2E teardown was incomplete: ${JSON.stringify(evidence)}`));
    }
    if (errors.length > 0) {
        throw Object.assign(new MultipleErrors("Security Seed E2E teardown failed.", errors), {
            evidence,
        });
    }
    return evidence;
}

async function writeResult(result: unknown): Promise<string> {
    const outputDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
    const resultPath = join(outputDirectory, "security-seed-reconnect-result.json");
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
    return resultPath;
}

async function main(): Promise<void> {
    if (process.env.E2E_OBSIDIAN_KEEP_VAULT === "true" || process.env.E2E_OBSIDIAN_KEEP_COUCHDB === "true") {
        throw new Error("The Security Seed reconnect scenario requires strict Vault, profile, and database cleanup.");
    }

    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }
    const artifactRoot = resolve(process.env.E2E_OBSIDIAN_ARTIFACT_ROOT ?? process.cwd());
    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "security-seed-reconnect");
    const context: RunnerContext = {
        binary,
        cliBinary: cli.binary,
        artifactRoot,
        couchDb,
        dbName,
        activeSessions: new Set(),
        allSessions: [],
        screenshots: [],
    };
    const vaults: TemporaryVault[] = [];
    let databaseCreated = false;
    let evidence: ScenarioEvidence | undefined;
    let scenarioError: unknown;
    let teardown: TeardownEvidence | undefined;
    let teardownError: unknown;

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);
        databaseCreated = true;
        vaults.push(await createTemporaryVault("obsidian-livesync-security-seed-a-"));
        vaults.push(await createTemporaryVault("obsidian-livesync-security-seed-b-"));
        evidence = await runScenario(context, vaults[0], vaults[1]);
    } catch (error) {
        scenarioError = error;
    } finally {
        try {
            teardown = await cleanupResources(context, vaults, databaseCreated);
        } catch (error) {
            teardownError = error;
        }
    }

    if (scenarioError !== undefined || teardownError !== undefined) {
        const errors = [scenarioError, teardownError].filter((error) => error !== undefined);
        if (errors.length === 1) {
            throw errors[0];
        }
        throw new MultipleErrors("Security Seed reconnect scenario and teardown both failed.", errors);
    }
    if (!evidence || !teardown) {
        throw new Error("Security Seed reconnect evidence was not produced.");
    }

    const result = {
        scenario: "security-seed-reconnect",
        ...evidence,
        teardown,
        limitations: {
            platformCommonRealObsidian: true,
            iPadOsBackgroundReconnect: false,
            androidDeviceLifecycle: false,
        },
    };
    const resultPath = await writeResult(result);
    console.log(`Security Seed E2E result: ${resultPath}`);
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
