import { ChunkAlgorithmNames } from "@lib/common/types.ts";
import { renderObsidianSetting } from "./ObsidianSettingRenderer.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";

export function paneAdvanced(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    void addPanel(paneEl, "Memory cache").then((paneEl) => {
        renderObsidianSetting(paneEl, "hashCacheMaxCount", { clampMin: 10 });
        // renderObsidianSetting(paneEl, "hashCacheMaxAmount", { clampMin: 1 });
    });
    void addPanel(paneEl, "Local Database Tweak").then((paneEl) => {
        paneEl.addClass("wizardHidden");

        const items = ChunkAlgorithmNames;
        renderObsidianSetting(paneEl, "chunkSplitterVersion", {
            options: items,
        });
        renderObsidianSetting(paneEl, "customChunkSize", { clampMin: 0, acceptZero: true });
    });

    void addPanel(paneEl, "Transfer Tweak").then((paneEl) => {
        renderObsidianSetting(paneEl, "readChunksOnline", { onUpdate: this.onlyOnCouchDB }).setClass("wizardHidden");
        renderObsidianSetting(paneEl, "useOnlyLocalChunk", { onUpdate: this.onlyOnCouchDB }).setClass("wizardHidden");

        renderObsidianSetting(paneEl, "concurrencyOfReadChunksOnline", {
            clampMin: 10,
            onUpdate: this.onlyOnCouchDB,
        }).setClass("wizardHidden");

        renderObsidianSetting(paneEl, "minimumIntervalOfReadChunksOnline", {
            clampMin: 10,
            onUpdate: this.onlyOnCouchDB,
        }).setClass("wizardHidden");
        renderObsidianSetting(paneEl, "autoAcceptCompatibleTweak").setClass("wizardHidden");
        // new Setting(paneEl)
        //     .setClass("wizardHidden")
        //     .autoWireToggle("sendChunksBulk", { onUpdate: onlyOnCouchDB })
        // new Setting(paneEl)
        //     .setClass("wizardHidden")
        //     .autoWireNumeric("sendChunksBulkMaxSize", {
        //         clampMax: 100, clampMin: 1, onUpdate: onlyOnCouchDB
        //     })
    });
}
