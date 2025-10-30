import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { serialized } from "octagonal-wheels/concurrency/lock";
import type { FileEventItem } from "../../common/types";
import type {
    FilePath,
    FilePathWithPrefix,
    MetaEntry,
    UXFileInfo,
    UXFileInfoStub,
    UXInternalFileInfoStub,
} from "../../lib/src/common/types";
import { AbstractModule } from "../AbstractModule.ts";
import {
    compareFileFreshness,
    EVEN,
    getPath,
    getPathWithoutPrefix,
    getStoragePathFromUXFileInfo,
    markChangesAreSame,
} from "../../common/utils";
import { getDocDataAsArray, isDocContentSame, readAsBlob, readContent } from "../../lib/src/common/utils";
import { shouldBeIgnored } from "../../lib/src/string_and_binary/path";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { eventHub } from "../../common/events.ts";
import type { LiveSyncCore } from "../../main.ts";

export class ModuleFileHandler extends AbstractModule {
    get db() {
        return this.core.databaseFileAccess;
    }
    get storage() {
        return this.core.storageAccess;
    }

    _everyOnloadStart(): Promise<boolean> {
        this.core.fileHandler = this;
        return Promise.resolve(true);
    }

    async readFileFromStub(file: UXFileInfoStub | UXFileInfo) {
        if ("body" in file && file.body) {
            return file;
        }
        const readFile = await this.storage.readStubContent(file);
        if (!readFile) {
            throw new Error(`File ${file.path} is not exist on the storage`);
        }
        return readFile;
    }

    async storeFileToDB(
        info: UXFileInfoStub | UXFileInfo | UXInternalFileInfoStub | FilePathWithPrefix,
        force: boolean = false,
        onlyChunks: boolean = false
    ): Promise<boolean> {
        const file = typeof info === "string" ? this.storage.getFileStub(info) : info;
        if (file == null) {
            this._log(`File ${info} is not exist on the storage`, LOG_LEVEL_VERBOSE);
            return false;
        }
        // const file = item.args.file;
        if (file.isInternal) {
            this._log(
                `Internal file ${file.path} is not allowed to be processed on processFileEvent`,
                LOG_LEVEL_VERBOSE
            );
            return false;
        }
        // First, check the file on the database
        const entry = await this.db.fetchEntry(file, undefined, true, true);

        if (!entry || entry.deleted || entry._deleted) {
            // If the file is not exist on the database, then it should be created.
            const readFile = await this.readFileFromStub(file);
            if (!onlyChunks) {
                return await this.db.store(readFile);
            } else {
                return await this.db.createChunks(readFile, false, true);
            }
        }

        // entry is exist on the database, check the difference between the file and the entry.

        let shouldApplied = false;
        if (!force && !onlyChunks) {
            // 1. if the time stamp is far different, then it should be updated.
            // Note: This checks only the mtime with the resolution reduced to 2 seconds.
            //       2 seconds it for the ZIP file's mtime. If not, we cannot backup the vault as the ZIP file.
            //       This is hardcoded on `compareMtime` of `src/common/utils.ts`.
            if (compareFileFreshness(file, entry) !== EVEN) {
                shouldApplied = true;
            }
            // 2. if not, the content should be checked.
            let readFile: UXFileInfo | undefined = undefined;
            if (!shouldApplied) {
                readFile = await this.readFileFromStub(file);
                if (!readFile) {
                    this._log(`File ${file.path} is not exist on the storage`, LOG_LEVEL_NOTICE);
                    return false;
                }
                if (await isDocContentSame(getDocDataAsArray(entry.data), readFile.body)) {
                    // Timestamp is different but the content is same. therefore, two timestamps should be handled as same.
                    // So, mark the changes are same.
                    markChangesAreSame(readFile, readFile.stat.mtime, entry.mtime);
                } else {
                    shouldApplied = true;
                }
            }

            if (!shouldApplied) {
                this._log(`File ${file.path} is not changed`, LOG_LEVEL_VERBOSE);
                return true;
            }
            if (!readFile) readFile = await this.readFileFromStub(file);
            // If the file is changed, then the file should be stored.
            if (onlyChunks) {
                return await this.db.createChunks(readFile, false, true);
            } else {
                return await this.db.store(readFile, false, true);
            }
        } else {
            // If force is true, then it should be updated.
            const readFile = await this.readFileFromStub(file);
            if (onlyChunks) {
                return await this.db.createChunks(readFile, true, true);
            } else {
                return await this.db.store(readFile, true, true);
            }
        }
    }

