import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import type { FilePathWithPrefix, LoadedEntry, MetaEntry, DocumentID } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import { LOG_LEVEL_VERBOSE, LOG_LEVEL_INFO } from "@lib/common/types.ts";
import { ICHeader, ICHeaderEnd } from "@/common/types.ts";
import { isInternalMetadata } from "@/common/utils.ts";
import { getFileRegExp, sendSignal } from "@lib/common/utils.ts";
import { addPrefix, stripAllPrefixes } from "@lib/string_and_binary/path.ts";
import { JsonResolveModal } from "@/features/HiddenFileCommon/JsonResolveModal.ts";

import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";

import { getComparingMTime } from "./stateHelpers.ts";

import {
    writeFile,
    storeInternalFileToDatabase,
    extractInternalFileFromDatabase,
    triggerEvent,
    ensureDir,
} from "./databaseIO.ts";

/**
 * Enqueues a file path for a conflict check if it is not already pending.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The prefix-marked document path.
 */
export function queueConflictCheck(host: HiddenFileSyncHost, state: HiddenFileSyncState, path: FilePathWithPrefix) {
    if (state.pendingConflictChecks.has(path)) return;
    state.pendingConflictChecks.add(path);
    if (state.conflictResolutionProcessor) {
        state.conflictResolutionProcessor.enqueue(path);
    }
}

/**
 * Marks a conflict check as finished by removing the path from the pending conflicts set.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The prefix-marked document path.
 */
export function finishConflictCheck(state: HiddenFileSyncState, path: FilePathWithPrefix) {
    state.pendingConflictChecks.delete(path);
}

/**
 * Re-enqueues a file path for conflict check processing, clearing the previous state first.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The prefix-marked document path.
 */
export function requeueConflictCheck(host: HiddenFileSyncHost, state: HiddenFileSyncState, path: FilePathWithPrefix) {
    finishConflictCheck(state, path);
    queueConflictCheck(host, state, path);
}

/**
 * Scans the database for any conflicted hidden file entries and enqueues them for resolution.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 */
export async function resolveConflictOnInternalFiles(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState
) {
    const conflicted = host.services.database.localDatabase.findEntries(ICHeader, ICHeaderEnd, { conflicts: true });
    if (state.conflictResolutionProcessor) {
        state.conflictResolutionProcessor.suspend();
    }
    try {
        for await (const doc of conflicted) {
            if (!("_conflicts" in doc)) continue;
            if (isInternalMetadata(doc._id)) {
                queueConflictCheck(host, state, doc.path);
            }
        }
    } catch (ex) {
        log("something went wrong on resolving all conflicted internal files");
        log(ex, LOG_LEVEL_VERBOSE);
    }
    if (state.conflictResolutionProcessor) {
        await state.conflictResolutionProcessor.startPipeline().waitForAllProcessed();
    }
}

/**
 * Resolves a conflict automatically by keeping the revision with the newer modification timestamp and removing the older one.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param id - The Document ID in the database.
 * @param path - The prefix-marked file path.
 * @param currentDoc - The current metadata document version.
 * @param currentRev - The revision of the current document.
 * @param conflictedRev - The conflicted revision to compare.
 */
export async function resolveByNewerEntry(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    id: DocumentID,
    path: FilePathWithPrefix,
    currentDoc: MetaEntry,
    currentRev: string,
    conflictedRev: string
) {
    const conflictedDoc = await host.services.database.localDatabase.getRaw<MetaEntry>(id, { rev: conflictedRev });
    const mtimeCurrent = getComparingMTime(currentDoc, true);
    const mtimeConflicted = getComparingMTime(conflictedDoc, true);
    const delRev = mtimeCurrent < mtimeConflicted ? currentRev : conflictedRev;
    await host.services.database.localDatabase.removeRevision(id, delRev);
    log(`Older one has been deleted:${path}`);
    const cc = await host.services.database.localDatabase.getRaw(id, { conflicts: true });
    if (cc._conflicts?.length === 0) {
        await extractInternalFileFromDatabase(host, log, state, stripAllPrefixes(path));
        finishConflictCheck(state, path);
    } else {
        requeueConflictCheck(host, state, path);
    }
}

/**
 * Opens a JSON interactive merge dialogue to let the user resolve conflict revisions manually.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param docA - Loaded entry revision A.
 * @param docB - Loaded entry revision B.
 * @returns A promise resolving to true if the merge dialogue was successfully completed; otherwise, false.
 */
