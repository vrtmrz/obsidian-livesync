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

vi.mock("@vrtmrz/livesync-commonlib/compat/worker/bgWorker", () => ({
    initialiseWorkerModule: vi.fn(),
}));

import { ModuleLiveSyncMain } from "./ModuleLiveSyncMain.ts";

describe("ModuleLiveSyncMain", () => {
    it.each(["unlock", "cancel"] as const)(
        "keeps database and settings lifecycle behind a pending configuration load: %s",
        async (outcome) => {
            let unlock!: () => void;
            let cancel!: (error: Error) => void;
            const loadSettings = vi.fn(
                () =>
                    new Promise<void>((resolve, reject) => {
                        unlock = resolve;
                        cancel = reject;
                    })
            );
            const appLifecycle = {
                onWireUpEvents: vi.fn(async () => true),
                onInitialise: vi.fn(async () => true),
                onSettingLoaded: vi.fn(async () => true),
                onLoaded: vi.fn(async () => true),
            };
            const openDatabase = vi.fn(async () => undefined);
            const services = {
                context: { events: {} },
                setting: { loadSettings },
                appLifecycle,
                database: { openDatabase },
                databaseEvents: {},
                replicator: {},
            };
            const host = { services, core: { services, addOns: [] }, _log: vi.fn() };
            const pending = ModuleLiveSyncMain.prototype._onLiveSyncLoad.call(host as never);
            await vi.waitFor(() => expect(loadSettings).toHaveBeenCalledOnce());
            expect(appLifecycle.onSettingLoaded).not.toHaveBeenCalled();
            expect(openDatabase).not.toHaveBeenCalled();
            expect(appLifecycle.onLoaded).not.toHaveBeenCalled();

            if (outcome === "cancel") {
                const rejected = expect(pending).rejects.toThrow("synthetic cancelled configuration load");
                cancel(new Error("synthetic cancelled configuration load"));
                await rejected;
                expect(appLifecycle.onSettingLoaded).not.toHaveBeenCalled();
                expect(openDatabase).not.toHaveBeenCalled();
                expect(appLifecycle.onLoaded).not.toHaveBeenCalled();
            } else {
                unlock();
                await expect(pending).resolves.toBe(true);
                expect(appLifecycle.onSettingLoaded).toHaveBeenCalledOnce();
                expect(openDatabase).toHaveBeenCalledOnce();
                expect(appLifecycle.onSettingLoaded.mock.invocationCallOrder[0]).toBeLessThan(
                    openDatabase.mock.invocationCallOrder[0]
                );
            }
        }
    );

    it("reports a database preparation failure at the application boundary", async () => {
        const initialiseDatabase = vi.fn(async () => false);
        const log = vi.fn();
        const host = {
            core: {
                startupDatabaseOptions: {},
                services: {
                    appLifecycle: {
                        onLayoutReady: vi.fn(async () => true),
                    },
                },
            },
            services: {
                API: { getPlatform: () => "desktop" },
                databaseEvents: { initialiseDatabase },
            },
            settings: {
                strictContentCheckOnStartup: false,
                suspendFileWatching: false,
                suspendParseReplicationResult: false,
            },
            _log: log,
        };

        const result = await ModuleLiveSyncMain.prototype._onLiveSyncReady.call(host as never);

        expect(result).toBe(false);
        expect(initialiseDatabase).toHaveBeenCalledWith(false, false, false, true, { strictContentCheck: false });
        expect(log).toHaveBeenCalledWith("Ui.Common.LocalDatabaseInitialisationFailed", LOG_LEVEL_NOTICE);
    });

    it("warns when start-up continues with individual file failures", async () => {
        const initialiseDatabase = vi.fn(async () => "completed-with-file-failures");
        const log = vi.fn();
        const appLifecycle = {
            onLayoutReady: vi.fn(async () => true),
            onFirstInitialise: vi.fn(async () => true),
            onScanningStartupIssues: vi.fn(async () => true),
        };
        const host = {
            core: {
                startupDatabaseOptions: {},
                services: { appLifecycle },
            },
            services: {
                API: { getPlatform: () => "desktop" },
                appLifecycle,
                control: { applySettings: vi.fn(async () => undefined) },
                databaseEvents: { initialiseDatabase },
            },
            settings: {
                suspendFileWatching: false,
                suspendParseReplicationResult: false,
            },
            _log: log,
        };

        const result = await ModuleLiveSyncMain.prototype._onLiveSyncReady.call(host as never);

        expect(result).toBe(true);
        expect(log).toHaveBeenCalledWith("Ui.Common.SomeFilesCouldNotBeSynchronised", LOG_LEVEL_NOTICE);
    });

    it("passes strict startup database options to initialisation", async () => {
        const initialiseDatabase = vi.fn(async () => false);
        const host = {
            core: {
                startupDatabaseOptions: {
                    ignoreSuspending: true,
                    continueOnFileFailure: false,
                },
                services: {
                    appLifecycle: {
                        onLayoutReady: vi.fn(async () => true),
                    },
                },
            },
            services: {
                API: { getPlatform: () => "desktop" },
                databaseEvents: { initialiseDatabase },
            },
            settings: {
                suspendFileWatching: false,
                suspendParseReplicationResult: false,
            },
            _log: vi.fn(),
        };

        await ModuleLiveSyncMain.prototype._onLiveSyncReady.call(host as never);

        expect(initialiseDatabase).toHaveBeenCalledWith(false, false, true, false, { strictContentCheck: true });
    });

    it("passes the strict content check setting for ordinary Obsidian start-up", async () => {
        const initialiseDatabase = vi.fn(async () => false);
        const host = {
            core: {
                startupDatabaseOptions: {},
                services: {
                    appLifecycle: {
                        onLayoutReady: vi.fn(async () => true),
                    },
                },
            },
            services: {
                API: { getPlatform: () => "desktop" },
                databaseEvents: { initialiseDatabase },
            },
            settings: {
                strictContentCheckOnStartup: true,
                suspendFileWatching: false,
                suspendParseReplicationResult: false,
            },
            _log: vi.fn(),
        };

        await ModuleLiveSyncMain.prototype._onLiveSyncReady.call(host as never);

        expect(initialiseDatabase).toHaveBeenCalledWith(false, false, false, true, { strictContentCheck: true });
    });

    it.each(["server", "browser"])(
        "keeps the strict content check on non-Obsidian host start-up (%s)",
        async (platform) => {
            const initialiseDatabase = vi.fn(async () => false);
            const host = {
                core: {
                    startupDatabaseOptions: { ignoreSuspending: false, continueOnFileFailure: true },
                    services: {
                        appLifecycle: {
                            onLayoutReady: vi.fn(async () => true),
                        },
                    },
                },
                services: {
                    API: { getPlatform: () => platform },
                    databaseEvents: { initialiseDatabase },
                },
                settings: {
                    strictContentCheckOnStartup: false,
                    suspendFileWatching: false,
                    suspendParseReplicationResult: false,
                },
                _log: vi.fn(),
            };

            await ModuleLiveSyncMain.prototype._onLiveSyncReady.call(host as never);

            expect(initialiseDatabase).toHaveBeenCalledWith(false, false, false, true, { strictContentCheck: true });
        }
    );

    it("keeps explicit recovery startup options strict when the setting is off", async () => {
        const initialiseDatabase = vi.fn(async () => false);
        const host = {
            core: {
                startupDatabaseOptions: {
                    ignoreSuspending: false,
                    continueOnFileFailure: false,
                },
                services: {
                    appLifecycle: {
                        onLayoutReady: vi.fn(async () => true),
                    },
                },
            },
            services: {
                API: { getPlatform: () => "desktop" },
                databaseEvents: { initialiseDatabase },
            },
            settings: {
                strictContentCheckOnStartup: false,
                suspendFileWatching: false,
                suspendParseReplicationResult: false,
            },
            _log: vi.fn(),
        };

        await ModuleLiveSyncMain.prototype._onLiveSyncReady.call(host as never);

        expect(initialiseDatabase).toHaveBeenCalledWith(false, false, false, false, { strictContentCheck: true });
    });
});
