import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const snippetUpdatedContent = [
    "body {",
    "    --livesync-customisation-e2e-colour: #73548f;",
    "}",
    "",
    ".livesync-customisation-e2e {",
    "    background-color: var(--livesync-customisation-e2e-colour);",
    "}",
    "",
].join("\n");
const configPath = ".obsidian/livesync-customisation-e2e.json";
const configContent = JSON.stringify({ source: "customisation-sync", enabled: true }, null, 4) + "\n";
const pluginDir = ".obsidian/plugins/livesync-e2e-sample";
const pluginManifestPath = `${pluginDir}/manifest.json`;
const pluginMainPath = `${pluginDir}/main.js`;
const pluginStylesPath = `${pluginDir}/styles.css`;
const pluginManifestContent =
    JSON.stringify(
        {
            id: "livesync-e2e-sample",
            name: "LiveSync E2E Sample",
            version: "0.0.1",
            minAppVersion: "1.0.0",
            description: "A sample plug-in fixture for real Obsidian E2E.",
            author: "Self-hosted LiveSync",
            isDesktopOnly: false,
        },
        null,
        4
    ) + "\n";
const pluginMainContent = [
    "module.exports = class LiveSyncE2ESamplePlugin extends Plugin {",
    "    async onload() {",
    "        this.register(() => undefined);",
    "    }",
    "};",
    "",
].join("\n");
const pluginStylesContent = ".livesync-e2e-sample { color: #73548f; }\n";
const sourceDeviceName = "customisation-sync-a";
const targetDeviceName = "customisation-sync-b";

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

async function removeVaultFile(vaultPath: string, path: string): Promise<void> {
    await rm(join(vaultPath, path), { force: true });
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

async function storeCustomisationFile(cliBinary: string, env: NodeJS.ProcessEnv, path: string): Promise<void> {
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
            "const filename=path.split('/').pop();",
            "const existing=entries.some((entry)=>entry.startsWith(`ix:${term}/${category}/`)&&entry.endsWith(`%${filename}`));",
            "if(!result&&!existing){",
            "  throw new Error(`Could not store Customisation Sync file: path=${path}; term=${term}; category=${category}; stat=${JSON.stringify(stat)}; result=${JSON.stringify(result)}; entries=${JSON.stringify(entries)}`);",
            "}",
            "return JSON.stringify({ok:true,path,term,category,result:!!result,existing,entries});",
            "})()",
        ].join(""),
        env
    );
}

async function deleteCustomisationSyncEntry(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    category: "CONFIG" | "SNIPPET" | "PLUGIN_MAIN",
    name: string,
    term?: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const category=${JSON.stringify(category)};`,
            `const name=${JSON.stringify(name)};`,
            `const term=${JSON.stringify(term ?? "")};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('ConfigSync');",
            "const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "const entry=rows.map((row)=>row.doc).find((doc)=>doc?.path?.includes(`/${category}/`)&&doc.path?.includes(`/${name}%`)&&(!term||doc.path?.startsWith(`ix:${term}/`))&&!doc.deleted&&!doc._deleted)||false;",
            "if(!entry) throw new Error(`Could not find customisation sync entry to delete: ${category}/${name}`);",
            "if(!(await addOn.deleteConfigOnDatabase(entry.path))){",
            "  throw new Error(`Could not delete Customisation Sync entry: ${entry.path}`);",
            "}",
            "return JSON.stringify({ok:true,path:entry.path});",
            "})()",
        ].join(""),
        env
    );
}

async function waitForCustomisationEntry(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    category: "CONFIG" | "SNIPPET" | "PLUGIN_MAIN",
    name: string,
    term?: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ?? 15000)
): Promise<CustomisationEntry> {
    const entries = await waitForCustomisationEntries(cliBinary, env, category, name, 1, term, timeoutMs);
    return entries[0];
}

