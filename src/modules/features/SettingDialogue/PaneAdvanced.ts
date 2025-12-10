import { ChunkAlgorithmNames } from "../../../lib/src/common/types.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";

export function paneAdvanced(this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, { addPanel }: PageFunctions): void {
    void addPanel(paneEl, "Memory cache").then((paneEl) => {
        new Setting(paneEl).autoWireNumeric("hashCacheMaxCount", { clampMin: 10 });
        // new Setting(paneEl).autoWireNumeric("hashCacheMaxAmount", { clampMin: 1 });
    });
    void addPanel(paneEl, "Local Database Tweak").then((paneEl) => {
        paneEl.addClass("wizardHidden");

        const items = ChunkAlgorithmNames;
        new Setting(paneEl).autoWireDropDown("chunkSplitterVersion", {
            options: items,
        });
        new Setting(paneEl).autoWireNumeric("customChunkSize", { clampMin: 0, acceptZero: true });
    });

    void addPanel(paneEl, "Transfer Tweak").then((paneEl) => {
        new Setting(paneEl)
            .setClass("wizardHidden")
            .autoWireToggle("readChunksOnline", { onUpdate: this.onlyOnCouchDB });
        new Setting(paneEl)
            .setClass("wizardHidden")
            .autoWireToggle("useOnlyLocalChunk", { onUpdate: this.onlyOnCouchDB });

        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("concurrencyOfReadChunksOnline", {
            clampMin: 10,
            onUpdate: this.onlyOnCouchDB,
        });

        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("minimumIntervalOfReadChunksOnline", {
            clampMin: 10,
            onUpdate: this.onlyOnCouchDB,
        });
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
