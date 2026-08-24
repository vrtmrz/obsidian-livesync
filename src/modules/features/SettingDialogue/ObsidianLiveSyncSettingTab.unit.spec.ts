import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, REMOTE_COUCHDB } from "@vrtmrz/livesync-commonlib/compat/common/types";

const negotiationMocks = vi.hoisted(() => ({
    checkSyncInfo: vi.fn(async () => true),
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
    EVENT_REQUEST_RELOAD_SETTING_TAB: "request-reload-setting-tab",
    eventHub: { onEvent: vi.fn() },
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation", () => negotiationMocks);
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator", () => ({
    LiveSyncCouchDBReplicator: class {},
}));
vi.mock("./LiveSyncSetting.ts", () => ({ LiveSyncSetting: class {} }));
vi.mock("./SettingPane.ts", () => ({
    enableOnly: vi.fn(() => vi.fn()),
    setLevelClass: vi.fn(),
    setStyle: vi.fn(),
    visibleOnly: vi.fn(() => vi.fn()),
}));
vi.mock("./PaneChangeLog.ts", () => ({ paneChangeLog: vi.fn() }));
vi.mock("./PaneSetup.ts", () => ({ paneSetup: vi.fn() }));
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

import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";

describe("ObsidianLiveSyncSettingTab passphrase verification", () => {
    it("closes the finite remote connection after checking synchronisation information", async () => {
        const remoteDatabase = {
            close: vi.fn(async () => undefined),
        };
        const replicator = Object.assign(new LiveSyncCouchDBReplicator({} as never), {
            connectRemoteCouchDBWithSetting: vi.fn(async () => ({ db: remoteDatabase })),
        });
        const plugin = {
            app: {},
            core: {
                services: {
                    API: { isMobile: vi.fn(() => false) },
                    replicator: { getNewReplicator: vi.fn(() => replicator) },
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

        expect(negotiationMocks.checkSyncInfo).toHaveBeenCalledWith(remoteDatabase);
        expect(remoteDatabase.close).toHaveBeenCalledOnce();
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
