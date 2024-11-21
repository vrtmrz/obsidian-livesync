import { serialized } from "octagonal-wheels/concurrency/lock";
import { AbstractModule } from "../AbstractModule.ts";
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
} from "../../lib/src/common/types";
import { compareMTime, displayRev, TARGET_IS_NEW } from "../../common/utils";
import diff_match_patch from "diff-match-patch";
import { stripAllPrefixes, isPlainText } from "../../lib/src/string_and_binary/path";
import type { ICoreModule } from "../ModuleTypes.ts";

export class ModuleConflictResolver extends AbstractModule implements ICoreModule {
    async $$resolveConflictByDeletingRev(
        path: FilePathWithPrefix,
        deleteRevision: string,
        subTitle = ""
    ): Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED> {
        const title = `Resolving ${subTitle ? `[${subTitle}]` : ""}:`;
        if (!(await this.core.fileHandler.deleteRevisionFromDB(path, deleteRevision))) {
            this._log(
                `${title} Could not delete conflicted revision ${displayRev(deleteRevision)} of ${path}`,
                LOG_LEVEL_NOTICE
            );
            return MISSING_OR_ERROR;
        }
        this._log(`${title} Conflicted revision deleted ${displayRev(deleteRevision)} ${path}`, LOG_LEVEL_INFO);
        if ((await this.core.databaseFileAccess.getConflictedRevs(path)).length != 0) {
            this._log(`${title} some conflicts are left in ${path}`, LOG_LEVEL_INFO);
            return AUTO_MERGED;
        }
        // If no conflicts were found, write the resolved content to the storage.
        if (!(await this.core.fileHandler.dbToStorage(path, stripAllPrefixes(path), true))) {
            this._log(`Could not write the resolved content to the storage: ${path}`, LOG_LEVEL_NOTICE);
            return MISSING_OR_ERROR;
        }
        this._log(`${path} Has been merged automatically`, LOG_LEVEL_NOTICE);
        return AUTO_MERGED;
    }

    async checkConflictAndPerformAutoMerge(path: FilePathWithPrefix): Promise<diff_check_result> {
        //
        const ret = await this.localDatabase.tryAutoMerge(path, !this.settings.disableMarkdownAutoMerge);
        if ("ok" in ret) {
            return ret.ok;
        }

        if ("result" in ret) {
            const p = ret.result;
            // Merged content is coming.
            // 1. Store the merged content to the storage
            if (!(await this.core.databaseFileAccess.storeContent(path, p))) {
                this._log(`Merged content cannot be stored:${path}`, LOG_LEVEL_NOTICE);
                return MISSING_OR_ERROR;
            }
            // 2. As usual, delete the conflicted revision and if there are no conflicts, write the resolved content to the storage.
            return await this.core.$$resolveConflictByDeletingRev(path, ret.conflictedRev, "Sensible");
        }

        const { rightRev, leftLeaf, rightLeaf } = ret;

        // should be one or more conflicts;
        if (leftLeaf == false) {
            // what's going on..
            this._log(`could not get current revisions:${path}`, LOG_LEVEL_NOTICE);
            return MISSING_OR_ERROR;
        }
        if (rightLeaf == false) {
            // Conflicted item could not load, delete this.
            return await this.core.$$resolveConflictByDeletingRev(path, rightRev, "MISSING OLD REV");
        }

        const isSame = leftLeaf.data == rightLeaf.data && leftLeaf.deleted == rightLeaf.deleted;
        const isBinary = !isPlainText(path);
        const alwaysNewer = this.settings.resolveConflictsByNewerFile;
        if (isSame || isBinary || alwaysNewer) {
            const result = compareMTime(leftLeaf.mtime, rightLeaf.mtime);
            let loser = leftLeaf;
            // if (lMtime > rMtime) {
            if (result != TARGET_IS_NEW) {
                loser = rightLeaf;
            }
            const subTitle = [
                `${isSame ? "same" : ""}`,
                `${isBinary ? "binary" : ""}`,
                `${alwaysNewer ? "alwaysNewer" : ""}`,
            ].join(",");
            return await this.core.$$resolveConflictByDeletingRev(path, loser.rev, subTitle);
        }
        // make diff.
        const dmp = new diff_match_patch();
        const diff = dmp.diff_main(leftLeaf.data, rightLeaf.data);
        dmp.diff_cleanupSemantic(diff);
        this._log(`conflict(s) found:${path}`);
        return {
            left: leftLeaf,
            right: rightLeaf,
            diff: diff,
        };
    }

    async $$resolveConflict(filename: FilePathWithPrefix): Promise<void> {
        // const filename = filenames[0];
        return await serialized(`conflict-resolve:${filename}`, async () => {
            const conflictCheckResult = await this.checkConflictAndPerformAutoMerge(filename);
            if (
                conflictCheckResult === MISSING_OR_ERROR ||
                conflictCheckResult === NOT_CONFLICTED ||
                conflictCheckResult === CANCELLED
            ) {
                // nothing to do.
                this._log(`[conflict] Not conflicted or cancelled: ${filename}`, LOG_LEVEL_VERBOSE);
                return;
            }
            if (conflictCheckResult === AUTO_MERGED) {
                //auto resolved, but need check again;
                if (this.settings.syncAfterMerge && !this.core.$$isSuspended()) {
                    //Wait for the running replication, if not running replication, run it once.
                    await this.core.$$waitForReplicationOnce();
                }
                this._log("[conflict] Automatically merged, but we have to check it again");
                await this.core.$$queueConflictCheck(filename);
                return;
            }
            if (this.settings.showMergeDialogOnlyOnActive) {
                const af = this.core.$$getActiveFilePath();
                if (af && af != filename) {
                    this._log(
                        `[conflict] ${filename} is conflicted. Merging process has been postponed to the file have got opened.`,
                        LOG_LEVEL_NOTICE
                    );
                    return;
                }
            }
            this._log("[conflict] Manual merge required!");
            await this.core.$anyResolveConflictByUI(filename, conflictCheckResult);
        });
    }

    async $anyResolveConflictByNewest(filename: FilePathWithPrefix): Promise<boolean> {
        const revs = await this.core.databaseFileAccess.getConflictedRevs(filename);
        if (revs.length == 0) {
            return Promise.resolve(true);
        }
        const mTimeAndRev = (
            await Promise.all(
                revs.map(async (rev) => {
                    const leaf = await this.core.databaseFileAccess.fetchEntryMeta(filename, rev);
                    if (leaf == false) {
                        return [0, rev] as [number, string];
                    }
                    return [leaf.mtime, rev] as [number, string];
                })
            )
        ).sort((a, b) => b[0] - a[0]);
        this._log(
            `Resolving conflict by newest: ${filename} (Newest: ${new Date(mTimeAndRev[0][0]).toLocaleString()}) (${mTimeAndRev.length} revisions exists)`
        );
        for (let i = 1; i < mTimeAndRev.length; i++) {
            this._log(
                `conflict: Deleting the older revision ${mTimeAndRev[i][1]} (${new Date(mTimeAndRev[i][0]).toLocaleString()}) of ${filename}`
            );
            await this.core.$$resolveConflictByDeletingRev(filename, mTimeAndRev[i][1], "NEWEST");
        }
        return true;
    }
}
