// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ObsidianLiveSyncSettings } from "@lib/common/models/setting.type";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
export declare function generateReport(settings: ObsidianLiveSyncSettings, core: LiveSyncBaseCore): Promise<{
    obsidianInfo: {
        navigator: string;
        fileSystem: string;
    };
    responseConfig: Record<string, unknown>;
    pluginConfig: ObsidianLiveSyncSettings;
    manifestVersion: string;
    packageVersion: string;
}>;
