import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    configureObjectStorage,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import {
    deleteObjectStoragePrefix,
    ensureObjectStorageBucket,
    listObjectStorageObjects,
    loadObjectStorageConfig,
    makeUniqueBucketPrefix,
} from "../runner/objectStorage.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";

const notePath = "E2E/minio-upload.md";
const noteContent = [
    "# Object Storage upload from real Obsidian",
    "",
    "This note is created through Obsidian and uploaded by Self-hosted LiveSync to S3-compatible Object Storage.",
    "The test is intentionally small, but it crosses the real Obsidian, Journal Sync, and AWS SDK boundary.",
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

async function waitForObjectStorageObjects(prefix: string): Promise<string[]> {
    const objectStorage = await loadObjectStorageConfig();
    const timeoutMs = Number(process.env.E2E_OBSIDIAN_OBJECT_STORAGE_TIMEOUT_MS ?? 20000);
    const deadline = Date.now() + timeoutMs;
    let keys: string[] = [];
    while (Date.now() < deadline) {
        const objects = await listObjectStorageObjects(objectStorage, prefix);
        keys = objects.flatMap((object) => (object.Key ? [object.Key] : []));
        if (keys.length > 0) {
            return keys;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for Object Storage objects under ${prefix}. Last keys: ${keys.join(", ")}`);
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const objectStorage = await loadObjectStorageConfig();
    const bucketPrefix = makeUniqueBucketPrefix("minio-upload");
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;

    try {
        await ensureObjectStorageBucket(objectStorage);

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault: ${vault.path}`);
        console.log(`Temporary Object Storage bucket: ${objectStorage.bucket}`);
        console.log(`Temporary Object Storage prefix: ${bucketPrefix}`);

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);

        const configured = await configureObjectStorage(cli.binary, session.cliEnv, {
            ...objectStorage,
            bucketPrefix,
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        assertEqual(configured.isConfigured, true, "Self-hosted LiveSync was not marked as configured.");
        assertEqual(configured.remoteType, "MINIO", "Remote type was not Object Storage.");
        assertEqual(configured.endpoint, objectStorage.endpoint, "Configured Object Storage endpoint did not match.");
        assertEqual(configured.bucket, objectStorage.bucket, "Configured Object Storage bucket did not match.");
        assertEqual(configured.bucketPrefix, bucketPrefix, "Configured Object Storage bucket prefix did not match.");
        assertEqual(configured.liveSync, false, "LiveSync should remain disabled during this one-shot workflow.");

        await prepareRemote(cli.binary, session.cliEnv);
        const localEntry = await createNoteAndWaitForLocalDb(cli.binary, session.cliEnv);
        await pushLocalChanges(cli.binary, session.cliEnv);

        const keys = await waitForObjectStorageObjects(bucketPrefix);

        console.log(
            `Uploaded ${localEntry.path} through Journal Sync to ${objectStorage.bucket}/${bucketPrefix} (${keys.length} object(s))`
        );
    } finally {
        if (session) {
            await session.app.stop();
        }
        await vault.dispose();
        if (process.env.E2E_OBSIDIAN_KEEP_OBJECT_STORAGE !== "true") {
            await deleteObjectStoragePrefix(objectStorage, bucketPrefix).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
