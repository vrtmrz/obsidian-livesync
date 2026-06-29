// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { ServiceContext } from "@lib/services/base/ServiceBase";
import type ObsidianLiveSyncPlugin from "@/main";
import type { App, Plugin } from "@/deps";
export declare class ObsidianServiceContext extends ServiceContext {
    app: App;
    plugin: Plugin;
    liveSyncPlugin: ObsidianLiveSyncPlugin;
    constructor(app: App, plugin: Plugin, liveSyncPlugin: ObsidianLiveSyncPlugin);
}
