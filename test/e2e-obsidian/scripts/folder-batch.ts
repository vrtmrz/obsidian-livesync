import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { createE2eObsidianDeviceLocalState, waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";
const originalRoot = "batch/original";
const renamedRoot = "batch/renamed";
const outsidePath = "batch/outside.md";
const missingColonPath = "batch/incoming/Poem: Example.md";
const folders = ["alpha", "alpha/deep", "beta"];
const notes = Array.from({ length: 24 }, (_, index) => ({
    relativePath: `${folders[index % folders.length]}/note-${index}.md`,
    body: `# Descendant ${index}\n\nThis body must survive a parent folder rename.\n`,
}));
notes.push(
    { relativePath: "alpha/Poem: Example.md", body: "First poem\n" },
    { relativePath: "beta/Poem: Example.md", body: "Second poem\n" },
    { relativePath: "alpha/deep/Poem: Part: Example.md", body: "Poem with multiple colons\n" }
);

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
        const result = await evalObsidianJson<{ descendants: number; renamed: number; deleted: number; missingRejected: boolean }>(
            cliBinary,
            `(async()=>{
                const core=app.plugins.plugins['obsidian-livesync'].core;
                const provenance=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');
                const notes=${JSON.stringify(notes)};
                const originalRoot=${JSON.stringify(originalRoot)};
                const renamedRoot=${JSON.stringify(renamedRoot)};
                const outsidePath=${JSON.stringify(outsidePath)};
                const missingColonPath=${JSON.stringify(missingColonPath)};
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
                    // Obsidian indexes imported colon names but rejects them in Vault.create.
                    await Promise.all(notes.map(note=>note.relativePath.includes(':')
                        ? app.vault.adapter.write(originalRoot+'/'+note.relativePath,note.body)
                        : app.vault.create(originalRoot+'/'+note.relativePath,note.body)));
                    await app.vault.create(outsidePath,'Outside note');
                    await waitFor('Initial batch',async()=>[
                        ...await liveBatch(originalRoot), ...await liveErrors(outsidePath,'Outside note'),
                    ]);
                    for(const note of notes){
                        const path=originalRoot+'/'+note.relativePath;
                        if(!await core.serviceModules.fileHandler.dbToStorage(await meta(path),null,true))
                            throw new Error('Database reflection failed: '+path);
                    }
                    await waitFor('Reflected batch',()=>liveBatch(originalRoot));
                    const expectedPaths=new Set([outsidePath,...notes.map(note=>originalRoot+'/'+note.relativePath)]);
                    const unexpected=app.vault.getFiles().map(file=>file.path).filter(path=>!expectedPaths.has(path));
                    if(unexpected.length) throw new Error('Unexpected reflected files: '+unexpected.join(', '));
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

                    // A received database entry must not create a different Vault file when Obsidian rejects its name.
                    const filesBefore=new Set(app.vault.getFiles().map(file=>file.path));
                    const incomingBody='Received colon note\\n';
                    const incomingData=new Blob([incomingBody],{type:'text/plain'});
                    const incomingId=await core.services.path.path2id(missingColonPath);
                    const incomingTime=Date.now();
                    const saved=await core.localDatabase.putDBEntry({
                        _id:incomingId,path:missingColonPath,data:incomingData,
                        ctime:incomingTime,mtime:incomingTime,size:incomingData.size,
                        children:[],datatype:'plain',type:'plain',eden:{},
                    });
                    if(!saved?.ok) throw new Error('Could not seed received Metadata: '+missingColonPath);
                    const incomingMeta=await meta(missingColonPath);
                    if(!incomingMeta || incomingMeta._id!==incomingId || incomingMeta.path!==missingColonPath)
                        throw new Error('Received Metadata has the wrong path: '+missingColonPath);
                    const incomingEntry=await core.localDatabase.getDBEntry(missingColonPath,{rev:incomingMeta._rev},false,true,true);
                    if(!incomingEntry || getContent(incomingEntry)!==incomingBody)
                        throw new Error('Received content could not be read: '+missingColonPath);
                    let creationFailure='';
                    try{
                        const reflected=await core.serviceModules.fileHandler.dbToStorage(incomingMeta,null,true);
                        if(reflected) throw new Error('Obsidian unexpectedly created: '+missingColonPath);
                    }catch(error){
                        creationFailure=String(error);
                        if(!creationFailure.includes('File name cannot contain')) throw error;
                    }
                    if(!creationFailure) throw new Error('Missing name rejection: '+missingColonPath);
                    const filesAfter=app.vault.getFiles().map(file=>file.path);
                    const newFiles=filesAfter.filter(path=>!filesBefore.has(path));
                    if(newFiles.length) throw new Error('Received note was written under another name: '+newFiles.join(', '));
                    if((await meta(missingColonPath))?.path!==missingColonPath)
                        throw new Error('Received Metadata changed after rejection: '+missingColonPath);
                    return JSON.stringify({descendants:notes.length,renamed:renamed.size,deleted:deleted.size,missingRejected:true});
                }finally{
                    for(const ref of refs) app.vault.offref(ref);
                }
            })()`,
            session.cliEnv
        );
        console.log(
            `Folder batch: ${result.descendants} descendants persisted, renamed, and deleted; ` +
                `${result.renamed} rename and ${result.deleted} delete events observed; outside note remained writable; ` +
                `missing colon note rejected without an alternate file: ${result.missingRejected}.`
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
