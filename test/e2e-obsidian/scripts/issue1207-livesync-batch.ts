import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import type { Page } from "playwright";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertE2eCompatibilityUnpaused,
    configureCouchDb,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

type Mode = "normal" | "ignored-batch-setting" | "enabled-batch";
type Slot = { name: string; vault: TemporaryVault; session?: ObsidianLiveSyncSession };
type Leaf = { rev: string; ancestry: string[]; logicalDeleted: boolean; pouchDeleted: boolean; body: string | null };
type Snapshot = {
    path: string;
    rev: string | null;
    content: string | null;
    fileMtime: number | null;
    databaseMtime: number | null;
    exists: boolean;
    leaves: Leaf[];
    waiting: Array<{ path: string; type: string; since: number }>;
    queued: Array<{ path: string | null; type: string }>;
    shouldBatchSave: boolean;
};
type Pair = { a: Page; b: Page };

const diagnostics = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/issue1207-livesync-batch";
const artifactRoot = process.env.ISSUE1207_ARTIFACT_ROOT ?? process.cwd();
const evidence: Record<string, unknown> = { cases: [], observations: [] };
const cases = evidence.cases as Array<Record<string, unknown>>;
const observations = evidence.observations as unknown[];
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const prefix = "issue1207-batch-";

function check(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function hashes() {
    return Object.fromEntries(
        ["main.js", "manifest.json", "styles.css"].map((name) => [
            name,
            createHash("sha256")
                .update(new Uint8Array(readFileSync(join(artifactRoot, name))))
                .digest("hex"),
        ])
    );
}

async function availablePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    check(address && typeof address !== "string", "Missing debug port");
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    return address.port;
}

async function evaluate<T>(page: Page, code: string): Promise<T> {
    return await page.evaluate(`(async()=>{
        const core=app.plugins.plugins['obsidian-livesync'].core;
        const manager=core.serviceModules.storageAccess.vaultManager;
        ${code}
    })()`);
}

async function installProbe(page: Page): Promise<void> {
    await evaluate(
        page,
        `
        if(globalThis.__issue1207Batch) return;
        const probe={events:[],changes:[]};
        globalThis.__issue1207Batch=probe;
        for(const type of ['create','modify','rename','delete']) {
            app.vault.on(type,(file,oldPath)=>{
                const path=file.path;
                if(!path.startsWith(${JSON.stringify(prefix)})) return;
                const item={type,path,oldPath:oldPath??null,at:Date.now(),content:null};
                probe.events.push(item);
                if(type!=='delete' && file.stat) {
                    void app.vault.read(file).then(body=>item.content=body).catch(error=>item.error=String(error));
                }
            });
        }
        probe.feed=core.localDatabase.localDatabase.changes({live:true,since:'now',include_docs:true})
            .on('change',change=>{
                if(typeof change.doc?.path==='string' && change.doc.path.startsWith(${JSON.stringify(prefix)})) {
                    probe.changes.push({path:change.doc.path,rev:change.doc._rev,
                        logicalDeleted:!!change.doc.deleted,pouchDeleted:!!change.doc._deleted,at:Date.now()});
                }
            }).on('error',error=>probe.changes.push({error:String(error),at:Date.now()}));
    `
    );
}

async function options(page: Page, mode: Mode, minimum = 2, maximum = 6): Promise<void> {
    await evaluate(
        page,
        `
        const settings=core.services.setting.currentSettings();
        Object.assign(settings,{liveSync:true,periodicReplication:false,
            batchSave:${mode === "ignored-batch-setting"},batchSaveInLiveSync:${mode === "enabled-batch"},
            batchSaveMinimumDelay:${minimum},batchSaveMaximumDelay:${maximum},deleteMetadataOfDeletedFiles:false});
        return {liveSync:settings.liveSync,batchSave:settings.batchSave,
            batchSaveInLiveSync:settings.batchSaveInLiveSync,shouldBatchSave:manager.shouldBatchSave};
    `
    );
}

async function snapshot(page: Page, path: string): Promise<Snapshot> {
    return await evaluate<Snapshot>(
        page,
        `
        const path=${JSON.stringify(path)};
        const id=await core.services.path.path2id(path);
        const row=(await core.localDatabase.allDocsRaw({keys:[id],include_docs:true})).rows[0];
        let leaves=[];
        if(row?.value?.rev) {
            const rawLeaves=await core.localDatabase.getRaw(id,{open_revs:'all',revs:true});
            for(const item of rawLeaves) {
                if(!item.ok) continue;
                const raw=item.ok;
                let body=null;
                if(!raw._deleted) {
                    const entry=await core.localDatabase.getDBEntryFromMeta(raw,false,false,true);
                    if(entry!==false) body=Array.isArray(entry.data)?entry.data.join(''):entry.data;
                }
                leaves.push({rev:raw._rev,logicalDeleted:!!raw.deleted,pouchDeleted:!!raw._deleted,body,
                    ancestry:raw._revisions?.ids.map((hash,i)=>(raw._revisions.start-i)+'-'+hash)??[]});
            }
        }
        const file=app.vault.getAbstractFileByPath(path);
        return {path,rev:row?.value?.rev??null,exists:!!file?.stat,
            fileMtime:file?.stat?.mtime??null,databaseMtime:row?.doc?.mtime??null,
            content:file?.stat?await app.vault.read(file):null,leaves,
            waiting:[...manager._waitingMap].map(([key,value])=>({path:key,type:value.type,since:value.since})),
            queued:manager.bufferedQueuedItems.map(item=>({path:item.args?.file?.path??null,type:item.type})),
            shouldBatchSave:!!manager.shouldBatchSave};
    `
    );
}

function liveLeaves(state: Snapshot) {
    return state.leaves.filter((leaf) => !leaf.logicalDeleted && !leaf.pouchDeleted);
}

async function waitFor(
    page: Page,
    path: string,
    predicate: (state: Snapshot) => boolean,
    timeout = 20000
): Promise<Snapshot> {
    const deadline = Date.now() + timeout;
    let state: Snapshot;
    do {
        state = await snapshot(page, path);
        if (predicate(state)) return state;
        await pause(100);
    } while (Date.now() < deadline);
    throw new Error(`State did not settle: ${JSON.stringify(state)}`);
}

