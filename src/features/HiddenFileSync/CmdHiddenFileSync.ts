import { normalizePath, type PluginManifest, type ListedFiles } from "../../deps.ts";
import { type EntryDoc, type LoadedEntry, type InternalFileEntry, type FilePathWithPrefix, type FilePath, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, MODE_SELECTIVE, MODE_PAUSED, type SavingEntry, type DocumentID } from "../../lib/src/common/types.ts";
import { type InternalFileInfo, ICHeader, ICHeaderEnd } from "../../common/types.ts";
import { readAsBlob, isDocContentSame, sendSignal, readContent, createBlob, fireAndForget } from "../../lib/src/common/utils.ts";
import { Logger } from "../../lib/src/common/logger.ts";
import { getPath, isInternalMetadata, PeriodicProcessor } from "../../common/utils.ts";
import { serialized } from "../../lib/src/concurrency/lock.ts";
import { JsonResolveModal } from "../HiddenFileCommon/JsonResolveModal.ts";
import { LiveSyncCommands } from "../LiveSyncCommands.ts";
import { addPrefix, stripAllPrefixes } from "../../lib/src/string_and_binary/path.ts";
import { QueueProcessor } from "../../lib/src/concurrency/processor.ts";
import { hiddenFilesEventCount, hiddenFilesProcessingCount } from "../../lib/src/mock_and_interop/stores.ts";
import type { IObsidianModule } from "../../modules/AbstractObsidianModule.ts";

export class HiddenFileSync extends LiveSyncCommands implements IObsidianModule {

    _isThisModuleEnabled() {
        return this.plugin.settings.syncInternalFiles;
    }

    periodicInternalFileScanProcessor: PeriodicProcessor = new PeriodicProcessor(this.plugin, async () => this._isThisModuleEnabled() && this._isDatabaseReady() && await this.syncInternalFilesAndDatabase("push", false));

    get kvDB() {
        return this.plugin.kvDB;
    }
    getConflictedDoc(path: FilePathWithPrefix, rev: string) {
        return this.plugin.localDatabase.getConflictedDoc(path, rev);
    }
    onunload() {
        this.periodicInternalFileScanProcessor?.disable();
    }
    onload() {
        this.plugin.addCommand({
            id: "livesync-scaninternal",
            name: "Sync hidden files",
            callback: () => {
                void this.syncInternalFilesAndDatabase("safe", true);
            },
        });
    }
    async $everyOnDatabaseInitialized(showNotice: boolean) {
        if (this._isThisModuleEnabled()) {
            try {
                Logger("Synchronizing hidden files...");
                await this.syncInternalFilesAndDatabase("push", showNotice);
                Logger("Synchronizing hidden files done");
            } catch (ex) {
                Logger("Synchronizing hidden files failed");
                Logger(ex, LOG_LEVEL_VERBOSE);
            }
        }
        return true;
    }
    async $everyBeforeReplicate(showNotice: boolean) {
        if (this._isThisModuleEnabled() && this._isDatabaseReady() && this.settings.syncInternalFilesBeforeReplication && !this.settings.watchInternalFileChanges) {
            await this.syncInternalFilesAndDatabase("push", showNotice);
        }
        return true;
    }


