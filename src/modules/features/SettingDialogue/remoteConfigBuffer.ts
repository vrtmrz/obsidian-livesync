import {
    pickBucketSyncSettings,
    pickCouchDBSyncSettings,
    pickP2PSyncSettings,
    pickWebDAVSyncSettings,
} from "@lib/common/utils.ts";
import type { ObsidianLiveSyncSettings } from "@lib/common/types.ts";

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
        ...pickWebDAVSyncSettings(source),
    });
}
