// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePathWithPrefix, ObsidianLiveSyncSettings } from "@lib/common/types";
export declare const EVENT_LAYOUT_READY = "layout-ready";
export declare const EVENT_PLUGIN_LOADED = "plugin-loaded";
export declare const EVENT_PLUGIN_UNLOADED = "plugin-unloaded";
export declare const EVENT_SETTING_SAVED = "setting-saved";
export declare const EVENT_FILE_RENAMED = "file-renamed";
export declare const EVENT_FILE_SAVED = "file-saved";
export declare const EVENT_LEAF_ACTIVE_CHANGED = "leaf-active-changed";
export declare const EVENT_DATABASE_REBUILT = "database-rebuilt";
export declare const EVENT_LOG_ADDED = "log-added";
export declare const EVENT_REQUEST_OPEN_SETUP_URI = "request-open-setup-uri";
export declare const EVENT_REQUEST_COPY_SETUP_URI = "request-copy-setup-uri";
export declare const EVENT_REQUEST_SHOW_SETUP_QR = "request-show-setup-qr";
export declare const EVENT_REQUEST_RELOAD_SETTING_TAB = "reload-setting-tab";
export declare const EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG = "request-open-plugin-sync-dialog";
export declare const EVENT_FILE_CHANGED = "event-file-changed";
export declare const EVENT_REQUEST_OPEN_P2P_SETTINGS = "request-open-p2p-settings";
export declare const EVENT_REQUEST_OPEN_P2P = "request-open-p2p";
export declare const EVENT_REQUEST_CLOSE_P2P = "request-close-p2p";
export declare const EVENT_PLATFORM_UNLOADED = "platform-unloaded";
export declare const EVENT_ON_UNRESOLVED_ERROR = "on-unresolved-error";
export declare const EVENT_REQUEST_CHECK_REMOTE_SIZE = "request-check-remote-size";
declare global {
    interface LSEvents {
        [EVENT_FILE_SAVED]: undefined;
        [EVENT_SETTING_SAVED]: ObsidianLiveSyncSettings;
        [EVENT_LAYOUT_READY]: undefined;
        [EVENT_FILE_CHANGED]: {
            file: FilePathWithPrefix;
            automated: boolean;
        };
        [EVENT_FILE_RENAMED]: {
            newPath: FilePathWithPrefix;
            old: FilePathWithPrefix;
        };
        [EVENT_DATABASE_REBUILT]: undefined;
        [EVENT_REQUEST_OPEN_P2P_SETTINGS]: undefined;
        [EVENT_REQUEST_SHOW_SETUP_QR]: undefined;
        [EVENT_REQUEST_OPEN_P2P]: undefined;
        [EVENT_REQUEST_CLOSE_P2P]: undefined;
        [EVENT_PLATFORM_UNLOADED]: undefined;
        [EVENT_ON_UNRESOLVED_ERROR]: undefined;
        [EVENT_REQUEST_CHECK_REMOTE_SIZE]: undefined;
    }
}
