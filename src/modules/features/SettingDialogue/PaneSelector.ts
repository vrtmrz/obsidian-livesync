import { LEVEL_ADVANCED, type CustomRegExpSource } from "../../../lib/src/common/types.ts";
import { constructCustomRegExpList, splitCustomRegExpList } from "../../../lib/src/common/utils.ts";
import MultipleRegExpControl from "./MultipleRegExpControl.svelte";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { mount } from "svelte";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
export function paneSelector(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    void addPanel(paneEl, "Normal Files").then((paneEl) => {
        paneEl.addClass("wizardHidden");

        const syncFilesSetting = new Setting(paneEl)
            .setName("Synchronising files")
            .setDesc(
                "(RegExp) Empty to sync all files. Set filter as a regular expression to limit synchronising files."
            )
            .setClass("wizardHidden");
        mount(MultipleRegExpControl, {
            target: syncFilesSetting.controlEl,
            props: {
                patterns: splitCustomRegExpList(this.editingSettings.syncOnlyRegEx, "|[]|"),
                originals: splitCustomRegExpList(this.editingSettings.syncOnlyRegEx, "|[]|"),
                apply: async (newPatterns: CustomRegExpSource[]) => {
                    this.editingSettings.syncOnlyRegEx = constructCustomRegExpList(newPatterns, "|[]|");
                    await this.saveAllDirtySettings();
                    this.display();
                },
            },
        });

        const nonSyncFilesSetting = new Setting(paneEl)
            .setName("Non-Synchronising files")
            .setDesc("(RegExp) If this is set, any changes to local and remote files that match this will be skipped.")
            .setClass("wizardHidden");

        mount(MultipleRegExpControl, {
            target: nonSyncFilesSetting.controlEl,
            props: {
                patterns: splitCustomRegExpList(this.editingSettings.syncIgnoreRegEx, "|[]|"),
                originals: splitCustomRegExpList(this.editingSettings.syncIgnoreRegEx, "|[]|"),
                apply: async (newPatterns: CustomRegExpSource[]) => {
                    this.editingSettings.syncIgnoreRegEx = constructCustomRegExpList(newPatterns, "|[]|");
                    await this.saveAllDirtySettings();
                    this.display();
                },
            },
        });
        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("syncMaxSizeInMB", { clampMin: 0 });

        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("useIgnoreFiles");
        new Setting(paneEl).setClass("wizardHidden").autoWireTextArea("ignoreFiles", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("useIgnoreFiles", true)),
        });
    });
    void addPanel(paneEl, "Hidden Files", undefined, undefined, LEVEL_ADVANCED).then((paneEl) => {
        const targetPatternSetting = new Setting(paneEl)
            .setName("Target patterns")
            .setClass("wizardHidden")
            .setDesc("Patterns to match files for syncing");
        const patTarget = splitCustomRegExpList(this.editingSettings.syncInternalFilesTargetPatterns, ",");
        mount(MultipleRegExpControl, {
            target: targetPatternSetting.controlEl,
            props: {
                patterns: patTarget,
                originals: [...patTarget],
                apply: async (newPatterns: CustomRegExpSource[]) => {
                    this.editingSettings.syncInternalFilesTargetPatterns = constructCustomRegExpList(newPatterns, ",");
                    await this.saveAllDirtySettings();
                    this.display();
                },
            },
        });

        const defaultSkipPattern = "\\/node_modules\\/, \\/\\.git\\/, ^\\.git\\/, \\/obsidian-livesync\\/";
        const defaultSkipPatternXPlat =
            defaultSkipPattern + ",\\/workspace$ ,\\/workspace.json$,\\/workspace-mobile.json$";

        const pat = splitCustomRegExpList(this.editingSettings.syncInternalFilesIgnorePatterns, ",");
        const patSetting = new Setting(paneEl).setName("Ignore patterns").setClass("wizardHidden").setDesc("");

        mount(MultipleRegExpControl, {
            target: patSetting.controlEl,
            props: {
                patterns: pat,
                originals: [...pat],
                apply: async (newPatterns: CustomRegExpSource[]) => {
                    this.editingSettings.syncInternalFilesIgnorePatterns = constructCustomRegExpList(newPatterns, ",");
                    await this.saveAllDirtySettings();
                    this.display();
                },
            },
        });

        const addDefaultPatterns = async (patterns: string) => {
            const oldList = splitCustomRegExpList(this.editingSettings.syncInternalFilesIgnorePatterns, ",");
            const newList = splitCustomRegExpList(
                patterns as unknown as typeof this.editingSettings.syncInternalFilesIgnorePatterns,
                ","
            );
            const allSet = new Set<CustomRegExpSource>([...oldList, ...newList]);
            this.editingSettings.syncInternalFilesIgnorePatterns = constructCustomRegExpList([...allSet], ",");
            await this.saveAllDirtySettings();
            this.display();
        };

        new Setting(paneEl)
            .setName("Add default patterns")
            .setClass("wizardHidden")
            .addButton((button) => {
                button.setButtonText("Default").onClick(async () => {
                    await addDefaultPatterns(defaultSkipPattern);
                });
            })
            .addButton((button) => {
                button.setButtonText("Cross-platform").onClick(async () => {
                    await addDefaultPatterns(defaultSkipPatternXPlat);
                });
            });

        const overwritePatterns = new Setting(paneEl)
            .setName("Overwrite patterns")
            .setClass("wizardHidden")
            .setDesc("Patterns to match files for overwriting instead of merging");
        const patTarget2 = splitCustomRegExpList(this.editingSettings.syncInternalFileOverwritePatterns, ",");
        mount(MultipleRegExpControl, {
            target: overwritePatterns.controlEl,
            props: {
                patterns: patTarget2,
                originals: [...patTarget2],
                apply: async (newPatterns: CustomRegExpSource[]) => {
                    this.editingSettings.syncInternalFileOverwritePatterns = constructCustomRegExpList(
                        newPatterns,
                        ","
                    );
                    await this.saveAllDirtySettings();
                    this.display();
                },
            },
        });
    });
}
