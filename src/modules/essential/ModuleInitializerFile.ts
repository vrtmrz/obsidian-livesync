import { unique } from "octagonal-wheels/collection";
import { throttle } from "octagonal-wheels/function";
import { eventHub } from "../../common/events.ts";
import { BASE_IS_NEW, compareFileFreshness, EVEN, getPath, isValidPath, TARGET_IS_NEW } from "../../common/utils.ts";
import {
    type FilePathWithPrefixLC,
    type FilePathWithPrefix,
    type MetaEntry,
    isMetaEntry,
    type EntryDoc,
    LOG_LEVEL_VERBOSE,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_INFO,
    LOG_LEVEL_DEBUG,
    type UXFileInfoStub,
} from "../../lib/src/common/types.ts";
import { isAnyNote } from "../../lib/src/common/utils.ts";
import { stripAllPrefixes } from "../../lib/src/string_and_binary/path.ts";
import { AbstractModule } from "../AbstractModule.ts";
import { withConcurrency } from "octagonal-wheels/iterable/map";
import type { InjectableServiceHub } from "../../lib/src/services/InjectableServices.ts";
import type { LiveSyncCore } from "../../main.ts";
export class ModuleInitializerFile extends AbstractModule {
    private async _performFullScan(showingNotice?: boolean, ignoreSuspending: boolean = false): Promise<boolean> {
        this._log("Opening the key-value database", LOG_LEVEL_VERBOSE);
        const isInitialized = (await this.core.kvDB.get<boolean>("initialized")) || false;
        // synchronize all files between database and storage.
        if (!this.settings.isConfigured) {
            if (showingNotice) {
                this._log(
                    "LiveSync is not configured yet. Synchronising between the storage and the local database is now prevented.",
                    LOG_LEVEL_NOTICE,
                    "syncAll"
                );
            }
            return false;
        }
        if (!ignoreSuspending && this.settings.suspendFileWatching) {
            if (showingNotice) {
                this._log(
                    "Now suspending file watching. Synchronising between the storage and the local database is now prevented.",
                    LOG_LEVEL_NOTICE,
                    "syncAll"
                );
            }
            return false;
        }

        if (showingNotice) {
            this._log("Initializing", LOG_LEVEL_NOTICE, "syncAll");
        }

        this._log("Initialize and checking database files");
        this._log("Checking deleted files");
        await this.collectDeletedFiles();

        this._log("Collecting local files on the storage", LOG_LEVEL_VERBOSE);
        const filesStorageSrc = this.core.storageAccess.getFiles();

        const _filesStorage = [] as typeof filesStorageSrc;

        for (const f of filesStorageSrc) {
            if (await this.services.vault.isTargetFile(f.path, f != filesStorageSrc[0])) {
                _filesStorage.push(f);
            }
        }

        const convertCase = <FilePathWithPrefix>(path: FilePathWithPrefix): FilePathWithPrefixLC => {
            if (this.settings.handleFilenameCaseSensitive) {
                return path as FilePathWithPrefixLC;
            }
            return (path as string).toLowerCase() as FilePathWithPrefixLC;
        };

        // If handleFilenameCaseSensitive is enabled, `FilePathWithPrefixLC` is the same as `FilePathWithPrefix`.

        const storageFileNameMap = Object.fromEntries(
            _filesStorage.map((e) => [e.path, e] as [FilePathWithPrefix, UXFileInfoStub])
        );

        const storageFileNames = Object.keys(storageFileNameMap) as FilePathWithPrefix[];

        const storageFileNameCapsPair = storageFileNames.map(
            (e) => [e, convertCase(e)] as [FilePathWithPrefix, FilePathWithPrefixLC]
        );

        // const storageFileNameCS2CI = Object.fromEntries(storageFileNameCapsPair) as Record<FilePathWithPrefix, FilePathWithPrefixLC>;
        const storageFileNameCI2CS = Object.fromEntries(storageFileNameCapsPair.map((e) => [e[1], e[0]])) as Record<
            FilePathWithPrefixLC,
            FilePathWithPrefix
        >;

        this._log("Collecting local files on the DB", LOG_LEVEL_VERBOSE);
        const _DBEntries = [] as MetaEntry[];
        let count = 0;
        // Fetch all documents from the database (including conflicts to prevent overwriting).
        for await (const doc of this.localDatabase.findAllNormalDocs({ conflicts: true })) {
            count++;
            if (count % 25 == 0)
                this._log(
                    `Collecting local files on the DB: ${count}`,
                    showingNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
                    "syncAll"
                );
            const path = getPath(doc);

            if (isValidPath(path) && (await this.services.vault.isTargetFile(path, true))) {
                if (!isMetaEntry(doc)) {
                    this._log(`Invalid entry: ${path}`, LOG_LEVEL_INFO);
                    continue;
                }
                _DBEntries.push(doc);
            }
        }

        const databaseFileNameMap = Object.fromEntries(
            _DBEntries.map((e) => [getPath(e), e] as [FilePathWithPrefix, MetaEntry])
        );
        const databaseFileNames = Object.keys(databaseFileNameMap) as FilePathWithPrefix[];
        const databaseFileNameCapsPair = databaseFileNames.map(
            (e) => [e, convertCase(e)] as [FilePathWithPrefix, FilePathWithPrefixLC]
        );
        // const databaseFileNameCS2CI = Object.fromEntries(databaseFileNameCapsPair) as Record<FilePathWithPrefix, FilePathWithPrefixLC>;
        const databaseFileNameCI2CS = Object.fromEntries(databaseFileNameCapsPair.map((e) => [e[1], e[0]])) as Record<
            FilePathWithPrefix,
            FilePathWithPrefixLC
        >;

        const allFiles = unique([
            ...Object.keys(databaseFileNameCI2CS),
            ...Object.keys(storageFileNameCI2CS),
        ]) as FilePathWithPrefixLC[];

        this._log(`Total files in the database: ${databaseFileNames.length}`, LOG_LEVEL_VERBOSE, "syncAll");
        this._log(`Total files in the storage: ${storageFileNames.length}`, LOG_LEVEL_VERBOSE, "syncAll");
        this._log(`Total files: ${allFiles.length}`, LOG_LEVEL_VERBOSE, "syncAll");
        const filesExistOnlyInStorage = allFiles.filter((e) => !databaseFileNameCI2CS[e]);
        const filesExistOnlyInDatabase = allFiles.filter((e) => !storageFileNameCI2CS[e]);
        const filesExistBoth = allFiles.filter((e) => databaseFileNameCI2CS[e] && storageFileNameCI2CS[e]);

        this._log(`Files exist only in storage: ${filesExistOnlyInStorage.length}`, LOG_LEVEL_VERBOSE, "syncAll");
        this._log(`Files exist only in database: ${filesExistOnlyInDatabase.length}`, LOG_LEVEL_VERBOSE, "syncAll");
        this._log(`Files exist both in storage and database: ${filesExistBoth.length}`, LOG_LEVEL_VERBOSE, "syncAll");

        this._log("Synchronising...");
        const processStatus = {} as Record<string, string>;
        const logLevel = showingNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
        const updateLog = throttle((key: string, msg: string) => {
            processStatus[key] = msg;
            const log = Object.values(processStatus).join("\n");
            this._log(log, logLevel, "syncAll");
        }, 25);

        const initProcess = [];
        const runAll = async <T>(procedureName: string, objects: T[], callback: (arg: T) => Promise<void>) => {
            if (objects.length == 0) {
                this._log(`${procedureName}: Nothing to do`);
                return;
            }
            this._log(procedureName);
            if (!this.localDatabase.isReady) throw Error("Database is not ready!");
            let success = 0;
            let failed = 0;
            let total = 0;
            for await (const result of withConcurrency(
                objects,
                async (e) => {
                    try {
                        await callback(e);
                        return true;
                    } catch (ex) {
                        this._log(`Error while ${procedureName}`, LOG_LEVEL_NOTICE);
                        this._log(ex, LOG_LEVEL_VERBOSE);
                        return false;
                    }
                },
                10
            )) {
                if (result) {
                    success++;
                } else {
                    failed++;
                }
                total++;
                const msg = `${procedureName}: DONE:${success}, FAILED:${failed}, LAST:${objects.length - total}`;
                updateLog(procedureName, msg);
            }
            const msg = `${procedureName} All done: DONE:${success}, FAILED:${failed}`;
            updateLog(procedureName, msg);
        };
        initProcess.push(
            runAll("UPDATE DATABASE", filesExistOnlyInStorage, async (e) => {
                // Exists in storage but not in database.
                const file = storageFileNameMap[storageFileNameCI2CS[e]];
                if (!this.services.vault.isFileSizeTooLarge(file.stat.size)) {
                    const path = file.path;
                    await this.core.fileHandler.storeFileToDB(file);
                    // fireAndForget(() => this.checkAndApplySettingFromMarkdown(path, true));
                    eventHub.emitEvent("event-file-changed", { file: path, automated: true });
                } else {
                    this._log(`UPDATE DATABASE: ${e} has been skipped due to file size exceeding the limit`, logLevel);
                }
            })
        );
        initProcess.push(
            runAll("UPDATE STORAGE", filesExistOnlyInDatabase, async (e) => {
                const w = databaseFileNameMap[databaseFileNameCI2CS[e]];
                // Exists in database but not in storage.
                const path = getPath(w) ?? e;
                if (w && !(w.deleted || w._deleted)) {
                    if (!this.services.vault.isFileSizeTooLarge(w.size)) {
                        // Prevent applying the conflicted state to the storage.
                        if (w._conflicts?.length ?? 0 > 0) {
                            this._log(`UPDATE STORAGE: ${path} has conflicts. skipped (x)`, LOG_LEVEL_INFO);
                            return;
                        }
                        // await this.pullFile(path, undefined, false, undefined, false);
                        // Memo: No need to force
                        await this.core.fileHandler.dbToStorage(path, null, true);
                        // fireAndForget(() => this.checkAndApplySettingFromMarkdown(e, true));
                        eventHub.emitEvent("event-file-changed", {
                            file: e,
                            automated: true,
                        });
                        this._log(`Check or pull from db:${path} OK`);
                    } else {
                        this._log(
                            `UPDATE STORAGE: ${path} has been skipped due to file size exceeding the limit`,
                            logLevel
                        );
                    }
                } else if (w) {
                    this._log(`Deletion history skipped: ${path}`, LOG_LEVEL_VERBOSE);
                } else {
                    this._log(`entry not found: ${path}`);
                }
            })
        );

        const fileMap = filesExistBoth.map((path) => {
            const file = storageFileNameMap[storageFileNameCI2CS[path]];
            const doc = databaseFileNameMap[databaseFileNameCI2CS[path]];
            return { file, doc };
        });
        initProcess.push(
            runAll("SYNC DATABASE AND STORAGE", fileMap, async (e) => {
                const { file, doc } = e;
                // Prevent applying the conflicted state to the storage.
                if (doc._conflicts?.length ?? 0 > 0) {
                    this._log(`SYNC DATABASE AND STORAGE: ${file.path} has conflicts. skipped`, LOG_LEVEL_INFO);
                    return;
                }
                if (
                    !this.services.vault.isFileSizeTooLarge(file.stat.size) &&
                    !this.services.vault.isFileSizeTooLarge(doc.size)
                ) {
                    await this.syncFileBetweenDBandStorage(file, doc);
                } else {
                    this._log(
                        `SYNC DATABASE AND STORAGE: ${getPath(doc)} has been skipped due to file size exceeding the limit`,
                        logLevel
                    );
                }
            })
        );

        await Promise.all(initProcess);

        // this.setStatusBarText(`NOW TRACKING!`);
        this._log("Initialized, NOW TRACKING!");
        if (!isInitialized) {
            await this.core.kvDB.set("initialized", true);
        }
        if (showingNotice) {
            this._log("Initialize done!", LOG_LEVEL_NOTICE, "syncAll");
        }
        return true;
    }

