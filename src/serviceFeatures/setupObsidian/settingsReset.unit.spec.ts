import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";
import { createCoreSettingsAfterFullReset, createEditingSettingsAfterFullReset } from "./settingsReset.ts";

describe("full settings reset", () => {
    it("resets the persisted settings to the recommended new-Vault values", () => {
        const settings = createCoreSettingsAfterFullReset();
        expect(settings).toEqual({
            ...createNewVaultSettings(),
            isConfigured: false,
        });
    });

    it("preserves settings-dialog fields while applying the new-Vault values", () => {
        const editing = {
            ...DEFAULT_SETTINGS,
            configPassphrase: "dialog-only",
        } as ObsidianLiveSyncSettings & { configPassphrase: string };

        expect(createEditingSettingsAfterFullReset(editing)).toEqual({
            ...editing,
            ...createNewVaultSettings(),
            isConfigured: false,
        });
    });
});
