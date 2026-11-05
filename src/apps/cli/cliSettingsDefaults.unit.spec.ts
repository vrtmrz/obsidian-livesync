import { describe, expect, it } from "vitest";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";
import { createDefaultCliSettings } from "./cliSettingsDefaults.ts";

describe("createDefaultCliSettings", () => {
    it("uses the recommended new-Vault settings with the Node database adapter", () => {
        const settings = createDefaultCliSettings();
        const recommended = createNewVaultSettings();

        expect(settings.pathNormalizationVersion).toBe(1);
        expect(settings).toEqual({
            ...recommended,
            pathNormalizationVersion: 1,
            useIndexedDBAdapter: false,
            isConfigured: false,
        });
        expect(recommended.pathNormalizationVersion).toBe(0);
        expect(settings.remoteConfigurations).not.toBe(recommended.remoteConfigurations);
    });
});
