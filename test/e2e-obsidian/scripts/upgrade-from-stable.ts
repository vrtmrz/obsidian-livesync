import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchAllCouchDbDocs,
    fetchCouchDbDatabaseInfo,
    fetchCouchDbLocalDocs,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    type CouchDbConfig,
    type CouchDbDatabaseInfo,
    type CouchDbDocument,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    configureCouchDb,
    configureObjectStorage,
    createE2eCouchDbPluginData,
    createE2eObjectStoragePluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import {
    deleteObjectStoragePrefix,
    ensureObjectStorageBucket,
    listObjectStorageObjects,
    loadObjectStorageConfig,
    makeUniqueBucketPrefix,
    readObjectStorageJson,
    type ObjectStorageConfig,
} from "../runner/objectStorage.ts";
import { ensurePinnedReleaseArtifact, UPGRADE_SOURCE_RELEASE } from "../runner/releaseArtifact.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import {
    assertCouchDbCheckpointContinuity,
    assertCouchDbDocumentsUnchanged,
    assertJournalCheckpointAdvanced,
    assertJournalCheckpointLoaded,
    assertMilestoneContinuity,
    assertNoJournalReplay,
    assertSomeCouchDbCheckpointAdvanced,
    type CouchDbCheckpointSnapshot,
    type CouchDbDocumentRevision,
    type MilestoneIdentity,
    type RemoteObjectSnapshot,
} from "../runner/upgradeContinuity.ts";
import {
    assertStableReleaseDefaults,
    assertStableRemoteSelection,
    assertUnconfiguredUpgradeReady,
    assertUnconfiguredUpgradeRestarted,
    assertUpgradeCompatibilityReady,
    assertUpgradeRemainsReady,
    configureStableRelease,
    createPostUpgradeDelta,
    createUpgradeScenarioPaths,
    createVerifierReturnDelta,
    dismissConfigDoctorIfShown,
    prepareStableRemote,
    readJournalCheckpoint,
    readLocalCouchDbCheckpoints,
    readRuntimeUpgradeState,
    readRuntimeSettingsUpgradeState,
    runCouchDbReplicationObserved,
    runJournalReplicationObserved,
    runStableFileHistory,
    STABLE_RELEASE_VERSION,
    verifyPostUpgradeHistory,
    verifyPreUpgradeHistory,
    verifyReturnDelta,
    waitForPersistentNodeIdentity,
    type CouchDbReplicationObservation,
    type RuntimeUpgradeState,
    type UpgradeTransportConfiguration,
} from "../runner/upgradeWorkflow.ts";
import { obsidianRemoteDebuggingPort } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "90000";

type Transport = "couchdb" | "object-storage";

type RemoteMilestone = CouchDbDocument & {
    created?: unknown;
    locked?: unknown;
    accepted_nodes?: unknown;
    tweak_values?: unknown;
};

type CouchDbRemoteSnapshot = {
    checkpoints: CouchDbCheckpointSnapshot[];
    documents: CouchDbDocumentRevision[];
    info: CouchDbDatabaseInfo;
    milestone: MilestoneIdentity;
    preferredTweaks: Record<string, unknown>;
};

type ObjectStorageRemoteSnapshot = {
    journalObjects: RemoteObjectSnapshot[];
    milestone: MilestoneIdentity;
    preferredTweaks: Record<string, unknown>;
};

type RunnerContext = {
    binary: string;
    cliBinary: string;
    sourceArtifactRoot: string;
    targetArtifactRoot: string;
    targetVersion: string;
    activeSessions: Set<ObsidianLiveSyncSession>;
};

type ParsedArguments = {
    transports: Transport[];
    manageServices: boolean;
    keepServices: boolean;
};

type StartSessionOptions = {
    pluginData?: Record<string, unknown>;
    localStorageEntries?: Readonly<Record<string, string>>;
    waitForCoreReady?: boolean;
};

