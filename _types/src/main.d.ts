// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { Plugin, type App, type PluginManifest } from "./deps";
import { LiveSyncCommands } from "./features/LiveSyncCommands.ts";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext.ts";
import { LiveSyncBaseCore } from "./LiveSyncBaseCore.ts";
export type LiveSyncCore = LiveSyncBaseCore<ObsidianServiceContext, LiveSyncCommands>;
export default class ObsidianLiveSyncPlugin extends Plugin {
    core: LiveSyncCore;
    /**
     * Initialise service modules.
     */
    private initialiseServiceModules;
    /**
     * @obsolete Use services.setting.saveSettingData instead. Save the settings to the disk. This is usually called after changing the settings in the code, to persist the changes.
     */
    saveSettings(): Promise<void>;
    constructor(app: App, manifest: PluginManifest);
    private _startUp;
    onload(): void;
    onunload(): undefined;
}
