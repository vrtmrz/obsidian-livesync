import type { HiddenFileSyncMode, OptionalSyncFeatureMode } from "@/features/optionalSyncFeatures.ts";

type HiddenFileSyncDirection = "pullForce" | "pushForce" | "safe";

type ConfigureHiddenFileSyncHandlers = {
    disable: () => Promise<void>;
    enable: () => Promise<void>;
    initialise: (direction: HiddenFileSyncDirection) => Promise<void>;
};

export type ConfigureHiddenFileSyncResult = "ignored" | "disabled" | "enabled";

function getInitialiseDirection(mode: HiddenFileSyncMode): HiddenFileSyncDirection | false {
    if (mode == "FETCH") return "pullForce";
    if (mode == "OVERWRITE") return "pushForce";
    if (mode == "MERGE") return "safe";
    return false;
}

function isDisableMode(
    mode: OptionalSyncFeatureMode
): mode is Extract<HiddenFileSyncMode, "DISABLE" | "DISABLE_HIDDEN"> {
    return mode == "DISABLE" || mode == "DISABLE_HIDDEN";
}

function isHiddenFileSyncMode(mode: OptionalSyncFeatureMode): mode is HiddenFileSyncMode {
    return mode == "FETCH" || mode == "OVERWRITE" || mode == "MERGE" || isDisableMode(mode);
}

export async function configureHiddenFileSyncMode(
    mode: OptionalSyncFeatureMode,
    handlers: ConfigureHiddenFileSyncHandlers
): Promise<ConfigureHiddenFileSyncResult> {
    if (!isHiddenFileSyncMode(mode)) {
        return "ignored";
    }
    if (isDisableMode(mode)) {
        await handlers.disable();
        return "disabled";
    }
    const direction = getInitialiseDirection(mode);
    if (direction === false) {
        return "ignored";
    }
    await handlers.enable();
    await handlers.initialise(direction);
    return "enabled";
}
