import { normalizePath, type PluginManifest, type ListedFiles } from "../../deps.ts";
import {
    type EntryDoc,
    type LoadedEntry,
    type InternalFileEntry,
    type FilePathWithPrefix,
    type FilePath,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    MODE_SELECTIVE,
    MODE_PAUSED,
    type SavingEntry,
    type DocumentID,
    type UXStat,
    MODE_AUTOMATIC,
    type FilePathWithPrefixLC,
} from "../../lib/src/common/types.ts";
import { type InternalFileInfo, ICHeader, ICHeaderEnd } from "../../common/types.ts";
import {
    readAsBlob,
    isDocContentSame,
    sendSignal,
    readContent,
    createBlob,
    fireAndForget,
} from "../../lib/src/common/utils.ts";
import {
    BASE_IS_NEW,
    compareMTime,
    EVEN,
    getPath,
    isInternalMetadata,
    isMarkedAsSameChanges,
    markChangesAreSame,
    PeriodicProcessor,
    TARGET_IS_NEW,
} from "../../common/utils.ts";
import { serialized } from "../../lib/src/concurrency/lock.ts";
import { JsonResolveModal } from "../HiddenFileCommon/JsonResolveModal.ts";
import { LiveSyncCommands } from "../LiveSyncCommands.ts";
import { addPrefix, stripAllPrefixes } from "../../lib/src/string_and_binary/path.ts";
import { QueueProcessor } from "../../lib/src/concurrency/processor.ts";
import { hiddenFilesEventCount, hiddenFilesProcessingCount } from "../../lib/src/mock_and_interop/stores.ts";
import type { IObsidianModule } from "../../modules/AbstractObsidianModule.ts";
import { EVENT_SETTING_SAVED, eventHub } from "../../common/events.ts";

export class HiddenFileSync extends LiveSyncCommands implements IObsidianModule {
    _isThisModuleEnabled() {
        return this.plugin.settings.syncInternalFiles;
    }