async function waitForCustomisationEntries(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    category: "CONFIG" | "SNIPPET" | "PLUGIN_MAIN",
    name: string,
    count: number,
    term?: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ?? 15000)
): Promise<CustomisationEntry[]> {
    return await evalObsidianJson<CustomisationEntry[]>(
        cliBinary,
        [
            "(async()=>{",
            `const category=${JSON.stringify(category)};`,
            `const name=${JSON.stringify(name)};`,
            `const count=${JSON.stringify(count)};`,
            `const term=${JSON.stringify(term ?? "")};`,
            `const timeoutMs=${JSON.stringify(timeoutMs)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const deadline=Date.now()+timeoutMs;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "let entries=[];",
            "while(Date.now()<deadline){",
            "  const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "  entries=rows.map((row)=>row.doc).filter((doc)=>doc?.path?.includes(`/${category}/`)&&doc.path?.includes(`/${name}%`)&&(!term||doc.path?.startsWith(`ix:${term}/`))&&Array.isArray(doc.children)&&doc.children.length>0);",
            "  if(entries.length>=count) break;",
            "  await sleep(250);",
            "}",
            "if(entries.length<count){",
            "  const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "  const found=rows.map((row)=>row.doc).filter((doc)=>doc?.path?.startsWith('ix:')).map((doc)=>({id:doc._id,path:doc.path,children:doc.children?.length??0}));",
            "  throw new Error(`Timed out waiting for customisation sync entries: ${category}/${name}; expected=${count}; entries=${JSON.stringify(found)}`);",
            "}",
            "return JSON.stringify(entries.map((entry)=>({id:entry._id,path:entry.path,children:entry.children||[]})));",
            "})()",
        ].join(""),
        env
    );
}

async function waitForCustomisationEntryAbsent(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    category: "CONFIG" | "SNIPPET" | "PLUGIN_MAIN",
    name: string,
    term?: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ?? 15000)
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const category=${JSON.stringify(category)};`,
            `const name=${JSON.stringify(name)};`,
            `const term=${JSON.stringify(term ?? "")};`,
            `const timeoutMs=${JSON.stringify(timeoutMs)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const deadline=Date.now()+timeoutMs;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "let entry=false;",
            "while(Date.now()<deadline){",
            "  const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "  entry=rows.map((row)=>row.doc).find((doc)=>doc?.path?.includes(`/${category}/`)&&doc.path?.includes(`/${name}%`)&&(!term||doc.path?.startsWith(`ix:${term}/`))&&!doc.deleted&&!doc._deleted)||false;",
            "  if(!entry) return JSON.stringify({ok:true});",
            "  await sleep(250);",
            "}",
            "throw new Error(`Timed out waiting for customisation sync entry deletion: ${category}/${name}; entry=${JSON.stringify(entry)}`);",
            "})()",
        ].join(""),
        env
    );
}

async function applyRemoteCustomisationEntry(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    category: "CONFIG" | "SNIPPET" | "PLUGIN_MAIN",
    name: string,
    term?: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const category=${JSON.stringify(category)};`,
            `const name=${JSON.stringify(name)};`,
            `const term=${JSON.stringify(term ?? "")};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('ConfigSync');",
            "const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "const entry=rows.map((row)=>row.doc).find((doc)=>doc?.path?.includes(`/${category}/`)&&doc.path?.includes(`/${name}%`)&&(!term||doc.path?.startsWith(`ix:${term}/`)))||false;",
            "if(!entry) throw new Error(`Could not find remote customisation entry: ${category}/${name}`);",
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

async function applyRemoteCustomisationGroup(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    category: "PLUGIN_MAIN",
    name: string,
    term?: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const category=${JSON.stringify(category)};`,
            `const name=${JSON.stringify(name)};`,
            `const term=${JSON.stringify(term ?? "")};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('ConfigSync');",
            "const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "const entries=rows.map((row)=>row.doc).filter((doc)=>doc?.path?.includes(`/${category}/`)&&doc.path?.includes(`/${name}%`)&&(!term||doc.path?.startsWith(`ix:${term}/`)));",
            "if(entries.length===0) throw new Error(`Could not find remote customisation entries: ${category}/${name}`);",
            "const display=addOn.createPluginDataFromV2(entries[0].path);",
            "if(!display) throw new Error(`Could not create Customisation Sync display entry: ${entries[0].path}`);",
            "for(const entry of entries){",
            "  const file=await addOn.createPluginDataExFileV2(entry.path);",
            "  if(!file) throw new Error(`Could not load Customisation Sync file entry: ${entry.path}`);",
            "  await display.setFile(file);",
            "}",
            "if(!(await addOn.applyDataV2(display))){",
            "  throw new Error(`Could not apply Customisation Sync group: ${category}/${name}`);",
            "}",
            "return JSON.stringify({ok:true,count:entries.length});",
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
    const configName = configPath.split("/").pop() ?? configPath;
    const pluginName = pluginDir.split("/").pop() ?? pluginDir;

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault A: ${vaultA.path}`);
        console.log(`Temporary vault B: ${vaultB.path}`);
        console.log(`Temporary CouchDB database: ${dbName}`);

        await writeVaultFile(vaultA.path, snippetPath, snippetContent);
        await writeVaultFile(vaultA.path, configPath, configContent);
        await writeVaultFile(vaultA.path, pluginManifestPath, pluginManifestContent);
        await writeVaultFile(vaultA.path, pluginMainPath, pluginMainContent);
        await writeVaultFile(vaultA.path, pluginStylesPath, pluginStylesContent);

        let session = await startConfiguredSession(context, vaultA, sourceDeviceName);
        const scanResult = await scanCustomisations(context.cliBinary, session.cliEnv);
        console.log(`Customisation scan files: ${scanResult.files.join(", ") || "(none)"}`);
        await storeCustomisationFile(context.cliBinary, session.cliEnv, snippetPath);
        await storeCustomisationFile(context.cliBinary, session.cliEnv, configPath);
        await storeCustomisationFile(context.cliBinary, session.cliEnv, pluginManifestPath);
        await storeCustomisationFile(context.cliBinary, session.cliEnv, pluginMainPath);
        await storeCustomisationFile(context.cliBinary, session.cliEnv, pluginStylesPath);
        const entry = await waitForCustomisationEntry(context.cliBinary, session.cliEnv, "SNIPPET", snippetName);
        const configEntry = await waitForCustomisationEntry(context.cliBinary, session.cliEnv, "CONFIG", configName);
        const pluginEntries = await waitForCustomisationEntries(
            context.cliBinary,
            session.cliEnv,
            "PLUGIN_MAIN",
            pluginName,
            3
        );
        await pushLocalChanges(context.cliBinary, session.cliEnv);
        await waitForCouchDbDocs(context.couchDb, context.dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            const entries = [entry, configEntry, ...pluginEntries];
            return entries.every(
                (target) => ids.has(target.id) && target.children.every((childId) => ids.has(childId))
            );
        });
        await session.app.stop();

        session = await startConfiguredSession(context, vaultB, targetDeviceName);
        await pushLocalChanges(context.cliBinary, session.cliEnv);
        await waitForCustomisationEntry(context.cliBinary, session.cliEnv, "SNIPPET", snippetName, sourceDeviceName);
        assertEqual(
            await pathExists(vaultB.path, snippetPath),
            false,
            "Customisation Sync snippet was reflected before explicit application."
        );
        await applyRemoteCustomisationEntry(
            context.cliBinary,
            session.cliEnv,
            "SNIPPET",
            snippetName,
            sourceDeviceName
        );
        const applied = await waitForPathContent(vaultB.path, snippetPath, (content) => content === snippetContent);
        await applyRemoteCustomisationEntry(context.cliBinary, session.cliEnv, "CONFIG", configName, sourceDeviceName);
        const appliedConfig = await waitForPathContent(vaultB.path, configPath, (content) => content === configContent);
        await applyRemoteCustomisationGroup(
            context.cliBinary,
            session.cliEnv,
            "PLUGIN_MAIN",
            pluginName,
            sourceDeviceName
        );
        const appliedPluginManifest = await waitForPathContent(
            vaultB.path,
            pluginManifestPath,
            (content) => content === pluginManifestContent
        );
        const appliedPluginMain = await waitForPathContent(
            vaultB.path,
            pluginMainPath,
            (content) => content === pluginMainContent
        );
        const appliedPluginStyles = await waitForPathContent(
            vaultB.path,
            pluginStylesPath,
            (content) => content === pluginStylesContent
        );
        await session.app.stop();

        assertEqual(applied, snippetContent, "Customisation Sync snippet content did not match after application.");
        assertEqual(appliedConfig, configContent, "Customisation Sync config content did not match after application.");
        assertEqual(
            appliedPluginManifest,
            pluginManifestContent,
            "Customisation Sync plug-in manifest did not match after application."
        );
        assertEqual(appliedPluginMain, pluginMainContent, "Customisation Sync plug-in main file did not match.");
        assertEqual(appliedPluginStyles, pluginStylesContent, "Customisation Sync plug-in stylesheet did not match.");

        await writeVaultFile(vaultA.path, snippetPath, snippetUpdatedContent);
        session = await startConfiguredSession(context, vaultA, sourceDeviceName);
        await storeCustomisationFile(context.cliBinary, session.cliEnv, snippetPath);
        await waitForCustomisationEntry(context.cliBinary, session.cliEnv, "SNIPPET", snippetName);
        await pushLocalChanges(context.cliBinary, session.cliEnv);
        await session.app.stop();

        session = await startConfiguredSession(context, vaultB, targetDeviceName);
        await pushLocalChanges(context.cliBinary, session.cliEnv);
        await applyRemoteCustomisationEntry(
            context.cliBinary,
            session.cliEnv,
            "SNIPPET",
            snippetName,
            sourceDeviceName
        );
        const updated = await waitForPathContent(
            vaultB.path,
            snippetPath,
            (content) => content === snippetUpdatedContent
        );
        await session.app.stop();
        assertEqual(updated, snippetUpdatedContent, "Updated Customisation Sync snippet did not apply.");

        await removeVaultFile(vaultA.path, snippetPath);
        session = await startConfiguredSession(context, vaultA, sourceDeviceName);
        await deleteCustomisationSyncEntry(context.cliBinary, session.cliEnv, "SNIPPET", snippetName, sourceDeviceName);
        await waitForCustomisationEntryAbsent(
            context.cliBinary,
            session.cliEnv,
            "SNIPPET",
            snippetName,
            sourceDeviceName
        );
        await pushLocalChanges(context.cliBinary, session.cliEnv);
        await session.app.stop();

        session = await startConfiguredSession(context, vaultB, targetDeviceName);
        await pushLocalChanges(context.cliBinary, session.cliEnv);
        await waitForCustomisationEntryAbsent(
            context.cliBinary,
            session.cliEnv,
            "SNIPPET",
            snippetName,
            sourceDeviceName
        );
        await session.app.stop();

        console.log(
            `Customisation Sync applied snippet, config, and plug-in fixtures, then propagated snippet update and sync-data deletion.`
        );
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
