import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EVENT_APPLICATION_READY } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
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
    assertEqual,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ??= "20000";

const observerKey = "__livesyncE2eReceivedChangeReadiness";
const readyPath = "E2E/received-change-readiness/ready.md";
const suspendedPath = "E2E/received-change-readiness/suspended.md";
const readyContent = [
    "# Received before readiness",
    "",
    "This note is replicated into the target database before the application readiness event.",
    "Its content is longer than one configured chunk so the test uses the ordinary Chunk path.",
    "",
].join("\n");
const suspendedContent = [
    "# Received during explicit suspension",
    "",
    "This note remains queued while database reflecting is explicitly suspended.",
    "Resuming result application must reflect the received metadata and its stored Chunks.",
    "",
].join("\n");

type ReadinessObservation = {
    readinessEvents: number;
    content: string | null;
};

type CapturedNote = {
    entry: LocalDatabaseEntry;
    documents: CouchDbDocument[];
};

async function waitForVaultContent(
    vault: TemporaryVault,
    path: string,
    expected: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 10000)
): Promise<void> {
    const fullPath = join(vault.path, path);
    const deadline = Date.now() + timeoutMs;
    let lastContent: string | null = null;
    while (Date.now() < deadline) {
        try {
            lastContent = await readFile(fullPath, "utf8");
            if (lastContent === expected) return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${path} in the target Vault. Last content: ${String(lastContent)}`);
}

async function assertVaultPathStaysMissing(vault: TemporaryVault, path: string, durationMs: number): Promise<void> {
    const fullPath = join(vault.path, path);
    const deadline = Date.now() + durationMs;
    while (Date.now() < deadline) {
        try {
            const content = await readFile(fullPath, "utf8");
            throw new Error(`The suspended or unready document was reflected early at ${path}: ${content}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

async function createAndUploadNote(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    couchDb: CouchDbConfig,
    dbName: string,
    path: string,
    content: string
): Promise<CapturedNote> {
    const created = await evalObsidianJson<{ path: string; content: string }>(
        cliBinary,
        `(async()=>{const path=${JSON.stringify(path)};const folders=path.split('/');for(let i=1;i<folders.length;i++){const folder=folders.slice(0,i).join('/');if(!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);}const file=await app.vault.create(path,${JSON.stringify(content)});return JSON.stringify({path:file.path,content:await app.vault.read(file)});})()`,
        env
    );
    assertEqual(created.path, path, "Obsidian created the source note at an unexpected path.");
    assertEqual(created.content, content, "Obsidian did not read back the source note content.");
    const entry = await waitForLocalDatabaseEntry(cliBinary, env, path);
    if (entry.children.length === 0) throw new Error(`The source note did not create Chunks: ${path}`);
    await pushLocalChanges(cliBinary, env);
    await waitForCouchDbDocs(couchDb, dbName, (documents) => {
        const ids = new Set(documents.map((document) => document._id));
        return ids.has(entry.id) && entry.children.every((childId) => ids.has(childId));
    });
    const documents = await Promise.all(
        [...new Set([entry.id, ...entry.children])].map((documentId) =>
            fetchCouchDbDocument(couchDb, dbName, documentId)
        )
    );
    return { entry, documents };
}

async function injectCapturedNote(
    couchDb: CouchDbConfig,
    dbName: string,
    note: CapturedNote,
    publishedChunkIds: Set<string>
): Promise<void> {
    const chunks = note.documents.filter((document) => document._id !== note.entry.id);
    const metadata = note.documents.find((document) => document._id === note.entry.id);
    if (!metadata) throw new Error(`The source note metadata was not captured: ${note.entry.path}`);
    for (const document of chunks) {
        if (publishedChunkIds.has(document._id)) continue;
        const freshDocument = { ...document };
        delete freshDocument._rev;
        await putCouchDbDocument(couchDb, dbName, freshDocument);
        publishedChunkIds.add(document._id);
    }
    const freshMetadata = { ...metadata };
    delete freshMetadata._rev;
    await putCouchDbDocument(couchDb, dbName, freshMetadata);
}

async function installObserver(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson(
        cliBinary,
        [
            "(()=>{",
            `const key=${JSON.stringify(observerKey)};`,
            `const readyEvent=${JSON.stringify(EVENT_APPLICATION_READY)};`,
            "const previous=globalThis[key];",
            "if(previous) previous.unsubscribeReady?.();",
            "const state={readinessEvents:0,unsubscribeReady:null};",
            "state.unsubscribeReady=app.plugins.plugins['obsidian-livesync'].core.services.context.events.onEvent(readyEvent,()=>state.readinessEvents++);",
            "globalThis[key]=state;",
            "return JSON.stringify(true);",
            "})()",
        ].join(""),
        env
    );
}

async function readObservation(cliBinary: string, env: NodeJS.ProcessEnv, path: string): Promise<ReadinessObservation> {
    return await evalObsidianJson<ReadinessObservation>(
        cliBinary,
        [
            "(async()=>{",
            `const key=${JSON.stringify(observerKey)};`,
            `const path=${JSON.stringify(path)};`,
            "const state=globalThis[key];",
            "const file=app.vault.getAbstractFileByPath(path);",
            "return JSON.stringify({readinessEvents:state?.readinessEvents??0,content:file?await app.vault.read(file):null});",
            "})()",
        ].join(""),
        env
    );
}

async function resetReadiness(cliBinary: string, env: NodeJS.ProcessEnv, suspendReflecting: boolean): Promise<void> {
    const result = await evalObsidianJson<{ ready: boolean }>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            ...(suspendReflecting
                ? [
                      "await core.services.setting.applyPartial({suspendParseReplicationResult:true},true);",
                      "await core.services.control.applySettings();",
                      "await core.services.replication.startContinuous({trigger:'daemon',interaction:{kind:'forbidden'}});",
                  ]
                : []),
            "core.services.appLifecycle.resetIsReady();",
            "return JSON.stringify({ready:core.services.appLifecycle.isReady()});",
            "})()",
        ].join(""),
        env
    );
    assertEqual(result.ready, false, "The target application remained ready after resetIsReady().");
}

async function waitForReceivedWhileUnready(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    target: TemporaryVault,
    path: string
): Promise<void> {
    const entry = await waitForLocalDatabaseEntry(cliBinary, env, path);
    if (entry.children.length === 0) throw new Error(`The target received metadata without Chunks: ${path}`);
    const readiness = await evalObsidianJson<{ ready: boolean }>(
        cliBinary,
        "(()=>JSON.stringify({ready:app.plugins.plugins['obsidian-livesync'].core.services.appLifecycle.isReady()}))()",
        env
    );
    assertEqual(readiness.ready, false, `The target became ready before applying ${path}.`);
    await assertVaultPathStaysMissing(target, path, 750);
}

async function startContinuousReplication(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    const result = await evalObsidianJson<{ status: string }>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.setting.applyExternalSettings({liveSync:true},true);",
            "await core.services.control.applySettings();",
            "const result=await core.services.replication.startContinuous({trigger:'daemon',interaction:{kind:'forbidden'}});",
            "return JSON.stringify(result);",
            "})()",
        ].join(""),
        env
    );
    assertEqual(result.status, "completed", `Continuous replication did not start: ${JSON.stringify(result)}.`);

    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_REMOTE_ACTIVITY_TIMEOUT_MS ?? 30000);
    let active = false;
    while (!active && Date.now() < deadline) {
        active = await evalObsidianJson<boolean>(
            cliBinary,
            "(()=>JSON.stringify(!!app.plugins.plugins['obsidian-livesync'].core.services.replicator.getActiveReplicator()))()",
            env
        );
        if (!active) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!active) throw new Error("Timed out waiting for the target Replicator to become active.");
}

