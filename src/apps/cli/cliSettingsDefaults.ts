import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createNewVaultSettings } from "@/common/core/settings/newVaultSettings.ts";

export function createDefaultCliSettings(): ObsidianLiveSyncSettings {
    return {
        ...createNewVaultSettings(),
        useIndexedDBAdapter: false,
        isConfigured: false,
    };
}
