import {
    CANCELLED,
    LEAVE_TO_SUBSEQUENT,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    MISSING_OR_ERROR,
    type DocumentID,
    type FilePathWithPrefix,
    type diff_result,
} from "@lib/common/types.ts";
import { ConflictResolveModal } from "@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts";
import { displayRev } from "@lib/common/utils.ts";
import { fireAndForget } from "octagonal-wheels/promises";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { stripAllPrefixes } from "@lib/string_and_binary/path";
import type { ConflictResolverHost } from "./types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";

/**
 * Resolves a conflict using the user interface modal, one-by-one.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 * @param filename - The path of the conflicted file.
 * @param conflictCheckResult - The result of conflict detection / diff.
 * @returns A promise resolving to true if successfully resolved, otherwise false.
 */
export async function resolveConflictByUI(
    host: ConflictResolverHost,
    log: LogFunction,
    filename: FilePathWithPrefix,
    conflictCheckResult: diff_result
): Promise<boolean> {
    const app = host.context.app;
    if (!app) {
        log(`Merge: App instance not available`, LOG_LEVEL_VERBOSE);
        return false;
    }

    return await serialized(`conflict-resolve-ui`, async () => {
        log("Merge:open conflict dialog", LOG_LEVEL_VERBOSE);
        const dialog = new ConflictResolveModal(app, filename, conflictCheckResult);
        dialog.open();
        const selected = await dialog.waitForResult();
        if (selected === CANCELLED) {
            log(`Merge: Cancelled ${filename}`, LOG_LEVEL_INFO);
            return false;
        }

        const localDatabase = host.services.database.localDatabase;
        const testDoc = await localDatabase.getDBEntry(filename, { conflicts: true }, false, true, true);
        if (testDoc === false) {
            log(`Merge: Could not read ${filename} from the local database`, LOG_LEVEL_VERBOSE);
            return false;
        }
        if (!testDoc._conflicts) {
            log(`Merge: Nothing to do ${filename}`, LOG_LEVEL_VERBOSE);
            return false;
        }

        const toDelete = selected;
        if (toDelete === LEAVE_TO_SUBSEQUENT) {
            const p = conflictCheckResult.diff.map((e) => e[1]).join("");
            const delRev = testDoc._conflicts[0];
            if (!(await host.serviceModules.databaseFileAccess.storeContent(filename, p))) {
                log(`Concatenated content cannot be stored:${filename}`, LOG_LEVEL_NOTICE);
                return false;
            }
            if (
                (await host.services.conflict.resolveByDeletingRevision(filename, delRev, "UI Concatenated")) ===
                MISSING_OR_ERROR
            ) {
                log(
                    `Concatenated saved, but cannot delete conflicted revisions: ${filename}, (${displayRev(delRev)})`,
                    LOG_LEVEL_NOTICE
                );
                return false;
            }
        } else if (typeof toDelete === "string") {
            if (
                (await host.services.conflict.resolveByDeletingRevision(filename, toDelete, "UI Selected")) ===
                MISSING_OR_ERROR
            ) {
                log(`Merge: Something went wrong: ${filename}, (${toDelete})`, LOG_LEVEL_NOTICE);
                return false;
            }
        } else {
            log(`Merge: Something went wrong: ${filename}, (${toDelete as string})`, LOG_LEVEL_NOTICE);
            return false;
        }

        const settings = host.services.setting.settings;
        if (settings.syncAfterMerge && !host.services.appLifecycle.isSuspended()) {
            await host.services.replication.replicateByEvent();
        }

        await host.services.conflict.queueCheckFor(filename);
        return false;
    });
}

/**
 * Iteratively prompts the user to resolve all conflicted files.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 */
export async function allConflictCheck(host: ConflictResolverHost, log: LogFunction): Promise<void> {
    while (await pickFileForResolve(host, log));
}

/**
 * Prompts the user to pick a file from the list of conflicted files.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 * @returns A promise resolving to true if a file was selected and queued for checking, otherwise false.
 */
export async function pickFileForResolve(host: ConflictResolverHost, log: LogFunction): Promise<boolean> {
    const notes: { id: DocumentID; path: FilePathWithPrefix; dispPath: string; mtime: number }[] = [];
    const localDatabase = host.services.database.localDatabase;

    for await (const doc of localDatabase.findAllDocs({ conflicts: true })) {
        if (!("_conflicts" in doc)) continue;
        const path = host.services.path.getPath(doc);
        const dispPath = stripAllPrefixes(path);
        notes.push({
            id: doc._id,
            path,
            dispPath,
            mtime: doc.mtime,
        });
    }

    notes.sort((a, b) => b.mtime - a.mtime);
    const notesList = notes.map((e) => e.dispPath);
    if (notesList.length === 0) {
        log("There are no conflicted documents", LOG_LEVEL_NOTICE);
        return false;
    }

    const confirm = host.services.UI.confirm;
    const target = await confirm.askSelectString("File to resolve conflict", notesList);
    if (target) {
        const targetItem = notes.find((e) => e.dispPath === target)!;
        await host.services.conflict.queueCheckFor(targetItem.path);
        await host.services.conflict.ensureAllProcessed();
        return true;
    }
    return false;
}

/**
 * Scans the database for conflicted files and displays a safety popup if any are found.
 *
 * @param host - The service feature host context.
 * @param log - The logger function.
 * @returns A promise resolving to true if execution completes successfully, otherwise false.
 */
export async function allScanStat(host: ConflictResolverHost, log: LogFunction): Promise<boolean> {
    const notes: { path: string; mtime: number }[] = [];
    log(`Checking conflicted files`, LOG_LEVEL_VERBOSE);
    const localDatabase = host.services.database.localDatabase;

    try {
        for await (const doc of localDatabase.findAllDocs({ conflicts: true })) {
            if (!("_conflicts" in doc)) continue;
            const path = host.services.path.getPath(doc);
            notes.push({ path, mtime: doc.mtime });
        }

        if (notes.length > 0) {
            const confirm = host.services.UI.confirm;
            confirm.askInPopup(
                `conflicting-detected-on-safety`,
                `Some files have been left conflicted! Press {HERE} to resolve them, or you can do it later by "Pick a file to resolve conflict`,
                (anchor) => {
                    anchor.text = "HERE";
                    anchor.addEventListener("click", () => {
                        fireAndForget(() => allConflictCheck(host, log));
                    });
                }
            );
            log(
                `Some files have been left conflicted! Please resolve them by "Pick a file to resolve conflict". The list is written in the log.`,
                LOG_LEVEL_VERBOSE
            );
            for (const note of notes) {
                log(`Conflicted: ${note.path}`);
            }
        } else {
            log(`There are no conflicting files`, LOG_LEVEL_VERBOSE);
        }
    } catch (e) {
        log(`Error while scanning conflicted files...`, LOG_LEVEL_NOTICE);
        log(e, LOG_LEVEL_VERBOSE);
        return false;
    }
    return true;
}
