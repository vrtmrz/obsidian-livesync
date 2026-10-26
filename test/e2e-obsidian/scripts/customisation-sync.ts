import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
    MODE_AUTOMATIC,
    VERSIONING_DOCID,
    type ObsidianLiveSyncSettings,
    type LoadedEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { readAsBlob } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { ENCRYPTED_INTERNAL_METADATA_FEATURE, REMOTE_FEATURE_GENERATION } from "@vrtmrz/livesync-commonlib/replication";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchCouchDbDocument,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
    type CouchDbConfig,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertE2eCompatibilityMarker,
    assertEqual,
    configureCouchDb,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { waitForVisibleObsidianDialogue, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";
import type { Locator, Page } from "playwright";

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
const pluginDisplayName = "LiveSync E2E Sample";
const pluginDataPath = `${pluginDir}/data.json`;
const pluginDataContent = JSON.stringify({ source: "customisation-sync-a", enabled: true }, null, 4) + "\n";
const targetPluginDataContent = JSON.stringify({ source: "customisation-sync-b", enabled: true }, null, 4) + "\n";
const existingAutomaticKey = "SNIPPET/livesync-e2e-existing-automatic.css";
const existingAutomaticSelections: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"] = {
    [existingAutomaticKey]: {
        key: existingAutomaticKey,
        mode: MODE_AUTOMATIC,
        files: ["snippets/livesync-e2e-existing-automatic.css"],
    },
};
const identicalSnippetPath = ".obsidian/snippets/livesync-customisation-e2e-identical.css";
const identicalSnippetContent = ".livesync-customisation-identical { color: #3d6f54; }\n";
const differentSnippetPath = ".obsidian/snippets/livesync-customisation-e2e-different.css";
const sourceDifferentSnippetContent = ".livesync-customisation-different { color: #73548f; }\n";
const targetDifferentSnippetContent = ".livesync-customisation-different { color: #3d6f54; }\n";
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
const targetPluginStylesContent = ".livesync-e2e-sample { color: #3d6f54; }\n";
// These dates straddle a signed 32-bit wrap boundary for millisecond timestamps.
const sourcePluginMtime = new Date("2026-09-01T12:00:00.000Z");
const targetPluginMtime = new Date("2026-09-15T12:00:00.000Z");
const matchingMtime = new Date("2026-09-15T12:00:00.000Z");
const sourceDeviceName = "customisation-sync-a";
const targetDeviceName = "customisation-sync-b";
const visibilityFixtures = [
    { path: identicalSnippetPath, source: identicalSnippetContent, target: identicalSnippetContent },
    { path: differentSnippetPath, source: sourceDifferentSnippetContent, target: targetDifferentSnippetContent },
] as const;
const pluginFixtures = [
    { path: pluginManifestPath, source: pluginManifestContent, target: pluginManifestContent },
    { path: pluginMainPath, source: pluginMainContent, target: pluginMainContent },
    { path: pluginStylesPath, source: pluginStylesContent, target: targetPluginStylesContent },
] as const;

type CustomisationSyncCase = "all" | "visibility" | "mtime" | "automatic";
type AutomaticInitialAction = "Overwrite Remote" | "Overwrite Local" | "Use newer";

type CustomisationSyncTestGlobal = typeof globalThis & {
    app?: { commands?: { executeCommandById(commandId: string): boolean } };
};

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

type AutomaticSyncSnapshot = {
    syncInternalFiles: boolean;
    pluginSyncExtendedSetting: Record<string, { key: string; mode: number; files: string[] }>;
    hiddenFiles: { path: string; rev: string; deleted: boolean }[];
    processedFiles: [string, string | undefined][];
    processedDatabaseFiles: [string, string | undefined][];
};

