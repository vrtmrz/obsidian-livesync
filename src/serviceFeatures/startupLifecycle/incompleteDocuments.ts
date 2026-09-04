import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    Logger,
} from "@vrtmrz/livesync-commonlib/compat/common/logger";
import {
    isDeletedEntry,
    isDocContentSame,
    isLoadedEntry,
    readAsBlob,
} from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { isMetaEntry } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { IFileHandler } from "@vrtmrz/livesync-commonlib/compat/interfaces/FileHandler";
import type { KeyValueDatabase } from "@vrtmrz/livesync-commonlib/compat/interfaces/KeyValueDatabase";
import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { $msg } from "@/common/translation";
import { isValidPath } from "@/common/utils";
import type { StartupPathReader } from "./types";

type NoticeGroups = {
    setItem(groupKey: string, itemKey: string, item: { message: string }): void;
    finish(groupKey: string): void;
};

/** Focused collaborators for the incomplete-document integrity scan and repair. */
export interface IncompleteDocumentsDependencies {
    readonly localDatabase: Pick<LiveSyncLocalDB, "findAllNormalDocs" | "getDBEntryFromMeta">;
    readonly getPath: StartupPathReader;
    readonly isTargetFile: (path: string) => Promise<boolean>;
    readonly storageAccess: Pick<StorageAccess, "readHiddenFileBinary" | "getFileStub">;
    readonly fileHandler: Pick<IFileHandler, "storeFileToDB">;
    readonly keyValueDB: Pick<KeyValueDatabase, "get" | "set">;
    readonly noticeGroups: NoticeGroups;
    readonly confirm: Pick<Confirm, "askSelectStringDialogue">;
    readonly log: LogFunction;
}

type ErrorInfo = {
    path: string;
    recordedSize: number;
    actualSize: number;
    storageSize: number;
    contentMatched: boolean;
    isConflicted?: boolean;
};

const INCOMPLETE_DOCUMENT_NOTICE_GROUP = "startup-integrity-check";

/**
 * Scan database metadata against hidden storage and preserve the former
 * recoverable-file dialogue and repair rules.
 */
