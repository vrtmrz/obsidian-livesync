import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

export function getAutomaticSyncTargetFiles(
    key: string,
    configDir: string,
    entries: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"]
): string[] {
    const keys = key.startsWith("PLUGIN_ALL/")
        ? [`PLUGIN_DATA/${key.substring("PLUGIN_ALL/".length)}`, `PLUGIN_MAIN/${key.substring("PLUGIN_ALL/".length)}`]
        : [key];
    const files = new Set(keys.flatMap((entryKey) => entries[entryKey]?.files ?? []));
    return [...files].map((file) => `${configDir}/${file}`);
}
