/**
 * Proves that one file which cannot be reflected during an ordinary start-up
 * does not keep the entire configured application unready.
 *
 * The fixture relies on the conventional Linux 255-byte path component
 * limit. It stores one ordinary note and one note with a 258-byte component in
 * the local database, then restarts the same real Obsidian Vault and profile.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
} from "../runner/couchdb.ts";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";

const validPath = "E2E/partial-startup-valid.md";
const oversizedComponent = `${"界".repeat(85)}.md`;
const failedPath = `E2E/${oversizedComponent}`;
const validContent = `# Partial start-up\n\n${"V".repeat(4096)}\n`;
const failedContent = `# Retry this file\n\n${"R".repeat(4096)}\n`;
const partialFailureNotice =
    "Not all files could be synchronised. Check the affected files. Generate a report to review the detailed log.";
const failedPathLog =
    `Offline scan failed to synchronise ${failedPath} between storage and the local database; ` +
    "this path remains eligible for a later scan.";
const assertionTimeoutMs = Number(process.env.E2E_OBSIDIAN_CORE_READY_TIMEOUT_MS ?? 20000);

type SeededEntry = {
    id: string;
    path: string;
    revision: string;
    children: string[];
};

type FailedPathState = {
    appReady: boolean;
    databaseReady: boolean;
    fileExists: boolean;
    entryReadable: boolean;
    metadataRevision?: string;
    provenance: { revision: string; observedStorageMtime?: number } | null;
    logText: string;
};

type RetryState = Omit<FailedPathState, "databaseReady" | "logText"> & {
    scanResult: string | false;
};

async function seedDatabaseOnlyEntries(cliBinary: string, env: NodeJS.ProcessEnv): Promise<SeededEntry[]> {
    return await evalObsidianJson<SeededEntry[]>(
        cliBinary,
        [
            "(async()=>{",
            `const fixtures=${JSON.stringify([
                { path: validPath, content: validContent },
                { path: failedPath, content: failedContent },
            ])};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const seeded=[];",
            "for(const {path,content} of fixtures){",
            "  if(app.vault.getAbstractFileByPath(path)!==null){",
            "    throw new Error(`Database-only fixture already exists in the Vault: ${path}`);",
            "  }",
            "  const blob=new Blob([content],{type:'text/plain'});",
            "  const id=await core.services.path.path2id(path);",
            "  const now=Date.now();",
            "  const result=await core.localDatabase.putDBEntry({",
            "    _id:id,path,data:blob,ctime:now,mtime:now,",
            "    size:(await blob.arrayBuffer()).byteLength,children:[],",
            "    datatype:'plain',type:'plain',eden:{},",
            "  });",
            "  if(!result?.ok) throw new Error(`Could not seed database-only fixture: ${path}`);",
            "  const metadata=await core.localDatabase.getDBEntryMeta(path,undefined,true);",
            "  if(!metadata) throw new Error(`Could not reload seeded Metadata: ${path}`);",
            "  seeded.push({id,path,revision:result.rev,children:metadata.children??[]});",
            "}",
            "return JSON.stringify(seeded);",
            "})()",
        ].join(""),
        env
    );
}

async function observePartialFailureNotice(remoteDebuggingPort: number): Promise<void> {
    await withObsidianPage(remoteDebuggingPort, async (page) => {
        await page
            .locator(".notice")
            .filter({ hasText: partialFailureNotice })
            .first()
            .waitFor({ state: "visible", timeout: assertionTimeoutMs });
    });
}

async function inspectFailedPathState(cliBinary: string, env: NodeJS.ProcessEnv): Promise<FailedPathState> {
    return await evalObsidianJson<FailedPathState>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(failedPath)};`,
            `const expectedLog=${JSON.stringify(failedPathLog)};`,
            `const timeoutMs=${JSON.stringify(assertionTimeoutMs)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const metadata=await core.localDatabase.getDBEntryMeta(path,undefined,true);",
            "const entry=await core.localDatabase.getDBEntry(path,undefined,false,true,true);",
            "const provenanceStore=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');",
            "const provenance=(await provenanceStore.get(path))??null;",
            "await core.services.API.showWindow('log-log');",
            "const deadline=Date.now()+timeoutMs;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "let logText='';",
            "while(Date.now()<deadline){",
            "  logText=Array.from(document.querySelectorAll('.logpane .log pre'))",
            "    .map((element)=>element.textContent??'').join('\\n');",
            "  if(logText.includes(expectedLog)) break;",
            "  await sleep(100);",
            "}",
            "for(const leaf of app.workspace.getLeavesOfType('log-log')) leaf.detach();",
            "return JSON.stringify({",
            "  appReady:core.services.appLifecycle.isReady(),",
            "  databaseReady:core.services.database.isDatabaseReady(),",
            "  fileExists:app.vault.getAbstractFileByPath(path)!==null,",
            "  entryReadable:entry!==false,",
            "  metadataRevision:metadata?._rev,",
            "  provenance,",
            "  logText,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function retryFailedPath(cliBinary: string, env: NodeJS.ProcessEnv): Promise<RetryState> {
    return await evalObsidianJson<RetryState>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(failedPath)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const scanResult=await core.services.vault.scanVault(false,false,true);",
            "const metadata=await core.localDatabase.getDBEntryMeta(path,undefined,true);",
            "const entry=await core.localDatabase.getDBEntry(path,undefined,false,true,true);",
            "const provenanceStore=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');",
            "return JSON.stringify({",
            "  scanResult,",
            "  appReady:core.services.appLifecycle.isReady(),",
            "  fileExists:app.vault.getAbstractFileByPath(path)!==null,",
            "  entryReadable:entry!==false,",
            "  metadataRevision:metadata?._rev,",
            "  provenance:(await provenanceStore.get(path))??null,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function main(): Promise<void> {
    if (process.platform !== "linux") {
        throw new Error("The partial start-up file-failure scenario currently requires a Linux test Vault.");
    }
    assertEqual(
        Buffer.byteLength(oversizedComponent, "utf8"),
        258,
        "The failing path component no longer exercises the intended UTF-8 byte boundary."
    );

    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "partial-startup-file-failure");
    const couchDbSettings = {
        uri: couchDb.uri,
        username: couchDb.username,
        password: couchDb.password,
        dbName,
    };
    const vault = await createTemporaryVault("obsidian-livesync-partial-startup-");
    let session: ObsidianLiveSyncSession | undefined;

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
            pluginData: createE2eCouchDbPluginData(couchDbSettings, {
                showVerboseLog: true,
                lessInformationInLog: false,
            }),
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await prepareRemote(cli.binary, session.cliEnv);

        const seeded = await seedDatabaseOnlyEntries(cli.binary, session.cliEnv);
        const validSeed = seeded.find((entry) => entry.path === validPath);
        const failedSeed = seeded.find((entry) => entry.path === failedPath);
        if (!validSeed || !failedSeed) throw new Error("The database-only start-up fixtures were incomplete.");
        if (validSeed.children.length === 0 || failedSeed.children.length === 0) {
            throw new Error("The database-only fixtures did not create independently stored chunks.");
        }

        await session.app.stop();
        session = undefined;

        let partialNoticeObserved = false;
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            pluginStartup: "natural",
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            lifecycle: {
                afterPluginLoad: async ({ remoteDebuggingPort }) => {
                    await observePartialFailureNotice(remoteDebuggingPort);
                    partialNoticeObserved = true;
                },
            },
        });
        const readiness = await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        assertEqual(readiness.configured, true, "Self-hosted LiveSync lost its configuration on restart.");
        assertEqual(partialNoticeObserved, true, "The partial start-up failure Notice was not observed.");

        assertEqual(
            await readFile(join(vault.path, validPath), "utf8"),
            validContent,
            "The valid database-only file was not reflected during the same start-up scan."
        );

        const state = await inspectFailedPathState(cli.binary, session.cliEnv);
        assertEqual(state.databaseReady, true, "The local database did not remain ready after one file failed.");
        assertEqual(state.appReady, true, "One file failure kept the application unready.");
        assertEqual(state.fileExists, false, "The overlong path was unexpectedly reflected to the Linux Vault.");
        assertEqual(state.entryReadable, true, "The failed database entry was no longer readable.");
        assertEqual(state.metadataRevision, failedSeed.revision, "The failed database entry revision changed.");
        assertEqual(state.provenance, null, "A failed reflection was recorded as successful provenance.");
        assertEqual(
            state.logText.includes(failedPathLog),
            true,
            "The verbose log did not identify the path which failed during the start-up scan."
        );

        const retry = await retryFailedPath(cli.binary, session.cliEnv);
        assertEqual(
            retry.scanResult,
            "completed-with-file-failures",
            "A later scan did not retry and report the same individual file failure."
        );
        assertEqual(retry.appReady, true, "Retrying the failed path cleared application readiness.");
        assertEqual(retry.fileExists, false, "The overlong path was unexpectedly reflected during retry.");
        assertEqual(retry.entryReadable, true, "Retrying removed the failed database entry.");
        assertEqual(retry.metadataRevision, failedSeed.revision, "Retrying changed the failed database revision.");
        assertEqual(retry.provenance, null, "Retrying recorded a failed reflection as successful provenance.");

        console.log(`Ordinary start-up remained ready, reflected ${validPath}, and retained ${failedPath} for retry.`);
    } finally {
        if (session) {
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