export function showJSONMergeDialogAndMerge(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    docA: LoadedEntry,
    docB: LoadedEntry
): Promise<boolean> {
    return new Promise((res) => {
        log("Opening data-merging dialog", LOG_LEVEL_VERBOSE);
        const docs = [docA, docB];
        const strippedPath = stripAllPrefixes(docA.path);
        const storageFilePath = strippedPath;
        const storeFilePath = strippedPath;
        const displayFilename = `${storeFilePath}`;
        sendSignal(`cancel-internal-conflict:${docA.path}`);
        const modal = new JsonResolveModal(host.context.app, storageFilePath, [docA, docB], async (keep, result) => {
            try {
                let needFlush = false;
                if (!result && !keep) {
                    log(`Skipped merging: ${displayFilename}`);
                    res(false);
                    return;
                }
                if (result || keep) {
                    for (const doc of docs) {
                        if (doc._rev != keep) {
                            const path = host.services.path.getPath(doc);
                            if (await host.services.database.localDatabase.deleteDBEntry(path, { rev: doc._rev })) {
                                log(`Conflicted revision has been deleted: ${displayFilename}`);
                                needFlush = true;
                            }
                        }
                    }
                }
                if (!keep && result) {
                    const isExists = await host.serviceModules.storageAccess.isExistsIncludeHidden(storageFilePath);
                    if (!isExists) {
                        await host.serviceModules.storageAccess.ensureDir(storageFilePath);
                    }
                    const stat = await writeFile(host, storageFilePath, result);
                    if (!stat) {
                        throw new Error("Stat failed");
                    }
                    const mtime = getComparingMTime(stat);
                    await storeInternalFileToDatabase(
                        host,
                        log,
                        state,
                        { path: storageFilePath, mtime, ctime: stat?.ctime ?? mtime, size: stat?.size ?? 0 },
                        true
                    );
                    await triggerEvent(host, log, storageFilePath);
                    log(`STORAGE <-- DB:${displayFilename}: written (hidden,merged)`);
                }
                if (needFlush) {
                    if (await extractInternalFileFromDatabase(host, log, state, storeFilePath, false)) {
                        log(`STORAGE --> DB:${displayFilename}: extracted (hidden,merged)`);
                    } else {
                        log(`STORAGE --> DB:${displayFilename}: extracted (hidden,merged) Failed`);
                    }
                }
                res(true);
            } catch (ex) {
                log("Could not merge conflicted json");
                log(ex, LOG_LEVEL_VERBOSE);
                res(false);
            }
        });
        modal.open();
    });
}

/**
 * Creates a QueueProcessor configuration to handle hidden file conflict resolution sequentially.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @returns A QueueProcessor managing file paths with conflicts.
 */
export function createConflictResolutionProcessor(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState
): QueueProcessor<FilePathWithPrefix, any> {
    return new QueueProcessor(
        async (paths: FilePathWithPrefix[]) => {
            const path = paths[0];
            try {
                const id = await host.services.path.path2id(path, ICHeader);
                const doc = await host.services.database.localDatabase.getRaw<MetaEntry>(id, { conflicts: true });
                if (doc._conflicts === undefined) {
                    finishConflictCheck(state, path);
                    return [];
                }
                if (doc._conflicts.length == 0) {
                    finishConflictCheck(state, path);
                    return [];
                }
                log(`Hidden file conflicted:${path}`);
                const conflicts = doc._conflicts.sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
                const revA = doc._rev;
                const revB = conflicts[0];

                if (path.endsWith(".json")) {
                    const conflictedRev = conflicts[0];
                    const conflictedRevNo = Number(conflictedRev.split("-")[0]);
                    const revFrom = await host.services.database.localDatabase.getRaw<MetaEntry>(id, {
                        revs_info: true,
                    });
                    const commonBase =
                        revFrom._revs_info
                            ?.filter((e) => e.status == "available" && Number(e.rev.split("-")[0]) < conflictedRevNo)
                            .first()?.rev ?? "";
                    const result = await host.services.database.localDatabase.managers.conflictManager.mergeObject(
                        doc.path,
                        commonBase,
                        doc._rev,
                        conflictedRev
                    );
                    if (result) {
                        log(`Object merge:${path}`, LOG_LEVEL_INFO);
                        const filename = stripAllPrefixes(path);
                        await ensureDir(host, filename);
                        const stat = await writeFile(host, filename, result);
                        if (!stat) {
                            throw new Error(`conflictResolutionProcessor: Failed to stat file ${filename}`);
                        }
                        await storeInternalFileToDatabase(host, log, state, { path: filename, ...stat });
                        await extractInternalFileFromDatabase(host, log, state, filename);
                        await host.services.database.localDatabase.removeRevision(id, revB);
                        requeueConflictCheck(host, state, path);
                        return [];
                    } else {
                        log(`Object merge is not applicable.`, LOG_LEVEL_VERBOSE);
                    }
                }
                const regExp = getFileRegExp(
                    host.services.setting.currentSettings(),
                    "syncInternalFileOverwritePatterns"
                );
                if (regExp.some((r) => r.test(stripAllPrefixes(path)))) {
                    log(`Overwrite rule applied for conflicted hidden file: ${path}`, LOG_LEVEL_INFO);
                    await resolveByNewerEntry(host, log, state, id, path, doc, revA, revB);
                    return [];
                }
                return [{ path, revA, revB, id, doc }];
            } catch (ex) {
                finishConflictCheck(state, path);
                log(`Failed to resolve conflict (Hidden): ${path}`);
                log(ex, LOG_LEVEL_VERBOSE);
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
                    const prefixedPath = addPrefix(path, ICHeader);
                    const docAMerge = await host.services.database.localDatabase.getDBEntry(prefixedPath, {
                        rev: revA,
                    });
                    const docBMerge = await host.services.database.localDatabase.getDBEntry(prefixedPath, {
                        rev: revB,
                    });
                    try {
                        if (docAMerge != false && docBMerge != false) {
                            if (await showJSONMergeDialogAndMerge(host, log, state, docAMerge, docBMerge)) {
                                requeueConflictCheck(host, state, path);
                            } else {
                                finishConflictCheck(state, path);
                            }
                            return;
                        } else {
                            await resolveByNewerEntry(host, log, state, id, path, doc, revA, revB);
                        }
                    } catch (ex) {
                        finishConflictCheck(state, path);
                        throw ex;
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
}
