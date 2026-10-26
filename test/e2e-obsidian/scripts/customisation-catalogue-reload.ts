import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { waitForVisibleObsidianDialogue, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const pluginName = "livesync-catalogue-example";
const sourceTerm = "catalogue-source";
const pluginRoot = `.obsidian/plugins/${pluginName}`;
const pluginFiles = {
    [`${pluginRoot}/main.js`]: "module.exports = class ExamplePlugin {};\n",
    [`${pluginRoot}/manifest.json`]: JSON.stringify({
        id: pluginName,
        name: "Catalogue Example",
        version: "1.0.0",
        minAppVersion: "1.0.0",
        description: "An isolated test fixture",
        author: "Self-hosted LiveSync",
    }),
    [`${pluginRoot}/styles.css`]: ".livesync-catalogue-example { color: red; }\n",
};
const allowList = "\\.(?:md|png|pdf)$";
const coreCode = "const core=app.plugins.plugins['obsidian-livesync'].core;";
const configCode = `${coreCode}const addOn=core.getAddOn('ConfigSync');`;
const settleCode = `
    const settle=async()=>{
        await new Promise(resolve=>setTimeout(resolve,100));
        for(let attempt=0;attempt<200;attempt++){
            if(addOn.updatingV2Count===0)return;
            await new Promise(resolve=>setTimeout(resolve,25));
        }
        throw new Error('Customisation Sync did not settle');
    };
`;
const sourceRowCode = `
    const row=addOn.pluginList.find(entry=>entry.category==='PLUGIN_MAIN'&&entry.name===${JSON.stringify(pluginName)}&&entry.term===${JSON.stringify(sourceTerm)});
    if(!row)throw new Error('The source catalogue row is missing');
`;

type Observation = { name: string; expected: unknown; actual: unknown; passed: boolean };

async function writeFixtures(vaultPath: string, files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(vaultPath, path)), { recursive: true });
        await writeFile(join(vaultPath, path), content);
    }
}

async function removeFixtures(vaultPath: string, files: Record<string, string>) {
    for (const path of Object.keys(files)) await rm(join(vaultPath, path), { force: true });
}

async function matchingFiles(vaultPath: string, files: Record<string, string>) {
    const matches: string[] = [];
    for (const [path, content] of Object.entries(files)) {
        try {
            if ((await readFile(join(vaultPath, path), "utf8")) === content) matches.push(path);
        } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        }
    }
    return matches.sort();
}

async function waitForMatchingFiles(vaultPath: string, files: Record<string, string>) {
    const deadline = Date.now() + 10_000;
    let matches = await matchingFiles(vaultPath, files);
    while (matches.length !== Object.keys(files).length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        matches = await matchingFiles(vaultPath, files);
    }
    return matches;
}

