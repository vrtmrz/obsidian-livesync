import { describe, expect, it } from "vitest";
import {
    iceServerSourceDefinitions,
    validateIceServerSourceConfiguration,
} from "./iceServerSources";

describe("ICE server source catalogue", () => {
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
