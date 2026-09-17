import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const paths = ["stale-known.md", "stale-unknown.md"];
const oldContent = "# Note\nKeep\n\nTail\n\nFooter\n";
const newContent = oldContent.replace(
    "Footer\n",
    Array.from({ length: 50 }, (_, index) => `Remote addition ${index}\n`).join("") + "Footer\n"
);

type Branch = { rev: string; content: string; history: string[] };
type FileState = { path: string; content: string; rev: string; branches: Branch[]; provenance: string | null };

async function readState(cliBinary: string, env: NodeJS.ProcessEnv): Promise<FileState[]> {
    return await evalObsidianJson<FileState[]>(
        cliBinary,
        `(async()=>{
            const core=app.plugins.plugins['obsidian-livesync'].core;
            const store=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');
            const states=[];
            for(const path of ${JSON.stringify(paths)}){
                const meta=await core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);
                const branches=[];
                for(const rev of [meta._rev,...(meta._conflicts??[])]){
                    const entry=await core.localDatabase.getDBEntry(path,{rev,revs:true},false,true,true);
                    const raw=await core.localDatabase.getRaw(meta._id,{rev,revs:true});
                    branches.push({rev,content:Array.isArray(entry.data)?entry.data.join(''):entry.data,
                        history:raw._revisions.ids.map((id,i)=>(raw._revisions.start-i)+'-'+id)});
                }
                const file=app.vault.getAbstractFileByPath(path);
                states.push({path,content:await app.vault.read(file),rev:meta._rev,branches,
                    provenance:(await store.get(path))?.revision??null});
            }
            return JSON.stringify(states);
        })()`,
        env
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked: ${cli.checked.join(", ")}`);
    const cliBinary = cli.binary;
    const vault = await createTemporaryVault("obsidian-livesync-stale-file-");
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            pluginData: {
                doctorProcessedVersion: "1.0.0",
                isConfigured: true,
                liveSync: false,
                remoteType: "",
                couchDB_URI: "http://127.0.0.1:5984",
                couchDB_DBNAME: "stale-file-restart",
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
            },
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await evalObsidianJson(
            cliBinary,
            `(async()=>{
            for(const path of ${JSON.stringify(paths)}) await app.vault.create(path,${JSON.stringify(oldContent)});
            return JSON.stringify(true);
        })()`,
            session.cliEnv
        );
        for (const path of paths) await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, path);

        // Drain real Vault events before creating a persisted pending-event fixture.
        // The DB advances without reflecting it in the Vault, as on an offline device.
        const fixture = await evalObsidianJson<{ current: string[]; original: string[] }>(
            cliBinary,
            `(async()=>{
            const core=app.plugins.plugins['obsidian-livesync'].core;
            const store=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');
            await core.services.fileProcessing.commitPendingFileEvents();
            const snapshot=[], current=[], original=[];
            for(const [index,path] of ${JSON.stringify(paths)}.entries()){
                const meta=await core.localDatabase.getDBEntryMeta(path,{},true);
                const file=await core.storageAccess.getFileStub(path);
                const data=new Blob([${JSON.stringify(newContent)}],{type:'text/plain'});
                const result=await core.localDatabase.putDBEntry({...meta,data,mtime:file.stat.mtime+60000,
                    size:data.size,children:[]},false,meta._rev);
                if(!result?.ok) throw new Error('Could not advance '+path);
                current.push(result.rev); original.push(meta._rev);
                if(index===0) await store.set(path,{revision:meta._rev,observedStorageMtime:file.stat.mtime});
                else await store.delete(path);
                snapshot.push({type:'CHANGED',key:'CHANGED-'+path,args:{file}});
            }
            await core.kvDB.set('storage-event-manager-snapshot',snapshot);
            return JSON.stringify({current,original});
        })()`,
            session.cliEnv
        );
        await session.app.stop();
        session = undefined;

        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        const [known, unknown] = await readState(cliBinary, session.cliEnv);
        assertEqual(known.rev, fixture.current[0], "An unchanged stale file created a revision during restart.");
        assertEqual(known.branches.length, 1, "An unchanged stale file created a conflict.");
        assertEqual(known.content, newContent, "The newer DB content was not reflected after suppressing the save.");
        assertEqual(known.provenance, fixture.current[0], "The reflected revision was not recorded.");
        assertEqual(unknown.branches.length, 2, "Unknown local content was not preserved as a conflict.");
        assertEqual(unknown.content, oldContent, "Unknown local content was overwritten.");
        const independent = unknown.branches.find((branch) => branch.content === oldContent);
        if (!independent) throw new Error("The old local content is missing from the current branches.");
        assertEqual(independent.history.length, 1, "Unknown content was attached to an inferred ancestor.");
        if (independent.rev === fixture.original[1]) throw new Error("The historical root was reused.");
        if (!unknown.branches.some((branch) => branch.content === newContent)) {
            throw new Error("The remote additions were lost.");
        }

        await evalObsidianJson(
            cliBinary,
            `(async()=>{
            const core=app.plugins.plugins['obsidian-livesync'].core;
            const path=${JSON.stringify(paths[1])};
            await core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1').delete(path);
            if(!await core.fileHandler.storeFileToDB(path)) throw new Error('Repeated save failed');
            await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(${JSON.stringify(paths[0])}));
            await core.services.conflict.resolve(path);
            return JSON.stringify(true);
        })()`,
            session.cliEnv
        );
        const [, repeated] = await readState(cliBinary, session.cliEnv);
        assertEqual(
            repeated.branches
                .map((branch) => branch.rev)
                .sort()
                .join(","),
            unknown.branches
                .map((branch) => branch.rev)
                .sort()
                .join(","),
            "Losing provenance and reprocessing added or auto-merged a branch."
        );
        await evalObsidianJson(
            cliBinary,
            `(async()=>{
                const core=app.plugins.plugins['obsidian-livesync'].core;
                core.settings.resolveConflictsByNewerFile=true;
                await core.services.conflict.resolve(${JSON.stringify(paths[1])});
                return JSON.stringify(true);
            })()`,
            session.cliEnv
        );
        const [, resolved] = await readState(cliBinary, session.cliEnv);
        assertEqual(resolved.branches.length, 1, "The explicit newer-file option did not resolve the conflict.");
        assertEqual(resolved.content, newContent, "The newer-file option did not reflect the newer DB version.");
        console.log(
            "Stale-file restart: known content reflected; unknown content preserved without duplicate branches; explicit newer-file resolution retained."
        );
    } finally {
        if (session) await session.app.stop();
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
