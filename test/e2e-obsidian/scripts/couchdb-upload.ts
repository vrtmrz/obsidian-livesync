import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    putCouchDbDocument,
    waitForCouchDbDocs,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    assertE2eCompatibilityMarker,
    assertE2eCompatibilityReviewPending,
    configureCouchDb,
    createE2eCouchDbPluginData,
    prepareRemote,
    resumeCompatibilityReview,
    waitForLiveSyncCoreReady,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import {
    REMOTE_ACTIVITY_EXPECTED_STATE,
    captureRemoteActivityDiagnostics,
    waitForRemoteActivityState,
} from "../runner/remoteActivity.ts";
import {
    cleanUpHeldRemoteActivity,
    clearHeldRemoteActivity,
    finishHeldRemoteActivity,
    startHeldChunkFetch,
    startHeldOneShotReplication,
    startHeldTrackedRequest,
    waitForRestoredChunk,
} from "../runner/remoteActivityWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";

const notePath = "E2E/couchdb-upload.md";
const noteContent = [
    "# CouchDB upload from real Obsidian",
    "",
    "This note is created through Obsidian and uploaded by Self-hosted LiveSync.",
    "The content is intentionally long enough to require chunk metadata in the local database.",
    "0123456789 abcdefghijklmnopqrstuvwxyz 0123456789 abcdefghijklmnopqrstuvwxyz",
    "0123456789 abcdefghijklmnopqrstuvwxyz 0123456789 abcdefghijklmnopqrstuvwxyz",
    `Created at: ${new Date().toISOString()}`,
    "",
].join("\n");

