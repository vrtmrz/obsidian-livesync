import { matchesPlainDatabaseText } from "../runner/localFileRetryAssertions.ts";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

const paths = {
    temporary: "retry-rename-temporary.md",
    renamed: "retry-rename-final.md",
    edited: "retry-same-path.md",
    restarted: "retry-after-restart.md",
};
const content = {
    renamed: "Rename recovery content\n",
    initial: "Initial failed save\n",
    firstEdit: "First later edit\n",
    latestEdit: "Latest later edit\n",
    restart: "Restart recovery content\n",
};

/** Shared in-app probes and controlled read-failure injection; each evaluation resolves the current plug-in instance. */
const evaluationHelpers = `
    const core=app.plugins.plugins['obsidian-livesync'].core;
    const manager=core.serviceModules.storageAccess.vaultManager;
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const require=(condition,message)=>{if(!condition)throw new Error(message);};
    const waitFor=async(predicate,message)=>{
        const until=Date.now()+15000;
        while(Date.now()<until){if(await predicate())return;await sleep(25);}
        throw new Error(message);
    };
    const pendingEvents=async()=>await manager.adapter.persistence.loadSnapshot()??[];
    const eventPaths=event=>{
        const args=event.args??{};
        return [args.file?.path,args.oldFile?.path,args.oldPath,args.renameTarget,args.targetPath,args.path]
            .filter(path=>typeof path==='string');
    };
    const isPending=async(...paths)=>{
        const snapshot=await pendingEvents();
        return snapshot.some(event=>eventPaths(event).some(path=>paths.includes(path)));
    };
    const databaseState=async path=>{
        let meta;
        try{meta=await core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);}
        catch(error){if(error?.status===404||error?.name==='not_found')return null;throw error;}
        if(!meta)return null;
        const revisions=[...new Set([meta._rev,...(meta._conflicts??[])].filter(Boolean))];
        const branches=[];
        for(const rev of revisions){
            const doc=await core.localDatabase.getDBEntry(path,{rev,revs:true},false,true,true).catch(()=>null);
            const raw=await core.localDatabase.getRaw(meta._id,{rev,revs:true}).catch(()=>null);
            const history=raw?._revisions?.ids?.map((id,index)=>(raw._revisions.start-index)+'-'+id)??[];
            const value=Array.isArray(doc?.data)?doc.data.join(''):typeof doc?.data==='string'?doc.data:null;
            branches.push({rev,body:value,type:doc?.type,datatype:doc?.datatype,deleted:!!doc?._deleted,history});
        }
        const current=branches.find(branch=>branch.rev===meta._rev);
        return {path:meta.path,deleted:!!meta.deleted,present:!!current&&!meta.deleted&&!current.deleted,rev:meta._rev,
            currentBody:current?.body??null,current,branches};
    };
    const databaseBodyMatches=${matchesPlainDatabaseText.toString()};
    const installReadFailure=paths=>{
        const key='__livesyncLocalFileRetry';
        globalThis[key]?.restore?.();
        const adapter=app.vault.adapter;
        const original=adapter.read;
        const state={blocked:new Set(paths),failures:Object.create(null),holdPath:null,
            holdNextSuccessfulRead:false,heldReadStarted:false,heldReadBody:null,readGate:null,read:null,restore:null};
        state.restore=()=>{
            if(adapter.read===state.read)adapter.read=original;
            if(globalThis[key]===state)delete globalThis[key];
        };
        state.read=async function(path){
            if(state.blocked.has(path)){
                state.failures[path]=(state.failures[path]??0)+1;
                const error=new Error('ENOENT: injected read failure for '+path);
                error.code='ENOENT';
                throw error;
            }
            const value=await original.call(this,path);
            if(state.holdNextSuccessfulRead&&path===state.holdPath){
                state.holdNextSuccessfulRead=false;
                state.heldReadStarted=true;
                state.heldReadBody=value;
                await state.readGate;
            }
            return value;
        };
        globalThis[key]=state;
        adapter.read=state.read;
        return state;
    };
`;

/**
 * Evaluate one scenario step inside the running isolated Obsidian session.
 *
 * @typeParam T - The JSON result expected by the calling assertion.
 * @param cliBinary - The discovered Obsidian CLI executable.
 * @param session - The session whose environment identifies the isolated Vault.
 * @param body - The scenario expression using the shared in-app probes.
 * @returns The decoded scenario result; evaluation and transport failures reject the promise.
 */
