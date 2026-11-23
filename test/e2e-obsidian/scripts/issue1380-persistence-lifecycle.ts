import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCommittedStorageEventSnapshotSource } from "../runner/committedStorageEventSnapshot.ts";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { matchesPlainDatabaseText } from "../runner/localFileRetryAssertions.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

const binary = requireObsidianBinary();
const cliBinary = requireObsidianCli();

async function evaluate<T>(port: number, code: string): Promise<T> {
    return await withObsidianPage(port, (page) =>
        page.evaluate<T>(`(async()=>{
            const pluginId="obsidian-livesync";
            const currentPlugin=()=>app.plugins.plugins[pluginId];
            const plugin=currentPlugin();
            const core=plugin?.core;
            const manager=core?.serviceModules.storageAccess.vaultManager;
            const readSnapshot=${readCommittedStorageEventSnapshotSource};
            const snapshot=async(owner=core)=>await readSnapshot((await owner.kvDB.DB).name);
            const matchesText=${matchesPlainDatabaseText.toString()};
            const databaseHas=async(owner,path,body)=>{
                const doc=await owner.localDatabase.getDBEntry(path,undefined,false,true,true);
                const data=Array.isArray(doc?.data)?doc.data.join(""):doc?.data;
                return !!doc && !doc.deleted && matchesText({type:doc.type,datatype:doc.datatype,body:data},body);
            };
            const require=(condition,message)=>{if(!condition)throw new Error(message);};
            const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
            const within=async(promise,timeout,message)=>{
                let timer;
                try {
                    return await Promise.race([
                        promise, new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),timeout);}),
                    ]);
                } finally {clearTimeout(timer);}
            };
            const waitFor=async(predicate,message)=>{
                const deadline=Date.now()+15000;
                while(Date.now()<deadline){
                    const result=await predicate();
                    if(result)return result;
                    await sleep(25);
                }
                throw new Error(message);
            };
            ${code}
        })()`)
    );
}

async function start(
    vault: TemporaryVault,
    {
        batch = false,
        restart = false,
        seedLegacy = false,
        ignore = "",
    }: {
        batch?: boolean;
        restart?: boolean;
        seedLegacy?: boolean;
        ignore?: string;
    } = {}
): Promise<ObsidianLiveSyncSession> {
    const pluginData = createE2eCouchDbPluginData(
        { uri: "http://127.0.0.1:1", username: "unused", password: "unused", dbName: vault.name },
        {
            liveSync: false,
            periodicReplication: false,
            syncOnStart: false,
            syncOnSave: false,
            syncOnFileOpen: false,
            syncOnEditorSave: false,
            syncAfterMerge: false,
            batchSave: batch,
            batchSaveMinimumDelay: 20,
            batchSaveMaximumDelay: 60,
            syncIgnoreRegEx: ignore,
        }
    );
    const fixture = restart
        ? {}
        : {
              pluginData,
              localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
          };
    const session = await startObsidianLiveSyncSession({
        binary,
        cliBinary,
        vault,
        ...fixture,
        lifecycle: {
            beforeLaunch: async () => {
                const registryPath = join(vault.userDataPath, "obsidian.json");
                const registry = JSON.parse(await readFile(registryPath, "utf8"));
                registry.updateDisabled = true;
                await writeFile(registryPath, JSON.stringify(registry));
            },
            beforePluginStart: seedLegacy
                ? async ({ remoteDebuggingPort }) => await seedLegacySnapshot(remoteDebuggingPort)
                : undefined,
        },
    });
    try {
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        return session;
    } catch (error) {
        await session.app.stop();
        throw error;
    }
}

