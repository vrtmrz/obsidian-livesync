import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
    type CouchDbConfig,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    configureCouchDb,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";
process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ??= "20000";

const snippetPath = ".obsidian/snippets/livesync-customisation-e2e.css";
const snippetContent = [
    "body {",
    "    --livesync-customisation-e2e-colour: #3d6f54;",
    "}",
    "",
    ".livesync-customisation-e2e {",
    "    color: var(--livesync-customisation-e2e-colour);",
    "}",
    "",
].join("\n");

type RunnerContext = {
    binary: string;
    cliBinary: string;
    couchDb: CouchDbConfig;
    dbName: string;
};

type CustomisationEntry = {
    id: string;
    path: string;
    children: string[];
};

type CustomisationScanResult = {
    enabled: boolean;
    useV2: boolean;
    device: string;
    configDir: string;
    files: string[];
};

async function writeVaultFile(vaultPath: string, path: string, content: string): Promise<void> {
    const fullPath = join(vaultPath, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
}

async function readVaultFile(vaultPath: string, path: string): Promise<string> {
    return await readFile(join(vaultPath, path), "utf-8");
}

async function pathExists(vaultPath: string, path: string): Promise<boolean> {
    try {
        await readFile(join(vaultPath, path));
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
    predicate: (content: string) => boolean,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 10000)
): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastContent = "";
    while (Date.now() < deadline) {
        if (await pathExists(vaultPath, path)) {
            lastContent = await readVaultFile(vaultPath, path);
            if (predicate(lastContent)) {
                return lastContent;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${path}. Last content:\n${lastContent}`);
}

async function startConfiguredSession(
    context: RunnerContext,
    vault: TemporaryVault,
    deviceName: string
): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
    });
    await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
    await configureCouchDb(
        context.cliBinary,
        session.cliEnv,
        {
            uri: context.couchDb.uri,
            username: context.couchDb.username,
            password: context.couchDb.password,
            dbName: context.dbName,
        },
        {
            deviceAndVaultName: deviceName,
            usePluginSync: true,
            usePluginSyncV2: true,
            autoSweepPlugins: false,
            autoSweepPluginsPeriodic: false,
            syncInternalFiles: false,
        }
    );
    await evalObsidianJson<unknown>(
        context.cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `core.services.setting.setDeviceAndVaultName(${JSON.stringify(deviceName)});`,
            "await core.services.setting.saveSettingData();",
            "return JSON.stringify({device:core.services.setting.getDeviceAndVaultName()});",
            "})()",
        ].join(""),
        session.cliEnv
    );
    await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
    await prepareRemote(context.cliBinary, session.cliEnv);
    return session;
}

async function scanCustomisations(cliBinary: string, env: NodeJS.ProcessEnv): Promise<CustomisationScanResult> {
    return await evalObsidianJson<CustomisationScanResult>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('ConfigSync');",
            "const before=await addOn.scanInternalFiles();",
            "await addOn.scanAllConfigFiles(false);",
            "return JSON.stringify({",
            "ok:true,",
            "enabled:core.settings.usePluginSync,",
            "useV2:core.settings.usePluginSyncV2,",
            "device:core.services.setting.getDeviceAndVaultName(),",
            "configDir:addOn.configDir,",
            "files:before,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function storeCustomisationSnippet(cliBinary: string, env: NodeJS.ProcessEnv, path: string): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('ConfigSync');",
            "const term=core.services.setting.getDeviceAndVaultName();",
            "const stat=await core.storageAccess.statHidden(path);",
            "const category=addOn.getFileCategory(path);",
            "const result=await addOn.storeCustomizationFiles(path,term);",
            "const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "const entries=rows.map((row)=>row.doc).filter((doc)=>doc?.path?.startsWith('ix:')).map((doc)=>doc.path);",
            "if(!result){",
            "  throw new Error(`Could not store Customisation Sync snippet: path=${path}; term=${term}; category=${category}; stat=${JSON.stringify(stat)}; result=${JSON.stringify(result)}; entries=${JSON.stringify(entries)}`);",
            "}",
            "return JSON.stringify({ok:true,path,term,category,entries});",
            "})()",
        ].join(""),
        env
    );
}

async function waitForCustomisationEntry(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    filename: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ?? 15000)
): Promise<CustomisationEntry> {
    return await evalObsidianJson<CustomisationEntry>(
        cliBinary,
        [
            "(async()=>{",
            `const filename=${JSON.stringify(filename)};`,
            `const timeoutMs=${JSON.stringify(timeoutMs)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const deadline=Date.now()+timeoutMs;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "let entry=false;",
            "while(Date.now()<deadline){",
            "  const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "  entry=rows.map((row)=>row.doc).find((doc)=>doc?.path?.includes('/SNIPPET/')&&doc.path?.endsWith(`%${filename}`))||false;",
            "  if(entry&&entry._id&&Array.isArray(entry.children)&&entry.children.length>0) break;",
            "  await sleep(250);",
            "}",
            "if(!entry||!entry._id){",
            "  const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "  const entries=rows.map((row)=>row.doc).filter((doc)=>doc?.path?.startsWith('ix:')).map((doc)=>({id:doc._id,path:doc.path,children:doc.children?.length??0}));",
            "  throw new Error(`Timed out waiting for customisation sync entry: ${filename}; entries=${JSON.stringify(entries)}`);",
            "}",
            "return JSON.stringify({id:entry._id,path:entry.path,children:entry.children||[]});",
            "})()",
        ].join(""),
        env
    );
}

async function applyRemoteCustomisationSnippet(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    filename: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const filename=${JSON.stringify(filename)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('ConfigSync');",
            "const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "const entry=rows.map((row)=>row.doc).find((doc)=>doc?.path?.includes('/SNIPPET/')&&doc.path?.endsWith(`%${filename}`))||false;",
            "if(!entry) throw new Error(`Could not find remote customisation entry: ${filename}`);",
            "const display=addOn.createPluginDataFromV2(entry.path);",
            "if(!display) throw new Error(`Could not create Customisation Sync display entry: ${entry.path}`);",
            "const file=await addOn.createPluginDataExFileV2(entry.path);",
            "if(!file) throw new Error(`Could not load Customisation Sync file entry: ${entry.path}`);",
            "await display.setFile(file);",
            "if(!(await addOn.applyDataV2(display))){",
            "  throw new Error(`Could not apply Customisation Sync entry: ${entry.path}`);",
            "}",
            "return JSON.stringify({ok:true,path:entry.path});",
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
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "customisation-sync");
    const vaultA = await createTemporaryVault();
    const vaultB = await createTemporaryVault();
    const context: RunnerContext = { binary, cliBinary: cli.binary, couchDb, dbName };
    const snippetPathParts = snippetPath.split("/");
    const snippetName = snippetPathParts[snippetPathParts.length - 1] ?? snippetPath;

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault A: ${vaultA.path}`);
        console.log(`Temporary vault B: ${vaultB.path}`);
        console.log(`Temporary CouchDB database: ${dbName}`);

        await writeVaultFile(vaultA.path, snippetPath, snippetContent);

        let session = await startConfiguredSession(context, vaultA, "customisation-sync-a");
        const scanResult = await scanCustomisations(context.cliBinary, session.cliEnv);
        console.log(`Customisation scan files: ${scanResult.files.join(", ") || "(none)"}`);
        await storeCustomisationSnippet(context.cliBinary, session.cliEnv, snippetPath);
        const entry = await waitForCustomisationEntry(context.cliBinary, session.cliEnv, snippetName);
        await pushLocalChanges(context.cliBinary, session.cliEnv);
        await waitForCouchDbDocs(context.couchDb, context.dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            return ids.has(entry.id) && entry.children.every((childId) => ids.has(childId));
        });
        await session.app.stop();

        session = await startConfiguredSession(context, vaultB, "customisation-sync-b");
        await pushLocalChanges(context.cliBinary, session.cliEnv);
        await waitForCustomisationEntry(context.cliBinary, session.cliEnv, snippetName);
        assertEqual(
            await pathExists(vaultB.path, snippetPath),
            false,
            "Customisation Sync snippet was reflected before explicit application."
        );
        await applyRemoteCustomisationSnippet(context.cliBinary, session.cliEnv, snippetName);
        const applied = await waitForPathContent(vaultB.path, snippetPath, (content) => content === snippetContent);
        await session.app.stop();

        assertEqual(applied, snippetContent, "Customisation Sync snippet content did not match after application.");
        console.log(`Customisation Sync applied snippet ${snippetName} from the remote database.`);
    } finally {
        await vaultA.dispose();
        await vaultB.dispose();
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
