import { describe, expect, it } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IAPIService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import { MemoryValueStore } from "@vrtmrz/value-store";
import type { ObsidianServiceContext } from "@/modules/services/ObsidianServiceContext";
import { normaliseObsidianSettingsData } from "./ObsidianSettingService.ts";
import { ObsidianSettingService } from "./ObsidianSettingService.ts";

function createSettingService(
    vaultName: string,
    deviceValues: MemoryValueStore
): ObsidianSettingService<ObsidianServiceContext> {
    const context = createServiceContext() as unknown as ObsidianServiceContext;
    const APIService = {
        addLog: () => undefined,
        getSystemVaultName: () => vaultName,
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
