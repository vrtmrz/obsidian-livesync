import type ObsidianLiveSyncPlugin from "@/main";
import type { App, Plugin } from "@/deps";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { eventHub } from "@/common/events";
import { translateLiveSyncMessage } from "@/common/translation";
import type { ObsidianNoticeGroups } from "./ObsidianNoticeGroups";

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
