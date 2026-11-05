import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createNewVaultSettings } from "@/common/newVaultSettings.ts";

export function createDefaultCliSettings(): ObsidianLiveSyncSettings {
    return {
        ...createNewVaultSettings(),
        useIndexedDBAdapter: false,
        isConfigured: false,
    };
}