const MILESTONE_ID = "_local/obsydian_livesync_milestone";
const JOURNAL_MILESTONE_NAME = "_00000000-milestone.json";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
}

function parseArguments(argv: readonly string[]): ParsedArguments {
    let transportValue = "all";
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--transport") {
            transportValue = argv[index + 1] ?? "";
            index++;
        } else if (argument.startsWith("--transport=")) {
            transportValue = argument.slice("--transport=".length);
        }
    }
    const transports: Transport[] =
        transportValue === "all"
            ? ["couchdb", "object-storage"]
            : transportValue === "couchdb" || transportValue === "object-storage"
              ? [transportValue]
              : (() => {
                    throw new Error(`Unsupported transport '${transportValue}'. Use couchdb, object-storage, or all.`);
                })();
    return {
        transports,
        manageServices: argv.includes("--manage-services"),
        keepServices: argv.includes("--keep-services"),
    };
}

function sessionEnvironment(port: number): NodeJS.ProcessEnv {
    return { ...process.env, E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT: String(port) };
}

function sessionPorts(): readonly [number, number] {
    const first = obsidianRemoteDebuggingPort(process.env);
    const second = Number(process.env.E2E_OBSIDIAN_SECONDARY_REMOTE_DEBUGGING_PORT ?? first + 1);
    if (!Number.isInteger(second) || second < 1 || second > 65535 || second === first) {
        throw new Error(`Invalid secondary Obsidian remote debugging port: ${second}`);
    }
    return [first, second];
}

function npmBinary(): string {
    return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runNpmScript(name: string, optional = false): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        console.log(`\n# ${name}`);
        const child = spawn(npmBinary(), ["run", name], {
            cwd: process.cwd(),
            env: process.env,
            stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code, signal) => {
            if (code === 0 || optional) {
                if (code !== 0) {
                    console.warn(`${name} did not complete cleanly (${signal ? `signal ${signal}` : `exit ${code}`}).`);
                }
                resolvePromise();
                return;
            }
            reject(new Error(`${name} failed (${signal ? `signal ${signal}` : `exit ${code}`}).`));
        });
    });
}

async function validateTargetArtifact(root: string): Promise<string> {
    await Promise.all(
        ["main.js", "manifest.json", "styles.css"].map(async (name) => await access(resolve(root, name)))
    );
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as {
        id?: unknown;
        version?: unknown;
    };
    assertEqual(manifest.id, UPGRADE_SOURCE_RELEASE.pluginId, "The target artefact has an unexpected plug-in id.");
    assert(typeof manifest.version === "string" && manifest.version.length > 0, "The target manifest has no version.");
    assert(
        manifest.version !== STABLE_RELEASE_VERSION,
        `The target artefact is still the source release ${STABLE_RELEASE_VERSION}.`
    );
    return manifest.version;
}

async function startSession(
    context: RunnerContext,
    vault: TemporaryVault,
    port: number,
    artifactRoot: string,
    options: StartSessionOptions = {}
): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        artifactRoot,
        pluginData: options.pluginData,
        localStorageEntries: options.localStorageEntries,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        env: sessionEnvironment(port),
    });
    context.activeSessions.add(session);
    try {
        if (options.waitForCoreReady !== false) {
            await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
        }
        return session;
    } catch (error) {
        await stopSession(context, session).catch(() => undefined);
        throw error;
    }
}

