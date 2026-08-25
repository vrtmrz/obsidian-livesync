import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { createExtraMenuSettingSpecGroup, createGeneralSettingSpecGroups } from "./GeneralSettingSpecs.ts";
import { renderLegacySettingSpec } from "./SettingSpec.ts";

export function paneGeneral(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    const groups = [
        ...createGeneralSettingSpecGroups({
            showEditorStatusDetails: () => this.isConfiguredAs("showStatusOnEditor", true),
            showVerboseLog: () => this.isConfiguredAs("lessInformationInLog", false),
        }),
        createExtraMenuSettingSpecGroup(),
    ];
    for (const group of groups) {
        void addPanel(paneEl, group.heading).then((panelEl) => {
            for (const spec of group.items) {
                renderLegacySettingSpec(new Setting(panelEl), spec);
            }
        });
    }
}
