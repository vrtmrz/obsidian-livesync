import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    putCouchDbDocument,
    type CouchDbConfig,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const observationKey = "__livesyncChunkFetchRetryE2E";
const observationSource = `globalThis[${JSON.stringify(observationKey)}]`;
const retryDelayMs = 2_000;

type FetchAttempt = {
    startedAt: number;
    finiteTransitionIndex: number;
    completedAt?: number;
    requestedIds: string[];
    returnedIds?: string[];
    unavailable?: boolean;
    error?: string;
};

type Snapshot = {
    attempts: FetchAttempt[];
    missingEvents: number[];
    replicationDone: boolean;
    replicationSucceeded?: boolean;
    replicationError?: string;
    metadataPresent: boolean;
    chunkPresent: boolean;
    claimActive: boolean;
    currentProcessing: number;
    queued: number;
    boundedActivity: number;
    finiteActivity: number;
    finiteTransitions: { at: number; count: number }[];
    followupTransitionIndex?: number;
    replicationResults: number;
    databaseQueue: number;
    storageApplying: number;
    pendingChunkCount: number;
    initialChunkCount: number;
    retryChunkCount: number;
    statusText: string;
    content: string | null;
};

async function snapshot(page: Page): Promise<Snapshot> {
    return await page.evaluate(`(async()=>{
        const state=${observationSource};
        const core=app.plugins.plugins['obsidian-livesync'].core;
        const db=core.localDatabase;
        const rows=await db.allDocsRaw({keys:[state.metadataId,state.chunkId],include_docs:true});
        const present=(id)=>rows.rows.some((row)=>row.id===id&&row.doc&&!row.value?.deleted);
        const file=app.vault.getAbstractFileByPath(state.path);
        const statusText=document.querySelector('.syncstatusbar')?.textContent??'';
        const initialChunkCount=Number(statusText.match(/🛄\\s*(\\d+)/u)?.[1]??0);
        const retryChunkCount=Number(statusText.match(/🔁\\s*(\\d+)/u)?.[1]??0);
        return {
            attempts:state.attempts,missingEvents:state.missingEvents,
            replicationDone:state.replicationDone,replicationSucceeded:state.replicationSucceeded,
            replicationError:state.replicationError,metadataPresent:present(state.metadataId),
            chunkPresent:present(state.chunkId),
            claimActive:db.managers.chunkManager.deliveryCoordinator.isClaimActiveFor(state.chunkId),
            currentProcessing:db.managers.chunkFetcher.currentProcessing,
            queued:db.managers.chunkFetcher.queue.length,
            boundedActivity:core.services.replicator.boundedRemoteActivityCount.value,
            finiteActivity:core.services.replicator.finiteReplicationActivityCount.value,
            finiteTransitions:state.finiteTransitions,followupTransitionIndex:state.followupTransitionIndex,
            replicationResults:core.services.replication.replicationResultCount.value,
            databaseQueue:core.services.replication.databaseQueueCount.value,
            storageApplying:core.services.replication.storageApplyingCount.value,
            initialChunkCount,retryChunkCount,pendingChunkCount:initialChunkCount+retryChunkCount,statusText,
            content:file?await app.vault.read(file):null,
        };
    })()`);
}