async function markReadyTwice(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    const result = await evalObsidianJson<{ ready: boolean }>(
        cliBinary,
        [
            "(()=>{",
            "const lifecycle=app.plugins.plugins['obsidian-livesync'].core.services.appLifecycle;",
            "lifecycle.markIsReady();",
            "lifecycle.markIsReady();",
            "return JSON.stringify({ready:lifecycle.isReady()});",
            "})()",
        ].join(""),
        env
    );
    assertEqual(result.ready, true, "Commonlib did not establish application readiness.");
}

async function removeObserver(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson(
        cliBinary,
        [
            "(()=>{",
            `const key=${JSON.stringify(observerKey)};`,
            "const state=globalThis[key];",
            "if(state){state.unsubscribeReady?.();delete globalThis[key];}",
            "return JSON.stringify(true);",
            "})()",
        ].join(""),
        env
    );
}

async function assertApplied(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    vault: TemporaryVault,
    path: string,
    expectedContent: string,
    expectedReadyEvents: number
): Promise<void> {
    const beforeReflection = await readObservation(cliBinary, env, path);
    assertEqual(
        beforeReflection.readinessEvents,
        expectedReadyEvents,
        "The expected Commonlib readiness transition was not observed before reflection."
    );
    await waitForVaultContent(vault, path, expectedContent);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const observation = await readObservation(cliBinary, env, path);
    assertEqual(observation.content, expectedContent, `Obsidian Vault read-back was incorrect for ${path}.`);
    assertEqual(
        observation.readinessEvents,
        expectedReadyEvents,
        "markIsReady emitted an unexpected number of readiness transitions."
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);

    const couchDb = await loadCouchDbConfig();
    const sourceDbName = makeUniqueDatabaseName(couchDb.dbPrefix, "received-change-readiness-source");
    const targetDbName = makeUniqueDatabaseName(couchDb.dbPrefix, "received-change-readiness-target");
    const couchDbSettings = {
        uri: couchDb.uri,
        username: couchDb.username,
        password: couchDb.password,
    };
    const sourceCouchDbSettings = { ...couchDbSettings, dbName: sourceDbName };
    const targetCouchDbSettings = { ...couchDbSettings, dbName: targetDbName };
    const sourceVault = await createTemporaryVault("obsidian-livesync-readiness-source-");
    const targetVault = await createTemporaryVault("obsidian-livesync-readiness-target-");
    let source: ObsidianLiveSyncSession | undefined;
    let target: ObsidianLiveSyncSession | undefined;
    const publishedChunkIds = new Set<string>();

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, sourceDbName);
        await createCouchDbDatabase(couchDb, targetDbName);
        source = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault: sourceVault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: createE2eCouchDbPluginData(sourceCouchDbSettings),
            localStorageEntries: createE2eObsidianDeviceLocalState(sourceVault.name),
        });
        await waitForLiveSyncCoreReady(cli.binary, source.cliEnv);
        await prepareRemote(cli.binary, source.cliEnv);

        const readyNote = await createAndUploadNote(
            cli.binary,
            source.cliEnv,
            couchDb,
            sourceDbName,
            readyPath,
            readyContent
        );
        const suspendedNote = await createAndUploadNote(
            cli.binary,
            source.cliEnv,
            couchDb,
            sourceDbName,
            suspendedPath,
            suspendedContent
        );
        await source.app.stop();
        source = undefined;

        target = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault: targetVault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: createE2eCouchDbPluginData(targetCouchDbSettings),
            localStorageEntries: createE2eObsidianDeviceLocalState(targetVault.name),
        });
        await waitForLiveSyncCoreReady(cli.binary, target.cliEnv);
        await prepareRemote(cli.binary, target.cliEnv);
        await installObserver(cli.binary, target.cliEnv);
        await startContinuousReplication(cli.binary, target.cliEnv);

        await resetReadiness(cli.binary, target.cliEnv, false);
        await injectCapturedNote(couchDb, targetDbName, readyNote, publishedChunkIds);
        await waitForReceivedWhileUnready(cli.binary, target.cliEnv, targetVault, readyPath);
        await markReadyTwice(cli.binary, target.cliEnv);
        await assertApplied(cli.binary, target.cliEnv, targetVault, readyPath, readyContent, 1);

        await resetReadiness(cli.binary, target.cliEnv, true);
        await injectCapturedNote(couchDb, targetDbName, suspendedNote, publishedChunkIds);
        await waitForReceivedWhileUnready(cli.binary, target.cliEnv, targetVault, suspendedPath);
        await markReadyTwice(cli.binary, target.cliEnv);
        await assertVaultPathStaysMissing(targetVault, suspendedPath, 1000);
        const suspendedObservation = await readObservation(cli.binary, target.cliEnv, suspendedPath);
        assertEqual(suspendedObservation.readinessEvents, 2, "The resumed-ready transition was not observed once.");
        assertEqual(suspendedObservation.content, null, "Readiness bypassed explicit database-reflection suspension.");

        await evalObsidianJson(
            cli.binary,
            "(async()=>{const setting=app.plugins.plugins['obsidian-livesync'].core.services.setting;await setting.applyPartial({suspendParseReplicationResult:false},true);return JSON.stringify(true);})()",
            target.cliEnv
        );
        await assertApplied(cli.binary, target.cliEnv, targetVault, suspendedPath, suspendedContent, 2);

        console.log(
            "Received-change readiness: queued changes resumed once per readiness transition; explicit suspension held until settings resumed."
        );
    } finally {
        if (target) {
            await removeObserver(cli.binary, target.cliEnv).catch(() => undefined);
            await target.app.stop();
        }
        if (source) await source.app.stop();
        await sourceVault.dispose();
        await targetVault.dispose();
        if (process.env.E2E_OBSIDIAN_KEEP_COUCHDB !== "true") {
            await Promise.all(
                [sourceDbName, targetDbName].map((dbName) => deleteCouchDbDatabase(couchDb, dbName))
            ).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
