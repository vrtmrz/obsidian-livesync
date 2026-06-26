import { serialized } from "octagonal-wheels/concurrency/lock";
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
} from "@lib/common/types";
import { isCustomisationSyncMetadata, isPluginMetadata } from "@lib/common/typeUtils.ts";
import { TARGET_IS_NEW } from "@lib/common/models/shared.const.symbols.ts";
import { compareMTime, displayRev } from "@lib/common/utils.ts";
import diff_match_patch from "diff-match-patch";
import { stripAllPrefixes, isPlainText } from "@lib/string_and_binary/path";
import { eventHub } from "@/common/events.ts";
import type { NecessaryObsidianFeature } from "@/types";
import { createInstanceLogFunction, type LogFunction } from "@lib/services/lib/logUtils";

declare global {
    interface LSEvents {
        "conflict-cancelled": FilePathWithPrefix;
    }
}

export type ConflictResolverHost = NecessaryObsidianFeature<
    "API" | "conflict" | "appLifecycle" | "replication" | "vault" | "setting" | "database",
    "databaseFileAccess" | "fileHandler" | "storageAccess"
>;

const noopLog: LogFunction = () => undefined;
const createConflictResolverLog = (host: ConflictResolverHost): LogFunction =>
    host.services.API ? createInstanceLogFunction("ConflictResolver", host.services.API) : noopLog;

export const resolveConflictByDeletingRevHandler = async (
    host: ConflictResolverHost,
    path: FilePathWithPrefix,
    deleteRevision: string,
    subTitle = ""
): Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED> => {
    const { serviceModules } = host;
    const log = createConflictResolverLog(host);
    const title = `Resolving ${subTitle ? `[${subTitle}]` : ""}:`;
    if (!(await serviceModules.fileHandler.deleteRevisionFromDB(path, deleteRevision))) {
        log(`${title} Could not delete conflicted revision ${displayRev(deleteRevision)} of ${path}`, LOG_LEVEL_NOTICE);
        return MISSING_OR_ERROR;
    }
    eventHub.emitEvent("conflict-cancelled", path);
    log(`${title} Conflicted revision has been deleted ${displayRev(deleteRevision)} ${path}`, LOG_LEVEL_INFO);
    if ((await serviceModules.databaseFileAccess.getConflictedRevs(path)).length != 0) {
        log(`${title} some conflicts are left in ${path}`, LOG_LEVEL_INFO);
        return AUTO_MERGED;
    }
    if (isPluginMetadata(path) || isCustomisationSyncMetadata(path)) {
        log(`${title} ${path} is a plug-in metadata file, no need to write to storage`, LOG_LEVEL_INFO);
        return AUTO_MERGED;
    }
    // If no conflicts were found, write the resolved content to the storage.
    if (!(await serviceModules.fileHandler.dbToStorage(path, stripAllPrefixes(path), true))) {
        log(`Could not write the resolved content to the storage: ${path}`, LOG_LEVEL_NOTICE);
        return MISSING_OR_ERROR;
    }
    const level = subTitle.indexOf("same") !== -1 ? LOG_LEVEL_INFO : LOG_LEVEL_NOTICE;
    log(`${path} has been merged automatically`, level);
    return AUTO_MERGED;
};

export const checkConflictAndPerformAutoMerge = async (
    host: ConflictResolverHost,
    path: FilePathWithPrefix
): Promise<diff_check_result> => {
    const { services, serviceModules } = host;
    const log = createConflictResolverLog(host);
    const settings = services.setting.settings;

    const ret = await services.database.localDatabase.tryAutoMerge(path, !settings.disableMarkdownAutoMerge);
    if ("ok" in ret) {
        return ret.ok;
    }

    if ("result" in ret) {
        const p = ret.result;
        // Merged content is coming.
        // 1. Store the merged content to the storage
        if (!(await serviceModules.databaseFileAccess.storeContent(path, p))) {
            log(`Merged content cannot be stored:${path}`, LOG_LEVEL_NOTICE);
            return MISSING_OR_ERROR;
        }
        // 2. As usual, delete the conflicted revision and if there are no conflicts, write the resolved content to the storage.
        return await services.conflict.resolveByDeletingRevision(path, ret.conflictedRev, "Sensible");
    }

    const { rightRev, leftLeaf, rightLeaf } = ret;

    // should be one or more conflicts;
    if (leftLeaf == false) {
        // what's going on..
        log(`could not get current revisions:${path}`, LOG_LEVEL_NOTICE);
        return MISSING_OR_ERROR;
    }
    if (rightLeaf == false) {
        // Conflicted item could not load, delete this.
        return await services.conflict.resolveByDeletingRevision(path, rightRev, "MISSING OLD REV");
    }

    const isSame = leftLeaf.data == rightLeaf.data && leftLeaf.deleted == rightLeaf.deleted;
    const isBinary = !isPlainText(path);
    const alwaysNewer = settings.resolveConflictsByNewerFile;
    if (isSame || isBinary || alwaysNewer) {
        const result = compareMTime(leftLeaf.mtime, rightLeaf.mtime);
        let loser = leftLeaf;
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
        return await services.conflict.resolveByDeletingRevision(path, loser.rev, subTitle);
    }
    // make diff.
    const dmp = new diff_match_patch();
    const diff = dmp.diff_main(leftLeaf.data, rightLeaf.data);
    dmp.diff_cleanupSemantic(diff);
    log(`conflict(s) found:${path}`);
    return {
        left: leftLeaf,
        right: rightLeaf,
        diff: diff,
    };
};

