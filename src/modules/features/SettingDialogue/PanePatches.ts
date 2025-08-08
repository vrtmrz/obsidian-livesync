import {
    E2EEAlgorithmNames,
    E2EEAlgorithms,
    type HashAlgorithm,
    LOG_LEVEL_NOTICE,
} from "../../../lib/src/common/types.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";

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
        new Setting(paneEl).autoWireToggle("useIndexedDBAdapter", { invert: true, holdValue: true });

        // new Setting(paneEl)
        //     .autoWireToggle("doNotUseFixedRevisionForChunks", { holdValue: true })
        //     .setClass("wizardHidden");
        new Setting(paneEl).autoWireToggle("handleFilenameCaseSensitive", { holdValue: true }).setClass("wizardHidden");

        this.addOnSaved("useIndexedDBAdapter", async () => {
            await this.saveAllDirtySettings();
            await this.rebuildDB("localOnly");
        });
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
            await this.plugin.$$initializeDatabase();
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
