import {
    CANCELLED,
    LEAVE_TO_SUBSEQUENT,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    MISSING_OR_ERROR,
    type DocumentID,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
    type diff_result,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import type { DatabaseFileAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseFileAccess";
import type {
    IAppLifecycleService,
    IConflictService,
    IPathService,
    IReplicationService,
    IVaultService,
} from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { LiveSyncEventHub } from "@vrtmrz/livesync-commonlib/context";
import { fireAndForget } from "octagonal-wheels/promises";
import { withLock } from "octagonal-wheels/concurrency/lock";
import { withCancellation } from "octagonal-wheels/concurrency/cancellation";
import { withScope } from "octagonal-wheels/resource/scope";
import { NO_INTERACTION } from "@vrtmrz/livesync-commonlib/replication";
import { displayRev } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { EVENT_CONFLICT_CANCELLED, EVENT_ON_UNRESOLVED_ERROR } from "@/common/events.ts";
import { $msg } from "@/common/translation.ts";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import {
    POSTPONED,
    type ConflictResolveDialogue,
    type ConflictResolveDialogueFactory,
    type MergeDialogResult,
} from "./types";

export interface InteractiveConflictResolutionOperationsDependencies {
    readonly events: Pick<LiveSyncEventHub, "emitEvent">;
    readonly signal: AbortSignal;
    readonly databaseFileAccess: Pick<DatabaseFileAccess, "getConflictedRevs" | "storeContent">;
    readonly localDatabase: () => Pick<LiveSyncLocalDB, "getDBEntry" | "findAllDocs">;
    readonly confirm: Pick<Confirm, "askSelectString" | "askInPopup">;
    readonly path: Pick<IPathService, "getPath">;
    readonly vault: Pick<IVaultService, "getActiveFilePath">;
    readonly appLifecycle: Pick<IAppLifecycleService, "isSuspended">;
    readonly conflict: Pick<IConflictService, "queueCheckFor" | "ensureAllProcessed" | "resolveByDeletingRevision">;
    readonly replication: Pick<IReplicationService, "replicateUnattendedByEvent">;
    readonly currentSettings: () => Pick<ObsidianLiveSyncSettings, "syncAfterMerge">;
    readonly createDialogue: ConflictResolveDialogueFactory;
    readonly log: LogFunction;
}

export interface InteractiveConflictResolutionOperations {
    readonly invalidateWaitingResolution: (filename: FilePathWithPrefix) => void;
    readonly getActiveConflictMessages: () => Promise<string[]>;
    readonly refreshConflictState: (filename: FilePathWithPrefix) => Promise<void>;
    /** Returns false if the requested conflict check was cancelled. */
    readonly requestConflictResolution: (filename: FilePathWithPrefix) => Promise<boolean>;
    readonly resolveByUserInteraction: (
        filename: FilePathWithPrefix,
        conflictCheckResult: diff_result
    ) => Promise<boolean>;
    readonly allConflictCheck: () => Promise<void>;
    readonly pickFileForResolve: (notifyIfEmpty?: boolean) => Promise<boolean>;
    readonly scanStartupIssues: () => Promise<boolean>;
}

export function createInteractiveConflictResolutionOperations(
    dependencies: InteractiveConflictResolutionOperationsDependencies
): InteractiveConflictResolutionOperations {
    // This state deliberately belongs to one feature composition. It must not
    // survive a plug-in unload or be shared with another host context.
    const postponedConflictEpisodes = new Set<FilePathWithPrefix>();
    const dialogueSerialisationKey = Symbol("conflict-resolve-ui");
    const latestRequestByFilename = new Map<FilePathWithPrefix, number>();
    let nextRequestId = 0;
    let activeDialogue: { filename: FilePathWithPrefix; dialogue: ConflictResolveDialogue } | undefined;
    const clearPendingState = (): void => {
        latestRequestByFilename.clear();
        postponedConflictEpisodes.clear();
    };
    if (dependencies.signal.aborted) {
        clearPendingState();
    } else {
        dependencies.signal.addEventListener("abort", clearPendingState, { once: true });
    }

    const invalidateWaitingResolution = (filename: FilePathWithPrefix): void => {
        if (dependencies.signal.aborted) return;
        // An active dialogue consumes this event itself. Removing its request
        // here would also remove a same-path replacement which emitted the
        // event to close that active dialogue. A non-active request is stale
        // and must not open after an external resolution.
        if (activeDialogue?.filename === filename) return;
        latestRequestByFilename.delete(filename);
    };

    const getConflictVersionCount = async (filename: FilePathWithPrefix): Promise<number | undefined> => {
        if (dependencies.signal.aborted) return undefined;
        try {
            const conflictCount = (await dependencies.databaseFileAccess.getConflictedRevs(filename)).length;
            if (dependencies.signal.aborted) return undefined;
            return conflictCount === 0 ? 0 : conflictCount + 1;
        } catch (error) {
            dependencies.log(`Could not inspect the conflict state of ${filename}`, LOG_LEVEL_VERBOSE);
            dependencies.log(error, LOG_LEVEL_VERBOSE);
            return undefined;
        }
    };

    const getActiveConflictMessages = async (): Promise<string[]> => {
        if (dependencies.signal.aborted) return [];
        const filename = dependencies.vault.getActiveFilePath();
        if (!filename) return [];
        const versionCount = await getConflictVersionCount(filename);
        if (dependencies.signal.aborted) return [];
        if (versionCount === 0) {
            postponedConflictEpisodes.delete(filename);
            return [];
        }
        if (versionCount !== undefined && versionCount >= 3) {
            return [
                $msg("This file has ${COUNT} unresolved versions. They will be reviewed one pair at a time.", {
                    COUNT: `${versionCount}`,
                }),
            ];
        }
        if (versionCount === 2 || postponedConflictEpisodes.has(filename)) {
            return [$msg("This file has unresolved conflicts.")];
        }
        return [];
    };

    const refreshConflictState = async (filename: FilePathWithPrefix): Promise<void> => {
        if (dependencies.signal.aborted) return;
        const versionCount = await getConflictVersionCount(filename);
        if (dependencies.signal.aborted) return;
        if (versionCount === 0) {
            postponedConflictEpisodes.delete(filename);
        }
        dependencies.events.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
    };

    const requestConflictResolution = async (filename: FilePathWithPrefix): Promise<boolean> => {
        if (dependencies.signal.aborted) return false;
        postponedConflictEpisodes.delete(filename);
        dependencies.events.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
        await dependencies.conflict.queueCheckFor(filename);
        if (dependencies.signal.aborted) return false;
        return await dependencies.conflict.ensureAllProcessed();
    };

    const resolveByUserInteraction = async (
        filename: FilePathWithPrefix,
        conflictCheckResult: diff_result
    ): Promise<boolean> => {
        if (dependencies.signal.aborted) return false;
        return await withScope(undefined, async (request) => {
            if (dependencies.signal.aborted) return false;
            const requestId = ++nextRequestId;
            if (activeDialogue?.filename === filename) {
                dependencies.events.emitEvent(EVENT_CONFLICT_CANCELLED, filename);
                activeDialogue = undefined;
            }
            latestRequestByFilename.set(filename, requestId);
            request.defer(() => {
                if (latestRequestByFilename.get(filename) === requestId) {
                    latestRequestByFilename.delete(filename);
                }
            });

            // UI for resolving different files should proceed one-by-one. A newer
            // request for the active file replaces its dialogue instead of waiting
            // behind a comparison which is already stale.
            return await withLock(dialogueSerialisationKey, async () => {
                if (dependencies.signal.aborted || latestRequestByFilename.get(filename) !== requestId) {
                    return false;
                }
                if (postponedConflictEpisodes.has(filename)) {
                    dependencies.log(`Merge: Postponed ${filename}`, LOG_LEVEL_VERBOSE);
                    dependencies.events.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
                    return false;
                }
                dependencies.log("Merge:open conflict dialog", LOG_LEVEL_VERBOSE);
                const dialogue = dependencies.createDialogue(filename, conflictCheckResult);
                activeDialogue = { filename, dialogue };
                let selected: MergeDialogResult;
                try {
                    selected = await withCancellation(dialogue, { signal: dependencies.signal }, async (waiting) => {
                        const cancelDialogue = (): void => {
                            if (activeDialogue?.dialogue === dialogue) {
                                dependencies.events.emitEvent(EVENT_CONFLICT_CANCELLED, filename);
                            }
                        };
                        waiting.signal.addEventListener("abort", cancelDialogue, { once: true });
                        waiting.defer(() => waiting.signal.removeEventListener("abort", cancelDialogue));
                        dialogue.open();
                        if (waiting.isCancelled()) cancelDialogue();
                        return await dialogue.waitForResult();
                    });
                } finally {
                    if (activeDialogue?.dialogue === dialogue) {
                        activeDialogue = undefined;
                    }
                }
                if (dependencies.signal.aborted) return false;
                if (selected === POSTPONED) {
                    postponedConflictEpisodes.add(filename);
                    dependencies.events.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
                    dependencies.log(`Merge: Postponed ${filename}`, LOG_LEVEL_INFO);
                    return false;
                }
                if (selected === CANCELLED) {
                    // Cancelled by UI, or another conflict.
                    dependencies.log(`Merge: Cancelled ${filename}`, LOG_LEVEL_INFO);
                    return false;
                }
                const testDoc = await dependencies
                    .localDatabase()
                    .getDBEntry(filename, { conflicts: true }, false, true, true);
                if (testDoc === false) {
                    dependencies.log(`Merge: Could not read ${filename} from the local database`, LOG_LEVEL_VERBOSE);
                    return false;
                }
                if (!testDoc._conflicts || testDoc._conflicts.length === 0) {
                    dependencies.log(`Merge: Nothing to do ${filename}`, LOG_LEVEL_VERBOSE);
                    await refreshConflictState(filename);
                    if (dependencies.signal.aborted) return false;
                    return false;
                }
                if (
                    testDoc._rev !== conflictCheckResult.left.rev ||
                    !testDoc._conflicts.includes(conflictCheckResult.right.rev)
                ) {
                    dependencies.log(
                        `Merge: The compared revisions changed while the dialogue was open: ${filename}`,
                        LOG_LEVEL_INFO
                    );
                    await refreshConflictState(filename);
                    if (dependencies.signal.aborted) return false;
                    await dependencies.conflict.queueCheckFor(filename);
                    return false;
                }
                const toDelete = selected;
                // const toKeep = conflictCheckResult.left.rev != toDelete ? conflictCheckResult.left.rev : conflictCheckResult.right.rev;
                if (toDelete === LEAVE_TO_SUBSEQUENT) {
                    // Concatenate both conflicted revisions.
                    // Create a new file by concatenating both conflicted revisions.
                    const p = conflictCheckResult.diff.map((e) => e[1]).join("");
                    const delRev = conflictCheckResult.right.rev;
                    const contentStored = await dependencies.databaseFileAccess.storeContent(filename, p);
                    if (!contentStored) {
                        dependencies.log(`Concatenated content cannot be stored:${filename}`, LOG_LEVEL_NOTICE);
                        return false;
                    }
                    // 2. As usual, delete the conflicted revision and if there are no conflicts, write the resolved content to the storage.
                    const deletionResult = await dependencies.conflict.resolveByDeletingRevision(
                        filename,
                        delRev,
                        "UI Concatenated"
                    );
                    if (deletionResult == MISSING_OR_ERROR) {
                        dependencies.log(
                            `Concatenated saved, but cannot delete conflicted revisions: ${filename}, (${displayRev(delRev)})`,
                            LOG_LEVEL_NOTICE
                        );
                        return false;
                    }
                } else if (
                    typeof toDelete === "string" &&
                    (toDelete === conflictCheckResult.left.rev || toDelete === conflictCheckResult.right.rev)
                ) {
                    // Select one of the conflicted revision to delete.
                    const deletionResult = await dependencies.conflict.resolveByDeletingRevision(
                        filename,
                        toDelete,
                        "UI Selected"
                    );
                    if (deletionResult == MISSING_OR_ERROR) {
                        dependencies.log(`Merge: Something went wrong: ${filename}, (${toDelete})`, LOG_LEVEL_NOTICE);
                        return false;
                    }
                } else {
                    dependencies.log(
                        `Merge: Something went wrong: ${filename}, (${String(toDelete)})`,
                        LOG_LEVEL_NOTICE
                    );
                    return false;
                }
                // In here, some merge has been processed.
                // So we have to run replication if configured.
                // TODO: Make this is as a event request
                if (dependencies.currentSettings().syncAfterMerge && !dependencies.appLifecycle.isSuspended()) {
                    await dependencies.replication.replicateUnattendedByEvent({
                        trigger: "merge",
                        interaction: NO_INTERACTION,
                    });
                }
                // And, check it again.
                await dependencies.conflict.queueCheckFor(filename);
                return false;
            });
        });
    };

    const pickFileForResolve = async (notifyIfEmpty = true): Promise<boolean> => {
        if (dependencies.signal.aborted) return false;
        const notes: { id: DocumentID; path: FilePathWithPrefix; dispPath: string; mtime: number }[] = [];
        for await (const doc of dependencies.localDatabase().findAllDocs({ conflicts: true })) {
            if (dependencies.signal.aborted) return false;
            if (!("_conflicts" in doc)) continue;
            notes.push({
                id: doc._id,
                path: dependencies.path.getPath(doc),
                dispPath: stripAllPrefixes(dependencies.path.getPath(doc)),
                mtime: doc.mtime,
            });
        }
        if (dependencies.signal.aborted) return false;
        notes.sort((a, b) => b.mtime - a.mtime);
        const notesList = notes.map((e) => e.dispPath);
        if (notesList.length == 0) {
            if (notifyIfEmpty) {
                dependencies.log("There are no conflicted documents", LOG_LEVEL_NOTICE);
            }
            return false;
        }
        const target = await dependencies.confirm.askSelectString("File to resolve conflict", notesList);
        if (dependencies.signal.aborted) return false;
        if (target) {
            const targetItem = notes.find((e) => e.dispPath == target)!;
            await requestConflictResolution(targetItem.path);
            return true;
        }
        return false;
    };

    const allConflictCheck = async (): Promise<void> => {
        let notifyIfEmpty = true;
        while (!dependencies.signal.aborted && (await pickFileForResolve(notifyIfEmpty))) {
            notifyIfEmpty = false;
        }
    };

    const scanStartupIssues = async (): Promise<boolean> => {
        if (dependencies.signal.aborted) return false;
        const notes: { path: string; mtime: number }[] = [];
        dependencies.log(`Checking conflicted files`, LOG_LEVEL_VERBOSE);
        try {
            for await (const doc of dependencies.localDatabase().findAllDocs({ conflicts: true })) {
                if (dependencies.signal.aborted) return false;
                if (!("_conflicts" in doc)) continue;
                notes.push({ path: dependencies.path.getPath(doc), mtime: doc.mtime });
            }
            if (dependencies.signal.aborted) return false;
            if (notes.length > 0) {
                dependencies.confirm.askInPopup(
                    `conflicting-detected-on-safety`,
                    `Some files have been left conflicted! Press {HERE} to resolve them, or you can do it later by "Pick a file to resolve conflict`,
                    (anchor) => {
                        anchor.text = "HERE";
                        anchor.addEventListener("click", () => {
                            fireAndForget(() => allConflictCheck());
                        });
                    }
                );
                dependencies.log(
                    `Some files have been left conflicted! Please resolve them by "Pick a file to resolve conflict". The list is written in the log.`,
                    LOG_LEVEL_VERBOSE
                );
                for (const note of notes) {
                    dependencies.log(`Conflicted: ${note.path}`);
                }
            } else {
                dependencies.log(`There are no conflicting files`, LOG_LEVEL_VERBOSE);
            }
        } catch (error) {
            dependencies.log(`Error while scanning conflicted files...`, LOG_LEVEL_NOTICE);
            dependencies.log(error, LOG_LEVEL_VERBOSE);
            return false;
        }
        return true;
    };

    return {
        invalidateWaitingResolution,
        getActiveConflictMessages,
        refreshConflictState,
        requestConflictResolution,
        resolveByUserInteraction,
        allConflictCheck,
        pickFileForResolve,
        scanStartupIssues,
    };
}
