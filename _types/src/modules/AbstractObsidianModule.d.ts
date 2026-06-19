// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 9aeab51
import type { LiveSyncCore } from "@/main";
import type ObsidianLiveSyncPlugin from "@/main";
import { AbstractModule } from "./AbstractModule.ts";
export declare abstract class AbstractObsidianModule extends AbstractModule {
    plugin: ObsidianLiveSyncPlugin;
    get app(): import("obsidian").App;
    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore);
    isThisModuleEnabled(): boolean;
}