async function readStoredPluginData(vault: TemporaryVault): Promise<Record<string, unknown>> {
    const path = resolve(vault.path, ".obsidian", "plugins", "obsidian-livesync", "data.json");
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function writeStoredPluginData(vault: TemporaryVault, data: Record<string, unknown>): Promise<void> {
    const path = resolve(vault.path, ".obsidian", "plugins", "obsidian-livesync", "data.json");
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function runUnconfiguredSettingsUpgrade(context: RunnerContext, port: number): Promise<void> {
    console.log(`\n# Upgrade from ${STABLE_RELEASE_VERSION}: unconfigured legacy settings`);
    const vault = await createTemporaryVault("obsidian-livesync-upgrade-unconfigured-");

    try {
        let session = await startSession(context, vault, port, context.sourceArtifactRoot, {
            pluginData: { liveSync: false },
            waitForCoreReady: false,
        });
        const stableState = await readRuntimeSettingsUpgradeState(context.cliBinary, session.cliEnv);
        assertStableReleaseDefaults(stableState, false);
        await stopSession(context, session);

        const stableData = await readStoredPluginData(vault);
        if (stableData.isConfigured !== undefined) {
            assertEqual(
                stableData.isConfigured,
                false,
                "The stable release persisted a configured state for its default-equivalent settings."
            );
        }

        // 0.25.83 infers the runtime boolean, but persistence depends on an
        // unrelated settings-save event. Restore the pre-flag document
        // explicitly so the target proves the direct legacy migration in
        // either case rather than depending on that timing.
        await writeStoredPluginData(vault, { liveSync: false });

        session = await startSession(context, vault, port, context.targetArtifactRoot, {
            waitForCoreReady: false,
        });
        const upgradedState = await readRuntimeSettingsUpgradeState(context.cliBinary, session.cliEnv);
        assertUnconfiguredUpgradeReady(stableState, upgradedState, context.targetVersion);
        await stopSession(context, session);

        const migratedData = await readStoredPluginData(vault);
        assertEqual(migratedData.isConfigured, false, "The inferred unconfigured state was not saved.");
        assertEqual(
            migratedData.handleFilenameCaseSensitive,
            false,
            "The inferred case-insensitive setting was not saved."
        );

        session = await startSession(context, vault, port, context.targetArtifactRoot, {
            waitForCoreReady: false,
        });
        const restartedState = await readRuntimeSettingsUpgradeState(context.cliBinary, session.cliEnv);
        assertUnconfiguredUpgradeRestarted(restartedState, context.targetVersion);
        await stopSession(context, session);

        console.log(
            `PASS unconfigured settings: ${STABLE_RELEASE_VERSION} -> ${context.targetVersion}; legacy inference, persistence, and restart idempotence verified.`
        );
    } finally {
        await stopSessions(context);
        await vault.dispose();
    }
}

async function stopSession(context: RunnerContext, session: ObsidianLiveSyncSession): Promise<void> {
    if (!context.activeSessions.has(session)) return;
    await session.app.stop();
    context.activeSessions.delete(session);
}

async function stopSessions(context: RunnerContext): Promise<void> {
    for (const session of [...context.activeSessions]) await stopSession(context, session);
}

function milestoneIdentity(document: RemoteMilestone): MilestoneIdentity {
    assert(document.created !== undefined && document.created !== null, "The remote milestone has no generation.");
    assert(typeof document.locked === "boolean", "The remote milestone has no lock state.");
    assert(Array.isArray(document.accepted_nodes), "The remote milestone has no accepted-device list.");
    assert(
        document.accepted_nodes.every((value) => typeof value === "string"),
        "The remote milestone accepted-device list is malformed."
    );
    return {
        created: document.created,
        locked: document.locked,
        acceptedNodes: document.accepted_nodes,
    };
}

function preferredTweaks(document: RemoteMilestone): Record<string, unknown> {
    const values = document.tweak_values;
    assert(values !== null && typeof values === "object" && !Array.isArray(values), "The remote has no tweak map.");
    const preferred = (values as Record<string, unknown>).PREFERRED;
    assert(
        preferred !== null && typeof preferred === "object" && !Array.isArray(preferred),
        "The remote has no preferred tweak settings."
    );
    return { ...(preferred as Record<string, unknown>) };
}

async function readCouchDbRemoteSnapshot(config: CouchDbConfig, databaseName: string): Promise<CouchDbRemoteSnapshot> {
    const [allDocs, localDocs, info] = await Promise.all([
        fetchAllCouchDbDocs(config, databaseName),
        fetchCouchDbLocalDocs(config, databaseName),
        fetchCouchDbDatabaseInfo(config, databaseName),
    ]);
    const milestone = localDocs.rows.find(({ id }) => id === MILESTONE_ID)?.doc as RemoteMilestone | undefined;
    assert(milestone, "The CouchDB remote milestone is missing.");
    const checkpoints = localDocs.rows.flatMap(({ id, doc }) =>
        doc && Object.prototype.hasOwnProperty.call(doc, "last_seq") ? [{ id, lastSequence: doc.last_seq }] : []
    );
    const documents = allDocs.rows.map(({ id, value }) => ({
        id,
        revision: value.rev,
        deleted: value.deleted === true,
    }));
    return {
        checkpoints,
        documents,
        info,
        milestone: milestoneIdentity(milestone),
        preferredTweaks: preferredTweaks(milestone),
    };
}

async function readObjectStorageRemoteSnapshot(
    config: ObjectStorageConfig,
    prefix: string
): Promise<ObjectStorageRemoteSnapshot> {
    const [objects, milestone] = await Promise.all([
        listObjectStorageObjects(config, prefix),
        readObjectStorageJson<RemoteMilestone>(config, `${prefix}${JOURNAL_MILESTONE_NAME}`),
    ]);
    const journalObjects = objects.flatMap((object) => {
        if (!object.Key || basename(object.Key).startsWith("_")) return [];
        return [
            {
                key: object.Key,
                size: object.Size ?? 0,
                etag: object.ETag ?? "",
            },
        ];
    });
    return {
        journalObjects,
        milestone: milestoneIdentity(milestone),
        preferredTweaks: preferredTweaks(milestone),
    };
}

function assertNoOpCouchDbObservation(observation: CouchDbReplicationObservation): void {
    assert(observation.succeeded, "The first post-upgrade CouchDB synchronisation failed.");
    assertEqual(observation.sentDocuments, 0, "The no-op CouchDB synchronisation resent documents.");
    assertEqual(observation.arrivedDocuments, 0, "The no-op CouchDB synchronisation refetched documents.");
}

function assertNoOpCouchDbDatabase(before: CouchDbRemoteSnapshot, after: CouchDbRemoteSnapshot): void {
    assertCouchDbCheckpointContinuity(before.checkpoints, after.checkpoints);
    assertCouchDbDocumentsUnchanged(before.documents, after.documents);
    assertEqual(
        after.info.update_seq,
        before.info.update_seq,
        "The no-op CouchDB synchronisation advanced update_seq."
    );
    assertEqual(after.info.doc_count, before.info.doc_count, "The no-op CouchDB synchronisation changed doc_count.");
    assertMilestoneContinuity(before.milestone, after.milestone);
}

function assertRestartContinuity(before: RuntimeUpgradeState, after: RuntimeUpgradeState): void {
    assertEqual(after.localDatabaseName, before.localDatabaseName, "Restart opened a different local database.");
    assertEqual(after.nodeId, before.nodeId, "Restart changed the device node identity.");
    assertEqual(
        after.settings.activeConfigurationId,
        before.settings.activeConfigurationId,
        "Restart changed the active remote profile."
    );
}

async function configureFreshCouchDbVerifier(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    config: CouchDbConfig,
    databaseName: string,
    tweaks: Record<string, unknown>
): Promise<void> {
    await configureCouchDb(
        context.cliBinary,
        session.cliEnv,
        { uri: config.uri, username: config.username, password: config.password, dbName: databaseName },
        tweaks
    );
    await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
    await prepareRemote(context.cliBinary, session.cliEnv);
}

async function configureFreshObjectStorageVerifier(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    config: ObjectStorageConfig,
    prefix: string,
    tweaks: Record<string, unknown>
): Promise<void> {
    await configureObjectStorage(context.cliBinary, session.cliEnv, { ...config, bucketPrefix: prefix }, tweaks);
    await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
    await prepareRemote(context.cliBinary, session.cliEnv);
}

async function runCouchDbUpgrade(context: RunnerContext, ports: readonly [number, number]): Promise<void> {
    console.log(`\n# Upgrade from ${STABLE_RELEASE_VERSION}: CouchDB`);
    const config = await loadCouchDbConfig();
    const databaseName = makeUniqueDatabaseName(config.dbPrefix, "upgrade-from-stable");
    const remote: UpgradeTransportConfiguration = { kind: "couchdb", config, databaseName };
    const paths = createUpgradeScenarioPaths("couchdb");
    const upgradeVault = await createTemporaryVault("obsidian-livesync-upgrade-couchdb-");
    const verifierVault = await createTemporaryVault("obsidian-livesync-upgrade-couchdb-verifier-");
    let upgradedSession: ObsidianLiveSyncSession | undefined;

    try {
        await assertCouchDbReachable(config);
        await createCouchDbDatabase(config, databaseName);

        let session = await startSession(context, upgradeVault, ports[0], context.sourceArtifactRoot);
        assertStableReleaseDefaults(await readRuntimeUpgradeState(context.cliBinary, session.cliEnv), false);
        await configureStableRelease(context.cliBinary, session.cliEnv, remote);
        const configuredStable = await readRuntimeUpgradeState(context.cliBinary, session.cliEnv);
        assertStableReleaseDefaults(configuredStable, true);
        assertStableRemoteSelection(configuredStable, remote);
        await stopSession(context, session);

        session = await startSession(context, upgradeVault, ports[0], context.sourceArtifactRoot);
        const restartedStable = await readRuntimeUpgradeState(context.cliBinary, session.cliEnv);
        assertStableReleaseDefaults(restartedStable, true);
        assertStableRemoteSelection(restartedStable, remote);
        await waitForPersistentNodeIdentity(context.cliBinary, session.cliEnv);
        await prepareStableRemote(context.cliBinary, session.cliEnv);
        await runStableFileHistory(context.cliBinary, session.cliEnv, paths, async () => {
            const result = await runCouchDbReplicationObserved(context.cliBinary, session.cliEnv);
            assert(result.succeeded, "The stable CouchDB synchronisation failed.");
        });
        await verifyPreUpgradeHistory(upgradeVault, paths);

        const stableState = await readRuntimeUpgradeState(context.cliBinary, session.cliEnv);
        const stableRemote = await readCouchDbRemoteSnapshot(config, databaseName);
        const stableLocalCheckpoints = await readLocalCouchDbCheckpoints(
            context.cliBinary,
            session.cliEnv,
            stableRemote.checkpoints.map(({ id }) => id)
        );
        assertCouchDbCheckpointContinuity(stableRemote.checkpoints, stableLocalCheckpoints);
        await stopSession(context, session);

        session = await startSession(context, upgradeVault, ports[0], context.targetArtifactRoot);
        upgradedSession = session;
        await dismissConfigDoctorIfShown(session.remoteDebuggingPort);
        const upgradedState = await readRuntimeUpgradeState(context.cliBinary, session.cliEnv);
        assertUpgradeCompatibilityReady(stableState, upgradedState, context.targetVersion, remote);
        await verifyPreUpgradeHistory(upgradeVault, paths);

        const loadedLocalCheckpoints = await readLocalCouchDbCheckpoints(
            context.cliBinary,
            session.cliEnv,
            stableRemote.checkpoints.map(({ id }) => id)
        );
        assertCouchDbCheckpointContinuity(stableLocalCheckpoints, loadedLocalCheckpoints);
        const noOpObservation = await runCouchDbReplicationObserved(context.cliBinary, session.cliEnv);
        assertNoOpCouchDbObservation(noOpObservation);
        const noOpRemote = await readCouchDbRemoteSnapshot(config, databaseName);
        assertNoOpCouchDbDatabase(stableRemote, noOpRemote);

        await createPostUpgradeDelta(context.cliBinary, session.cliEnv, paths);
        const deltaObservation = await runCouchDbReplicationObserved(context.cliBinary, session.cliEnv);
        assert(deltaObservation.succeeded, "The post-upgrade CouchDB delta failed.");
        assert(deltaObservation.sentDocuments > 0, "The post-upgrade CouchDB delta sent no documents.");
        const deltaRemote = await readCouchDbRemoteSnapshot(config, databaseName);
        assertSomeCouchDbCheckpointAdvanced(noOpRemote.checkpoints, deltaRemote.checkpoints);
        assertMilestoneContinuity(noOpRemote.milestone, deltaRemote.milestone);

        const verifierSettings = {
            uri: config.uri,
            username: config.username,
            password: config.password,
            dbName: databaseName,
        };
        const verifier = await startSession(context, verifierVault, ports[1], context.targetArtifactRoot, {
            pluginData: createE2eCouchDbPluginData(verifierSettings, deltaRemote.preferredTweaks),
            localStorageEntries: createE2eObsidianDeviceLocalState(verifierVault.name),
        });
        await configureFreshCouchDbVerifier(context, verifier, config, databaseName, deltaRemote.preferredTweaks);
        await pushLocalChanges(context.cliBinary, verifier.cliEnv);
        await verifyPostUpgradeHistory(verifierVault, paths);
        await createVerifierReturnDelta(context.cliBinary, verifier.cliEnv, paths);
        await pushLocalChanges(context.cliBinary, verifier.cliEnv);

        const returnObservation = await runCouchDbReplicationObserved(context.cliBinary, session.cliEnv);
        assert(returnObservation.succeeded, "The upgraded CouchDB device could not receive the verifier delta.");
        assert(returnObservation.arrivedDocuments > 0, "The verifier CouchDB delta did not arrive.");
        await verifyReturnDelta(upgradeVault, paths);
        await stopSession(context, verifier);
        await stopSession(context, session);
        upgradedSession = undefined;

        const restarted = await startSession(context, upgradeVault, ports[0], context.targetArtifactRoot);
        const restartedState = await readRuntimeUpgradeState(context.cliBinary, restarted.cliEnv);
        assertUpgradeRemainsReady(restartedState, context.targetVersion);
        assertRestartContinuity(upgradedState, restartedState);
        await verifyReturnDelta(upgradeVault, paths);
        await stopSession(context, restarted);

        console.log(
            `PASS CouchDB: ${STABLE_RELEASE_VERSION} -> ${context.targetVersion}; checkpoint lineage, no-op sync, delta sync, fresh-device round-trip, and restart continuity verified.`
        );
    } finally {
        if (upgradedSession) await stopSession(context, upgradedSession).catch(() => undefined);
        await stopSessions(context);
        await Promise.all([upgradeVault.dispose(), verifierVault.dispose()]);
        if (process.env.E2E_OBSIDIAN_KEEP_COUCHDB !== "true") {
            await deleteCouchDbDatabase(config, databaseName).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

async function runObjectStorageUpgrade(context: RunnerContext, ports: readonly [number, number]): Promise<void> {
    console.log(`\n# Upgrade from ${STABLE_RELEASE_VERSION}: Object Storage`);
    const config = await loadObjectStorageConfig();
    const prefix = makeUniqueBucketPrefix("upgrade-from-stable");
    const remote: UpgradeTransportConfiguration = { kind: "object-storage", config, bucketPrefix: prefix };
    const paths = createUpgradeScenarioPaths("object-storage");
    const upgradeVault = await createTemporaryVault("obsidian-livesync-upgrade-object-storage-");
    const verifierVault = await createTemporaryVault("obsidian-livesync-upgrade-object-storage-verifier-");
    let upgradedSession: ObsidianLiveSyncSession | undefined;

    try {
        await ensureObjectStorageBucket(config);

        let session = await startSession(context, upgradeVault, ports[0], context.sourceArtifactRoot);
        assertStableReleaseDefaults(await readRuntimeUpgradeState(context.cliBinary, session.cliEnv), false);
        await configureStableRelease(context.cliBinary, session.cliEnv, remote);
        const configuredStable = await readRuntimeUpgradeState(context.cliBinary, session.cliEnv);
        assertStableReleaseDefaults(configuredStable, true);
        assertStableRemoteSelection(configuredStable, remote);
        await stopSession(context, session);

        session = await startSession(context, upgradeVault, ports[0], context.sourceArtifactRoot);
        const restartedStable = await readRuntimeUpgradeState(context.cliBinary, session.cliEnv);
        assertStableReleaseDefaults(restartedStable, true);
        assertStableRemoteSelection(restartedStable, remote);
        await waitForPersistentNodeIdentity(context.cliBinary, session.cliEnv);
        await prepareStableRemote(context.cliBinary, session.cliEnv);
        await runStableFileHistory(context.cliBinary, session.cliEnv, paths, async () => {
            const result = await runJournalReplicationObserved(context.cliBinary, session.cliEnv);
            assert(
                result.succeeded,
                `The stable Object Storage synchronisation failed.\nObservation: ${JSON.stringify(result)}`
            );
        });
        await verifyPreUpgradeHistory(upgradeVault, paths);

        const stableState = await readRuntimeUpgradeState(context.cliBinary, session.cliEnv);
        const stableCheckpoint = await readJournalCheckpoint(context.cliBinary, session.cliEnv);
        const stableRemote = await readObjectStorageRemoteSnapshot(config, prefix);
        await stopSession(context, session);

        session = await startSession(context, upgradeVault, ports[0], context.targetArtifactRoot);
        upgradedSession = session;
        await dismissConfigDoctorIfShown(session.remoteDebuggingPort);
        const upgradedState = await readRuntimeUpgradeState(context.cliBinary, session.cliEnv);
        assertUpgradeCompatibilityReady(stableState, upgradedState, context.targetVersion, remote);
        await verifyPreUpgradeHistory(upgradeVault, paths);

        const loadedCheckpoint = await readJournalCheckpoint(context.cliBinary, session.cliEnv);
        assertJournalCheckpointLoaded(stableCheckpoint, loadedCheckpoint);
        const noOpObservation = await runJournalReplicationObserved(context.cliBinary, session.cliEnv);
        assert(noOpObservation.succeeded, "The first post-upgrade Object Storage synchronisation failed.");
        const noOpCheckpoint = await readJournalCheckpoint(context.cliBinary, session.cliEnv);
        const noOpRemote = await readObjectStorageRemoteSnapshot(config, prefix);
        assertNoJournalReplay(
            stableCheckpoint,
            noOpCheckpoint,
            stableRemote.journalObjects,
            noOpRemote.journalObjects,
            noOpObservation
        );
        assertMilestoneContinuity(stableRemote.milestone, noOpRemote.milestone);

        await createPostUpgradeDelta(context.cliBinary, session.cliEnv, paths);
        const deltaObservation = await runJournalReplicationObserved(context.cliBinary, session.cliEnv);
        assert(deltaObservation.succeeded, "The post-upgrade Object Storage delta failed.");
        const deltaCheckpoint = await readJournalCheckpoint(context.cliBinary, session.cliEnv);
        assertJournalCheckpointAdvanced(noOpCheckpoint, deltaCheckpoint, deltaObservation);
        const deltaRemote = await readObjectStorageRemoteSnapshot(config, prefix);
        assertMilestoneContinuity(noOpRemote.milestone, deltaRemote.milestone);

        const verifierSettings = { ...config, bucketPrefix: prefix };
        const verifier = await startSession(context, verifierVault, ports[1], context.targetArtifactRoot, {
            pluginData: createE2eObjectStoragePluginData(verifierSettings, deltaRemote.preferredTweaks),
            localStorageEntries: createE2eObsidianDeviceLocalState(verifierVault.name),
        });
        await configureFreshObjectStorageVerifier(context, verifier, config, prefix, deltaRemote.preferredTweaks);
        await pushLocalChanges(context.cliBinary, verifier.cliEnv);
        await verifyPostUpgradeHistory(verifierVault, paths);
        await createVerifierReturnDelta(context.cliBinary, verifier.cliEnv, paths);
        await pushLocalChanges(context.cliBinary, verifier.cliEnv);

        const returnObservation = await runJournalReplicationObserved(context.cliBinary, session.cliEnv);
        assert(returnObservation.succeeded, "The upgraded Object Storage device could not receive the verifier delta.");
        assert(returnObservation.downloadedJournalKeys.length > 0, "The verifier Object Storage delta did not arrive.");
        await verifyReturnDelta(upgradeVault, paths);
        await stopSession(context, verifier);
        await stopSession(context, session);
        upgradedSession = undefined;

        const restarted = await startSession(context, upgradeVault, ports[0], context.targetArtifactRoot);
        const restartedState = await readRuntimeUpgradeState(context.cliBinary, restarted.cliEnv);
        assertUpgradeRemainsReady(restartedState, context.targetVersion);
        assertRestartContinuity(upgradedState, restartedState);
        await verifyReturnDelta(upgradeVault, paths);
        await stopSession(context, restarted);

        console.log(
            `PASS Object Storage: ${STABLE_RELEASE_VERSION} -> ${context.targetVersion}; checkpoint lineage, no replay, delta sync, fresh-device round-trip, and restart continuity verified.`
        );
    } finally {
        if (upgradedSession) await stopSession(context, upgradedSession).catch(() => undefined);
        await stopSessions(context);
        await Promise.all([upgradeVault.dispose(), verifierVault.dispose()]);
        if (process.env.E2E_OBSIDIAN_KEEP_OBJECT_STORAGE !== "true") {
            await deleteObjectStoragePrefix(config, prefix).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

async function startManagedServices(transports: readonly Transport[]): Promise<void> {
    if (transports.includes("couchdb")) {
        await runNpmScript("test:docker-couchdb:stop", true);
        await runNpmScript("test:docker-couchdb:start");
    }
    if (transports.includes("object-storage")) {
        await runNpmScript("test:docker-s3:stop", true);
        await runNpmScript("test:docker-s3:start");
    }
}

async function stopManagedServices(transports: readonly Transport[]): Promise<void> {
    if (transports.includes("object-storage")) await runNpmScript("test:docker-s3:stop", true);
    if (transports.includes("couchdb")) await runNpmScript("test:docker-couchdb:stop", true);
}

async function main(): Promise<void> {
    const arguments_ = parseArguments(process.argv.slice(2));
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);

    const targetArtifactRoot = resolve(process.env.E2E_LIVESYNC_TARGET_ARTIFACT_ROOT?.trim() || process.cwd());
    const targetVersion = await validateTargetArtifact(targetArtifactRoot);
    const sourceArtifactRoot = await ensurePinnedReleaseArtifact();
    const context: RunnerContext = {
        binary,
        cliBinary: cli.binary,
        sourceArtifactRoot,
        targetArtifactRoot,
        targetVersion,
        activeSessions: new Set(),
    };
    const ports = sessionPorts();
    let managedServicesStarted = false;

    console.log(`Using exact source release: ${STABLE_RELEASE_VERSION}`);
    console.log(`Using target release candidate: ${targetVersion}`);
    console.log(`Source artefact cache: ${sourceArtifactRoot}`);
    console.log(`Target artefact root: ${targetArtifactRoot}`);

    try {
        await runUnconfiguredSettingsUpgrade(context, ports[0]);
        if (arguments_.manageServices) {
            await startManagedServices(arguments_.transports);
            managedServicesStarted = true;
        }
        for (const transport of arguments_.transports) {
            if (transport === "couchdb") await runCouchDbUpgrade(context, ports);
            else await runObjectStorageUpgrade(context, ports);
        }
    } finally {
        await stopSessions(context);
        if (managedServicesStarted && !arguments_.keepServices) {
            await stopManagedServices(arguments_.transports);
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