async function settled(
    pair: Pair,
    path: string,
    body: string,
    allowDeletedBranches = false
): Promise<[Snapshot, Snapshot]> {
    const ready = (state: Snapshot) =>
        state.content === body &&
        liveLeaves(state).length === 1 &&
        liveLeaves(state)[0].body === body &&
        (allowDeletedBranches || state.leaves.length === 1) &&
        !state.waiting.some((item) => item.path === path);
    const deadline = Date.now() + 20000;
    let states: [Snapshot, Snapshot];
    do {
        states = await Promise.all([snapshot(pair.a, path), snapshot(pair.b, path)]);
        // The row, leaves, and storage are read asynchronously. Require each
        // sample to agree internally, then compare both current devices.
        if (
            states.every((state) => ready(state) && state.rev === liveLeaves(state)[0].rev) &&
            states[0].rev === states[1].rev
        )
            return states;
        await pause(100);
    } while (Date.now() < deadline);
    throw new Error(`Devices did not converge: ${JSON.stringify(states)}`);
}

async function create(page: Page, path: string, body: string): Promise<void> {
    await evaluate(page, `await app.vault.create(${JSON.stringify(path)},${JSON.stringify(body)});`);
}

async function modify(page: Page, path: string, body: string): Promise<void> {
    await evaluate(
        page,
        `await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(path)}),${JSON.stringify(body)});`
    );
}

async function trace(page: Page, path: string) {
    return await evaluate(
        page,
        `return {
        events:globalThis.__issue1207Batch.events.filter(item=>item.path===${JSON.stringify(path)}||item.oldPath===${JSON.stringify(path)}),
        changes:globalThis.__issue1207Batch.changes.filter(item=>item.path===${JSON.stringify(path)}||item.error)};`
    );
}

