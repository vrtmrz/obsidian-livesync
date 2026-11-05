import { describe, expect, it } from "vitest";
import {
    NEW_VAULT_SETTINGS,
    SETTINGS_SCHEMA_DEFAULTS,
    createNewVaultSettings as createCommonlibNewVaultSettings,
} from "@vrtmrz/livesync-commonlib/settings";
import { createNewVaultSettings } from "./newVaultSettings.ts";

describe("createNewVaultSettings", () => {
    it("selects NFC path identity only for new host settings", () => {
        expect(SETTINGS_SCHEMA_DEFAULTS.pathNormalizationVersion).toBe(0);
        expect(NEW_VAULT_SETTINGS.pathNormalizationVersion).toBe(0);
        expect(createCommonlibNewVaultSettings().pathNormalizationVersion).toBe(0);
        expect(createNewVaultSettings().pathNormalizationVersion).toBe(1);
    });

    it("keeps remote configurations independent of shared and other new-Vault settings", () => {
        const first = createNewVaultSettings();
        const second = createNewVaultSettings();
        const shared = createCommonlibNewVaultSettings();

        expect(first.remoteConfigurations).not.toBe(second.remoteConfigurations);
        expect(first.remoteConfigurations).not.toBe(shared.remoteConfigurations);
        expect(first.pluginSyncExtendedSetting).not.toBe(second.pluginSyncExtendedSetting);
        expect(first.pluginSyncExtendedSetting).not.toBe(shared.pluginSyncExtendedSetting);

        first.remoteConfigurations.example = {
            id: "example",
            name: "Example",
            uri: "sls+http://localhost/",
            isEncrypted: false,
        };

        expect(second.remoteConfigurations).toEqual({});
        expect(shared.remoteConfigurations).toEqual({});
        expect(NEW_VAULT_SETTINGS.remoteConfigurations).toEqual({});
        expect(NEW_VAULT_SETTINGS.pluginSyncExtendedSetting).toEqual({});
    });
});
