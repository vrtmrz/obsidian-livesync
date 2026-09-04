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
import { serialized } from "octagonal-wheels/concurrency/lock";
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
    readonly dispose: () => void;
    readonly invalidateWaitingResolution: (filename: FilePathWithPrefix) => void;
    readonly getActiveConflictMessages: () => Promise<string[]>;
    readonly refreshConflictState: (filename: FilePathWithPrefix) => Promise<void>;
    readonly requestConflictResolution: (filename: FilePathWithPrefix) => Promise<void>;
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
    let disposed = false;

    const invalidateWaitingResolution = (filename: FilePathWithPrefix): void => {
        // An active dialogue consumes this event itself. Removing its request
        // here would also remove a same-path replacement which emitted the
        // event to close that active dialogue. A non-active request is stale
        // and must not open after an external resolution.
        if (activeDialogue?.filename === filename) return;
        latestRequestByFilename.delete(filename);
    };

    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        latestRequestByFilename.clear();
        postponedConflictEpisodes.clear();
        const activeFilename = activeDialogue?.filename;
        if (activeFilename !== undefined) {
            dependencies.events.emitEvent(EVENT_CONFLICT_CANCELLED, activeFilename);
            activeDialogue = undefined;
        }
    };

    const getConflictVersionCount = async (filename: FilePathWithPrefix): Promise<number | undefined> => {
        try {
            const conflictCount = (await dependencies.databaseFileAccess.getConflictedRevs(filename)).length;
            return conflictCount === 0 ? 0 : conflictCount + 1;
        } catch (error) {
            dependencies.log(`Could not inspect the conflict state of ${filename}`, LOG_LEVEL_VERBOSE);
            dependencies.log(error, LOG_LEVEL_VERBOSE);
            return undefined;
        }
    };

    const getActiveConflictMessages = async (): Promise<string[]> => {
        const filename = dependencies.vault.getActiveFilePath();
        if (!filename) return [];
        const versionCount = await getConflictVersionCount(filename);
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
        if ((await getConflictVersionCount(filename)) === 0) {
            postponedConflictEpisodes.delete(filename);
        }
        dependencies.events.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
    };

    const requestConflictResolution = async (filename: FilePathWithPrefix): Promise<void> => {
        postponedConflictEpisodes.delete(filename);
        dependencies.events.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
        await dependencies.conflict.queueCheckFor(filename);
        await dependencies.conflict.ensureAllProcessed();
    };

    const resolveByUserInteraction = async (
        filename: FilePathWithPrefix,
        conflictCheckResult: diff_result
    ): Promise<boolean> => {
        if (disposed) return false;
        const requestId = ++nextRequestId;
        if (activeDialogue?.filename === filename) {
            dependencies.events.emitEvent(EVENT_CONFLICT_CANCELLED, filename);
            activeDialogue = undefined;
        }
        latestRequestByFilename.set(filename, requestId);

        // UI for resolving different files should proceed one-by-one. A newer
        // request for the active file replaces its dialogue instead of waiting
        // behind a comparison which is already stale.
        return await serialized(dialogueSerialisationKey, async () => {
            if (disposed || latestRequestByFilename.get(filename) !== requestId) {
                return false;
            }
            try {
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
                    dialogue.open();
                    selected = await dialogue.waitForResult();
                } finally {
                    if (activeDialogue?.dialogue === dialogue) {
                        activeDialogue = undefined;
                    }
                }
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
                    if (!(await dependencies.databaseFileAccess.storeContent(filename, p))) {
                        dependencies.log(`Concatenated content cannot be stored:${filename}`, LOG_LEVEL_NOTICE);
                        return false;
                    }
                    // 2. As usual, delete the conflicted revision and if there are no conflicts, write the resolved content to the storage.
                    if (
                        (await dependencies.conflict.resolveByDeletingRevision(filename, delRev, "UI Concatenated")) ==
                        MISSING_OR_ERROR
                    ) {
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
                    if (
                        (await dependencies.conflict.resolveByDeletingRevision(filename, toDelete, "UI Selected")) ==
                        MISSING_OR_ERROR
                    ) {
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
            } finally {
                if (latestRequestByFilename.get(filename) === requestId) {
                    latestRequestByFilename.delete(filename);
                }
            }
        });
    };

    const pickFileForResolve = async (notifyIfEmpty = true): Promise<boolean> => {
        const notes: { id: DocumentID; path: FilePathWithPrefix; dispPath: string; mtime: number }[] = [];
        for await (const doc of dependencies.localDatabase().findAllDocs({ conflicts: true })) {
            if (!("_conflicts" in doc)) continue;
            notes.push({
                id: doc._id,
                path: dependencies.path.getPath(doc),
                dispPath: stripAllPrefixes(dependencies.path.getPath(doc)),
                mtime: doc.mtime,
            });
        }
        notes.sort((a, b) => b.mtime - a.mtime);
        const notesList = notes.map((e) => e.dispPath);
        if (notesList.length == 0) {
            if (notifyIfEmpty) {
                dependencies.log("There are no conflicted documents", LOG_LEVEL_NOTICE);
            }
            return false;
        }
        const target = await dependencies.confirm.askSelectString("File to resolve conflict", notesList);
        if (target) {
            const targetItem = notes.find((e) => e.dispPath == target)!;
            await requestConflictResolution(targetItem.path);
            return true;
        }
        return false;
    };

    const allConflictCheck = async (): Promise<void> => {
        let notifyIfEmpty = true;
        while (await pickFileForResolve(notifyIfEmpty)) {
            notifyIfEmpty = false;
        }
    };

    const scanStartupIssues = async (): Promise<boolean> => {
        const notes: { path: string; mtime: number }[] = [];
        dependencies.log(`Checking conflicted files`, LOG_LEVEL_VERBOSE);
        try {
            for await (const doc of dependencies.localDatabase().findAllDocs({ conflicts: true })) {
                if (!("_conflicts" in doc)) continue;
                notes.push({ path: dependencies.path.getPath(doc), mtime: doc.mtime });
            }
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
        dispose,
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
