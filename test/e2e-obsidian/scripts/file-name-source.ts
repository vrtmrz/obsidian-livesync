import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { createE2eObsidianDeviceLocalState, waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

type ObsidianStorageAccess = {
    getFileNames(options?: { fresh?: boolean }): Promise<string[]>;
};

type ObsidianTestPlugin = {
    core?: {
        serviceModules?: {
            storageAccess?: ObsidianStorageAccess;
        };
    };
};

type ObsidianTestGlobal = typeof globalThis & {
    app?: {
        plugins?: {
            disablePlugin(pluginId: string): Promise<void>;
            enablePlugin(pluginId: string): Promise<void>;
            plugins?: Record<string, ObsidianTestPlugin | undefined>;
        };
    };
};

function membershipProbeSource(): string {
    return [
        "const assertMembership=async(core,label,expectedNotes,missingPaths)=>{",
        "  const storage=core.serviceModules.storageAccess;",
        "  if(!storage) throw new Error(label+': public storage-access service is unavailable');",
        "  const expected=expectedNotes.map(note=>note.path).sort();",
        "  const equal=(left,right)=>JSON.stringify([...left].sort())===JSON.stringify([...right].sort());",
        "  const vaultPaths=app.vault.getFiles().map(file=>file.path).sort();",
        "  if(!equal(vaultPaths,expected)) throw new Error(label+': Vault membership differs: '+JSON.stringify({expected,actual:vaultPaths}));",
        "  const cachedBeforeFresh=(await storage.getFileNames()).sort();",
        "  if(!equal(cachedBeforeFresh,expected)) throw new Error(label+': cached membership differs: '+JSON.stringify({expected,actual:cachedBeforeFresh}));",
        "  const fresh=(await storage.getFileNames({fresh:true})).sort();",
        "  if(!equal(fresh,expected)) throw new Error(label+': fresh membership differs: '+JSON.stringify({expected,actual:fresh}));",
        "  const cachedAfterFresh=(await storage.getFileNames()).sort();",
        "  if(!equal(cachedAfterFresh,expected)) throw new Error(label+': membership differs after fresh read: '+JSON.stringify({expected,actual:cachedAfterFresh}));",
        "  const settings=core.services.setting.currentSettings();",
        "  const policy={pathNormalizationVersion:settings.pathNormalizationVersion??0,handleFilenameCaseSensitive:settings.handleFilenameCaseSensitive??true};",
        "  for(const note of expectedNotes){",
        "    const file=app.vault.getAbstractFileByPath(note.path);",
        "    if(!file||!file.stat||file.path!==note.path) throw new Error(label+': Vault file is missing: '+note.path);",
        "    if(await app.vault.read(file)!==note.body) throw new Error(label+': Vault content differs: '+note.path);",
        "    const candidates=[...(await storage.findPathIdentityCandidates(note.path,policy))].sort();",
        "    if(!equal(candidates,[note.path])) throw new Error(label+': identity candidates differ for '+note.path+': '+JSON.stringify(candidates));",
        "  }",
        "  for(const path of missingPaths){",
        "    const candidates=await storage.findPathIdentityCandidates(path,policy);",
        "    if(candidates.length) throw new Error(label+': stale identity candidates remain for '+path+': '+JSON.stringify(candidates));",
        "  }",
        "  return {paths:expected};",
        "};",
    ].join("");
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error("Could not find obsidian-cli. Checked: " + cli.checked.join(", "));
    const cliBinary = cli.binary;
    const vault = await createTemporaryVault("obsidian-livesync-file-name-source-");
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
                couchDB_DBNAME: "file-name-source",
                notifyThresholdOfRemoteStorageSize: -1,
                periodicReplication: false,
                syncOnStart: false,
                syncOnSave: false,
                syncOnFileOpen: false,
                syncOnEditorSave: false,
                syncAfterMerge: false,
                useEden: false,
                pathNormalizationVersion: 0,
                handleFilenameCaseSensitive: true,
            },
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);

        const root = "file-name-source";
        const parent = root + "/parent";
        const movedParent = root + "/parent-renamed";
        const oldFile = root + "/rename-before.md";
        const renamedFile = root + "/rename-after.md";
        const deletedFile = root + "/delete.md";
        const notes = [
            { path: root + "/created.md", body: "Created by Obsidian Vault.create.\n" },
            { path: oldFile, body: "Content survives a file rename.\n" },
            { path: deletedFile, body: "This file is removed from membership.\n" },
            { path: parent + "/direct.md", body: "Direct folder descendant.\n" },
            { path: parent + "/nested/deep.md", body: "Nested folder descendant.\n" },
        ];
        const expectedAfterFileRename = notes.map((note) =>
            note.path === oldFile ? { ...note, path: renamedFile } : note
        );
        const expectedAfterFolderRename = expectedAfterFileRename.map((note) =>
            note.path.startsWith(parent + "/") ? { ...note, path: movedParent + note.path.slice(parent.length) } : note
        );
        const expectedFinal = expectedAfterFolderRename.filter((note) => note.path !== deletedFile);
        const oldPaths = [oldFile, deletedFile, parent + "/direct.md", parent + "/nested/deep.md"];

        const membership = await evalObsidianJson<{ paths: string[] }>(
            cliBinary,
            [
                "(async()=>{",
                membershipProbeSource(),
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "await app.vault.createFolder(" + JSON.stringify(root) + ");",
                "await assertMembership(core,'empty Vault',[],[]);",
                "await app.vault.createFolder(" + JSON.stringify(parent) + ");",
                "await app.vault.createFolder(" + JSON.stringify(parent + "/nested") + ");",
                "for(const note of " + JSON.stringify(notes) + ") await app.vault.create(note.path,note.body);",
                "await assertMembership(core,'Vault create'," + JSON.stringify(notes) + ",[]);",
                "await app.vault.rename(app.vault.getAbstractFileByPath(" +
                    JSON.stringify(oldFile) +
                    ")," +
                    JSON.stringify(renamedFile) +
                    ");",
                "await assertMembership(core,'file rename'," +
                    JSON.stringify(expectedAfterFileRename) +
                    "," +
                    JSON.stringify([oldFile]) +
                    ");",
                "await app.vault.rename(app.vault.getAbstractFileByPath(" +
                    JSON.stringify(parent) +
                    ")," +
                    JSON.stringify(movedParent) +
                    ");",
                "await assertMembership(core,'parent-folder rename'," +
                    JSON.stringify(expectedAfterFolderRename) +
                    "," +
                    JSON.stringify([oldFile, parent + "/direct.md", parent + "/nested/deep.md"]) +
                    ");",
                "await app.vault.delete(app.vault.getAbstractFileByPath(" + JSON.stringify(deletedFile) + "),false);",
                "const finalMembership=await assertMembership(core,'Vault delete'," +
                    JSON.stringify(expectedFinal) +
                    "," +
                    JSON.stringify(oldPaths) +
                    ");",
                "return JSON.stringify(finalMembership);",
                "})()",
            ].join(""),
            session.cliEnv
        );

        const unload = await withObsidianPage(
            session.remoteDebuggingPort,
            async (page) =>
                await page.evaluate(async () => {
                    const host = globalThis as ObsidianTestGlobal;
                    const plugins = host.app?.plugins;
                    const plugin = plugins?.plugins?.["obsidian-livesync"];
                    const oldStorage = plugin?.core?.serviceModules?.storageAccess;
                    if (!plugins || !plugin || !oldStorage) {
                        throw new Error("Could not capture the public storage-access service");
                    }
                    await plugins.disablePlugin("obsidian-livesync");
                    if (plugins.plugins?.["obsidian-livesync"] !== undefined) {
                        throw new Error("LiveSync remained loaded after disablePlugin completed");
                    }
                    let lookupError = "";
                    // Obsidian calls the void unload hook before asynchronous core cleanup completes.
                    const deadline = Date.now() + 20_000;
                    do {
                        try {
                            await oldStorage.getFileNames();
                        } catch (error) {
                            lookupError = error instanceof Error ? error.message : String(error);
                        }
                        if (lookupError) break;
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    } while (Date.now() < deadline);
                    if (!lookupError.toLowerCase().includes("disposed")) {
                        throw new Error(
                            "The captured public lookup did not reject after plug-in unload: " + lookupError
                        );
                    }
                    return { oldLookupDisposed: true };
                })
        );
        if (!unload.oldLookupDisposed)
            throw new Error("The old storage-access lookup remained usable after plug-in unload");

        await withObsidianPage(
            session.remoteDebuggingPort,
            async (page) =>
                await page.evaluate(async () => {
                    const plugins = (globalThis as ObsidianTestGlobal).app?.plugins;
                    if (!plugins) throw new Error("Obsidian plug-in manager is unavailable");
                    await plugins.enablePlugin("obsidian-livesync");
                })
        );
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);

        const reloadedMembership = await evalObsidianJson<{ paths: string[] }>(
            cliBinary,
            [
                "(async()=>{",
                membershipProbeSource(),
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "const membership=await assertMembership(core,'reloaded service'," +
                    JSON.stringify(expectedFinal) +
                    "," +
                    JSON.stringify(oldPaths) +
                    ");",
                "return JSON.stringify(membership);",
                "})()",
            ].join(""),
            session.cliEnv
        );
        if (JSON.stringify(reloadedMembership.paths) !== JSON.stringify(membership.paths)) {
            throw new Error("The reloaded storage-access service returned different Vault membership");
        }

        const identityFolder = root + "/identity";
        const mixedCasePath = identityFolder + "/Caf\u00e9.md";
        const upperCasePath = identityFolder + "/CAF\u00c9.md";
        const mixedCaseBody = "Mixed-case NFC file.\n";
        const upperCaseBody = "Upper-case NFC file.\n";
        const preflight = await evalObsidianJson<{
            collisionRefused: boolean;
            sentinelId: string;
            sentinelRev: string;
        }>(
            cliBinary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "const storage=core.serviceModules.storageAccess;",
                "const identityFolder=" + JSON.stringify(identityFolder) + ";",
                "const mixedCasePath=" + JSON.stringify(mixedCasePath) + ";",
                "const upperCasePath=" + JSON.stringify(upperCasePath) + ";",
                "const mixedCaseBody=" + JSON.stringify(mixedCaseBody) + ";",
                "const upperCaseBody=" + JSON.stringify(upperCaseBody) + ";",
                "if(mixedCasePath.normalize('NFC').toLowerCase()!==upperCasePath.normalize('NFC').toLowerCase()) throw new Error('The fixture paths do not share NFC/case identity');",
                "await app.vault.createFolder(identityFolder);",
                "let vaultCreateFailure='';",
                "try{await app.vault.create(mixedCasePath,mixedCaseBody);await app.vault.create(upperCasePath,upperCaseBody);}catch(error){vaultCreateFailure=error instanceof Error?error.message:String(error);}",
                // Vault.create normalises NFD input, so reject that alias without replacing the original contents.
                "const decomposedPath=mixedCasePath.normalize('NFD');",
                "let aliasRefused=false;",
                "try{await app.vault.create(decomposedPath,'Must not replace the original');}catch(error){aliasRefused=String(error).includes('File already exists');}",
                "if(!aliasRefused||await app.vault.adapter.read(mixedCasePath)!==mixedCaseBody) throw new Error('The NFD alias was not safely refused by Vault.create');",
                "let disk=await app.vault.adapter.list(identityFolder);",
                "if(!disk.files.includes(mixedCasePath)||!disk.files.includes(upperCasePath)){",
                "  await app.vault.adapter.write(mixedCasePath,mixedCaseBody);",
                "  await app.vault.adapter.write(upperCasePath,upperCaseBody);",
                "  disk=await app.vault.adapter.list(identityFolder);",
                "}",
                "if(!disk.files.includes(mixedCasePath)||!disk.files.includes(upperCasePath)) throw new Error('The Vault adapter could not preserve both exact physical paths: '+JSON.stringify({files:disk.files,createFailure:vaultCreateFailure}));",
                "const indexedUntil=Date.now()+20000;",
                "let bothIndexed=false;",
                "while(Date.now()<indexedUntil){",
                "  const indexed=new Set(app.vault.getFiles().map(file=>file.path));",
                "  if(indexed.has(mixedCasePath)&&indexed.has(upperCasePath)){bothIndexed=true;break;}",
                "  await new Promise(resolve=>setTimeout(resolve,50));",
                "}",
                "if(!bothIndexed) throw new Error('Obsidian did not index both physically distinct NFC/case files');",
                "disk=await app.vault.adapter.list(identityFolder);",
                "if(!disk.files.includes(mixedCasePath)||!disk.files.includes(upperCasePath)) throw new Error('The Vault adapter did not retain both exact physical paths: '+JSON.stringify(disk.files));",
                "if(await app.vault.adapter.read(mixedCasePath)!==mixedCaseBody||await app.vault.adapter.read(upperCasePath)!==upperCaseBody) throw new Error('The exact NFC/case physical file contents differ');",
                "const indexedNames=await storage.getFileNames({fresh:true});",
                "if(!indexedNames.includes(mixedCasePath)||!indexedNames.includes(upperCasePath)) throw new Error('The public fresh inventory omitted an exact NFC/case path: '+JSON.stringify(indexedNames));",
                "const database=core.services.database.localDatabase;",
                "const sentinelPath='file-name-source/rebuild-preflight-sentinel.md';",
                "const sentinelBody='This real Metadata and Chunk revision must survive the refused rebuild.\\n';",
                "const sentinelId=await core.services.path.path2id(sentinelPath);",
                "const sentinelBlob=new Blob([sentinelBody],{type:'text/plain'});",
                "const now=Date.now();",
                "const saved=await database.putDBEntry({_id:sentinelId,path:sentinelPath,data:sentinelBlob,ctime:now,mtime:now,size:sentinelBlob.size,children:[],datatype:'plain',type:'plain',eden:{}});",
                "if(!saved?.ok) throw new Error('Could not seed the real local database sentinel');",
                "const before=await database.getRaw(sentinelId,{conflicts:true});",
                "if(!before||before._id!==sentinelId||!before._rev) throw new Error('The local database sentinel Metadata is missing');",
                "const readText=async(entry)=>{",
                "  if(!entry) throw new Error('The local database sentinel content is missing');",
                "  const data=entry.data;",
                "  if(typeof data==='string') return data;",
                "  if(data instanceof Blob) return await data.text();",
                "  if(data instanceof ArrayBuffer) return new TextDecoder().decode(data);",
                "  if(Array.isArray(data)) return data.join('');",
                "  throw new Error('The local database sentinel content is not readable text');",
                "};",
                "const beforeEntry=await database.getDBEntryFromMeta(before,false,true,true);",
                "if(await readText(beforeEntry)!==sentinelBody) throw new Error('The seeded local database sentinel content differs');",
                "if(!Array.isArray(before.children)||before.children.length===0) throw new Error('The sentinel does not have real Chunk references');",
                "await core.services.setting.applyPartial({pathNormalizationVersion:1,handleFilenameCaseSensitive:false});",
                "if(core.services.setting.currentSettings().pathNormalizationVersion!==1) throw new Error('The test did not select pathNormalizationVersion 1');",
                "let refusal='';",
                "try{await core.serviceModules.rebuilder.$rebuildEverything();}catch(error){refusal=error instanceof Error?error.message:String(error);}",
                "if(!refusal.includes('File path identity collision')||!refusal.includes(mixedCasePath)||!refusal.includes(upperCasePath)) throw new Error('Rebuild did not refuse the NFC/case collision before resetting local state: '+refusal);",
                "const after=await database.getRaw(sentinelId,{conflicts:true});",
                "if(!after||after._id!==sentinelId||after._rev!==before._rev) throw new Error('The sentinel Metadata ID or revision changed during collision refusal');",
                "const afterEntry=await database.getDBEntryFromMeta(after,false,true,true);",
                "if(await readText(afterEntry)!==sentinelBody) throw new Error('The sentinel content changed during collision refusal');",
                "if(await app.vault.adapter.read(mixedCasePath)!==mixedCaseBody||await app.vault.adapter.read(upperCasePath)!==upperCaseBody) throw new Error('The NFC/case Vault contents changed during collision refusal');",
                "return JSON.stringify({collisionRefused:true,sentinelId:before._id,sentinelRev:before._rev});",
                "})()",
            ].join(""),
            session.cliEnv
        );

        console.log(
            "File-name source: " +
                membership.paths.length +
                " Vault files stayed aligned across create, file rename, parent-folder rename, delete, fresh reads, and plug-in reload; " +
                "NFC/case rebuild collision was refused with sentinel revision " +
                preflight.sentinelRev +
                " intact: " +
                preflight.collisionRefused +
                "."
        );
    } finally {
        try {
            if (session) await session.app.stop();
        } finally {
            await vault.dispose();
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
