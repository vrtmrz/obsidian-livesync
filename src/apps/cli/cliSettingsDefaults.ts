import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types.js";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings.js";

export function createDefaultCliSettings(): ObsidianLiveSyncSettings {
    return {
        ...createNewVaultSettings(),
        useIndexedDBAdapter: false,
        isConfigured: false,
    };
}
