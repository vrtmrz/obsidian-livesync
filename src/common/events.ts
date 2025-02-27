import { eventHub } from "../lib/src/hub/hub";
import type ObsidianLiveSyncPlugin from "../main";

export const EVENT_PLUGIN_LOADED = "plugin-loaded";
export const EVENT_PLUGIN_UNLOADED = "plugin-unloaded";
export const EVENT_FILE_SAVED = "file-saved";
export const EVENT_LEAF_ACTIVE_CHANGED = "leaf-active-changed";

export const EVENT_REQUEST_OPEN_SETTINGS = "request-open-settings";
export const EVENT_REQUEST_OPEN_SETTING_WIZARD = "request-open-setting-wizard";
export const EVENT_REQUEST_OPEN_SETUP_URI = "request-open-setup-uri";
export const EVENT_REQUEST_COPY_SETUP_URI = "request-copy-setup-uri";

export const EVENT_REQUEST_RELOAD_SETTING_TAB = "reload-setting-tab";

export const EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG = "request-open-plugin-sync-dialog";

export const EVENT_REQUEST_OPEN_P2P = "request-open-p2p";
export const EVENT_REQUEST_CLOSE_P2P = "request-close-p2p";

export const EVENT_REQUEST_RUN_DOCTOR = "request-run-doctor";

// export const EVENT_FILE_CHANGED = "file-changed";

declare global {
    interface LSEvents {
        [EVENT_PLUGIN_LOADED]: ObsidianLiveSyncPlugin;
        [EVENT_PLUGIN_UNLOADED]: undefined;
        [EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG]: undefined;
        [EVENT_REQUEST_OPEN_SETTINGS]: undefined;
        [EVENT_REQUEST_OPEN_SETTING_WIZARD]: undefined;
        [EVENT_REQUEST_RELOAD_SETTING_TAB]: undefined;
        [EVENT_LEAF_ACTIVE_CHANGED]: undefined;
        [EVENT_REQUEST_CLOSE_P2P]: undefined;
        [EVENT_REQUEST_OPEN_P2P]: undefined;
        [EVENT_REQUEST_OPEN_SETUP_URI]: undefined;
        [EVENT_REQUEST_COPY_SETUP_URI]: undefined;
        [EVENT_REQUEST_RUN_DOCTOR]: string;
    }
}

export * from "../lib/src/events/coreEvents.ts";
export { eventHub };
