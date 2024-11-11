import type { FilePathWithPrefix, ObsidianLiveSyncSettings } from "../lib/src/common/types";
import { eventHub } from "../lib/src/hub/hub";
import type ObsidianLiveSyncPlugin from "../main";

export const EVENT_LAYOUT_READY = "layout-ready";
export const EVENT_PLUGIN_LOADED = "plugin-loaded";
export const EVENT_PLUGIN_UNLOADED = "plugin-unloaded";
export const EVENT_SETTING_SAVED = "setting-saved";
export const EVENT_FILE_RENAMED = "file-renamed";
export const EVENT_FILE_SAVED = "file-saved";
export const EVENT_LEAF_ACTIVE_CHANGED = "leaf-active-changed";

export const EVENT_LOG_ADDED = "log-added";

export const EVENT_REQUEST_OPEN_SETTINGS = "request-open-settings";
export const EVENT_REQUEST_OPEN_SETTING_WIZARD = "request-open-setting-wizard";
export const EVENT_REQUEST_OPEN_SETUP_URI = "request-open-setup-uri";
export const EVENT_REQUEST_COPY_SETUP_URI = "request-copy-setup-uri";



export const EVENT_REQUEST_RELOAD_SETTING_TAB = "reload-setting-tab";

export const EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG = "request-open-plugin-sync-dialog";


// export const EVENT_FILE_CHANGED = "file-changed";

declare global {
    interface LSEvents {
        [EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG]: undefined;
        [EVENT_FILE_SAVED]: undefined;
        [EVENT_REQUEST_OPEN_SETUP_URI]: undefined;
        [EVENT_REQUEST_COPY_SETUP_URI]: undefined;
        [EVENT_REQUEST_RELOAD_SETTING_TAB]: undefined;
        [EVENT_PLUGIN_UNLOADED]: undefined;
        [EVENT_SETTING_SAVED]: ObsidianLiveSyncSettings;
        [EVENT_PLUGIN_LOADED]: ObsidianLiveSyncPlugin;
        [EVENT_LAYOUT_READY]: undefined;
        "event-file-changed": { file: FilePathWithPrefix, automated: boolean };
        "document-stub-created":
        {
            toc: Set<string>, stub: { [key: string]: { [key: string]: Map<string, Record<string, string>> } }
        },
        [EVENT_REQUEST_OPEN_SETTINGS]: undefined;
        [EVENT_REQUEST_OPEN_SETTING_WIZARD]: undefined;
        [EVENT_FILE_RENAMED]: { newPath: FilePathWithPrefix, old: FilePathWithPrefix };
        [EVENT_LEAF_ACTIVE_CHANGED]: undefined;
    }
}

export { eventHub };

