import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

type Probe = {
    name: string;
    path: string;
    config: boolean;
    hidden: boolean;
    mode?: number;
    key?: string;
    files?: string[];
    excluded?: boolean;
    etc?: boolean;
};

const cases: Probe[] = [
    {
        name: "etc-disabled-unassigned",
        path: ".obsidian/plugins/probe-etc-default/cache.txt",
        config: true,
        hidden: true,
        etc: false,
    },
    {
        name: "etc-disabled-ignore",
        path: ".obsidian/plugins/probe-etc-off/cache.txt",
        config: true,
        hidden: true,
        mode: 2,
        key: "PLUGIN_ETC/probe-etc-off",
        etc: false,
    },
    {
        name: "etc-enabled-ignore",
        path: ".obsidian/plugins/probe-etc-on/cache.txt",
        config: true,
        hidden: true,
        mode: 2,
        key: "PLUGIN_ETC/probe-etc-on",
        etc: true,
    },
    { name: "unassigned-both-enabled", path: ".obsidian/snippets/probe-unassigned.css", config: true, hidden: true },
    { name: "explicit-selective", path: ".obsidian/snippets/probe-selective.css", config: true, hidden: true, mode: 0 },
    { name: "flagged-selective", path: ".obsidian/snippets/probe-flagged.css", config: true, hidden: true, mode: 3 },
    { name: "ignore", path: ".obsidian/snippets/probe-ignored.css", config: true, hidden: true, mode: 2 },
    { name: "automatic", path: ".obsidian/snippets/probe-automatic.css", config: true, hidden: true, mode: 1 },
    {
        name: "automatic-hidden-disabled",
        path: ".obsidian/snippets/probe-auto-disabled.css",
        config: true,
        hidden: false,
        mode: 1,
    },
    {
        name: "saved-ignore-config-disabled",
        path: ".obsidian/snippets/probe-dormant-ignore.css",
        config: false,
        hidden: true,
        mode: 2,
    },
    { name: "config-only", path: ".obsidian/snippets/probe-config-only.css", config: true, hidden: false },
    { name: "both-disabled", path: ".obsidian/snippets/probe-disabled.css", config: false, hidden: false },
    {
        name: "hidden-exclusion-selective",
        path: ".obsidian/snippets/probe-excluded.css",
        config: true,
        hidden: true,
        mode: 0,
        excluded: true,
    },
    {
        name: "ignore-empty-files",
        path: ".obsidian/snippets/probe-empty.css",
        config: true,
        hidden: true,
        mode: 2,
        files: [],
    },
    {
        name: "ignore-new-group-file",
        path: ".obsidian/plugins/probe-mode-group/styles.css",
        config: true,
        hidden: true,
        mode: 2,
        key: "PLUGIN_MAIN/probe-mode-group",
        files: ["plugins/probe-mode-group/main.js"],
    },
];

const coreCode =
    "const core=app.plugins.plugins['obsidian-livesync'].core;const config=core.getAddOn('ConfigSync');const hidden=core.getAddOn('HiddenFileSync');";
const outputDirectory = process.env.E2E_ISSUE1359_SELECTION_OUTPUT ?? "/tmp/livesync-issue1359-selection";
const observations: Record<string, unknown>[] = [];

