import {
    MODE_AUTOMATIC,
    MODE_PAUSED,
    MODE_SELECTIVE,
    MODE_SHINY,
    type PluginSyncSettingEntry,
    type SYNC_MODE,
    type FilePathWithPrefix,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

import {
    getCustomisationSyncFileCategory,
    getCustomisationSyncSettingKey,
    getCustomisationSyncSettingKeyFromDocumentPath,
    type CustomisationSyncFileCategory,
    type CustomisationSyncPathOptions,
} from "@/features/ConfigSync/customisationSyncPaths.ts";

export type OptionalFileSyncOwner = "customisation" | "hidden-file" | "none";

export type OptionalFileSyncRoutingReason =
    | "customisation-selective"
    | "customisation-flagged-selective"
    | "customisation-paused"
    | "customisation-not-ready"
    | "hidden-file-automatic"
    | "hidden-file-path"
    | "hidden-file-disabled"
    | "hidden-file-not-ready"
    | "hidden-file-filtered"
    | "features-disabled"
    | "unsupported-path";

export type OptionalFileSyncRoutingDecision = {
    owner: OptionalFileSyncOwner;
    reason: OptionalFileSyncRoutingReason;
    category: CustomisationSyncFileCategory;
    settingKey?: string;
    mode?: SYNC_MODE;
};

export type OptionalFileSyncOwnerSelectionInput = CustomisationSyncPathOptions & {
    path: string;
    customisationEnabled: boolean;
    hiddenFileEnabled: boolean;
    pluginSyncExtendedSetting: Readonly<Record<string, PluginSyncSettingEntry>>;
};

export type OptionalFileSyncRoutingInput = OptionalFileSyncOwnerSelectionInput & {
    customisationReady: boolean;
    hiddenFileReady: boolean;
    hiddenFileEligible: boolean;
};

export type CustomisationSyncDocumentOwnershipInput = {
    documentPath: FilePathWithPrefix;
    customisationEnabled: boolean;
    pluginSyncExtendedSetting: Readonly<Record<string, PluginSyncSettingEntry>>;
};

function isHiddenFileSyncPath(path: string): boolean {
    return path.startsWith(".") && !path.startsWith(".trash");
}

/** Select the sole local writer from persisted feature settings. */
export function selectOptionalFileSyncOwner(
    input: OptionalFileSyncOwnerSelectionInput
): OptionalFileSyncRoutingDecision {
    const pathOptions: CustomisationSyncPathOptions = input;
    const settingKey = getCustomisationSyncSettingKey(input.path, pathOptions);
    const category = settingKey ? getCustomisationSyncFileCategory(input.path, pathOptions) : "";

    if (!input.customisationEnabled && !input.hiddenFileEnabled) {
        return { owner: "none", reason: "features-disabled", category, settingKey };
    }

    if (settingKey && input.customisationEnabled) {
        const mode = input.pluginSyncExtendedSetting[settingKey]?.mode ?? MODE_SELECTIVE;
        if (mode == MODE_SELECTIVE) {
            return { owner: "customisation", reason: "customisation-selective", category, settingKey, mode };
        }
        if (mode == MODE_SHINY) {
            return {
                owner: "customisation",
                reason: "customisation-flagged-selective",
                category,
                settingKey,
                mode,
            };
        }
        if (mode == MODE_PAUSED) {
            return { owner: "none", reason: "customisation-paused", category, settingKey, mode };
        }
        if (mode == MODE_AUTOMATIC) {
            return input.hiddenFileEnabled
                ? { owner: "hidden-file", reason: "hidden-file-automatic", category, settingKey, mode }
                : { owner: "none", reason: "hidden-file-disabled", category, settingKey, mode };
        }
    }

    if (input.hiddenFileEnabled && isHiddenFileSyncPath(input.path)) {
        return { owner: "hidden-file", reason: "hidden-file-path", category, settingKey };
    }

    return { owner: "none", reason: "unsupported-path", category, settingKey };
}

/** Apply transient readiness and asynchronous Hidden File Sync eligibility to the selected owner. */
export function routeOptionalFileSyncPath(input: OptionalFileSyncRoutingInput): OptionalFileSyncRoutingDecision {
    const selected = selectOptionalFileSyncOwner(input);
    if (selected.owner == "customisation" && !input.customisationReady) {
        return { ...selected, owner: "none", reason: "customisation-not-ready" };
    }
    if (selected.owner == "hidden-file" && !input.hiddenFileReady) {
        return { ...selected, owner: "none", reason: "hidden-file-not-ready" };
    }
    if (selected.owner == "hidden-file" && !input.hiddenFileEligible) {
        return { ...selected, owner: "none", reason: "hidden-file-filtered" };
    }
    return selected;
}

/** Decide whether a local scan may mutate an existing Customisation Sync document. */
export function isCustomisationSyncDocumentLocallyOwned(input: CustomisationSyncDocumentOwnershipInput): boolean {
    if (!input.customisationEnabled) return false;
    const settingKey = getCustomisationSyncSettingKeyFromDocumentPath(input.documentPath);
    if (!settingKey) return false;
    const mode = input.pluginSyncExtendedSetting[settingKey]?.mode ?? MODE_SELECTIVE;
    return mode == MODE_SELECTIVE || mode == MODE_SHINY;
}
