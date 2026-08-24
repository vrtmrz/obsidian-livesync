import { LEVEL_ADVANCED, type CustomRegExpSource } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { constructCustomRegExpList, splitCustomRegExpList } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import MultipleRegExpControl from "./MultipleRegExpControl.svelte";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { mount, unmount } from "svelte";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
export function paneSelector(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    void addPanel(paneEl, "Normal Files").then((paneEl) => {
        const syncFilesSetting = new Setting(paneEl)
            .setName("Synchronising files")
            .setDesc(
                "(RegExp) Empty to sync all files. Set filter as a regular expression to limit synchronising files."
            );
        const syncFilesControl = mount(MultipleRegExpControl, {
            target: syncFilesSetting.controlEl,
            props: {
                patterns: splitCustomRegExpList(this.editingSettings.syncOnlyRegEx, "|[]|"),
                originals: splitCustomRegExpList(this.editingSettings.syncOnlyRegEx, "|[]|"),
                apply: async (newPatterns: CustomRegExpSource[]) => {
                    this.editingSettings.syncOnlyRegEx = constructCustomRegExpList(newPatterns, "|[]|");
                    await this.saveAllDirtySettings();
                    this.requestPageRefresh();
                },
            },
        });
        this.lifetimeComponent.register(() => void unmount(syncFilesControl));

        const nonSyncFilesSetting = new Setting(paneEl)
            .setName("Non-Synchronising files")
            .setDesc("(RegExp) If this is set, any changes to local and remote files that match this will be skipped.");

        const nonSyncFilesControl = mount(MultipleRegExpControl, {
            target: nonSyncFilesSetting.controlEl,
            props: {
                patterns: splitCustomRegExpList(this.editingSettings.syncIgnoreRegEx, "|[]|"),
                originals: splitCustomRegExpList(this.editingSettings.syncIgnoreRegEx, "|[]|"),
                apply: async (newPatterns: CustomRegExpSource[]) => {
                    this.editingSettings.syncIgnoreRegEx = constructCustomRegExpList(newPatterns, "|[]|");
                    await this.saveAllDirtySettings();
                    this.requestPageRefresh();
                },
            },
        });
        this.lifetimeComponent.register(() => void unmount(nonSyncFilesControl));
        new Setting(paneEl).autoWireNumeric("syncMaxSizeInMB", { clampMin: 0 });

        new Setting(paneEl).autoWireToggle("useIgnoreFiles");
        new Setting(paneEl).autoWireTextArea("ignoreFiles", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("useIgnoreFiles", true)),
        });
    });
    void addPanel(paneEl, "Hidden Files", undefined, undefined, LEVEL_ADVANCED).then((paneEl) => {
        const targetPatternSetting = new Setting(paneEl)
            .setName("Target patterns")
            .setDesc("Patterns to match files for syncing");
        const patTarget = splitCustomRegExpList(this.editingSettings.syncInternalFilesTargetPatterns, ",");
        const targetPatternControl = mount(MultipleRegExpControl, {
            target: targetPatternSetting.controlEl,
            props: {
                patterns: patTarget,
                originals: [...patTarget],
                apply: async (newPatterns: CustomRegExpSource[]) => {
                    this.editingSettings.syncInternalFilesTargetPatterns = constructCustomRegExpList(newPatterns, ",");
                    await this.saveAllDirtySettings();
                    this.requestPageRefresh();
                },
            },
        });
        this.lifetimeComponent.register(() => void unmount(targetPatternControl));

        const defaultSkipPattern = "\\/node_modules\\/, \\/\\.git\\/, ^\\.git\\/, \\/obsidian-livesync\\/";
        const defaultSkipPatternXPlat =
            defaultSkipPattern + ",\\/workspace$ ,\\/workspace.json$,\\/workspace-mobile.json$";

        const pat = splitCustomRegExpList(this.editingSettings.syncInternalFilesIgnorePatterns, ",");
        const patSetting = new Setting(paneEl).setName("Ignore patterns").setDesc("");

        const ignorePatternControl = mount(MultipleRegExpControl, {
            target: patSetting.controlEl,
            props: {
                patterns: pat,
                originals: [...pat],
                apply: async (newPatterns: CustomRegExpSource[]) => {
                    this.editingSettings.syncInternalFilesIgnorePatterns = constructCustomRegExpList(newPatterns, ",");
                    await this.saveAllDirtySettings();
                    this.requestPageRefresh();
                },
            },
        });
        this.lifetimeComponent.register(() => void unmount(ignorePatternControl));

        const addDefaultPatterns = async (patterns: string) => {
            const oldList = splitCustomRegExpList(this.editingSettings.syncInternalFilesIgnorePatterns, ",");
            const newList = splitCustomRegExpList(
                patterns as unknown as typeof this.editingSettings.syncInternalFilesIgnorePatterns,
                ","
            );
            const allSet = new Set<CustomRegExpSource>([...oldList, ...newList]);
            this.editingSettings.syncInternalFilesIgnorePatterns = constructCustomRegExpList([...allSet], ",");
            await this.saveAllDirtySettings();
            this.requestPageRefresh();
        };

        new Setting(paneEl)
            .setName("Add default patterns")
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
            .setDesc("Patterns to match files for overwriting instead of merging");
        const patTarget2 = splitCustomRegExpList(this.editingSettings.syncInternalFileOverwritePatterns, ",");
        const overwritePatternControl = mount(MultipleRegExpControl, {
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
                    this.requestPageRefresh();
                },
            },
        });
        this.lifetimeComponent.register(() => void unmount(overwritePatternControl));
    });
}
