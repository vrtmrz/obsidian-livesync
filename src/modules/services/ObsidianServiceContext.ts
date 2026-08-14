import type ObsidianLiveSyncPlugin from "@/main.js";
import type { App, Plugin } from "@/deps.js";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/context.js";
import { eventHub } from "@/common/events.js";
import { translateLiveSyncMessage } from "@/common/translation.js";
import type { ObsidianNoticeGroups } from "./ObsidianNoticeGroups.js";

/** Host capabilities owned by one Self-hosted LiveSync plug-in instance. */
export class ObsidianServiceContext extends ServiceContext {
    app: App;
    plugin: Plugin;
    liveSyncPlugin: ObsidianLiveSyncPlugin;
    readonly noticeGroups: ObsidianNoticeGroups;

    constructor(app: App, plugin: Plugin, liveSyncPlugin: ObsidianLiveSyncPlugin, noticeGroups: ObsidianNoticeGroups) {
        super({ events: eventHub, translate: translateLiveSyncMessage });
        this.app = app;
        this.plugin = plugin;
        this.liveSyncPlugin = liveSyncPlugin;
        this.noticeGroups = noticeGroups;
    }
}