async function seedLegacySnapshot(port: number): Promise<void> {
    await evaluate(
        port,
        `
        require(!currentPlugin(),"The legacy fixture must be installed before plug-in start");
        const name=app.vault.getName()+"-livesync-kv";
        const fileInfo=path=>{
            const file=app.vault.getFileByPath(path);
            return {name:path,path,isFolder:false,
                stat:{size:file?.stat.size??0,mtime:file?.stat.mtime??0,ctime:file?.stat.ctime??0,type:"file"}};
        };
        const legacy=[
            {type:"CHANGED",args:{file:fileInfo("duplicate.md"),cache:"obsolete editor text"}},
            {type:"CHANGED",args:{file:fileInfo("duplicate.md"),cache:"another obsolete value"}},
            {type:"DELETE",args:{file:{...fileInfo("old.md"),deleted:true},renameTarget:"filtered.md"}},
            {type:"SENTINEL_FLUSH"},
            {type:"CREATE",args:{file:fileInfo("created.md")}},
        ];
        const db=await new Promise((resolve,reject)=>{
            const request=indexedDB.open(name);
            request.onsuccess=()=>resolve(request.result);
            request.onerror=()=>reject(request.error);
        });
        try {
            await new Promise((resolve,reject)=>{
                const tx=db.transaction(name,"readwrite");
                const store=tx.objectStore(name);
                const keys=store.getAllKeys();
                keys.onsuccess=()=>{
                    for(const key of keys.result){
                        if(Array.isArray(key) && /^(storage-event-manager-entry|storage-event-manager-meta)$/.test(key[0]))
                            store.delete(key);
                    }
                    store.put(legacy,"storage-event-manager-snapshot");
                };
                tx.oncomplete=resolve;
                tx.onabort=()=>reject(tx.error);
            });
        } finally {db.close();}

        const seeded=await readSnapshot(name);
        require(!seeded.metadata && seeded.entries.length===0 && JSON.stringify(seeded.events)===JSON.stringify(legacy),
            "The read-only snapshot probe did not return the committed legacy fixture");

        const put=IDBObjectStore.prototype.put;
        const remove=IDBObjectStore.prototype.delete;
        const committedEntries=[];
        let cutoverCommitted=false;
        IDBObjectStore.prototype.put=function(value,key){
            const request=put.apply(this,arguments);
            if(this.name===name && Array.isArray(key) && key[0]==="storage-event-manager-entry") {
                this.transaction.addEventListener("complete",()=>committedEntries.push({key,...value}),{once:true});
            }
            return request;
        };
        IDBObjectStore.prototype.delete=function(key){
            const request=remove.apply(this,arguments);
            if(this.name===name && key==="storage-event-manager-snapshot"){
                this.transaction.addEventListener("complete",()=>{cutoverCommitted=true;},{once:true});
            }
            return request;
        };
        app.__issue1380Migration={
            committedEntries,
            get cutoverCommitted(){return cutoverCommitted;},
            restore(){
                IDBObjectStore.prototype.put=put;
                IDBObjectStore.prototype.delete=remove;
                delete app.__issue1380Migration;
            }
        };
        `
    );
}

async function legacyMigration(vault: TemporaryVault): Promise<unknown> {
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await start(vault, { ignore: "^filtered[.]md$" });
        await evaluate(
            session.remoteDebuggingPort,
            `
            await app.vault.create("duplicate.md","Before migration\\n");
            await app.vault.create("old.md","Rename survived migration\\n");
            await manager.waitForIdle();
            require(await databaseHas(core,"old.md","Rename survived migration\\n"),"Missing original DB entry");
            `
        );
        await session.app.stop();
        session = undefined;

        await writeFile(join(vault.path, "duplicate.md"), "Disk text after migration\n");
        await rename(join(vault.path, "old.md"), join(vault.path, "filtered.md"));
        await writeFile(join(vault.path, "created.md"), "Created while stopped\n");
        session = await start(vault, { restart: true, seedLegacy: true });
        const migration = await evaluate(
            session.remoteDebuggingPort,
            `
            const probe=app.__issue1380Migration;
            try {
                require(probe.cutoverCommitted,"Legacy cutover did not commit");
                const entries=probe.committedEntries;
                require(JSON.stringify(entries.map(({key,event})=>[key[1],event.type,event.args?.file?.path??null]))
                    ===JSON.stringify([[1,"CHANGED","duplicate.md"],[2,"CHANGED","duplicate.md"],
                        [3,"DELETE","old.md"],[4,"SENTINEL_FLUSH",null],[5,"CREATE","created.md"]]),
                    "The committed compound-key records changed the fixture order or dropped an intent");
                require(entries[2].event.args.renameTarget==="filtered.md","Migration lost renameTarget");
                require(entries.every(({event})=>!event.args || !Object.hasOwn(event.args,"cache")),
                    "Migration committed cached editor text");
                const state=await snapshot();
                require(state.legacy===undefined && state.metadata?.format==="incremental-v1" &&
                    state.metadata.highWaterSequence===5 && state.entries.length===0,
                    "The migrated store did not settle as active-empty");
                require(core.services.appLifecycle.isReady(),"The migrated plug-in was not ready");
                require(await databaseHas(core,"duplicate.md","Disk text after migration\\n"),
                    "The duplicate path did not reconcile to the current Vault text");
                require(await databaseHas(core,"created.md","Created while stopped\\n"),
                    "The create intent was not reconciled");
                require(await app.vault.read(app.vault.getFileByPath("filtered.md"))==="Rename survived migration\\n",
                    "The filtered rename target lost its Vault contents");
                const old=await core.localDatabase.getDBEntryMeta("old.md",{},true).catch(error=>{
                    if(error.status===404)return null;
                    throw error;
                });
                require(!old || old.deleted || old._deleted,"The former path was not deleted from the database");
                return {migrated:entries.length,highWater:state.metadata.highWaterSequence};
            } finally {probe.restore();}
            `
        );
        await session.app.stop();
        session = undefined;

        session = await start(vault, { restart: true });
        const secondRestart = await evaluate(
            session.remoteDebuggingPort,
            `
            const state=await snapshot();
            require(core.services.appLifecycle.isReady(),"The second restart did not reach ready");
            require(state.legacy===undefined && state.metadata?.format==="incremental-v1" &&
                state.metadata.highWaterSequence===5 && state.entries.length===0,
                "The second restart changed the active-empty store");
            require(await databaseHas(core,"duplicate.md","Disk text after migration\\n") &&
                await databaseHas(core,"created.md","Created while stopped\\n"),
                "The second restart changed reconciled contents");
            return {ready:true,activeEmpty:true};
            `
        );
        return { migration, secondRestart };
    } finally {
        await session?.app.stop();
    }
}

