import type ObsidianLiveSyncPlugin from "@/main";
import type { App, Plugin } from "@/deps";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { eventHub } from "@/common/events";
import { translateLiveSyncMessage } from "@/common/translation";

/** Host capabilities owned by one Self-hosted LiveSync plug-in instance. */
export class ObsidianServiceContext extends ServiceContext {
    app: App;
    plugin: Plugin;
    liveSyncPlugin: ObsidianLiveSyncPlugin;

    constructor(app: App, plugin: Plugin, liveSyncPlugin: ObsidianLiveSyncPlugin) {
        super({ events: eventHub, translate: translateLiveSyncMessage });
        this.app = app;
        this.plugin = plugin;
        this.liveSyncPlugin = liveSyncPlugin;
    }
}
