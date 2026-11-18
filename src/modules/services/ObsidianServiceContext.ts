import type ObsidianLiveSyncPlugin from "@/main";
import type { App, Plugin } from "@/deps";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { eventHub } from "@/common/events";
import { translateLiveSyncMessage } from "@/common/translation";
import type { ObsidianNoticeGroups } from "./ObsidianNoticeGroups";
import type { KeyedNoticeManager } from "@vrtmrz/obsidian-plugin-kit/notice";

/** Host capabilities owned by one Self-hosted LiveSync plug-in instance. */
export class ObsidianServiceContext extends ServiceContext {
    app: App;
    plugin: Plugin;
    liveSyncPlugin: ObsidianLiveSyncPlugin;
    readonly notices: KeyedNoticeManager;
    readonly noticeGroups: ObsidianNoticeGroups;

    /**
     * Whether the host is in its foreground activity phase for lifecycle work.
     * Visibility transitions and database recovery use this to defer reopening and resumption
     * while backgrounded. The Obsidian adapter reads the current active document; focus,
     * plug-in readiness, explicit suspension, and database availability are separate conditions.
     */
    isHostActive(): boolean {
        return !activeWindow.document.hidden;
    }

    constructor(
        app: App,
        plugin: Plugin,
        liveSyncPlugin: ObsidianLiveSyncPlugin,
        notices: KeyedNoticeManager,
        noticeGroups: ObsidianNoticeGroups
    ) {
        super({ events: eventHub, translate: translateLiveSyncMessage });
        this.app = app;
        this.plugin = plugin;
        this.liveSyncPlugin = liveSyncPlugin;
        this.notices = notices;
        this.noticeGroups = noticeGroups;
    }
}
