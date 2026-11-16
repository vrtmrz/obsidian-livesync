import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

type WireDocument = { _id: string; _rev?: string; type?: string; children?: string[] };
type WireRequest = { method: string; path: string; status?: number; documents?: WireDocument[] };
type Snapshot = {
    file: { sha256: string; tabs: number };
    local: { id: string; rev: string; children: string[]; content: string } | null;
    hidden: { target: boolean; exists: boolean };
    remote: { _id: string; _rev: string } | null;
};

const outputDirectory = process.env.E2E_ISSUE1359_OUTPUT ?? "/tmp/livesync-issue1359-repro";
const upstreamUri = process.env.E2E_ISSUE1359_COUCHDB ?? "http://127.0.0.1:32864";
const dbName = `issue1359-reproduction-${Date.now()}`;
const username = "issue1359";
const password = "issue1359-test-only";
const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const workspacePath = ".obsidian/workspace.json";
const term = "issue1359-device";
const configKey = `ix:${term}/CONFIG/workspace.json%workspace.json`;
const coreCode =
    "const core=app.plugins.plugins['obsidian-livesync'].core;const config=core.getAddOn('ConfigSync');const hidden=core.getAddOn('HiddenFileSync');";
const traffic: WireRequest[] = [];
const observations: Record<string, unknown>[] = [];

async function upstream(path: string, init: RequestInit = {}) {
    const response = await fetch(`${upstreamUri}${path}`, {
        ...init,
        headers: { authorization: auth, ...init.headers },
    });
    if (!response.ok && response.status !== 404 && !(init.method === "PUT" && response.status === 412)) {
        throw new Error(`Fixture request failed: ${path}, HTTP ${response.status}, ${await response.text()}`);
    }
    return response;
}

const proxy = createServer(async (incoming, outgoing) => {
    try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of incoming) {
            chunks.push(new Uint8Array(chunk));
        }
        const body = Buffer.concat(chunks);
        const record: WireRequest = { method: incoming.method ?? "GET", path: incoming.url ?? "/" };
        if (body.length && incoming.headers["content-type"]?.includes("json")) {
            const parsed = JSON.parse(body.toString());
            const documents: WireDocument[] = parsed.docs ?? (parsed._id ? [parsed] : []);
            record.documents = documents.map(({ _id, _rev, type, children }) => ({ _id, _rev, type, children }));
        }
        traffic.push(record);
        const target = new URL(record.path, upstreamUri);
        const forwarded = request(
            target,
            { method: incoming.method, headers: { ...incoming.headers, host: target.host } },
            (response) => {
                record.status = response.statusCode;
                outgoing.writeHead(response.statusCode ?? 502, response.headers);
                response.pipe(outgoing);
            }
        );
        forwarded.on("error", (error) => {
            outgoing.writeHead(502);
            outgoing.end(String(error));
        });
        forwarded.end(body);
    } catch (error) {
        outgoing.writeHead(502);
        outgoing.end(String(error));
    }
});

