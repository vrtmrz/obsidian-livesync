import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
} from "../runner/couchdb.ts";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianPage, obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

type FileMetadata = {
    path: string;
    id: string;
    revision: string;
    children: string[];
};

type InitialState = {
    appVersion: string;
    files: FileMetadata[];
};

type FetchOutcome = {
    scanResult: boolean;
    finalised: boolean;
    chunksPresentBeforeScan: number;
    chunksPresentAfterScan: number;
    totalChunkIds: number;
    remoteChunkRequests: number[];
    appReady: boolean;
    appSuspended: boolean;
    suspendFileWatching: boolean;
    files: Array<{
        path: string;
        id: string;
        revision: string;
        conflicts: string[];
        provenanceRevision: string | null;
    }>;
};

const paths = [
    "E2E/plain.md",
    "E2E/drawing.excalidraw.md",
    "E2E/attachment.pdf",
    "E2E/image.png",
];
const contents = [
    Buffer.from("# Existing note\n\n日本語 and English.\n".repeat(200)),
    Buffer.from("# Excalidraw fixture\n\nExisting drawing data.\n".repeat(200)),
    Buffer.from("%PDF-1.4\n" + "Synthetic attachment content.\n".repeat(2048)),
    Buffer.from(Array.from({ length: 65536 }, (_, index) => (index * 13 + 17) % 256)),
];
const digest = (bytes: ArrayLike<number>) => createHash("sha256").update(Uint8Array.from(bytes)).digest("hex");

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cliBinary = requireObsidianCli();
    const couchDb = await loadCouchDbConfig();
    await assertCouchDbReachable(couchDb);

    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "fetch-on-demand-chunks");
    const connection = { ...couchDb, dbName };
    let databaseCreated = false;
    let vault: TemporaryVault | undefined;
    let session: ObsidianLiveSyncSession | undefined;

    try {
        await createCouchDbDatabase(couchDb, dbName);
        databaseCreated = true;
        vault = await createTemporaryVault("obsidian-livesync-fetch-on-demand-");
        const vaultPath = vault.path;

        const remoteDebuggingPort = obsidianRemoteDebuggingPort(process.env);
        const sessionEnv = {
            ...process.env,
            E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
        };
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            artifactRoot: process.env.E2E_OBSIDIAN_ARTIFACT_ROOT ?? process.cwd(),
            pluginData: createE2eCouchDbPluginData(connection, {
                encrypt: true,
                E2EEAlgorithm: "v2",
                passphrase: "synthetic-fetch-on-demand-fixture",
                usePathObfuscation: true,
                encryptInternalMetadata: true,
                doctorProcessedVersion: "1.0.33",
                idDerivationVersion: 0,
                pathNormalizationVersion: 0,
                useRequestAPI: true,
                useOnlyLocalChunk: false,
                readChunksOnline: true,
                useIndexedDBAdapter: false,
                concurrencyOfReadChunksOnline: 40,
                minimumIntervalOfReadChunksOnline: 50,
                showVerboseLog: true,
                lessInformationInLog: false,
                doNotSuspendOnFetching: false,
            }),
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
            env: sessionEnv,
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await prepareRemote(cliBinary, session.cliEnv);

        const evaluate = async <T>(expression: string): Promise<T> => {
            if (!session) throw new Error("No active Obsidian session.");
            let result: string | undefined;
            await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                result = await page.evaluate<string>(expression);
            });
            if (result === undefined) throw new Error("The renderer returned no result.");
            return JSON.parse(result) as T;
        };
        const seededSettings = await evaluate<Record<string, unknown>>(
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                `const paths=${JSON.stringify(paths)};`,
                `const contents=${JSON.stringify(contents.map((bytes) => bytes.toString("base64")))};`,
                "await app.vault.createFolder('E2E');",
                "for(let index=0;index<paths.length;index++){",
                "  const bytes=Uint8Array.from(atob(contents[index]),character=>character.charCodeAt(0));",
                "  if(paths[index].endsWith('.md')) await app.vault.create(paths[index],new TextDecoder().decode(bytes));",
                "  else await app.vault.createBinary(paths[index],bytes.buffer);",
                "}",
                "await core.services.fileProcessing.commitPendingFileEvents();",
                "for(const path of paths){",
                "  const file=app.vault.getAbstractFileByPath(path);",
                "  if(!file) throw new Error('Fixture file is missing: '+path);",
                "  if(!(await core.fileHandler.storeFileToDB(file))) throw new Error('Could not store fixture '+path);",
                "}",
                "const settings=core.services.setting.currentSettings();",
                "return JSON.stringify({",
                "  encrypt:settings.encrypt,E2EEAlgorithm:settings.E2EEAlgorithm,",
                "  usePathObfuscation:settings.usePathObfuscation,encryptInternalMetadata:settings.encryptInternalMetadata,",
                "  idDerivationVersion:settings.idDerivationVersion,pathNormalizationVersion:settings.pathNormalizationVersion,",
                "  readChunksOnline:settings.readChunksOnline,useOnlyLocalChunk:settings.useOnlyLocalChunk,",
                "  useRequestAPI:settings.useRequestAPI,useIndexedDBAdapter:settings.useIndexedDBAdapter",
                "});",
                "})()",
            ].join("")
        );
        assert.deepEqual(seededSettings, {
            encrypt: true,
            E2EEAlgorithm: "v2",
            usePathObfuscation: true,
            encryptInternalMetadata: true,
            idDerivationVersion: 0,
            pathNormalizationVersion: 0,
            readChunksOnline: true,
            useOnlyLocalChunk: false,
            useRequestAPI: true,
            useIndexedDBAdapter: false,
        });

        await pushLocalChanges(cliBinary, session.cliEnv);
        const before = await evaluate<InitialState>(
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                `const paths=${JSON.stringify(paths)};`,
                "return JSON.stringify({appVersion:core.services.API.getAppVersion(),files:",
                "await Promise.all(paths.map(async path=>{",
                "  const meta=await core.localDatabase.getDBEntryMeta(path,undefined,true);",
                "  if(!meta) throw new Error('Fixture Metadata is missing: '+path);",
                "  return {path,id:meta._id,revision:meta._rev,children:meta.children};",
                "}))});",
                "})()",
            ].join("")
        );
        assert.equal(before.files.length, paths.length, "The remote fixture must contain all four files.");
        assert.ok(before.files.every((file) => file.children.length > 0), "Every fixture file must have Chunks.");
        const diskBefore = await Promise.all(
            paths.map(async (path) => ({ path, hash: digest(await readFile(join(vaultPath, path))) }))
        );
        assert.deepEqual(
            diskBefore,
            paths.map((path, index) => ({ path, hash: digest(contents[index]) })),
            "The seeded Vault bytes must match the fixture."
        );

        const outcome = await evaluate<FetchOutcome>(
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                `const paths=${JSON.stringify(paths)};`,
                "await core.rebuilder.$fetchLocalDBFast(false);",
                "const db=core.localDatabase.localDatabase;",
                "const metadata=await Promise.all(paths.map(path=>core.localDatabase.getDBEntryMeta(path,undefined,true)));",
                "const ids=[...new Set(metadata.flatMap(meta=>meta.children))];",
                "const initialChunks=await db.allDocs({keys:ids,include_docs:true});",
                "const chunksPresentBeforeScan=initialChunks.rows.filter(row=>row.doc&&!row.value?.deleted).length;",
                "const replicator=core.services.replicator.getActiveReplicator();",
                "if(!replicator||typeof replicator.fetchRemoteChunks!=='function') throw new Error('Remote Chunk fetch is unavailable');",
                "const originalFetchRemoteChunks=replicator.fetchRemoteChunks;",
                "const ownDescriptor=Object.getOwnPropertyDescriptor(replicator,'fetchRemoteChunks');",
                "const remoteChunkRequests=[];",
                "replicator.fetchRemoteChunks=async function(...args){",
                "  remoteChunkRequests.push(args[0]?.length??0);",
                "  return await originalFetchRemoteChunks.apply(this,args);",
                "};",
                "let scanResult;let finalised;",
                "try{",
                "  scanResult=await core.services.vault.scanVault(true,true,false,{strictContentCheck:true});",
                "  finalised=await core.rebuilder.finishRebuild();",
                "}finally{",
                "  if(ownDescriptor) Object.defineProperty(replicator,'fetchRemoteChunks',ownDescriptor);",
                "  else delete replicator.fetchRemoteChunks;",
                "}",
                "const afterMetadata=await Promise.all(paths.map(path=>core.localDatabase.getDBEntryMeta(path,undefined,true)));",
                "const afterChunks=await db.allDocs({keys:ids,include_docs:true});",
                "const provenance=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');",
                "const files=await Promise.all(afterMetadata.map(async(meta,index)=>({",
                "  path:paths[index],id:meta._id,revision:meta._rev,",
                "  conflicts:(await db.get(meta._id,{conflicts:true}))._conflicts??[],",
                "  provenanceRevision:(await provenance.get(paths[index]))?.revision??null",
                "})));",
                "return JSON.stringify({scanResult,finalised,chunksPresentBeforeScan,",
                "  chunksPresentAfterScan:afterChunks.rows.filter(row=>row.doc&&!row.value?.deleted).length,",
                "  totalChunkIds:ids.length,remoteChunkRequests,",
                "  appReady:core.services.appLifecycle.isReady(),",
                "  appSuspended:core.services.appLifecycle.isSuspended(),",
                "  suspendFileWatching:core.services.setting.currentSettings().suspendFileWatching,files});",
                "})()",
            ].join("")
        );
        const diskAfter = await Promise.all(
            paths.map(async (path) => ({ path, hash: digest(await readFile(join(vaultPath, path))) }))
        );

        console.log(
            JSON.stringify(
                {
                    scenario: "fetch-on-demand-chunks",
                    appVersion: before.appVersion,
                    files: before.files.map(({ path, revision, children }) => ({ path, revision, chunkCount: children.length })),
                    scanResult: outcome.scanResult,
                    finalised: outcome.finalised,
                    chunksPresentBeforeScan: outcome.chunksPresentBeforeScan,
                    chunksPresentAfterScan: outcome.chunksPresentAfterScan,
                    remoteChunkRequestCount: outcome.remoteChunkRequests.length,
                    appReady: outcome.appReady,
                    appSuspended: outcome.appSuspended,
                    suspendFileWatching: outcome.suspendFileWatching,
                },
                null,
                2
            )
        );

        assert.equal(outcome.chunksPresentBeforeScan, 0, "The fetch must omit Chunks until strict scanning.");
        assert.ok(outcome.totalChunkIds > 0, "The Metadata must reference Chunks.");
        assert.equal(outcome.chunksPresentAfterScan, outcome.totalChunkIds, "Strict scanning must retrieve every Chunk.");
        assert.equal(outcome.scanResult, true, "The strict Vault scan must succeed.");
        assert.equal(outcome.finalised, true, "The Standard Fetch rebuild must finalise.");
        assert.ok(outcome.remoteChunkRequests.some((count) => count > 0), "Strict scanning must request remote Chunks.");
        assert.equal(outcome.appReady, true, "The application must become ready after Fetch.");
        assert.equal(outcome.appSuspended, false, "The application must not remain suspended after Fetch.");
        assert.equal(outcome.suspendFileWatching, false, "File watching must resume after Fetch.");
        assert.deepEqual(diskAfter, diskBefore, "Fetch must preserve the exact physical Vault bytes.");
        assert.equal(outcome.files.length, before.files.length);
        for (let index = 0; index < before.files.length; index++) {
            assert.equal(outcome.files[index].id, before.files[index].id, "Fetch must preserve the Metadata ID.");
            assert.equal(
                outcome.files[index].revision,
                before.files[index].revision,
                "Fetch must preserve the exact Metadata revision."
            );
            assert.deepEqual(outcome.files[index].conflicts, [], "Fetch must not create Metadata conflicts.");
            assert.equal(
                outcome.files[index].provenanceRevision,
                before.files[index].revision,
                "File reflection provenance must identify the exact Metadata revision."
            );
        }
    } catch (error) {
        if (session) {
            await captureObsidianPage(session.remoteDebuggingPort, "fetch-on-demand-chunks-failure.png", async () => {}).catch(
                (captureError) => console.error("Could not capture the failed Obsidian session:", captureError)
            );
        }
        throw error;
    } finally {
        try {
            if (session) await session.app.stop();
        } finally {
            try {
                if (vault) await vault.dispose();
            } finally {
                if (databaseCreated) await deleteCouchDbDatabase(couchDb, dbName);
            }
        }
    }
}

await main();