    async $everyOnResumeProcess(): Promise<boolean> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this._isMainSuspended())
            return true;
        if (this._isThisModuleEnabled()) {
            await this.syncInternalFilesAndDatabase("safe", false);
        }
        this.periodicInternalFileScanProcessor.enable(this._isThisModuleEnabled() && this.settings.syncInternalFilesInterval ? (this.settings.syncInternalFilesInterval * 1000) : 0);
        return true
    }

    $everyRealizeSettingSyncMode(): Promise<boolean> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this._isMainSuspended())
            return Promise.resolve(true);
        if (!this.plugin.isReady)
            return Promise.resolve(true);
        this.periodicInternalFileScanProcessor.enable(this._isThisModuleEnabled() && this.settings.syncInternalFilesInterval ? (this.settings.syncInternalFilesInterval * 1000) : 0);
        return Promise.resolve(true);
    }

    procInternalFile(filename: string) {
        this.internalFileProcessor.enqueue(filename);
    }
    internalFileProcessor = new QueueProcessor<string, any>(
        async (filenames) => {
            Logger(`START :Applying hidden ${filenames.length} files change`, LOG_LEVEL_VERBOSE);
            await this.syncInternalFilesAndDatabase("pull", false, false, filenames);
            Logger(`DONE  :Applying hidden ${filenames.length} files change`, LOG_LEVEL_VERBOSE);
            return;
        }, { batchSize: 100, concurrentLimit: 1, delay: 10, yieldThreshold: 100, suspended: false, totalRemainingReactiveSource: hiddenFilesEventCount }
    );

    recentProcessedInternalFiles = [] as string[];

    async $anyProcessOptionalFileEvent(path: FilePath): Promise<boolean | undefined> {
        return await this.watchVaultRawEventsAsync(path);
    }
    async watchVaultRawEventsAsync(path: FilePath): Promise<boolean | undefined> {
        if (!this._isThisModuleEnabled()) return false;
        if (!isInternalMetadata(path)) return false;

        // Exclude files handled by customization sync
        const configDir = normalizePath(this.app.vault.configDir);
        const synchronisedInConfigSync = !this.settings.usePluginSync ? [] : Object.values(this.settings.pluginSyncExtendedSetting).filter(e => e.mode == MODE_SELECTIVE || e.mode == MODE_PAUSED).map(e => e.files).flat().map(e => `${configDir}/${e}`.toLowerCase());
        if (synchronisedInConfigSync.some(e => e.startsWith(path.toLowerCase()))) {
            Logger(`Hidden file skipped: ${path} is synchronized in customization sync.`, LOG_LEVEL_VERBOSE);
            return false;
        }
        const stat = await this.plugin.storageAccess.statHidden(path);
        // sometimes folder is coming.
        if (stat != null && stat.type != "file") {
            return false;
        }
        const mtime = stat == null ? 0 : stat?.mtime ?? 0;
        const storageMTime = ~~((mtime) / 1000);
        const key = `${path}-${storageMTime}`;
        if (mtime != 0 && this.recentProcessedInternalFiles.contains(key)) {
            //If recently processed, it may caused by self.
            // Return true to prevent further processing.
            return true;
        }
        this.recentProcessedInternalFiles = [key, ...this.recentProcessedInternalFiles].slice(0, 100);
        // const id = await this.path2id(path, ICHeader);
        const prefixedFileName = addPrefix(path, ICHeader);
        const filesOnDB = await this.localDatabase.getDBEntryMeta(prefixedFileName);
        const dbMTime = ~~((filesOnDB && filesOnDB.mtime || 0) / 1000);

        // Skip unchanged file.
        if (dbMTime == storageMTime) {
            // Logger(`STORAGE --> DB:${path}: (hidden) Nothing changed`);
            // Handled, but nothing changed. also return true to prevent further processing.
            return true;
        }

        // Do not compare timestamp. Always local data should be preferred except this plugin wrote one.
        try {
            if (storageMTime == 0) {
                await this.deleteInternalFileOnDatabase(path);
            } else {
                await this.storeInternalFileToDatabase({ path: path, mtime, ctime: stat?.ctime ?? mtime, size: stat?.size ?? 0 });
            }
            // Surely processed.
            return true;
        } catch (ex) {
            Logger(`Failed to process hidden file:${path}`);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
        // Could not be processed. but it was own task. so return true to prevent further processing.
        return true;
    }

    async resolveConflictOnInternalFiles() {
        // Scan all conflicted internal files
        const conflicted = this.localDatabase.findEntries(ICHeader, ICHeaderEnd, { conflicts: true });
        this.conflictResolutionProcessor.suspend();
        try {
            for await (const doc of conflicted) {
                if (!("_conflicts" in doc))
                    continue;
                if (isInternalMetadata(doc._id)) {
                    this.conflictResolutionProcessor.enqueue(doc.path);
                }
            }
        } catch (ex) {
            Logger("something went wrong on resolving all conflicted internal files");
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
        await this.conflictResolutionProcessor.startPipeline().waitForAllProcessed();
    }

    async resolveByNewerEntry(id: DocumentID, path: FilePathWithPrefix, currentDoc: EntryDoc, currentRev: string, conflictedRev: string) {
        const conflictedDoc = await this.localDatabase.getRaw(id, { rev: conflictedRev });
        // determine which revision should been deleted.
        // simply check modified time
        const mtimeCurrent = ("mtime" in currentDoc && currentDoc.mtime) || 0;
        const mtimeConflicted = ("mtime" in conflictedDoc && conflictedDoc.mtime) || 0;
        // Logger(`Revisions:${new Date(mtimeA).toLocaleString} and ${new Date(mtimeB).toLocaleString}`);
        // console.log(`mtime:${mtimeA} - ${mtimeB}`);
        const delRev = mtimeCurrent < mtimeConflicted ? currentRev : conflictedRev;
        // delete older one.
        await this.localDatabase.removeRevision(id, delRev);
        Logger(`Older one has been deleted:${path}`);
        const cc = await this.localDatabase.getRaw(id, { conflicts: true });
        if (cc._conflicts?.length === 0) {
            await this.extractInternalFileFromDatabase(stripAllPrefixes(path))
        } else {
            this.conflictResolutionProcessor.enqueue(path);
        }
        // check the file again

    }
    conflictResolutionProcessor = new QueueProcessor(async (paths: FilePathWithPrefix[]) => {
        const path = paths[0];
        sendSignal(`cancel-internal-conflict:${path}`);
        try {
            // Retrieve data
            const id = await this.path2id(path, ICHeader);
            const doc = await this.localDatabase.getRaw(id, { conflicts: true });
            // if (!("_conflicts" in doc)){
            //     return [];
            // }
            if (doc._conflicts === undefined) return [];
            if (doc._conflicts.length == 0)
                return [];
            Logger(`Hidden file conflicted:${path}`);
            const conflicts = doc._conflicts.sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
            const revA = doc._rev;
            const revB = conflicts[0];

            if (path.endsWith(".json")) {
                const conflictedRev = conflicts[0];
                const conflictedRevNo = Number(conflictedRev.split("-")[0]);
                //Search 
                const revFrom = (await this.localDatabase.getRaw<EntryDoc>(id, { revs_info: true }));
                const commonBase = revFrom._revs_info?.filter(e => e.status == "available" && Number(e.rev.split("-")[0]) < conflictedRevNo).first()?.rev ?? "";
                const result = await this.plugin.localDatabase.mergeObject(path, commonBase, doc._rev, conflictedRev);
                if (result) {
                    Logger(`Object merge:${path}`, LOG_LEVEL_INFO);
                    const filename = stripAllPrefixes(path);
                    const isExists = await this.plugin.storageAccess.isExistsIncludeHidden(filename);
                    if (!isExists) {
                        await this.plugin.storageAccess.ensureDir(filename);
                    }
                    await this.plugin.storageAccess.writeHiddenFileAuto(filename, result);
                    const stat = await this.plugin.storageAccess.statHidden(filename);
                    if (!stat) {
                        throw new Error(`conflictResolutionProcessor: Failed to stat file ${filename}`);
                    }
                    await this.storeInternalFileToDatabase({ path: filename, ...stat });
                    await this.extractInternalFileFromDatabase(filename);
                    await this.localDatabase.removeRevision(id, revB);
                    this.conflictResolutionProcessor.enqueue(path);
                    return [];
                } else {
                    Logger(`Object merge is not applicable.`, LOG_LEVEL_VERBOSE);
                }
                return [{ path, revA, revB, id, doc }];
            }
            // When not JSON file, resolve conflicts by choosing a newer one.
            await this.resolveByNewerEntry(id, path, doc, revA, revB);
            return [];
        } catch (ex) {
            Logger(`Failed to resolve conflict (Hidden): ${path}`);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return [];
        }
    }, {
        suspended: false, batchSize: 1, concurrentLimit: 5, delay: 10, keepResultUntilDownstreamConnected: true, yieldThreshold: 10,
        pipeTo: new QueueProcessor(async (results) => {
            const { id, doc, path, revA, revB } = results[0];
            const docAMerge = await this.localDatabase.getDBEntry(path, { rev: revA });
            const docBMerge = await this.localDatabase.getDBEntry(path, { rev: revB });
            if (docAMerge != false && docBMerge != false) {
                if (await this.showJSONMergeDialogAndMerge(docAMerge, docBMerge)) {
                    // Again for other conflicted revisions.
                    this.conflictResolutionProcessor.enqueue(path);
                }
                return;
            } else {
                // If either revision could not read, force resolving by the newer one.
                await this.resolveByNewerEntry(id, path, doc, revA, revB);
            }
        }, { suspended: false, batchSize: 1, concurrentLimit: 1, delay: 10, keepResultUntilDownstreamConnected: false, yieldThreshold: 10 })
    })

    $anyGetOptionalConflictCheckMethod(path: FilePathWithPrefix): Promise<boolean | "newer"> {
        if (isInternalMetadata(path)) {
            this.queueConflictCheck(path);
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }

    async $anyProcessOptionalSyncFiles(doc: LoadedEntry): Promise<boolean | undefined> {
        if (isInternalMetadata(doc._id) && this._isThisModuleEnabled()) {
            //system file
            const filename = getPath(doc);
            if (await this.plugin.$$isTargetFile(filename)) {
                this.procInternalFile(filename);
                return true;
            } else {
                Logger(`Skipped (Not target:${filename})`, LOG_LEVEL_VERBOSE);
                return false;
            }
        }
        return false;
    }
    queueConflictCheck(path: FilePathWithPrefix) {
        this.conflictResolutionProcessor.enqueue(path);
    }

    //TODO: Tidy up. Even though it is experimental feature, So dirty...
    async syncInternalFilesAndDatabase(direction: "push" | "pull" | "safe" | "pullForce" | "pushForce", showMessage: boolean, filesAll: InternalFileInfo[] | false = false, targetFiles: string[] | false = false) {
        await this.resolveConflictOnInternalFiles();
        const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
        Logger("Scanning hidden files.", logLevel, "sync_internal");
        const ignorePatterns = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",").filter(e => e).map(e => new RegExp(e, "i"));

        const configDir = normalizePath(this.app.vault.configDir);
        let files: InternalFileInfo[] =
            filesAll ? filesAll : (await this.scanInternalFiles())

        const synchronisedInConfigSync = !this.settings.usePluginSync ? [] : Object.values(this.settings.pluginSyncExtendedSetting).filter(e => e.mode == MODE_SELECTIVE || e.mode == MODE_PAUSED).map(e => e.files).flat().map(e => `${configDir}/${e}`.toLowerCase());
        files = files.filter(file => synchronisedInConfigSync.every(filterFile => !file.path.toLowerCase().startsWith(filterFile)))

        const filesOnDB = ((await this.localDatabase.allDocsRaw({ startkey: ICHeader, endkey: ICHeaderEnd, include_docs: true })).rows.map(e => e.doc) as InternalFileEntry[]).filter(e => !e.deleted);
        const allFileNamesSrc = [...new Set([...files.map(e => normalizePath(e.path)), ...filesOnDB.map(e => stripAllPrefixes(this.getPath(e)))])];
        const allFileNames = allFileNamesSrc.filter(filename => !targetFiles || (targetFiles && targetFiles.indexOf(filename) !== -1)).filter(path => synchronisedInConfigSync.every(filterFile => !path.toLowerCase().startsWith(filterFile)))
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
        await new QueueProcessor(async (filenames: FilePath[]) => {
            const filename = filenames[0];
            processed++;
            if (processed % 100 == 0) {
                Logger(`Hidden file: ${processed}/${fileCount}`, logLevel, "sync_internal");
            }
            if (!filename) return [];
            if (ignorePatterns.some(e => filename.match(e)))
                return [];
            if (await this.plugin.$$isIgnoredByIgnoreFiles(filename)) {
                return [];
            }

            const fileOnStorage = filename in filesMap ? filesMap[filename] : undefined;
            const fileOnDatabase = filename in filesOnDBMap ? filesOnDBMap[filename] : undefined;

            return [{
                filename,
                fileOnStorage,
                fileOnDatabase,
            }]

        }, { suspended: true, batchSize: 1, concurrentLimit: 10, delay: 0, totalRemainingReactiveSource: hiddenFilesProcessingCount })
            .pipeTo(new QueueProcessor(async (params) => {
                const
                    {
                        filename,
                        fileOnStorage: xFileOnStorage,
                        fileOnDatabase: xFileOnDatabase
                    } = params[0];
                if (xFileOnStorage && xFileOnDatabase) {
                    const cache = filename in caches ? caches[filename] : { storageMtime: 0, docMtime: 0 };
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
                    if (direction == "push" || direction == "pushForce" || direction == "safe") {
                        await this.storeInternalFileToDatabase(xFileOnStorage);
                    } else {
                        await this.extractInternalFileFromDatabase(xFileOnStorage.path);
                    }
                } else {
                    throw new Error("Invalid state on hidden file sync");
                    // Something corrupted?
                }
                return;
            }, { suspended: true, batchSize: 1, concurrentLimit: 5, delay: 0 }))
            .root
            .enqueueAll(allFileNames)
            .startPipeline().waitForAllDoneAndTerminate();

        await this.kvDB.set("diff-caches-internal", caches);

        // When files has been retrieved from the database. they must be reloaded.
        if ((direction == "pull" || direction == "pullForce") && filesChanged != 0) {
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
                        if (manifest.dir && manifest.dir in updatedFolders) {
                            // If notified about plug-ins, reloading Obsidian may not be necessary.
                            updatedCount -= updatedFolders[manifest.dir];
                            const updatePluginId = manifest.id;
                            const updatePluginName = manifest.name;
                            this.plugin.confirm.askInPopup(`updated-${updatePluginId}`, `Files in ${updatePluginName} has been updated, Press {HERE} to reload ${updatePluginName}, or press elsewhere to dismiss this message.`, (anchor) => {
                                anchor.text = "HERE";
                                anchor.addEventListener("click", () => {
                                    fireAndForget(async () => {
                                        Logger(`Unloading plugin: ${updatePluginName}`, LOG_LEVEL_NOTICE, "plugin-reload-" + updatePluginId);
                                        // @ts-ignore
                                        await this.app.plugins.unloadPlugin(updatePluginId);
                                        // @ts-ignore
                                        await this.app.plugins.loadPlugin(updatePluginId);
                                        Logger(`Plugin reloaded: ${updatePluginName}`, LOG_LEVEL_NOTICE, "plugin-reload-" + updatePluginId);
                                    });
                                });
                            }
                            );
                        }
                    }
                } catch (ex) {
                    Logger("Error on checking plugin status.");
                    Logger(ex, LOG_LEVEL_VERBOSE);

                }

                // If something changes left, notify for reloading Obsidian.
                if (updatedCount != 0) {
                    if (!this.plugin.isReloadingScheduled) {
                        this.plugin.confirm.askInPopup(`updated-any-hidden`, `Hidden files have been synchronised, Press {HERE} to schedule a reload of Obsidian, or press elsewhere to dismiss this message.`, (anchor) => {
                            anchor.text = "HERE";
                            anchor.addEventListener("click", () => {
                                this.plugin.$$scheduleAppReload();
                            });
                        });
                    }
                }
            }
        }

        Logger(`Hidden files scanned: ${filesChanged} files had been modified`, logLevel, "sync_internal");
    }

    async storeInternalFileToDatabase(file: InternalFileInfo, forceWrite = false) {
        if (await this.plugin.$$isIgnoredByIgnoreFiles(file.path)) {
            return
        }

        const id = await this.path2id(file.path, ICHeader);
        const prefixedFileName = addPrefix(file.path, ICHeader);
        const content = createBlob(await this.plugin.storageAccess.readHiddenFileAuto(file.path));
        const mtime = file.mtime;
        return await serialized("file-" + prefixedFileName, async () => {
            try {
                const old = await this.localDatabase.getDBEntry(prefixedFileName, undefined, false, false);
                let saveData: SavingEntry;
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
                        eden: {},
                    };
                } else {
                    if (await isDocContentSame(readAsBlob(old), content) && !forceWrite) {
                        // Logger(`STORAGE --> DB:${file.path}: (hidden) Not changed`, LOG_LEVEL_VERBOSE);
                        return;
                    }
                    saveData =
                    {
                        ...old,
                        data: content,
                        mtime,
                        size: file.size,
                        datatype: old.datatype,
                        children: [],
                        deleted: false,
                        type: old.datatype,
                    };
                }
                const ret = await this.localDatabase.putDBEntry(saveData);
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
        if (await this.plugin.$$isIgnoredByIgnoreFiles(filename)) {
            return
        }
        await serialized("file-" + prefixedFileName, async () => {
            try {
                const old = await this.localDatabase.getDBEntryMeta(prefixedFileName, undefined, true) as InternalFileEntry | false;
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
                        eden: {}
                    };
                } else {
                    // Remove all conflicted before deleting.
                    const conflicts = await this.localDatabase.getRaw(old._id, { conflicts: true });
                    if (conflicts._conflicts !== undefined) {
                        for (const conflictRev of conflicts._conflicts) {
                            await this.localDatabase.removeRevision(old._id, conflictRev);
                            Logger(`STORAGE -x> DB:${filename}: (hidden) conflict removed ${old._rev} =>  ${conflictRev}`, LOG_LEVEL_VERBOSE);
                        }
                    }
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
        const isExists = await this.plugin.storageAccess.isExistsIncludeHidden(filename);
        const prefixedFileName = addPrefix(filename, ICHeader);
        if (await this.plugin.$$isIgnoredByIgnoreFiles(filename)) {
            return;
        }
        return await serialized("file-" + prefixedFileName, async () => {
            try {
                // Check conflicted status 
                const fileOnDB = await this.localDatabase.getDBEntry(prefixedFileName, { conflicts: true }, false, true, true);
                if (fileOnDB === false)
                    throw new Error(`File not found on database.:${filename}`);
                // Prevent overwrite for Prevent overwriting while some conflicted revision exists.
                if (fileOnDB?._conflicts?.length) {
                    Logger(`Hidden file ${filename} has conflicted revisions, to keep in safe, writing to storage has been prevented`, LOG_LEVEL_INFO);
                    return;
                }
                const deleted = fileOnDB.deleted || fileOnDB._deleted || false;
                if (deleted) {
                    if (!isExists) {
                        Logger(`STORAGE <x- DB:${filename}: deleted (hidden) Deleted on DB, but the file is already not found on storage.`);
                    } else {
                        Logger(`STORAGE <x- DB:${filename}: deleted (hidden).`);
                        await this.plugin.storageAccess.removeHidden(filename);
                        try {
                            // -- @ts-ignore internalAPI
                            // await this.app.vault.adapter.reconcileInternalFile(filename);
                            await this.plugin.storageAccess.triggerHiddenFile(filename);
                        } catch (ex) {
                            Logger("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
                            Logger(ex, LOG_LEVEL_VERBOSE);
                        }
                    }
                    return true;
                }
                if (!isExists) {
                    await this.plugin.storageAccess.ensureDir(filename);
                    await this.plugin.storageAccess.writeHiddenFileAuto(filename, readContent(fileOnDB), { mtime: fileOnDB.mtime, ctime: fileOnDB.ctime });
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
                    const content = await this.plugin.storageAccess.readHiddenFileAuto(filename);
                    const docContent = readContent(fileOnDB);
                    if (await isDocContentSame(content, docContent) && !force) {
                        // Logger(`STORAGE <-- DB:${filename}: skipped (hidden) Not changed`, LOG_LEVEL_VERBOSE);
                        return true;
                    }
                    await this.plugin.storageAccess.writeHiddenFileAuto(filename, docContent, { mtime: fileOnDB.mtime, ctime: fileOnDB.ctime });
                    try {
                        // await this.app.vault.adapter.reconcileInternalFile(filename);
                        await this.plugin.storageAccess.triggerHiddenFile(filename);
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
        return new Promise((res) => {
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
                        const isExists = await this.plugin.storageAccess.isExistsIncludeHidden(filename);
                        if (!isExists) {
                            await this.plugin.storageAccess.ensureDir(filename);
                        }
                        await this.plugin.storageAccess.writeHiddenFileAuto(filename, result);
                        const stat = await this.plugin.storageAccess.statHidden(filename);
                        if (!stat) {
                            throw new Error("Stat failed");
                        }
                        const mtime = stat?.mtime ?? 0;
                        await this.storeInternalFileToDatabase({ path: filename, mtime, ctime: stat?.ctime ?? mtime, size: stat?.size ?? 0 }, true);
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
        });
    }

    async $allAskUsingOptionalSyncFeature(opt: { enableFetch?: boolean, enableOverwrite?: boolean }) {
        await this._askHiddenFileConfiguration(opt);
        return true;
    }
    async _askHiddenFileConfiguration(opt: { enableFetch?: boolean, enableOverwrite?: boolean }) {
        const messageFetch = `${opt.enableFetch ? `- Fetch: Use the files stored from other devices. Choose this option if you have already configured hidden file synchronization on those devices and wish to accept their files.\n` : ""}`;
        const messageOverwrite = `${opt.enableOverwrite ? ` - Overwrite: Use the files from this device. Select this option if you want to overwrite the files stored on other devices.\n` : ""}`;
        const messageMerge = `- Merge: Merge the files from this device with those on other devices. Choose this option if you wish to combine files from multiple sources.
  However, please be reminded that merging may cause conflicts if the files are not identical. Additionally, this process may occur within the same folder, potentially breaking your plug-in or theme settings that comprise multiple files.\n`;
        const message = `Would you like to enable \`Hidden File Synchronization\`?

This feature allows you to synchronize all hidden files without any user interaction.
To enable this feature, you should choose one of the following options:

${messageFetch}${messageOverwrite}${messageMerge}

Note: Please keep in mind that enabling this feature alongside customisation sync may override certain behaviors.`
        const CHOICE_FETCH = "Fetch";
        const CHOICE_OVERWRITE = "Overwrite";
        const CHOICE_MERGE = "Merge";
        const CHOICE_DISABLE = "Disable";
        const choices = [];
        if (opt?.enableFetch) {
            choices.push(CHOICE_FETCH);
        }
        if (opt?.enableOverwrite) {
            choices.push(CHOICE_OVERWRITE);
        }
        choices.push(CHOICE_MERGE);
        choices.push(CHOICE_DISABLE);

        const ret = await this.plugin.confirm.confirmWithMessage("Hidden file sync", message, choices, CHOICE_DISABLE, 40);
        if (ret == CHOICE_FETCH) {
            await this.configureHiddenFileSync("FETCH");
        } else if (ret == CHOICE_OVERWRITE) {
            await this.configureHiddenFileSync("OVERWRITE");
        } else if (ret == CHOICE_MERGE) {
            await this.configureHiddenFileSync("MERGE");
        } else if (ret == CHOICE_DISABLE) {
            await this.configureHiddenFileSync("DISABLE_HIDDEN");
        }
    }

    $allSuspendExtraSync(): Promise<boolean> {
        if (this.plugin.settings.syncInternalFiles) {
            Logger("Hidden file synchronization have been temporarily disabled. Please enable them after the fetching, if you need them.", LOG_LEVEL_NOTICE)
            this.plugin.settings.syncInternalFiles = false;
        }
        return Promise.resolve(true);
    }

    async $anyConfigureOptionalSyncFeature(mode: "FETCH" | "OVERWRITE" | "MERGE" | "DISABLE" | "DISABLE_HIDDEN") {
        await this.configureHiddenFileSync(mode);
    }

    async configureHiddenFileSync(mode: "FETCH" | "OVERWRITE" | "MERGE" | "DISABLE" | "DISABLE_HIDDEN") {
        if (mode != "FETCH" && mode != "OVERWRITE" && mode != "MERGE" && mode != "DISABLE" && mode != "DISABLE_HIDDEN") {
            return;
        }

        if (mode == "DISABLE" || mode == "DISABLE_HIDDEN") {
            // await this.plugin.$allSuspendExtraSync();
            this.plugin.settings.syncInternalFiles = false;
            await this.plugin.saveSettings();
            return;
        }
        Logger("Gathering files for enabling Hidden File Sync", LOG_LEVEL_NOTICE);
        if (mode == "FETCH") {
            await this.syncInternalFilesAndDatabase("pullForce", true);
        } else if (mode == "OVERWRITE") {
            await this.syncInternalFilesAndDatabase("pushForce", true);
        } else if (mode == "MERGE") {
            await this.syncInternalFilesAndDatabase("safe", true);
        }
        this.plugin.settings.syncInternalFiles = true;
        await this.plugin.saveSettings();
        Logger(`Done! Restarting the app is strongly recommended!`, LOG_LEVEL_NOTICE);

    }
    async scanInternalFiles(): Promise<InternalFileInfo[]> {
        const configDir = normalizePath(this.app.vault.configDir);
        const ignoreFilter = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",").filter(e => e).map(e => new RegExp(e, "i"));
        const synchronisedInConfigSync = !this.settings.usePluginSync ? [] : Object.values(this.settings.pluginSyncExtendedSetting).filter(e => e.mode == MODE_SELECTIVE || e.mode == MODE_PAUSED).map(e => e.files).flat().map(e => `${configDir}/${e}`.toLowerCase());
        const root = this.app.vault.getRoot();
        const findRoot = root.path;

        const filenames = (await this.getFiles(findRoot, [], undefined, ignoreFilter)).filter(e => e.startsWith(".")).filter(e => !e.startsWith(".trash"));
        const files = filenames.filter(path => synchronisedInConfigSync.every(filterFile => !path.toLowerCase().startsWith(filterFile))).map(async (e) => {
            return {
                path: e as FilePath,
                stat: await this.plugin.storageAccess.statHidden(e) // this.plugin.vaultAccess.adapterStat(e)
            };
        });
        const result: InternalFileInfo[] = [];
        for (const f of files) {
            const w = await f;
            if (await this.plugin.$$isIgnoredByIgnoreFiles(w.path)) {
                continue
            }
            const mtime = w.stat?.mtime ?? 0
            const ctime = w.stat?.ctime ?? mtime;
            const size = w.stat?.size ?? 0;
            result.push({
                ...w,
                mtime, ctime, size
            });
        }
        return result;
    }



    async getFiles(
        path: string,
        ignoreList: string[],
        filter?: RegExp[],
        ignoreFilter?: RegExp[]
    ) {
        let w: ListedFiles;
        try {
            w = await this.app.vault.adapter.list(path);
        } catch (ex) {
            Logger(`Could not traverse(HiddenSync):${path}`, LOG_LEVEL_INFO);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return [];
        }
        const filesSrc = [
            ...w.files
                .filter((e) => !ignoreList.some((ee) => e.endsWith(ee)))
                .filter((e) => !filter || filter.some((ee) => e.match(ee)))
                .filter((e) => !ignoreFilter || ignoreFilter.every((ee) => !e.match(ee)))
        ];
        let files = [] as string[];
        for (const file of filesSrc) {
            if (!await this.plugin.$$isIgnoredByIgnoreFiles(file)) {
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
            if (await this.plugin.$$isIgnoredByIgnoreFiles(v)) {
                continue L1;
            }
            files = files.concat(await this.getFiles(v, ignoreList, filter, ignoreFilter));
        }
        return files;
    }
}
