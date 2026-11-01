import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVersion } from "./readVersion";

describe("readVersion", () => {
    let directory: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "livesync-read-version-"));
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    it("returns only string version values", () => {
        const filePath = join(directory, "version.json");
        writeFileSync(filePath, JSON.stringify({ version: "1.2.3" }));
        expect(readVersion(filePath)).toBe("1.2.3");

        for (const contents of ["null", "[]", "{}", '{"version": 42}', '{"version": null}']) {
            writeFileSync(filePath, contents);
            expect(readVersion(filePath)).toBeUndefined();
        }
    });

    it("preserves file read and JSON parse errors", () => {
        expect(() => readVersion(join(directory, "missing.json"))).toThrow();

        const filePath = join(directory, "invalid.json");
        writeFileSync(filePath, "not JSON");
        expect(() => readVersion(filePath)).toThrow(SyntaxError);
    });
});