async function main() {
    await mkdir(outputDirectory, { recursive: true });
    const vault = await createTemporaryVault("livesync-issue1359-");
    let session: ObsidianLiveSyncSession | undefined;
    const cli = discoverObsidianCli().binary;
    assert.ok(cli, "An installed Obsidian CLI is required");
    const evaluate = async <T>(code: string): Promise<T> => {
        assert.ok(session);
        return await evalObsidianJson<T>(cli, `(async()=>{${coreCode}${code}})()`, session.cliEnv, 60_000);
    };
    const snapshot = async (): Promise<Snapshot> => {
        const file = await readFile(join(vault.path, workspacePath), "utf8");
        const local = await evaluate<Omit<Snapshot, "file" | "remote">>(`
            const key=${JSON.stringify(configKey)};
            const meta=await core.localDatabase.getDBEntryMeta(key);
            const data=meta ? await config.createPluginDataExFileV2(key) : null;
            const hiddenDoc=await core.localDatabase.getDBEntryMeta('i:'+${JSON.stringify(workspacePath)});
            return JSON.stringify({
                local:meta?{id:meta._id,rev:meta._rev,children:meta.children,content:data.data.join('')}:null,
                hidden:{target:await hidden.isTargetFile(${JSON.stringify(workspacePath)}),exists:!!hiddenDoc}
            });
        `);
        let remote = null;
        if (local.local) {
            const response = await upstream(`/${dbName}/${encodeURIComponent(local.local.id)}`);
            if (response.ok) {
                const document = (await response.json()) as { _id: string; _rev: string };
                remote = { _id: document._id, _rev: document._rev };
            }
        }
        return {
            file: {
                sha256: createHash("sha256").update(file).digest("hex"),
                tabs: (file.match(/"type": "(?:empty|markdown)"/gu) ?? []).length,
            },
            ...local,
            remote,
        };
    };
    const manualSync = async () => {
        await evaluate(`
            const command=app.commands.commands['obsidian-livesync:livesync-replicate'];
            if(!command?.callback)throw new Error('The registered manual replication command is unavailable');
            await command.callback();
            return JSON.stringify({done:true});
        `);
    };
    const openTab = async () => {
        const previous = (await snapshot()).file.sha256;
        const result = await evaluate<{ opened: boolean }>(`
            const opened=app.commands.executeCommandById('workspace:new-tab');
            app.workspace.requestSaveLayout();
            return JSON.stringify({opened});
        `);
        assert.equal(result.opened, true);
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            if ((await snapshot()).file.sha256 !== previous) {
                return;
            }
        }
        throw new Error("Opening a real Obsidian tab did not change workspace.json");
    };
    const record = (name: string, value: Record<string, unknown>) => {
        observations.push({ name, ...value });
        console.log(JSON.stringify({ name, ...value }, (_key, item) => item));
    };
    try {
        for (const database of ["_users", "_replicator", "_global_changes", dbName]) {
            const response = await upstream(`/${database}`, { method: "PUT" });
            assert.ok(response.ok || response.status === 412);
        }
        for (const [path, value] of Object.entries({
            "chttpd/enable_cors": "true",
            "cors/origins": "app://obsidian.md",
            "cors/credentials": "true",
            "couchdb/max_document_size": "50000000",
        })) {
            await upstream(`/_node/_local/_config/${path}`, {
                method: "PUT",
                body: JSON.stringify(value),
                headers: { "content-type": "application/json" },
            });
        }
        await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
        const address = proxy.address();
        assert.ok(address && typeof address !== "string");
        const settings = {
            deviceAndVaultName: term,
            usePluginSync: true,
            usePluginSyncV2: true,
            syncInternalFiles: true,
            syncInternalFilesBeforeReplication: true,
            syncInternalFilesInterval: 60,
            watchInternalFileChanges: true,
            autoSweepPlugins: true,
            autoSweepPluginsPeriodic: true,
            periodicReplication: false,
            syncOnFileOpen: false,
            encrypt: true,
            passphrase: "issue1359-test-only",
            usePathObfuscation: true,
            encryptInternalMetadata: true,
            showVerboseLog: true,
            syncInternalFilesIgnorePatterns:
                "\\/node_modules\\/,\\/\\.git\\/,\\/obsidian-livesync\\/,^\\.git\\/,\\/workspace$,\\/workspace.json$,\\/workspace-mobile.json$,\\/plugins\\/recent-files-obsidian\\/",
            pluginSyncExtendedSetting: {
                "CONFIG/workspace.json": { key: "CONFIG/workspace.json", mode: 2, files: ["workspace.json"] },
                "CONFIG/workspace-mobile.json": {
                    key: "CONFIG/workspace-mobile.json",
                    mode: 2,
                    files: ["workspace-mobile.json"],
                },
            },
        };
        session = await startObsidianLiveSyncSession({
            binary: requireObsidianBinary(),
            cliBinary: cli,
            vault,
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
            pluginData: createE2eCouchDbPluginData(
                { uri: `http://127.0.0.1:${address.port}`, username, password, dbName },
                settings
            ),
        });
        await waitForLiveSyncCoreReady(cli, session.cliEnv);
        const runtime = await evaluate(`
            core.services.setting.setDeviceAndVaultName(${JSON.stringify(term)});
            return JSON.stringify({userAgent:navigator.userAgent,version:app.plugins.plugins['obsidian-livesync'].manifest.version,
                mode:core.settings.pluginSyncExtendedSetting['CONFIG/workspace.json'],encrypt:core.settings.encrypt,
                obfuscate:core.settings.usePathObfuscation,metadataEncryption:core.settings.encryptInternalMetadata,
                usePluginSync:core.settings.usePluginSync,autoSweepPlugins:core.settings.autoSweepPlugins,
                deviceName:core.services.setting.getDeviceAndVaultName(),configEnabled:config.isThisModuleEnabled()});
        `);
        record("runtime", {
            runtime,
            bundleSha256: createHash("sha256")
                .update(new Uint8Array(await readFile("main.js")))
                .digest("hex"),
        });
        await prepareRemote(cli, session.cliEnv);
        await manualSync();
        const initialIgnore = await snapshot();
        record("initial-ignore", { snapshot: initialIgnore });
        assert.equal(initialIgnore.local, null, "Startup and replication scans must not collect an ignored file");
        assert.equal(initialIgnore.hidden.exists, false);

        // Seed a saved snapshot through the explicit save path to verify preservation after Ignore is selected.
        await evaluate(`
            await config.storeCustomisationFileV2(${JSON.stringify(workspacePath)},${JSON.stringify(term)});
            return JSON.stringify({seeded:true});
        `);
        await manualSync();
        const baseline = await snapshot();
        record("baseline", { snapshot: baseline });
        assert.ok(baseline.local && baseline.remote);
        assert.equal(baseline.local.rev, baseline.remote._rev);
        assert.equal(baseline.hidden.target, false);
        assert.equal(baseline.hidden.exists, false);

        for (const scenario of [
            "double-ignore",
            "automatic",
            "selective",
            "scan-disabled",
            "configsync-disabled",
        ] as const) {
            await evaluate(`
                Object.assign(core.settings,${JSON.stringify({ autoSweepPlugins: scenario !== "scan-disabled", usePluginSync: scenario !== "configsync-disabled" })});
                core.settings.pluginSyncExtendedSetting['CONFIG/workspace.json'].mode=${scenario === "automatic" ? 1 : scenario === "selective" ? 0 : 2};
                await core.services.setting.saveSettingData();
                return JSON.stringify({saved:true});
            `);
            const before = await snapshot();
            await openTab();
            const afterTab = await snapshot();
            assert.notEqual(afterTab.file.sha256, before.file.sha256);
            if (scenario !== "selective") {
                assert.equal(
                    afterTab.local?.rev,
                    before.local?.rev,
                    "The ignored raw event must not save workspace.json"
                );
            }
            const requestIndex = traffic.length;
            await manualSync();
            const afterSync = await snapshot();
            const requests = traffic.slice(requestIndex);
            const uploaded = requests.flatMap((entry) =>
                (entry.documents ?? []).map((document) => ({
                    ...document,
                    method: entry.method,
                    requestPath: entry.path,
                    status: entry.status,
                }))
            );
            const workspaceUploads = uploaded.filter((entry) => entry._id === afterSync.local?.id);
            record(scenario, {
                before,
                afterTab,
                afterSync,
                workspaceUploads,
                requests: requests.map(({ method, path, status }) => ({ method, path, status })),
            });
            assert.equal(afterSync.hidden.exists, false);
            if (scenario === "selective") {
                assert.notEqual(afterSync.local?.rev, before.local?.rev);
                assert.equal(afterSync.local?.rev, afterSync.remote?._rev);
                assert.equal(afterSync.local?.content, await readFile(join(vault.path, workspacePath), "utf8"));
                assert.ok(
                    workspaceUploads.some(
                        (entry) => entry.status !== undefined && entry.status >= 200 && entry.status < 300
                    )
                );
            } else {
                assert.equal(afterSync.local?.rev, before.local?.rev);
                assert.deepEqual(afterSync.local?.children, before.local?.children);
                assert.equal(afterSync.remote?._rev, before.remote?._rev);
                assert.equal(workspaceUploads.length, 0);
            }
        }
        record("result", { ignoreAndAutomaticExcluded: true, selectiveControlPassed: true, controlsPassed: true });
    } catch (error) {
        record("failure", { error: error instanceof Error ? error.stack : String(error) });
        throw error;
    } finally {
        await writeFile(join(outputDirectory, "report.json"), JSON.stringify(observations, null, 2));
        await writeFile(join(outputDirectory, "http-requests.json"), JSON.stringify(traffic, null, 2));
        if (session) {
            await writeFile(
                join(outputDirectory, "obsidian-output.json"),
                JSON.stringify(session.app.output(), null, 2)
            );
            await session.app.stop();
        }
        await vault.dispose();
        proxy.closeAllConnections();
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
