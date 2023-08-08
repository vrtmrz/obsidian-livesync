import { Notice, normalizePath, type PluginManifest } from "./deps";
import { type EntryDoc, type LoadedEntry, type InternalFileEntry, type FilePathWithPrefix, type FilePath, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "./lib/src/types";
import { type InternalFileInfo, ICHeader, ICHeaderEnd } from "./types";
import { Parallels, delay, isDocContentSame } from "./lib/src/utils";
import { Logger } from "./lib/src/logger";
import { PouchDB } from "./lib/src/pouchdb-browser.js";
import { disposeMemoObject, memoIfNotExist, memoObject, retrieveMemoObject, scheduleTask, isInternalMetadata, PeriodicProcessor } from "./utils";
import { WrappedNotice } from "./lib/src/wrapper";
import { base64ToArrayBuffer, arrayBufferToBase64 } from "./lib/src/strbin";
import { runWithLock } from "./lib/src/lock";
import { JsonResolveModal } from "./JsonResolveModal";
import { LiveSyncCommands } from "./LiveSyncCommands";
import { addPrefix, stripAllPrefixes } from "./lib/src/path";

export class HiddenFileSync extends LiveSyncCommands {
    periodicInternalFileScanProcessor: PeriodicProcessor = new PeriodicProcessor(this.plugin, async () => this.settings.syncInternalFiles && this.localDatabase.isReady && await this.syncInternalFilesAndDatabase("push", false));
    confirmPopup: WrappedNotice = null;
    get kvDB() {
        return this.plugin.kvDB;
    }
    ensureDirectoryEx(fullPath: string) {
        return this.plugin.ensureDirectoryEx(fullPath);
    }
    getConflictedDoc(path: FilePathWithPrefix, rev: string) {
        return this.plugin.getConflictedDoc(path, rev);
    }
    onunload() {
        this.periodicInternalFileScanProcessor?.disable();
    }
    onload() {
        this.plugin.addCommand({
            id: "livesync-scaninternal",
            name: "Sync hidden files",
            callback: () => {
                this.syncInternalFilesAndDatabase("safe", true);
            },
        });
    }
    async onInitializeDatabase(showNotice: boolean) {
        if (this.settings.syncInternalFiles) {
            try {
                Logger("Synchronizing hidden files...");
                await this.syncInternalFilesAndDatabase("push", showNotice);
                Logger("Synchronizing hidden files done");
            } catch (ex) {
                Logger("Synchronizing hidden files failed");
                Logger(ex, LOG_LEVEL_VERBOSE);
            }
        }
    }
    async beforeReplicate(showNotice: boolean) {
        if (this.localDatabase.isReady && this.settings.syncInternalFiles && this.settings.syncInternalFilesBeforeReplication && !this.settings.watchInternalFileChanges) {
            await this.syncInternalFilesAndDatabase("push", showNotice);
        }
    }
    async onResume() {
        this.periodicInternalFileScanProcessor?.disable();
        if (this.plugin.suspended)
            return;
        if (this.settings.syncInternalFiles) {
            await this.syncInternalFilesAndDatabase("safe", false);
        }
        this.periodicInternalFileScanProcessor.enable(this.settings.syncInternalFiles && this.settings.syncInternalFilesInterval ? (this.settings.syncInternalFilesInterval * 1000) : 0);
    }
    parseReplicationResultItem(docs: PouchDB.Core.ExistingDocument<EntryDoc>) {
        return false;
    }
    realizeSettingSyncMode(): Promise<void> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this.plugin.suspended)
            return;
        if (!this.plugin.isReady)
            return;
        this.periodicInternalFileScanProcessor.enable(this.settings.syncInternalFiles && this.settings.syncInternalFilesInterval ? (this.settings.syncInternalFilesInterval * 1000) : 0);
        return;
    }

    procInternalFiles: string[] = [];
    async execInternalFile() {
        await runWithLock("execInternal", false, async () => {
            const w = [...this.procInternalFiles];
            this.procInternalFiles = [];
            Logger(`Applying hidden ${w.length} files change...`);
            await this.syncInternalFilesAndDatabase("pull", false, false, w);
            Logger(`Applying hidden ${w.length} files changed`);
        });
    }
    procInternalFile(filename: string) {
        this.procInternalFiles.push(filename);
        scheduleTask("procInternal", 500, async () => {
            await this.execInternalFile();
        });
    }

    recentProcessedInternalFiles = [] as string[];
    async watchVaultRawEventsAsync(path: FilePath) {
        if (!this.settings.syncInternalFiles) return;
        const stat = await this.app.vault.adapter.stat(path);
        // sometimes folder is coming.
        if (stat && stat.type != "file")
            return;
        const storageMTime = ~~((stat && stat.mtime || 0) / 1000);
        const key = `${path}-${storageMTime}`;
        if (this.recentProcessedInternalFiles.contains(key)) {
            //If recently processed, it may caused by self.
            return;
        }
        this.recentProcessedInternalFiles = [key, ...this.recentProcessedInternalFiles].slice(0, 100);
        // const id = await this.path2id(path, ICHeader);
        const prefixedFileName = addPrefix(path, ICHeader);
        const filesOnDB = await this.localDatabase.getDBEntryMeta(prefixedFileName);
        const dbMTime = ~~((filesOnDB && filesOnDB.mtime || 0) / 1000);

        // Skip unchanged file.
        if (dbMTime == storageMTime) {
            // Logger(`STORAGE --> DB:${path}: (hidden) Nothing changed`);
            return;
        }

        // Do not compare timestamp. Always local data should be preferred except this plugin wrote one.
        if (storageMTime == 0) {
            await this.deleteInternalFileOnDatabase(path);
        } else {
            await this.storeInternalFileToDatabase({ path: path, ...stat });
        }

    }

    async resolveConflictOnInternalFiles() {
        // Scan all conflicted internal files
        const conflicted = this.localDatabase.findEntries(ICHeader, ICHeaderEnd, { conflicts: true });
        for await (const doc of conflicted) {
            if (!("_conflicts" in doc))
                continue;
            if (isInternalMetadata(doc._id)) {
                await this.resolveConflictOnInternalFile(doc.path);
            }
        }
    }

    async resolveConflictOnInternalFile(path: FilePathWithPrefix): Promise<boolean> {
        try {
            // Retrieve data
            const id = await this.path2id(path, ICHeader);
            const doc = await this.localDatabase.getRaw(id, { conflicts: true });
            // If there is no conflict, return with false.
            if (!("_conflicts" in doc))
                return false;
            if (doc._conflicts.length == 0)
                return false;
            Logger(`Hidden file conflicted:${path}`);
            const conflicts = doc._conflicts.sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
            const revA = doc._rev;
            const revB = conflicts[0];

            if (path.endsWith(".json")) {
                const conflictedRev = conflicts[0];
                const conflictedRevNo = Number(conflictedRev.split("-")[0]);
                //Search 
                const revFrom = (await this.localDatabase.getRaw<EntryDoc>(id, { revs_info: true }));
                const commonBase = revFrom._revs_info.filter(e => e.status == "available" && Number(e.rev.split("-")[0]) < conflictedRevNo).first()?.rev ?? "";
                const result = await this.plugin.mergeObject(path, commonBase, doc._rev, conflictedRev);
                if (result) {
                    Logger(`Object merge:${path}`, LOG_LEVEL_INFO);
                    const filename = stripAllPrefixes(path);
                    const isExists = await this.app.vault.adapter.exists(filename);
                    if (!isExists) {
                        await this.ensureDirectoryEx(filename);
                    }
                    await this.app.vault.adapter.write(filename, result);
                    const stat = await this.app.vault.adapter.stat(filename);
                    await this.storeInternalFileToDatabase({ path: filename, ...stat });
                    await this.extractInternalFileFromDatabase(filename);
                    await this.localDatabase.removeRaw(id, revB);
                    return this.resolveConflictOnInternalFile(path);
                } else {
                    Logger(`Object merge is not applicable.`, LOG_LEVEL_VERBOSE);
                }

                const docAMerge = await this.localDatabase.getDBEntry(path, { rev: revA });
                const docBMerge = await this.localDatabase.getDBEntry(path, { rev: revB });
                if (docAMerge != false && docBMerge != false) {
                    if (await this.showJSONMergeDialogAndMerge(docAMerge, docBMerge)) {
                        await delay(200);
                        // Again for other conflicted revisions.
                        return this.resolveConflictOnInternalFile(path);
                    }
                    return false;
                }
            }
            const revBDoc = await this.localDatabase.getRaw(id, { rev: revB });
            // determine which revision should been deleted.
            // simply check modified time
            const mtimeA = ("mtime" in doc && doc.mtime) || 0;
            const mtimeB = ("mtime" in revBDoc && revBDoc.mtime) || 0;
            // Logger(`Revisions:${new Date(mtimeA).toLocaleString} and ${new Date(mtimeB).toLocaleString}`);
            // console.log(`mtime:${mtimeA} - ${mtimeB}`);
            const delRev = mtimeA < mtimeB ? revA : revB;
            // delete older one.
            await this.localDatabase.removeRaw(id, delRev);
            Logger(`Older one has been deleted:${path}`);
            // check the file again 
            return this.resolveConflictOnInternalFile(path);
        } catch (ex) {
            Logger(`Failed to resolve conflict (Hidden): ${path}`);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    //TODO: Tidy up. Even though it is experimental feature, So dirty...
    async syncInternalFilesAndDatabase(direction: "push" | "pull" | "safe" | "pullForce" | "pushForce", showMessage: boolean, files: InternalFileInfo[] | false = false, targetFiles: string[] | false = false) {
        await this.resolveConflictOnInternalFiles();
        const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
        Logger("Scanning hidden files.", logLevel, "sync_internal");
        const ignorePatterns = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",").filter(e => e).map(e => new RegExp(e, "i"));
        if (!files)
            files = await this.scanInternalFiles();
        const filesOnDB = ((await this.localDatabase.allDocsRaw({ startkey: ICHeader, endkey: ICHeaderEnd, include_docs: true })).rows.map(e => e.doc) as InternalFileEntry[]).filter(e => !e.deleted);
        const allFileNamesSrc = [...new Set([...files.map(e => normalizePath(e.path)), ...filesOnDB.map(e => stripAllPrefixes(this.getPath(e)))])];
        const allFileNames = allFileNamesSrc.filter(filename => !targetFiles || (targetFiles && targetFiles.indexOf(filename) !== -1));
        function compareMTime(a: number, b: number) {
            const wa = ~~(a / 1000);
            const wb = ~~(b / 1000);
            const diff = wa - wb;
            return diff;
        }

        const fileCount = allFileNames.length;
        let processed = 0;
        let filesChanged = 0;
        // count updated files up as like this below:
        // .obsidian: 2
        // .obsidian/workspace: 1
        // .obsidian/plugins: 1
        // .obsidian/plugins/recent-files-obsidian: 1
        // .obsidian/plugins/recent-files-obsidian/data.json: 1
        const updatedFolders: { [key: string]: number; } = {};
        const countUpdatedFolder = (path: string) => {
            const pieces = path.split("/");
            let c = pieces.shift();
            let pathPieces = "";
            filesChanged++;
            while (c) {
                pathPieces += (pathPieces != "" ? "/" : "") + c;
                pathPieces = normalizePath(pathPieces);
                if (!(pathPieces in updatedFolders)) {
                    updatedFolders[pathPieces] = 0;
                }
                updatedFolders[pathPieces]++;
                c = pieces.shift();
            }
        };
        // Cache update time information for files which have already been processed (mainly for files that were skipped due to the same content)
        let caches: { [key: string]: { storageMtime: number; docMtime: number; }; } = {};
        caches = await this.kvDB.get<{ [key: string]: { storageMtime: number; docMtime: number; }; }>("diff-caches-internal") || {};
        const filesMap = files.reduce((acc, cur) => {
            acc[cur.path] = cur;
            return acc;
        }, {} as { [key: string]: InternalFileInfo; });
        const filesOnDBMap = filesOnDB.reduce((acc, cur) => {
            acc[stripAllPrefixes(this.getPath(cur))] = cur;
            return acc;
        }, {} as { [key: string]: InternalFileEntry; });
        const para = Parallels();
        for (const filename of allFileNames) {
            processed++;
            if (processed % 100 == 0) {
                Logger(`Hidden file: ${processed}/${fileCount}`, logLevel, "sync_internal");
            }
            if (!filename) continue;
            if (ignorePatterns.some(e => filename.match(e)))
                continue;
            if (await this.plugin.isIgnoredByIgnoreFiles(filename)) {
                continue
            }

            const fileOnStorage = filename in filesMap ? filesMap[filename] : undefined;
            const fileOnDatabase = filename in filesOnDBMap ? filesOnDBMap[filename] : undefined;

            const cache = filename in caches ? caches[filename] : { storageMtime: 0, docMtime: 0 };

            await para.wait(5);
            const proc = (async (xFileOnStorage: InternalFileInfo, xFileOnDatabase: InternalFileEntry) => {

                if (xFileOnStorage && xFileOnDatabase) {
                    // Both => Synchronize
                    if ((direction != "pullForce" && direction != "pushForce") && xFileOnDatabase.mtime == cache.docMtime && xFileOnStorage.mtime == cache.storageMtime) {
                        return;
                    }
                    const nw = compareMTime(xFileOnStorage.mtime, xFileOnDatabase.mtime);
                    if (nw > 0 || direction == "pushForce") {
                        await this.storeInternalFileToDatabase(xFileOnStorage);
                    }
                    if (nw < 0 || direction == "pullForce") {
                        // skip if not extraction performed.
                        if (!await this.extractInternalFileFromDatabase(filename))
                            return;
                    }
                    // If process successfully updated or file contents are same, update cache.
                    cache.docMtime = xFileOnDatabase.mtime;
                    cache.storageMtime = xFileOnStorage.mtime;
                    caches[filename] = cache;
                    countUpdatedFolder(filename);
                } else if (!xFileOnStorage && xFileOnDatabase) {
                    if (direction == "push" || direction == "pushForce") {
                        if (xFileOnDatabase.deleted)
                            return;
                        await this.deleteInternalFileOnDatabase(filename, false);
                    } else if (direction == "pull" || direction == "pullForce") {
                        if (await this.extractInternalFileFromDatabase(filename)) {
                            countUpdatedFolder(filename);
                        }
                    } else if (direction == "safe") {
                        if (xFileOnDatabase.deleted)
                            return;
                        if (await this.extractInternalFileFromDatabase(filename)) {
                            countUpdatedFolder(filename);
                        }
                    }
                } else if (xFileOnStorage && !xFileOnDatabase) {
                    await this.storeInternalFileToDatabase(xFileOnStorage);
                } else {
                    throw new Error("Invalid state on hidden file sync");
                    // Something corrupted?
                }

            });
            para.add(proc(fileOnStorage, fileOnDatabase))
        }
        await para.all();
        await this.kvDB.set("diff-caches-internal", caches);

        // When files has been retrieved from the database. they must be reloaded.
        if ((direction == "pull" || direction == "pullForce") && filesChanged != 0) {
            const configDir = normalizePath(this.app.vault.configDir);
            // Show notification to restart obsidian when something has been changed in configDir.
            if (configDir in updatedFolders) {
                // Numbers of updated files that is below of configDir.
                let updatedCount = updatedFolders[configDir];
                try {
                    //@ts-ignore
                    const manifests = Object.values(this.app.plugins.manifests) as any as PluginManifest[];
                    //@ts-ignore
                    const enabledPlugins = this.app.plugins.enabledPlugins as Set<string>;
                    const enabledPluginManifests = manifests.filter(e => enabledPlugins.has(e.id));
                    for (const manifest of enabledPluginManifests) {
                        if (manifest.dir in updatedFolders) {
                            // If notified about plug-ins, reloading Obsidian may not be necessary.
                            updatedCount -= updatedFolders[manifest.dir];
                            const updatePluginId = manifest.id;
                            const updatePluginName = manifest.name;
                            const fragment = createFragment((doc) => {
                                doc.createEl("span", null, (a) => {
                                    a.appendText(`Files in ${updatePluginName} has been updated, Press `);
                                    a.appendChild(a.createEl("a", null, (anchor) => {
                                        anchor.text = "HERE";
                                        anchor.addEventListener("click", async () => {
                                            Logger(`Unloading plugin: ${updatePluginName}`, LOG_LEVEL_NOTICE, "plugin-reload-" + updatePluginId);
                                            // @ts-ignore
                                            await this.app.plugins.unloadPlugin(updatePluginId);
                                            // @ts-ignore
                                            await this.app.plugins.loadPlugin(updatePluginId);
                                            Logger(`Plugin reloaded: ${updatePluginName}`, LOG_LEVEL_NOTICE, "plugin-reload-" + updatePluginId);
                                        });
                                    }));

                                    a.appendText(` to reload ${updatePluginName}, or press elsewhere to dismiss this message.`);
                                });
                            });

                            const updatedPluginKey = "popupUpdated-" + updatePluginId;
                            scheduleTask(updatedPluginKey, 1000, async () => {
                                const popup = await memoIfNotExist(updatedPluginKey, () => new Notice(fragment, 0));
                                //@ts-ignore
                                const isShown = popup?.noticeEl?.isShown();
                                if (!isShown) {
                                    memoObject(updatedPluginKey, new Notice(fragment, 0));
                                }
                                scheduleTask(updatedPluginKey + "-close", 20000, () => {
                                    const popup = retrieveMemoObject<Notice>(updatedPluginKey);
                                    if (!popup)
                                        return;
                                    //@ts-ignore
                                    if (popup?.noticeEl?.isShown()) {
                                        popup.hide();
                                    }
                                    disposeMemoObject(updatedPluginKey);
                                });
                            });
                        }
                    }
                } catch (ex) {
                    Logger("Error on checking plugin status.");
                    Logger(ex, LOG_LEVEL_VERBOSE);

                }

                // If something changes left, notify for reloading Obsidian.
                if (updatedCount != 0) {
                    const fragment = createFragment((doc) => {
                        doc.createEl("span", null, (a) => {
                            a.appendText(`Hidden files have been synchronized, Press `);
                            a.appendChild(a.createEl("a", null, (anchor) => {
                                anchor.text = "HERE";
                                anchor.addEventListener("click", () => {
                                    // @ts-ignore
                                    this.app.commands.executeCommandById("app:reload");
                                });
                            }));

                            a.appendText(` to reload obsidian, or press elsewhere to dismiss this message.`);
                        });
                    });

                    scheduleTask("popupUpdated-" + configDir, 1000, () => {
                        //@ts-ignore
                        const isShown = this.confirmPopup?.noticeEl?.isShown();
                        if (!isShown) {
                            this.confirmPopup = new Notice(fragment, 0);
                        }
                        scheduleTask("popupClose" + configDir, 20000, () => {
                            this.confirmPopup?.hide();
                            this.confirmPopup = null;
                        });
                    });
                }
            }
        }

        Logger(`Hidden files scanned: ${filesChanged} files had been modified`, logLevel, "sync_internal");
    }

    async storeInternalFileToDatabase(file: InternalFileInfo, forceWrite = false) {
        if (await this.plugin.isIgnoredByIgnoreFiles(file.path)) {
            return
        }
        const id = await this.path2id(file.path, ICHeader);
        const prefixedFileName = addPrefix(file.path, ICHeader);
        const contentBin = await this.app.vault.adapter.readBinary(file.path);
        let content: string[];
        try {
            content = await arrayBufferToBase64(contentBin);
        } catch (ex) {
            Logger(`The file ${file.path} could not be encoded`);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
        const mtime = file.mtime;
        return await runWithLock("file-" + prefixedFileName, false, async () => {
            try {
                const old = await this.localDatabase.getDBEntry(prefixedFileName, null, false, false);
                let saveData: LoadedEntry;
                if (old === false) {
                    saveData = {
                        _id: id,
                        path: prefixedFileName,
                        data: content,
                        mtime,
                        ctime: mtime,
                        datatype: "newnote",
                        size: file.size,
                        children: [],
                        deleted: false,
                        type: "newnote",
                    };
                } else {
                    if (isDocContentSame(old.data, content) && !forceWrite) {
                        // Logger(`STORAGE --> DB:${file.path}: (hidden) Not changed`, LOG_LEVEL_VERBOSE);
                        return;
                    }
                    saveData =
                    {
                        ...old,
                        data: content,
                        mtime,
                        size: file.size,
                        datatype: "newnote",
                        children: [],
                        deleted: false,
                        type: "newnote",
                    };
                }
                const ret = await this.localDatabase.putDBEntry(saveData, true);
                Logger(`STORAGE --> DB:${file.path}: (hidden) Done`);
                return ret;
            } catch (ex) {
                Logger(`STORAGE --> DB:${file.path}: (hidden) Failed`);
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    async deleteInternalFileOnDatabase(filename: FilePath, forceWrite = false) {
        const id = await this.path2id(filename, ICHeader);
        const prefixedFileName = addPrefix(filename, ICHeader);
        const mtime = new Date().getTime();
        if (await this.plugin.isIgnoredByIgnoreFiles(filename)) {
            return
        }
        await runWithLock("file-" + prefixedFileName, false, async () => {
            try {
                const old = await this.localDatabase.getDBEntryMeta(prefixedFileName, null, true) as InternalFileEntry | false;
                let saveData: InternalFileEntry;
                if (old === false) {
                    saveData = {
                        _id: id,
                        path: prefixedFileName,
                        mtime,
                        ctime: mtime,
                        size: 0,
                        children: [],
                        deleted: true,
                        type: "newnote",
                    };
                } else {
                    if (old.deleted) {
                        Logger(`STORAGE -x> DB:${filename}: (hidden) already deleted`);
                        return;
                    }
                    saveData =
                    {
                        ...old,
                        mtime,
                        size: 0,
                        children: [],
                        deleted: true,
                        type: "newnote",
                    };
                }
                await this.localDatabase.putRaw(saveData);
                Logger(`STORAGE -x> DB:${filename}: (hidden) Done`);
            } catch (ex) {
                Logger(`STORAGE -x> DB:${filename}: (hidden) Failed`);
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    async extractInternalFileFromDatabase(filename: FilePath, force = false) {
        const isExists = await this.app.vault.adapter.exists(filename);
        const prefixedFileName = addPrefix(filename, ICHeader);
        if (await this.plugin.isIgnoredByIgnoreFiles(filename)) {
            return;
        }
        return await runWithLock("file-" + prefixedFileName, false, async () => {
            try {
                // Check conflicted status 
                //TODO option
                const fileOnDB = await this.localDatabase.getDBEntry(prefixedFileName, { conflicts: true }, false, true);
                if (fileOnDB === false)
                    throw new Error(`File not found on database.:${filename}`);
                // Prevent overwrite for Prevent overwriting while some conflicted revision exists.
                if (fileOnDB?._conflicts?.length) {
                    Logger(`Hidden file ${filename} has conflicted revisions, to keep in safe, writing to storage has been prevented`, LOG_LEVEL_INFO);
                    return;
                }
                const deleted = "deleted" in fileOnDB ? fileOnDB.deleted : false;
                if (deleted) {
                    if (!isExists) {
                        Logger(`STORAGE <x- DB:${filename}: deleted (hidden) Deleted on DB, but the file is  already not found on storage.`);
                    } else {
                        Logger(`STORAGE <x- DB:${filename}: deleted (hidden).`);
                        await this.app.vault.adapter.remove(filename);
                        try {
                            //@ts-ignore internalAPI
                            await this.app.vault.adapter.reconcileInternalFile(filename);
                        } catch (ex) {
                            Logger("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
                            Logger(ex, LOG_LEVEL_VERBOSE);
                        }
                    }
                    return true;
                }
                if (!isExists) {
                    await this.ensureDirectoryEx(filename);
                    await this.app.vault.adapter.writeBinary(filename, base64ToArrayBuffer(fileOnDB.data), { mtime: fileOnDB.mtime, ctime: fileOnDB.ctime });
                    try {
                        //@ts-ignore internalAPI
                        await this.app.vault.adapter.reconcileInternalFile(filename);
                    } catch (ex) {
                        Logger("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
                        Logger(ex, LOG_LEVEL_VERBOSE);
                    }
                    Logger(`STORAGE <-- DB:${filename}: written (hidden,new${force ? ", force" : ""})`);
                    return true;
                } else {
                    const contentBin = await this.app.vault.adapter.readBinary(filename);
                    const content = await arrayBufferToBase64(contentBin);
                    if (isDocContentSame(content, fileOnDB.data) && !force) {
                        // Logger(`STORAGE <-- DB:${filename}: skipped (hidden) Not changed`, LOG_LEVEL_VERBOSE);
                        return true;
                    }
                    await this.app.vault.adapter.writeBinary(filename, base64ToArrayBuffer(fileOnDB.data), { mtime: fileOnDB.mtime, ctime: fileOnDB.ctime });
                    try {
                        //@ts-ignore internalAPI
                        await this.app.vault.adapter.reconcileInternalFile(filename);
                    } catch (ex) {
                        Logger("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
                        Logger(ex, LOG_LEVEL_VERBOSE);
                    }
                    Logger(`STORAGE <-- DB:${filename}: written (hidden, overwrite${force ? ", force" : ""})`);
                    return true;

                }
            } catch (ex) {
                Logger(`STORAGE <-- DB:${filename}: written (hidden, overwrite${force ? ", force" : ""}) Failed`);
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }



    showJSONMergeDialogAndMerge(docA: LoadedEntry, docB: LoadedEntry): Promise<boolean> {
        return runWithLock("conflict:merge-data", false, () => new Promise((res) => {
            Logger("Opening data-merging dialog", LOG_LEVEL_VERBOSE);
            const docs = [docA, docB];
            const path = stripAllPrefixes(docA.path);
            const modal = new JsonResolveModal(this.app, path, [docA, docB], async (keep, result) => {
                // modal.close();
                try {
                    const filename = path;
                    let needFlush = false;
                    if (!result && !keep) {
                        Logger(`Skipped merging: ${filename}`);
                        res(false);
                        return;
                    }
                    //Delete old revisions
                    if (result || keep) {
                        for (const doc of docs) {
                            if (doc._rev != keep) {
                                if (await this.localDatabase.deleteDBEntry(this.getPath(doc), { rev: doc._rev })) {
                                    Logger(`Conflicted revision has been deleted: ${filename}`);
                                    needFlush = true;
                                }
                            }
                        }
                    }
                    if (!keep && result) {
                        const isExists = await this.app.vault.adapter.exists(filename);
                        if (!isExists) {
                            await this.ensureDirectoryEx(filename);
                        }
                        await this.app.vault.adapter.write(filename, result);
                        const stat = await this.app.vault.adapter.stat(filename);
                        await this.storeInternalFileToDatabase({ path: filename, ...stat }, true);
                        try {
                            //@ts-ignore internalAPI
                            await this.app.vault.adapter.reconcileInternalFile(filename);
                        } catch (ex) {
                            Logger("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
                            Logger(ex, LOG_LEVEL_VERBOSE);
                        }
                        Logger(`STORAGE <-- DB:${filename}: written (hidden,merged)`);
                    }
                    if (needFlush) {
                        await this.extractInternalFileFromDatabase(filename, false);
                        Logger(`STORAGE --> DB:${filename}: extracted (hidden,merged)`);
                    }
                    res(true);
                } catch (ex) {
                    Logger("Could not merge conflicted json");
                    Logger(ex, LOG_LEVEL_VERBOSE);
                    res(false);
                }
            });
            modal.open();
        }));
    }

    async scanInternalFiles(): Promise<InternalFileInfo[]> {
        const ignoreFilter = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",").filter(e => e).map(e => new RegExp(e, "i"));
        const root = this.app.vault.getRoot();
        const findRoot = root.path;
        const filenames = (await this.getFiles(findRoot, [], null, ignoreFilter)).filter(e => e.startsWith(".")).filter(e => !e.startsWith(".trash"));
        const files = filenames.map(async (e) => {
            return {
                path: e as FilePath,
                stat: await this.app.vault.adapter.stat(e)
            };
        });
        const result: InternalFileInfo[] = [];
        for (const f of files) {
            const w = await f;
            if (await this.plugin.isIgnoredByIgnoreFiles(w.path)) {
                continue
            }
            result.push({
                ...w,
                ...w.stat
            });
        }
        return result;
    }



    async getFiles(
        path: string,
        ignoreList: string[],
        filter: RegExp[],
        ignoreFilter: RegExp[]
    ) {

        const w = await this.app.vault.adapter.list(path);
        const filesSrc = [
            ...w.files
                .filter((e) => !ignoreList.some((ee) => e.endsWith(ee)))
                .filter((e) => !filter || filter.some((ee) => e.match(ee)))
                .filter((e) => !ignoreFilter || ignoreFilter.every((ee) => !e.match(ee))),
        ];
        let files = [] as string[];
        for (const file of filesSrc) {
            if (!await this.plugin.isIgnoredByIgnoreFiles(file)) {
                files.push(file);
            }
        }

        L1: for (const v of w.folders) {
            for (const ignore of ignoreList) {
                if (v.endsWith(ignore)) {
                    continue L1;
                }
            }
            if (ignoreFilter && ignoreFilter.some(e => v.match(e))) {
                continue L1;
            }
            if (await this.plugin.isIgnoredByIgnoreFiles(v)) {
                continue L1;
            }
            files = files.concat(await this.getFiles(v, ignoreList, filter, ignoreFilter));
        }
        return files;
    }
}
