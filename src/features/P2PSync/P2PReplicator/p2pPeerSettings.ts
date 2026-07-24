import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type";

export type PersistedP2PPeerSetting =
    | "P2P_AutoSyncPeers"
    | "P2P_AutoWatchPeers"
    | "P2P_SyncOnReplication";

function splitPeerSetting(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
}

export function hasExactP2PPeer(value: string, peerName: string): boolean {
    return splitPeerSetting(value).includes(peerName);
}

export function toggleExactP2PPeer(value: string, peerName: string): string {
    const items = splitPeerSetting(value);
    const existingIndex = items.indexOf(peerName);
    if (existingIndex >= 0) {
        items.splice(existingIndex, 1);
    } else {
        items.push(peerName);
    }
    return [...new Set(items)].join(",");
}

export function togglePersistedP2PPeer(
    settings: ObsidianLiveSyncSettings,
    setting: PersistedP2PPeerSetting,
    peerName: string
): Partial<ObsidianLiveSyncSettings> {
    return {
        [setting]: toggleExactP2PPeer(settings[setting] ?? "", peerName),
    };
}
