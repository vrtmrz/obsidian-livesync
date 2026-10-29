import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { DEFAULT_SETTINGS, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { EVENT_SETTING_SAVED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import { EVENT_SYNC_GUARD_PREFERENCES_CHANGED } from "@/common/events.ts";
import type { IAPIService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import { MemoryValueStore } from "@vrtmrz/value-store";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";
import { normaliseObsidianSettingsData } from "./ObsidianSettingService.ts";
import { getSyncGuardSettings, ObsidianSettingService, setSyncGuardSetting } from "./ObsidianSettingService.ts";

function createSettingService(
    vaultName: string,
    deviceValues: MemoryValueStore,
    savedData?: unknown,
    saveData = vi.fn(async (_settings: unknown) => undefined)
): ObsidianSettingService<ObsidianServiceContext> {
    const context = createServiceContext() as unknown as ObsidianServiceContext;
    context.liveSyncPlugin = {
        loadData: vi.fn(async () => savedData),
        saveData,
    } as unknown as ObsidianServiceContext["liveSyncPlugin"];
    const APIService = {
        addLog: () => undefined,
        getSystemVaultName: () => vaultName,
        getAppID: () => "test-app",
    } as unknown as IAPIService;
    return new ObsidianSettingService(context, { APIService, deviceValues });
}

describe("normaliseObsidianSettingsData", () => {
    it("maps Obsidian's missing data value to Commonlib's new-Vault input", () => {
        expect(normaliseObsidianSettingsData(null)).toBeUndefined();
    });

    it("preserves stored settings", () => {
        const settings = { isConfigured: false } as ObsidianLiveSyncSettings;

        expect(normaliseObsidianSettingsData(settings)).toBe(settings);
    });

    it("keeps injected device values independent from each Vault-scoped configuration store", async () => {
        const firstValues = new MemoryValueStore();
        const secondValues = new MemoryValueStore();
        const firstSetting = createSettingService("first-vault", firstValues);
        const secondSetting = createSettingService("second-vault", secondValues);

        await firstSetting.deviceValues.setValue("shared-key", "device value");
        await firstSetting.config.setValue("shared-key", "first config");
        await secondSetting.config.setValue("shared-key", "second config");

        expect(firstSetting.deviceValues).toBe(firstValues);
        expect(secondSetting.deviceValues).toBe(secondValues);
        expect(firstSetting.deviceValues).not.toBe(secondSetting.deviceValues);
        expect(firstSetting.config).not.toBe(firstValues);
        expect(firstSetting.config).not.toBe(secondSetting.config);
        await expect(firstSetting.deviceValues.getValue("shared-key")).resolves.toBe("device value");
        await expect(firstSetting.config.getValue("shared-key")).resolves.toBe("first config");
        await expect(secondSetting.config.getValue("shared-key")).resolves.toBe("second config");
        await expect(firstValues.getValue("first-vault-shared-key")).resolves.toBe("first config");
        await expect(secondValues.getValue("second-vault-shared-key")).resolves.toBe("second config");
    });
});

describe("SyncGuard device-local settings", () => {
    const savedSettings = { ...DEFAULT_SETTINGS, isConfigured: true, additionalSuffixOfDatabaseName: "" };

    it("loads safe defaults when no local values were saved", async () => {
        const setting = createSettingService("first-vault", new MemoryValueStore(), savedSettings);

        await setting.loadSettings();

        expect(getSyncGuardSettings(setting)).toEqual({ syncGuardEnabled: false, syncGuardMinimumFiles: 20 });
    });

    it("migrates preferences stored by earlier builds and excludes them from plugin data", async () => {
        const localValues = new MemoryValueStore();
        const saveData = vi.fn(async (_data: unknown) => undefined);
        const setting = createSettingService(
            "first-vault",
            localValues,
            { ...savedSettings, syncGuardEnabled: true, syncGuardMinimumFiles: 7 },
            saveData
        );

        await setting.loadSettings();
        await setting.saveSettingData();

        expect(getSyncGuardSettings(setting)).toEqual({ syncGuardEnabled: true, syncGuardMinimumFiles: 7 });
        await expect(setting.config.getObject("syncGuardEnabled")).resolves.toBe(true);
        await expect(setting.config.getObject("syncGuardMinimumFiles")).resolves.toBe(7);
        expect(saveData.mock.lastCall?.[0]).not.toHaveProperty("syncGuardEnabled");
        expect(saveData.mock.lastCall?.[0]).not.toHaveProperty("syncGuardMinimumFiles");
    });

    it("keeps existing device-local values authoritative over legacy plugin data", async () => {
        const localValues = new MemoryValueStore();
        const setting = createSettingService(
            "first-vault",
            localValues,
            { ...savedSettings, syncGuardEnabled: true, syncGuardMinimumFiles: 5 }
        );
        await localValues.setObject("first-vault--syncGuardEnabled", false);
        await localValues.setObject("first-vault--syncGuardMinimumFiles", 30);

        await setting.loadSettings();

        expect(getSyncGuardSettings(setting)).toEqual({ syncGuardEnabled: false, syncGuardMinimumFiles: 30 });
    });

    it("restores saved preferences after recreating the service", async () => {
        const localValues = new MemoryValueStore();
        const first = createSettingService("first-vault", localValues, savedSettings);
        await first.loadSettings();
        await setSyncGuardSetting(first, "syncGuardEnabled", true);
        await setSyncGuardSetting(first, "syncGuardMinimumFiles", 12);

        const reloaded = createSettingService("first-vault", localValues, savedSettings);
        await reloaded.loadSettings();

        expect(getSyncGuardSettings(reloaded)).toEqual({ syncGuardEnabled: true, syncGuardMinimumFiles: 12 });
    });

    it("rejects invalid file thresholds without changing local settings", async () => {
        const setting = createSettingService("first-vault", new MemoryValueStore(), savedSettings);
        await setting.loadSettings();
        const storedBefore = await setting.config.getObject("syncGuardMinimumFiles");

        for (const invalid of [0, -1, 1.5, NaN, Infinity]) {
            await expect(setSyncGuardSetting(setting, "syncGuardMinimumFiles", invalid)).rejects.toThrow(RangeError);
        }

        expect(getSyncGuardSettings(setting).syncGuardMinimumFiles).toBe(20);
        await expect(setting.config.getObject("syncGuardMinimumFiles")).resolves.toBe(storedBefore);
    });

    it("persists edits only in this Vault's device store and notifies the guard", async () => {
        const localValues = new MemoryValueStore();
        const saveData = vi.fn(async (_data: unknown) => undefined);
        const first = createSettingService("first-vault", localValues, savedSettings, saveData);
        const second = createSettingService("second-vault", localValues, savedSettings);
        await first.loadSettings();
        await second.loadSettings();
        const initialSaveCount = saveData.mock.calls.length;
        const changed = vi.fn();
        const unrelatedReplicationSettingsSaved = vi.fn();
        first.context.events.onEvent(EVENT_SYNC_GUARD_PREFERENCES_CHANGED, changed);
        first.context.events.onEvent(EVENT_SETTING_SAVED, unrelatedReplicationSettingsSaved);

        await setSyncGuardSetting(first, "syncGuardEnabled", true);
        await setSyncGuardSetting(first, "syncGuardMinimumFiles", 8);
        await setSyncGuardSetting(first, "syncGuardEnabled", true);

        expect(getSyncGuardSettings(first)).toEqual({ syncGuardEnabled: true, syncGuardMinimumFiles: 8 });
        expect(getSyncGuardSettings(second)).toEqual({ syncGuardEnabled: false, syncGuardMinimumFiles: 20 });
        await expect(localValues.getObject("first-vault--syncGuardEnabled")).resolves.toBe(true);
        await expect(localValues.getObject("first-vault--syncGuardMinimumFiles")).resolves.toBe(8);
        expect(changed).toHaveBeenCalledTimes(2);
        expect(unrelatedReplicationSettingsSaved).not.toHaveBeenCalled();
        expect(saveData).toHaveBeenCalledTimes(initialSaveCount);
    });
});
