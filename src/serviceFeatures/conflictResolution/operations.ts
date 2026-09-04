import {
    AUTO_MERGED,
    CANCELLED,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    MISSING_OR_ERROR,
    NOT_CONFLICTED,
    type diff_check_result,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isCustomisationSyncMetadata, isPluginMetadata } from "@vrtmrz/livesync-commonlib/compat/common/typeUtils";
import { TARGET_IS_NEW } from "@vrtmrz/livesync-commonlib/compat/common/models/shared.const.symbols";
import { compareMTime, displayRev } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { DatabaseFileAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseFileAccess";
import type { IFileHandler } from "@vrtmrz/livesync-commonlib/compat/interfaces/FileHandler";
import type {
    IAppLifecycleService,
    IConflictService,
    IReplicationService,
    IVaultService,
} from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import type { LiveSyncEventHub } from "@vrtmrz/livesync-commonlib/context";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import { EVENT_CONFLICT_CANCELLED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { NO_INTERACTION } from "@vrtmrz/livesync-commonlib/replication";
import { isLockAcquired, serialized } from "octagonal-wheels/concurrency/lock";
import diff_match_patch from "diff-match-patch";
import { stripAllPrefixes, isPlainText } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

export type ConflictResolutionSettings = Pick<
    ObsidianLiveSyncSettings,
    "disableMarkdownAutoMerge" | "resolveConflictsByNewerFile" | "syncAfterMerge" | "showMergeDialogOnlyOnActive"
>;

export interface ConflictResolutionOperationsDependencies {
    readonly events: Pick<LiveSyncEventHub, "emitEvent">;
    readonly databaseFileAccess: Pick<DatabaseFileAccess, "fetchEntryMeta" | "getConflictedRevs" | "storeContent">;
    readonly fileHandler: Pick<IFileHandler, "deleteRevisionFromDB" | "dbToStorage">;
    readonly localDatabase: () => Pick<LiveSyncLocalDB, "tryAutoMerge">;
    readonly conflict: Pick<
        IConflictService,
        "queueCheckFor" | "resolveByDeletingRevision" | "resolveByUserInteraction"
    >;
    readonly replication: Pick<IReplicationService, "replicateUnattendedByEvent">;
    readonly appLifecycle: Pick<IAppLifecycleService, "isSuspended">;
    readonly vault: Pick<IVaultService, "getActiveFilePath">;
    readonly storageAccess: Pick<StorageAccess, "getFileNames">;
    readonly currentSettings: () => ConflictResolutionSettings;
    readonly log: LogFunction;
}

export interface ConflictResolutionOperations {
    readonly resolveByDeletingRevision: (
        path: FilePathWithPrefix,
        deleteRevision: string,
        subTitle?: string,
        showNotice?: boolean
    ) => Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED>;
    readonly checkConflictAndPerformAutoMerge: (path: FilePathWithPrefix) => Promise<diff_check_result>;
    readonly resolve: (filename: FilePathWithPrefix) => Promise<void>;
    readonly resolveByNewest: (filename: FilePathWithPrefix, showNotice?: boolean) => Promise<boolean>;
    readonly resolveAllConflictedFilesByNewerOnes: () => Promise<void>;
}

export function createConflictResolutionOperations(
    dependencies: ConflictResolutionOperationsDependencies
): ConflictResolutionOperations {
    const latestResolveRequestByFilename = new Map<FilePathWithPrefix, number>();
    let nextResolveRequestId = 0;

    const resolveByDeletingRevision = async (
        path: FilePathWithPrefix,
        deleteRevision: string,
        subTitle = "",
        showNotice = true
    ): Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED> => {
        const title = `Resolving ${subTitle ? `[${subTitle}]` : ""}:`;
        if (!(await dependencies.fileHandler.deleteRevisionFromDB(path, deleteRevision))) {
            dependencies.log(
                `${title} Could not delete conflicted revision ${displayRev(deleteRevision)} of ${path}`,
                LOG_LEVEL_NOTICE
            );
            return MISSING_OR_ERROR;
        }
        dependencies.events.emitEvent(EVENT_CONFLICT_CANCELLED, path);
        dependencies.log(
            `${title} Conflicted revision has been deleted ${displayRev(deleteRevision)} ${path}`,
            LOG_LEVEL_INFO
        );
        if ((await dependencies.databaseFileAccess.getConflictedRevs(path)).length != 0) {
            dependencies.log(`${title} some conflicts are left in ${path}`, LOG_LEVEL_INFO);
            return AUTO_MERGED;
        }
        if (isPluginMetadata(path) || isCustomisationSyncMetadata(path)) {
            dependencies.log(`${title} ${path} is a plugin metadata file, no need to write to storage`, LOG_LEVEL_INFO);
            return AUTO_MERGED;
        }
        // If no conflicts were found, write the resolved content to the storage.
        if (!(await dependencies.fileHandler.dbToStorage(path, stripAllPrefixes(path), true))) {
            dependencies.log(`Could not write the resolved content to the storage: ${path}`, LOG_LEVEL_NOTICE);
            return MISSING_OR_ERROR;
        }
        const level = subTitle.indexOf("same") !== -1 || !showNotice ? LOG_LEVEL_INFO : LOG_LEVEL_NOTICE;
        dependencies.log(`${path} has been merged automatically`, level);
        return AUTO_MERGED;
    };

    const checkConflictAndPerformAutoMerge = async (path: FilePathWithPrefix): Promise<diff_check_result> => {
        const ret = await dependencies
            .localDatabase()
            .tryAutoMerge(path, !dependencies.currentSettings().disableMarkdownAutoMerge);
        if ("ok" in ret) {
            return ret.ok;
        }

        if ("result" in ret) {
            const p = ret.result;
            // 1. Store the merged content to the storage.
            if (!(await dependencies.databaseFileAccess.storeContent(path, p))) {
                dependencies.log(`Merged content cannot be stored:${path}`, LOG_LEVEL_NOTICE);
                return MISSING_OR_ERROR;
            }
            // 2. Delete the conflicted revision and reflect the result if all conflicts are gone.
            return await dependencies.conflict.resolveByDeletingRevision(path, ret.conflictedRev, "Sensible");
        }

        const { rightRev, leftLeaf, rightLeaf } = ret;

        // Should be one or more conflicts.
        if (leftLeaf == false) {
            dependencies.log(`could not get current revisions:${path}`, LOG_LEVEL_NOTICE);
            return MISSING_OR_ERROR;
        }
        if (rightLeaf == false) {
            // A locally unreadable conflict leaf may still be recoverable from another
            // replica or backup. Keep it visible for explicit repair instead of treating
            // missing chunks as evidence that the branch is obsolete.
            dependencies.log(`could not read conflicted revision ${rightRev}:${path}`, LOG_LEVEL_NOTICE);
            return MISSING_OR_ERROR;
        }

        const isSame = leftLeaf.data == rightLeaf.data && leftLeaf.deleted == rightLeaf.deleted;
        const isBinary = !isPlainText(path);
        const alwaysNewer = dependencies.currentSettings().resolveConflictsByNewerFile;
        if (isSame || isBinary || alwaysNewer) {
            const result = compareMTime(leftLeaf.mtime, rightLeaf.mtime);
            let loser = leftLeaf;
            // If lMtime > rMtime.
            if (result != TARGET_IS_NEW) {
                loser = rightLeaf;
            }
            const subTitle = [
                `${isSame ? "same" : ""}`,
                `${isBinary ? "binary" : ""}`,
                `${alwaysNewer ? "alwaysNewer" : ""}`,
            ]
                .filter((e) => e.trim())
                .join(",");
            return await dependencies.conflict.resolveByDeletingRevision(path, loser.rev, subTitle);
        }
        // Make diff.
        const dmp = new diff_match_patch();
        const diff = dmp.diff_main(leftLeaf.data, rightLeaf.data);
        dmp.diff_cleanupSemantic(diff);
        dependencies.log(`conflict(s) found:${path}`);
        return {
            left: leftLeaf,
            right: rightLeaf,
            diff: diff,
        };
    };

    const resolve = async (filename: FilePathWithPrefix): Promise<void> => {
        const requestId = ++nextResolveRequestId;
        latestResolveRequestByFilename.set(filename, requestId);
        const serialisationKey = `conflict-resolve:${filename}`;
        if (isLockAcquired(serialisationKey)) {
            // A later check for the same file makes any open comparison stale.
            // Close it before waiting for the current resolver to release the
            // per-file lock. Dialogues for other paths remain untouched.
            dependencies.events.emitEvent(EVENT_CONFLICT_CANCELLED, filename);
        }
        return await serialized(serialisationKey, async () => {
            if (latestResolveRequestByFilename.get(filename) !== requestId) {
                return;
            }
            try {
                const conflictCheckResult = await checkConflictAndPerformAutoMerge(filename);
                if (latestResolveRequestByFilename.get(filename) !== requestId) {
                    return;
                }
                if (conflictCheckResult === NOT_CONFLICTED) {
                    dependencies.events.emitEvent(EVENT_CONFLICT_CANCELLED, filename);
                    dependencies.log(`[conflict] Not conflicted or cancelled: ${filename}`, LOG_LEVEL_VERBOSE);
                    return;
                }
                if (conflictCheckResult === MISSING_OR_ERROR || conflictCheckResult === CANCELLED) {
                    // Nothing to do.
                    dependencies.log(`[conflict] Not conflicted or cancelled: ${filename}`, LOG_LEVEL_VERBOSE);
                    return;
                }
                if (conflictCheckResult === AUTO_MERGED) {
                    // Auto resolved, but need to check again.
                    if (dependencies.currentSettings().syncAfterMerge && !dependencies.appLifecycle.isSuspended()) {
                        // Wait for the running replication, if not running replication, run it once.
                        await dependencies.replication.replicateUnattendedByEvent({
                            trigger: "merge",
                            interaction: NO_INTERACTION,
                        });
                    }
                    dependencies.log("[conflict] Automatically merged, but we have to check it again");
                    await dependencies.conflict.queueCheckFor(filename);
                    return;
                }
                if (dependencies.currentSettings().showMergeDialogOnlyOnActive) {
                    const activeFile = dependencies.vault.getActiveFilePath();
                    if (activeFile && activeFile != filename) {
                        dependencies.log(
                            `[conflict] ${filename} is conflicted. Merging process has been postponed to the file have got opened.`,
                            LOG_LEVEL_NOTICE
                        );
                        return;
                    }
                }
                dependencies.log("[conflict] Manual merge required!");
                dependencies.events.emitEvent(EVENT_CONFLICT_CANCELLED, filename);
                await dependencies.conflict.resolveByUserInteraction(filename, conflictCheckResult);
            } finally {
                if (latestResolveRequestByFilename.get(filename) === requestId) {
                    latestResolveRequestByFilename.delete(filename);
                }
            }
        });
    };

    const resolveByNewest = async (filename: FilePathWithPrefix, showNotice = true): Promise<boolean> => {
        const currentRev = await dependencies.databaseFileAccess.fetchEntryMeta(filename, undefined, true);
        if (currentRev == false) {
            dependencies.log(`Could not get current revision of ${filename}`);
            return Promise.resolve(false);
        }
        const revs = await dependencies.databaseFileAccess.getConflictedRevs(filename);
        if (revs.length == 0) {
            return Promise.resolve(true);
        }
        const mTimeAndRev = (
            [
                [currentRev.mtime, currentRev._rev],
                ...(await Promise.all(
                    revs.map(async (rev) => {
                        const leaf = await dependencies.databaseFileAccess.fetchEntryMeta(filename, rev);
                        if (leaf == false) {
                            return [0, rev];
                        }
                        return [leaf.mtime, rev];
                    })
                )),
            ] as [number, string][]
        ).sort((a, b) => {
            const diff = b[0] - a[0];
            if (diff == 0) {
                return a[1].localeCompare(b[1], "en", { numeric: true });
            }
            return diff;
        });
        dependencies.log(
            `Resolving conflict by newest: ${filename} (Newest: ${new Date(mTimeAndRev[0][0]).toLocaleString()}) (${mTimeAndRev.length} revisions exists)`
        );
        for (let i = 1; i < mTimeAndRev.length; i++) {
            dependencies.log(
                `conflict: Deleting the older revision ${mTimeAndRev[i][1]} (${new Date(mTimeAndRev[i][0]).toLocaleString()}) of ${filename}`
            );
            await resolveByDeletingRevision(filename, mTimeAndRev[i][1], "NEWEST", showNotice);
        }
        return true;
    };

    const resolveAllConflictedFilesByNewerOnes = async (): Promise<void> => {
        dependencies.log(`Resolving conflicts by newer ones`, LOG_LEVEL_NOTICE);

        const files = await dependencies.storageAccess.getFileNames();

        let i = 0;
        for (const file of files) {
            i++;
            if (i % 10 === 0)
                dependencies.log(
                    `Check and Processing ${i} / ${files.length}`,
                    LOG_LEVEL_NOTICE,
                    "resolveAllConflictedFilesByNewerOnes"
                );
            await resolveByNewest(file, false);
        }
        dependencies.log(`Done!`, LOG_LEVEL_NOTICE, "resolveAllConflictedFilesByNewerOnes");
    };

    return {
        resolveByDeletingRevision,
        checkConflictAndPerformAutoMerge,
        resolve,
        resolveByNewest,
        resolveAllConflictedFilesByNewerOnes,
    };
}
