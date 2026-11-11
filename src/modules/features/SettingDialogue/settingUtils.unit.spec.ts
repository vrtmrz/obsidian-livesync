import { describe, expect, it } from "vitest";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";
import { getE2EEConfigSummary } from "./settingUtils";

describe("getE2EEConfigSummary", () => {
    it("shows the active plaintext receipt policy and its effect", () => {
        const settings = Object.assign(createNewVaultSettings(), {
            encrypt: true,
            acceptUnencryptedContent: true,
        });

        expect(getE2EEConfigSummary(settings)["Accept unencrypted content"]).toContain(
            "Third-party tools can add content without the E2EE passphrase"
        );
        expect(getE2EEConfigSummary(settings)["Accept unencrypted content"]).toContain(
            "database write access can inject plaintext"
        );
    });

    it.each([
        [false, true],
        [true, false],
    ])("omits the plaintext receipt policy when E2EE is off or the preference is false", (encrypt, accept) => {
        const settings = Object.assign(createNewVaultSettings(), {
            encrypt,
            acceptUnencryptedContent: accept,
        });

        expect(getE2EEConfigSummary(settings)).not.toHaveProperty("Accept unencrypted content");
    });
});