    async deleteFileFromDB(info: UXFileInfoStub | UXInternalFileInfoStub | FilePath): Promise<boolean> {
        const file = typeof info === "string" ? this.storage.getFileStub(info) : info;
        if (file == null) {
            this._log(`File ${info} is not exist on the storage`, LOG_LEVEL_VERBOSE);
            return false;
        }
        // const file = item.args.file;
        if (file.isInternal) {
            this._log(
                `Internal file ${file.path} is not allowed to be processed on processFileEvent`,
                LOG_LEVEL_VERBOSE
            );
            return false;
        }
        // First, check the file on the database
        const entry = await this.db.fetchEntry(file, undefined, true, true);
        if (!entry || entry.deleted || entry._deleted) {
            this._log(`File ${file.path} is not exist or already deleted on the database`, LOG_LEVEL_VERBOSE);
            return false;
        }
        // Check the file is already conflicted. if so, only the conflicted one should be deleted.
        const conflictedRevs = await this.db.getConflictedRevs(file);
        if (conflictedRevs.length > 0) {
            // If conflicted, then it should be deleted. entry._rev should be own file's rev.
            // TODO: I BELIEVED SO. BUT I NOTICED THAT I AN NOT SURE. I SHOULD CHECK THIS.
            //       ANYWAY, I SHOULD DELETE THE FILE. ACTUALLY WE SIMPLY DELETED THE FILE UNTIL PREVIOUS VERSIONS.
            return await this.db.delete(file, entry._rev);
        }
        // Otherwise, the file should be deleted simply. This is the previous behaviour.
        return await this.db.delete(file);
    }

    async deleteRevisionFromDB(
        info: UXFileInfoStub | FilePath | FilePathWithPrefix,
        rev: string
    ): Promise<boolean | undefined> {
        //TODO: Possibly check the conflicting.
        return await this.db.delete(info, rev);
    }

