import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/settings";
import { REMOTE_COUCHDB, REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import { $msg } from "@/common/translation";
import type { StatusBarPart } from "./StatusBarRenderer.ts";

type SyncModeSettings = Pick<
    ObsidianLiveSyncSettings,
    | "isConfigured"
    | "remoteType"
    | "liveSync"
    | "periodicReplication"
    | "syncOnSave"
    | "syncOnEditorSave"
    | "syncOnStart"
    | "syncOnFileOpen"
    | "syncAfterMerge"
>;

export function projectSyncModeLabel(settings: Readonly<SyncModeSettings>): StatusBarPart | undefined {
    if (!settings.isConfigured || (settings.remoteType !== REMOTE_COUCHDB && settings.remoteType !== REMOTE_MINIO)) {
        return undefined;
    }

    const icons: string[] = [];
    const modes: string[] = [];
    if (settings.liveSync) {
        icons.push("🔗");
        modes.push($msg("obsidianLiveSyncSettingTab.optionLiveSync"));
    }
    if (settings.periodicReplication) {
        icons.push("⏰");
        modes.push($msg("moduleLog.syncMode.periodic"));
    }
    if (
        settings.syncOnSave ||
        settings.syncOnEditorSave ||
        settings.syncOnStart ||
        settings.syncOnFileOpen ||
        settings.syncAfterMerge
    ) {
        icons.push("✨");
        modes.push($msg("obsidianLiveSyncSettingTab.optionOnEvents"));
    }

    return {
        key: "sync-mode",
        text: icons.length === 0 ? "🛎" : icons.join(" "),
        title:
            modes.length === 0
                ? $msg("moduleLog.syncMode.manual")
                : $msg("moduleLog.syncMode.configured", { modes: modes.join(", ") }),
    };
}