async function createNoteAndWaitForLocalDb(cliBinary: string, env: NodeJS.ProcessEnv): Promise<LocalDatabaseEntry> {
    return await evalObsidianJson<LocalDatabaseEntry>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(notePath)};`,
            `const content=${JSON.stringify(noteContent)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "if(!(await app.vault.adapter.exists('E2E'))) await app.vault.createFolder('E2E');",
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.delete(existing);",
            "await app.vault.create(path,content);",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "let entry=false;",
            "for(let i=0;i<40;i++){",
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "entry=await core.localDatabase.getDBEntry(path,undefined,false,true).catch(()=>false);",
            "if(entry&&entry._id&&Array.isArray(entry.children)&&entry.children.length>0) break;",
            "await sleep(250);",
            "}",
            "if(!entry||!entry._id) throw new Error('Timed out waiting for local database entry');",
            "return JSON.stringify({id:entry._id,path:entry.path,type:entry.type,children:entry.children||[]});",
            "})()",
        ].join(""),
        env
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "obsidian-upload");
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;
    let activityStage = "session-startup";

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault: ${vault.path}`);
        console.log(`Temporary CouchDB database: ${dbName}`);

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: createE2eCouchDbPluginData({
                uri: couchDb.uri,
                username: couchDb.username,
                password: couchDb.password,
                dbName,
            }),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await assertE2eCompatibilityReviewPending(cli.binary, session.cliEnv);
        await resumeCompatibilityReview(session.remoteDebuggingPort, {
            verifyMissingDeviceMarkerExplanation: true,
            screenshotPrefix: "compatibility-review-copied-vault",
        });
        await assertE2eCompatibilityMarker(cli.binary, session.cliEnv);

        const configured = await configureCouchDb(cli.binary, session.cliEnv, {
            uri: couchDb.uri,
            username: couchDb.username,
            password: couchDb.password,
            dbName,
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        assertEqual(configured.isConfigured, true, "Self-hosted LiveSync was not marked as configured.");
        assertEqual(configured.couchDB_URI, couchDb.uri, "Configured CouchDB URI did not match.");
        assertEqual(configured.couchDB_DBNAME, dbName, "Configured CouchDB database name did not match.");
        assertEqual(configured.liveSync, false, "LiveSync should remain disabled during this one-shot workflow.");
        assertEqual(configured.syncOnStart, false, "Sync on start should remain disabled during this workflow.");
        assertEqual(configured.syncOnSave, false, "Sync on save should remain disabled during this workflow.");

        await prepareRemote(cli.binary, session.cliEnv);
        activityStage = "initial-idle";
        const initialIdle = await waitForRemoteActivityState(
            session.remoteDebuggingPort,
            REMOTE_ACTIVITY_EXPECTED_STATE.idle
        );
        const localEntry = await createNoteAndWaitForLocalDb(cli.binary, session.cliEnv);

        activityStage = REMOTE_ACTIVITY_EXPECTED_STATE.trackedRequestActive;
        await startHeldTrackedRequest(cli.binary, session.cliEnv);
        const trackedRequestActive = await waitForRemoteActivityState(
            session.remoteDebuggingPort,
            REMOTE_ACTIVITY_EXPECTED_STATE.trackedRequestActive
        );
        const trackedRequestResult = await finishHeldRemoteActivity(cli.binary, session.cliEnv);
        assertEqual(trackedRequestResult.error, undefined, "The observed CouchDB request failed.");
        assertEqual(trackedRequestResult.result, true, "The observed CouchDB request did not report success.");
        activityStage = "tracked-request-idle";
        const trackedRequestIdle = await waitForRemoteActivityState(
            session.remoteDebuggingPort,
            REMOTE_ACTIVITY_EXPECTED_STATE.idle
        );
        if (trackedRequestIdle.requestCount <= initialIdle.requestCount) {
            throw new Error("The held CouchDB request did not advance the tracked remote-request count.");
        }
        await clearHeldRemoteActivity(cli.binary, session.cliEnv);

        activityStage = "one-shot-active";
        await startHeldOneShotReplication(cli.binary, session.cliEnv);
        const oneShotActive = await waitForRemoteActivityState(
            session.remoteDebuggingPort,
            REMOTE_ACTIVITY_EXPECTED_STATE.finiteReplicationActive
        );
        const oneShotResult = await finishHeldRemoteActivity(cli.binary, session.cliEnv);
        assertEqual(oneShotResult.error, undefined, "One-shot replication failed while its activity was observed.");
        assertEqual(oneShotResult.result, true, "One-shot replication did not report success.");
        activityStage = "one-shot-idle";
        const oneShotIdle = await waitForRemoteActivityState(
            session.remoteDebuggingPort,
            REMOTE_ACTIVITY_EXPECTED_STATE.idle
        );
        if (oneShotIdle.requestCount <= trackedRequestIdle.requestCount) {
            throw new Error("One-shot replication did not make an observed remote request.");
        }
        await clearHeldRemoteActivity(cli.binary, session.cliEnv);

        const remoteDocs = await waitForCouchDbDocs(couchDb, dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            return ids.has(localEntry.id) && localEntry.children.every((childId) => ids.has(childId));
        });
        const remoteMetadata = remoteDocs.find((doc) => doc._id === localEntry.id);
        assertEqual(
            remoteMetadata?.path,
            localEntry.path,
            "Remote metadata path did not match the local database entry."
        );

        const sourceChunkId = localEntry.children[0];
        if (!sourceChunkId) throw new Error("The uploaded note did not produce a chunk for the fetch workflow.");
        const sourceChunk = remoteDocs.find((document) => document._id === sourceChunkId);
        if (!sourceChunk || sourceChunk.type !== "leaf") {
            throw new Error(`The uploaded source chunk was not found in CouchDB: ${sourceChunkId}`);
        }
        const { _rev: _sourceRevision, ...remoteOnlyChunk } = sourceChunk;
        const chunkId = `h:e2e-remote-activity-${Date.now().toString(36)}`;
        await putCouchDbDocument(couchDb, dbName, { ...remoteOnlyChunk, _id: chunkId });
        activityStage = REMOTE_ACTIVITY_EXPECTED_STATE.chunkFetchActive;
        await startHeldChunkFetch(cli.binary, session.cliEnv, chunkId);
        const chunkFetchActive = await waitForRemoteActivityState(
            session.remoteDebuggingPort,
            REMOTE_ACTIVITY_EXPECTED_STATE.chunkFetchActive
        );
        const chunkFetchResult = await finishHeldRemoteActivity(cli.binary, session.cliEnv);
        assertEqual(
            chunkFetchResult.error,
            undefined,
            "On-demand chunk fetching failed while its activity was observed."
        );
        if (!chunkFetchResult.requestedIds?.includes(chunkId)) {
            throw new Error(`The on-demand chunk request did not include the selected chunk: ${chunkId}`);
        }
        if ((chunkFetchResult.resultCount ?? 0) < 1) {
            throw new Error(`The remote did not return the selected chunk: ${chunkId}`);
        }
        const restoredChunk = await waitForRestoredChunk(cli.binary, session.cliEnv, chunkId);
        assertEqual(restoredChunk.id, chunkId, "The restored chunk ID did not match the requested chunk.");
        activityStage = "chunk-fetch-idle";
        const chunkFetchIdle = await waitForRemoteActivityState(
            session.remoteDebuggingPort,
            REMOTE_ACTIVITY_EXPECTED_STATE.idle
        );
        if (chunkFetchIdle.requestCount <= oneShotIdle.requestCount) {
            throw new Error("On-demand chunk fetching did not make an observed remote request.");
        }
        await clearHeldRemoteActivity(cli.binary, session.cliEnv);

        console.log(
            `Uploaded metadata ${localEntry.id} and ${localEntry.children.length} chunk(s) to CouchDB database ${dbName}`
        );
        console.log(
            [
                `Tracked request: ${trackedRequestActive.statusBarText.trim()} -> idle`,
                `One-shot activity: ${oneShotActive.statusBarText.trim()} -> idle`,
                `Chunk-fetch activity: ${chunkFetchActive.statusBarText.trim()} -> idle`,
                `Balanced remote requests: ${chunkFetchIdle.requestCount}/${chunkFetchIdle.responseCount}`,
            ].join("\n")
        );
    } catch (error) {
        if (session) {
            const diagnostics = await captureRemoteActivityDiagnostics(
                session.remoteDebuggingPort,
                `couchdb-upload-${activityStage}`
            ).catch((diagnosticError: unknown) => {
                console.warn(
                    `Could not capture remote activity diagnostics: ${
                        diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
                    }`
                );
                return undefined;
            });
            if (diagnostics) {
                console.error(`Remote activity screenshot: ${diagnostics.screenshotPath}`);
                console.error(`Remote activity snapshot: ${diagnostics.snapshotPath}`);
            }
        }
        throw error;
    } finally {
        if (session) {
            await cleanUpHeldRemoteActivity(cli.binary, session.cliEnv).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
            await session.app.stop();
        }
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
