import {
    E2EEAlgorithmNames,
    E2EEAlgorithms,
    type HashAlgorithm,
    LOG_LEVEL_NOTICE,
    SuffixDatabaseName,
} from "../../../lib/src/common/types.ts";
import { $msg } from "../../../lib/src/common/i18n.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { addSignalWord, visibleOnly } from "./SettingPane.ts";
import { PouchDB } from "../../../lib/src/pouchdb/pouchdb-browser";
import { ExtraSuffixIndexedDB } from "../../../lib/src/common/types.ts";
import { migrateDatabases } from "./settingUtils.ts";

export function panePatches(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    void addPanel(paneEl, $msg("Ui.Settings.Patches.CompatibilityMetadata")).then((paneEl) => {
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("deleteMetadataOfDeletedFiles");

        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("automaticallyDeleteMetadataOfDeletedFiles", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("deleteMetadataOfDeletedFiles", true)),
        });
    });

    void addPanel(paneEl, $msg("Ui.Settings.Patches.CompatibilityConflict")).then((paneEl) => {
        paneEl.addClass("wizardHidden");
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("disableMarkdownAutoMerge");
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("writeDocumentsIfConflicted");
    });

    void addPanel(paneEl, $msg("Ui.Settings.Patches.CompatibilityDatabase")).then((paneEl) => {
        const migrateAllToIndexedDB = async () => {
            const dbToName = this.core.localDatabase.dbname + SuffixDatabaseName + ExtraSuffixIndexedDB;
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
            if (await migrateDatabases($msg("Ui.Settings.Patches.OperationToIndexedDb"), this.core.localDatabase.localDatabase, openTo)) {
                Logger(
                    $msg("Ui.Settings.Patches.MigrationIndexedDbCompleted"),
                    LOG_LEVEL_NOTICE
                );
                // this.plugin.settings.useIndexedDBAdapter = true;
                // await this.services.setting.saveSettingData();
                await this.core.services.setting.applyPartial({ useIndexedDBAdapter: true }, true);
                this.services.appLifecycle.performRestart();
            }
        };
        const migrateAllToIDB = async () => {
            const dbToName = this.core.localDatabase.dbname + SuffixDatabaseName;
            const options = {
                adapter: "idb",
                auto_compaction: false,
                deterministic_revs: true,
            };
            const openTo = () => {
                return new PouchDB(dbToName, options);
            };
            if (await migrateDatabases($msg("Ui.Settings.Patches.OperationToIdb"), this.core.localDatabase.localDatabase, openTo)) {
                Logger(
                    $msg("Ui.Settings.Patches.MigrationIdbCompleted"),
                    LOG_LEVEL_NOTICE
                );
                await this.core.services.setting.applyPartial({ useIndexedDBAdapter: false }, true);
                // this.core.settings.useIndexedDBAdapter = false;
                // await this.services.setting.saveSettingData();
                this.services.appLifecycle.performRestart();
            }
        };
        {
            const indexedDbWarning = paneEl.createDiv({
                text: $msg("Ui.Settings.Patches.IndexedDbWarning"),
            });
            addSignalWord(indexedDbWarning, this.editingSettings.useIndexedDBAdapter ? "warning" : "notice");
            const migrationWarning = paneEl.createDiv({
                text: $msg("Ui.Settings.Patches.MigrationWarning"),
            });
            addSignalWord(migrationWarning, "notice");
            const setting = new Setting(paneEl)
                .setName($msg("Ui.Settings.Patches.DatabaseAdapter"))
                .setDesc($msg("Ui.Settings.Patches.DatabaseAdapterDesc"));
            const el = setting.controlEl.createDiv({});
            el.setText(
                $msg("Ui.Settings.Patches.CurrentAdapter", {
                    adapter: this.editingSettings.useIndexedDBAdapter ? "IndexedDB" : "IDB",
                })
            );
            if (!this.editingSettings.useIndexedDBAdapter) {
                setting.addButton((button) => {
                    button.setButtonText($msg("Ui.Settings.Patches.SwitchToIndexedDb")).onClick(async () => {
                        Logger($msg("Ui.Settings.Patches.MigratingToIndexedDb"), LOG_LEVEL_NOTICE);
                        await migrateAllToIndexedDB();
                        Logger($msg("Ui.Settings.Patches.MigrationIndexedDbCompletedFollowUp"), LOG_LEVEL_NOTICE);
                    });
                });
            } else {
                setting.addButton((button) => {
                    button.setButtonText($msg("Ui.Settings.Patches.SwitchToIDB")).onClick(async () => {
                        Logger($msg("Ui.Settings.Patches.MigratingToIdb"), LOG_LEVEL_NOTICE);
                        await migrateAllToIDB();
                        Logger($msg("Ui.Settings.Patches.MigrationIdbCompletedFollowUp"), LOG_LEVEL_NOTICE);
                    });
                });
            }
        }
        new Setting(paneEl).autoWireToggle("handleFilenameCaseSensitive", { holdValue: true }).setClass("wizardHidden");
    });

    void addPanel(paneEl, $msg("Ui.Settings.Patches.CompatibilityInternalApi")).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("watchInternalFileChanges", { invert: true });
    });
    void addPanel(paneEl, $msg("Ui.Settings.Patches.CompatibilityRemote")).then((paneEl) => {
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

    void addPanel(paneEl, $msg("Ui.Settings.Patches.EdgeCaseDatabase")).then((paneEl) => {
        new Setting(paneEl)
            .autoWireText("additionalSuffixOfDatabaseName", { holdValue: true })
            .addApplyButton(["additionalSuffixOfDatabaseName"]);

        this.addOnSaved("additionalSuffixOfDatabaseName", async (key) => {
            Logger($msg("Ui.Settings.Patches.RemediationSuffixChanged"), LOG_LEVEL_NOTICE);
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
            await this.core.localDatabase._prepareHashFunctions();
        });
    });
    void addPanel(paneEl, $msg("Ui.Settings.Patches.EdgeCaseBehaviour")).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("doNotSuspendOnFetching");
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("doNotDeleteFolder");
        new Setting(paneEl).autoWireToggle("processSizeMismatchedFiles");
    });

    void addPanel(paneEl, $msg("Ui.Settings.Patches.EdgeCaseProcessing")).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("disableWorkerForGeneratingChunks");

        new Setting(paneEl).autoWireToggle("processSmallFilesInUIThread", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("disableWorkerForGeneratingChunks", false)),
        });
    });
    // void addPanel(paneEl, "Edge case addressing (Networking)").then((paneEl) => {
    // new Setting(paneEl).autoWireToggle("useRequestAPI");
    // });
    void addPanel(paneEl, $msg("Ui.Settings.Patches.CompatibilityTrouble")).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("disableCheckingConfigMismatch");
    });
    void addPanel(paneEl, $msg("Ui.Settings.Patches.Remediation")).then((paneEl) => {
        let dateEl: HTMLSpanElement;
        new Setting(paneEl)
            .addText((text) => {
                const updateDateText = () => {
                    if (this.editingSettings.maxMTimeForReflectEvents == 0) {
                        dateEl.textContent = $msg("Ui.Settings.Patches.RemediationNoLimit");
                    } else {
                        const date = new Date(this.editingSettings.maxMTimeForReflectEvents);
                        dateEl.textContent = $msg("Ui.Settings.Patches.RemediationWithValue", {
                            date: date.toLocaleString(),
                            timestamp: `${this.editingSettings.maxMTimeForReflectEvents}`,
                        });
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
            const buttons = [
                $msg("Ui.Settings.Patches.RemediationRestartNow"),
                $msg("Ui.Settings.Patches.RemediationRestartLater"),
            ] as const;
            const reboot = await this.core.confirm.askSelectStringDialogue(
                $msg("Ui.Settings.Patches.RemediationRestartMessage"),
                buttons,
                {
                    title: $msg("Ui.Settings.Patches.RemediationChanged"),
                    defaultAction: $msg("Ui.Settings.Patches.RemediationRestartNow"),
                }
            );
            if (reboot !== $msg("Ui.Settings.Patches.RemediationRestartLater")) {
                Logger($msg("Ui.Settings.Patches.RemediationRestarting"), LOG_LEVEL_NOTICE);
                this.services.appLifecycle.performRestart();
            }
        });
    });
    void addPanel(paneEl, $msg("Ui.Settings.Patches.RemoteDatabaseSunset")).then((paneEl) => {
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