async function disableWithPendingWork(vault: TemporaryVault, recoveryPaused: boolean): Promise<unknown> {
    const session = await start(vault, { batch: !recoveryPaused });
    try {
        return await evaluate(
            session.remoteDebuggingPort,
            `
            const path="pending.md";
            const body="Pending intent survived plug-in disable\\n";
            const recoveryPaused=${recoveryPaused};
            const store=core.kvDB;
            const storeName=(await store.DB).name;
            let oldHandlers=0;
            let oldWrites=0;
            let oldCloses=0;
            const originalHandle=manager.handleFileEvent;
            manager.handleFileEvent=function(event){
                if(event.args?.file?.path===path)oldHandlers++;
                return originalHandle.apply(this,arguments);
            };
            const originalWrite=store.applyBatch;
            store.applyBatch=function(){
                oldWrites++;
                return originalWrite.apply(this,arguments);
            };
            const originalClose=store.close;
            store.close=function(){
                oldCloses++;
                return originalClose.apply(this,arguments);
            };
            const services=core.services;
            const databaseService=services.database;
            const persistence=manager.adapter.persistence;
            const ackId="issue1380-acknowledgement";
            const originalProbe=databaseService.canReadCurrentDatabaseInfo;
            const originalReopen=databaseService.reopenDatabase;
            const originalResume=manager.resumeDispatch;
            const originalCommit=services.fileProcessing.commitPendingFileEvents;
            const originalAfterRecovery=services.databaseEvents.onAfterDatabaseRecovery;
            const originalUnload=services.control.onUnload;
            let recovery, acknowledgement;
            let reopenStarted=false, acknowledgementStarted=false, controlTeardownStarted=false;
            let resumeCalls=0, commitCalls=0, afterRecoveryCalls=0;
            let releaseReopen, releaseAcknowledgement;
            const reopenGate=new Promise(resolve=>{releaseReopen=resolve;});
            const acknowledgementGate=new Promise(resolve=>{releaseAcknowledgement=resolve;});
            if(recoveryPaused){
                databaseService.canReadCurrentDatabaseInfo=async()=>{
                    throw new DOMException("Test connection closed","InvalidStateError");
                };
                databaseService.reopenDatabase=async()=>{
                    reopenStarted=true;
                    await reopenGate;
                    return true;
                };
                manager.resumeDispatch=function(){
                    resumeCalls++;
                    return originalResume.apply(this,arguments);
                };
                services.fileProcessing.commitPendingFileEvents=function(){
                    commitCalls++;
                    return originalCommit.apply(this,arguments);
                };
                services.databaseEvents.onAfterDatabaseRecovery=function(){
                    afterRecoveryCalls++;
                    return originalAfterRecovery.apply(this,arguments);
                };
                services.control.onUnload=function(){
                    controlTeardownStarted=true;
                    return originalUnload.apply(this,arguments);
                };
            }
            try {
                if(recoveryPaused){
                    recovery=services.databaseEvents.onBeforeDatabaseResume();
                    void recovery.catch(()=>{});
                    await waitFor(()=>reopenStarted,"Database recovery did not hold dispatch at the reopen boundary");
                    await persistence.applySnapshotDelta({
                        upsert:[{id:ackId,event:{type:"SENTINEL_FLUSH"}}],remove:[]
                    });
                }
                await app.vault.create(path,body);
                const before=await waitFor(async()=>{
                    if(!recoveryPaused && !manager._waitingMap.has(path))return false;
                    const state=await snapshot();
                    return state.entries.some(({event})=>event.args?.file?.path===path) && state;
                },"The real Vault notification did not become durable pending work");
                require(oldHandlers===0 && (recoveryPaused || !(await databaseHas(core,path,body))),
                    "The old handler ran before disable");
                const pending=before.entries.find(({event})=>event.args?.file?.path===path);
                require(before.metadata?.format==="incremental-v1","The pending record has no active metadata");

                const database=databaseService.localDatabaseDirect;
                const close=database.close;
                let closeStarted=false;
                let releaseClose;
                const closeGate=new Promise(resolve=>{releaseClose=resolve;});
                if(!recoveryPaused)database.close=async function(){
                    closeStarted=true;
                    await closeGate;
                    return await close.apply(this,arguments);
                };
                try {
                    if(recoveryPaused){
                        const trackedWrite=store.applyBatch;
                        store.applyBatch=async function(operations){
                            await trackedWrite.apply(this,arguments);
                            if(operations.some(({type})=>type==="delete")){
                                acknowledgementStarted=true;
                                await acknowledgementGate;
                            }
                        };
                        acknowledgement=persistence.applySnapshotDelta({upsert:[],remove:[ackId]}).catch(error=>{
                            if(error.message!=="Storage event persistence was interrupted")throw error;
                        });
                        void acknowledgement.catch(()=>{});
                        await waitFor(()=>acknowledgementStarted,"The IndexedDB acknowledgement did not reach its gate");
                    }
                    const disabledAt=Date.now();
                    await within(app.plugins.disablePlugin(pluginId),5000,"Plug-in disable hung");
                    const disableMs=Date.now()-disabledAt;
                    require(manager.isStopping(),"Disable did not install the old manager's stop fence");
                    let enabling;
                    if(recoveryPaused){
                        require(services.appLifecycle.isUnloading() && !controlTeardownStarted,
                            "Disable did not fence recovery before control teardown");
                        releaseReopen();
                        require(await within(recovery,5000,"The recovery continuation hung")===false,
                            "Recovery completed after disable");
                        require(resumeCalls===0 && commitCalls===0 && afterRecoveryCalls===0 && !controlTeardownStarted,
                            "The recovery continuation resumed work while unload was waiting for the acknowledgement");
                        releaseAcknowledgement();
                        await within(acknowledgement,5000,"The acknowledgement did not settle");
                    } else {
                        enabling=app.plugins.enablePlugin(pluginId);
                        await waitFor(()=>closeStarted,"The old manager did not reach database close");
                        require(!currentPlugin()?.core?.services.appLifecycle.isReady(),
                            "The replacement plug-in reached ready before old database close");
                        releaseClose();
                    }
                    await within(plugin.unloading,10000,"Asynchronous plug-in unload hung");
                    const writesAtHandoff=oldWrites;
                    const closesAtHandoff=oldCloses;
                    if(recoveryPaused){
                        const after=await readSnapshot(storeName);
                        require(!after.entries.some(({id})=>id===ackId),"The held acknowledgement did not commit");
                        require(after.metadata?.format==="incremental-v1" &&
                            after.entries.some(({id,event})=>id===pending.id && event.args?.file?.path===path),
                            "Unloading during the held pause lost the committed intent");
                        enabling=app.plugins.enablePlugin(pluginId);
                    }
                    await within(enabling,5000,"Plug-in enable hung");
                    const newCore=await waitFor(()=>{
                        const candidate=currentPlugin()?.core;
                        return candidate!==core && candidate?.services.appLifecycle.isReady() && candidate;
                    },"The hot re-enable did not reach ready");
                    await newCore.serviceModules.storageAccess.vaultManager.waitForIdle();
                    require(await databaseHas(newCore,path,body),"The replacement plug-in did not reconcile pending content");
                    const after=await snapshot(newCore);
                    require(after.metadata?.highWaterSequence===before.metadata.highWaterSequence && after.entries.length===0,
                        "Pending work did not replay and acknowledge the original snapshot on re-enable");
                    require(oldHandlers===0,"The old manager dispatched pending work during unload");
                    require(oldWrites===writesAtHandoff && oldCloses===closesAtHandoff,
                        "The old store was written or closed after handoff: "+
                        JSON.stringify({writesAtHandoff,closesAtHandoff,oldWrites,oldCloses}));
                    return {disableMs,ready:true,oldHandlers,pendingId:pending.id,
                        postHandoffWrites:oldWrites-writesAtHandoff,postHandoffCloses:oldCloses-closesAtHandoff,
                        ...(recoveryPaused ? {resumeCalls,commitCalls,afterRecoveryCalls} : {})};
                } finally {
                    releaseClose();
                    database.close=close;
                }
            } finally {
                releaseReopen();
                releaseAcknowledgement();
                store.applyBatch=originalWrite;
                store.close=originalClose;
                manager.handleFileEvent=originalHandle;
                if(recoveryPaused){
                    databaseService.canReadCurrentDatabaseInfo=originalProbe;
                    databaseService.reopenDatabase=originalReopen;
                    manager.resumeDispatch=originalResume;
                    services.fileProcessing.commitPendingFileEvents=originalCommit;
                    services.databaseEvents.onAfterDatabaseRecovery=originalAfterRecovery;
                    services.control.onUnload=originalUnload;
                }
            }
            `
        );
    } finally {
        await session.app.stop();
    }
}