async function writeVaultFile(vaultPath: string, path: string, content: string): Promise<void> {
    const fullPath = join(vaultPath, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
}

async function setVaultFileMtime(vaultPath: string, path: string, mtime: Date): Promise<void> {
    const fullPath = join(vaultPath, path);
    await utimes(fullPath, mtime, mtime);
}

function selectedCase(): CustomisationSyncCase {
    const args = process.argv.slice(2);
    if (args.length === 0) return "all";
    const arg = args[0];
    if (args.length !== 1 || !arg?.startsWith("--case=")) {
        throw new Error("Usage: test:e2e:obsidian:customisation-sync [--case=all|visibility|mtime|automatic]");
    }
    const selected = arg.slice("--case=".length);
    if (selected === "all" || selected === "visibility" || selected === "mtime" || selected === "automatic")
        return selected;
    throw new Error(`Unknown Customisation Sync E2E case: ${selected}`);
}

async function assertSourceCandidate(row: Locator, term: string, name: string): Promise<void> {
    const candidate = row.locator(`select option[value="${term}"]`);
    try {
        await candidate.waitFor({ state: "attached", timeout: 10000 });
    } catch {
        throw new Error(`Customisation Sync ${name} source candidate was not available: ${term}`);
    }
}

async function inspectCustomisationVisibility(session: ObsidianLiveSyncSession): Promise<void> {
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const opened = await page.evaluate(() =>
            (globalThis as CustomisationSyncTestGlobal).app?.commands?.executeCommandById(
                "obsidian-livesync:livesync-plugin-dialog-ex"
            )
        );
        if (opened !== true) throw new Error("Could not open the Customisation Sync dialogue command.");
        const dialogue = await waitForVisibleObsidianDialogue(page, "Customization Sync (Beta3)");
        const identicalName = identicalSnippetPath.split("/").pop() ?? identicalSnippetPath;
        const differentName = differentSnippetPath.split("/").pop() ?? differentSnippetPath;
        const identicalRow = dialogue.locator(".labelrow").filter({ hasText: identicalName }).first();
        const differentRow = dialogue.locator(".labelrow").filter({ hasText: differentName }).first();
        const hideCheckbox = dialogue
            .locator("label")
            .filter({ hasText: "Hide not applicable items" })
            .locator('input[type="checkbox"]');

        await identicalRow.waitFor({ state: "visible", timeout: 10000 });
        await differentRow.waitFor({ state: "visible", timeout: 10000 });
        await assertSourceCandidate(identicalRow, sourceDeviceName, "identical item");
        await assertSourceCandidate(differentRow, sourceDeviceName, "different item");
        if (await hideCheckbox.isChecked()) throw new Error("Hide not applicable items started checked.");

        await hideCheckbox.check();
        await identicalRow.waitFor({ state: "hidden", timeout: 10000 });
        await differentRow.waitFor({ state: "visible", timeout: 10000 });
        await assertSourceCandidate(differentRow, sourceDeviceName, "different item while hiding identical items");

        await hideCheckbox.uncheck();
        await identicalRow.waitFor({ state: "visible", timeout: 10000 });
        await assertSourceCandidate(identicalRow, sourceDeviceName, "identical item after unhiding");
        await page.keyboard.press("Escape");
        await dialogue.waitFor({ state: "hidden", timeout: 10000 });
    });
}

async function inspectPluginFreshnessAndNewestSelection(session: ObsidianLiveSyncSession): Promise<void> {
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const opened = await page.evaluate(() =>
            (globalThis as CustomisationSyncTestGlobal).app?.commands?.executeCommandById(
                "obsidian-livesync:livesync-plugin-dialog-ex"
            )
        );
        if (opened !== true) throw new Error("Could not open the Customisation Sync dialogue command.");
        const dialogue = await waitForVisibleObsidianDialogue(page, "Customization Sync (Beta3)");
        const pluginMainRow = dialogue.locator(`.filerow:has(select option[value="${sourceDeviceName}"])`).first();
        const sourceOption = pluginMainRow.locator(`select option[value="${sourceDeviceName}"]`);
        const sourceSelect = pluginMainRow.locator("select");
        const failures: string[] = [];

        await sourceOption.waitFor({ state: "attached", timeout: 10000 });
        await sourceSelect.selectOption(sourceDeviceName);
        try {
            await pluginMainRow.locator(".chip.modified").filter({ hasText: "Older" }).waitFor({
                state: "visible",
                timeout: 10000,
            });
        } catch {
            const freshness = (await pluginMainRow.locator(".chip.modified").textContent())?.trim() || "(empty)";
            failures.push(`Expected the remote multi-file plug-in copy to be Older; found '${freshness}'.`);
        }

        await dialogue.getByRole("button", { name: "Deselect all", exact: true }).click();
        await sourceSelect.waitFor({ state: "visible", timeout: 10000 });
        await page.waitForTimeout(50);
        if ((await sourceSelect.inputValue()) !== "") {
            throw new Error("Deselect all did not clear the selected Customisation Sync source.");
        }

        await dialogue.getByRole("button", { name: "Select All Shiny", exact: true }).click();
        await page.waitForTimeout(100);
        if ((await sourceSelect.inputValue()) !== "") {
            failures.push("Select All Shiny chose the older multi-file plug-in copy.");
        }
        if (failures.length > 0) throw new Error(failures.join("\n"));
        await page.keyboard.press("Escape");
        await dialogue.waitFor({ state: "hidden", timeout: 10000 });
    });
}

