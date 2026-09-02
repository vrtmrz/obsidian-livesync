import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, LOG_LEVEL_NOTICE, REMOTE_COUCHDB } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { REMOTE_RESOURCE_KINDS } from "@vrtmrz/livesync-commonlib/replication";

const settingsInitialisationMocks = vi.hoisted(() => ({
    applySettingsWithInitialisationChoice: vi.fn(),
}));
const loggerMocks = vi.hoisted(() => ({
    Logger: vi.fn(),
}));

vi.mock("@/deps.ts", () => ({
    App: class {},
    Component: class {
        load = vi.fn();
        unload = vi.fn();
        register = vi.fn();
    },
    PluginSettingTab: class {},
    SettingPage: undefined,
    requireApiVersion: vi.fn(() => false),
}));
vi.mock("@/main.ts", () => ({ default: class {} }));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/logger", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@vrtmrz/livesync-commonlib/compat/common/logger")>();
    return { ...actual, Logger: loggerMocks.Logger };
});
vi.mock("@/common/translation", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/common/translation")>();
    return { ...actual, $msg: vi.fn(actual.$msg) };
});
vi.mock("@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions", () => ({
    getLanguage: vi.fn(() => "en"),
    compatGlobal: {
        localStorage: {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
        },
    },
}));
vi.mock("@/common/events.ts", () => ({
    EVENT_ON_UNRESOLVED_ERROR: "on-unresolved-error",
    EVENT_REQUEST_COPY_SETUP_URI: "request-copy-setup-uri",
    EVENT_REQUEST_OPEN_SETUP_URI: "request-open-setup-uri",
    EVENT_REQUEST_RELOAD_SETTING_TAB: "request-reload-setting-tab",
    EVENT_REQUEST_SHOW_SETUP_QR: "request-show-setup-qr",
    eventHub: { emitEvent: vi.fn(), onEvent: vi.fn() },
}));
vi.mock("@/modules/features/SetupManager.ts", () => ({ SetupManager: class {} }));
vi.mock("./LiveSyncSetting.ts", () => ({ LiveSyncSetting: class {} }));
vi.mock("./SettingPane.ts", () => ({
    enableOnly: vi.fn(() => vi.fn()),
    setLevelClass: vi.fn(),
    setStyle: vi.fn(),
    visibleOnly: vi.fn(() => vi.fn()),
}));
vi.mock("./PaneChangeLog.ts", () => ({ paneChangeLog: vi.fn() }));
vi.mock("./PaneQuickSetup.ts", () => ({ paneQuickSetup: vi.fn() }));
vi.mock("./PaneHelp.ts", () => ({ paneHelp: vi.fn() }));
vi.mock("./PaneGeneral.ts", () => ({ paneGeneral: vi.fn() }));
vi.mock("./PaneRemoteConfig.ts", () => ({ paneRemoteConfig: vi.fn() }));
vi.mock("./PaneSelector.ts", () => ({ paneSelector: vi.fn() }));
vi.mock("./PaneSyncSettings.ts", () => ({ paneSyncSettings: vi.fn() }));
vi.mock("./PaneCustomisationSync.ts", () => ({ paneCustomisationSync: vi.fn() }));
vi.mock("./PaneHatch.ts", () => ({ paneHatch: vi.fn() }));
vi.mock("./PaneAdvanced.ts", () => ({ paneAdvanced: vi.fn() }));
vi.mock("./PanePowerUsers.ts", () => ({ panePowerUsers: vi.fn() }));
vi.mock("./PanePatches.ts", () => ({ panePatches: vi.fn() }));
vi.mock("./PaneMaintenance.ts", () => ({ paneMaintenance: vi.fn() }));

import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { $msg } from "@/common/translation";

beforeEach(() => {
    settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockReset();
    loggerMocks.Logger.mockClear();
    vi.mocked($msg).mockClear();
});