async function editorBatching(vault: TemporaryVault): Promise<unknown> {
    await writeFile(join(vault.path, "editor.md"), "Initial note\n");
    const session = await start(vault, { batch: true });
    try {
        return await evaluate(
            session.remoteDebuggingPort,
            `
            const path="editor.md";
            const file=app.vault.getFileByPath(path);
            const leaf=app.workspace.getLeaf(false);
            await leaf.openFile(file);
            const editor=leaf.view.editor;
            require(editor && manager.shouldBatchSave && !core.services.setting.currentSettings().liveSync,
                "The Markdown editor was not in ordinary batch mode");
            const type=text=>editor.replaceRange(text,editor.offsetToPos(editor.getValue().length));
            type("first edit");
            const initial=await waitFor(async()=>{
                const waiting=manager._waitingMap.get(path);
                if(!waiting)return false;
                const state=await snapshot();
                const entries=state.entries.filter(({event})=>event.args?.file?.path===path);
                return entries.length===1 && {waiting,entries};
            },"The first editor save did not create one committed batch intent");

            const deadline=initial.waiting.deadline;
            const originalSchedule=deadline.schedule;
            const scheduled=[];
            deadline.schedule=function(delay){
                scheduled.push(Date.now()+delay);
                return originalSchedule.apply(this,arguments);
            };
            let beforeSave;
            try {
                for(const text of [" a"," b"," c"]){
                    await sleep(60);
                    type(text);
                }
                beforeSave=await snapshot();
                require(manager._waitingMap.get(path)===initial.waiting && scheduled.length===3 &&
                    scheduled.every((time,index)=>index===0 || time>scheduled[index-1]),
                    "Real editor changes did not extend the same batch deadline");
                const entries=beforeSave.entries.filter(({event})=>event.args?.file?.path===path);
                require(JSON.stringify(entries)===JSON.stringify(initial.entries),
                    "Timing hints changed or duplicated the committed record");
                require(entries.every(({event})=>!Object.hasOwn(event.args,"cache")),
                    "An editor cache was persisted in the committed payload");
            } finally {deadline.schedule=originalSchedule;}

            const expected="Initial note\\nfirst edit a b c";
            await waitFor(async()=>await app.vault.read(file)===expected,"The editor did not save the typed text");
            await manager.waitForIdle();
            require(await databaseHas(core,path,expected),"Manual flush did not store the final editor text");
            require((await snapshot()).entries.length===0,"Manual flush left committed pending entries");
            return {deadlineExtensions:scheduled.length,persistedDuringTyping:initial.entries.length,flushed:true};
            `
        );
    } finally {
        await session.app.stop();
    }
}

const cases = [
    ["legacy migration and second restart", legacyMigration],
    ["immediate hot disable and re-enable", (vault: TemporaryVault) => disableWithPendingWork(vault, false)],
    ["disable during a held recovery pause", (vault: TemporaryVault) => disableWithPendingWork(vault, true)],
    ["real editor changes in ordinary batch mode", editorBatching],
] as const;

const observations: Array<{ name: string; result?: unknown; error?: string }> = [];
for (const [name, run] of cases) {
    const vault = await createTemporaryVault("obsidian-issue1380-");
    try {
        observations.push({ name, result: await run(vault) });
        console.log(`PASS ${name}`);
    } catch (error) {
        observations.push({ name, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
        console.error(`FAIL ${name}`, error);
    } finally {
        await vault.dispose();
    }
}
const ok = observations.every(({ error }) => error === undefined);
const bundleHash = createHash("sha256")
    .update(new Uint8Array(await readFile("main.js")))
    .digest("hex");
console.log(JSON.stringify({ ok, bundleHash, observations }, null, 2));
if (!ok) process.exitCode = 1;