async function openAutomaticModeForPlugin(page: Page, pluginName: string): Promise<Locator> {
    const opened = await page.evaluate(() =>
        (globalThis as CustomisationSyncTestGlobal).app?.commands?.executeCommandById(
            "obsidian-livesync:livesync-plugin-dialog-ex"
        )
    );
    if (opened !== true) throw new Error("Could not open the Customisation Sync dialogue command.");
    const dialogue = await waitForVisibleObsidianDialogue(page, "Customization Sync (Beta3)");
    const pluginRow = dialogue.locator(".labelrow").filter({ hasText: pluginName }).first();
    await pluginRow.waitFor({ state: "visible", timeout: 10000 });
    await pluginRow.locator("button.status").click();
    const automaticOption = page.locator(".menu-item").filter({ hasText: "Automatic" }).last();
    await automaticOption.waitFor({ state: "visible", timeout: 10000 });
    await automaticOption.click();
    return dialogue;
}

async function selectAutomaticInitialAction(page: Page, label: AutomaticInitialAction): Promise<void> {
    const action = page.locator(".menu-item").filter({ hasText: label }).last();
    await action.waitFor({ state: "visible", timeout: 10000 });
    await action.click();
}

async function readAutomaticSyncSnapshot(cliBinary: string, env: NodeJS.ProcessEnv): Promise<AutomaticSyncSnapshot> {
    return await evalObsidianJson<AutomaticSyncSnapshot>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const hidden=core.getAddOn('HiddenFileSync');",
            "const files=await hidden.getAllDatabaseFiles();",
            "const processed=(cache)=>Array.from(cache.keys()).sort().map((path)=>[path,cache.get(path)]);",
            "return JSON.stringify({",
            "syncInternalFiles:core.settings.syncInternalFiles,",
            "pluginSyncExtendedSetting:core.settings.pluginSyncExtendedSetting,",
            "hiddenFiles:files.map((entry)=>{const path=hidden.getPath(entry);return {path:path.startsWith('i:')?path.slice(2):path,rev:entry._rev??'',deleted:!!(entry.deleted||entry._deleted)};}).sort((a,b)=>a.path.localeCompare(b.path)),",
            "processedFiles:processed(hidden._fileInfoLastProcessed),",
            "processedDatabaseFiles:processed(hidden._databaseInfoLastProcessed),",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function readAutomaticFileContents(context: RunnerContext, session: ObsidianLiveSyncSession) {
    const files = await evalObsidianJson<
        { path: string; entry: LoadedEntry | false; local: string; localMtime: number }[]
    >(
        context.cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `const paths=${JSON.stringify([pluginStylesPath, pluginDataPath])};`,
            "const files=await Promise.all(paths.map(async(path)=>{",
            "const entry=await core.localDatabase.getDBEntry('i:'+path,undefined,false,true);",
            "const stat=await app.vault.adapter.stat(path);",
            "if(!stat) throw new Error('Missing Automatic fixture file: '+path);",
            "return {path,entry,local:await app.vault.adapter.read(path),localMtime:stat.mtime};",
            "}));",
            "return JSON.stringify(files);",
            "})()",
        ].join(""),
        session.cliEnv
    );
    return await Promise.all(
        files.map(async (file) => ({
            path: file.path,
            stored: file.entry ? await readAsBlob(file.entry).text() : null,
            storedMtime: file.entry ? file.entry.mtime : 0,
            local: file.local,
            localMtime: file.localMtime,
        }))
    );
}