    async syncFileBetweenDBandStorage(file: UXFileInfoStub, doc: MetaEntry) {
        if (!doc) {
            throw new Error(`Missing doc:${(file as any).path}`);
        }
        if ("path" in file) {
            const w = this.core.storageAccess.getFileStub((file as any).path);
            if (w) {
                file = w;
            } else {
                throw new Error(`Missing file:${(file as any).path}`);
            }
        }

        const compareResult = compareFileFreshness(file, doc);
        switch (compareResult) {
            case BASE_IS_NEW:
                if (!this.services.vault.isFileSizeTooLarge(file.stat.size)) {
                    this._log("STORAGE -> DB :" + file.path);
                    await this.core.fileHandler.storeFileToDB(file);
                } else {
                    this._log(
                        `STORAGE -> DB : ${file.path} has been skipped due to file size exceeding the limit`,
                        LOG_LEVEL_NOTICE
                    );
                }
                break;
            case TARGET_IS_NEW:
                if (!this.services.vault.isFileSizeTooLarge(doc.size)) {
                    this._log("STORAGE <- DB :" + file.path);
                    if (await this.core.fileHandler.dbToStorage(doc, stripAllPrefixes(file.path), true)) {
                        eventHub.emitEvent("event-file-changed", {
                            file: file.path,
                            automated: true,
                        });
                    } else {
                        this._log(`STORAGE <- DB : Cloud not read ${file.path}, possibly deleted`, LOG_LEVEL_NOTICE);
                    }
                    return caches;
                } else {
                    this._log(
                        `STORAGE <- DB : ${file.path} has been skipped due to file size exceeding the limit`,
                        LOG_LEVEL_NOTICE
                    );
                }
                break;
            case EVEN:
                this._log("STORAGE == DB :" + file.path + "", LOG_LEVEL_DEBUG);
                break;
            default:
                this._log("STORAGE ?? DB :" + file.path + " Something got weird");
        }
    }

