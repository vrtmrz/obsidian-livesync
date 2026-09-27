import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { VERSIONING_DOCID } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchCouchDbDocument,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    putCouchDbDocument,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertE2eCompatibilityMarker,
    configureCouchDb,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const acceptedPath = "E2E/remote-feature/accepted.md";
const acceptedContent = "Accepted before the remote feature changed.\n";
const unknownFeature = "future-format-v7";

type FeatureState = {
    version: number | null;
    features: string[];
    snapshotFeatures: string[];
    snapshotDatabaseId: string | null;
    databaseId: string | null;
    hasActiveReplicator: boolean;
};

async function readFeatureState(cliBinary: string, env: NodeJS.ProcessEnv): Promise<FeatureState> {
    return await evalObsidianJson<FeatureState>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `const id=${JSON.stringify(VERSIONING_DOCID)};`,
            "const info=await core.localDatabase.getRaw(id).catch(()=>null);",
            "const snapshot=await core.kvDB.get('replicationResultProcessorSnapshot');",
            "const databaseId=await core.localDatabase.localDatabase.id();",
            "return JSON.stringify({",
            "version:typeof info?.version==='number'?info.version:null,",
            "features:Array.isArray(info?.used_features)?info.used_features:[],",
            "snapshotFeatures:Array.isArray(snapshot?.observedFeatures)?snapshot.observedFeatures:[],",
            "snapshotDatabaseId:snapshot?.databaseId??null,",
            "databaseId,",
            "hasActiveReplicator:!!core.services.replicator.getActiveReplicator(),",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function waitForState(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    predicate: (state: FeatureState) => boolean,
    description: string
): Promise<FeatureState> {
    const deadline = Date.now() + 20_000;
    let state = await readFeatureState(cliBinary, env);
    while (!predicate(state) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        state = await readFeatureState(cliBinary, env);
    }
    if (!predicate(state)) throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(state)}`);
    return state;
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "remote-feature-change");
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);
        const couchDbSettings = {
            uri: couchDb.uri,
            username: couchDb.username,
            password: couchDb.password,
            dbName,
        };
        const settings = {
            encrypt: false,
            usePathObfuscation: false,
            encryptInternalMetadata: false,
            liveSync: false,
        };
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: createE2eCouchDbPluginData(couchDbSettings, settings),
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await assertE2eCompatibilityMarker(cli.binary, session.cliEnv);
        await configureCouchDb(cli.binary, session.cliEnv, couchDbSettings, settings);
        await prepareRemote(cli.binary, session.cliEnv);

        const fullPath = join(vault.path, acceptedPath);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, acceptedContent, "utf-8");
        await waitForLocalDatabaseEntry(cli.binary, session.cliEnv, acceptedPath);
        await pushLocalChanges(cli.binary, session.cliEnv);

        const initialVersion = await fetchCouchDbDocument(couchDb, dbName, VERSIONING_DOCID);
        if (initialVersion.version !== 12 || "used_features" in initialVersion) {
            throw new Error(
                `An inactive feature unexpectedly changed the remote contract: ${JSON.stringify(initialVersion)}`
            );
        }

        const start = await evalObsidianJson<{ status: string }>(
            cli.binary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "await core.services.setting.applyExternalSettings({liveSync:true},true);",
                "await core.services.control.applySettings();",
                "const result=await core.services.replication.startContinuous({trigger:'daemon',interaction:{kind:'forbidden'}});",
                "return JSON.stringify(result);",
                "})()",
            ].join(""),
            session.cliEnv
        );
        if (start.status !== "completed")
            throw new Error(`Continuous replication did not start: ${JSON.stringify(start)}`);
        await waitForState(cli.binary, session.cliEnv, (state) => state.hasActiveReplicator, "an active Replicator");

        await putCouchDbDocument(couchDb, dbName, {
            ...initialVersion,
            version: 13,
            used_features: [unknownFeature],
        });
        const observed = await waitForState(
            cli.binary,
            session.cliEnv,
            (state) =>
                state.version === 13 &&
                state.features.includes(unknownFeature) &&
                state.snapshotFeatures.includes(unknownFeature) &&
                !state.hasActiveReplicator,
            "the live feature change, durable observation, and Replicator retirement"
        );

        const replicated = await evalObsidianJson<boolean>(
            cli.binary,
            "(async()=>JSON.stringify(!!(await app.plugins.plugins['obsidian-livesync'].core.services.replication.replicate(true))))()",
            session.cliEnv
        );
        if (replicated) throw new Error("An unknown remote feature was admitted for another replication.");
        const acceptedAfterStop = await readFile(fullPath, "utf-8");
        if (acceptedAfterStop !== acceptedContent)
            throw new Error("Previously accepted Vault content changed on stop.");

        // Shorten both visible lists so only the snapshot can retain the observed requirement.
        const shortenedRemoteVersion = await fetchCouchDbDocument(couchDb, dbName, VERSIONING_DOCID);
        await putCouchDbDocument(couchDb, dbName, { ...shortenedRemoteVersion, used_features: [] });
        const shortenedLocalFeatures = await evalObsidianJson<string[]>(
            cli.binary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                `const id=${JSON.stringify(VERSIONING_DOCID)};`,
                "const info=await core.localDatabase.getRaw(id);",
                "await core.localDatabase.putRaw({...info,used_features:[]});",
                "return JSON.stringify((await core.localDatabase.getRaw(id)).used_features);",
                "})()",
            ].join(""),
            session.cliEnv
        );
        if (shortenedLocalFeatures.length !== 0)
            throw new Error("The local control document did not shorten for the restart scenario.");

        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary: cli.binary, vault });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        const afterRestart = await waitForState(
            cli.binary,
            session.cliEnv,
            (state) =>
                state.version === 13 && state.features.length === 0 && state.snapshotFeatures.includes(unknownFeature),
            "the retained unknown feature after restart"
        );
        if (afterRestart.snapshotDatabaseId !== afterRestart.databaseId)
            throw new Error("The retained feature observation belongs to a different physical database.");
        const replicatedAfterRestart = await evalObsidianJson<boolean>(
            cli.binary,
            "(async()=>JSON.stringify(!!(await app.plugins.plugins['obsidian-livesync'].core.services.replication.replicate(true))))()",
            session.cliEnv
        );
        const continuousAfterRestart = await evalObsidianJson<{ status: string }>(
            cli.binary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "const result=await core.services.replication.startContinuous({trigger:'daemon',interaction:{kind:'forbidden'}});",
                "return JSON.stringify(result);",
                "})()",
            ].join(""),
            session.cliEnv
        );
        if (replicatedAfterRestart || continuousAfterRestart.status !== "blocked")
            throw new Error(
                `Replication resumed after restart despite a previously observed unknown feature: ${JSON.stringify({ afterRestart, replicatedAfterRestart, continuousAfterRestart })}`
            );
        if ((await readFile(fullPath, "utf-8")) !== acceptedContent)
            throw new Error("Previously accepted Vault content changed after restart.");
        console.log(
            `Active feature change retired the Replicator; a shortened control document did not clear the block after restart: ${JSON.stringify({ observed, afterRestart })}`
        );
    } finally {
        await session?.app.stop();
        await vault.dispose();
        if (process.env.E2E_OBSIDIAN_KEEP_COUCHDB !== "true") {
            await deleteCouchDbDatabase(couchDb, dbName).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