async function setHiddenSyncEnabledForFixture(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    enabled: boolean
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `core.settings.syncInternalFiles=${JSON.stringify(enabled)};`,
            "return JSON.stringify({syncInternalFiles:core.settings.syncInternalFiles});",
            "})()",
        ].join(""),
        env
    );
}

async function inspectAutomaticSyncSelection(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    vault: TemporaryVault,
    pluginName: string,
    initialAction: AutomaticInitialAction
): Promise<void> {
    const noticeText =
        "Hidden File Sync is disabled on this device. Enable it in Sync Settings before using Automatic or initialising hidden files.";
    const trackedFiles = [pluginStylesPath, pluginDataPath];
    const contentsBefore = await Promise.all(trackedFiles.map((path) => readVaultFile(vault.path, path)));
    const disabledBefore = await readAutomaticSyncSnapshot(context.cliBinary, session.cliEnv);
    assertEqual(
        JSON.stringify(disabledBefore.pluginSyncExtendedSetting[existingAutomaticKey]),
        JSON.stringify(existingAutomaticSelections[existingAutomaticKey]),
        "The fixture did not retain the saved Automatic selection while Hidden File Sync was disabled."
    );

    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const dialogue = await openAutomaticModeForPlugin(page, pluginDisplayName);
        const notice = page.locator(".notice:visible").filter({ hasText: noticeText }).last();
        await notice.waitFor({ state: "visible", timeout: 10000 });
        const initialActionMenu = page.locator(".menu:visible").filter({ hasText: "Initial Action" });
        if ((await initialActionMenu.count()) !== 0) {
            throw new Error("Automatic displayed an Initial Action menu while Hidden File Sync was disabled.");
        }
        await page.keyboard.press("Escape");
        await dialogue.waitFor({ state: "hidden", timeout: 10000 });
        await notice.click({ force: true });
        await notice.waitFor({ state: "hidden", timeout: 10000 });
    });

    const disabledAfter = await readAutomaticSyncSnapshot(context.cliBinary, session.cliEnv);
    const contentsAfter = await Promise.all(trackedFiles.map((path) => readVaultFile(vault.path, path)));
    if (JSON.stringify(disabledAfter) !== JSON.stringify(disabledBefore)) {
        throw new Error(
            `Automatic changed Hidden File Sync state while it was disabled: ${JSON.stringify({
                before: disabledBefore,
                after: disabledAfter,
            })}`
        );
    }
    assertEqual(
        JSON.stringify(contentsAfter),
        JSON.stringify(contentsBefore),
        "Automatic changed plug-in files while Hidden File Sync was disabled."
    );

    // Exercise the second guard: the user may open Initial Action while enabled,
    // then disable Hidden File Sync before choosing a direction.
    await setHiddenSyncEnabledForFixture(context.cliBinary, session.cliEnv, true);
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        await openAutomaticModeForPlugin(page, pluginDisplayName);
        const initialActionMenu = page.locator(".menu:visible").filter({ hasText: "Initial Action" });
        await initialActionMenu.waitFor({ state: "visible", timeout: 10000 });
    });
    await setHiddenSyncEnabledForFixture(context.cliBinary, session.cliEnv, false);
    const beforeDisabledAction = await readAutomaticSyncSnapshot(context.cliBinary, session.cliEnv);
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        await selectAutomaticInitialAction(page, "Overwrite Remote");
        const notice = page.locator(".notice:visible").filter({ hasText: noticeText }).last();
        await notice.waitFor({ state: "visible", timeout: 10000 });
        await notice.click({ force: true });
        await notice.waitFor({ state: "hidden", timeout: 10000 });
    });
    const afterDisabledAction = await readAutomaticSyncSnapshot(context.cliBinary, session.cliEnv);
    if (JSON.stringify(afterDisabledAction) !== JSON.stringify(beforeDisabledAction)) {
        throw new Error(
            `Automatic changed Hidden File Sync state after it was disabled from Initial Action: ${JSON.stringify({
                before: beforeDisabledAction,
                after: afterDisabledAction,
            })}`
        );
    }
    assertEqual(
        JSON.stringify(await Promise.all(trackedFiles.map((path) => readVaultFile(vault.path, path)))),
        JSON.stringify(contentsBefore),
        "Automatic changed plug-in files after Hidden File Sync was disabled from Initial Action."
    );
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        await page.keyboard.press("Escape");
    });

    await setHiddenSyncEnabledForFixture(context.cliBinary, session.cliEnv, true);
    if (initialAction !== "Overwrite Remote") {
        const fixtures = [
            {
                path: pluginStylesPath,
                stored: pluginStylesContent,
                local: targetPluginStylesContent,
                storedIsNewer: true,
            },
            {
                path: pluginDataPath,
                stored: pluginDataContent,
                local: targetPluginDataContent,
                storedIsNewer: false,
            },
        ];
        const actualFiles = await readAutomaticFileContents(context, session);
        for (const fixture of fixtures) {
            const actual = actualFiles.find((file) => file.path === fixture.path);
            if (
                !actual ||
                actual.stored !== fixture.stored ||
                actual.local !== fixture.local ||
                actual.storedMtime > actual.localMtime !== fixture.storedIsNewer ||
                actual.storedMtime === actual.localMtime
            ) {
                throw new Error(
                    `Automatic direction fixture did not retain distinct contents and modification times: ${JSON.stringify(actual)}`
                );
            }
        }
    }
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        const dialogue = await openAutomaticModeForPlugin(page, pluginDisplayName);
        await selectAutomaticInitialAction(page, initialAction);
        for (const label of ["MAIN", "DATA"]) {
            const row = dialogue.locator(".filerow").filter({ hasText: label }).first();
            await row.locator(".statusnote").filter({ hasText: "Automatic" }).waitFor({ state: "visible" });
        }
        await page.keyboard.press("Escape");
        await dialogue.waitFor({ state: "hidden", timeout: 10000 });
    });

    for (const path of [pluginManifestPath, pluginMainPath, pluginStylesPath, pluginDataPath]) {
        await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, path, { hidden: true });
    }
    const enabled = await readAutomaticSyncSnapshot(context.cliBinary, session.cliEnv);
    const mainMode = enabled.pluginSyncExtendedSetting[`PLUGIN_MAIN/${pluginName}`];
    const dataMode = enabled.pluginSyncExtendedSetting[`PLUGIN_DATA/${pluginName}`];
    if (mainMode?.mode !== MODE_AUTOMATIC || dataMode?.mode !== MODE_AUTOMATIC) {
        throw new Error(
            `Automatic did not save both plug-in group child settings: ${JSON.stringify({ mainMode, dataMode })}`
        );
    }
    assertEqual(
        JSON.stringify([...mainMode.files].sort()),
        JSON.stringify([
            `plugins/${pluginName}/main.js`,
            `plugins/${pluginName}/manifest.json`,
            `plugins/${pluginName}/styles.css`,
        ]),
        "Automatic did not select the PLUGIN_MAIN files."
    );
    assertEqual(
        JSON.stringify([...dataMode.files].sort()),
        JSON.stringify([`plugins/${pluginName}/data.json`]),
        "Automatic did not select the PLUGIN_DATA file."
    );
    assertEqual(
        enabled.hiddenFiles.filter((entry) => entry.path.startsWith(pluginDir + "/")).length,
        4,
        "Automatic did not initialise all files in the PLUGIN_ALL group."
    );
    const expectedFiles = [
        {
            path: pluginStylesPath,
            content: initialAction === "Overwrite Remote" ? targetPluginStylesContent : pluginStylesContent,
        },
        {
            path: pluginDataPath,
            content: initialAction === "Overwrite Local" ? pluginDataContent : targetPluginDataContent,
        },
    ];
    const deadline = Date.now() + 15000;
    let actualFiles = await readAutomaticFileContents(context, session);
    const contentsMatch = () =>
        actualFiles.every(
            (file, index) => file.stored === expectedFiles[index].content && file.local === expectedFiles[index].content
        );
    while (!contentsMatch() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        actualFiles = await readAutomaticFileContents(context, session);
    }
    if (!contentsMatch()) {
        throw new Error(`${initialAction} did not apply both MAIN and DATA: ${JSON.stringify(actualFiles)}`);
    }
    await pushLocalChanges(context.cliBinary, session.cliEnv);
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
    deviceName: string,
    settings: Partial<Pick<ObsidianLiveSyncSettings, "syncInternalFiles" | "pluginSyncExtendedSetting">> = {}
): Promise<ObsidianLiveSyncSession> {
    const couchDbSettings = {
        uri: context.couchDb.uri,
        username: context.couchDb.username,
        password: context.couchDb.password,
        dbName: context.dbName,
    };
    const customisationSettings = {
        encrypt: true,
        passphrase: "internal-metadata-e2e-secret",
        usePathObfuscation: true,
        encryptInternalMetadata: true,
        deviceAndVaultName: deviceName,
        usePluginSync: true,
        usePluginSyncV2: true,
        autoSweepPlugins: false,
        autoSweepPluginsPeriodic: false,
        syncInternalFiles: false,
        ...settings,
    };
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        // This scenario exercises Customisation Sync, not onboarding. Seed a
        // configured Vault and its device-local compatibility acknowledgement.
        pluginData: createE2eCouchDbPluginData(couchDbSettings, customisationSettings),
        localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
    });
    await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
    await assertE2eCompatibilityMarker(context.cliBinary, session.cliEnv);
    if (Object.keys(settings.pluginSyncExtendedSetting ?? {}).length > 0) {
        const restoredSelections = await evalObsidianJson<ObsidianLiveSyncSettings["pluginSyncExtendedSetting"]>(
            context.cliBinary,
            "JSON.stringify(app.plugins.plugins['obsidian-livesync'].core.settings.pluginSyncExtendedSetting)",
            session.cliEnv
        );
        assertEqual(
            JSON.stringify(restoredSelections),
            JSON.stringify(settings.pluginSyncExtendedSetting),
            "The saved Automatic selection changed during start-up."
        );
    }
    await configureCouchDb(context.cliBinary, session.cliEnv, couchDbSettings, customisationSettings);
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
    category: "CONFIG" | "SNIPPET" | "PLUGIN_MAIN" | "PLUGIN_DATA",
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
    category: "CONFIG" | "SNIPPET" | "PLUGIN_MAIN" | "PLUGIN_DATA",
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
    category: "CONFIG" | "SNIPPET" | "PLUGIN_MAIN" | "PLUGIN_DATA",
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

