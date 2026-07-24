import { describe, expect, it } from "vitest";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { normaliseObsidianSettingsData } from "./ObsidianSettingService.ts";

describe("normaliseObsidianSettingsData", () => {
    it("maps Obsidian's missing data value to Commonlib's new-Vault input", () => {
        expect(normaliseObsidianSettingsData(null)).toBeUndefined();
    });

    it("preserves stored settings", () => {
        const settings = { isConfigured: false } as ObsidianLiveSyncSettings;

        expect(normaliseObsidianSettingsData(settings)).toBe(settings);
    });
});
