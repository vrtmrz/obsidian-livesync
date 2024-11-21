import { LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { EVENT_FILE_SAVED, eventHub } from "../../common/events";
import {
    getDatabasePathFromUXFileInfo,
    getStoragePathFromUXFileInfo,
    isInternalMetadata,
    markChangesAreSame,
} from "../../common/utils";
import type {
    UXFileInfoStub,
    FilePathWithPrefix,
    UXFileInfo,
    MetaEntry,
    LoadedEntry,
    FilePath,
    SavingEntry,
    DocumentID,
} from "../../lib/src/common/types";
import type { DatabaseFileAccess } from "../interfaces/DatabaseFileAccess";
import { type IObsidianModule } from "../AbstractObsidianModule.ts";
import { isPlainText, shouldBeIgnored, stripAllPrefixes } from "../../lib/src/string_and_binary/path";
import {
    createBlob,
    createTextBlob,
    delay,
    determineTypeFromBlob,
    isDocContentSame,
    readContent,
} from "../../lib/src/common/utils";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { AbstractModule } from "../AbstractModule.ts";
import { ICHeader } from "../../common/types.ts";

export class ModuleDatabaseFileAccess extends AbstractModule implements IObsidianModule, DatabaseFileAccess {
    $everyOnload(): Promise<boolean> {
        this.core.databaseFileAccess = this;
        return Promise.resolve(true);
    }

    async $everyModuleTest(): Promise<boolean> {
        if (!this.settings.enableDebugTools) return Promise.resolve(true);
        const testString = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam nec purus nec nunc";
        // Before test, we need to delete completely.
        const conflicts = await this.getConflictedRevs("autoTest.md" as FilePathWithPrefix);
        for (const rev of conflicts) {
            await this.delete("autoTest.md" as FilePathWithPrefix, rev);
        }
        await this.delete("autoTest.md" as FilePathWithPrefix);
        // OK, begin!

        await this._test(
            "storeContent",
            async () => await this.storeContent("autoTest.md" as FilePathWithPrefix, testString)
        );
        // For test, we need to clear the caches.
        await this.localDatabase.hashCaches.clear();
        await this._test("readContent", async () => {
            const content = await this.fetch("autoTest.md" as FilePathWithPrefix);
            if (!content) return "File not found";
            if (content.deleted) return "File is deleted";
            return (await content.body.text()) == testString
                ? true
                : `Content is not same ${await content.body.text()}`;
        });
        await this._test("delete", async () => await this.delete("autoTest.md" as FilePathWithPrefix));
        await this._test("read deleted content", async () => {
            const content = await this.fetch("autoTest.md" as FilePathWithPrefix);
            if (!content) return true;
            if (content.deleted) return true;
            return `Still exist !:${await content.body.text()},${JSON.stringify(content, undefined, 2)}`;
        });
        await delay(100);
        return this.testDone();
    }

    async checkIsTargetFile(file: UXFileInfoStub | FilePathWithPrefix): Promise<boolean> {
        const path = getStoragePathFromUXFileInfo(file);
        if (!(await this.core.$$isTargetFile(path))) {
            this._log(`File is not target`, LOG_LEVEL_VERBOSE);
            return false;
        }
        if (shouldBeIgnored(path)) {
            this._log(`File should be ignored`, LOG_LEVEL_VERBOSE);
            return false;
        }
        return true;
    }

    async delete(file: UXFileInfoStub | FilePathWithPrefix, rev?: string): Promise<boolean> {
        if (!(await this.checkIsTargetFile(file))) {
            return true;
        }
        const fullPath = getDatabasePathFromUXFileInfo(file);
        try {
            this._log(`deleteDB By path:${fullPath}`);
            return await this.deleteFromDBbyPath(fullPath, rev);
        } catch (ex) {
            this._log(`Failed to delete ${fullPath}`);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    async createChunks(file: UXFileInfo, force: boolean = false, skipCheck?: boolean): Promise<boolean> {
        return await this._store(file, force, skipCheck, true);
    }

    async store(file: UXFileInfo, force: boolean = false, skipCheck?: boolean): Promise<boolean> {
        return await this._store(file, force, skipCheck, false);
    }
    async storeContent(path: FilePathWithPrefix, content: string): Promise<boolean> {
        const blob = createTextBlob(content);
        const bytes = (await blob.arrayBuffer()).byteLength;
        const isInternal = path.startsWith(".") ? true : undefined;
        const dummyUXFileInfo: UXFileInfo = {
            name: path.split("/").pop() as string,
            path: path,
            stat: {
                size: bytes,
                ctime: Date.now(),
                mtime: Date.now(),
                type: "file",
            },
            body: blob,
            isInternal,
        };
        return await this._store(dummyUXFileInfo, true, false, false);
    }

    async _store(
        file: UXFileInfo,
        force: boolean = false,
        skipCheck?: boolean,
        onlyChunks?: boolean
    ): Promise<boolean> {
        if (!skipCheck) {
            if (!(await this.checkIsTargetFile(file))) {
                return true;
            }
        }
        if (!file) {
            this._log("File seems bad", LOG_LEVEL_VERBOSE);
            return false;
        }
        // const path = getPathFromUXFileInfo(file);
        const isPlain = isPlainText(file.name);
        const possiblyLarge = !isPlain;
        const content = file.body;

        const datatype = determineTypeFromBlob(content);
        const idPrefix = file.isInternal ? ICHeader : "";
        const fullPath = getStoragePathFromUXFileInfo(file);
        const fullPathOnDB = getDatabasePathFromUXFileInfo(file);

        if (possiblyLarge) this._log(`Processing: ${fullPath}`, LOG_LEVEL_VERBOSE);

        // if (isInternalMetadata(fullPath)) {
        //     this._log(`Internal file: ${fullPath}`, LOG_LEVEL_VERBOSE);
        //     return false;
        // }
        if (file.isInternal) {
            if (file.deleted) {
                file.stat = {
                    size: 0,
                    ctime: Date.now(),
                    mtime: Date.now(),
                    type: "file",
                };
            } else if (file.stat == undefined) {
                const stat = await this.core.storageAccess.statHidden(file.path);
                if (!stat) {
                    // We stored actually deleted or not since here, so this is an unexpected case. we should raise an error.
                    this._log(`Internal file not found: ${fullPath}`, LOG_LEVEL_VERBOSE);
                    return false;
                }
                file.stat = stat;
            }
        }

        const idMain = await this.core.$$path2id(fullPath);

        const id = (idPrefix + idMain) as DocumentID;
        const d: SavingEntry = {
            _id: id,
            path: fullPathOnDB,
            data: content,
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            size: file.stat.size,
            children: [],
            datatype: datatype,
            type: datatype,
            eden: {},
        };
        //upsert should locked
        const msg = `STORAGE -> DB (${datatype}) `;
        const isNotChanged = await serialized("file-" + fullPath, async () => {
            if (force) {
                this._log(msg + "Force writing " + fullPath, LOG_LEVEL_VERBOSE);
                return false;
            }
            // Commented out temporarily: this checks that the file was made ourself.
            // if (this.core.storageAccess.recentlyTouched(file)) {
            //     return true;
            // }
            try {
                const old = await this.localDatabase.getDBEntry(d.path, undefined, false, true, false);
                if (old !== false) {
                    const oldData = { data: old.data, deleted: old._deleted || old.deleted };
                    const newData = { data: d.data, deleted: d._deleted || d.deleted };
                    if (oldData.deleted != newData.deleted) return false;
                    if (!(await isDocContentSame(old.data, newData.data))) return false;
                    this._log(
                        msg + "Skipped (not changed) " + fullPath + (d._deleted || d.deleted ? " (deleted)" : ""),
                        LOG_LEVEL_VERBOSE
                    );
                    markChangesAreSame(old, d.mtime, old.mtime);
                    return true;
                    // d._rev = old._rev;
                }
            } catch (ex) {
                this._log(
                    msg +
                        "Error, Could not check the diff for the old one." +
                        (force ? "force writing." : "") +
                        fullPath +
                        (d._deleted || d.deleted ? " (deleted)" : ""),
                    LOG_LEVEL_VERBOSE
                );
                this._log(ex, LOG_LEVEL_VERBOSE);
                return !force;
            }
            return false;
        });
        if (isNotChanged) {
            this._log(msg + " Skip " + fullPath, LOG_LEVEL_VERBOSE);
            return true;
        }
        const ret = await this.localDatabase.putDBEntry(d, onlyChunks);
        if (ret !== false) {
            this._log(msg + fullPath);
            eventHub.emitEvent(EVENT_FILE_SAVED);
        }
        return ret != false;
    }

    async getConflictedRevs(file: UXFileInfoStub | FilePathWithPrefix): Promise<string[]> {
        if (!(await this.checkIsTargetFile(file))) {
            return [];
        }
        const filename = getDatabasePathFromUXFileInfo(file);
        const doc = await this.localDatabase.getDBEntryMeta(filename, { conflicts: true }, true);
        if (doc === false) {
            return [];
        }
        return doc._conflicts || [];
    }

    async fetch(
        file: UXFileInfoStub | FilePathWithPrefix,
        rev?: string,
        waitForReady?: boolean,
        skipCheck = false
    ): Promise<UXFileInfo | false> {
        if (skipCheck && !(await this.checkIsTargetFile(file))) {
            return false;
        }

        const entry = await this.fetchEntry(file, rev, waitForReady, true);
        if (entry === false) {
            return false;
        }
        const data = createBlob(readContent(entry));
        const path = stripAllPrefixes(entry.path);
        const fileInfo: UXFileInfo = {
            name: path.split("/").pop() as string,
            path: path,
            stat: {
                size: entry.size,
                ctime: entry.ctime,
                mtime: entry.mtime,
                type: "file",
            },
            body: data,
            deleted: entry.deleted || entry._deleted,
        };
        if (isInternalMetadata(entry.path)) {
            fileInfo.isInternal = true;
        }
        return fileInfo;
    }
    async fetchEntryMeta(
        file: UXFileInfoStub | FilePathWithPrefix,
        rev?: string,
        skipCheck = false
    ): Promise<MetaEntry | false> {
        const dbFileName = getDatabasePathFromUXFileInfo(file);
        if (skipCheck && !(await this.checkIsTargetFile(file))) {
            return false;
        }

        const doc = await this.localDatabase.getDBEntryMeta(dbFileName, rev ? { rev: rev } : undefined, true);
        if (doc === false) {
            return false;
        }
        return doc as MetaEntry;
    }
    async fetchEntryFromMeta(
        meta: MetaEntry,
        waitForReady: boolean = true,
        skipCheck = false
    ): Promise<LoadedEntry | false> {
        if (skipCheck && !(await this.checkIsTargetFile(meta.path))) {
            return false;
        }
        const doc = await this.localDatabase.getDBEntryFromMeta(
            meta as LoadedEntry,
            undefined,
            false,
            waitForReady,
            true
        );
        if (doc === false) {
            return false;
        }
        return doc;
    }
    async fetchEntry(
        file: UXFileInfoStub | FilePathWithPrefix,
        rev?: string,
        waitForReady: boolean = true,
        skipCheck = false
    ): Promise<LoadedEntry | false> {
        if (skipCheck && !(await this.checkIsTargetFile(file))) {
            return false;
        }
        const entry = await this.fetchEntryMeta(file, rev, true);
        if (entry === false) {
            return false;
        }
        const doc = await this.fetchEntryFromMeta(entry, waitForReady, true);
        return doc;
    }
    async deleteFromDBbyPath(fullPath: FilePath | FilePathWithPrefix, rev?: string): Promise<boolean> {
        if (!(await this.checkIsTargetFile(fullPath))) {
            this._log(`storeFromStorage: File is not target: ${fullPath}`);
            return true;
        }
        const opt = rev ? { rev: rev } : undefined;
        const ret = await this.localDatabase.deleteDBEntry(fullPath, opt);
        eventHub.emitEvent(EVENT_FILE_SAVED);
        return ret;
    }
}
