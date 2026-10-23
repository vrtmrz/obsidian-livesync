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
import { createTemporaryVault } from "../runner/vault.ts";

const hiddenRoot = ".obsidian/livesync-selector-example";
const hiddenFiles = {
    [`${hiddenRoot}/main.js`]: "console.log('hidden fixture');\n",
    [`${hiddenRoot}/styles.css`]: ".hidden-fixture { color: blue; }\n",
    [`${hiddenRoot}/settings.json`]: '{"fixture":true}\n',
};
const controlRoot = ".obsidian/livesync-selector-control";
const controlFiles = {
    [`${controlRoot}/main.js`]: "console.log('control fixture');\n",
    [`${controlRoot}/styles.css`]: ".control-fixture { color: red; }\n",
    [`${controlRoot}/settings.json`]: '{"control":true}\n',
};
const allowList = "\\.(?:md|png|pdf)$";
const coreCode = "const core=app.plugins.plugins['obsidian-livesync'].core;";
const hiddenCode = `${coreCode}const addOn=core.getAddOn('HiddenFileSync');`;

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

async function main() {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error("The Obsidian CLI is unavailable");
    const cliBinary = cli.binary;
    const output =
        process.env.E2E_HIDDEN_FILE_SELECTORS_OUTPUT ?? join(tmpdir(), "livesync-hidden-file-selectors.json");
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
    const vault = await createTemporaryVault("livesync-hidden-file-selectors-");
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
                { uri: "http://127.0.0.1:9", username: "", password: "", dbName: "selector-local-only" },
                { periodicReplication: false, syncOnFileOpen: false, useOnlyLocalChunk: true }
            ),
        });
        report.pluginVersion = session.readiness.pluginVersion;
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        report.runtime = await evaluate(`${coreCode}
            core.services.setting.setDeviceAndVaultName('selector-local');
            Object.assign(core.settings,{
                isConfigured:true,usePluginSync:false,usePluginSyncV2:true,syncInternalFiles:false,
                autoSweepPlugins:false,autoSweepPluginsPeriodic:false,watchInternalFileChanges:false,
                syncOnlyRegEx:${JSON.stringify(allowList)},syncIgnoreRegEx:''
            });
            return JSON.stringify({userAgent:navigator.userAgent,databaseReady:core.localDatabase.isReady});
        `);

        await writeFixtures(vault.path, hiddenFiles);
        const uploadCode = (normalAllowList: string, files: Record<string, string>) => `${hiddenCode}
            Object.assign(core.settings,{
                syncInternalFiles:true,syncOnlyRegEx:${JSON.stringify(normalAllowList)},
                syncInternalFilesTargetPatterns:'^\\\\.obsidian(?:$|/livesync-selector-(?:example|control)(?:/|$))',syncInternalFilesIgnorePatterns:''
            });
            const candidates=await addOn.scanInternalFileNames();
            const selected=candidates.filter(path=>${JSON.stringify(Object.keys(files))}.includes(path));
            if(selected.length!==3)throw new Error('Hidden-file fixture selection failed: '+JSON.stringify({selected,target:core.settings.syncInternalFilesTargetPatterns}));
            for(const path of selected)await addOn.updateLastProcessedAsActualFile(path);
            await addOn.rebuildFromStorage(false,${JSON.stringify(Object.keys(files))},false);
            const paths=[];
            for await(const doc of core.localDatabase.findEntries('i:','i;')){
                if(${JSON.stringify(Object.keys(files).map((path) => `i:${path}`))}.includes(doc.path)&&!doc.deleted&&!doc._deleted)paths.push(doc.path.substring(2));
            }
            return JSON.stringify(paths.sort());
        `;
        const hiddenUpload = await evaluate<string[]>(uploadCode(allowList, hiddenFiles));
        record(
            "#1272: a normal allow-list permits selected hidden uploads",
            hiddenUpload,
            Object.keys(hiddenFiles).sort()
        );
        await writeFixtures(vault.path, controlFiles);
        const uploadControl = await evaluate<string[]>(uploadCode("", controlFiles));
        record(
            "#1272 control: clearing the normal allow-list permits hidden uploads",
            uploadControl,
            Object.keys(controlFiles).sort()
        );

        const pullCode = (normalAllowList: string, files: Record<string, string>) => `${hiddenCode}
            core.settings.syncOnlyRegEx=${JSON.stringify(normalAllowList)};
            const results=[];
            for await(const doc of core.localDatabase.findEntries('i:','i;')){
                if(${JSON.stringify(Object.keys(files).map((path) => `i:${path}`))}.includes(doc.path)&&!doc.deleted&&!doc._deleted){
                    results.push(await addOn.extractInternalFileFromDatabase(doc.path.substring(2),true,doc,false));
                }
            }
            return JSON.stringify(results);
        `;
        await removeFixtures(vault.path, hiddenFiles);
        report.hiddenPullWithAllowList = await evaluate(pullCode(allowList, hiddenFiles));
        record(
            "#1272: a normal allow-list permits selected hidden downloads",
            await matchingFiles(vault.path, hiddenFiles),
            Object.keys(hiddenFiles).sort()
        );
        await removeFixtures(vault.path, controlFiles);
        report.hiddenPullWithoutAllowList = await evaluate(pullCode("", controlFiles));
        record(
            "#1272 control: clearing the normal allow-list permits hidden downloads",
            await matchingFiles(vault.path, controlFiles),
            Object.keys(controlFiles).sort()
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
