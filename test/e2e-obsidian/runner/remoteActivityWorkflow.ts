import { evalObsidianJson } from "./cli.ts";
import {
    REMOTE_ACTIVITY_E2E_STATE_KEY,
    REMOTE_ACTIVITY_GATE_KIND,
    type RemoteActivityGateKind,
} from "./remoteActivity.ts";

export type HeldRemoteActivityResult = {
    done: boolean;
    entered: boolean;
    error?: string;
    kind: RemoteActivityGateKind;
    requestedIds?: string[];
    result?: boolean;
    resultCount?: number;
};

const stateKeySource = JSON.stringify(REMOTE_ACTIVITY_E2E_STATE_KEY);

export async function startHeldOneShotReplication(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<{ started: boolean }>(
        cliBinary,
        [
            "(async()=>{",
            `const stateKey=${stateKeySource};`,
            "const host=globalThis;",
            "if(host[stateKey]) throw new Error('A remote activity E2E gate is already installed.');",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "if(!replicator) throw new Error('No active replicator is available.');",
            "const original=replicator.openReplication;",
            "let releaseGate;",
            "const gate=new Promise((resolve)=>{releaseGate=resolve;});",
            `const state={kind:${JSON.stringify(REMOTE_ACTIVITY_GATE_KIND.oneShot)},entered:false,done:false,released:false,error:undefined,result:undefined,promise:undefined,release:undefined,restore:undefined};`,
            "state.release=()=>{if(!state.released){state.released=true;releaseGate();}};",
            "state.restore=()=>{replicator.openReplication=original;};",
            "host[stateKey]=state;",
            "replicator.openReplication=async function(...args){",
            "state.entered=true;",
            "await gate;",
            "return await original.apply(this,args);",
            "};",
            "state.promise=(async()=>{",
            "try{",
            "if(!(await core.services.fileProcessing.commitPendingFileEvents())) throw new Error('Pending file events could not be committed.');",
            "state.result=!!(await core.services.replication.replicate(true));",
            "}catch(error){",
            "state.error=error instanceof Error?error.message:String(error);",
            "}finally{",
            "state.restore();",
            "state.done=true;",
            "}",
            "})();",
            "return JSON.stringify({started:true});",
            "})()",
        ].join(""),
        env
    );
}

export async function startHeldChunkFetch(cliBinary: string, env: NodeJS.ProcessEnv, chunkId: string): Promise<void> {
    await evalObsidianJson<{ started: boolean }>(
        cliBinary,
        [
            "(async()=>{",
            `const stateKey=${stateKeySource};`,
            `const chunkId=${JSON.stringify(chunkId)};`,
            "const host=globalThis;",
            "if(host[stateKey]) throw new Error('A remote activity E2E gate is already installed.');",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "if(!replicator) throw new Error('No active replicator is available.');",
            "const localDb=core.localDatabase.localDatabase;",
            "const existing=await localDb.get(chunkId).catch(()=>undefined);",
            "if(existing&&!existing._deleted) throw new Error(`The remote-only chunk already exists locally: ${chunkId}`);",
            "const original=replicator.fetchRemoteChunks;",
            "let releaseGate;",
            "let resolveDone;",
            "const gate=new Promise((resolve)=>{releaseGate=resolve;});",
            "const donePromise=new Promise((resolve)=>{resolveDone=resolve;});",
            `const state={kind:${JSON.stringify(REMOTE_ACTIVITY_GATE_KIND.chunkFetch)},entered:false,done:false,released:false,error:undefined,resultCount:undefined,requestedIds:undefined,promise:donePromise,release:undefined,restore:undefined};`,
            "state.release=()=>{if(!state.released){state.released=true;releaseGate();}};",
            "state.restore=()=>{replicator.fetchRemoteChunks=original;};",
            "host[stateKey]=state;",
            "replicator.fetchRemoteChunks=async function(...args){",
            "state.entered=true;",
            "state.requestedIds=Array.isArray(args[0])?[...args[0]]:[];",
            "await gate;",
            "try{",
            "const result=await original.apply(this,args);",
            "state.resultCount=Array.isArray(result)?result.length:0;",
            "return result;",
            "}catch(error){",
            "state.error=error instanceof Error?error.message:String(error);",
            "throw error;",
            "}finally{",
            "state.restore();",
            "state.done=true;",
            "resolveDone();",
            "}",
            "};",
            "core.localDatabase.managers.chunkFetcher.onEvent([chunkId]);",
            "return JSON.stringify({started:true});",
            "})()",
        ].join(""),
        env
    );
}

