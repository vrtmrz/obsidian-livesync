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
} from "../../lib/src/common/types.ts";
import { ConflictResolveModal } from "./InteractiveConflictResolving/ConflictResolveModal.ts";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { displayRev, getPath, getPathWithoutPrefix } from "../../common/utils.ts";
import { fireAndForget } from "octagonal-wheels/promises";
import { serialized } from "octagonal-wheels/concurrency/lock";
import type { LiveSyncCore } from "../../main.ts";

export class ModuleInteractiveConflictResolver extends AbstractObsidianModule {
    _everyOnloadStart(): Promise<boolean> {
        this.addCommand({
            id: "livesync-conflictcheck",
            name: "Pick a file to resolve conflict",
            callback: async () => {
                await this.pickFileForResolve();
            },
        });
        this.addCommand({
            id: "livesync-all-conflictcheck",
            name: "Resolve all conflicted files",
            callback: async () => {
                await this.allConflictCheck();
            },
        });
        return Promise.resolve(true);
    }

    async _anyResolveConflictByUI(filename: FilePathWithPrefix, conflictCheckResult: diff_result): Promise<boolean> {
        // UI for resolving conflicts should one-by-one.
        return await serialized(`conflict-resolve-ui`, async () => {
            this._log("Merge:open conflict dialog", LOG_LEVEL_VERBOSE);
            const dialog = new ConflictResolveModal(this.app, filename, conflictCheckResult);
            dialog.open();
            const selected = await dialog.waitForResult();
            if (selected === CANCELLED) {
                // Cancelled by UI, or another conflict.
                this._log(`Merge: Cancelled ${filename}`, LOG_LEVEL_INFO);
                return false;
            }
            const testDoc = await this.localDatabase.getDBEntry(filename, { conflicts: true }, false, true, true);
            if (testDoc === false) {
                this._log(`Merge: Could not read ${filename} from the local database`, LOG_LEVEL_VERBOSE);
                return false;
            }
            if (!testDoc._conflicts) {
                this._log(`Merge: Nothing to do ${filename}`, LOG_LEVEL_VERBOSE);
                return false;
            }
            const toDelete = selected;
            // const toKeep = conflictCheckResult.left.rev != toDelete ? conflictCheckResult.left.rev : conflictCheckResult.right.rev;
            if (toDelete === LEAVE_TO_SUBSEQUENT) {
                // Concatenate both conflicted revisions.
                // Create a new file by concatenating both conflicted revisions.
                const p = conflictCheckResult.diff.map((e) => e[1]).join("");
                const delRev = testDoc._conflicts[0];
                if (!(await this.core.databaseFileAccess.storeContent(filename, p))) {
                    this._log(`Concatenated content cannot be stored:${filename}`, LOG_LEVEL_NOTICE);
                    return false;
                }
                // 2. As usual, delete the conflicted revision and if there are no conflicts, write the resolved content to the storage.
                if (
                    (await this.services.conflict.resolveByDeletingRevision(filename, delRev, "UI Concatenated")) ==
                    MISSING_OR_ERROR
                ) {
                    this._log(
                        `Concatenated saved, but cannot delete conflicted revisions: ${filename}, (${displayRev(delRev)})`,
                        LOG_LEVEL_NOTICE
                    );
                    return false;
                }
            } else if (typeof toDelete === "string") {
                // Select one of the conflicted revision to delete.
                if (
                    (await this.services.conflict.resolveByDeletingRevision(filename, toDelete, "UI Selected")) ==
                    MISSING_OR_ERROR
                ) {
                    this._log(`Merge: Something went wrong: ${filename}, (${toDelete})`, LOG_LEVEL_NOTICE);
                    return false;
                }
            } else {
                this._log(`Merge: Something went wrong: ${filename}, (${toDelete})`, LOG_LEVEL_NOTICE);
                return false;
            }
            // In here, some merge has been processed.
            // So we have to run replication if configured.
            // TODO: Make this is as a event request
            if (this.settings.syncAfterMerge && !this.services.appLifecycle.isSuspended()) {
                await this.services.replication.replicateByEvent();
            }
            // And, check it again.
            await this.services.conflict.queueCheckFor(filename);
            return false;
        });
    }
    async allConflictCheck() {
        while (await this.pickFileForResolve());
    }

    async pickFileForResolve() {
        const notes: { id: DocumentID; path: FilePathWithPrefix; dispPath: string; mtime: number }[] = [];
        for await (const doc of this.localDatabase.findAllDocs({ conflicts: true })) {
            if (!("_conflicts" in doc)) continue;
            notes.push({ id: doc._id, path: getPath(doc), dispPath: getPathWithoutPrefix(doc), mtime: doc.mtime });
        }
        notes.sort((a, b) => b.mtime - a.mtime);
        const notesList = notes.map((e) => e.dispPath);
        if (notesList.length == 0) {
            this._log("There are no conflicted documents", LOG_LEVEL_NOTICE);
            return false;
        }
        const target = await this.core.confirm.askSelectString("File to resolve conflict", notesList);
        if (target) {
            const targetItem = notes.find((e) => e.dispPath == target)!;
            await this.services.conflict.queueCheckFor(targetItem.path);
            await this.services.conflict.ensureAllProcessed();
            return true;
        }
        return false;
    }

    async _allScanStat(): Promise<boolean> {
        const notes: { path: string; mtime: number }[] = [];
        this._log(`Checking conflicted files`, LOG_LEVEL_VERBOSE);
        try {
            for await (const doc of this.localDatabase.findAllDocs({ conflicts: true })) {
                if (!("_conflicts" in doc)) continue;
                notes.push({ path: getPath(doc), mtime: doc.mtime });
            }
            if (notes.length > 0) {
                this.core.confirm.askInPopup(
                    `conflicting-detected-on-safety`,
                    `Some files have been left conflicted! Press {HERE} to resolve them, or you can do it later by "Pick a file to resolve conflict`,
                    (anchor) => {
                        anchor.text = "HERE";
                        anchor.addEventListener("click", () => {
                            fireAndForget(() => this.allConflictCheck());
                        });
                    }
                );
                this._log(
                    `Some files have been left conflicted! Please resolve them by "Pick a file to resolve conflict". The list is written in the log.`,
                    LOG_LEVEL_VERBOSE
                );
                for (const note of notes) {
                    this._log(`Conflicted: ${note.path}`);
                }
            } else {
                this._log(`There are no conflicting files`, LOG_LEVEL_VERBOSE);
            }
        } catch (e) {
            this._log(`Error while scanning conflicted files: ${e}`, LOG_LEVEL_NOTICE);
            this._log(e, LOG_LEVEL_VERBOSE);
            return false;
        }
        return true;
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onScanningStartupIssues.addHandler(this._allScanStat.bind(this));
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
        services.conflict.resolveByUserInteraction.addHandler(this._anyResolveConflictByUI.bind(this));
    }
}
