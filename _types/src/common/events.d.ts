// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { eventHub } from "@lib/hub/hub";
export declare const EVENT_PLUGIN_LOADED = "plugin-loaded";
export declare const EVENT_PLUGIN_UNLOADED = "plugin-unloaded";
export declare const EVENT_FILE_SAVED = "file-saved";
export declare const EVENT_LEAF_ACTIVE_CHANGED = "leaf-active-changed";
export declare const EVENT_REQUEST_OPEN_SETTINGS = "request-open-settings";
export declare const EVENT_REQUEST_OPEN_SETTING_WIZARD = "request-open-setting-wizard";
export declare const EVENT_REQUEST_OPEN_SETUP_URI = "request-open-setup-uri";
export declare const EVENT_REQUEST_COPY_SETUP_URI = "request-copy-setup-uri";
export declare const EVENT_REQUEST_SHOW_SETUP_QR = "request-show-setup-qr";
export declare const EVENT_REQUEST_RELOAD_SETTING_TAB = "reload-setting-tab";
export declare const EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG = "request-open-plugin-sync-dialog";
export declare const EVENT_REQUEST_RUN_DOCTOR = "request-run-doctor";
export declare const EVENT_REQUEST_RUN_FIX_INCOMPLETE = "request-run-fix-incomplete";
export declare const EVENT_ANALYSE_DB_USAGE = "analyse-db-usage";
export declare const EVENT_REQUEST_PERFORM_GC_V3 = "request-perform-gc-v3";
declare global {
    interface LSEvents {
        [EVENT_PLUGIN_LOADED]: undefined;
        [EVENT_PLUGIN_UNLOADED]: undefined;
        [EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG]: undefined;
        [EVENT_REQUEST_OPEN_SETTINGS]: undefined;
        [EVENT_REQUEST_OPEN_SETTING_WIZARD]: undefined;
        [EVENT_REQUEST_RELOAD_SETTING_TAB]: undefined;
        [EVENT_LEAF_ACTIVE_CHANGED]: undefined;
        [EVENT_REQUEST_OPEN_SETUP_URI]: undefined;
        [EVENT_REQUEST_COPY_SETUP_URI]: undefined;
        [EVENT_REQUEST_SHOW_SETUP_QR]: undefined;
        [EVENT_REQUEST_RUN_DOCTOR]: string;
        [EVENT_REQUEST_RUN_FIX_INCOMPLETE]: undefined;
        [EVENT_ANALYSE_DB_USAGE]: undefined;
        [EVENT_REQUEST_PERFORM_GC_V3]: undefined;
    }
}
export * from "@lib/events/coreEvents.ts";
export { eventHub };
