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

export const EVENT_REQUEST_SHOW_HISTORY = "show-history";

export const EVENT_REQUEST_RELOAD_SETTING_TAB = "reload-setting-tab";

export const EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG = "request-open-plugin-sync-dialog";


// export const EVENT_FILE_CHANGED = "file-changed";

import { eventHub } from "../lib/src/hub/hub";
// TODO: Add overloads for the emit method to allow for type checking

export { eventHub };

