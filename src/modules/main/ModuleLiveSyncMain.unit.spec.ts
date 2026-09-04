import { describe, expect, it, vi } from "vitest";
import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/common/events.ts", () => ({
    EVENT_LAYOUT_READY: "layout-ready",
    EVENT_PLUGIN_LOADED: "plugin-loaded",
    EVENT_REQUEST_RELOAD_SETTING_TAB: "reload-setting-tab",
    EVENT_SETTING_SAVED: "setting-saved",
    eventHub: {
        emitEvent: vi.fn(),
        onEvent: vi.fn(),
    },
}));

vi.mock("@/common/translation", () => ({
    $msg: (message: string) => message,
    setLang: vi.fn(),
}));

import { ModuleLiveSyncMain } from "./ModuleLiveSyncMain.ts";

describe("ModuleLiveSyncMain", () => {
    it("reports a database preparation failure at the application boundary", async () => {
        const initialiseDatabase = vi.fn(async () => false);
        const log = vi.fn();
        const host = {
            core: {
                services: {
                    appLifecycle: {
                        onLayoutReady: vi.fn(async () => true),
                    },
                },
            },
            services: {
                databaseEvents: { initialiseDatabase },
            },
            settings: {
                suspendFileWatching: false,
                suspendParseReplicationResult: false,
            },
            _log: log,
        };

        const result = await ModuleLiveSyncMain.prototype._onLiveSyncReady.call(host as never);

        expect(result).toBe(false);
        expect(initialiseDatabase).toHaveBeenCalledWith(false, false, false, true);
        expect(log).toHaveBeenCalledWith("Ui.Common.LocalDatabaseInitialisationFailed", LOG_LEVEL_NOTICE);
    });
});