    periodicInternalFileScanProcessor: PeriodicProcessor = new PeriodicProcessor(
        this.plugin,
        async () =>
            this._isThisModuleEnabled() &&
            this._isDatabaseReady() &&
            (await this.syncInternalFilesAndDatabase("push", false))
    );

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
        eventHub.onEvent(EVENT_SETTING_SAVED, () => {
            this.updateSettingCache();
        });
    }
    async $everyOnDatabaseInitialized(showNotice: boolean) {
        this.knownChanges = (await this.plugin.kvDB.get("knownChanges")) ?? {};
        if (this._isThisModuleEnabled()) {
            try {
                this._log("Synchronizing hidden files...");
                await this.syncInternalFilesAndDatabase("push", showNotice);
                this._log("Synchronizing hidden files done");
            } catch (ex) {
                this._log("Synchronizing hidden files failed");
                this._log(ex, LOG_LEVEL_VERBOSE);
            }
        }
        return true;
    }
    async $everyBeforeReplicate(showNotice: boolean) {
        if (
            this._isThisModuleEnabled() &&
            this._isDatabaseReady() &&
            this.settings.syncInternalFilesBeforeReplication &&
            !this.settings.watchInternalFileChanges
        ) {
            await this.syncInternalFilesAndDatabase("push", showNotice);
        }
        return true;
    }

    $everyOnloadAfterLoadSettings(): Promise<boolean> {
        this.updateSettingCache();
        return Promise.resolve(true);
    }
    updateSettingCache() {
        const ignorePatterns = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",")
            .filter((e) => e)
            .map((e) => new RegExp(e, "i"));
        this.ignorePatterns = ignorePatterns;
        this.shouldSkipFile = [] as FilePathWithPrefixLC[];
        // Exclude files handled by customization sync
        const configDir = normalizePath(this.app.vault.configDir);
        const shouldSKip = !this.settings.usePluginSync
            ? []
            : Object.values(this.settings.pluginSyncExtendedSetting)
                  .filter((e) => e.mode == MODE_SELECTIVE || e.mode == MODE_PAUSED)
                  .map((e) => e.files)
                  .flat()
                  .map((e) => `${configDir}/${e}`.toLowerCase());
        this.shouldSkipFile = shouldSKip as FilePathWithPrefixLC[];
        this._log(`Hidden file will skip ${this.shouldSkipFile.length} files`, LOG_LEVEL_INFO);
    }
    shouldSkipFile = [] as FilePathWithPrefixLC[];

    async $everyOnResumeProcess(): Promise<boolean> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this._isMainSuspended()) return true;
        if (this._isThisModuleEnabled()) {
            await this.syncInternalFilesAndDatabase("safe", false);
        }
        this.periodicInternalFileScanProcessor.enable(
            this._isThisModuleEnabled() && this.settings.syncInternalFilesInterval
                ? this.settings.syncInternalFilesInterval * 1000
                : 0
        );
        return true;
    }

    $everyRealizeSettingSyncMode(): Promise<boolean> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this._isMainSuspended()) return Promise.resolve(true);
        if (!this.plugin.$$isReady()) return Promise.resolve(true);
        this.periodicInternalFileScanProcessor.enable(
            this._isThisModuleEnabled() && this.settings.syncInternalFilesInterval
                ? this.settings.syncInternalFilesInterval * 1000
                : 0
        );
        const ignorePatterns = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",")
            .filter((e) => e)
            .map((e) => new RegExp(e, "i"));
        this.ignorePatterns = ignorePatterns;
        return Promise.resolve(true);
    }

    procInternalFile(filename: string) {
        this.internalFileProcessor.enqueue(filename);
    }
    internalFileProcessor = new QueueProcessor<string, any>(
        async (filenames) => {
            this._log(`START :Applying hidden ${filenames.length} files change`, LOG_LEVEL_VERBOSE);
            await this.syncInternalFilesAndDatabase("pull", false, false, filenames);
            this._log(`DONE  :Applying hidden ${filenames.length} files change`, LOG_LEVEL_VERBOSE);
            return;
        },
        {
            batchSize: 100,
            concurrentLimit: 1,
            delay: 10,
            yieldThreshold: 100,
            suspended: false,
            totalRemainingReactiveSource: hiddenFilesEventCount,
        }
    );

    async $anyProcessOptionalFileEvent(path: FilePath): Promise<boolean | undefined> {
        return await this.watchVaultRawEventsAsync(path);
    }
    async watchVaultRawEventsAsync(path: FilePath): Promise<boolean | undefined> {
        if (!this._isMainReady) return false;
        if (this._isMainSuspended()) return false;
        if (!this._isThisModuleEnabled()) return false;

        if (this.shouldSkipFile.some((e) => e.startsWith(path.toLowerCase()))) {
            this._log(`Hidden file skipped: ${path} is synchronized in customization sync.`, LOG_LEVEL_VERBOSE);
            return false;
        }

        const stat = await this.plugin.storageAccess.statHidden(path);
        // sometimes folder is coming.
        if (stat != null && stat.type != "file") {
            return false;
        }

        if (this.isKnownChange(path, stat?.mtime ?? 0)) {
            // This could be caused by self. so return true to prevent further processing.
            return true;
        }
        const mtime = stat == null ? 0 : (stat?.mtime ?? 0);
        const storageMTime = ~~(mtime / 1000);

        const prefixedFileName = addPrefix(path, ICHeader);
        const filesOnDB = await this.localDatabase.getDBEntryMeta(prefixedFileName);
        const dbMTime = ~~(((filesOnDB && filesOnDB.mtime) || 0) / 1000);

        // Skip unchanged file.
        if (dbMTime == storageMTime) {
            // this._log(`STORAGE --> DB:${path}: (hidden) Nothing changed`);
            // Handled, but nothing changed. also return true to prevent further processing.
            return true;
        }

        try {
            if (storageMTime == 0) {
                await this.deleteInternalFileOnDatabase(path);
            } else {
                await this.storeInternalFileToDatabase({
                    path: path,
                    mtime,
                    ctime: stat?.ctime ?? mtime,
                    size: stat?.size ?? 0,
                });
            }
            // Surely processed.
            return true;
        } catch (ex) {
            this._log(`Failed to process hidden file:${path}`);
            this._log(ex, LOG_LEVEL_VERBOSE);
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
                if (!("_conflicts" in doc)) continue;
                if (isInternalMetadata(doc._id)) {
                    this.conflictResolutionProcessor.enqueue(doc.path);
                }
            }
        } catch (ex) {
            this._log("something went wrong on resolving all conflicted internal files");
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        await this.conflictResolutionProcessor.startPipeline().waitForAllProcessed();
    }

    async resolveByNewerEntry(
        id: DocumentID,
        path: FilePathWithPrefix,
        currentDoc: EntryDoc,
        currentRev: string,
        conflictedRev: string
    ) {
        const conflictedDoc = await this.localDatabase.getRaw(id, { rev: conflictedRev });
        // determine which revision should been deleted.
        // simply check modified time
        const mtimeCurrent = ("mtime" in currentDoc && currentDoc.mtime) || 0;
        const mtimeConflicted = ("mtime" in conflictedDoc && conflictedDoc.mtime) || 0;
        // this._log(`Revisions:${new Date(mtimeA).toLocaleString} and ${new Date(mtimeB).toLocaleString}`);
        // console.log(`mtime:${mtimeA} - ${mtimeB}`);
        const delRev = mtimeCurrent < mtimeConflicted ? currentRev : conflictedRev;
        // delete older one.
        await this.localDatabase.removeRevision(id, delRev);
        this._log(`Older one has been deleted:${path}`);
        const cc = await this.localDatabase.getRaw(id, { conflicts: true });
        if (cc._conflicts?.length === 0) {
            await this.extractInternalFileFromDatabase(stripAllPrefixes(path));
        } else {
            this.conflictResolutionProcessor.enqueue(path);
        }
        // check the file again
    }
    conflictResolutionProcessor = new QueueProcessor(
        async (paths: FilePathWithPrefix[]) => {
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
                if (doc._conflicts.length == 0) return [];
                this._log(`Hidden file conflicted:${path}`);
                const conflicts = doc._conflicts.sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
                const revA = doc._rev;
                const revB = conflicts[0];

                if (path.endsWith(".json")) {
                    const conflictedRev = conflicts[0];
                    const conflictedRevNo = Number(conflictedRev.split("-")[0]);
                    //Search
                    const revFrom = await this.localDatabase.getRaw<EntryDoc>(id, { revs_info: true });
                    const commonBase =
                        revFrom._revs_info
                            ?.filter((e) => e.status == "available" && Number(e.rev.split("-")[0]) < conflictedRevNo)
                            .first()?.rev ?? "";
                    const result = await this.plugin.localDatabase.mergeObject(
                        path,
                        commonBase,
                        doc._rev,
                        conflictedRev
                    );
                    if (result) {
                        this._log(`Object merge:${path}`, LOG_LEVEL_INFO);
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
                        this._log(`Object merge is not applicable.`, LOG_LEVEL_VERBOSE);
                    }
                    return [{ path, revA, revB, id, doc }];
                }
                // When not JSON file, resolve conflicts by choosing a newer one.
                await this.resolveByNewerEntry(id, path, doc, revA, revB);
                return [];
            } catch (ex) {
                this._log(`Failed to resolve conflict (Hidden): ${path}`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return [];
            }
        },
        {
            suspended: false,
            batchSize: 1,
            concurrentLimit: 5,
            delay: 10,
            keepResultUntilDownstreamConnected: true,
            yieldThreshold: 10,
            pipeTo: new QueueProcessor(
                async (results) => {
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
                },
                {
                    suspended: false,
                    batchSize: 1,
                    concurrentLimit: 1,
                    delay: 10,
                    keepResultUntilDownstreamConnected: false,
                    yieldThreshold: 10,
                }
            ),
        }
    );

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
                this._log(`Skipped (Not target:${filename})`, LOG_LEVEL_VERBOSE);
                return false;
            }
        }
        return false;
    }
    queueConflictCheck(path: FilePathWithPrefix) {
        this.conflictResolutionProcessor.enqueue(path);
    }

    knownChanges: { [key: string]: number } = {};
    markAsKnownChange(path: string, mtime: number) {
        this.knownChanges[path] = mtime;
    }
    isKnownChange(path: string, mtime: number) {
        return this.knownChanges[path] == mtime;
    }
    ignorePatterns: RegExp[] = [];
    //TODO: Tidy up. Even though it is experimental feature, So dirty...
    async syncInternalFilesAndDatabase(
        direction: "push" | "pull" | "safe" | "pullForce" | "pushForce",
        showMessage: boolean,
        filesAll: InternalFileInfo[] | false = false,
        targetFilesSrc: string[] | false = false
    ) {
        const targetFiles = targetFilesSrc
            ? targetFilesSrc.map((e) => stripAllPrefixes(e as FilePathWithPrefix))
            : false;
        // debugger;
        await this.resolveConflictOnInternalFiles();
        const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
        this._log("Scanning hidden files.", logLevel, "sync_internal");

        const configDir = normalizePath(this.app.vault.configDir);
        let files: InternalFileInfo[] = filesAll ? filesAll : await this.scanInternalFiles();
        const allowedInHiddenFileSync = this.settings.usePluginSync
            ? Object.values(this.settings.pluginSyncExtendedSetting)
                  .filter((e) => e.mode == MODE_AUTOMATIC)
                  .map((e) => e.files)
                  .flat()
                  .map((e) => `${configDir}/${e}`.toLowerCase())
            : undefined;
        if (allowedInHiddenFileSync) {
            const systemOrNot = files.reduce(
                (acc, cur) => {
                    if (cur.path.startsWith(configDir)) {
                        acc.system.push(cur);
                    } else {
                        acc.user.push(cur);
                    }
                    return acc;
                },
                { system: [] as InternalFileInfo[], user: [] as InternalFileInfo[] }
            );

            files = [
                ...systemOrNot.user,
                ...systemOrNot.system.filter((file) =>
                    allowedInHiddenFileSync.some((filterFile) => file.path.toLowerCase().startsWith(filterFile))
                ),
            ];
        }

        const filesOnDB = (
            (
                await this.localDatabase.allDocsRaw({ startkey: ICHeader, endkey: ICHeaderEnd, include_docs: true })
            ).rows.map((e) => e.doc) as InternalFileEntry[]
        ).filter((e) => !e.deleted);
        const allFileNamesSrc = [
            ...new Set([
                ...files.map((e) => normalizePath(e.path)),
                ...filesOnDB.map((e) => stripAllPrefixes(this.getPath(e))),
            ]),
        ];
        let allFileNames = allFileNamesSrc.filter(
            (filename) => !targetFiles || (targetFiles && targetFiles.indexOf(filename) !== -1)
        );
        if (allowedInHiddenFileSync) {
            allFileNames = allFileNames.filter((file) =>
                allowedInHiddenFileSync.some((filterFile) => file.toLowerCase().startsWith(filterFile))
            );
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
        const updatedFolders: { [key: string]: number } = {};
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

        const filesMap = files.reduce(
            (acc, cur) => {
                acc[cur.path] = cur;
                return acc;
            },
            {} as { [key: string]: InternalFileInfo }
        );
        const filesOnDBMap = filesOnDB.reduce(
            (acc, cur) => {
                acc[stripAllPrefixes(this.getPath(cur))] = cur;
                return acc;
            },
            {} as { [key: string]: InternalFileEntry }
        );
        await new QueueProcessor(
            async (filenames: FilePath[]) => {
                const filename = filenames[0];
                processed++;
                if (processed % 100 == 0) {
                    this._log(`Hidden file: ${processed}/${fileCount}`, logLevel, "sync_internal");
                }
                if (!filename) return [];
                if (this.ignorePatterns.some((e) => filename.match(e))) return [];
                if (await this.plugin.$$isIgnoredByIgnoreFiles(filename)) {
                    return [];
                }

                const fileOnStorage = filename in filesMap ? filesMap[filename] : undefined;
                const fileOnDatabase = filename in filesOnDBMap ? filesOnDBMap[filename] : undefined;

                return [
                    {
                        filename,
                        fileOnStorage,
                        fileOnDatabase,
                    },
                ];
            },
            {
                suspended: true,
                batchSize: 1,
                concurrentLimit: 10,
                delay: 0,
                totalRemainingReactiveSource: hiddenFilesProcessingCount,
            }
        )
            .pipeTo(
                new QueueProcessor(
                    async (params) => {
                        const { filename, fileOnStorage: xFileOnStorage, fileOnDatabase: xFileOnDatabase } = params[0];
                        const xFileOnDatabaseExists =
                            xFileOnDatabase !== undefined && !(xFileOnDatabase.deleted || xFileOnDatabase._deleted);
                        if (xFileOnStorage && xFileOnDatabaseExists) {
                            // Both => Synchronize
                            if (
                                direction != "pullForce" &&
                                direction != "pushForce" &&
                                isMarkedAsSameChanges(filename, [xFileOnDatabase.mtime, xFileOnStorage.mtime]) == EVEN
                            ) {
                                this._log(`Hidden file skipped: ${filename} is marked as same`, LOG_LEVEL_VERBOSE);
                                return;
                            }

                            const nw = compareMTime(xFileOnStorage.mtime, xFileOnDatabase.mtime);
                            if (nw == BASE_IS_NEW || direction == "pushForce") {
                                if ((await this.storeInternalFileToDatabase(xFileOnStorage)) !== false) {
                                    // countUpdatedFolder(filename);
                                }
                            } else if (nw == TARGET_IS_NEW || direction == "pullForce") {
                                // skip if not extraction performed.
                                if (await this.extractInternalFileFromDatabase(filename)) countUpdatedFolder(filename);
                            } else {
                                // Even, or not forced. skip.
                            }
                        } else if (!xFileOnStorage && xFileOnDatabaseExists) {
                            if (direction == "push" || direction == "pushForce") {
                                if (xFileOnDatabase.deleted) return;
                                await this.deleteInternalFileOnDatabase(filename, false);
                            } else if (direction == "pull" || direction == "pullForce") {
                                if (await this.extractInternalFileFromDatabase(filename)) {
                                    countUpdatedFolder(filename);
                                }
                            } else if (direction == "safe") {
                                if (xFileOnDatabase.deleted) return;
                                if (await this.extractInternalFileFromDatabase(filename)) {
                                    countUpdatedFolder(filename);
                                }
                            }
                        } else if (xFileOnStorage && !xFileOnDatabaseExists) {
                            if (direction == "push" || direction == "pushForce" || direction == "safe") {
                                await this.storeInternalFileToDatabase(xFileOnStorage);
                            } else {
                                // Apply the deletion
                                if (await this.extractInternalFileFromDatabase(xFileOnStorage.path)) {
                                    countUpdatedFolder(xFileOnStorage.path);
                                }
                            }
                        } else {
                            throw new Error("Invalid state on hidden file sync");
                            // Something corrupted?
                        }
                        return;
                    },
                    { suspended: true, batchSize: 1, concurrentLimit: 5, delay: 0 }
                )
            )
            .root.enqueueAll(allFileNames)
            .startPipeline()
            .waitForAllDoneAndTerminate();

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
                    const enabledPluginManifests = manifests.filter((e) => enabledPlugins.has(e.id));
                    for (const manifest of enabledPluginManifests) {
                        if (manifest.dir && manifest.dir in updatedFolders) {
                            // If notified about plug-ins, reloading Obsidian may not be necessary.
                            updatedCount -= updatedFolders[manifest.dir];
                            const updatePluginId = manifest.id;
                            const updatePluginName = manifest.name;
                            this.plugin.confirm.askInPopup(
                                `updated-${updatePluginId}`,
                                `Files in ${updatePluginName} has been updated, Press {HERE} to reload ${updatePluginName}, or press elsewhere to dismiss this message.`,
                                (anchor) => {
                                    anchor.text = "HERE";
                                    anchor.addEventListener("click", () => {
                                        fireAndForget(async () => {
                                            this._log(
                                                `Unloading plugin: ${updatePluginName}`,
                                                LOG_LEVEL_NOTICE,
                                                "plugin-reload-" + updatePluginId
                                            );
                                            // @ts-ignore
                                            await this.app.plugins.unloadPlugin(updatePluginId);
                                            // @ts-ignore
                                            await this.app.plugins.loadPlugin(updatePluginId);
                                            this._log(
                                                `Plugin reloaded: ${updatePluginName}`,
                                                LOG_LEVEL_NOTICE,
                                                "plugin-reload-" + updatePluginId
                                            );
                                        });
                                    });
                                }
                            );
                        }
                    }
                } catch (ex) {
                    this._log("Error on checking plugin status.");
                    this._log(ex, LOG_LEVEL_VERBOSE);
                }

                // If something changes left, notify for reloading Obsidian.
                if (updatedCount != 0) {
                    if (!this.plugin.$$isReloadingScheduled()) {
                        this.plugin.confirm.askInPopup(
                            `updated-any-hidden`,
                            `Hidden files have been synchronised, Press {HERE} to schedule a reload of Obsidian, or press elsewhere to dismiss this message.`,
                            (anchor) => {
                                anchor.text = "HERE";
                                anchor.addEventListener("click", () => {
                                    this.plugin.$$scheduleAppReload();
                                });
                            }
                        );
                    }
                }
            }
        }

        this._log(`Hidden files scanned: ${filesChanged} files had been modified`, logLevel, "sync_internal");
    }

    async storeInternalFileToDatabase(file: InternalFileInfo, forceWrite = false) {
        const storeFilePath = file.path;
        const storageFilePath = file.path;
        if (await this.plugin.$$isIgnoredByIgnoreFiles(storageFilePath)) {
            return undefined;
        }

        const id = await this.path2id(storeFilePath, ICHeader);
        const prefixedFileName = addPrefix(storeFilePath, ICHeader);
        const content = createBlob(await this.plugin.storageAccess.readHiddenFileAuto(storageFilePath));
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
                    if ((await isDocContentSame(readAsBlob(old), content)) && !forceWrite) {
                        // this._log(`STORAGE --> DB:${file.path}: (hidden) Not changed`, LOG_LEVEL_VERBOSE);
                        const stat = await this.plugin.storageAccess.statHidden(storageFilePath);
                        if (stat) {
                            markChangesAreSame(storageFilePath, old.mtime, stat.mtime);
                        }
                        return undefined;
                    }
                    saveData = {
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
                if (ret !== false) {
                    this._log(`STORAGE --> DB:${storageFilePath}: (hidden) Done`);
                    return true;
                } else {
                    this._log(`STORAGE --> DB:${storageFilePath}: (hidden) Failed`);
                    return false;
                }
            } catch (ex) {
                this._log(`STORAGE --> DB:${storageFilePath}: (hidden) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    async deleteInternalFileOnDatabase(filenameSrc: FilePath, forceWrite = false) {
        const storeFilePath = filenameSrc;
        const storageFilePath = filenameSrc;
        const displayFileName = filenameSrc;
        const id = await this.path2id(storeFilePath, ICHeader);
        const prefixedFileName = addPrefix(storeFilePath, ICHeader);
        const mtime = new Date().getTime();
        if (await this.plugin.$$isIgnoredByIgnoreFiles(storageFilePath)) {
            return undefined;
        }
        return await serialized("file-" + prefixedFileName, async () => {
            try {
                const old = (await this.localDatabase.getDBEntryMeta(prefixedFileName, undefined, true)) as
                    | InternalFileEntry
                    | false;
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
                        eden: {},
                    };
                } else {
                    // Remove all conflicted before deleting.
                    const conflicts = await this.localDatabase.getRaw(old._id, { conflicts: true });
                    if (conflicts._conflicts !== undefined) {
                        for (const conflictRev of conflicts._conflicts) {
                            await this.localDatabase.removeRevision(old._id, conflictRev);
                            this._log(
                                `STORAGE -x> DB: ${displayFileName}: (hidden) conflict removed ${old._rev} =>  ${conflictRev}`,
                                LOG_LEVEL_VERBOSE
                            );
                        }
                    }
                    if (old.deleted) {
                        this._log(`STORAGE -x> DB: ${displayFileName}: (hidden) already deleted`);
                        return undefined;
                    }
                    saveData = {
                        ...old,
                        mtime,
                        size: 0,
                        children: [],
                        deleted: true,
                        type: "newnote",
                    };
                }
                const ret = await this.localDatabase.putRaw(saveData);
                if (ret && ret.ok) {
                    this._log(`STORAGE -x> DB: ${displayFileName}: (hidden) Done`);
                    return true;
                } else {
                    this._log(`STORAGE -x> DB: ${displayFileName}: (hidden) Failed`);
                    return false;
                }
            } catch (ex) {
                this._log(`STORAGE -x> DB: ${displayFileName}: (hidden) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    async extractInternalFileFromDatabase(filenameSrc: FilePath, force = false) {
        const storeFilePath = filenameSrc;
        const storageFilePath = filenameSrc;
        const isExists = await this.plugin.storageAccess.isExistsIncludeHidden(storageFilePath);
        const prefixedFileName = addPrefix(storeFilePath, ICHeader);
        const displayFileName = `${storeFilePath}`;
        if (await this.plugin.$$isIgnoredByIgnoreFiles(storageFilePath)) {
            return undefined;
        }
        return await serialized("file-" + prefixedFileName, async () => {
            try {
                // Check conflicted status
                const fileOnDB = await this.localDatabase.getDBEntry(
                    prefixedFileName,
                    { conflicts: true },
                    false,
                    true,
                    true
                );
                if (fileOnDB === false) throw new Error(`File not found on database.:${displayFileName}`);
                // Prevent overwrite for Prevent overwriting while some conflicted revision exists.
                if (fileOnDB?._conflicts?.length) {
                    this._log(
                        `Hidden file ${displayFileName} has conflicted revisions, to keep in safe, writing to storage has been prevented`,
                        LOG_LEVEL_INFO
                    );
                    return false;
                }
                const deleted = fileOnDB.deleted || fileOnDB._deleted || false;
                if (deleted) {
                    if (!isExists) {
                        this._log(
                            `STORAGE <x- DB: ${displayFileName}: deleted (hidden) Deleted on DB, but the file is already not found on storage.`
                        );
                    } else {
                        this._log(`STORAGE <x- DB: ${displayFileName}: deleted (hidden).`);
                        if (await this.plugin.storageAccess.removeHidden(storageFilePath)) {
                            try {
                                await this.plugin.storageAccess.triggerHiddenFile(storageFilePath);
                            } catch (ex) {
                                this._log("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
                                this._log(ex, LOG_LEVEL_VERBOSE);
                            }
                        } else {
                            this._log(`STORAGE <x- DB: ${storageFilePath}: deleted (hidden) Failed`);
                            return false;
                        }
                    }
                    return true;
                }
                if (!isExists) {
                    await this.plugin.storageAccess.ensureDir(storageFilePath);
                    await this.plugin.storageAccess.writeHiddenFileAuto(storageFilePath, readContent(fileOnDB), {
                        mtime: fileOnDB.mtime,
                        ctime: fileOnDB.ctime,
                    });
                    try {
                        await this.plugin.storageAccess.triggerHiddenFile(storageFilePath);
                    } catch (ex) {
                        this._log("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
                        this._log(ex, LOG_LEVEL_VERBOSE);
                    }
                    this._log(`STORAGE <-- DB: ${displayFileName}: written (hidden,new${force ? ", force" : ""})`);
                    return true;
                } else {
                    const content = await this.plugin.storageAccess.readHiddenFileAuto(storageFilePath);
                    const docContent = readContent(fileOnDB);
                    if ((await isDocContentSame(content, docContent)) && !force) {
                        // this._log(`STORAGE <-- DB:${filename}: skipped (hidden) Not changed`, LOG_LEVEL_VERBOSE);
                        const stat = await this.plugin.storageAccess.statHidden(storageFilePath);
                        if (stat) {
                            markChangesAreSame(storageFilePath, fileOnDB.mtime, stat.mtime);
                        }
                        return undefined;
                    }
                    if (
                        await this.plugin.storageAccess.writeHiddenFileAuto(storageFilePath, docContent, {
                            mtime: fileOnDB.mtime,
                            ctime: fileOnDB.ctime,
                        })
                    ) {
                        const stat = (await this.plugin.storageAccess.statHidden(storageFilePath)) as UXStat;
                        this.markAsKnownChange(storageFilePath, stat.mtime);
                        try {
                            // await this.app.vault.adapter.reconcileInternalFile(filename);
                            await this.plugin.storageAccess.triggerHiddenFile(storageFilePath);
                        } catch (ex) {
                            this._log("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
                            this._log(ex, LOG_LEVEL_VERBOSE);
                        }
                        this._log(
                            `STORAGE <-- DB: ${displayFileName}: written (hidden, overwrite${force ? ", force" : ""})`
                        );

                        return true;
                    } else {
                        this._log(
                            `STORAGE <-- DB: ${displayFileName}: written (hidden, overwrite${force ? ", force" : ""}) Failed`
                        );
                        return false;
                    }
                }
            } catch (ex) {
                this._log(
                    `STORAGE <-- DB: ${displayFileName}: written (hidden, overwrite${force ? ", force" : ""}) Failed`
                );
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    showJSONMergeDialogAndMerge(docA: LoadedEntry, docB: LoadedEntry): Promise<boolean> {
        return new Promise((res) => {
            this._log("Opening data-merging dialog", LOG_LEVEL_VERBOSE);
            const docs = [docA, docB];
            const strippedPath = stripAllPrefixes(docA.path);
            const storageFilePath = strippedPath;
            const storeFilePath = strippedPath;
            const displayFilename = `${storeFilePath}`;
            // const path = this.prefixedConfigDir2configDir(stripAllPrefixes(docA.path)) || docA.path;
            const modal = new JsonResolveModal(this.app, storageFilePath, [docA, docB], async (keep, result) => {
                // modal.close();
                try {
                    // const filename = storeFilePath;
                    let needFlush = false;
                    if (!result && !keep) {
                        this._log(`Skipped merging: ${displayFilename}`);
                        res(false);
                        return;
                    }
                    //Delete old revisions
                    if (result || keep) {
                        for (const doc of docs) {
                            if (doc._rev != keep) {
                                if (await this.localDatabase.deleteDBEntry(this.getPath(doc), { rev: doc._rev })) {
                                    this._log(`Conflicted revision has been deleted: ${displayFilename}`);
                                    needFlush = true;
                                }
                            }
                        }
                    }
                    if (!keep && result) {
                        const isExists = await this.plugin.storageAccess.isExistsIncludeHidden(storageFilePath);
                        if (!isExists) {
                            await this.plugin.storageAccess.ensureDir(storageFilePath);
                        }
                        await this.plugin.storageAccess.writeHiddenFileAuto(storageFilePath, result);
                        const stat = await this.plugin.storageAccess.statHidden(storageFilePath);
                        if (!stat) {
                            throw new Error("Stat failed");
                        }
                        const mtime = stat?.mtime ?? 0;
                        await this.storeInternalFileToDatabase(
                            { path: storageFilePath, mtime, ctime: stat?.ctime ?? mtime, size: stat?.size ?? 0 },
                            true
                        );
                        try {
                            //@ts-ignore internalAPI
                            await this.app.vault.adapter.reconcileInternalFile(storageFilePath);
                        } catch (ex) {
                            this._log("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
                            this._log(ex, LOG_LEVEL_VERBOSE);
                        }
                        this._log(`STORAGE <-- DB:${displayFilename}: written (hidden,merged)`);
                    }
                    if (needFlush) {
                        if (await this.extractInternalFileFromDatabase(storeFilePath, false)) {
                            this._log(`STORAGE --> DB:${displayFilename}: extracted (hidden,merged)`);
                        } else {
                            this._log(`STORAGE --> DB:${displayFilename}: extracted (hidden,merged) Failed`);
                        }
                    }
                    res(true);
                } catch (ex) {
                    this._log("Could not merge conflicted json");
                    this._log(ex, LOG_LEVEL_VERBOSE);
                    res(false);
                }
            });
            modal.open();
        });
    }

    async $allAskUsingOptionalSyncFeature(opt: { enableFetch?: boolean; enableOverwrite?: boolean }) {
        await this._askHiddenFileConfiguration(opt);
        return true;
    }
    async _askHiddenFileConfiguration(opt: { enableFetch?: boolean; enableOverwrite?: boolean }) {
        const messageFetch = `${opt.enableFetch ? `> - Fetch: Use the files stored from other devices. Choose this option if you have already configured hidden file synchronization on those devices and wish to accept their files.\n` : ""}`;
        const messageOverwrite = `${opt.enableOverwrite ? `> - Overwrite: Use the files from this device. Select this option if you want to overwrite the files stored on other devices.\n` : ""}`;
        const messageMerge = `> - Merge: Merge the files from this device with those on other devices. Choose this option if you wish to combine files from multiple sources.
>  However, please be reminded that merging may cause conflicts if the files are not identical. Additionally, this process may occur within the same folder, potentially breaking your plug-in or theme settings that comprise multiple files.\n`;
        const message = `Would you like to enable **Hidden File Synchronization**?

> [!DETAILS]-
> This feature allows you to synchronize all hidden files without any user interaction.
> To enable this feature, you should choose one of the following options:
${messageFetch}${messageOverwrite}${messageMerge}

> [!IMPORTANT]
> Please keep in mind that enabling this feature alongside customisation sync may override certain behaviors.`;
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

        const ret = await this.plugin.confirm.confirmWithMessage(
            "Hidden file sync",
            message,
            choices,
            CHOICE_DISABLE,
            40
        );
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
            this._log(
                "Hidden file synchronization have been temporarily disabled. Please enable them after the fetching, if you need them.",
                LOG_LEVEL_NOTICE
            );
            this.plugin.settings.syncInternalFiles = false;
        }
        return Promise.resolve(true);
    }

    async $anyConfigureOptionalSyncFeature(mode: "FETCH" | "OVERWRITE" | "MERGE" | "DISABLE" | "DISABLE_HIDDEN") {
        await this.configureHiddenFileSync(mode);
    }

    async configureHiddenFileSync(mode: "FETCH" | "OVERWRITE" | "MERGE" | "DISABLE" | "DISABLE_HIDDEN") {
        if (
            mode != "FETCH" &&
            mode != "OVERWRITE" &&
            mode != "MERGE" &&
            mode != "DISABLE" &&
            mode != "DISABLE_HIDDEN"
        ) {
            return;
        }

        if (mode == "DISABLE" || mode == "DISABLE_HIDDEN") {
            // await this.plugin.$allSuspendExtraSync();
            this.plugin.settings.syncInternalFiles = false;
            await this.plugin.saveSettings();
            return;
        }
        this._log("Gathering files for enabling Hidden File Sync", LOG_LEVEL_NOTICE);
        if (mode == "FETCH") {
            await this.syncInternalFilesAndDatabase("pullForce", true);
        } else if (mode == "OVERWRITE") {
            await this.syncInternalFilesAndDatabase("pushForce", true);
        } else if (mode == "MERGE") {
            await this.syncInternalFilesAndDatabase("safe", true);
        }
        this.plugin.settings.useAdvancedMode = true;
        this.plugin.settings.syncInternalFiles = true;
        await this.plugin.saveSettings();
        this._log(`Done! Restarting the app is strongly recommended!`, LOG_LEVEL_NOTICE);
    }
    async scanInternalFiles(): Promise<InternalFileInfo[]> {
        const configDir = normalizePath(this.app.vault.configDir);
        const ignoreFilter = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",")
            .filter((e) => e)
            .map((e) => new RegExp(e, "i"));
        const synchronisedInConfigSync = !this.settings.usePluginSync
            ? []
            : Object.values(this.settings.pluginSyncExtendedSetting)
                  .filter((e) => e.mode == MODE_SELECTIVE || e.mode == MODE_PAUSED)
                  .map((e) => e.files)
                  .flat()
                  .map((e) => `${configDir}/${e}`.toLowerCase());
        const root = this.app.vault.getRoot();
        const findRoot = root.path;

        const filenames = (await this.getFiles(findRoot, [], undefined, ignoreFilter))
            .filter((e) => e.startsWith("."))
            .filter((e) => !e.startsWith(".trash"));
        const files = filenames
            .filter((path) =>
                synchronisedInConfigSync.every((filterFile) => !path.toLowerCase().startsWith(filterFile))
            )
            .map(async (e) => {
                return {
                    path: e as FilePath,
                    stat: await this.plugin.storageAccess.statHidden(e), // this.plugin.vaultAccess.adapterStat(e)
                };
            });
        const result: InternalFileInfo[] = [];
        for (const f of files) {
            const w = await f;
            if (await this.plugin.$$isIgnoredByIgnoreFiles(w.path)) {
                continue;
            }
            const mtime = w.stat?.mtime ?? 0;
            const ctime = w.stat?.ctime ?? mtime;
            const size = w.stat?.size ?? 0;
            result.push({
                ...w,
                mtime,
                ctime,
                size,
            });
        }
        return result;
    }

    async getFiles(path: string, ignoreList: string[], filter?: RegExp[], ignoreFilter?: RegExp[]) {
        let w: ListedFiles;
        try {
            w = await this.app.vault.adapter.list(path);
        } catch (ex) {
            this._log(`Could not traverse(HiddenSync):${path}`, LOG_LEVEL_INFO);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return [];
        }
        const filesSrc = [
            ...w.files
                .filter((e) => !ignoreList.some((ee) => e.endsWith(ee)))
                .filter((e) => !filter || filter.some((ee) => e.match(ee)))
                .filter((e) => !ignoreFilter || ignoreFilter.every((ee) => !e.match(ee))),
        ];
        let files = [] as string[];
        for (const file of filesSrc) {
            if (!(await this.plugin.$$isIgnoredByIgnoreFiles(file))) {
                files.push(file);
            }
        }

        L1: for (const v of w.folders) {
            for (const ignore of ignoreList) {
                if (v.endsWith(ignore)) {
                    continue L1;
                }
            }
            if (ignoreFilter && ignoreFilter.some((e) => v.match(e))) {
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
