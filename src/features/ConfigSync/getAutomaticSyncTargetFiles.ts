import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

import { findCustomisationEntryKey } from "@/features/HiddenFileCommon/optionalFileSyncSelection";

export function getAutomaticSyncTargetFiles(
    key: string,
    configDir: string,
    entries: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"],
    insensitive = false
): string[] {
    const keys = key.startsWith("PLUGIN_ALL/")
        ? [`PLUGIN_DATA/${key.substring("PLUGIN_ALL/".length)}`, `PLUGIN_MAIN/${key.substring("PLUGIN_ALL/".length)}`]
        : [key];
    const files = new Set(
        keys.flatMap((itemKey) => {
            const entryKey = findCustomisationEntryKey(itemKey, entries, insensitive);
            return entryKey === undefined ? [] : entries[entryKey].files ?? [];
        })
    );
    return [...files].map((file) => `${configDir}/${file}`);
}
