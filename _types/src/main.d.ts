// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { Plugin, type App, type PluginManifest } from "./deps";
import type { LiveSyncCore } from "./types.ts";
export type { LiveSyncCore, NecessaryObsidianFeature, ObsidianServiceFeatureFunction } from "./types.ts";
export { createObsidianServiceFeature } from "./types.ts";
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
