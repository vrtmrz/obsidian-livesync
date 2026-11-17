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
     * Read the current active document's visibility at the time of the operation.
     * This is a document visibility signal, separate from focus, readiness, and user suspension;
     * it does not establish the native application's suspension state.
     */
    isActiveDocumentVisible(): boolean {
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
