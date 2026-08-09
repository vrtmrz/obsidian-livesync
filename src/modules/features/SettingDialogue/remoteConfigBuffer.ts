import { pickBucketSyncSettings, pickCouchDBSyncSettings, pickP2PSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

// Keep the setting dialogue buffer aligned with the current core settings before persisting other dirty keys.
// This also clears stale dirty values left from editing a different remote type before switching active remotes.
export function syncActivatedRemoteSettings(
    target: Partial<ObsidianLiveSyncSettings>,
    source: ObsidianLiveSyncSettings
): void {
    Object.assign(target, {
        remoteType: source.remoteType,
        activeConfigurationId: source.activeConfigurationId,
        ...pickBucketSyncSettings(source),
        ...pickCouchDBSyncSettings(source),
        ...pickP2PSyncSettings(source),
    });
}