async function waitForSnapshot(
    page: Page,
    predicate: (state: Snapshot) => boolean,
    stage: string,
    timeoutMs = 20_000
): Promise<Snapshot> {
    const deadline = Date.now() + timeoutMs;
    let state: Snapshot;
    do {
        state = await snapshot(page);
        if (predicate(state)) return state;
        if (state.replicationError || state.attempts.some((attempt) => attempt.error || attempt.unavailable)) {
            throw new Error(`The real CouchDB operation failed during ${stage}: ${JSON.stringify(state)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(`Timed out during ${stage}: ${JSON.stringify(state)}`);
}

function isIdle(state: Snapshot): boolean {
    return (
        state.replicationDone &&
        !state.claimActive &&
        state.currentProcessing === 0 &&
        state.queued === 0 &&
        state.boundedActivity === 0 &&
        state.finiteActivity === 0 &&
        state.replicationResults === 0 &&
        state.databaseQueue === 0 &&
        state.storageApplying === 0 &&
        state.pendingChunkCount === 0
    );
}

async function runScenario(
    page: Page,
    couchDb: CouchDbConfig,
    dbName: string,
    label: "delayed-arrival" | "permanently-missing" | "finite-completion"
): Promise<void> {
    const delayedArrival = label === "delayed-arrival";
    const expediteFinalProbe = label === "finite-completion";
    const path = `chunk-fetch-${label}.md`;
    const chunkId = `h:e2e-chunk-fetch-${label}`;
    const content = `# Chunk fetch retry\n${label}\n`;
    const metadataId = await page.evaluate<string>(
        `app.plugins.plugins['obsidian-livesync'].core.services.path.path2id(${JSON.stringify(path)})`
    );
    const now = Date.now();
    // Only Metadata is initially present. The Chunk is a separate real CouchDB document.
    await putCouchDbDocument(couchDb, dbName, {
        _id: metadataId,
        path,
        type: "plain",
        ctime: now,
        mtime: now,
        size: Buffer.byteLength(content),
        children: [chunkId],
        eden: {},
    });

    await page.evaluate(`(()=>{
        if(${observationSource}) throw new Error('A Chunk fetch observer is already installed.');
        const core=app.plugins.plugins['obsidian-livesync'].core;
        const settings=core.services.setting.currentSettings();
        if(!settings.readChunksOnline||settings.useOnlyLocalChunk||settings.liveSync||settings.periodicReplication) {
            throw new Error('The fixture requires one-shot replication with on-demand Chunk reads.');
        }
        const replicator=core.services.replicator.getActiveReplicator();
        const original=replicator.fetchRemoteChunks;
        if(typeof original!=='function') throw new Error('The real replicator has no Chunk fetch method.');
        const manager=core.localDatabase.managers.chunkManager;
        const observer=new AbortController();
        const finiteCount=core.services.replicator.finiteReplicationActivityCount;
        const state={path:${JSON.stringify(path)},metadataId:${JSON.stringify(metadataId)},
            chunkId:${JSON.stringify(chunkId)},attempts:[],missingEvents:[],replicationDone:false,
            finiteTransitions:[{at:Date.now(),count:finiteCount.value}]};
        const observeFinite=()=>state.finiteTransitions.push({at:Date.now(),count:finiteCount.value});
        finiteCount.onChanged(observeFinite);
        ${observationSource}=state;
        state.restore=()=>{replicator.fetchRemoteChunks=original;observer.abort();finiteCount.offChanged(observeFinite);};
        manager.addListener('missingChunkRemote',(id)=>{
            if(id===state.chunkId) state.missingEvents.push(Date.now());
        },{signal:observer.signal});
        // Observe the real HTTP-backed method without changing its result or adding a wait.
        replicator.fetchRemoteChunks=async function(...args){
            if(!args[0].includes(state.chunkId)) return await original.apply(this,args);
            const attempt={startedAt:Date.now(),finiteTransitionIndex:state.finiteTransitions.length,requestedIds:[...args[0]]};
            state.attempts.push(attempt);
            try{
                const result=await original.apply(this,args);
                attempt.unavailable=result===false;
                attempt.returnedIds=Array.isArray(result)?result.map((chunk)=>chunk._id):[];
                return result;
            }catch(error){
                attempt.error=String(error);
                throw error;
            }finally{
                attempt.completedAt=Date.now();
            }
        };
        state.startReplication=async()=>{
            state.replicationDone=false;
            try{state.replicationSucceeded=!!(await core.services.replication.replicate(true));}
            catch(error){state.replicationError=String(error);}
            finally{state.replicationDone=true;}
        };
        state.replication=state.startReplication();
    })()`);

    try {
        const first = await waitForSnapshot(
            page,
            (state) => !!state.attempts[0]?.completedAt,
            "initial missing response"
        );
        assertEqual(first.metadataPresent, true, "The Metadata did not arrive through real replication.");
        assertEqual(first.chunkPresent, false, "The Chunk was already available locally before its delayed arrival.");
        assertEqual(
            first.attempts[0].unavailable,
            false,
            "The first fetch failed instead of returning a missing Chunk."
        );
        assertEqual(first.attempts[0].returnedIds?.length, 0, "The first fetch did not reproduce a missing Chunk.");
        if (delayedArrival) {
            await putCouchDbDocument(couchDb, dbName, { _id: chunkId, type: "leaf", data: content });
        }
        console.log(`${label}: first real response ${JSON.stringify(first)}`);
        assertEqual(
            first.missingEvents.length,
            0,
            "The first missing response ended delivery before the delayed retry."
        );
        assertEqual(first.claimActive, true, "The first missing response released the delivery claim.");
        assertEqual(first.content, null, "The file was materialised before its missing Chunk arrived.");
        const retryWaiting = await waitForSnapshot(
            page,
            (state) => state.initialChunkCount === 0 && state.retryChunkCount === 1,
            "separate retry status during the retry delay",
            1_000
        );
        assertEqual(retryWaiting.attempts.length, 1, "The pending count appeared only after the retry started.");
        const completedDuringInitialLookup = retryWaiting.finiteTransitions
            .slice(first.attempts[0].finiteTransitionIndex)
            .some((transition) => transition.count === 0);
        if (!completedDuringInitialLookup) {
            assertEqual(retryWaiting.currentProcessing, 0, "Backoff retained a physical request slot.");
        }
        console.log(`${label}: retry waiting ${JSON.stringify(retryWaiting)}`);

        if (expediteFinalProbe) {
            await waitForSnapshot(
                page,
                (state) => state.replicationDone && state.finiteActivity === 0 && state.attempts.length === 1,
                "first finite replication completion before the scheduled retry",
                1_000
            );
            // A second genuine one-shot replication ends during backoff; counts are observed, never synthesised.
            await page.evaluate(`(()=>{
                const state=${observationSource};
                state.followupTransitionIndex=state.finiteTransitions.length;
                state.replication=state.startReplication();
            })()`);
        }

        const completed = await waitForSnapshot(page, isIdle, "delivery and reflection quiescence");
        assertEqual(completed.replicationSucceeded, true, "One-shot replication did not complete successfully.");
        assertEqual(completed.attempts.length, 2, "The missing Chunk must be fetched exactly twice.");
        const [initial, retry] = completed.attempts;
        const retryDelay = retry.startedAt - initial.completedAt!;
        if (expediteFinalProbe) {
            const transitions = completed.finiteTransitions.slice(completed.followupTransitionIndex);
            const ended = transitions.find(
                (transition, index) => index > 0 && transition.count === 0 && transitions[index - 1].count > 0
            );
            if (!ended)
                throw new Error(`The second real finite replication was not observed: ${JSON.stringify(transitions)}`);
            if (retry.startedAt < ended.at) throw new Error("The final probe began before finite replication ended.");
            if (retryDelay >= retryDelayMs)
                throw new Error(`Finite completion did not interrupt backoff: ${retryDelay} ms.`);
        } else {
            const completion = completed.finiteTransitions
                .slice(initial.finiteTransitionIndex)
                .find((transition) => transition.count === 0);
            if (completion) {
                if (retry.startedAt < completion.at) throw new Error("The final probe preceded finite completion.");
                if (retryDelay >= retryDelayMs) {
                    throw new Error(`Finite completion did not expedite the initial missing result: ${retryDelay} ms.`);
                }
            } else if (retryDelay < retryDelayMs) {
                throw new Error(`The retry started too early: ${retryDelay} ms.`);
            }
        }
        assertEqual(retry.requestedIds.join(","), chunkId, "The retry requested an unexpected Chunk.");
        assertEqual(retry.unavailable, false, "The retry failed to contact the real remote.");
        assertEqual(retry.returnedIds?.join(","), delayedArrival ? chunkId : "", "The retry returned unexpected data.");
        assertEqual(
            completed.missingEvents.length,
            delayedArrival ? 0 : 1,
            "Unexpected terminal missing notifications."
        );
        assertEqual(completed.chunkPresent, delayedArrival, "The local Chunk persistence result was unexpected.");
        assertEqual(completed.content, delayedArrival ? content : null, "The Vault file content was unexpected.");
        if (!delayedArrival) {
            // Observe one more retry interval after quiescence to reject an unbounded retry loop.
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs + 100));
            const settled = await snapshot(page);
            assertEqual(isIdle(settled), true, "The permanently missing delivery became active again.");
            assertEqual(settled.attempts.length, 2, "The permanently missing Chunk was retried again.");
        }
        console.log(`${label}: passed; retry after ${retryDelay} ms; ${JSON.stringify(completed)}`);
    } catch (error) {
        console.error(`${label}: ${JSON.stringify(await snapshot(page))}`);
        const diagnostics = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
        await mkdir(diagnostics, { recursive: true });
        await page.screenshot({ path: join(diagnostics, `chunk-fetch-${label}.failure.png`), fullPage: true });
        throw error;
    } finally {
        await page.evaluate(`(()=>{${observationSource}?.restore();delete ${observationSource};})()`);
    }
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked: ${cli.checked.join(", ")}`);
    const couchDb = await loadCouchDbConfig();
    await assertCouchDbReachable(couchDb);
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "chunk-fetch-retry");
    const vault = await createTemporaryVault("obsidian-livesync-chunk-fetch-");
    let session: ObsidianLiveSyncSession | undefined;
    try {
        await createCouchDbDatabase(couchDb, dbName);
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            pluginData: createE2eCouchDbPluginData(
                { ...couchDb, dbName },
                {
                    encrypt: false,
                    usePathObfuscation: false,
                    showStatusOnStatusbar: true,
                    // Keep the real retry status observable even when finite completion expedites the final probe.
                    minimumIntervalOfReadChunksOnline: 500,
                    periodicReplication: false,
                    syncOnFileOpen: false,
                    syncOnEditorSave: false,
                    syncAfterMerge: false,
                }
            ),
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await prepareRemote(cli.binary, session.cliEnv);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await runScenario(page, couchDb, dbName, "delayed-arrival");
            await runScenario(page, couchDb, dbName, "permanently-missing");
            await runScenario(page, couchDb, dbName, "finite-completion");
        });
    } finally {
        if (session) await session.app.stop();
        await vault.dispose();
        await deleteCouchDbDatabase(couchDb, dbName);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
