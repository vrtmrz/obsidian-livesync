import { describe, expect, it } from "vitest";
import {
    iceServerSourceDefinitions,
    validateIceServerSourceConfiguration,
    validateTurnSettings,
} from "./iceServerSources";

describe("ICE server source catalogue", () => {
    it("blocks an unavailable encrypted source instead of presenting manual settings as valid", () => {
        expect(validateTurnSettings({ encryptedP2PIceServerSource: "private-ciphertext" })).toBe(
            "TURN configuration could not be decrypted."
        );
        expect(validateTurnSettings({})).toBeUndefined();
    });

    it("describes the Cloudflare fields without owning manual TURN fields", () => {
        expect(iceServerSourceDefinitions).toEqual([
            {
                id: "cloudflare",
                label: "Cloudflare",
                fields: [
                    { key: "turnKeyId", label: "TURN Key ID", secret: false },
                    { key: "apiToken", label: "TURN Key API Token", secret: true },
                ],
            },
        ]);
    });

    it("accepts absent or explicit manual selection and rejects unsupported versions", () => {
        expect(validateIceServerSourceConfiguration(undefined)).toBeUndefined();
        expect(validateIceServerSourceConfiguration({ version: 1, id: "manual" })).toBeUndefined();
        expect(validateIceServerSourceConfiguration({ version: 2, id: "cloudflare", configuration: {} })).toContain(
            "version"
        );
        expect(validateIceServerSourceConfiguration({ version: 1, id: "unknown", configuration: {} })).toContain(
            "not supported"
        );
    });
});
