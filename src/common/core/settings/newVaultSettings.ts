import { createNewVaultSettings as createCommonlibNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

/** Create settings for a new LiveSync environment. */
export function createNewVaultSettings(): ObsidianLiveSyncSettings {
    return {
        ...createCommonlibNewVaultSettings(),
        pathNormalizationVersion: 1,
    };
}