export async function startHeldTrackedRequest(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<{ started: boolean }>(
        cliBinary,
        [
            "(async()=>{",
            `const stateKey=${stateKeySource};`,
            "const host=globalThis;",
            "if(host[stateKey]) throw new Error('A remote activity E2E gate is already installed.');",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const remote=core.services.remote;",
            "const api=core.services.API;",
            "const settings=core.services.setting.currentSettings();",
            "const original=api.webCompatFetch;",
            "let releaseGate;",
            "const gate=new Promise((resolve)=>{releaseGate=resolve;});",
            `const state={kind:${JSON.stringify(REMOTE_ACTIVITY_GATE_KIND.trackedRequest)},entered:false,done:false,released:false,error:undefined,result:undefined,promise:undefined,release:undefined,restore:undefined};`,
            "state.release=()=>{if(!state.released){state.released=true;releaseGate();}};",
            "state.restore=()=>{api.webCompatFetch=original;};",
            "host[stateKey]=state;",
            "api.webCompatFetch=async function(...args){",
            "state.entered=true;",
            "await gate;",
            "return await original.apply(this,args);",
            "};",
            "state.promise=(async()=>{",
            "try{",
            "const base=String(settings.couchDB_URI).replace(/\\/$/,'');",
            "const database=encodeURIComponent(settings.couchDB_DBNAME);",
            "const credentials=btoa(`${settings.couchDB_USER}:${settings.couchDB_PASSWORD}`);",
            "const response=await remote.performFetch(`${base}/${database}/_all_docs?limit=0`,{headers:{Authorization:`Basic ${credentials}`}});",
            "state.result=response.ok;",
            "}catch(error){",
            "state.error=error instanceof Error?error.message:String(error);",
            "}finally{",
            "state.restore();",
            "state.done=true;",
            "}",
            "})();",
            "return JSON.stringify({started:true});",
            "})()",
        ].join(""),
        env
    );
}

export async function finishHeldRemoteActivity(
    cliBinary: string,
    env: NodeJS.ProcessEnv
): Promise<HeldRemoteActivityResult> {
    return await evalObsidianJson<HeldRemoteActivityResult>(
        cliBinary,
        [
            "(async()=>{",
            `const stateKey=${stateKeySource};`,
            "const state=globalThis[stateKey];",
            "if(!state) throw new Error('No remote activity E2E gate is installed.');",
            "state.release();",
            "await state.promise;",
            "return JSON.stringify({kind:state.kind,entered:state.entered,done:state.done,error:state.error,result:state.result,resultCount:state.resultCount,requestedIds:state.requestedIds});",
            "})()",
        ].join(""),
        env
    );
}

export async function waitForRestoredChunk(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    chunkId: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_REMOTE_ACTIVITY_TIMEOUT_MS ?? 30000)
): Promise<{ id: string; type: string }> {
    return await evalObsidianJson<{ id: string; type: string }>(
        cliBinary,
        [
            "(async()=>{",
            `const chunkId=${JSON.stringify(chunkId)};`,
            `const deadline=Date.now()+${JSON.stringify(timeoutMs)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const localDb=core.localDatabase.localDatabase;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "while(Date.now()<deadline){",
            "const chunk=await localDb.get(chunkId).catch(()=>undefined);",
            "if(chunk&&!chunk._deleted&&chunk.type==='leaf'&&typeof chunk.data==='string') return JSON.stringify({id:chunk._id,type:chunk.type});",
            "await sleep(100);",
            "}",
            "throw new Error(`Timed out waiting for the fetched chunk to return: ${chunkId}`);",
            "})()",
        ].join(""),
        env
    );
}

export async function clearHeldRemoteActivity(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<{ cleared: boolean }>(
        cliBinary,
        [
            "(async()=>{",
            `const stateKey=${stateKeySource};`,
            "const state=globalThis[stateKey];",
            "if(!state) return JSON.stringify({cleared:false});",
            "if(!state.done) throw new Error('The remote activity E2E gate is still running.');",
            "delete globalThis[stateKey];",
            "return JSON.stringify({cleared:true});",
            "})()",
        ].join(""),
        env
    );
}

export async function cleanUpHeldRemoteActivity(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<{ cleared: boolean }>(
        cliBinary,
        [
            "(async()=>{",
            `const stateKey=${stateKeySource};`,
            "const state=globalThis[stateKey];",
            "if(!state) return JSON.stringify({cleared:false});",
            "state.release?.();",
            "await Promise.race([Promise.resolve(state.promise),new Promise((resolve)=>setTimeout(resolve,5000))]);",
            "state.restore?.();",
            "delete globalThis[stateKey];",
            "return JSON.stringify({cleared:true});",
            "})()",
        ].join(""),
        env
    );
}
