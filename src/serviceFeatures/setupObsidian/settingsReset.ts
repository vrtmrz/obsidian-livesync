import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";

export function createEditingSettingsAfterFullReset<T extends ObsidianLiveSyncSettings>(editingSettings: T): T {
    return { ...editingSettings, ...createNewVaultSettings(), isConfigured: false };
}

export function createCoreSettingsAfterFullReset(): ObsidianLiveSyncSettings {
    return { ...createNewVaultSettings(), isConfigured: false };
}