async function main() {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error("The Obsidian CLI is unavailable");
    const cliBinary = cli.binary;
    const output =
        process.env.E2E_CUSTOMISATION_CATALOGUE_OUTPUT ?? join(tmpdir(), "livesync-customisation-catalogue.json");
    const observations: Observation[] = [];
    const report: Record<string, unknown> = {
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        sourceDiffSha256: createHash("sha256")
            .update(new Uint8Array(execFileSync("git", ["diff", "--binary", "HEAD"])))
            .digest("hex"),
        scenarioSha256: createHash("sha256")
            .update(new Uint8Array(await readFile(fileURLToPath(import.meta.url))))
            .digest("hex"),
        commonlibEntrySha256: createHash("sha256")
            .update(
                new Uint8Array(
                    await readFile(
                        "node_modules/@vrtmrz/livesync-commonlib/dist/managers/EntryManager/EntryManagerImpls.js"
                    )
                )
            )
            .digest("hex"),
        bundleSha256: createHash("sha256")
            .update(new Uint8Array(await readFile("main.js")))
            .digest("hex"),
        commonlibVersion: JSON.parse(await readFile("node_modules/@vrtmrz/livesync-commonlib/package.json", "utf8"))
            .version,
        observations,
    };
    const vault = await createTemporaryVault("livesync-customisation-catalogue-");
    let session: ObsidianLiveSyncSession | undefined;
    const record = (name: string, actual: unknown, expected: unknown) => {
        const observation = { name, expected, actual, passed: isDeepStrictEqual(actual, expected) };
        observations.push(observation);
        console.log(JSON.stringify(observation));
    };
    const evaluate = async <T>(code: string): Promise<T> => {
        if (!session) throw new Error("The isolated Obsidian session has not started");
        return await evalObsidianJson<T>(cliBinary, `(async()=>{${code}})()`, session.cliEnv, 60_000);
    };
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
            pluginData: createE2eCouchDbPluginData(
                { uri: "http://127.0.0.1:9", username: "", password: "", dbName: "catalogue-local-only" },
                { periodicReplication: false, syncOnFileOpen: false, useOnlyLocalChunk: true }
            ),
        });
        report.pluginVersion = session.readiness.pluginVersion;
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        report.runtime = await evaluate(`${coreCode}
            core.services.setting.setDeviceAndVaultName('catalogue-local');
            Object.assign(core.settings,{
                isConfigured:true,usePluginSync:true,usePluginSyncV2:true,syncInternalFiles:false,
                autoSweepPlugins:false,autoSweepPluginsPeriodic:false,watchInternalFileChanges:false,
                syncOnlyRegEx:${JSON.stringify(allowList)},syncIgnoreRegEx:''
            });
            return JSON.stringify({userAgent:navigator.userAgent,databaseReady:core.localDatabase.isReady});
        `);

        await writeFixtures(vault.path, pluginFiles);
        await evaluate(`${configCode}${settleCode}
            for(const path of ${JSON.stringify(Object.keys(pluginFiles))}){
                const stored=await addOn.storeCustomisationFileV2(path,${JSON.stringify(sourceTerm)});
                if(stored===false)throw new Error('Could not seed a Customisation Sync document');
            }
            await settle();
            return JSON.stringify({seeded:true});
        `);
        const opened = await evaluate<{ opened: boolean }>(
            `return JSON.stringify({opened:app.commands.executeCommandById('obsidian-livesync:livesync-plugin-dialog-ex')});`
        );
        if (!opened.opened) throw new Error("Could not open the Customisation Sync dialogue command");
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const dialogue = await waitForVisibleObsidianDialogue(page, "Customization Sync (Beta3)");
            await dialogue
                .locator("label")
                .filter({ hasText: "Maintenance mode" })
                .locator('input[type="checkbox"]')
                .check();
            await dialogue.getByRole("button", { name: "Reload", exact: true }).click();
        });
        const catalogue = await evaluate<{ files: string[]; documents: number }>(`${configCode}${settleCode}
            await settle();
            ${sourceRowCode}
            let documents=0;
            for await(const doc of core.localDatabase.findEntries('ix:','ix;')){
                if(doc.path.startsWith(${JSON.stringify(`ix:${sourceTerm}/PLUGIN_MAIN/${pluginName}%`)})&&!doc.deleted&&!doc._deleted)documents++;
            }
            return JSON.stringify({files:row.files.map(file=>file.filename).sort(),documents});
        `);
        record("#1271: all source documents remain in the database", catalogue.documents, 3);
        record(
            "#1271: one reload lists all files",
            catalogue.files,
            Object.keys(pluginFiles)
                .map((path) => path.substring(".obsidian/".length))
                .sort()
        );
        await removeFixtures(vault.path, pluginFiles);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const dialogue = await waitForVisibleObsidianDialogue(page, "Customization Sync (Beta3)");
            const row = dialogue.locator(`.filerow:has(select option[value="${sourceTerm}"])`);
            await row.locator("select").selectOption(sourceTerm);
            await row.locator(".body").getByRole("button", { name: "✓", exact: true }).click();
        });
        report.firstApply = { action: "UI Apply", sourceTerm };
        record(
            "#1271: first Apply restores all file contents",
            await waitForMatchingFiles(vault.path, pluginFiles),
            Object.keys(pluginFiles).sort()
        );

        const secondPass = await evaluate<string[]>(`${configCode}${settleCode}
            await addOn.updatePluginList(false);await settle();${sourceRowCode}
            return JSON.stringify(row.files.map(file=>file.filename).sort());
        `);
        record(
            "#1271 control: a second pass lists all files",
            secondPass,
            Object.keys(pluginFiles)
                .map((path) => path.substring(".obsidian/".length))
                .sort()
        );
        await removeFixtures(vault.path, pluginFiles);
        await evaluate(`${configCode}${sourceRowCode}return JSON.stringify({applied:await addOn.applyDataV2(row)});`);
        record(
            "#1271 control: Apply after a second pass restores all contents",
            await matchingFiles(vault.path, pluginFiles),
            Object.keys(pluginFiles).sort()
        );
    } catch (error) {
        report.runtimeError = error instanceof Error ? error.stack : String(error);
        if (session) report.processOutput = JSON.stringify(session.app.output()).slice(-4_000);
        throw error;
    } finally {
        try {
            await writeFile(output, JSON.stringify(report, null, 2) + "\n");
            console.log(`Verification report: ${output}`);
        } finally {
            try {
                if (session) await session.app.stop();
            } finally {
                await vault.dispose();
            }
        }
    }
    if (observations.some((observation) => !observation.passed)) process.exitCode = 1;
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
