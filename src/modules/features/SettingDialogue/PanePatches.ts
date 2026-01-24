import {
    E2EEAlgorithmNames,
    E2EEAlgorithms,
    type HashAlgorithm,
    LOG_LEVEL_NOTICE,
    SuffixDatabaseName,
} from "../../../lib/src/common/types.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
import { PouchDB } from "../../../lib/src/pouchdb/pouchdb-browser";
import { ExtraSuffixIndexedDB } from "../../../lib/src/common/types.ts";
import { migrateDatabases } from "./settingUtils.ts";

export function panePatches(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    void addPanel(paneEl, "Compatibility (Metadata)").then((paneEl) => {
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("deleteMetadataOfDeletedFiles");

        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("automaticallyDeleteMetadataOfDeletedFiles", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("deleteMetadataOfDeletedFiles", true)),
        });
    });

    void addPanel(paneEl, "Compatibility (Conflict Behaviour)").then((paneEl) => {
        paneEl.addClass("wizardHidden");
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("disableMarkdownAutoMerge");
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("writeDocumentsIfConflicted");
    });

    void addPanel(paneEl, "Compatibility (Database structure)").then((paneEl) => {
        const migrateAllToIndexedDB = async () => {
            const dbToName = this.plugin.localDatabase.dbname + SuffixDatabaseName + ExtraSuffixIndexedDB;
            const options = {
                adapter: "indexeddb",
                //@ts-ignore :missing def
                purged_infos_limit: 1,
                auto_compaction: false,
                deterministic_revs: true,
            };
            const openTo = () => {
                return new PouchDB(dbToName, options);
            };
            if (await migrateDatabases("to IndexedDB", this.plugin.localDatabase.localDatabase, openTo)) {
                Logger(
                    "Migration to IndexedDB completed. Obsidian will be restarted with new configuration immediately.",
                    LOG_LEVEL_NOTICE
                );
                this.plugin.settings.useIndexedDBAdapter = true;
                await this.services.setting.saveSettingData();
                this.services.appLifecycle.performRestart();
            }
        };
        const migrateAllToIDB = async () => {
            const dbToName = this.plugin.localDatabase.dbname + SuffixDatabaseName;
            const options = {
                adapter: "idb",
                auto_compaction: false,
                deterministic_revs: true,
            };
            const openTo = () => {
                return new PouchDB(dbToName, options);
            };
            if (await migrateDatabases("to IDB", this.plugin.localDatabase.localDatabase, openTo)) {
                Logger(
                    "Migration to IDB completed. Obsidian will be restarted with new configuration immediately.",
                    LOG_LEVEL_NOTICE
                );
                this.plugin.settings.useIndexedDBAdapter = false;
                await this.services.setting.saveSettingData();
                this.services.appLifecycle.performRestart();
            }
        };
        {
            const infoClass = this.editingSettings.useIndexedDBAdapter ? "op-warn" : "op-warn-info";
            paneEl.createDiv({
                text: "The IndexedDB adapter often offers superior performance in certain scenarios, but it has been found to cause memory leaks when used with LiveSync mode. When using LiveSync mode, please use IDB adapter instead.",
                cls: infoClass,
            });
            paneEl.createDiv({
                text: "Changing this setting requires migrating existing data (a bit time may be taken) and restarting Obsidian. Please make sure to back up your data before proceeding.",
                cls: "op-warn-info",
            });
            const setting = new Setting(paneEl)
                .setName("Database Adapter")
                .setDesc("Select the database adapter to use. ");
            const el = setting.controlEl.createDiv({});
            el.setText(`Current adapter: ${this.editingSettings.useIndexedDBAdapter ? "IndexedDB" : "IDB"}`);
            if (!this.editingSettings.useIndexedDBAdapter) {
                setting.addButton((button) => {
                    button.setButtonText("Switch to IndexedDB").onClick(async () => {
                        Logger("Migrating all data to IndexedDB...", LOG_LEVEL_NOTICE);
                        await migrateAllToIndexedDB();
                        Logger(
                            "Migration to IndexedDB completed. Please switch the adapter and restart Obsidian.",
                            LOG_LEVEL_NOTICE
                        );
                    });
                });
            } else {
                setting.addButton((button) => {
                    button.setButtonText("Switch to IDB").onClick(async () => {
                        Logger("Migrating all data to IDB...", LOG_LEVEL_NOTICE);
                        await migrateAllToIDB();
                        Logger(
                            "Migration to IDB completed. Please switch the adapter and restart Obsidian.",
                            LOG_LEVEL_NOTICE
                        );
                    });
                });
            }
        }
        new Setting(paneEl).autoWireToggle("handleFilenameCaseSensitive", { holdValue: true }).setClass("wizardHidden");
    });

    void addPanel(paneEl, "Compatibility (Internal API Usage)").then((paneEl) => {
        new Setting(paneEl).autoWireToggle("watchInternalFileChanges", { invert: true });
    });
    void addPanel(paneEl, "Compatibility (Remote Database)").then((paneEl) => {
        new Setting(paneEl).autoWireDropDown("E2EEAlgorithm", {
            options: E2EEAlgorithmNames,
        });
    });
    new Setting(paneEl).autoWireToggle("useDynamicIterationCount", {
        holdValue: true,
        onUpdate: visibleOnly(
            () =>
                this.isConfiguredAs("E2EEAlgorithm", E2EEAlgorithms.ForceV1) ||
                this.isConfiguredAs("E2EEAlgorithm", E2EEAlgorithms.V1)
        ),
    });

    void addPanel(paneEl, "Edge case addressing (Database)").then((paneEl) => {
        new Setting(paneEl)
            .autoWireText("additionalSuffixOfDatabaseName", { holdValue: true })
            .addApplyButton(["additionalSuffixOfDatabaseName"]);

        this.addOnSaved("additionalSuffixOfDatabaseName", async (key) => {
            Logger("Suffix has been changed. Reopening database...", LOG_LEVEL_NOTICE);
            await this.services.databaseEvents.initialiseDatabase();
        });

        new Setting(paneEl).autoWireDropDown("hashAlg", {
            options: {
                "": "Old Algorithm",
                xxhash32: "xxhash32 (Fast but less collision resistance)",
                xxhash64: "xxhash64 (Fastest)",
                "mixed-purejs": "PureJS fallback  (Fast, W/O WebAssembly)",
                sha1: "Older fallback (Slow, W/O WebAssembly)",
            } as Record<HashAlgorithm, string>,
        });
        this.addOnSaved("hashAlg", async () => {
            await this.plugin.localDatabase._prepareHashFunctions();
        });
    });
    void addPanel(paneEl, "Edge case addressing (Behaviour)").then((paneEl) => {
        new Setting(paneEl).autoWireToggle("doNotSuspendOnFetching");
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("doNotDeleteFolder");
        new Setting(paneEl).autoWireToggle("processSizeMismatchedFiles");
    });

    void addPanel(paneEl, "Edge case addressing (Processing)").then((paneEl) => {
        new Setting(paneEl).autoWireToggle("disableWorkerForGeneratingChunks");

        new Setting(paneEl).autoWireToggle("processSmallFilesInUIThread", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("disableWorkerForGeneratingChunks", false)),
        });
    });
    // void addPanel(paneEl, "Edge case addressing (Networking)").then((paneEl) => {
    // new Setting(paneEl).autoWireToggle("useRequestAPI");
    // });
    void addPanel(paneEl, "Compatibility (Trouble addressed)").then((paneEl) => {
        new Setting(paneEl).autoWireToggle("disableCheckingConfigMismatch");
    });
    void addPanel(paneEl, "Remediation").then((paneEl) => {
        let dateEl: HTMLSpanElement;
        new Setting(paneEl)
            .addText((text) => {
                const updateDateText = () => {
                    if (this.editingSettings.maxMTimeForReflectEvents == 0) {
                        dateEl.textContent = `No limit configured`;
                    } else {
                        const date = new Date(this.editingSettings.maxMTimeForReflectEvents);
                        dateEl.textContent = `Limit: ${date.toLocaleString()} (${this.editingSettings.maxMTimeForReflectEvents})`;
                    }
                    this.requestUpdate();
                };
                text.inputEl.before((dateEl = document.createElement("span")));
                text.inputEl.type = "datetime-local";
                if (this.editingSettings.maxMTimeForReflectEvents > 0) {
                    const date = new Date(this.editingSettings.maxMTimeForReflectEvents);
                    const isoString = date.toISOString().slice(0, 16);
                    text.setValue(isoString);
                } else {
                    text.setValue("");
                }
                text.onChange((value) => {
                    if (value == "") {
                        this.editingSettings.maxMTimeForReflectEvents = 0;
                        updateDateText();
                        return;
                    }
                    const date = new Date(value);
                    if (!isNaN(date.getTime())) {
                        this.editingSettings.maxMTimeForReflectEvents = date.getTime();
                    }
                    updateDateText();
                });
                updateDateText();
                return text;
            })
            .setAuto("maxMTimeForReflectEvents")
            .addApplyButton(["maxMTimeForReflectEvents"]);

        this.addOnSaved("maxMTimeForReflectEvents", async (key) => {
            const buttons = ["Restart Now", "Later"] as const;
            const reboot = await this.plugin.confirm.askSelectStringDialogue(
                "Restarting Obsidian is strongly recommended. Until restart, some changes may not take effect, and display may be inconsistent. Are you sure to restart now?",
                buttons,
                {
                    title: "Remediation Setting Changed",
                    defaultAction: "Restart Now",
                }
            );
            if (reboot !== "Later") {
                Logger("Remediation setting changed. Restarting Obsidian...", LOG_LEVEL_NOTICE);
                this.services.appLifecycle.performRestart();
            }
        });
    });
    void addPanel(paneEl, "Remote Database Tweak (In sunset)").then((paneEl) => {
        // new Setting(paneEl).autoWireToggle("useEden").setClass("wizardHidden");
        // const onlyUsingEden = visibleOnly(() => this.isConfiguredAs("useEden", true));
        // new Setting(paneEl).autoWireNumeric("maxChunksInEden", { onUpdate: onlyUsingEden }).setClass("wizardHidden");
        // new Setting(paneEl)
        //     .autoWireNumeric("maxTotalLengthInEden", { onUpdate: onlyUsingEden })
        //     .setClass("wizardHidden");
        // new Setting(paneEl).autoWireNumeric("maxAgeInEden", { onUpdate: onlyUsingEden }).setClass("wizardHidden");

        new Setting(paneEl).autoWireToggle("enableCompression").setClass("wizardHidden");
    });
}
