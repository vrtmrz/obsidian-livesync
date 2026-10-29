import {
    LEVEL_ADVANCED,
    type CustomRegExpSource,
    type CustomRegExpSourceList,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { constructCustomRegExpList, splitCustomRegExpList } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import MultipleRegExpControl from "./MultipleRegExpControl.svelte";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { mount, unmount } from "svelte";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
import { $msg } from "@/common/translation";

type RegExpControlOwner = Pick<
    ObsidianLiveSyncSettingTab,
    "saveAllDirtySettings" | "requestPageRefresh" | "lifetimeComponent"
>;

function mountMultipleRegExpControl<D extends "|[]|" | ",">(
    owner: RegExpControlOwner,
    target: HTMLElement,
    source: CustomRegExpSourceList<D>,
    delimiter: D,
    assign: (serializedPatterns: CustomRegExpSourceList<D>) => void
): void {
    const patterns = splitCustomRegExpList(source, delimiter);
    const control = mount(MultipleRegExpControl, {
        target,
        props: {
            patterns,
            originals: [...patterns],
            apply: async (newPatterns: CustomRegExpSource[]) => {
                assign(constructCustomRegExpList(newPatterns, delimiter));
                await owner.saveAllDirtySettings();
                owner.requestPageRefresh();
            },
        },
    });
    owner.lifetimeComponent.register(() => void unmount(control));
}

export function paneSelector(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    void addPanel(paneEl, $msg("Normal Files")).then((paneEl) => {
        const syncFilesSetting = new Setting(paneEl)
            .setName($msg("Synchronising files"))
            .setDesc(
                $msg(
                    "(RegExp) Limit normal files to matching paths. Leave empty to allow all normal file paths. Hidden File Sync uses its own target patterns."
                )
            );
        mountMultipleRegExpControl(
            this,
            syncFilesSetting.controlEl,
            this.editingSettings.syncOnlyRegEx,
            "|[]|",
            (value) => {
                this.editingSettings.syncOnlyRegEx = value;
            }
        );

        const nonSyncFilesSetting = new Setting(paneEl)
            .setName($msg("Non-Synchronising files"))
            .setDesc($msg("(RegExp) Skip changes to matching normal and hidden files, locally and remotely."));

        mountMultipleRegExpControl(
            this,
            nonSyncFilesSetting.controlEl,
            this.editingSettings.syncIgnoreRegEx,
            "|[]|",
            (value) => {
                this.editingSettings.syncIgnoreRegEx = value;
            }
        );
        new Setting(paneEl).autoWireNumeric("syncMaxSizeInMB", { clampMin: 0 });

        new Setting(paneEl).autoWireToggle("useIgnoreFiles");
        new Setting(paneEl).autoWireTextArea("ignoreFiles", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("useIgnoreFiles", true)),
        });
    });
    void addPanel(paneEl, $msg("Hidden Files"), undefined, undefined, LEVEL_ADVANCED).then((paneEl) => {
        const targetPatternSetting = new Setting(paneEl)
            .setName($msg("Target patterns"))
            .setDesc($msg("Patterns to match files for syncing"));
        mountMultipleRegExpControl(
            this,
            targetPatternSetting.controlEl,
            this.editingSettings.syncInternalFilesTargetPatterns,
            ",",
            (value) => {
                this.editingSettings.syncInternalFilesTargetPatterns = value;
            }
        );

        const defaultSkipPattern = "\\/node_modules\\/, \\/\\.git\\/, ^\\.git\\/, \\/obsidian-livesync\\/";
        const defaultSkipPatternXPlat =
            defaultSkipPattern + ",\\/workspace$ ,\\/workspace.json$,\\/workspace-mobile.json$";

        const patSetting = new Setting(paneEl).setName($msg("Ignore patterns")).setDesc("");
        mountMultipleRegExpControl(
            this,
            patSetting.controlEl,
            this.editingSettings.syncInternalFilesIgnorePatterns,
            ",",
            (value) => {
                this.editingSettings.syncInternalFilesIgnorePatterns = value;
            }
        );

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
            .setName($msg("Add default patterns"))
            .addButton((button) => {
                button.setButtonText($msg("Default")).onClick(async () => {
                    await addDefaultPatterns(defaultSkipPattern);
                });
            })
            .addButton((button) => {
                button.setButtonText($msg("Cross-platform")).onClick(async () => {
                    await addDefaultPatterns(defaultSkipPatternXPlat);
                });
            });

        const overwritePatterns = new Setting(paneEl)
            .setName($msg("Overwrite patterns"))
            .setDesc($msg("Patterns to match files for overwriting instead of merging"));
        mountMultipleRegExpControl(
            this,
            overwritePatterns.controlEl,
            this.editingSettings.syncInternalFileOverwritePatterns,
            ",",
            (value) => {
                this.editingSettings.syncInternalFileOverwritePatterns = value;
            }
        );
    });
}
