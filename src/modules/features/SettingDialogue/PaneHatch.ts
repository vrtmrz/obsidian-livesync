import {
    type FilePathWithPrefix,
    type DocumentID,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type MetaEntry,
    type FilePath,
    type EntryDoc,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { readAsBlob } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { Logger } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import { shouldBeIgnored } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { $msg } from "@/common/translation";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import {
    EVENT_ANALYSE_DB_USAGE,
    EVENT_REQUEST_CHECK_REMOTE_SIZE,
    EVENT_REQUEST_RUN_DOCTOR,
    EVENT_REQUEST_RUN_FIX_INCOMPLETE,
    eventHub,
} from "@/common/events.ts";
import { ICHeader } from "@/common/types.ts";
import { HiddenFileSync } from "@/features/HiddenFileSync/CmdHiddenFileSync.ts";
import { EVENT_REQUEST_SHOW_HISTORY } from "@/common/obsidianEvents.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { isNotFoundError } from "@vrtmrz/livesync-commonlib/compat/common/utils.doc";
import {
    chooseAndCopyFileDatabaseInfo,
    collectFileDatabaseInfoPaths,
    copyFileDatabaseInfo,
    retryReadFileDatabaseRevision,
} from "@/serviceFeatures/fileDatabaseInfo.ts";
import {
    discardUnreadableLiveRevision,
    inspectFileRepair,
    type FileRepairInspection,
    type FileRepairRevision,
} from "@/serviceFeatures/fileRepair.ts";
export function paneHatch(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    // const hatchWarn = this.createEl(paneEl, "div", { text: `To stop the boot up sequence for fixing problems on databases, you can put redflag.md on top of your vault (Rebooting obsidian is required).` });
    // hatchWarn.addClass("op-warn-info");
    void addPanel(paneEl, $msg("Setting.TroubleShooting")).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Setting.TroubleShooting.Doctor"))
            .setDesc($msg("Setting.TroubleShooting.Doctor.Desc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Run Doctor"))
                    .setCta()
                    .setDisabled(false)
                    .onClick(() => {
                        this.closeSetting();
                        eventHub.emitEvent(EVENT_REQUEST_RUN_DOCTOR, "you wanted(Thank you)!");
                    })
            );
        new Setting(paneEl)
            .setName($msg("Setting.TroubleShooting.ScanBrokenFiles"))
            .setDesc($msg("Setting.TroubleShooting.ScanBrokenFiles.Desc"))
            .addButton((button) =>
                button
                    .setButtonText("Scan for Broken files")
                    .setCta()
                    .setDisabled(false)
                    .onClick(() => {
                        this.closeSetting();
                        eventHub.emitEvent(EVENT_REQUEST_RUN_FIX_INCOMPLETE);
                    })
            );

        new Setting(paneEl).setName($msg("Prepare the 'report' to create an issue")).addButton((button) =>
            button
                .setButtonText($msg("Copy Report to clipboard"))
                .setCta()
                .setDisabled(false)
                .onClick(async () => {
                    await this.app.commands.executeCommandById("obsidian-livesync:dump-debug-info");
                })
        );
        new Setting(paneEl)
            .setName($msg("Copy database information for a file"))
            .setDesc(
                $msg(
                    "Copy revision, conflict, and local chunk availability information, including document and chunk identifiers but not file contents."
                )
            )
            .addButton((button) =>
                button.setButtonText($msg("Choose file")).onClick(async () => {
                    await chooseAndCopyFileDatabaseInfo(this.core);
                })
            );
        new Setting(paneEl)
            .setName($msg("Analyse database usage"))
            .setDesc(
                $msg(
                    "Analyse database usage and generate a TSV report for diagnosis yourself. You can paste the generated report with any spreadsheet you like."
                )
            )
            .addButton((button) =>
                button.setButtonText($msg("Analyse")).onClick(() => {
                    eventHub.emitEvent(EVENT_ANALYSE_DB_USAGE);
                })
            );
        new Setting(paneEl)
            .setName($msg("Reset notification threshold and check the remote database usage"))
            .setDesc($msg("Reset the remote storage size threshold and check the remote storage size again."))
            .addButton((button) =>
                button.setButtonText($msg("Check")).onClick(() => {
                    eventHub.emitEvent(EVENT_REQUEST_CHECK_REMOTE_SIZE);
                })
            );
        new Setting(paneEl).autoWireToggle("writeLogToTheFile");
    });

    void addPanel(paneEl, "Scram Switches").then((paneEl) => {
        new Setting(paneEl).autoWireToggle("suspendFileWatching");
        this.addOnSaved("suspendFileWatching", () => this.services.appLifecycle.askRestart());

        new Setting(paneEl).autoWireToggle("suspendParseReplicationResult");
        this.addOnSaved("suspendParseReplicationResult", () => this.services.appLifecycle.askRestart());
    });

    void addPanel(paneEl, "Recovery and Repair").then((paneEl) => {
        const resultArea = paneEl.createDiv({ text: "", cls: "sls-repair-results" });
        const addActionButton = (
            parent: HTMLElement,
            text: string,
            action: (button: HTMLButtonElement) => Promise<void> | void,
            warning = false
        ) => {
            this.createEl(parent, "button", { text }, (button) => {
                if (warning) {
                    button.addClass("mod-warning");
                }
                button.onClickEvent(async () => {
                    button.disabled = true;
                    try {
                        await action(button);
                    } finally {
                        if (button.isConnected) {
                            button.disabled = false;
                        }
                    }
                });
            });
        };
        const storeStorageInDatabase = async (path: string): Promise<boolean> => {
            if (path.startsWith(".")) {
                const addOn = this.core.getAddOn<HiddenFileSync>(HiddenFileSync.name);
                if (!addOn) {
                    return false;
                }
                const file = (await addOn.scanInternalFiles()).find((entry) => entry.path === path);
                if (!file) {
                    Logger(`Failed to find the file in the internal files: ${path}`, LOG_LEVEL_NOTICE);
                    return false;
                }
                return Boolean(await addOn.storeInternalFileToDatabase(file, true));
            }
            return Boolean(await this.core.fileHandler.storeFileToDB(path as FilePath, true));
        };
        const applyWinnerToStorage = async (
            path: string,
            revision: FileRepairRevision
        ): Promise<boolean> => {
            if (revision.loadedEntry === false) {
                return false;
            }
            if (revision.loadedEntry.path.startsWith(ICHeader)) {
                const addOn = this.core.getAddOn<HiddenFileSync>(HiddenFileSync.name);
                return addOn
                    ? Boolean(await addOn.extractInternalFileFromDatabase(path as FilePath, true))
                    : false;
            }
            return Boolean(await this.core.fileHandler.dbToStorage(revision.loadedEntry as MetaEntry, null, true));
        };
        const addRepairResult = (inspection: FileRepairInspection) => {
            const { information, revisions } = inspection;
            const path = information.path;
            const card = this.createEl(resultArea, "div", { cls: "sls-repair-result" });
            const refresh = async () => {
                card.remove();
                const refreshed = await inspectFileRepair(this.core, path);
                if (refreshed.requiresAttention) {
                    addRepairResult(refreshed);
                } else {
                    Logger(`Verification no longer reports a problem for ${path}`, LOG_LEVEL_NOTICE);
                }
            };

            this.createEl(card, "h6", { text: path });
            if (information.storage.exists) {
                this.createEl(card, "div", {
                    text: $msg("Vault file: modified ${TIME}, size ${SIZE}", {
                        TIME: new Date(information.storage.mtime ?? 0).toLocaleString(),
                        SIZE: `${information.storage.size ?? 0}`,
                    }),
                });
            } else {
                this.createEl(card, "div", { text: $msg("Vault file: missing") });
            }
            if (!information.database.exists) {
                this.createEl(card, "div", { text: $msg("Local database document: missing") });
            }

            const addRevision = (revision: FileRepairRevision) => {
                const { metadata } = revision;
                const revisionEl = this.createEl(card, "div", { cls: "sls-repair-revision" });
                this.createEl(revisionEl, "div", {
                    text: $msg("${ROLE}: ${REVISION}", {
                        ROLE: revision.role === "winner" ? $msg("Winner revision") : $msg("Conflict revision"),
                        REVISION: metadata.revision ?? $msg("Unknown revision"),
                    }),
                    cls: "sls-repair-revision-title",
                });
                if (metadata.deleted) {
                    this.createEl(revisionEl, "div", { text: $msg("Logical deletion") });
                } else if (revision.contentReadable) {
                    this.createEl(revisionEl, "div", {
                        text: $msg("Readable on this device; recorded size ${RECORDED}, decoded size ${ACTUAL}", {
                            RECORDED: `${metadata.recordedSize}`,
                            ACTUAL: `${revision.loadedEntry === false ? 0 : readAsBlob(revision.loadedEntry).size}`,
                        }),
                    });
                } else {
                    const missing = metadata.chunks.filter(
                        ({ embedded, localDatabaseState }) =>
                            !embedded && localDatabaseState !== "available"
                    );
                    this.createEl(revisionEl, "div", {
                        text: $msg("Unreadable on this device; ${COUNT} referenced chunks are missing or deleted", {
                            COUNT: `${missing.length}`,
                        }),
                        cls: "mod-warning",
                    });
                    if (missing.length > 0) {
                        this.createEl(revisionEl, "code", {
                            text: missing
                                .slice(0, 3)
                                .map(({ id }) => id)
                                .join(", ") + (missing.length > 3 ? ", …" : ""),
                        });
                    }
                }
                if (revision.contentMatchesStorage === true) {
                    this.createEl(revisionEl, "div", { text: $msg("Matches the current Vault file") });
                } else if (revision.contentMatchesStorage === false) {
                    this.createEl(revisionEl, "div", { text: $msg("Differs from the current Vault file") });
                }

                if (!metadata.deleted && !revision.contentReadable && metadata.revision) {
                    const actions = this.createEl(revisionEl, "div", { cls: "sls-repair-actions" });
                    addActionButton(actions, $msg("Retry reading revision"), async () => {
                        const loaded = await retryReadFileDatabaseRevision(this.core, path, metadata.revision!);
                        Logger(
                            loaded
                                ? `Revision ${metadata.revision} of ${path} is readable after retry`
                                : `Revision ${metadata.revision} of ${path} remains unreadable`,
                            LOG_LEVEL_NOTICE
                        );
                        await refresh();
                    });
                    addActionButton(
                        actions,
                        $msg("Discard unreadable revision"),
                        async () => {
                            const confirmed =
                                (await this.core.confirm.askYesNoDialog(
                                    $msg(
                                        "Discard database revision ${REVISION} of ${FILE}? This creates a logical deletion for that exact live revision. Missing content cannot be recovered by this action.",
                                        {
                                            REVISION: metadata.revision!,
                                            FILE: path,
                                        }
                                    ),
                                    {
                                        title: $msg("Discard unreadable revision"),
                                        defaultOption: "No",
                                    }
                                )) === "yes";
                            if (!confirmed) {
                                return;
                            }
                            const result = await discardUnreadableLiveRevision(
                                this.core,
                                path,
                                metadata.revision!
                            );
                            Logger(
                                `Discard unreadable revision ${metadata.revision} of ${path}: ${result}`,
                                result === "discarded" ? LOG_LEVEL_NOTICE : LOG_LEVEL_VERBOSE
                            );
                            await refresh();
                        },
                        true
                    );
                }
            };
            revisions.forEach(addRevision);

            for (const revision of information.database.unavailableConflictRevisions) {
                const revisionEl = this.createEl(card, "div", { cls: "sls-repair-revision" });
                this.createEl(revisionEl, "div", {
                    text: $msg("${ROLE}: ${REVISION}", {
                        ROLE: $msg("Conflict revision"),
                        REVISION: revision,
                    }),
                    cls: "sls-repair-revision-title",
                });
                this.createEl(revisionEl, "div", {
                    text: $msg("Revision metadata is unavailable on this device"),
                    cls: "mod-warning",
                });
                const actions = this.createEl(revisionEl, "div", { cls: "sls-repair-actions" });
                addActionButton(actions, $msg("Retry reading revision"), async () => {
                    await retryReadFileDatabaseRevision(this.core, path, revision);
                    await refresh();
                });
                addActionButton(
                    actions,
                    $msg("Discard unreadable revision"),
                    async () => {
                        const confirmed =
                            (await this.core.confirm.askYesNoDialog(
                                $msg(
                                    "Discard database revision ${REVISION} of ${FILE}? This creates a logical deletion for that exact live revision. Missing content cannot be recovered by this action.",
                                    {
                                        REVISION: revision,
                                        FILE: path,
                                    }
                                ),
                                {
                                    title: $msg("Discard unreadable revision"),
                                    defaultOption: "No",
                                }
                            )) === "yes";
                        if (!confirmed) {
                            return;
                        }
                        await discardUnreadableLiveRevision(this.core, path, revision);
                        await refresh();
                    },
                    true
                );
            }

            for (const base of information.database.mergeBases) {
                if (base.contentAvailableLocally) {
                    continue;
                }
                this.createEl(card, "div", {
                    text: base.revision
                        ? $msg(
                              "Shared ancestor ${REVISION} is not readable on this device. Automatic three-way merging may be unavailable, but the live revisions remain available for explicit review.",
                              {
                                  REVISION: base.revision,
                              }
                          )
                        : $msg(
                              "No shared ancestor is available for this conflict. The live revisions remain available for explicit review."
                          ),
                    cls: "sls-repair-ancestor-warning",
                });
            }

            const winner = revisions.find(({ role }) => role === "winner");
            const actions = this.createEl(card, "div", { cls: "sls-repair-actions" });
            if (winner?.loadedEntry && information.storage.exists) {
                const winnerEntry = winner.loadedEntry;
                addActionButton(actions, $msg("Show revision history"), () => {
                    eventHub.emitEvent(EVENT_REQUEST_SHOW_HISTORY, {
                        file: path as FilePathWithPrefix,
                        fileOnDB: winnerEntry,
                    });
                });
            }
            if (
                information.storage.exists &&
                information.database.conflictCount === 0 &&
                (!winner || winner.contentReadable)
            ) {
                addActionButton(actions, $msg("Use Vault file in local database"), async () => {
                    if (!(await storeStorageInDatabase(path))) {
                        Logger(`Failed to store the Vault file in the local database: ${path}`, LOG_LEVEL_NOTICE);
                        return;
                    }
                    await refresh();
                });
            }
            if (
                !information.storage.exists &&
                information.database.conflictCount === 0 &&
                winner?.loadedEntry
            ) {
                addActionButton(actions, $msg("Restore database winner to Vault"), async () => {
                    if (!(await applyWinnerToStorage(path, winner))) {
                        Logger(`Failed to restore the database winner to the Vault: ${path}`, LOG_LEVEL_NOTICE);
                        return;
                    }
                    await refresh();
                });
            }
            addActionButton(actions, $msg("Copy database information"), async () => {
                await copyFileDatabaseInfo(this.core, path);
            });
        };

        new Setting(paneEl)
            .setName($msg("Recreate chunks for current Vault files"))
            .setDesc(
                $msg(
                    "Recreate chunks from the files currently present in this Vault. This cannot reconstruct unavailable historical or conflict content."
                )
            )
            .addButton((button) =>
                button
                    .setButtonText($msg("Recreate current chunks"))
                    .setCta()
                    .onClick(async () => {
                        await this.core.fileHandler.createAllChunks(true);
                    })
            );
        new Setting(paneEl)
            .setName("Resolve All conflicted files by the newer one")
            .setDesc(
                "Resolve all conflicted files by the newer one. Caution: This will overwrite the older one, and cannot resurrect the overwritten one."
            )
            .addButton((button) =>
                button
                    .setButtonText("Resolve All")
                    .setCta()
                    .onClick(async () => {
                        const confirmed =
                            (await this.core.confirm.askYesNoDialog(
                                $msg(
                                    "Resolve every conflict by modification time? This logically deletes every version except the newest one and cannot recover content which is already unavailable."
                                ),
                                {
                                    title: $msg("Resolve all conflicts by the newest version"),
                                    defaultOption: "No",
                                }
                            )) === "yes";
                        if (!confirmed) {
                            return;
                        }
                        await this.services.conflict.resolveAllConflictedFilesByNewerOnes();
                    })
            );

        new Setting(paneEl)
            .setName($msg("Verify and repair all files"))
            .setDesc(
                $msg(
                    "Compare each Vault file with every live local-database revision. Unreadable conflict versions remain visible until you retry or explicitly discard an exact revision."
                )
            )
            .addButton((button) =>
                button
                    .setButtonText($msg("Verify all"))
                    .setDisabled(false)
                    .setCta()
                    .onClick(async () => {
                        resultArea.replaceChildren();
                        Logger("Start verifying all files", LOG_LEVEL_NOTICE, "verify");
                        this.core.localDatabase.clearCaches();
                        const allPaths = await collectFileDatabaseInfoPaths(this.core);
                        let i = 0;
                        const incProc = () => {
                            i++;
                            if (i % 25 == 0)
                                Logger(
                                    `Checking ${i}/${allPaths.length} files \n`,
                                    LOG_LEVEL_NOTICE,
                                    "verify-processed"
                                );
                        };
                        const semaphore = Semaphore(10);
                        const processes = allPaths.map(async (path) => {
                            try {
                                if (shouldBeIgnored(path)) {
                                    return incProc();
                                }
                                const stat = (await this.core.storageAccess.isExistsIncludeHidden(path))
                                    ? await this.core.storageAccess.statHidden(path)
                                    : false;
                                const fileOnStorage = stat != null ? stat : false;
                                if (!(await this.services.vault.isTargetFile(path))) return incProc();
                                if (fileOnStorage && this.services.vault.isFileSizeTooLarge(fileOnStorage.size))
                                    return incProc();
                                const releaser = await semaphore.acquire(1);
                                try {
                                    const inspection = await inspectFileRepair(this.core, path);
                                    const winner = inspection.revisions.find(({ role }) => role === "winner");
                                    if (
                                        winner &&
                                        this.services.vault.isFileSizeTooLarge(winner.metadata.recordedSize)
                                    )
                                        return incProc();
                                    if (inspection.requiresAttention) {
                                        addRepairResult(inspection);
                                    } else {
                                        Logger(`Compare: SAME: ${path}`);
                                    }
                                } catch (ex) {
                                    Logger(`Error while processing ${path}`, LOG_LEVEL_NOTICE);
                                    Logger(ex, LOG_LEVEL_VERBOSE);
                                } finally {
                                    releaser();
                                    incProc();
                                }
                            } catch (ex) {
                                Logger(`Error while processing without semaphore ${path}`, LOG_LEVEL_NOTICE);
                                Logger(ex, LOG_LEVEL_VERBOSE);
                            }
                        });
                        await Promise.all(processes);
                        Logger("done", LOG_LEVEL_NOTICE, "verify");
                        // Logger(`${i}/${files.length}\n`, LOG_LEVEL_NOTICE, "verify-processed");
                    })
            );
        new Setting(paneEl)
            .setName("Check and convert non-path-obfuscated files")
            .setDesc("")
            .addButton((button) =>
                button
                    .setButtonText("Perform")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        for await (const docName of this.core.localDatabase.findAllDocNames()) {
                            if (!docName.startsWith("f:")) {
                                const idEncoded = await this.services.path.path2id(docName as FilePathWithPrefix);
                                const doc = await this.core.localDatabase.getRaw(docName as DocumentID);
                                if (!doc) continue;
                                if (doc.type != "newnote" && doc.type != "plain") {
                                    continue;
                                }
                                if (doc?.deleted ?? false) continue;
                                const newDoc = { ...doc };
                                //Prepare converted data
                                newDoc._id = idEncoded;
                                newDoc.path = docName as FilePathWithPrefix;
                                // @ts-ignore
                                delete newDoc._rev;
                                try {
                                    const obfuscatedDoc = await this.core.localDatabase.getRaw(idEncoded, {
                                        revs_info: true,
                                    });
                                    // Unfortunately we have to delete one of them.
                                    // Just now, save it as a conflicted document.
                                    obfuscatedDoc._revs_info?.shift(); // Drop latest revision.
                                    const previousRev = obfuscatedDoc._revs_info?.shift(); // Use second revision.
                                    if (previousRev) {
                                        newDoc._rev = previousRev.rev;
                                    } else {
                                        //If there are no revisions, set the possibly unique one
                                        newDoc._rev =
                                            "1-" +
                                            `00000000000000000000000000000000${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}`.slice(
                                                -32
                                            );
                                    }
                                    const ret = await this.core.localDatabase.putRaw(newDoc, { force: true });
                                    if (ret.ok) {
                                        Logger(
                                            `${docName} has been converted as conflicted document`,
                                            LOG_LEVEL_NOTICE
                                        );
                                        doc._deleted = true;
                                        if ((await this.core.localDatabase.putRaw(doc)).ok) {
                                            Logger(`Old ${docName} has been deleted`, LOG_LEVEL_NOTICE);
                                        }
                                        await this.services.conflict.queueCheckForIfOpen(docName as FilePathWithPrefix);
                                    } else {
                                        Logger(`Converting ${docName} Failed!`, LOG_LEVEL_NOTICE);
                                        Logger(ret, LOG_LEVEL_VERBOSE);
                                    }
                                } catch (ex: unknown) {
                                    if (isNotFoundError(ex)) {
                                        // We can perform this safely
                                        if ((await this.core.localDatabase.putRaw(newDoc)).ok) {
                                            Logger(`${docName} has been converted`, LOG_LEVEL_NOTICE);
                                            doc._deleted = true;
                                            if ((await this.core.localDatabase.putRaw(doc)).ok) {
                                                Logger(`Old ${docName} has been deleted`, LOG_LEVEL_NOTICE);
                                            }
                                        }
                                    } else {
                                        Logger(`Something went wrong while converting ${docName}`, LOG_LEVEL_NOTICE);
                                        Logger(ex, LOG_LEVEL_VERBOSE);
                                        // Something wrong.
                                    }
                                }
                            }
                        }
                        Logger(`Converting finished`, LOG_LEVEL_NOTICE);
                    })
            );
    });
    void addPanel(paneEl, "Reset").then((paneEl) => {
        new Setting(paneEl).setName("Back to non-configured").addButton((button) =>
            button
                .setButtonText("Back")
                .setDisabled(false)
                .onClick(async () => {
                    this.editingSettings.isConfigured = false;
                    await this.saveAllDirtySettings();
                    this.services.appLifecycle.askRestart();
                })
        );

        new Setting(paneEl).setName("Delete all customization sync data").addButton((button) =>
            button
                .setButtonText("Delete")
                .setDisabled(false)
                .setWarning()
                .onClick(async () => {
                    Logger(`Deleting customization sync data`, LOG_LEVEL_NOTICE);
                    const entriesToDelete = await this.core.localDatabase.allDocsRaw({
                        startkey: "ix:",
                        endkey: "ix:\u{10ffff}",
                        include_docs: true,
                    });
                    const newData = entriesToDelete.rows.map((e) => ({
                        ...e.doc,
                        _deleted: true,
                    })) as EntryDoc[];
                    const r = await this.core.localDatabase.bulkDocsRaw(newData);
                    // Do not care about the result.
                    Logger(
                        `${r.length} items have been removed, to confirm how many items are left, please perform it again.`,
                        LOG_LEVEL_NOTICE
                    );
                })
        );
    });
}
