import { describe, expect, it } from "vitest";
import { isCouchDBVersionAtLeast, normaliseResponseHeaderKeys } from "./couchDBDiagnosticValues";

describe("CouchDB diagnostic values", () => {
    describe("version comparison", () => {
        it.each([
            ["3.10.2", "3.2.0", true],
            ["3.2.0", "3.10.0", false],
            ["3.2", "3.2.0", true],
            ["3.10.1b", "3.10.1a", true],
            ["3.10.1a", "3.10.1b", false],
            ["3.x", "3.2", true],
        ])("compares %s with %s", (baseVersion, targetVersion, expected) => {
            expect(isCouchDBVersionAtLeast(baseVersion, targetVersion)).toBe(expected);
        });
    });

    describe("response header keys", () => {
        it("lower-cases keys while retaining last collision values and entry order", () => {
            const headers = { Server: "first", server: "last", Zed: "z", Alpha: "a" };

            const normalised = normaliseResponseHeaderKeys(headers);

            expect(normalised).toEqual({ server: "last", zed: "z", alpha: "a" });
            expect(Object.keys(normalised)).toEqual(["server", "zed", "alpha"]);
            expect(headers).toEqual({ Server: "first", server: "last", Zed: "z", Alpha: "a" });
        });
    });
});
