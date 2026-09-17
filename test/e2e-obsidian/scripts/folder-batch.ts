import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { createE2eObsidianDeviceLocalState, waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";
const originalRoot = "batch/original";
const renamedRoot = "batch/renamed";
const outsidePath = "batch/outside.md";
const folders = ["alpha", "alpha/deep", "beta"];
const notes = Array.from({ length: 24 }, (_, index) => ({
    relativePath: `${folders[index % folders.length]}/note-${index}.md`,
    body: `# Descendant ${index}\n\nThis body must survive a parent folder rename.\n`,
}));

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked: ${cli.checked.join(", ")}`);
    const cliBinary = cli.binary;
    const vault = await createTemporaryVault("obsidian-livesync-folder-batch-");
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
                couchDB_DBNAME: "folder-batch",
                notifyThresholdOfRemoteStorageSize: -1,
                periodicReplication: false,
                syncOnStart: false,
                syncOnSave: false,
                syncOnFileOpen: false,
                syncOnEditorSave: false,
                syncAfterMerge: false,
                useEden: false,
            },
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        const result = await evalObsidianJson<{ descendants: number; renamed: number; deleted: number }>(
            cliBinary,
            `(async()=>{
                const core=app.plugins.plugins['obsidian-livesync'].core;
                const provenance=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');
                const notes=${JSON.stringify(notes)};
                const originalRoot=${JSON.stringify(originalRoot)};
                const renamedRoot=${JSON.stringify(renamedRoot)};
                const outsidePath=${JSON.stringify(outsidePath)};
                const renamed=new Set(), deleted=new Set();
                const refs=[
                    app.vault.on('rename',(file,oldPath)=>{
                        if(file.stat) renamed.add(oldPath+' -> '+file.path);
                    }),
                    app.vault.on('delete',(file)=>{if(file.stat) deleted.add(file.path);}),
                ];
                const meta=(path)=>core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);
                const isDeleted=(entry)=>entry && (entry.deleted || entry._deleted);
                const getContent=(entry)=>Array.isArray(entry.data)?entry.data.join(''):entry.data;

                async function liveErrors(path,body){
                    const errors=[];
                    const file=app.vault.getAbstractFileByPath(path);
                    const entry=await meta(path);
                    if(!file?.stat || file.path!==path || await app.vault.read(file)!==body)
                        errors.push('Vault content: '+path);
                    if(!entry || isDeleted(entry) || entry.path!==path || !entry.children.length){
                        errors.push('DB metadata: '+path);
                    }else{
                        const loaded=await core.localDatabase.getDBEntry(path,{rev:entry._rev},false,true,true);
                        if(!loaded || getContent(loaded)!==body) errors.push('DB content: '+path);
                        if(entry._conflicts?.length) errors.push('Unexpected conflict: '+path);
                        if((await provenance.get(path))?.revision!==entry._rev)
                            errors.push('Provenance: '+path);
                    }
                    return errors;
                }
                async function deletedErrors(path){
                    const errors=[];
                    const entry=await meta(path);
                    if(app.vault.getAbstractFileByPath(path)) errors.push('File remains: '+path);
                    if(!isDeleted(entry)) errors.push('Missing tombstone: '+path);
                    if(entry?._conflicts?.length) errors.push('Deletion conflict: '+path);
                    if(await provenance.get(path)) errors.push('Old provenance remains: '+path);
                    return errors;
                }
                async function waitFor(phase,check){
                    const deadline=Date.now()+20000;
                    let errors=[];
                    do{
                        await core.services.fileProcessing.commitPendingFileEvents();
                        errors=await check();
                        if(!errors.length) return;
                        await new Promise(resolve=>setTimeout(resolve,50));
                    }while(Date.now()<deadline);
                    throw new Error(phase+': '+errors.slice(0,8).join('; '));
                }
                const liveBatch=(root)=>Promise.all(notes.map(note=>
                    liveErrors(root+'/'+note.relativePath,note.body))).then(results=>results.flat());
                const deletedBatch=(root)=>Promise.all(notes.map(note=>
                    deletedErrors(root+'/'+note.relativePath))).then(results=>results.flat());

                try{
                    await app.vault.createFolder('batch');
                    await app.vault.createFolder(originalRoot);
                    for(const folder of ${JSON.stringify(folders)})
                        await app.vault.createFolder(originalRoot+'/'+folder);
                    await Promise.all(notes.map(note=>app.vault.create(originalRoot+'/'+note.relativePath,note.body)));
                    await app.vault.create(outsidePath,'Outside note');
                    await waitFor('Initial batch',async()=>[
                        ...await liveBatch(originalRoot), ...await liveErrors(outsidePath,'Outside note'),
                    ]);
                    const originalIds=await Promise.all(notes.map(async note=>(await meta(originalRoot+'/'+note.relativePath))._id));

                    // Rename the parent once: Obsidian must emit every descendant event.
                    await app.vault.rename(app.vault.getAbstractFileByPath(originalRoot),renamedRoot);
                    await waitFor('Renamed batch',async()=>[
                        ...await liveBatch(renamedRoot), ...await deletedBatch(originalRoot),
                        ...await liveErrors(outsidePath,'Outside note'),
                    ]);
                    for(const [index,note] of notes.entries()){
                        const from=originalRoot+'/'+note.relativePath, to=renamedRoot+'/'+note.relativePath;
                        if(!renamed.has(from+' -> '+to)) throw new Error('Missing descendant rename: '+from);
                        if((await meta(to))._id===originalIds[index]) throw new Error('Rename reused the source ID: '+to);
                    }

                    // Delete the parent once, without synthesising individual file events.
                    await app.vault.delete(app.vault.getAbstractFileByPath(renamedRoot),true);
                    await waitFor('Deleted batch',async()=>[
                        ...await deletedBatch(renamedRoot), ...await deletedBatch(originalRoot),
                        ...await liveErrors(outsidePath,'Outside note'),
                    ]);
                    for(const note of notes){
                        const path=renamedRoot+'/'+note.relativePath;
                        if(!deleted.has(path)) throw new Error('Missing descendant deletion: '+path);
                    }
                    if(app.vault.getAbstractFileByPath(renamedRoot)) throw new Error('Deleted folder remains');
                    await app.vault.modify(app.vault.getAbstractFileByPath(outsidePath),'Outside note updated');
                    await waitFor('Outside update',()=>liveErrors(outsidePath,'Outside note updated'));
                    return JSON.stringify({descendants:notes.length,renamed:renamed.size,deleted:deleted.size});
                }finally{
                    for(const ref of refs) app.vault.offref(ref);
                }
            })()`,
            session.cliEnv
        );
        console.log(
            `Folder batch: ${result.descendants} descendants persisted, renamed, and deleted; ` +
                `${result.renamed} rename and ${result.deleted} delete events observed; outside note remained writable.`
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