async function main(): Promise<void> {
    await mkdir(diagnostics, { recursive: true });
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    check(cli.binary, "Missing Obsidian CLI");
    const cliBinary = cli.binary;
    const config = await loadCouchDbConfig(process.env.ISSUE1207_COUCHDB_ENV);
    check(["127.0.0.1", "localhost"].includes(new URL(config.uri).hostname), "Use a disposable local CouchDB");
    await assertCouchDbReachable(config);
    const dbName = makeUniqueDatabaseName(config.dbPrefix, "live-batch");
    const couch = { ...config, dbName };
    const remoteRestartEdit = process.env.ISSUE1207_RESTART_REMOTE_EDIT;
    check(
        !remoteRestartEdit || ["mergeable", "conflicting"].includes(remoteRestartEdit),
        "Unknown remote edit for the provenance restart case"
    );
    check(
        !remoteRestartEdit || process.env.ISSUE1207_RESTART_BEFORE_PROVENANCE === "true",
        "A remote restart edit requires the provenance gate"
    );
    const overrides = {
        doctorProcessedVersion: "1.0.0",
        notifyThresholdOfRemoteStorageSize: -1,
        liveSync: false,
        periodicReplication: false,
        batchSave: false,
        batchSaveInLiveSync: false,
        syncOnStart: false,
        syncOnSave: false,
        syncOnFileOpen: false,
        syncOnEditorSave: false,
        syncAfterMerge: false,
        checkConflictOnlyOnOpen: true,
        showMergeDialogOnlyOnActive: true,
        disableMarkdownAutoMerge: !remoteRestartEdit,
        resolveConflictsByNewerFile: false,
        writeDocumentsIfConflicted: false,
        writeLogToTheFile: false,
    };
    const before = hashes();
    evidence.artefactsBefore = before;
    evidence.manifest = JSON.parse(await readFile(join(artifactRoot, "manifest.json"), "utf8"));
    evidence.commonlibVersion = JSON.parse(
        await readFile("node_modules/@vrtmrz/livesync-commonlib/package.json", "utf8")
    ).version;
    if (process.env.ISSUE1207_COMMONLIB_ARTEFACT) {
        evidence.commonlibArtefactSha256 = createHash("sha256")
            .update(new Uint8Array(readFileSync(process.env.ISSUE1207_COMMONLIB_ARTEFACT)))
            .digest("hex");
    }
    evidence.timing = { minimumSeconds: 2, maximumSeconds: 6, incomingAndManualSeconds: { minimum: 5, maximum: 60 } };
    const slots: Slot[] = [];
    let ownedDatabase = false;

    function redact(value: unknown): string {
        return JSON.stringify(value, null, 2)
            .split(config.password)
            .join("<redacted>")
            .split(Buffer.from(`${config.username}:${config.password}`).toString("base64"))
            .join("<redacted>");
    }

    async function start(slot: Slot, restart = false) {
        console.log(JSON.stringify({ phase: "starting", device: slot.name, restart }));
        slot.session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            artifactRoot,
            vault: slot.vault,
            startupGraceMs: 1000,
            pluginStartup: restart ? "natural" : undefined,
            pluginData: restart ? undefined : createE2eCouchDbPluginData(couch, overrides),
            localStorageEntries: restart ? undefined : createE2eObsidianDeviceLocalState(slot.vault.name),
            env: { E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT: String(await availablePort()) },
            lifecycle: {
                beforeLaunch: async () => {
                    for (const registry of [
                        join(slot.vault.homePath, ".config", "obsidian", "obsidian.json"),
                        join(slot.vault.homePath, "Library", "Application Support", "obsidian", "obsidian.json"),
                        join(slot.vault.xdgConfigPath, "obsidian", "obsidian.json"),
                        join(slot.vault.userDataPath, "obsidian.json"),
                    ]) {
                        const state = JSON.parse(await readFile(registry, "utf8"));
                        state.updateDisabled = true;
                        await writeFile(registry, JSON.stringify(state));
                    }
                },
            },
        });
        console.log(
            JSON.stringify({
                phase: "device-started",
                device: slot.name,
                port: slot.session.remoteDebuggingPort,
                vault: slot.vault.path,
            })
        );
        await waitForLiveSyncCoreReady(cliBinary, slot.session.cliEnv);
        await assertE2eCompatibilityUnpaused(cliBinary, slot.session.cliEnv, slot.session.remoteDebuggingPort);
        if (!restart) {
            await configureCouchDb(cliBinary, slot.session.cliEnv, couch, overrides);
            await waitForLiveSyncCoreReady(cliBinary, slot.session.cliEnv);
            await prepareRemote(cliBinary, slot.session.cliEnv);
        }
    }

    async function stop(slot: Slot) {
        if (!slot.session) return;
        await slot.session.app.stop();
        await writeFile(
            join(diagnostics, `process-${slot.name}-${slot.session.remoteDebuggingPort}.json`),
            redact(slot.session.app.output())
        );
        slot.session = undefined;
    }

    async function withPair<T>(callback: (pair: Pair) => Promise<T>): Promise<T> {
        check(slots[0].session && slots[1].session, "Both devices must be running");
        return await withObsidianPage(
            slots[0].session.remoteDebuggingPort,
            async (a) =>
                await withObsidianPage(slots[1].session!.remoteDebuggingPort, async (b) => {
                    await installProbe(a);
                    await installProbe(b);
                    return await callback({ a, b });
                })
        );
    }

    async function run(name: string, body: () => Promise<unknown>) {
        if (process.env.ISSUE1207_CASE_FILTER && !new RegExp(process.env.ISSUE1207_CASE_FILTER).test(name)) return;
        console.log(JSON.stringify({ phase: "case-start", name }));
        try {
            const result = await body();
            cases.push({ name, passed: true, result });
            console.log(JSON.stringify({ phase: "case-passed", name }));
        } catch (error) {
            const failure = error instanceof Error ? error.stack : String(error);
            cases.push({ name, passed: false, error: failure });
            console.log(JSON.stringify({ phase: "case-failed", name, error: failure }));
            await withPair(async (pair) => {
                let flushFailure: unknown;
                for (const [device, page] of Object.entries(pair)) {
                    observations.push({
                        name,
                        device,
                        probe: await evaluate(
                            page,
                            `return {
                        events:globalThis.__issue1207Batch.events,changes:globalThis.__issue1207Batch.changes,
                        pending:(await manager.adapter.persistence.loadSnapshot()).map(item=>({
                            type:item.type,path:item.args?.file?.path,oldPath:item.args?.oldPath}))};`
                        ),
                    });
                    if (name === "enabled-settings-save-restart" || name.startsWith("enabled-before-provenance")) {
                        observations.push({
                            name,
                            device,
                            revisionEvidence: await evaluate(
                                page,
                                `
                            const path=${JSON.stringify(`${prefix}restart.md`)};
                            const id=await core.services.path.path2id(path);
                            const leaves=await core.localDatabase.getRaw(id,{open_revs:'all',revs:true});
                            const revisions=new Set();
                            for(const leaf of leaves){const h=leaf.ok?._revisions;
                                for(let i=0;i<(h?.ids.length??0);i++)revisions.add((h.start-i)+'-'+h.ids[i]);}
                            const result=[];
                            for(const rev of revisions){
                                const raw=await core.localDatabase.getRaw(id,{rev,revs:true}).catch(error=>({error:String(error)}));
                                const doc=await core.localDatabase.getDBEntry(path,{rev,revs:true},false,true,true).catch(()=>false);
                                result.push({rev,deleted:raw._deleted??false,ctime:raw.ctime,mtime:raw.mtime,
                                    size:raw.size,error:raw.error,body:doc?(Array.isArray(doc.data)?doc.data.join(''):doc.data):null});
                            }
                            return {revisions:result,provenance:await core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1').get(path)};
                        `
                            ),
                        });
                    }
                    await page.screenshot({ path: join(diagnostics, `${name}-${device}-failure.png`) });
                    try {
                        await evaluate(page, "await manager.waitForIdle();");
                    } catch (error) {
                        observations.push({ name, device, flushFailure: String(error) });
                        flushFailure ??= error;
                    }
                }
                if (flushFailure) throw flushFailure;
            });
            await pause(500);
        }
        await writeFile(join(diagnostics, "evidence.json"), redact(evidence));
    }

    try {
        await createCouchDbDatabase(config, dbName);
        ownedDatabase = true;
        for (const name of ["a", "b"]) {
            const slot = { name, vault: await createTemporaryVault(`issue1207-live-batch-${name}-`) };
            slots.push(slot);
            await start(slot);
        }
        evidence.runtime = await withPair(async (pair) => {
            const versions = [];
            for (const page of [pair.a, pair.b]) {
                versions.push(
                    await evaluate(
                        page,
                        `let appVersion=null;
                    try {appVersion=JSON.parse(require('fs').readFileSync(require('path').join(process.resourcesPath,'app.asar','package.json'),'utf8')).version;} catch {}
                    return {appVersion,electronVersion:process.versions.electron,
                    pluginVersion:app.plugins.plugins['obsidian-livesync'].manifest.version};`
                    )
                );
                await options(page, "normal");
                const outcome = await evaluate(
                    page,
                    `return await core.services.replication.startContinuous({
                    trigger:'daemon',interaction:{kind:'forbidden'}});`
                );
                check(
                    (outcome as { status?: string })?.status === "completed",
                    `Continuous start failed: ${JSON.stringify(outcome)}`
                );
            }
            return versions;
        });

        evidence.connectivity = await withPair(async (pair) => {
            const path = `${prefix}connectivity.md`;
            await create(pair.a, path, "Connectivity probe\n");
            const first = await settled(pair, path, "Connectivity probe\n");
            await modify(pair.b, path, "Bidirectional connectivity probe\n");
            const second = await settled(pair, path, "Bidirectional connectivity probe\n");
            return { first, second };
        });

        for (const mode of ["normal", "ignored-batch-setting", "enabled-batch"] as const) {
            for (let repeat = 0; repeat < 2; repeat++) {
                await run(`${mode}-coalesce-${repeat}`, () =>
                    withPair(async (pair) => {
                        for (const page of [pair.a, pair.b]) await options(page, mode);
                        const source = repeat === 0 ? pair.a : pair.b;
                        const receiver = repeat === 0 ? pair.b : pair.a;
                        const path = `${prefix}${mode}-edits-${repeat}.md`;
                        await create(source, path, "Initial body\n");
                        const initial = (await settled(pair, path, "Initial body\n"))[0];
                        for (let edit = 0; edit < 6; edit++) {
                            await modify(source, path, `Edit ${edit}\n`);
                            await pause(150);
                        }
                        const during = await snapshot(source, path);
                        const final = await settled(pair, path, "Edit 5\n");
                        const finalSource = repeat === 0 ? final[0] : final[1];
                        const delta = Number(finalSource.rev?.split("-")[0]) - Number(initial.rev?.split("-")[0]);
                        if (mode === "enabled-batch") {
                            check(
                                during.waiting.some((item) => item.path === path),
                                "Batch did not retain the pending edit"
                            );
                            check(delta === 1, `Repeated edits created ${delta} revisions`);
                        } else {
                            check(!during.shouldBatchSave, "LiveSync batching was enabled without an explicit choice");
                            check(delta >= 3, `The control did not expose enough edits: ${delta}`);
                        }
                        return {
                            path,
                            initial,
                            during,
                            final,
                            revisionDelta: delta,
                            source: await trace(source, path),
                            receiver: await trace(receiver, path),
                        };
                    })
                );
            }

            await run(`${mode}-template-lifecycle`, () =>
                withPair(async (pair) => {
                    for (const page of [pair.a, pair.b]) await options(page, mode);
                    const oldPath = `${prefix}${mode}-untitled.md`;
                    const path = `${prefix}${mode}-completed.md`;
                    await create(pair.a, oldPath, "");
                    await pause(300);
                    await modify(pair.a, oldPath, "Template in progress\n");
                    await pause(300);
                    await evaluate(
                        pair.a,
                        `await app.fileManager.renameFile(app.vault.getFileByPath(${JSON.stringify(oldPath)}),${JSON.stringify(path)});`
                    );
                    await pause(300);
                    await modify(pair.a, path, "Completed template\n");
                    const during = await snapshot(pair.a, path);
                    const final = await settled(pair, path, "Completed template\n");
                    await waitFor(pair.b, oldPath, (state) => !state.exists && liveLeaves(state).length === 0);
                    return {
                        oldPath,
                        path,
                        during,
                        final,
                        oldSource: await snapshot(pair.a, oldPath),
                        oldReceiver: await snapshot(pair.b, oldPath),
                        source: await trace(pair.a, path),
                        receiver: await trace(pair.b, path),
                        oldSourceTrace: await trace(pair.a, oldPath),
                        oldReceiverTrace: await trace(pair.b, oldPath),
                    };
                })
            );

            for (const physical of [false, true]) {
                await run(`${mode}-recreate-${physical}`, () =>
                    withPair(async (pair) => {
                        for (const page of [pair.a, pair.b]) {
                            await options(page, mode);
                            await evaluate(
                                page,
                                `core.services.setting.currentSettings().deleteMetadataOfDeletedFiles=${physical};`
                            );
                        }
                        const path = `${prefix}${mode}-recreate-${physical}.md`;
                        await create(pair.a, path, "Transient body\n");
                        await pause(400);
                        await evaluate(
                            pair.a,
                            `await app.vault.delete(app.vault.getFileByPath(${JSON.stringify(path)}),true);`
                        );
                        await pause(400);
                        await create(pair.a, path, "Recreated body\n");
                        const final = await settled(pair, path, "Recreated body\n");
                        return {
                            physical,
                            final,
                            source: await trace(pair.a, path),
                            receiver: await trace(pair.b, path),
                        };
                    })
                );
            }
        }

        for (const incoming of ["identical", "different", "delete"] as const) {
            await run(`enabled-pending-incoming-${incoming}`, () =>
                withPair(async (pair) => {
                    await options(pair.a, "enabled-batch", 5, 60);
                    await options(pair.b, "normal", 5, 60);
                    const path = `${prefix}pending-${incoming}.md`;
                    await create(pair.b, path, "Shared base\n");
                    const initial = await settled(pair, path, "Shared base\n");
                    const local = "Local edit\n";
                    await modify(pair.a, path, local);
                    const pending = await waitFor(pair.a, path, (state) =>
                        state.waiting.some((item) => item.path === path)
                    );
                    check(pending.rev === initial[0].rev, "Local edit reached the DB before incoming delivery");
                    const sentAt = Date.now();
                    if (incoming === "delete") {
                        await evaluate(
                            pair.b,
                            `await app.vault.delete(app.vault.getFileByPath(${JSON.stringify(path)}),true);`
                        );
                    } else await modify(pair.b, path, incoming === "identical" ? local : "Remote edit\n");
                    const arrived = await waitFor(
                        pair.a,
                        path,
                        (state) =>
                            incoming === "identical"
                                ? state.rev !== initial[0].rev && liveLeaves(state).some((leaf) => leaf.body === local)
                                : state.leaves.some((leaf) => leaf.body === local) &&
                                  state.leaves.some((leaf) =>
                                      incoming === "delete" ? leaf.logicalDeleted : leaf.body === "Remote edit\n"
                                  ),
                        4000
                    );
                    check(
                        arrived.waiting.some((item) => item.path === path),
                        "The incoming assertion did not occur during Batch waiting"
                    );
                    const leavesBefore = arrived.leaves.map((leaf) => leaf.rev).sort();
                    if (incoming !== "identical") {
                        check(arrived.content === local, "Incoming reflection overwrote the pending local edit");
                        check(arrived.leaves.length === 2, "Expected exactly two genuine concurrent branches");
                        check(
                            arrived.leaves.every((leaf) => leaf.ancestry[1] === initial[0].rev),
                            "Concurrent branches lost their shared base"
                        );
                    }
                    await pause(5600);
                    const after = await snapshot(pair.a, path);
                    const peer = await snapshot(pair.b, path);
                    check(!after.waiting.some((item) => item.path === path), "Batch timer did not complete");
                    check(
                        JSON.stringify(after.leaves.map((leaf) => leaf.rev).sort()) === JSON.stringify(leavesBefore),
                        "The delayed event created another revision"
                    );
                    check(
                        JSON.stringify(peer.leaves.map((leaf) => leaf.rev).sort()) === JSON.stringify(leavesBefore),
                        "Both branches did not converge to the peer"
                    );
                    if (incoming === "identical")
                        check(after.leaves.length === 1, "Identical content created a branch");
                    return { initial, pending, arrived, after, peer, incomingLatencyMs: Date.now() - sentAt - 5600 };
                })
            );
        }

        await run("enabled-maximum-delay", () =>
            withPair(async (pair) => {
                await options(pair.a, "enabled-batch", 2, 6);
                await options(pair.b, "normal");
                const path = `${prefix}maximum.md`;
                await create(pair.b, path, "Initial maximum body\n");
                const initial = await settled(pair, path, "Initial maximum body\n");
                const started = Date.now();
                let finalBody = "";
                for (let edit = 0; edit < 26; edit++) {
                    finalBody = `Continuous edit ${edit}\n`;
                    await modify(pair.a, path, finalBody);
                    await pause(350);
                }
                const stopped = Date.now();
                const final = await settled(pair, path, finalBody);
                const changes = await evaluate<Array<{ at: number; rev: string }>>(
                    pair.a,
                    `return globalThis.__issue1207Batch.changes.filter(item=>item.path===${JSON.stringify(path)}&&item.rev!==${JSON.stringify(initial[0].rev)});`
                );
                check(changes.length >= 2, "Continuous edits did not produce bounded intermediate and final saves");
                const first = changes[0].at - started;
                check(first >= 5000 && first <= 8000, `Unexpected first maximum-delay flush: ${first}ms`);
                check(changes[0].at < stopped - 1000, "The maximum flush only occurred after typing stopped");
                return { started, stopped, firstSaveMs: first, changes, final };
            })
        );

        await run("enabled-many-paths", () =>
            withPair(async (pair) => {
                await options(pair.a, "enabled-batch", 2, 6);
                await options(pair.b, "normal");
                const started = Date.now();
                for (let index = 0; index < 12; index++)
                    await create(pair.a, `${prefix}many-${index}.md`, `File ${index}\n`);
                const final = [];
                for (let index = 0; index < 12; index++)
                    final.push(await settled(pair, `${prefix}many-${index}.md`, `File ${index}\n`));
                return { elapsedMs: Date.now() - started, final };
            })
        );

        await run("enabled-manual-sync", () =>
            withPair(async (pair) => {
                await options(pair.a, "enabled-batch", 5, 60);
                await options(pair.b, "normal");
                const path = `${prefix}manual.md`;
                await create(pair.b, path, "Before manual sync\n");
                await settled(pair, path, "Before manual sync\n");
                await modify(pair.a, path, "After manual sync\n");
                const pending = await waitFor(pair.a, path, (state) =>
                    state.waiting.some((item) => item.path === path)
                );
                const started = Date.now();
                const outcome = await evaluate(pair.a, "return await core.services.replication.replicate(true);");
                const atReturn = await snapshot(pair.a, path);
                const final = await settled(pair, path, "After manual sync\n");
                const elapsedMs = Date.now() - started;
                check(elapsedMs < 4000, `Manual sync waited for the Batch timer: ${elapsedMs}ms`);
                return { pending, outcome, atReturn, final, elapsedMs };
            })
        );

        const saveAfterEdit = process.env.ISSUE1207_RESTART_SAVE_AFTER_EDIT === "true";
        const restartBucket = process.env.ISSUE1207_RESTART_BUCKET;
        const stopBeforeProvenance = process.env.ISSUE1207_RESTART_BEFORE_PROVENANCE === "true";
        check(!stopBeforeProvenance || !restartBucket, "The provenance and timestamp gates are separate cases");
        check(
            !restartBucket || ["same", "exact", "different"].includes(restartBucket),
            "Unknown restart timestamp condition"
        );
        const restartName = stopBeforeProvenance
            ? `enabled-before-provenance${remoteRestartEdit ? `-${remoteRestartEdit}` : ""}-restart`
            : restartBucket
              ? `enabled-inflight-restart-${restartBucket}`
              : saveAfterEdit
                ? "enabled-settings-save-restart"
                : "enabled-restart";
        await run(restartName, async () => {
            const path = `${prefix}restart.md`;
            const beforeContent =
                remoteRestartEdit === "mergeable"
                    ? "Heading\n\nLocal: original\n\nRemote: original\n\nFooter\n"
                    : "Before restart\n";
            const localContent =
                remoteRestartEdit === "mergeable"
                    ? "Heading\n\nLocal: saved\n\nRemote: original\n\nFooter\n"
                    : "Retained after restart\n";
            const remoteContent =
                remoteRestartEdit === "mergeable"
                    ? "Heading\n\nLocal: saved\n\nRemote: changed remotely\n\nFooter\n"
                    : "Remote edit after the durable save\n";
            const beforeRestart = await withPair(async (pair) => {
                await options(pair.a, "enabled-batch", 5, 60);
                await options(pair.b, "normal");
                // Remote cases keep continuous replication running while the local save is held.
                if (!saveAfterEdit || remoteRestartEdit)
                    await evaluate(
                        pair.a,
                        "await core.services.setting.saveSettingData(); await core.services.control.applySettings();"
                    );
                await create(pair.b, path, beforeContent);
                const initial = await settled(pair, path, beforeContent);
                if (stopBeforeProvenance) {
                    await evaluate(
                        pair.a,
                        `
                        const access=core.serviceModules.databaseFileAccess;
                        const original=access.storeWithBaseRevision.bind(access);
                        access.storeWithBaseRevision=async(file,...args)=>{
                            const revision=await original(file,...args);
                            if(file.path===${JSON.stringify(path)}&&revision){
                                globalThis.__issue1207Batch.beforeProvenanceRevision=revision;
                                await new Promise(resolve=>setTimeout(resolve,30000));
                            }
                            return revision;
                        };
                    `
                    );
                }
                if (restartBucket) {
                    check(initial[0].databaseMtime !== null, "Missing initial database mtime");
                    const mtime =
                        restartBucket === "exact"
                            ? initial[0].databaseMtime
                            : Math.floor(initial[0].databaseMtime / 2000) * 2000 +
                              (restartBucket === "same" ? 1000 : 3000);
                    await evaluate(
                        pair.a,
                        `const original=manager.requestProcessQueue.bind(manager);
                        manager.requestProcessQueue=async item=>{
                            if(item.args?.file?.path===${JSON.stringify(path)}) {
                                globalThis.__issue1207Batch.inflightPaused=true;
                                await new Promise(resolve=>setTimeout(resolve,30000));
                            }
                            return await original(item);
                        };
                        await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(path)}),"Retained after restart\\n",{mtime:${mtime}});`
                    );
                } else await modify(pair.a, path, localContent);
                const pending = await waitFor(pair.a, path, (state) =>
                    state.waiting.some((item) => item.path === path)
                );
                if (saveAfterEdit && !remoteRestartEdit) {
                    await evaluate(pair.a, "await core.services.setting.saveSettingData();");
                    observations.push({
                        phase: "settings-save-before-stop",
                        initial,
                        pending,
                        current: await Promise.all([snapshot(pair.a, path), snapshot(pair.b, path)]),
                        sourceProbe: await evaluate(
                            pair.a,
                            `return {
                            events:globalThis.__issue1207Batch.events,
                            changes:globalThis.__issue1207Batch.changes,
                            provenance:await core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1').get(${JSON.stringify(path)})
                        };`
                        ),
                    });
                }
                if (restartBucket)
                    await evaluate(
                        pair.a,
                        `const deadline=Date.now()+core.services.setting.currentSettings().batchSaveMinimumDelay*1000+3000;
                    while(!globalThis.__issue1207Batch.inflightPaused&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
                    if(!globalThis.__issue1207Batch.inflightPaused) throw new Error('The in-flight test gate did not start');`
                    );
                let durableBeforeProvenance: Snapshot | undefined;
                let remoteAdvanced: Snapshot | undefined;
                if (stopBeforeProvenance) {
                    await evaluate(
                        pair.a,
                        `
                        const deadline=Date.now()+core.services.setting.currentSettings().batchSaveMinimumDelay*1000+5000;
                        while(!globalThis.__issue1207Batch.beforeProvenanceRevision&&Date.now()<deadline)
                            await new Promise(resolve=>setTimeout(resolve,10));
                        if(!globalThis.__issue1207Batch.beforeProvenanceRevision)throw new Error('The durable-write provenance gate did not start');
                    `
                    );
                    durableBeforeProvenance = await snapshot(pair.a, path);
                    const provenance = await evaluate<{ revision: string }>(
                        pair.a,
                        `return await core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1').get(${JSON.stringify(path)});`
                    );
                    check(
                        durableBeforeProvenance.rev !== initial[0].rev &&
                            liveLeaves(durableBeforeProvenance)[0]?.body === localContent,
                        "The gated database write is not durable"
                    );
                    check(
                        provenance?.revision === initial[0].rev,
                        "The fixture did not stop before provenance was updated"
                    );
                    observations.push({
                        phase: "durable-before-provenance",
                        state: durableBeforeProvenance,
                        provenance,
                    });
                    if (remoteRestartEdit) {
                        const receivedOriginal = await waitFor(
                            pair.b,
                            path,
                            (state) => state.rev === durableBeforeProvenance!.rev && state.content === localContent
                        );
                        await modify(pair.b, path, remoteContent);
                        remoteAdvanced = await waitFor(
                            pair.b,
                            path,
                            (state) =>
                                liveLeaves(state).length === 1 &&
                                liveLeaves(state)[0].body === remoteContent &&
                                state.rev === liveLeaves(state)[0].rev &&
                                state.content === remoteContent
                        );
                        check(
                            liveLeaves(remoteAdvanced)[0].ancestry.includes(durableBeforeProvenance.rev!),
                            "The remote edit did not descend from the already durable local save"
                        );
                        const localDbAdvanced = await waitFor(
                            pair.a,
                            path,
                            (state) =>
                                state.rev === remoteAdvanced!.rev &&
                                liveLeaves(state).length === 1 &&
                                liveLeaves(state)[0].body === remoteContent
                        );
                        const stillOldProvenance = await evaluate<{ revision: string }>(
                            pair.a,
                            `return await core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1').get(${JSON.stringify(path)});`
                        );
                        check(
                            localDbAdvanced.content === localContent && stillOldProvenance.revision === initial[0].rev,
                            "The incoming DB change did not precede Vault reflection and provenance persistence"
                        );
                        observations.push({
                            phase: "remote-edit-local-db-ahead-of-storage",
                            receivedOriginal,
                            remoteAdvanced,
                            localDbAdvanced,
                            stillOldProvenance,
                        });
                    }
                }
                await evaluate(pair.a, "await manager._takeSnapshot();");
                check(pending.rev === initial[0].rev, "Restart test did not retain a pending edit");
                if (restartBucket) {
                    const inFlight = await snapshot(pair.a, path);
                    const saved = await evaluate<Array<{ path: string }>>(
                        pair.a,
                        `return (await manager.adapter.persistence.loadSnapshot()).map(item=>({path:item.args?.file?.path}));`
                    );
                    check(
                        inFlight.rev === initial[0].rev && !inFlight.waiting.some((item) => item.path === path),
                        "The in-flight fixture did not stop between gate release and database storage"
                    );
                    check(
                        saved.some((item) => item.path === path),
                        "The in-flight event was lost from the recoverable snapshot"
                    );
                    check(inFlight.fileMtime !== null && inFlight.databaseMtime !== null, "Missing in-flight mtimes");
                    const sameBucket =
                        Math.floor(inFlight.fileMtime / 2000) === Math.floor(inFlight.databaseMtime / 2000);
                    check(sameBucket === (restartBucket !== "different"), "The timestamp condition was not applied");
                    if (restartBucket === "exact")
                        check(inFlight.fileMtime === inFlight.databaseMtime, "Raw mtimes differ");
                    observations.push({
                        phase: "inflight-before-stop",
                        restartBucket,
                        pauseBeforeDatabaseMs: 30000,
                        inFlight,
                        saved,
                        sameBucket,
                    });
                }
                if (stopBeforeProvenance || (!saveAfterEdit && !restartBucket)) {
                    const strictState = await snapshot(pair.a, path);
                    const saved = await evaluate<Array<{ path: string }>>(
                        pair.a,
                        `return (await manager.adapter.persistence.loadSnapshot()).map(item=>({path:item.args?.file?.path}));`
                    );
                    if (!stopBeforeProvenance)
                        check(
                            strictState.rev === initial[0].rev &&
                                strictState.waiting.some((item) => item.path === path),
                            "Restart fixture flushed before shutdown"
                        );
                    check(
                        saved.some((item) => item.path === path),
                        "Restart fixture did not persist the pending event"
                    );
                    observations.push({
                        phase: "restart-verified-pending-snapshot",
                        strictState,
                        saved,
                        initialized: await evaluate(pair.a, "return await core.kvDB.get('initialized');"),
                    });
                }
                if (!saveAfterEdit)
                    observations.push({
                        phase: "restart-before-stop",
                        initial,
                        pending,
                        persisted: await evaluate(
                            pair.a,
                            `const events=await manager.adapter.persistence.loadSnapshot();
                        const settings=core.services.setting.currentSettings();
                        return {initialized:await core.kvDB.get('initialized'),restorationRequested:manager.snapShotRestored!==null,
                            settings:{isConfigured:settings.isConfigured,liveSync:settings.liveSync,batchSave:settings.batchSave,batchSaveInLiveSync:settings.batchSaveInLiveSync,
                            suspendFileWatching:settings.suspendFileWatching,disableMarkdownAutoMerge:settings.disableMarkdownAutoMerge},
                            events:events?.map(item=>({type:item.type,path:item.args?.file?.path,
                                stat:item.args?.file?.stat,skipBatchWait:item.skipBatchWait}))};`
                        ),
                    });
                return { initial, pending, durableBeforeProvenance, remoteAdvanced };
            });
            await stop(slots[0]);
            const persistedSettings = JSON.parse(
                await readFile(join(slots[0].vault.path, ".obsidian/plugins/obsidian-livesync/data.json"), "utf8")
            );
            observations.push({
                phase: "restart-on-disk-settings",
                settings: Object.fromEntries(
                    [
                        "isConfigured",
                        "liveSync",
                        "batchSave",
                        "batchSaveInLiveSync",
                        "suspendFileWatching",
                        "settingVersion",
                    ].map((key) => [key, persistedSettings[key]])
                ),
            });
            await start(slots[0], true);
            const afterRestart = await withPair(async (pair) => {
                observations.push({
                    phase: "restart-after-boot",
                    state: await snapshot(pair.a, path),
                    persisted: await evaluate(
                        pair.a,
                        `const events=await manager.adapter.persistence.loadSnapshot();
                        const settings=core.services.setting.currentSettings();
                        return {initialized:await core.kvDB.get('initialized'),restorationRequested:manager.snapShotRestored!==null,
                            settings:{isConfigured:settings.isConfigured,liveSync:settings.liveSync,batchSave:settings.batchSave,batchSaveInLiveSync:settings.batchSaveInLiveSync,
                            suspendFileWatching:settings.suspendFileWatching},
                            events:events?.map(item=>({type:item.type,path:item.args?.file?.path,stat:item.args?.file?.stat}))};`
                    ),
                });
                if (remoteRestartEdit === "conflicting") {
                    const preservesBothBodies = (state: Snapshot) => {
                        const leaves = liveLeaves(state);
                        return (
                            leaves.length === 2 &&
                            leaves.some((leaf) => leaf.body === localContent) &&
                            leaves.some(
                                (leaf) => leaf.body === remoteContent && leaf.rev === beforeRestart.remoteAdvanced!.rev
                            )
                        );
                    };
                    const result = await Promise.all([
                        waitFor(pair.a, path, preservesBothBodies),
                        waitFor(pair.b, path, preservesBothBodies),
                    ]);
                    check(
                        result[0].content === localContent && result[1].content === remoteContent,
                        "An unresolved conflict overwrote one of the preserved Vault contents"
                    );
                    const manualDialogue = pair.a.locator(".modal").filter({ hasText: "Conflicting changes" });
                    await manualDialogue.waitFor({ state: "visible", timeout: 10000 });
                    await pair.a.screenshot({ path: join(diagnostics, `${restartName}-manual-conflict.png`) });
                    return { result, manualConflict: true, restoredGuard: result[0].shouldBatchSave };
                }
                const expectedContent = remoteRestartEdit ? remoteContent : localContent;
                const result = await settled(pair, path, expectedContent, saveAfterEdit || stopBeforeProvenance);
                check(result[0].shouldBatchSave, "The saved LiveSync batching choice was not restored");
                if (beforeRestart.remoteAdvanced) {
                    for (const state of result)
                        check(
                            liveLeaves(state)[0].ancestry.includes(beforeRestart.remoteAdvanced.rev!),
                            "Sensible merge lost the later remote revision's ancestry"
                        );
                    check(
                        (await pair.a.locator(".modal").filter({ hasText: "Conflicting changes" }).count()) === 0,
                        "The mergeable recovery left a manual conflict dialogue"
                    );
                }
                for (const [index, page] of [pair.a, pair.b].entries()) {
                    const provenance = await evaluate<{ revision: string }>(
                        page,
                        `const store=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');
                        const deadline=Date.now()+5000;
                        let record;
                        do {
                            record=await store.get(${JSON.stringify(path)});
                            if(record?.revision===${JSON.stringify(result[index].rev)})return record;
                            await new Promise(resolve=>setTimeout(resolve,10));
                        }while(Date.now()<deadline);
                        return record;`
                    );
                    check(
                        provenance?.revision === result[index].rev,
                        "Recovery did not record the converged file revision"
                    );
                }
                return { result, restoredGuard: result[0].shouldBatchSave };
            });
            let repeatedRestart: Snapshot[] | undefined;
            if (stopBeforeProvenance && remoteRestartEdit !== "conflicting") {
                await stop(slots[0]);
                await start(slots[0], true);
                repeatedRestart = await withPair(async (pair) => {
                    const result = await settled(pair, path, remoteRestartEdit ? remoteContent : localContent, true);
                    check(
                        result[0].rev === afterRestart.result[0].rev,
                        "A repeated restart created another revision after recovery had converged"
                    );
                    check(
                        result[0].leaves.length === afterRestart.result[0].leaves.length,
                        "A repeated restart added another branch after recovery had converged"
                    );
                    return result;
                });
            }
            return { beforeRestart, afterRestart, repeatedRestart };
        });

        await run("enabled-after-write-restart", async () => {
            const path = `${prefix}after-write.md`;
            const saved = await withPair(async (pair) => {
                await options(pair.a, "enabled-batch", 1, 3);
                await options(pair.b, "normal");
                await evaluate(
                    pair.a,
                    "await core.services.setting.saveSettingData(); await core.services.control.applySettings();"
                );
                await create(pair.b, path, "Before the durable write\n");
                const initial = await settled(pair, path, "Before the durable write\n");
                await evaluate(
                    pair.a,
                    `
                    const original=manager.requestProcessQueue.bind(manager);
                    manager.requestProcessQueue=async item=>{
                        await original(item);
                        if(item.args?.file?.path===${JSON.stringify(path)}) {
                            globalThis.__issue1207Batch.afterWritePaused=true;
                            await new Promise(resolve=>setTimeout(resolve,30000));
                        }
                    };
                    await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(path)}),"Durable before restart\\n");
                    const deadline=Date.now()+6000;
                    while(!globalThis.__issue1207Batch.afterWritePaused&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
                    if(!globalThis.__issue1207Batch.afterWritePaused) throw new Error('The after-write gate did not start');
                    await manager._takeSnapshot();
                `
                );
                const durable = await snapshot(pair.a, path);
                const pending = await evaluate<Array<{ path: string }>>(
                    pair.a,
                    "return (await manager.adapter.persistence.loadSnapshot()).map(item=>({path:item.args?.file?.path}));"
                );
                check(durable.rev !== initial[0].rev, "The database write did not complete before interruption");
                check(
                    pending.some((item) => item.path === path),
                    "The after-write operation was not recoverable"
                );
                return { initial, durable, pending };
            });
            const restarts = [];
            for (let attempt = 0; attempt < 2; attempt++) {
                await stop(slots[0]);
                await start(slots[0], true);
                const final = await withPair((pair) => settled(pair, path, "Durable before restart\n"));
                check(final[0].rev === saved.durable.rev, "Replay created a duplicate database revision");
                restarts.push(final);
            }
            const later = await withPair(async (pair) => {
                await modify(pair.a, path, "A later edit survives\n");
                return await settled(pair, path, "A later edit survives\n");
            });
            return { saved, restarts, later };
        });

        await run("enabled-before-snapshot-restart-exact", async () => {
            const path = `${prefix}before-snapshot.md`;
            const beforeStop = await withPair(async (pair) => {
                await options(pair.a, "enabled-batch", 5, 60);
                await options(pair.b, "normal");
                await evaluate(
                    pair.a,
                    "await core.services.setting.saveSettingData(); await core.services.control.applySettings();"
                );
                await create(pair.b, path, "Before the first snapshot\n");
                const initial = await settled(pair, path, "Before the first snapshot\n");
                check(initial[0].databaseMtime !== null, "Missing initial database mtime");
                await evaluate(
                    pair.a,
                    `
                    await manager.waitForIdle();
                    const persistence=manager.adapter.persistence;
                    const original=persistence.saveSnapshot.bind(persistence);
                    persistence.saveSnapshot=async events=>{
                        if(events.some(item=>item.type==='CHANGED'&&item.args?.file?.path===${JSON.stringify(path)})) {
                            globalThis.__issue1207Batch.beforeSnapshotPaused=true;
                            await new Promise(resolve=>setTimeout(resolve,30000));
                        }
                        return await original(events);
                    };
                    await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(path)}),
                        "Recovered without an event snapshot\\n",{mtime:${initial[0].databaseMtime}});
                    const deadline=Date.now()+3000;
                    while(!globalThis.__issue1207Batch.beforeSnapshotPaused&&Date.now()<deadline)
                        await new Promise(resolve=>setTimeout(resolve,10));
                    if(!globalThis.__issue1207Batch.beforeSnapshotPaused)
                        throw new Error('The snapshot persistence gate did not start');
                `
                );
                const state = await snapshot(pair.a, path);
                const persisted = await evaluate<Array<{ path: string }>>(
                    pair.a,
                    "return (await manager.adapter.persistence.loadSnapshot()??[]).map(item=>({path:item.args?.file?.path}));"
                );
                check(state.rev === initial[0].rev, "The unsaved edit reached the database before interruption");
                check(state.fileMtime === state.databaseMtime, "Raw mtimes differ before interruption");
                check(!persisted.some((item) => item.path === path), "The interrupted edit already has a saved event");
                return { initial, state, persisted };
            });
            await stop(slots[0]);
            await start(slots[0], true);
            const recovered = await withPair((pair) => settled(pair, path, "Recovered without an event snapshot\n"));
            check(recovered[0].shouldBatchSave, "The saved LiveSync batching choice was not restored");
            return { beforeStop, recovered };
        });

        evidence.artefactsAfter = hashes();
        check(
            JSON.stringify(before) === JSON.stringify(evidence.artefactsAfter),
            "Plug-in artefacts changed during testing"
        );
        evidence.passed = cases.every((item) => item.passed);
        await writeFile(join(diagnostics, "evidence.json"), redact(evidence));
        console.log(
            JSON.stringify({
                phase: "completed",
                passed: evidence.passed,
                cases: cases.length,
                failed: cases.filter((item) => !item.passed).map((item) => item.name),
            })
        );
        if (!evidence.passed) process.exitCode = 1;
    } finally {
        for (const slot of slots) await stop(slot);
        for (const slot of slots) await slot.vault.dispose();
        if (ownedDatabase) await deleteCouchDbDatabase(config, dbName);
        evidence.cleanup = { devicesStopped: slots.every((slot) => !slot.session), databaseRemoved: ownedDatabase };
        await writeFile(join(diagnostics, "evidence.json"), redact(evidence));
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
