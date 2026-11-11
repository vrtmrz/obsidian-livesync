import { stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

const paths = {
    known: "deletion-recovery-known.md",
    edited: "deletion-recovery-edited.md",
    unknown: "deletion-recovery-unknown.md",
};
const contents = {
    known: "# Known snapshot\nBody retained before deletion.\n",
    edited: "# Edited snapshot\nBody marked AAAAA.\n",
    editedAfter: "# Edited snapshot\nBody marked BBBBB.\n",
    unknown: "# Unknown snapshot\nBody retained without provenance.\n",
};
const pathValues = Object.values(paths);

type FileState = {
    path: string;
    exists: boolean;
    content: string | null;
    databaseBody: string | null;
    metadataRevision: string;
    metadataDeleted: boolean;
    pouchDeleted: boolean;
    conflicts: string[];
    history: string[];
    provenanceRevision: string | null;
    provenanceHash: string | null;
    provenanceSize: number | null;
    lastSeen: boolean;
    storageSnapshotContainsPath: boolean;
    receivedSnapshotContainsPath: boolean;
    fileMtime: number | null;
    fileSize: number | null;
};

function makeStateProbe(): string {
    return [
        "(async()=>{",
        "const core=app.plugins.plugins['obsidian-livesync'].core;",
        "const paths=" + JSON.stringify(pathValues) + ";",
        "const store=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');",
        "const manager=core.serviceModules.storageAccess.vaultManager;",
        "const storageSnapshot=await manager.adapter.persistence.loadSnapshot();",
        "const receivedSnapshot=await core.kvDB.get('replicationResultProcessorSnapshot');",
        "const status=await core.kvDB.get('fileStatusMap')??{};",
        "const hasSnapshotPath=snapshot=>snapshot!==undefined&&snapshot!==null&&paths.some(path=>JSON.stringify(snapshot).includes(path));",
        "const states=[];",
        "for(const path of paths){",
        "const meta=await core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);",
        "if(!meta) throw new Error('Missing Metadata for '+path);",
        "const raw=await core.localDatabase.getRaw(meta._id,{revs:true});",
        "const entry=await core.localDatabase.getDBEntry(path,{rev:meta._rev,revs:true},false,true,true).catch(()=>false);",
        "const databaseBody=Array.isArray(entry?.data)?entry.data.join(''):typeof entry?.data==='string'?entry.data:null;",
        "const file=app.vault.getAbstractFileByPath(path);",
        "const provenance=(await store.get(path))??null;",
        "const lastSeen=Object.keys(status).some(key=>key.toLowerCase()===path.toLowerCase());",
        "states.push({path,exists:!!file,content:file?await app.vault.read(file):null,databaseBody,",
        "metadataRevision:meta._rev,metadataDeleted:!!meta.deleted,pouchDeleted:!!meta._deleted,",
        "conflicts:meta._conflicts??[],history:raw._revisions.ids.map((id,index)=>(raw._revisions.start-index)+'-'+id),",
        "provenanceRevision:provenance?.revision??null,provenanceHash:provenance?.contentHash??null,",
        "provenanceSize:provenance?.contentSize??null,lastSeen,",
        "storageSnapshotContainsPath:hasSnapshotPath(storageSnapshot),receivedSnapshotContainsPath:hasSnapshotPath(receivedSnapshot),",
        "fileMtime:file?.stat?.mtime??null,fileSize:file?.stat?.size??null});",
        "}",
        "return JSON.stringify(states);",
        "})()",
    ].join("");
}

function assertSnapshotsClear(states: FileState[], label: string): void {
    for (const state of states) {
        assertEqual(
            state.storageSnapshotContainsPath,
            false,
            label + " storage-event snapshot contains " + state.path + "."
        );
        assertEqual(
            state.receivedSnapshotContainsPath,
            false,
            label + " replication result snapshot contains " + state.path + "."
        );
    }
}

function assertMetadataUnchanged(actual: FileState, expected: FileState, label: string): void {
    assertEqual(
        actual.metadataRevision,
        expected.metadataRevision,
        label + " Metadata revision changed for " + actual.path + "."
    );
    assertEqual(
        JSON.stringify(actual.history),
        JSON.stringify(expected.history),
        label + " Metadata history changed for " + actual.path + "."
    );
    assertEqual(
        actual.metadataDeleted,
        true,
        label + " Metadata no longer marks " + actual.path + " as logically deleted."
    );
    assertEqual(actual.pouchDeleted, false, label + " Metadata for " + actual.path + " became a PouchDB tombstone.");
    assertEqual(actual.conflicts.length, 0, label + " Metadata gained a conflict for " + actual.path + ".");
}

async function readStates(cliBinary: string, env: NodeJS.ProcessEnv): Promise<FileState[]> {
    return await evalObsidianJson<FileState[]>(cliBinary, makeStateProbe(), env);
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error("Could not find obsidian-cli. Checked: " + cli.checked.join(", "));
    const cliBinary = cli.binary;
    const vault = await createTemporaryVault("obsidian-livesync-deletion-recovery-");
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
                couchDB_DBNAME: "deletion-recovery",
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
            [
                "(async()=>{",
                "const files=" +
                    JSON.stringify({
                        [paths.known]: contents.known,
                        [paths.edited]: contents.edited,
                        [paths.unknown]: contents.unknown,
                    }) +
                    ";",
                "const createdAtMs=Math.floor(Date.now()/1000)*1000;",
                "for(const [path,content] of Object.entries(files)) await app.vault.create(path,content,{ctime:createdAtMs,mtime:createdAtMs});",
                "return JSON.stringify(true);",
                "})()",
            ].join(""),
            session.cliEnv
        );
        for (const path of pathValues) await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, path);

        const initial = await evalObsidianJson<FileState[]>(
            cliBinary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "const paths=" + JSON.stringify(pathValues) + ";",
                "const manager=core.serviceModules.storageAccess.vaultManager;",
                "if(!await core.services.fileProcessing.commitPendingFileEvents()) throw new Error('Initial Vault events did not drain.');",
                "const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));",
                "const hasPath=snapshot=>snapshot!==undefined&&snapshot!==null&&paths.some(path=>JSON.stringify(snapshot).includes(path));",
                "const waitFor=async(predicate,message)=>{const until=Date.now()+15000;while(Date.now()<until){if(await predicate())return;await sleep(50);}throw new Error(message);};",
                "await waitFor(async()=>{const snapshot=await manager.adapter.persistence.loadSnapshot();return !hasPath(snapshot);},'Initial Vault event snapshot still contains a fixture path.');",
                "const scan=await core.services.vault.scanVault(false,false,true);",
                "if(!scan) throw new Error('The fixture preparation scan did not complete.');",
                "await waitFor(async()=>{const status=await core.kvDB.get('fileStatusMap')??{};return paths.every(path=>Object.keys(status).some(key=>key.toLowerCase()===path.toLowerCase()));},'The fixture paths were not recorded in scanner last-seen state.');",
                "return JSON.stringify(await (async()=>{",
                "const store=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');",
                "const status=await core.kvDB.get('fileStatusMap')??{};",
                "const received=await core.kvDB.get('replicationResultProcessorSnapshot');",
                "const storage=await manager.adapter.persistence.loadSnapshot();",
                "const hasSnapshotPath=snapshot=>snapshot!==undefined&&snapshot!==null&&paths.some(path=>JSON.stringify(snapshot).includes(path));",
                "const states=[];",
                "for(const path of paths){",
                "const meta=await core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);",
                "const entry=await core.localDatabase.getDBEntry(path,{rev:meta._rev,revs:true},false,true,true);",
                "const body=Array.isArray(entry.data)?entry.data.join(''):typeof entry.data==='string'?entry.data:null;",
                "const file=app.vault.getAbstractFileByPath(path);",
                "const provenance=(await store.get(path))??null;",
                "states.push({path,exists:!!file,content:file?await app.vault.read(file):null,databaseBody:body,",
                "metadataRevision:meta._rev,metadataDeleted:!!meta.deleted,pouchDeleted:!!meta._deleted,conflicts:meta._conflicts??[],",
                "history:(await core.localDatabase.getRaw(meta._id,{revs:true}))._revisions.ids.map((id,index)=>(meta._rev.split('-')[0]-index)+'-'+id),",
                "provenanceRevision:provenance?.revision??null,provenanceHash:provenance?.contentHash??null,provenanceSize:provenance?.contentSize??null,",
                "lastSeen:Object.keys(status).some(key=>key.toLowerCase()===path.toLowerCase()),",
                "storageSnapshotContainsPath:hasSnapshotPath(storage),receivedSnapshotContainsPath:hasSnapshotPath(received),",
                "fileMtime:file?.stat?.mtime??null,fileSize:file?.stat?.size??null});",
                "}",
                "return states;",
                "})());",
                "})()",
            ].join(""),
            session.cliEnv
        );

        assertEqual(
            contents.edited.length,
            contents.editedAfter.length,
            "The same-stat edit fixture must retain its character length."
        );
        assertEqual(
            Buffer.byteLength(contents.edited),
            Buffer.byteLength(contents.editedAfter),
            "The same-stat edit fixture must retain its byte length."
        );
        for (const state of initial) {
            const originalContent =
                state.path === paths.known
                    ? contents.known
                    : state.path === paths.edited
                      ? contents.edited
                      : contents.unknown;
            assertEqual(
                state.content,
                originalContent,
                "The created Vault file has unexpected bytes: " + state.path + "."
            );
            assertEqual(
                state.databaseBody,
                originalContent,
                "The real file handler did not save the initial content: " + state.path + "."
            );
            assertEqual(state.metadataDeleted, false, "The initial Metadata is already deleted: " + state.path + ".");
            assertEqual(state.conflicts.length, 0, "Initial file creation produced a conflict: " + state.path + ".");
            assertEqual(
                state.provenanceRevision,
                state.metadataRevision,
                "Initial provenance does not identify the saved revision: " + state.path + "."
            );
            if (!state.provenanceHash)
                throw new Error("The real file handler did not record a content hash for " + state.path + ".");
            assertEqual(
                state.provenanceSize,
                Buffer.byteLength(originalContent),
                "Initial provenance has the wrong byte size: " + state.path + "."
            );
            assertEqual(state.lastSeen, true, "Initial scanner state did not record " + state.path + ".");
        }
        assertSnapshotsClear(initial, "Initial fixture setup");

        const editedInitial = initial.find((state) => state.path === paths.edited);
        if (!editedInitial || editedInitial.fileMtime === null || editedInitial.fileSize === null) {
            throw new Error("Could not capture the edited file's initial stat.");
        }
        const editedPathOnDisk = join(vault.path, paths.edited);
        const currentDiskStat = await stat(editedPathOnDisk);
        assertEqual(
            currentDiskStat.size,
            editedInitial.fileSize,
            "Obsidian and filesystem disagree on the edited file size."
        );
        assertEqual(
            Math.trunc(currentDiskStat.mtimeMs),
            editedInitial.fileMtime,
            "Obsidian and filesystem mtime representations differ."
        );

        await evalObsidianJson(
            cliBinary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "core.settings.suspendFileWatching=true;",
                "return JSON.stringify(true);",
                "})()",
            ].join(""),
            session.cliEnv
        );

        await writeFile(editedPathOnDisk, contents.editedAfter, "utf8");
        const mtimeSeconds = editedInitial.fileMtime / 1000;
        await utimes(editedPathOnDisk, mtimeSeconds, mtimeSeconds);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const editedDiskStat = await stat(editedPathOnDisk);
        assertEqual(
            editedDiskStat.size,
            editedInitial.fileSize,
            "The edited file size changed despite the fixed-size fixture."
        );
        assertEqual(
            Math.trunc(editedDiskStat.mtimeMs),
            editedInitial.fileMtime,
            "The edited file mtime changed despite restoring its original timestamp."
        );

        const deletionFixtures = await evalObsidianJson<FileState[]>(
            cliBinary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "const paths=" + JSON.stringify(pathValues) + ";",
                "const editedPath=" + JSON.stringify(paths.edited) + ";",
                "const expectedEdited=" + JSON.stringify(contents.editedAfter) + ";",
                "const manager=core.serviceModules.storageAccess.vaultManager;",
                "const storageSnapshot=await manager.adapter.persistence.loadSnapshot();",
                "const receivedSnapshot=await core.kvDB.get('replicationResultProcessorSnapshot');",
                "const hasSnapshotPath=snapshot=>snapshot!==undefined&&snapshot!==null&&paths.some(path=>JSON.stringify(snapshot).includes(path));",
                "if(hasSnapshotPath(storageSnapshot)) throw new Error('A fixture path entered the storage-event snapshot before deletion seeding.');",
                "if(hasSnapshotPath(receivedSnapshot)) throw new Error('A fixture path entered the replication-result snapshot before deletion seeding.');",
                "const editedFile=app.vault.getAbstractFileByPath(editedPath);",
                "if(!editedFile||await app.vault.read(editedFile)!==expectedEdited) throw new Error('The same-stat disk edit was not visible in the running Vault.');",
                "if(editedFile.stat.size!==" +
                    String(editedInitial.fileSize) +
                    "||editedFile.stat.mtime!==" +
                    String(editedInitial.fileMtime) +
                    ") throw new Error('The same-stat disk edit changed Obsidian file stat.');",
                "const store=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');",
                "const status=await core.kvDB.get('fileStatusMap')??{};",
                "const fixtures=[];",
                "for(const path of paths){",
                "const meta=await core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);",
                "const raw=await core.localDatabase.getRaw(meta._id);",
                "const file=app.vault.getAbstractFileByPath(path);",
                "if(!file) throw new Error('Fixture file disappeared before deletion seeding: '+path);",
                "const baseMtime=Math.max(Number(raw.mtime)||0,Number(file.stat.mtime)||0);",
                "const result=await core.localDatabase.putRaw({...raw,deleted:true,mtime:baseMtime+60000});",
                "if(!result?.ok) throw new Error('Could not seed logical deletion Metadata for '+path);",
                "if(path===" + JSON.stringify(paths.unknown) + ") await store.delete(path);",
                "const deleted=await core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);",
                "const deletedRaw=await core.localDatabase.getRaw(deleted._id,{revs:true});",
                "const provenance=(await store.get(path))??null;",
                "fixtures.push({path,exists:true,content:await app.vault.read(file),metadataRevision:deleted._rev,",
                "metadataDeleted:!!deleted.deleted,pouchDeleted:!!deleted._deleted,conflicts:deleted._conflicts??[],",
                "history:deletedRaw._revisions.ids.map((id,index)=>(deletedRaw._revisions.start-index)+'-'+id),",
                "provenanceRevision:provenance?.revision??null,provenanceHash:provenance?.contentHash??null,",
                "provenanceSize:provenance?.contentSize??null,lastSeen:Object.keys(status).some(key=>key.toLowerCase()===path.toLowerCase()),",
                "storageSnapshotContainsPath:false,receivedSnapshotContainsPath:false,fileMtime:file.stat.mtime,fileSize:file.stat.size});",
                "}",
                "if(!fixtures.every(item=>item.metadataDeleted&&!item.pouchDeleted&&!item.conflicts.length)) throw new Error('Deletion fixture did not create clean logical Metadata tombstones.');",
                "if(!fixtures.every(item=>item.lastSeen)) throw new Error('Deletion fixture lost its initial last-seen records.');",
                "return JSON.stringify(fixtures);",
                "})()",
            ].join(""),
            session.cliEnv
        );

        for (const fixture of deletionFixtures) {
            const original = initial.find((state) => state.path === fixture.path);
            if (!original) throw new Error("Missing initial state for " + fixture.path + ".");
            assertEqual(
                fixture.content,
                fixture.path === paths.edited ? contents.editedAfter : original.content,
                "Fixture bytes changed unexpectedly before restart: " + fixture.path + "."
            );
            assertEqual(fixture.metadataDeleted, true, "Logical deletion was not seeded for " + fixture.path + ".");
            assertEqual(
                fixture.provenanceRevision,
                fixture.path === paths.unknown ? null : original.metadataRevision,
                "The deletion fixture has unexpected provenance for " + fixture.path + "."
            );
            assertEqual(fixture.lastSeen, true, "The deletion fixture lost last-seen state for " + fixture.path + ".");
        }
        assertSnapshotsClear(deletionFixtures, "Deletion fixture setup");

        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        const firstRestart = await readStates(cliBinary, session.cliEnv);
        assertSnapshotsClear(firstRestart, "First restart");

        for (const fixture of deletionFixtures) {
            const actual = firstRestart.find((state) => state.path === fixture.path);
            if (!actual) throw new Error("Missing first-restart state for " + fixture.path + ".");
            assertMetadataUnchanged(actual, fixture, "First restart");
        }

        const known = firstRestart.find((state) => state.path === paths.known)!;
        assertEqual(known.exists, false, "The known unchanged file was not removed from the Vault after restart.");
        assertEqual(known.provenanceRevision, null, "The applied deletion retained file reflection provenance.");
        assertEqual(known.lastSeen, false, "The applied deletion retained offline-scanner last-seen state.");

        const edited = firstRestart.find((state) => state.path === paths.edited)!;
        assertEqual(edited.exists, true, "The same-stat edited file was removed from the Vault.");
        assertEqual(edited.content, contents.editedAfter, "The same-stat edited bytes were not preserved.");
        assertEqual(
            edited.fileMtime,
            editedInitial.fileMtime,
            "The same-stat edited file mtime changed across restart."
        );
        assertEqual(edited.fileSize, editedInitial.fileSize, "The same-stat edited file size changed across restart.");
        assertEqual(
            edited.provenanceRevision,
            deletionFixtures.find((state) => state.path === paths.edited)!.provenanceRevision,
            "The same-stat edit lost its existing provenance record."
        );

        const unknown = firstRestart.find((state) => state.path === paths.unknown)!;
        assertEqual(unknown.exists, true, "The file with unknown provenance was removed from the Vault.");
        assertEqual(unknown.content, contents.unknown, "The file with unknown provenance was not preserved.");
        assertEqual(unknown.provenanceRevision, null, "Unknown provenance was recreated without proof.");

        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({ binary, cliBinary, vault });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        const secondRestart = await readStates(cliBinary, session.cliEnv);
        assertSnapshotsClear(secondRestart, "Second restart");

        for (const previous of firstRestart) {
            const actual = secondRestart.find((state) => state.path === previous.path);
            if (!actual) throw new Error("Missing second-restart state for " + previous.path + ".");
            assertMetadataUnchanged(actual, previous, "Second restart");
            assertEqual(
                actual.exists,
                previous.exists,
                "Second restart changed Vault existence for " + previous.path + "."
            );
            assertEqual(
                actual.content,
                previous.content,
                "Second restart changed Vault bytes for " + previous.path + "."
            );
            assertEqual(
                actual.fileMtime,
                previous.fileMtime,
                "Second restart changed Vault mtime for " + previous.path + "."
            );
            assertEqual(
                actual.fileSize,
                previous.fileSize,
                "Second restart changed Vault size for " + previous.path + "."
            );
            assertEqual(
                actual.provenanceRevision,
                previous.provenanceRevision,
                "Second restart changed provenance for " + previous.path + "."
            );
            assertEqual(
                actual.lastSeen,
                previous.lastSeen,
                "Second restart changed last-seen state for " + previous.path + "."
            );
        }

        assertEqual(
            secondRestart.find((state) => state.path === paths.known)!.exists,
            false,
            "The known deletion did not remain applied after a second restart."
        );
        assertEqual(
            secondRestart.find((state) => state.path === paths.edited)!.content,
            contents.editedAfter,
            "The same-stat edit did not remain preserved after a second restart."
        );
        assertEqual(
            secondRestart.find((state) => state.path === paths.unknown)!.content,
            contents.unknown,
            "The unknown-provenance file did not remain preserved after a second restart."
        );

        console.log(
            "Deletion recovery restart: the proven unchanged file was removed, same-stat edited and unknown-provenance files were preserved, and a second restart retained exact Metadata history."
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
