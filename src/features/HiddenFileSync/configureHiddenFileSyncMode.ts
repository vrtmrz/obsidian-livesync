type HiddenFileSyncMode = "FETCH" | "OVERWRITE" | "MERGE" | "DISABLE" | "DISABLE_HIDDEN";
type HiddenFileSyncDirection = "pullForce" | "pushForce" | "safe";

type ConfigureHiddenFileSyncHandlers = {
    disable: () => Promise<void>;
    enable: () => Promise<void>;
    initialise: (direction: HiddenFileSyncDirection) => Promise<void>;
};

export type ConfigureHiddenFileSyncResult = "ignored" | "disabled" | "enabled";

function getInitialiseDirection(mode: keyof OPTIONAL_SYNC_FEATURES): HiddenFileSyncDirection | false {
    if (mode == "FETCH") return "pullForce";
    if (mode == "OVERWRITE") return "pushForce";
    if (mode == "MERGE") return "safe";
    return false;
}

function isDisableMode(mode: keyof OPTIONAL_SYNC_FEATURES): boolean {
    return mode == "DISABLE" || mode == "DISABLE_HIDDEN";
}

function isHiddenFileSyncMode(mode: keyof OPTIONAL_SYNC_FEATURES): mode is HiddenFileSyncMode {
    return mode == "FETCH" || mode == "OVERWRITE" || mode == "MERGE" || isDisableMode(mode);
}

export async function configureHiddenFileSyncMode(
    mode: keyof OPTIONAL_SYNC_FEATURES,
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