describe("ObsidianLiveSyncSettingTab passphrase verification", () => {
    it("awaits and disposes the owned synchronisation-information resource", async () => {
        const check = vi.fn(async () => true);
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ check, dispose }));
        const plugin = {
            app: {},
            core: {
                services: {
                    replicator: { createRemoteResource },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                remoteType: REMOTE_COUCHDB,
            },
        });

        await expect(tab.checkWorkingPassphrase()).resolves.toBe(true);

        expect(createRemoteResource).toHaveBeenCalledWith(
            REMOTE_RESOURCE_KINDS.SYNCHRONISATION_INFORMATION,
            expect.objectContaining({ remoteType: REMOTE_COUCHDB })
        );
        expect(check).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("does not use the general Replicator factory solely to verify synchronisation information", async () => {
        const getNewReplicator = vi.fn(() => Promise.reject(new Error("must not construct a Replicator")));
        const createRemoteResource = vi.fn(async () => ({
            check: vi.fn(async () => true),
            dispose: vi.fn(async () => undefined),
        }));
        const plugin = {
            app: {},
            core: {
                services: {
                    replicator: { createRemoteResource, getNewReplicator },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                remoteType: REMOTE_COUCHDB,
            },
        });

        await expect(tab.checkWorkingPassphrase()).resolves.toBe(true);

        expect(getNewReplicator).not.toHaveBeenCalled();
    });

    it("reports a CouchDB connection or setup failure with the connection-failure message", async () => {
        const failure = new Error("remote unavailable");
        const check = vi.fn(async () => {
            throw failure;
        });
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ check, dispose }));
        const plugin = {
            app: {},
            core: {
                services: {
                    replicator: { createRemoteResource },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                remoteType: REMOTE_COUCHDB,
            },
        });

        await expect(tab.checkWorkingPassphrase()).resolves.toBe(false);

        expect(vi.mocked($msg)).toHaveBeenCalledWith("obsidianLiveSyncSettingTab.logCheckPassphraseFailed", {
            db: failure.message,
        });
        expect(vi.mocked($msg)).not.toHaveBeenCalledWith("obsidianLiveSyncSettingTab.logPassphraseNotCompatible");
        expect(loggerMocks.Logger).toHaveBeenCalledWith(expect.any(String), LOG_LEVEL_NOTICE);
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("reports an actual synchronisation-information mismatch with the incompatibility message", async () => {
        const check = vi.fn(async () => false);
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ check, dispose }));
        const plugin = {
            app: {},
            core: {
                services: {
                    replicator: { createRemoteResource },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                remoteType: REMOTE_COUCHDB,
            },
        });

        await expect(tab.checkWorkingPassphrase()).resolves.toBe(false);

        expect(vi.mocked($msg)).toHaveBeenCalledWith("obsidianLiveSyncSettingTab.logPassphraseNotCompatible");
        expect(vi.mocked($msg)).not.toHaveBeenCalledWith(
            "obsidianLiveSyncSettingTab.logCheckPassphraseFailed",
            expect.anything()
        );
        expect(loggerMocks.Logger).toHaveBeenCalledWith(expect.any(String), LOG_LEVEL_NOTICE);
        expect(dispose).toHaveBeenCalledOnce();
    });
});

describe("ObsidianLiveSyncSettingTab connection testing", () => {
    it("uses and disposes the flow-specific connection probe without borrowing a Replicator", async () => {
        const check = vi.fn(async () => ({ ok: true as const }));
        const getStatus = vi.fn(async () => ({ estimatedSize: 1024 }));
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ check, getStatus, dispose }));
        const getNewReplicator = vi.fn(() => Promise.reject(new Error("must not borrow a Replicator")));
        const plugin = {
            app: {},
            core: {
                services: {
                    replicator: { createRemoteResource, getNewReplicator },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                remoteType: REMOTE_COUCHDB,
                couchDB_DBNAME: "saved",
            },
        });

        await expect(tab.testConnection({ couchDB_DBNAME: "trial" })).resolves.toBeUndefined();

        expect(createRemoteResource).toHaveBeenCalledWith(
            REMOTE_RESOURCE_KINDS.CONNECTION,
            expect.objectContaining({ remoteType: REMOTE_COUCHDB, couchDB_DBNAME: "trial" })
        );
        expect(check).toHaveBeenCalledWith({ createIfMissing: true, showResult: true });
        expect(getStatus).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
        expect(getNewReplicator).not.toHaveBeenCalled();
    });
});