    // This method uses an old version of database accessor, which is not recommended.
    // TODO: Fix
    async collectDeletedFiles() {
        const limitDays = this.settings.automaticallyDeleteMetadataOfDeletedFiles;
        if (limitDays <= 0) return;
        this._log(`Checking expired file history`);
        const limit = Date.now() - 86400 * 1000 * limitDays;
        const notes: {
            path: string;
            mtime: number;
            ttl: number;
            doc: PouchDB.Core.ExistingDocument<EntryDoc & PouchDB.Core.AllDocsMeta>;
        }[] = [];
        for await (const doc of this.localDatabase.findAllDocs({ conflicts: true })) {
            if (isAnyNote(doc)) {
                if (doc.deleted && doc.mtime - limit < 0) {
                    notes.push({
                        path: getPath(doc),
                        mtime: doc.mtime,
                        ttl: (doc.mtime - limit) / 1000 / 86400,
                        doc: doc,
                    });
                }
            }
        }
        if (notes.length == 0) {
            this._log("There are no old documents");
            this._log(`Checking expired file history done`);
            return;
        }
        for (const v of notes) {
            this._log(`Deletion history expired: ${v.path}`);
            const delDoc = v.doc;
            delDoc._deleted = true;
            await this.localDatabase.putRaw(delDoc);
        }
        this._log(`Checking expired file history done`);
    }

    private async _initializeDatabase(
        showingNotice: boolean = false,
        reopenDatabase = true,
        ignoreSuspending: boolean = false
    ): Promise<boolean> {
        this.services.appLifecycle.resetIsReady();
        if (!reopenDatabase || (await this.services.database.openDatabase())) {
            if (this.localDatabase.isReady) {
                await this.services.vault.scanVault(showingNotice, ignoreSuspending);
            }
            if (!(await this.services.databaseEvents.onDatabaseInitialised(showingNotice))) {
                this._log(`Initializing database has been failed on some module!`, LOG_LEVEL_NOTICE);
                return false;
            }
            this.services.appLifecycle.markIsReady();
            // run queued event once.
            await this.services.fileProcessing.commitPendingFileEvents();
            return true;
        } else {
            this.services.appLifecycle.resetIsReady();
            return false;
        }
    }
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void {
        services.databaseEvents.handleInitialiseDatabase(this._initializeDatabase.bind(this));
        services.vault.handleScanVault(this._performFullScan.bind(this));
    }
}
