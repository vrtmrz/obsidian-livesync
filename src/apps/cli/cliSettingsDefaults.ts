import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";

export function createDefaultCliSettings(): ObsidianLiveSyncSettings {
    return {
        ...createNewVaultSettings(),
        useIndexedDBAdapter: false,
        isConfigured: false,
    };
}