async function runWorkflow(
    testCase: CustomisationSyncCase,
    initialAction: AutomaticInitialAction = "Overwrite Remote"
): Promise<void> {
    const testVisibility = testCase === "all" || testCase === "visibility";
    const testMtime = testCase === "all" || testCase === "mtime";
    const testAutomatic = testCase === "automatic";
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
        if (testAutomatic) {
            await writeVaultFile(vaultA.path, pluginDataPath, pluginDataContent);
            await setVaultFileMtime(vaultA.path, pluginStylesPath, targetPluginMtime);
            await setVaultFileMtime(vaultA.path, pluginDataPath, sourcePluginMtime);
        }
        if (testVisibility) {
            for (const fixture of visibilityFixtures) {
                await writeVaultFile(vaultA.path, fixture.path, fixture.source);
                await setVaultFileMtime(vaultA.path, fixture.path, matchingMtime);
            }
        }
        if (testMtime) {
            for (const fixture of pluginFixtures) {
                await setVaultFileMtime(vaultA.path, fixture.path, sourcePluginMtime);
            }
        }
        if (testVisibility) {
            for (const fixture of visibilityFixtures) {
                await writeVaultFile(vaultB.path, fixture.path, fixture.target);
                await setVaultFileMtime(vaultB.path, fixture.path, matchingMtime);
            }
        }
        if (testMtime) {
            for (const fixture of pluginFixtures) {
                await writeVaultFile(vaultB.path, fixture.path, fixture.target);
                await setVaultFileMtime(vaultB.path, fixture.path, targetPluginMtime);
            }
        }
        if (testAutomatic) {
            for (const fixture of pluginFixtures) {
                await writeVaultFile(vaultB.path, fixture.path, fixture.target);
            }
            await writeVaultFile(vaultB.path, pluginDataPath, targetPluginDataContent);
            await setVaultFileMtime(vaultB.path, pluginStylesPath, sourcePluginMtime);
            await setVaultFileMtime(vaultB.path, pluginDataPath, targetPluginMtime);
        }

        let session = await startConfiguredSession(context, vaultA, sourceDeviceName);
        const scanResult = await scanCustomisations(context.cliBinary, session.cliEnv);
        console.log(`Customisation scan files: ${scanResult.files.join(", ") || "(none)"}`);
        await storeCustomisationFile(context.cliBinary, session.cliEnv, snippetPath);
        await storeCustomisationFile(context.cliBinary, session.cliEnv, configPath);
        for (const fixture of pluginFixtures) {
            await storeCustomisationFile(context.cliBinary, session.cliEnv, fixture.path);
        }
        if (testAutomatic) {
            await storeCustomisationFile(context.cliBinary, session.cliEnv, pluginDataPath);
        }
        if (testVisibility) {
            for (const fixture of visibilityFixtures) {
                await storeCustomisationFile(context.cliBinary, session.cliEnv, fixture.path);
            }
        }
        const entry = await waitForCustomisationEntry(context.cliBinary, session.cliEnv, "SNIPPET", snippetName);
        const configEntry = await waitForCustomisationEntry(context.cliBinary, session.cliEnv, "CONFIG", configName);
        const pluginEntries = await waitForCustomisationEntries(
            context.cliBinary,
            session.cliEnv,
            "PLUGIN_MAIN",
            pluginName,
            3
        );
        const pluginDataEntry = testAutomatic
            ? await waitForCustomisationEntry(context.cliBinary, session.cliEnv, "PLUGIN_DATA", pluginName)
            : undefined;
        if (testAutomatic && initialAction !== "Overwrite Remote") {
            await setHiddenSyncEnabledForFixture(context.cliBinary, session.cliEnv, true);
            await evalObsidianJson<unknown>(
                context.cliBinary,
                [
                    "(async()=>{",
                    "const hidden=app.plugins.plugins['obsidian-livesync'].core.getAddOn('HiddenFileSync');",
                    `const paths=${JSON.stringify([pluginManifestPath, pluginMainPath, pluginStylesPath, pluginDataPath])};`,
                    "const result=await hidden.initialiseInternalFileSync('pushForce',false,paths);",
                    "if(result!==true) throw new Error('Could not prepare source hidden-file documents.');",
                    "return JSON.stringify({initialised:result});",
                    "})()",
                ].join(""),
                session.cliEnv
            );
            await setHiddenSyncEnabledForFixture(context.cliBinary, session.cliEnv, false);
        }
        await pushLocalChanges(context.cliBinary, session.cliEnv);
        await waitForCouchDbDocs(context.couchDb, context.dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            const entries = [entry, configEntry, ...pluginEntries, ...(pluginDataEntry ? [pluginDataEntry] : [])];
            return entries.every(
                (target) => ids.has(target.id) && target.children.every((childId) => ids.has(childId))
            );
        });
        for (const target of [entry, configEntry, ...pluginEntries, ...(pluginDataEntry ? [pluginDataEntry] : [])]) {
            const remoteEntry = await fetchCouchDbDocument(context.couchDb, context.dbName, target.id);
            if (
                !remoteEntry.path?.startsWith("/\\:") ||
                remoteEntry.children?.length !== 0 ||
                remoteEntry.ctime !== 0 ||
                remoteEntry.mtime !== 0 ||
                remoteEntry.size !== 0
            ) {
                throw new Error(`Customisation Sync Metadata was not encrypted for ${target.id}.`);
            }
        }
        const versionInfo = await fetchCouchDbDocument(context.couchDb, context.dbName, VERSIONING_DOCID);
        if (
            versionInfo.version !== REMOTE_FEATURE_GENERATION ||
            !(versionInfo.used_features as unknown[] | undefined)?.includes(ENCRYPTED_INTERNAL_METADATA_FEATURE)
        ) {
            throw new Error("The remote feature list does not declare encrypted internal Metadata.");
        }
        await session.app.stop();
        if (testAutomatic && initialAction === "Overwrite Remote") {
            for (const path of [pluginManifestPath, pluginMainPath, pluginStylesPath, pluginDataPath]) {
                await removeVaultFile(vaultA.path, path);
            }
        }

        session = await startConfiguredSession(context, vaultB, targetDeviceName, {
            pluginSyncExtendedSetting: testAutomatic ? existingAutomaticSelections : {},
        });
        if (testVisibility) {
            for (const fixture of visibilityFixtures) {
                await storeCustomisationFile(context.cliBinary, session.cliEnv, fixture.path);
            }
        }
        if (testMtime) {
            for (const fixture of pluginFixtures) {
                await storeCustomisationFile(context.cliBinary, session.cliEnv, fixture.path);
            }
        }
        await pushLocalChanges(context.cliBinary, session.cliEnv);
        await waitForCustomisationEntry(context.cliBinary, session.cliEnv, "SNIPPET", snippetName, sourceDeviceName);
        if (testAutomatic) {
            await waitForCustomisationEntry(
                context.cliBinary,
                session.cliEnv,
                "PLUGIN_DATA",
                pluginName,
                sourceDeviceName
            );
        }
        if (testVisibility) {
            for (const fixture of visibilityFixtures) {
                const name = fixture.path.split("/").pop() ?? fixture.path;
                for (const term of [sourceDeviceName, targetDeviceName]) {
                    await waitForCustomisationEntry(context.cliBinary, session.cliEnv, "SNIPPET", name, term);
                }
            }
        }
        if (testMtime) {
            await waitForCustomisationEntries(
                context.cliBinary,
                session.cliEnv,
                "PLUGIN_MAIN",
                pluginName,
                3,
                sourceDeviceName
            );
            await waitForCustomisationEntries(
                context.cliBinary,
                session.cliEnv,
                "PLUGIN_MAIN",
                pluginName,
                3,
                targetDeviceName
            );
        }
        try {
            if (testVisibility) await inspectCustomisationVisibility(session);
            if (testMtime) await inspectPluginFreshnessAndNewestSelection(session);
            if (testAutomatic) {
                await inspectAutomaticSyncSelection(context, session, vaultB, pluginName, initialAction);
            }
        } catch (error) {
            await session.app.stop().catch(() => undefined);
            throw error;
        }
        if (testAutomatic) {
            await session.app.stop();
            const receivingVault = initialAction === "Overwrite Remote" ? vaultA : await createTemporaryVault();
            session = await startConfiguredSession(context, receivingVault, sourceDeviceName, {
                syncInternalFiles: true,
            });
            try {
                await pushLocalChanges(context.cliBinary, session.cliEnv);
                const expectedStyles =
                    initialAction === "Overwrite Remote" ? targetPluginStylesContent : pluginStylesContent;
                const expectedData = initialAction === "Overwrite Local" ? pluginDataContent : targetPluginDataContent;
                const receivedStyles = await waitForPathContent(
                    receivingVault.path,
                    pluginStylesPath,
                    (content) => content === expectedStyles
                );
                const receivedData = await waitForPathContent(
                    receivingVault.path,
                    pluginDataPath,
                    (content) => content === expectedData
                );
                assertEqual(receivedStyles, expectedStyles, "Automatic plug-in group lost PLUGIN_MAIN files.");
                assertEqual(receivedData, expectedData, "Automatic plug-in group lost the PLUGIN_DATA file.");
            } finally {
                await session.app.stop();
                if (receivingVault !== vaultA) await receivingVault.dispose();
            }
            console.log(`Automatic ${initialAction} initialised and transferred both plug-in group children.`);
            return;
        }
        if (testCase !== "all") {
            await session.app.stop();
            console.log(`Customisation Sync ${testCase} regression case passed.`);
            return;
        }
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

async function main(): Promise<void> {
    const testCase = selectedCase();
    if (testCase === "automatic") {
        for (const action of ["Overwrite Remote", "Overwrite Local", "Use newer"] as const) {
            console.log(`Checking Automatic initial action: ${action}`);
            await runWorkflow(testCase, action);
        }
    } else {
        await runWorkflow(testCase);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
