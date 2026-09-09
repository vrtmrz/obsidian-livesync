import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { createExtraMenuSettingSpecGroup, createGeneralSettingSpecGroups } from "./GeneralSettingSpecs.ts";
import { renderLegacySettingSpec } from "./SettingSpec.ts";
import { $msg } from "@/common/translation";
import { StatusStyles, getStatusStyle, setStatusStyle, type StatusStyle } from "@/modules/features/StatusStyle.ts";

/**
 * The status style is not yet a shared setting in Commonlib, so it is rendered as a plain control
 * that reads and writes the plug-in settings directly.
 */
function renderStatusStyleSetting(this: ObsidianLiveSyncSettingTab, panelEl: HTMLElement) {
    new Setting(panelEl)
        .setName($msg("obsidianLiveSyncSettingTab.statusStyleName"))
        .setDesc($msg("obsidianLiveSyncSettingTab.statusStyleDesc"))
        .addDropdown((dropdown) => {
            dropdown
                .addOptions({
                    [StatusStyles.CLASSIC]: $msg("obsidianLiveSyncSettingTab.optionStatusStyleClassic"),
                    [StatusStyles.MINIMAL]: $msg("obsidianLiveSyncSettingTab.optionStatusStyleMinimal"),
                })
                .setValue(getStatusStyle(this.core.settings))
                .onChange(async (value) => {
                    setStatusStyle(this.core.settings, value as StatusStyle);
                    await this.services.setting.saveSettingData();
                });
        });
}

export function paneGeneral(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    const groups = [
        ...createGeneralSettingSpecGroups({
            showEditorStatusDetails: () => this.isConfiguredAs("showStatusOnEditor", true),
            showVerboseLog: () => this.isConfiguredAs("lessInformationInLog", false),
        }),
        createExtraMenuSettingSpecGroup(),
    ];
    const appearanceHeading = groups[0]?.heading;
    for (const group of groups) {
        void addPanel(paneEl, group.heading).then((panelEl) => {
            for (const spec of group.items) {
                renderLegacySettingSpec(new Setting(panelEl), spec);
            }
            if (group.heading === appearanceHeading) {
                renderStatusStyleSetting.call(this, panelEl);
            }
        });
    }
}
