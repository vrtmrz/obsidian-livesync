import { describe, expect, it } from "vitest";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";
import { createDefaultCliSettings } from "./cliSettingsDefaults.ts";

describe("createDefaultCliSettings", () => {
    it("uses the recommended new-Vault settings with the Node database adapter", () => {
        const settings = createDefaultCliSettings();
        const recommended = createNewVaultSettings();

        expect(settings).toEqual({
            ...recommended,
            useIndexedDBAdapter: false,
            isConfigured: false,
        });
    });
});
