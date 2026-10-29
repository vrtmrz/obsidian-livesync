/** Checks incomplete-document integrity against real Vault storage in Obsidian. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { evalObsidianJson } from "../runner/cli.ts";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

const filePath = "startup-integrity.md";
const fileContent = "startup integrity remains healthy\n";

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cliBinary = requireObsidianCli();
    const vault = await createTemporaryVault("obsidian-startup-integrity-");
    let session: ObsidianLiveSyncSession | undefined;
    const bundleHash = createHash("sha256")
        .update(new Uint8Array(await readFile("main.js")))
        .digest("hex");
    const settings = createE2eCouchDbPluginData(
        // No replication is enabled; this scenario uses only the local database.
        { uri: "http://127.0.0.1:1", username: "unused", password: "unused", dbName: "startup-integrity-local" },
        {
            deviceAndVaultName: "startup-integrity-device",
            liveSync: false,
            periodicReplication: false,
            syncOnStart: false,
            syncOnSave: false,
            syncOnFileOpen: false,
            syncOnEditorSave: false,
            syncAfterMerge: false,
        }
    );

    async function evaluate<T>(body: string): Promise<T> {
        if (!session) throw new Error("The Obsidian session is not running");
        return await evalObsidianJson<T>(
            cliBinary,
            `(async()=>{
                const core=app.plugins.plugins['obsidian-livesync']?.core;
                const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
                const require=(condition,message)=>{if(!condition)throw new Error(message);};
                const waitFor=async(predicate,message,timeoutMs=15000)=>{
                    const deadline=Date.now()+timeoutMs;
                    while(Date.now()<deadline){
                        if(await predicate())return;
                        await sleep(20);
                    }
                    throw new Error(message);
                };
                ${body}
            })()`,
            session.cliEnv
        );
    }

    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            pluginData: settings,
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await evaluate(`
            require(core, 'Self-hosted LiveSync did not load');
            require(app.vault.getAbstractFileByPath(${JSON.stringify(filePath)})===null,
                'The integrity fixture already exists in the Vault');
            await app.vault.create(${JSON.stringify(filePath)},${JSON.stringify(fileContent)});
            return JSON.stringify({created:${JSON.stringify(filePath)}});
        `);
        await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, filePath);

        const observations = await evaluate<unknown[]>(`
            require(await core.services.fileProcessing.commitPendingFileEvents(), 'Initial local flush failed');
            const path=${JSON.stringify(filePath)};
            const expectedContent=${JSON.stringify(fileContent)};
            const storage=core.serviceModules.storageAccess;
            const fileHandler=core.serviceModules.fileHandler;
            const keyValueDB=core.services.keyValueDB.kvDB;
            const confirm=core.services.UI.confirm;
            const noticeGroups=core.services.context.noticeGroups;
            const events=core.services.context.events;
            require(storage&&typeof storage.statHidden==='function'&&
                typeof storage.readHiddenFileBinary==='function',
                'The real StorageAccess methods were not available');
            require(fileHandler&&typeof fileHandler.storeFileToDB==='function',
                'The real file handler was not available');

            const snapshot=async()=>{
                const meta=await core.localDatabase.getDBEntryMeta(path,undefined,true);
                require(meta&&meta._rev,'The integrity fixture Metadata was missing');
                const doc=await core.localDatabase.getDBEntryFromMeta(meta);
                require(doc&&doc.data!==undefined,'The integrity fixture Chunks could not be loaded');
                const content=Array.isArray(doc.data)?doc.data.join(''):doc.data;
                require(typeof content==='string','The Markdown fixture did not load as text');
                const bytes=Array.from(new TextEncoder().encode(content));
                require(meta.size===bytes.length,'Metadata size did not match the stored bytes');
                require(doc.size===bytes.length,'Loaded document size did not match the stored bytes');
                return {revision:meta._rev,metadataSize:meta.size,documentSize:doc.size,content,bytes};
            };
            const assertUnchanged=(before,after,label)=>{
                require(before.revision===after.revision,label+': the Metadata revision changed');
                require(before.metadataSize===after.metadataSize,label+': the Metadata size changed');
                require(before.content===after.content,label+': the stored content changed');
                require(JSON.stringify(before.bytes)===JSON.stringify(after.bytes),
                    label+': the stored bytes changed');
            };
            const activeBytes=async()=>{
                const content=await app.vault.adapter.read(path);
                return {content,bytes:Array.from(new TextEncoder().encode(content))};
            };
            const marker=async()=>await keyValueDB.get('checkIncompleteDocs')===true;
            const activeState={current:null};
            const originalStat=storage.statHidden;
            const originalRead=storage.readHiddenFileBinary;
            const originalStore=fileHandler.storeFileToDB;
            const originalDialogue=confirm.askSelectStringDialogue;
            const ownStat=Object.prototype.hasOwnProperty.call(storage,'statHidden');
            const ownRead=Object.prototype.hasOwnProperty.call(storage,'readHiddenFileBinary');
            const ownStore=Object.prototype.hasOwnProperty.call(fileHandler,'storeFileToDB');
            const ownDialogue=Object.prototype.hasOwnProperty.call(confirm,'askSelectStringDialogue');
            const unhandledErrors=[];
            const onUnhandled=event=>{
                const reason=event.reason;
                unhandledErrors.push(String(reason&&reason.message?reason.message:reason));
                event.preventDefault();
            };
            let installedStat=false;
            let installedRead=false;
            let installedStore=false;
            let installedDialogue=false;
            const restore=(owner,key,hadOwn,original)=>{
                if(hadOwn)owner[key]=original;
                else delete owner[key];
            };

            const onStat=async function(candidatePath){
                const actual=await originalStat.call(this,candidatePath);
                const current=activeState.current;
                if(!current||candidatePath!==path)return actual;
                current.statCalls++;
                require(actual&&actual.type==='file','StorageAccess did not report the fixture as a file');
                current.actualStats.push({size:actual.size,mtime:actual.mtime,ctime:actual.ctime});
                if(current.mode==='stat-read-race'&&current.statCalls===1){
                    const oldStat={...actual,size:actual.size+1};
                    current.returnedStats.push({size:oldStat.size,mtime:oldStat.mtime,ctime:oldStat.ctime});
                    return oldStat;
                }
                if(current.mode==='unstable-final-stat'&&current.statCalls===2){
                    const changedStat={...actual,mtime:actual.mtime+1};
                    current.returnedStats.push({size:changedStat.size,mtime:changedStat.mtime,ctime:changedStat.ctime});
                    return changedStat;
                }
                current.returnedStats.push({size:actual.size,mtime:actual.mtime,ctime:actual.ctime});
                return actual;
            };
            const onRead=async function(candidatePath){
                const bytes=await originalRead.call(this,candidatePath);
                const current=activeState.current;
                if(current&&candidatePath===path){
                    current.readCalls++;
                    current.readBytes=Array.from(new Uint8Array(bytes));
                }
                return bytes;
            };
            const onStore=async function(file,...args){
                const current=activeState.current;
                if(current&&file?.path===path)current.repairCalls++;
                return await originalStore.call(this,file,...args);
            };
            const onDialogue=async function(message,buttons,...args){
                const current=activeState.current;
                if(current){
                    current.dialogueCalls++;
                    current.dialogueMessages.push(String(message));
                    return Array.isArray(buttons)&&buttons.length>0?buttons[0]:false;
                }
                return await originalDialogue.call(this,message,buttons,...args);
            };

            const runRegisteredCheck=async current=>{
                const originalFinish=noticeGroups.finish;
                const ownFinish=Object.prototype.hasOwnProperty.call(noticeGroups,'finish');
                let finished=false;
                noticeGroups.finish=function(...args){
                    try{return originalFinish.apply(this,args);}
                    finally{
                        if(args[0]==='startup-integrity-check')finished=true;
                    }
                };
                activeState.current=current;
                try{
                    events.emitEvent('request-run-fix-incomplete');
                    await waitFor(()=>finished,'The registered incomplete-document check did not finish');
                }finally{
                    activeState.current=null;
                    restore(noticeGroups,'finish',ownFinish,originalFinish);
                }
            };
            const makeObservation=mode=>({
                mode,
                statCalls:0,
                actualStats:[],
                returnedStats:[],
                readCalls:0,
                readBytes:[],
                dialogueCalls:0,
                dialogueMessages:[],
                repairCalls:0,
            });

            window.addEventListener('unhandledrejection',onUnhandled);
            try{
                storage.statHidden=onStat;
                installedStat=true;
                storage.readHiddenFileBinary=onRead;
                installedRead=true;
                fileHandler.storeFileToDB=onStore;
                installedStore=true;
                confirm.askSelectStringDialogue=onDialogue;
                installedDialogue=true;

                const firstStorageStat=await storage.statHidden(path);
                require(firstStorageStat&&firstStorageStat.type==='file',
                    'The real Vault file was not visible through StorageAccess');
                const firstVault=await activeBytes();
                const first=snapshot();
                const healthyBefore=await first;
                require(firstVault.content===expectedContent&&healthyBefore.content===expectedContent,
                    'The fixture content did not match between the Vault and Metadata');
                require(firstStorageStat.size===healthyBefore.bytes.length,
                    'The real Vault size did not match the Metadata bytes');

                await keyValueDB.set('checkIncompleteDocs',false);
                const healthy=makeObservation('healthy');
                const healthyUnhandledBefore=unhandledErrors.length;
                await runRegisteredCheck(healthy);
                const healthyAfter=await snapshot();
                const healthyMarker=await marker();
                const healthyVaultAfter=await activeBytes();
                require(healthy.statCalls===2,'The healthy fixture was not checked with both StorageAccess stats');
                require(healthy.readCalls===0,'The healthy fixture was read only to determine its size');
                require(healthy.dialogueCalls===0,'The healthy fixture opened a repair dialogue');
                require(healthy.repairCalls===0,'The healthy fixture invoked repair');
                require(healthyMarker,'The healthy integrity check did not set its completion marker');
                require(unhandledErrors.length===healthyUnhandledBefore,
                    'The healthy integrity check raised an unhandled error');
                require(healthyVaultAfter.content===expectedContent,'The healthy Vault file changed');
                assertUnchanged(healthyBefore,healthyAfter,'Healthy scan');
                const observations=[
                    {
                        case:'healthy',
                        revision:healthyAfter.revision,
                        storedBytes:healthyAfter.bytes.length,
                        readCalls:healthy.readCalls,
                        statCalls:healthy.statCalls,
                        dialogueCalls:healthy.dialogueCalls,
                        repairCalls:healthy.repairCalls,
                        completionMarker:healthyMarker,
                        storedBytesUnchanged:true,
                    },
                ];

                const raceBefore=await snapshot();
                await keyValueDB.set('checkIncompleteDocs',false);
                const race=makeObservation('stat-read-race');
                const raceUnhandledBefore=unhandledErrors.length;
                await runRegisteredCheck(race);
                const raceAfter=await snapshot();
                const raceMarker=await marker();
                const raceVaultAfter=await activeBytes();
                require(race.statCalls===1,'The controlled stat/read race did not use one initial stat');
                require(race.actualStats[0]?.size===raceBefore.bytes.length,
                    'The real StorageAccess stat did not see the Metadata size');
                require(race.returnedStats[0]?.size===raceBefore.bytes.length+1,
                    'The checker did not see the controlled old mismatched size');
                require(race.readCalls===1,'The controlled mismatch did not read real Vault bytes');
                require(JSON.stringify(race.readBytes)===JSON.stringify(raceBefore.bytes),
                    'The actual StorageAccess read did not match the database bytes');
                require(race.dialogueCalls===0,'The settled stat/read race opened a repair dialogue');
                require(race.repairCalls===0,'The settled stat/read race invoked repair');
                require(raceMarker,'The settled stat/read race did not set its completion marker');
                require(unhandledErrors.length===raceUnhandledBefore,
                    'The settled stat/read race raised an unhandled error');
                require(raceVaultAfter.content===expectedContent,'The Vault file changed during the stat/read race');
                assertUnchanged(raceBefore,raceAfter,'Settled stat/read race');
                observations.push({
                    case:'stat-read-race',
                    revision:raceAfter.revision,
                    storedBytes:raceAfter.bytes.length,
                    observedStatSize:race.returnedStats[0]?.size,
                    readCalls:race.readCalls,
                    readMatchedDatabase:true,
                    dialogueCalls:race.dialogueCalls,
                    repairCalls:race.repairCalls,
                    completionMarker:raceMarker,
                    storedBytesUnchanged:true,
                });

                const unstableBefore=await snapshot();
                await keyValueDB.set('checkIncompleteDocs',false);
                const unstable=makeObservation('unstable-final-stat');
                const unstableUnhandledBefore=unhandledErrors.length;
                await runRegisteredCheck(unstable);
                await waitFor(()=>unhandledErrors.length>unstableUnhandledBefore,
                    'The changed final stat did not reject the incomplete-document check');
                const unstableError=unhandledErrors.slice(unstableUnhandledBefore).join(' | ');
                const unstableAfter=await snapshot();
                const unstableMarker=await marker();
                require(unstable.statCalls===2,'The changed final stat was not checked');
                require(unstable.returnedStats[1]?.mtime!==unstable.actualStats[1]?.mtime,
                    'The final StorageAccess stat was not changed by the race fixture');
                require(unstable.readCalls===0,'The healthy path was read during the final-stat race');
                require(unstableError.includes('Storage changed during the incomplete document check'),
                    'The final-stat race did not report the expected incomplete-check error');
                require(unstableMarker===false,'The incomplete check was marked complete after storage changed');
                require(unstable.dialogueCalls===0,'The final-stat race opened a repair dialogue');
                require(unstable.repairCalls===0,'The final-stat race invoked repair');
                assertUnchanged(unstableBefore,unstableAfter,'Final-stat race');
                observations.push({
                    case:'unstable-final-stat',
                    revision:unstableAfter.revision,
                    statCalls:unstable.statCalls,
                    readCalls:unstable.readCalls,
                    reportedError:unstableError,
                    completionMarker:unstableMarker,
                    storedBytesUnchanged:true,
                });

                await keyValueDB.set('checkIncompleteDocs',false);
                const retry=makeObservation('settled-retry');
                const retryUnhandledBefore=unhandledErrors.length;
                await runRegisteredCheck(retry);
                const retryAfter=await snapshot();
                const retryMarker=await marker();
                require(retry.statCalls===2,'The settled retry did not complete both StorageAccess stats');
                require(retry.readCalls===0,'The settled retry read healthy storage');
                require(retry.dialogueCalls===0,'The settled retry opened a repair dialogue');
                require(retry.repairCalls===0,'The settled retry invoked repair');
                require(retryMarker,'The settled retry did not set its completion marker');
                require(unhandledErrors.length===retryUnhandledBefore,
                    'The settled retry raised an unhandled error');
                assertUnchanged(unstableBefore,retryAfter,'Settled retry');
                observations.push({
                    case:'settled-retry',
                    revision:retryAfter.revision,
                    statCalls:retry.statCalls,
                    readCalls:retry.readCalls,
                    dialogueCalls:retry.dialogueCalls,
                    repairCalls:retry.repairCalls,
                    completionMarker:retryMarker,
                    storedBytesUnchanged:true,
                });
                return JSON.stringify(observations);
            }finally{
                window.removeEventListener('unhandledrejection',onUnhandled);
                if(installedDialogue)restore(confirm,'askSelectStringDialogue',ownDialogue,originalDialogue);
                if(installedStore)restore(fileHandler,'storeFileToDB',ownStore,originalStore);
                if(installedRead)restore(storage,'readHiddenFileBinary',ownRead,originalRead);
                if(installedStat)restore(storage,'statHidden',ownStat,originalStat);
            }
        `);

        console.log(
            JSON.stringify(
                {
                    ok: true,
                    bundleHash,
                    trigger: "registered-request-run-fix-incomplete-event",
                    naturalRestart: false,
                    observations,
                },
                null,
                2
            )
        );
    } finally {
        try {
            await session?.app.stop();
        } finally {
            await vault.dispose();
        }
    }
}

await main();
