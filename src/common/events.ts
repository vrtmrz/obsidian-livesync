export const EVENT_LAYOUT_READY = "layout-ready";
export const EVENT_PLUGIN_LOADED = "plugin-loaded";
export const EVENT_PLUGIN_UNLOADED = "plugin-unloaded";
export const EVENT_SETTING_SAVED = "setting-saved";
export const EVENT_FILE_RENAMED = "file-renamed";

export const EVENT_LEAF_ACTIVE_CHANGED = "leaf-active-changed";


// export const EVENT_FILE_CHANGED = "file-changed";

import { eventHub } from "../lib/src/hub/hub";
// TODO: Add overloads for the emit method to allow for type checking

export { eventHub };