    async resolveConflictedByDeletingRevision(
        info: UXFileInfoStub | FilePath,
        rev: string
    ): Promise<boolean | undefined> {
        const path = getStoragePathFromUXFileInfo(info);
        if (!(await this.deleteRevisionFromDB(info, rev))) {
            this._log(`Failed to delete the conflicted revision ${rev} of ${path}`, LOG_LEVEL_VERBOSE);
            return false;
        }
        if (!(await this.dbToStorageWithSpecificRev(info, rev, true))) {
            this._log(`Failed to apply the resolved revision ${rev} of ${path} to the storage`, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    async dbToStorageWithSpecificRev(
        info: UXFileInfoStub | UXFileInfo | FilePath | null,
        rev: string,
        force?: boolean
    ): Promise<boolean> {
        const file = typeof info === "string" ? this.storage.getFileStub(info) : info;
        if (file == null) {
            this._log(`File ${info} is not exist on the storage`, LOG_LEVEL_VERBOSE);
            return false;
        }
        const docEntry = await this.db.fetchEntryMeta(file, rev, true);
        if (!docEntry) {
            this._log(`File ${file.path} is not exist on the database`, LOG_LEVEL_VERBOSE);
            return false;
        }
        return await this.dbToStorage(docEntry, file, force);
    }

    async dbToStorage(
        entryInfo: MetaEntry | FilePathWithPrefix,
        info: UXFileInfoStub | UXFileInfo | FilePath | null,
        force?: boolean
    ): Promise<boolean> {
        const file = typeof info === "string" ? this.storage.getFileStub(info) : info;
        const mode = file == null ? "create" : "modify";
        const pathFromEntryInfo = typeof entryInfo === "string" ? entryInfo : getPath(entryInfo);
        const docEntry = await this.db.fetchEntryMeta(pathFromEntryInfo, undefined, true);
        if (!docEntry) {
            this._log(`File ${pathFromEntryInfo} is not exist on the database`, LOG_LEVEL_VERBOSE);
            return false;
        }
        const path = getPath(docEntry);

        // 1. Check if it already conflicted.
        const revs = await this.db.getConflictedRevs(path);
        if (revs.length > 0) {
            // Some conflicts are exist.
            if (this.settings.writeDocumentsIfConflicted) {
                // If configured to write the document even if conflicted, then it should be written.
                // NO OP
            } else {
                // If not, then it should be checked. and will be processed later (i.e., after the conflict is resolved).
                await this.services.conflict.queueCheckForIfOpen(path);
                return true;
            }
        }

        // 2. Check if the file is already exist on the storage.
        const existDoc = this.storage.getStub(path);
        if (existDoc && existDoc.isFolder) {
            this._log(`Folder ${path} is already exist on the storage as a folder`, LOG_LEVEL_VERBOSE);
            // We can do nothing, and other modules should also nothing to do.
            return true;
        }

        // Check existence of both file and docEntry.
        const existOnDB = !(docEntry._deleted || docEntry.deleted || false);
        const existOnStorage = existDoc != null;
        if (!existOnDB && !existOnStorage) {
            this._log(`File ${path} seems to be deleted, but already not on storage`, LOG_LEVEL_VERBOSE);
            return true;
        }
        if (!existOnDB && existOnStorage) {
            // Deletion has been Transferred. Storage files will be deleted.
            // Note: If the folder becomes empty, the folder will be deleted if not configured to keep it.
            // This behaviour is implemented on the `ModuleFileAccessObsidian`.
            // And it does not care actually deleted.
            await this.storage.deleteVaultItem(path);
            return true;
        }
        // Okay, the file is exist on the database. Let's check the file is exist on the storage.
        const docRead = await this.db.fetchEntryFromMeta(docEntry);
        if (!docRead) {
            this._log(`File ${path} is not exist on the database`, LOG_LEVEL_VERBOSE);
            return false;
        }

        // If we want to process size mismatched files -- in case of having files created by some integrations, enable the toggle.
        if (!this.settings.processSizeMismatchedFiles) {
            // Check the file is not corrupted
            // (Zero is a special case, may be created by some APIs and it might be acceptable).
            if (docRead.size != 0 && docRead.size !== readAsBlob(docRead).size) {
                this._log(`File ${path} seems to be corrupted! Writing prevented.`, LOG_LEVEL_NOTICE);
                return false;
            }
        }

        const docData = readContent(docRead);

        if (existOnStorage && !force) {
            // The file is exist on the storage. Let's check the difference between the file and the entry.
            // But, if force is true, then it should be updated.
            // Ok, we have to compare.
            let shouldApplied = false;
            // 1. if the time stamp is far different, then it should be updated.
            // Note: This checks only the mtime with the resolution reduced to 2 seconds.
            //       2 seconds it for the ZIP file's mtime. If not, we cannot backup the vault as the ZIP file.
            //       This is hardcoded on `compareMtime` of `src/common/utils.ts`.
            if (compareFileFreshness(existDoc, docEntry) !== EVEN) {
                shouldApplied = true;
            }
            // 2. if not, the content should be checked.

            if (!shouldApplied) {
                const readFile = await this.readFileFromStub(existDoc);
                if (await isDocContentSame(docData, readFile.body)) {
                    // The content is same. So, we do not need to update the file.
                    shouldApplied = false;
                    // Timestamp is different but the content is same. therefore, two timestamps should be handled as same.
                    // So, mark the changes are same.
                    markChangesAreSame(docRead, docRead.mtime, existDoc.stat.mtime);
                } else {
                    shouldApplied = true;
                }
            }
            if (!shouldApplied) {
                this._log(`File ${docRead.path} is not changed`, LOG_LEVEL_VERBOSE);
                return true;
            }
            // Let's apply the changes.
        } else {
            this._log(
                `File ${docRead.path} ${existOnStorage ? "(new) " : ""} ${force ? " (forced)" : ""}`,
                LOG_LEVEL_VERBOSE
            );
        }
        await this.storage.ensureDir(path);
        const ret = await this.storage.writeFileAuto(path, docData, { ctime: docRead.ctime, mtime: docRead.mtime });
        await this.storage.touched(path);
        this.storage.triggerFileEvent(mode, path);
        return ret;
    }

    private async _anyHandlerProcessesFileEvent(item: FileEventItem): Promise<boolean> {
        const eventItem = item.args;
        const type = item.type;
        const path = eventItem.file.path;
        if (!(await this.services.vault.isTargetFile(path))) {
            this._log(`File ${path} is not the target file`, LOG_LEVEL_VERBOSE);
            return false;
        }
        if (shouldBeIgnored(path)) {
            this._log(`File ${path} should be ignored`, LOG_LEVEL_VERBOSE);
            return false;
        }
        const lockKey = `processFileEvent-${path}`;
        return await serialized(lockKey, async () => {
            switch (type) {
                case "CREATE":
                case "CHANGED":
                    return await this.storeFileToDB(item.args.file);
                case "DELETE":
                    return await this.deleteFileFromDB(item.args.file);
                case "INTERNAL":
                    // this should be handled on the other module.
                    return false;
                default:
                    this._log(`Unsupported event type: ${type}`, LOG_LEVEL_VERBOSE);
                    return false;
            }
        });
    }

    async _anyProcessReplicatedDoc(entry: MetaEntry): Promise<boolean> {
        return await serialized(entry.path, async () => {
            if (!(await this.services.vault.isTargetFile(entry.path))) {
                this._log(`File ${entry.path} is not the target file`, LOG_LEVEL_VERBOSE);
                return false;
            }
            if (this.services.vault.isFileSizeTooLarge(entry.size)) {
                this._log(`File ${entry.path} is too large (on database) to be processed`, LOG_LEVEL_VERBOSE);
                return false;
            }
            if (shouldBeIgnored(entry.path)) {
                this._log(`File ${entry.path} should be ignored`, LOG_LEVEL_VERBOSE);
                return false;
            }
            const path = getPath(entry);

            const targetFile = this.storage.getStub(getPathWithoutPrefix(entry));
            if (targetFile && targetFile.isFolder) {
                this._log(`${getPath(entry)} is already exist as the folder`);
                // Nothing to do and other modules should also nothing to do.
                return true;
            } else {
                if (targetFile && this.services.vault.isFileSizeTooLarge(targetFile.stat.size)) {
                    this._log(`File ${targetFile.path} is too large (on storage) to be processed`, LOG_LEVEL_VERBOSE);
                    return false;
                }
                this._log(
                    `Processing ${path} (${entry._id.substring(0, 8)} :${entry._rev?.substring(0, 5)}) : Started...`,
                    LOG_LEVEL_VERBOSE
                );
                // Before writing (or skipped ), merging dialogue should be cancelled.
                eventHub.emitEvent("conflict-cancelled", path);
                const ret = await this.dbToStorage(entry, targetFile);
                this._log(`Processing ${path} (${entry._id.substring(0, 8)} :${entry._rev?.substring(0, 5)}) : Done`);
                return ret;
            }
        });
    }

    async createAllChunks(showingNotice?: boolean): Promise<void> {
        this._log("Collecting local files on the storage", LOG_LEVEL_VERBOSE);
        const semaphore = Semaphore(10);

        let processed = 0;
        const filesStorageSrc = this.storage.getFiles();
        const incProcessed = () => {
            processed++;
            if (processed % 25 == 0)
                this._log(
                    `Creating missing chunks: ${processed} of ${total} files`,
                    showingNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
                    "chunkCreation"
                );
        };
        const total = filesStorageSrc.length;
        const procAllChunks = filesStorageSrc.map(async (file) => {
            if (!(await this.services.vault.isTargetFile(file))) {
                incProcessed();
                return true;
            }
            if (this.services.vault.isFileSizeTooLarge(file.stat.size)) {
                incProcessed();
                return true;
            }
            if (shouldBeIgnored(file.path)) {
                incProcessed();
                return true;
            }
            const release = await semaphore.acquire();
            incProcessed();
            try {
                await this.storeFileToDB(file, false, true);
            } catch (ex) {
                this._log(ex, LOG_LEVEL_VERBOSE);
            } finally {
                release();
            }
        });
        await Promise.all(procAllChunks);
        this._log(
            `Creating chunks Done: ${processed} of ${total} files`,
            showingNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO,
            "chunkCreation"
        );
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.handleOnInitialise(this._everyOnloadStart.bind(this));
        services.fileProcessing.handleProcessFileEvent(this._anyHandlerProcessesFileEvent.bind(this));
        services.replication.handleProcessSynchroniseResult(this._anyProcessReplicatedDoc.bind(this));
    }
}