describe("ObsidianLiveSyncSettingTab Fresh Start Wipe", () => {
    it("returns the remote wipe result and disposes its temporary Journal client", async () => {
        const resetBucket = vi.fn(async () => false);
        const dispose = vi.fn();
        const tab = new ObsidianLiveSyncSettingTab(
            {} as never,
            {
                app: {},
                core: {},
            } as never
        );
        vi.spyOn(tab, "getMinioJournalSyncClient").mockReturnValue({ resetBucket, dispose } as never);

        await expect(tab.resetRemoteBucket()).resolves.toBe(false);

        expect(resetBucket).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });
});

describe("ObsidianLiveSyncSettingTab pending-setting initialisation", () => {
    function createSettingsTab() {
        const saveSettingData = vi.fn(async () => undefined);
        const confirmWithMessage = vi.fn();
        const plugin = {
            app: {},
            core: {
                settings: {
                    ...DEFAULT_SETTINGS,
                    handleFilenameCaseSensitive: false,
                },
                getModule: vi.fn(() => settingsInitialisationMocks),
                confirm: {
                    confirmWithMessage,
                },
                services: {
                    setting: {
                        saveSettingData,
                        getDeviceAndVaultName: vi.fn(() => ""),
                    },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                handleFilenameCaseSensitive: true,
            },
            initialSettings: {
                ...DEFAULT_SETTINGS,
                handleFilenameCaseSensitive: false,
            },
        });
        vi.spyOn(tab, "isPassphraseValid").mockResolvedValue(true);
        vi.spyOn(tab, "checkWorkingPassphrase").mockResolvedValue(true);
        const closeSetting = vi.spyOn(tab, "closeSetting").mockImplementation(() => undefined);
        return { tab, saveSettingData, confirmWithMessage, closeSetting };
    }

    it("keeps pending settings in the editing buffer when initialisation and the fallback are cancelled", async () => {
        const { tab, saveSettingData, confirmWithMessage, closeSetting } = createSettingsTab();
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockResolvedValueOnce({
            result: "cancelled",
        });
        confirmWithMessage.mockResolvedValueOnce("Keep Editing");

        await tab.confirmRebuild();

        expect(settingsInitialisationMocks.applySettingsWithInitialisationChoice).toHaveBeenCalledOnce();
        expect(confirmWithMessage).toHaveBeenCalledWith(
            "Apply Settings without Initialisation?",
            expect.any(String),
            ["Apply without Initialisation", "Keep Editing"],
            "Keep Editing"
        );
        expect(saveSettingData).not.toHaveBeenCalled();
        expect(tab.editingSettings.handleFilenameCaseSensitive).toBe(true);
        expect(tab.core.settings.handleFilenameCaseSensitive).toBe(false);
        expect(closeSetting).not.toHaveBeenCalled();
    });

    it("applies pending settings only after a separately confirmed initialisation bypass", async () => {
        const { tab, saveSettingData, confirmWithMessage, closeSetting } = createSettingsTab();
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockResolvedValueOnce({
            result: "cancelled",
        });
        confirmWithMessage.mockResolvedValueOnce("Apply without Initialisation");

        await tab.confirmRebuild();

        expect(settingsInitialisationMocks.applySettingsWithInitialisationChoice).toHaveBeenCalledOnce();
        expect(saveSettingData).toHaveBeenCalledOnce();
        expect(tab.core.settings.handleFilenameCaseSensitive).toBe(true);
        expect(closeSetting).not.toHaveBeenCalled();
    });

    it("closes settings only after initialisation has been scheduled", async () => {
        const { tab, saveSettingData, confirmWithMessage, closeSetting } = createSettingsTab();
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockImplementationOnce(
            async ({ applySettings }: { applySettings: () => Promise<void> }) => {
                await applySettings();
                return { result: "scheduled", mode: "rebuild" };
            }
        );

        await tab.confirmRebuild();

        expect(saveSettingData).toHaveBeenCalledOnce();
        expect(confirmWithMessage).not.toHaveBeenCalled();
        expect(closeSetting).toHaveBeenCalledOnce();
    });

    it("does not offer the settings-only fallback after an initialisation failure", async () => {
        const { tab, saveSettingData, confirmWithMessage, closeSetting } = createSettingsTab();
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockResolvedValueOnce({
            result: "failed",
            mode: "fetch",
        });

        await tab.confirmRebuild();

        expect(saveSettingData).not.toHaveBeenCalled();
        expect(confirmWithMessage).not.toHaveBeenCalled();
        expect(tab.editingSettings.handleFilenameCaseSensitive).toBe(true);
        expect(tab.core.settings.handleFilenameCaseSensitive).toBe(false);
        expect(closeSetting).not.toHaveBeenCalled();
    });
});

