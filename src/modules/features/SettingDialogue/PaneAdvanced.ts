import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { createAdvancedSettingSpecGroups } from "./AdvancedSettingSpecs.ts";
import { renderLegacySettingSpec } from "./SettingSpec.ts";

export function paneAdvanced(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    const groups = createAdvancedSettingSpecGroups({
        isCouchDB: () => this.onlyOnCouchDB().visibility !== false,
    });
    for (const group of groups) {
        void addPanel(paneEl, group.heading).then((panelEl) => {
            for (const spec of group.items) {
                renderLegacySettingSpec(new Setting(panelEl), spec);
            }
        });
    }
}