export const resolveConflictHandler = async (
    host: ConflictResolverHost,
    filename: FilePathWithPrefix
): Promise<void> => {
    const { services } = host;
    const log = createConflictResolverLog(host);
    const settings = services.setting.settings;

    return await serialized(`conflict-resolve:${filename}`, async () => {
        const conflictCheckResult = await checkConflictAndPerformAutoMerge(host, filename);
        if (
            conflictCheckResult === MISSING_OR_ERROR ||
            conflictCheckResult === NOT_CONFLICTED ||
            conflictCheckResult === CANCELLED
        ) {
            // nothing to do.
            log(`[conflict] Not conflicted or cancelled: ${filename}`, LOG_LEVEL_VERBOSE);
            return;
        }
        if (conflictCheckResult === AUTO_MERGED) {
            //auto resolved, but need check again;
            if (settings.syncAfterMerge && !services.appLifecycle.isSuspended()) {
                //Wait for the running replication, if not running replication, run it once.
                await services.replication.replicateByEvent();
            }
            log("[conflict] Automatically merged, but we have to check it again");
            await services.conflict.queueCheckFor(filename);
            return;
        }
        if (settings.showMergeDialogOnlyOnActive) {
            const af = services.vault.getActiveFilePath();
            if (af && af != filename) {
                log(
                    `[conflict] ${filename} is conflicted. Merging process has been postponed to the file have got opened.`,
                    LOG_LEVEL_NOTICE
                );
                return;
            }
        }
        log("[conflict] Manual merge required!");
        eventHub.emitEvent("conflict-cancelled", filename);
        await services.conflict.resolveByUserInteraction(filename, conflictCheckResult);
    });
};

export const resolveConflictByNewestHandler = async (
    host: ConflictResolverHost,
    filename: FilePathWithPrefix
): Promise<boolean> => {
    const { services, serviceModules } = host;
    const log = createConflictResolverLog(host);
    const currentRev = await serviceModules.databaseFileAccess.fetchEntryMeta(filename, undefined, true);
    if (currentRev == false) {
        log(`Could not get current revision of ${filename}`);
        return Promise.resolve(false);
    }
    const revs = await serviceModules.databaseFileAccess.getConflictedRevs(filename);
    if (revs.length == 0) {
        return Promise.resolve(true);
    }
    const mTimeAndRev = (
        [
            [currentRev.mtime, currentRev._rev],
            ...(await Promise.all(
                revs.map(async (rev) => {
                    const leaf = await serviceModules.databaseFileAccess.fetchEntryMeta(filename, rev);
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
    log(
        `Resolving conflict by newest: ${filename} (Newest: ${new Date(mTimeAndRev[0][0]).toLocaleString()}) (${mTimeAndRev.length} revisions exists)`
    );
    for (let i = 1; i < mTimeAndRev.length; i++) {
        log(
            `conflict: Deleting the older revision ${mTimeAndRev[i][1]} (${new Date(mTimeAndRev[i][0]).toLocaleString()}) of ${filename}`
        );
        await services.conflict.resolveByDeletingRevision(filename, mTimeAndRev[i][1], "NEWEST");
    }
    return true;
};

export const resolveAllConflictedFilesByNewerOnesHandler = async (host: ConflictResolverHost) => {
    const { services, serviceModules } = host;
    const log = createConflictResolverLog(host);
    log(`Resolving conflicts by newer ones`, LOG_LEVEL_NOTICE);

    const files = await serviceModules.storageAccess.getFileNames();

    let i = 0;
    for (const file of files) {
        if (i++ % 10) {
            log(
                `Check and Processing ${i} / ${files.length}`,
                LOG_LEVEL_NOTICE,
                "resolveAllConflictedFilesByNewerOnes"
            );
        }
        await services.conflict.resolveByNewest(file);
    }
    log(`Done!`, LOG_LEVEL_NOTICE, "resolveAllConflictedFilesByNewerOnes");
};

export function useConflictResolver(host: ConflictResolverHost) {
    const { services } = host;

    services.conflict.resolveByDeletingRevision.setHandler(resolveConflictByDeletingRevHandler.bind(null, host));
    services.conflict.resolve.setHandler(resolveConflictHandler.bind(null, host));
    services.conflict.resolveByNewest.setHandler(resolveConflictByNewestHandler.bind(null, host));
    services.conflict.resolveAllConflictedFilesByNewerOnes.setHandler(
        resolveAllConflictedFilesByNewerOnesHandler.bind(null, host)
    );
}