async function evaluate<T>(cliBinary: string, session: ObsidianLiveSyncSession, body: string): Promise<T> {
    return await evalObsidianJson<T>(cliBinary, `(async()=>{${evaluationHelpers}\n${body}\n})()`, session.cliEnv);
}

/**
 * Exercise rename, later-edit, and restart recovery through real Vault events.
 *
 * @returns Completion after the isolated session is closed; assertion or setup failures reject.
 * @remarks
 * Read failures are injected only into the temporary Vault. Content, pending
 * ownership, and revision history are checked independently of remote replication.
 */
async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked: ${cli.checked.join(", ")}`);
    const cliBinary = cli.binary;
    const vault = await createTemporaryVault("obsidian-local-file-retry-");
    let session: ObsidianLiveSyncSession | undefined;

    /**
     * Start or reopen the same isolated Vault and profile.
     *
     * @param initial - Whether to seed the first run with local-only plug-in settings.
     * @returns Completion when the session and LiveSync core are ready for the next scenario.
     */
    const start = async (initial = false): Promise<void> => {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            pluginStartup: initial ? undefined : "natural",
            pluginData: initial
                ? {
                      doctorProcessedVersion: "1.0.0",
                      isConfigured: true,
                      liveSync: false,
                      remoteType: "",
                      couchDB_URI: "http://127.0.0.1:5984",
                      couchDB_DBNAME: "local-file-retry",
                      notifyThresholdOfRemoteStorageSize: -1,
                      periodicReplication: false,
                      syncAfterMerge: false,
                      syncOnEditorSave: false,
                      syncOnFileOpen: false,
                      syncOnSave: false,
                      syncOnStart: false,
                      disableMarkdownAutoMerge: false,
                      resolveConflictsByNewerFile: false,
                      checkConflictOnlyOnOpen: true,
                      showMergeDialogOnlyOnActive: true,
                  }
                : undefined,
            localStorageEntries: initial ? createE2eObsidianDeviceLocalState(vault.name) : undefined,
        });
        const readiness = await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        assertEqual(readiness.configured, true, "Self-hosted LiveSync did not start configured.");
    };

    try {
        await start(true);

        const renameObservation = await evaluate<{
            firstFailureReads: number;
            renameFailureReads: number;
            finalRevision: string;
            finalHistory: string[];
            obsoleteTemporaryPathAbsent: boolean;
        }>(
            cliBinary,
            session!,
            `
            const hook=installReadFailure([${JSON.stringify(paths.temporary)}]);
            try{
                await app.vault.create(${JSON.stringify(paths.temporary)},${JSON.stringify(content.renamed)});
                await waitFor(async()=>hook.failures[${JSON.stringify(paths.temporary)}]>0&&
                    await isPending(${JSON.stringify(paths.temporary)}),
                    'The temporary file read failure was not retained as a pending Vault event.');
                const firstFailureReads=hook.failures[${JSON.stringify(paths.temporary)}];
                require(!(await databaseState(${JSON.stringify(paths.temporary)}))?.branches?.length,
                    'The failed temporary file save unexpectedly reached the local database.');

                hook.blocked.add(${JSON.stringify(paths.renamed)});
                let renameEvents=0;
                const renameRef=app.vault.on('rename',(file,oldPath)=>{
                    if(file.path===${JSON.stringify(paths.renamed)}&&oldPath===${JSON.stringify(paths.temporary)})renameEvents++;
                });
                try{
                    const file=app.vault.getAbstractFileByPath(${JSON.stringify(paths.temporary)});
                    require(!!file,'The temporary file disappeared before the real Vault rename.');
                    await app.vault.rename(file,${JSON.stringify(paths.renamed)});
                    require(renameEvents===1,'The real Vault rename event was not observed exactly once.');
                }finally{app.vault.offref(renameRef);}

                await waitFor(async()=>hook.failures[${JSON.stringify(paths.renamed)}]>0&&
                    await isPending(${JSON.stringify(paths.renamed)}),
                    'The final-path read failure and rename event were not retained.');
                const renameFailureReads=hook.failures[${JSON.stringify(paths.renamed)}];
                const finalFile=app.vault.getAbstractFileByPath(${JSON.stringify(paths.renamed)});
                require(!!finalFile,'The real Vault rename did not create the final path.');
                hook.restore();
                require(await app.vault.read(finalFile)===${JSON.stringify(content.renamed)},
                    'The real Vault rename did not preserve the final file bytes.');

                require(await core.services.fileProcessing.commitPendingFileEvents(),
                    'Pending rename recovery did not complete after restoring reads.');
                await waitFor(async()=>!(await isPending(${JSON.stringify(paths.temporary)},${JSON.stringify(paths.renamed)})),
                    'The temporary or final path remained pending after rename recovery.');
                const finalState=await databaseState(${JSON.stringify(paths.renamed)});
                const oldState=await databaseState(${JSON.stringify(paths.temporary)});
                require(finalState&&finalState.path===${JSON.stringify(paths.renamed)}&&!finalState.deleted&&
                    databaseBodyMatches(finalState.current,${JSON.stringify(content.renamed)}),
                    'The final current database document does not contain the renamed file bytes at the final path.');
                require(finalState.branches.length===1&&finalState.branches[0].history.length===1,
                    'Rename recovery created an unexpected branch or revision.');
                require(!oldState||oldState.deleted,
                    'The obsolete temporary path remains a current database file.');
                return JSON.stringify({firstFailureReads,renameFailureReads,finalRevision:finalState.rev,
                    finalHistory:finalState.branches[0].history,obsoleteTemporaryPathAbsent:!oldState||oldState.deleted});
            }finally{hook.restore();}
            `
        );

        const samePathObservation = await evaluate<{
            initialFailureReads: number;
            earlierReadBody: string;
            laterEditPendingWhileEarlierReadWasHeld: boolean;
            newestEditObservedWhileReadWasHeld: boolean;
            latestBody: string;
            finalRevision: string;
            finalHistory: string[];
        }>(
            cliBinary,
            session!,
            `
            const path=${JSON.stringify(paths.edited)};
            const hook=installReadFailure([path]);
            let releaseRead;
            const readGate=new Promise(resolve=>{releaseRead=resolve;});
            let readReleased=false;
            try{
                await app.vault.create(path,${JSON.stringify(content.initial)});
                await waitFor(async()=>hook.failures[path]>0&&await isPending(path),
                    'The initial same-path read failure was not retained.');
                const initialFailureReads=hook.failures[path];

                hook.holdPath=path;
                hook.readGate=readGate;
                hook.holdNextSuccessfulRead=true;
                hook.blocked.delete(path);
                const file=app.vault.getAbstractFileByPath(path);
                require(!!file,'The same-path fixture file disappeared after its initial failure.');
                const initialEventKeys=new Set((await pendingEvents()).filter(event=>eventPaths(event).includes(path)).map(event=>event.key));
                await app.vault.modify(file,${JSON.stringify(content.firstEdit)});
                await waitFor(()=>hook.heldReadStarted,
                    'A real same-path edit did not retry the failed local save.');
                await waitFor(async()=>(await pendingEvents()).some(event=>eventPaths(event).includes(path)&&!initialEventKeys.has(event.key)),
                    'The edit which triggered recovery was not retained while the earlier read was held.');
                const earlierReadBody=hook.heldReadBody;
                require(earlierReadBody===${JSON.stringify(content.initial)}||
                    earlierReadBody===${JSON.stringify(content.firstEdit)},
                    'The held retry read did not capture the pre-latest file body.');
                require(earlierReadBody!==${JSON.stringify(content.latestEdit)},
                    'The held read already contained the later edit.');
                require(await isPending(path),
                    'The failed save stopped being pending while its retry read was held.');

                let newestEditEvents=0;
                const modifyRef=app.vault.on('modify',changed=>{if(changed.path===path)newestEditEvents++;});
                try{
                    await app.vault.modify(file,${JSON.stringify(content.latestEdit)});
                    require(newestEditEvents>0,'The newest real Vault modification was not observed.');
                }finally{app.vault.offref(modifyRef);}
                // The existing read guard can suppress this newest notification.
                // The already admitted successor must still save the latest bytes.
                require(await app.vault.read(file)===${JSON.stringify(content.latestEdit)},
                    'The second later edit did not reach the real Vault file.');
                require(await isPending(path),
                    'The admitted successor disappeared while the earlier read was held.');
                readReleased=true;
                releaseRead();

                await waitFor(async()=>{
                    const state=await databaseState(path);
                    return !!state&&state.present&&databaseBodyMatches(state.current,${JSON.stringify(content.latestEdit)})&&
                        !(await isPending(path));
                },'The latest same-path body was not committed before its pending event resolved.');
                const finalState=await databaseState(path);
                require(databaseBodyMatches(finalState.current,${JSON.stringify(content.latestEdit)}),
                    'An earlier completion consumed or replaced the latest same-path body.');
                require(finalState.branches.some(branch=>databaseBodyMatches(branch,${JSON.stringify(content.latestEdit)})),
                    'The latest same-path body is absent from the current revision leaves.');
                require(await app.vault.read(file)===${JSON.stringify(content.latestEdit)},
                    'The earlier completion replaced the latest real Vault body.');
                return JSON.stringify({initialFailureReads,earlierReadBody,
                    laterEditPendingWhileEarlierReadWasHeld:true,newestEditObservedWhileReadWasHeld:true,latestBody:finalState.currentBody,
                    finalRevision:finalState.rev,
                    finalHistory:finalState.branches.find(branch=>branch.rev===finalState.rev)?.history??[]});
            }finally{
                if(!readReleased)releaseRead();
                hook.restore();
            }
            `
        );

        const restartFailureObservation = await evaluate<{
            failureReadsBeforeShutdown: number;
            pendingBeforeShutdown: boolean;
            databaseAbsentBeforeShutdown: boolean;
        }>(
            cliBinary,
            session!,
            `
            const hook=installReadFailure([${JSON.stringify(paths.restarted)}]);
            await app.vault.create(${JSON.stringify(paths.restarted)},${JSON.stringify(content.restart)});
            await waitFor(async()=>hook.failures[${JSON.stringify(paths.restarted)}]>0&&
                await isPending(${JSON.stringify(paths.restarted)}),
                'The restart fixture read failure was not retained.');
            const state=await databaseState(${JSON.stringify(paths.restarted)});
            require(!state||!state.present,
                'The restart fixture unexpectedly saved before shutdown.');
            return JSON.stringify({failureReadsBeforeShutdown:hook.failures[${JSON.stringify(paths.restarted)}],
                pendingBeforeShutdown:await isPending(${JSON.stringify(paths.restarted)}),databaseAbsentBeforeShutdown:!state||state.deleted});
            `
        );

        await session!.app.stop();
        session = undefined;
        await start();

        const restartObservation = await evaluate<{
            currentBody: string;
            revision: string;
            history: string[];
            pendingResolved: boolean;
        }>(
            cliBinary,
            session!,
            `
            await waitFor(async()=>{
                const state=await databaseState(${JSON.stringify(paths.restarted)});
                return !!state&&!state.deleted&&databaseBodyMatches(state.current,${JSON.stringify(content.restart)})&&
                    !(await isPending(${JSON.stringify(paths.restarted)}));
            },'Natural startup did not recover the pending file with restored reads.');
            const state=await databaseState(${JSON.stringify(paths.restarted)});
            const file=app.vault.getAbstractFileByPath(${JSON.stringify(paths.restarted)});
            require(!!file&&await app.vault.read(file)===${JSON.stringify(content.restart)},
                'The restart fixture Vault file changed during startup recovery.');
            require(state.branches.length===1&&state.branches[0].history.length===1,
                'Startup recovery created an unexpected branch or revision.');
            return JSON.stringify({currentBody:state.currentBody,revision:state.rev,
                history:state.branches[0].history,pendingResolved:!(await isPending(${JSON.stringify(paths.restarted)}))});
            `
        );

        console.log(
            JSON.stringify(
                {
                    ok: true,
                    rename: renameObservation,
                    samePathEdit: samePathObservation,
                    restartBeforeShutdown: restartFailureObservation,
                    restartRecovery: restartObservation,
                },
                null,
                2
            )
        );
    } finally {
        if (session) {
            await evalObsidianJson(
                cliBinary,
                `(()=>{const state=globalThis['__livesyncLocalFileRetry'];state?.restore?.();return JSON.stringify(true);})()`,
                session.cliEnv
            ).catch(() => undefined);
            await session.app.stop();
        }
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