describe("ObsidianLiveSyncSettingTab declarative settings boundary", () => {
    function createSettingsTab() {
        const saveSettingData = vi.fn(async () => undefined);
        const plugin = {
            app: {},
            core: {
                settings: {
                    ...DEFAULT_SETTINGS,
                    hashCacheMaxCount: 300,
                    displayLanguage: "",
                },
                services: {
                    setting: {
                        saveSettingData,
                        getDeviceAndVaultName: vi.fn(() => ""),
                    },
                },
            },
        };
        Object.defineProperty(plugin, "settings", {
            get: () => {
                throw new Error("The declarative adapter must not use plugin.settings");
            },
        });
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                hashCacheMaxCount: 300,
                displayLanguage: "",
            },
            initialSettings: {
                ...DEFAULT_SETTINGS,
                hashCacheMaxCount: 300,
                displayLanguage: "",
            },
        });
        return { tab, saveSettingData };
    }

    it("loads the imperative fallback without a SettingPage runtime export", () => {
        const { tab } = createSettingsTab();

        expect(tab.display).toBeTypeOf("function");
        expect(tab.getSettingDefinitions()).toEqual([]);
    });

    it("reads and writes registered controls through the editing buffer and existing save owner", async () => {
        const { tab } = createSettingsTab();
        const saveSettings = vi.spyOn(tab, "saveSettings").mockResolvedValue(undefined);

        expect(tab.getControlValue("hashCacheMaxCount")).toBe(300);

        await tab.setControlValue("hashCacheMaxCount", 321);

        expect(tab.editingSettings.hashCacheMaxCount).toBe(321);
        expect(saveSettings).toHaveBeenCalledOnce();
        expect(saveSettings).toHaveBeenCalledWith(["hashCacheMaxCount"]);
    });

    it("rejects unregistered declarative control keys", async () => {
        const { tab } = createSettingsTab();

        expect(() => tab.getControlValue("couchDB_PASSWORD")).toThrow(/Unknown declarative setting key/u);
        await expect(tab.setControlValue("couchDB_PASSWORD", "secret")).rejects.toThrow(
            /Unknown declarative setting key/u
        );
    });

    it("rejects declarative values outside the registered control contract", async () => {
        const { tab } = createSettingsTab();
        const saveSettings = vi.spyOn(tab, "saveSettings").mockResolvedValue(undefined);

        await expect(tab.setControlValue("hashCacheMaxCount", 9)).rejects.toThrow(
            /Invalid value for declarative setting/u
        );
        await expect(tab.setControlValue("chunkSplitterVersion", "unknown-splitter")).rejects.toThrow(
            /Invalid value for declarative setting/u
        );

        expect(saveSettings).not.toHaveBeenCalled();
    });

    it("replaces a saved-setting handler when a page is rendered again", async () => {
        const { tab } = createSettingsTab();
        const first = vi.fn();
        const replacement = vi.fn();
        tab.addOnSaved("displayLanguage", first);
        tab.addOnSaved("displayLanguage", replacement);
        tab.editingSettings.displayLanguage = "ja";

        await tab.saveSettings(["displayLanguage"]);

        expect(first).not.toHaveBeenCalled();
        expect(replacement).toHaveBeenCalledOnce();
    });
});