async function main() {
    await mkdir(outputDirectory, { recursive: true });
    const vault = await createTemporaryVault("livesync-issue1359-selection-");
    const cli = discoverObsidianCli().binary;
    assert.ok(cli, "An installed Obsidian CLI is required");
    let session: ObsidianLiveSyncSession | undefined;
    const evaluate = async <T>(code: string): Promise<T> => {
        assert.ok(session);
        return await evalObsidianJson<T>(cli, "(async()=>{" + coreCode + code + "})()", session.cliEnv, 60_000);
    };
    try {
        session = await startObsidianLiveSyncSession({
            binary: requireObsidianBinary(),
            cliBinary: cli,
            vault,
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
            pluginData: createE2eCouchDbPluginData(
                { uri: "http://127.0.0.1:9", username: "", password: "", dbName: "selection-local-only" },
                {
                    deviceAndVaultName: "selection-device",
                    usePluginSync: false,
                    syncInternalFiles: false,
                    periodicReplication: false,
                    syncOnFileOpen: false,
                    watchInternalFileChanges: false,
                    autoSweepPlugins: false,
                    autoSweepPluginsPeriodic: false,
                    syncInternalFilesInterval: 0,
                    useOnlyLocalChunk: true,
                    encrypt: false,
                    usePathObfuscation: false,
                    encryptInternalMetadata: false,
                }
            ),
        });
        await waitForLiveSyncCoreReady(cli, session.cliEnv);
        const runtime = await evaluate(
            "return JSON.stringify({userAgent:navigator.userAgent,version:app.plugins.plugins['obsidian-livesync'].manifest.version});"
        );
        observations.push({
            name: "runtime",
            runtime,
            revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
            bundleSha256: createHash("sha256")
                .update(new Uint8Array(await readFile("main.js")))
                .digest("hex"),
            remoteReplication: false,
            liveRawWatching: false,
            entryPoint: "services.replication.onBeforeReplicate",
        });
        for (const probe of cases) {
            await mkdir(dirname(join(vault.path, probe.path)), { recursive: true });
            await writeFile(join(vault.path, probe.path), ".probe { color: red; }\n");
            const key = probe.key ?? "SNIPPET/" + probe.path.split("/").slice(-1)[0];
            const entries =
                probe.mode === undefined
                    ? {}
                    : {
                          [key]: {
                              key,
                              mode: probe.mode,
                              files: probe.files ?? [probe.path.slice(".obsidian/".length)],
                          },
                      };
            const settings = {
                usePluginSync: probe.config,
                syncInternalFiles: probe.hidden,
                usePluginSyncV2: true,
                usePluginEtc: probe.etc ?? false,
                autoSweepPlugins: true,
                autoSweepPluginsPeriodic: false,
                syncInternalFilesBeforeReplication: true,
                syncInternalFilesInterval: 0,
                watchInternalFileChanges: false,
                pluginSyncExtendedSetting: entries,
                syncInternalFilesTargetPatterns: "",
                syncInternalFilesIgnorePatterns:
                    "\\/node_modules\\/,\\/\\.git\\/,\\/obsidian-livesync\\/" +
                    (probe.excluded ? ",/probe-excluded\\.css$" : ""),
            };
            const result = await evaluate<Record<string, unknown>>(
                "Object.assign(core.settings," +
                    JSON.stringify(settings) +
                    ");" +
                    "const path=" +
                    JSON.stringify(probe.path) +
                    ";" +
                    "const selection={extraSelector:await core.services.vault.isTargetFileInExtra(path),hiddenTarget:await hidden.isTargetFile(path),configCategory:config.getFileCategory(path)};" +
                    "const preparation=await core.services.replication.onBeforeReplicate(false);" +
                    "if(!preparation)throw new Error('Local replication preparation was declined');" +
                    "const ix=await core.localDatabase.getDBEntryMeta(config.filenameWithUnifiedKey(path));" +
                    "const internal=await core.localDatabase.getDBEntryMeta('i:'+path);" +
                    "return JSON.stringify({...selection,configSaved:!!ix&&!ix.deleted,hiddenSaved:!!internal&&!internal.deleted});"
            );
            const row = {
                name: probe.name,
                path: probe.path,
                configEnabled: probe.config,
                hiddenEnabled: probe.hidden,
                mode: probe.mode ?? "unassigned",
                savedFiles: probe.mode === undefined ? null : entries[key].files,
                ...result,
            };
            observations.push(row);
            console.log(JSON.stringify(row));
        }
        assert.equal(observations.length, cases.length + 1);
        const row = (name: string) => observations.find((observation) => observation.name === name);
        assert.equal(row("ignore")?.configSaved, false);
        assert.equal(row("ignore")?.hiddenSaved, false);
        assert.equal(row("etc-enabled-ignore")?.configSaved, false);
        assert.equal(row("automatic")?.configSaved, false);
        assert.equal(row("automatic")?.hiddenSaved, true);
        assert.equal(row("automatic-hidden-disabled")?.configSaved, false);
        assert.equal(row("automatic-hidden-disabled")?.hiddenSaved, false);
        assert.equal(row("unassigned-both-enabled")?.configSaved, true);
        assert.equal(row("unassigned-both-enabled")?.hiddenSaved, true);
        assert.equal(row("explicit-selective")?.configSaved, true);
        assert.equal(row("explicit-selective")?.hiddenSaved, false);
        assert.equal(row("flagged-selective")?.configSaved, true);
        assert.equal(row("flagged-selective")?.hiddenSaved, true);
        assert.equal(row("ignore-empty-files")?.configSaved, true);
        assert.equal(row("ignore-empty-files")?.hiddenSaved, true);
        assert.equal(row("ignore-new-group-file")?.configSaved, true);
        assert.equal(row("ignore-new-group-file")?.hiddenSaved, true);
        assert.equal(row("saved-ignore-config-disabled")?.configSaved, false);
        assert.equal(row("saved-ignore-config-disabled")?.hiddenSaved, true);
        assert.equal(row("both-disabled")?.configSaved, false);
        assert.equal(row("both-disabled")?.hiddenSaved, false);
        observations.push({ name: "result", observationsComplete: true });
    } catch (error) {
        observations.push({ name: "failure", error: error instanceof Error ? error.stack : String(error) });
        throw error;
    } finally {
        await writeFile(join(outputDirectory, "report.json"), JSON.stringify(observations, null, 2));
        if (session) {
            await writeFile(
                join(outputDirectory, "obsidian-output.json"),
                JSON.stringify(session.app.output(), null, 2)
            );
            await session.app.stop();
        }
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
