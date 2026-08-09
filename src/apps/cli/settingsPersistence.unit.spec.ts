import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { activateRemoteConfiguration } from "@vrtmrz/livesync-commonlib/remote-configurations";
import {
    applyStoredSetting,
    changedSettingKeys,
    cloneSettings,
    isSettingsWriteCommand,
    preserveStoredSetting,
    reconcileDurableSettings,
} from "./settingsPersistence";

function settings(overrides: Partial<ObsidianLiveSyncSettings> = {}): ObsidianLiveSyncSettings {
    return Object.assign(cloneSettings(DEFAULT_SETTINGS), overrides);
}

describe("CLI settings persistence", () => {
    it("identifies commands which change the settings file automatically", () => {
        expect(isSettingsWriteCommand("setup")).toBe(true);
        expect(isSettingsWriteCommand("remote-add")).toBe(true);
        expect(isSettingsWriteCommand("remote-rm")).toBe(true);
        expect(isSettingsWriteCommand("remote-set")).toBe(true);
        expect(isSettingsWriteCommand("remote-activate")).toBe(true);
        expect(isSettingsWriteCommand("ls")).toBe(false);
        expect(isSettingsWriteCommand("remote-status")).toBe(false);
    });

    it("retains lasting changes without retaining CLI suspension values", () => {
        const durableBase = settings({
            liveSync: true,
            syncOnStart: true,
            periodicReplication: true,
            P2P_AutoStart: true,
            settingVersion: 9,
            customChunkSize: 40,
        });
        const runtimeBaseline = settings({
            ...durableBase,
            liveSync: false,
            syncOnStart: false,
            periodicReplication: false,
            P2P_AutoStart: false,
        });
        const runtimeCurrent = settings({
            ...runtimeBaseline,
            settingVersion: 10,
            customChunkSize: 60,
        });

        const reconciled = reconcileDurableSettings({
            durableBase,
            runtimeBaseline,
            runtimeCurrent,
            preserveKeys: changedSettingKeys(durableBase, runtimeBaseline),
            command: "ls",
        });

        expect(reconciled.liveSync).toBe(true);
        expect(reconciled.syncOnStart).toBe(true);
        expect(reconciled.periodicReplication).toBe(true);
        expect(reconciled.P2P_AutoStart).toBe(true);
        expect(reconciled.settingVersion).toBe(10);
        expect(reconciled.customChunkSize).toBe(60);
    });

    it("retains a remote profile change and restores the durable sync values", () => {
        const durableBase = settings({
            liveSync: true,
            remoteConfigurations: {},
            activeConfigurationId: "",
        });
        const runtimeBaseline = settings({ ...durableBase, liveSync: false });
        const runtimeCurrent = settings({
            ...runtimeBaseline,
            remoteConfigurations: {
                main: {
                    id: "main",
                    name: "Main",
                    uri: "sls+https://user:pass@example.com/?db=notes",
                    isEncrypted: false,
                },
            },
            activeConfigurationId: "main",
        });
        activateRemoteConfiguration(runtimeCurrent, "main");

        const reconciled = reconcileDurableSettings({
            durableBase,
            runtimeBaseline,
            runtimeCurrent,
            preserveKeys: changedSettingKeys(durableBase, runtimeBaseline),
            command: "remote-add",
        });

        expect(reconciled.liveSync).toBe(true);
        expect(reconciled.activeConfigurationId).toBe("main");
        expect(reconciled.remoteConfigurations.main?.name).toBe("Main");
        expect(reconciled.couchDB_URI).toBe("https://example.com");
        expect(reconciled.couchDB_DBNAME).toBe("notes");
    });

    it("does not retain a remote profile selected temporarily by an operational command", () => {
        const durableBase = settings({
            remoteConfigurations: {
                first: {
                    id: "first",
                    name: "First",
                    uri: "sls+https://first:pass@example.com/?db=first",
                    isEncrypted: false,
                },
                second: {
                    id: "second",
                    name: "Second",
                    uri: "sls+https://second:pass@example.net/?db=second",
                    isEncrypted: false,
                },
            },
            activeConfigurationId: "first",
        });
        activateRemoteConfiguration(durableBase, "first");
        const runtimeBaseline = cloneSettings(durableBase);
        const runtimeCurrent = cloneSettings(durableBase);
        activateRemoteConfiguration(runtimeCurrent, "second");

        const reconciled = reconcileDurableSettings({
            durableBase,
            runtimeBaseline,
            runtimeCurrent,
            preserveKeys: new Set(),
            command: "remote-status",
        });

        expect(reconciled.activeConfigurationId).toBe("first");
        expect(reconciled.couchDB_URI).toBe("https://example.com");
        expect(reconciled.couchDB_USER).toBe("first");
        expect(reconciled.couchDB_DBNAME).toBe("first");
    });

    it("preserves the stored adapter choice while the CLI uses its Node.js adapter", () => {
        const original = JSON.stringify({ useIndexedDBAdapter: true, settingVersion: 9 });
        const prepared = JSON.stringify({ useIndexedDBAdapter: false, settingVersion: 10 });
        const preserved = preserveStoredSetting(prepared, original, "useIndexedDBAdapter");
        const target = settings({ useIndexedDBAdapter: false });

        applyStoredSetting(target, preserved, "useIndexedDBAdapter");

        expect(JSON.parse(preserved).useIndexedDBAdapter).toBe(true);
        expect(target.useIndexedDBAdapter).toBe(true);
    });

    it("does not add the CLI adapter override to an older settings file", () => {
        const original = JSON.stringify({ settingVersion: 9 });
        const prepared = JSON.stringify({ useIndexedDBAdapter: false, settingVersion: 10 });
        const preserved = preserveStoredSetting(prepared, original, "useIndexedDBAdapter");
        const target = settings({ useIndexedDBAdapter: false });

        applyStoredSetting(target, preserved, "useIndexedDBAdapter");

        expect(JSON.parse(preserved)).not.toHaveProperty("useIndexedDBAdapter");
        expect(target).not.toHaveProperty("useIndexedDBAdapter");
    });
});