export async function checkIncompleteDocuments(
    dependencies: IncompleteDocumentsDependencies,
    force: boolean = false
): Promise<boolean> {
    const incompleteDocsChecked = (await dependencies.keyValueDB.get<boolean>("checkIncompleteDocs")) || false;
    if (incompleteDocsChecked && !force) {
        dependencies.log("Incomplete docs check already done, skipping.", LOG_LEVEL_VERBOSE);
        return Promise.resolve(true);
    }

    const noticeGroups = dependencies.noticeGroups;
    noticeGroups.setItem(INCOMPLETE_DOCUMENT_NOTICE_GROUP, "checking", {
        message: "Checking for incomplete documents...",
    });
    dependencies.log("Checking for incomplete documents...", LOG_LEVEL_VERBOSE);

    try {
        const errorFiles = [] as ErrorInfo[];
        for await (const metaDoc of dependencies.localDatabase.findAllNormalDocs({ conflicts: true })) {
            const path = dependencies.getPath(metaDoc);

            if (!isValidPath(path)) {
                continue;
            }
            if (!(await dependencies.isTargetFile(path))) {
                continue;
            }
            if (!isMetaEntry(metaDoc)) {
                continue;
            }

            const doc = await dependencies.localDatabase.getDBEntryFromMeta(metaDoc);
            if (!doc || !isLoadedEntry(doc)) {
                continue;
            }
            if (isDeletedEntry(doc)) {
                continue;
            }
            const isConflicted = metaDoc?._conflicts && metaDoc._conflicts.length > 0;

            let storageFileContent;
            try {
                storageFileContent = await dependencies.storageAccess.readHiddenFileBinary(path);
            } catch (e) {
                Logger(`Failed to read file ${path}: Possibly unprocessed or missing`);
                Logger(e, LOG_LEVEL_VERBOSE);
                continue;
            }
            // const storageFileBlob = createBlob(storageFileContent);
            const sizeOnStorage = storageFileContent.byteLength;
            const recordedSize = doc.size;
            const docBlob = readAsBlob(doc);
            const actualSize = docBlob.size;
            if (
                recordedSize !== actualSize ||
                sizeOnStorage !== actualSize ||
                sizeOnStorage !== recordedSize ||
                isConflicted
            ) {
                const contentMatched = await isDocContentSame(doc.data, storageFileContent);
                errorFiles.push({
                    path,
                    recordedSize,
                    actualSize,
                    storageSize: sizeOnStorage,
                    contentMatched,
                    isConflicted,
                });
                Logger(
                    `Size mismatch for ${path}: ${recordedSize} (DB Recorded) , ${actualSize} (DB Stored) , ${sizeOnStorage} (Storage Stored), ${contentMatched ? "Content Matched" : "Content Mismatched"} ${isConflicted ? "Conflicted" : "Not Conflicted"}`
                );
            }
        }
        if (errorFiles.length == 0) {
            Logger("No size mismatches found", LOG_LEVEL_INFO);
            noticeGroups.setItem(INCOMPLETE_DOCUMENT_NOTICE_GROUP, "result", {
                message: "No size mismatches found",
            });
            await dependencies.keyValueDB.set("checkIncompleteDocs", true);
            return Promise.resolve(true);
        }
        Logger(`Found ${errorFiles.length} size mismatches`, LOG_LEVEL_INFO);
        noticeGroups.setItem(INCOMPLETE_DOCUMENT_NOTICE_GROUP, "result", {
            message: `Found ${errorFiles.length} size mismatches`,
        });
        // We have to repair them following rules and situations:
        // A. DB Recorded != DB Stored
        //   A.1. DB Recorded == Storage Stored
        //        Possibly recoverable from storage. Just overwrite the DB content with storage content.
        //   A.2. Neither
        //        Probably it cannot be resolved on this device. Even if the storage content is larger than DB Recorded, it possibly corrupted.
        //        We do not fix it automatically. Leave it as is. Possibly other device can do this.
        // B. DB Recorded == DB Stored ,  < Storage Stored
        //   Very fragile, if DB Recorded size is less than Storage Stored size, we possibly repair the content (The issue was `unexpectedly shortened file`).
        //   We do not fix it automatically, but it will be automatically overwritten in other process.
        // C. DB Recorded == DB Stored ,  > Storage Stored
        //   Probably restored by the user by resolving A or B on other device, We should overwrite the storage
        //   Also do not fix it automatically. It should be overwritten by replication.
        const recoverable = errorFiles.filter((e) => {
            return e.recordedSize === e.storageSize && !e.isConflicted;
        });
        const unrecoverable = errorFiles.filter((e) => {
            return e.recordedSize !== e.storageSize || e.isConflicted;
        });
        const fileInfo = (e: (typeof errorFiles)[0]) => {
            return `${e.path} (M: ${e.recordedSize}, A: ${e.actualSize}, S: ${e.storageSize}) ${e.isConflicted ? "(Conflicted)" : ""}`;
        };
        const messageUnrecoverable =
            unrecoverable.length > 0
                ? $msg("moduleMigration.fix0256.messageUnrecoverable", {
                      filesNotRecoverable: unrecoverable.map((e) => `- ${fileInfo(e)}`).join("\n"),
                  })
                : "";

        const message = $msg("moduleMigration.fix0256.message", {
            files: recoverable.map((e) => `- ${fileInfo(e)}`).join("\n"),
            messageUnrecoverable,
        });
        const CHECK_IT_LATER = $msg("moduleMigration.fix0256.buttons.checkItLater");
        const FIX = $msg("moduleMigration.fix0256.buttons.fix");
        const DISMISS = $msg("moduleMigration.fix0256.buttons.DismissForever");
        const ret = await dependencies.confirm.askSelectStringDialogue(message, [CHECK_IT_LATER, FIX, DISMISS], {
            title: $msg("moduleMigration.fix0256.title"),
            defaultAction: CHECK_IT_LATER,
        });
        if (ret == FIX) {
            for (const file of recoverable) {
                // Overwrite the database with the files on the storage
                const stubFile = await dependencies.storageAccess.getFileStub(file.path);
                if (stubFile == null) {
                    Logger(`Could not find stub file for ${file.path}`, LOG_LEVEL_NOTICE);
                    continue;
                }

                stubFile.stat.mtime = Date.now();
                const result = await dependencies.fileHandler.storeFileToDB(stubFile, true, false);
                if (result) {
                    Logger(`Successfully restored ${file.path} from storage`);
                } else {
                    Logger(`Failed to restore ${file.path} from storage`, LOG_LEVEL_NOTICE);
                }
            }
        } else if (ret === DISMISS) {
            // User chose to dismiss the issue
            await dependencies.keyValueDB.set("checkIncompleteDocs", true);
        }

        return Promise.resolve(true);
    } catch (error) {
        noticeGroups.setItem(INCOMPLETE_DOCUMENT_NOTICE_GROUP, "result", {
            message: "The incomplete document check could not be completed.",
        });
        throw error;
    } finally {
        noticeGroups.finish(INCOMPLETE_DOCUMENT_NOTICE_GROUP);
    }
}
