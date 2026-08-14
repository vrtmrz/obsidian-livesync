import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, REMOTE_COUCHDB } from "@vrtmrz/livesync-commonlib/compat/common/types";

const negotiationMocks = vi.hoisted(() => ({
    checkSyncInfo: vi.fn(async () => true),
}));

vi.mock("@/deps.ts", () => ({
    App: class {},
    Component: class {},
    PluginSettingTab: class {},
}));
vi.mock("@/main.ts", () => ({ default: class {} }));
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
