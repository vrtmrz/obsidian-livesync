import * as path from "path";
import { describe, expect, it } from "vitest";
import { toVaultRelativePath } from "./utils";

describe("toVaultRelativePath", () => {
    const vaultPath = path.resolve("/tmp/livesync-vault");

    it("rejects absolute paths outside vault", () => {
        expect(() => toVaultRelativePath("/etc/passwd", vaultPath)).toThrow("outside of the local database directory");
    });

    it("normalizes leading slash for absolute path inside vault", () => {
        const absoluteInsideVault = path.join(vaultPath, "notes", "foo.md");
        expect(toVaultRelativePath(absoluteInsideVault, vaultPath)).toBe("notes/foo.md");
    });

    it("normalizes Windows-style separators", () => {
        expect(toVaultRelativePath("notes\\daily\\2026-03-12.md", vaultPath)).toBe("notes/daily/2026-03-12.md");
    });

    it("returns vault-relative path for another absolute path inside vault", () => {
        const absoluteInsideVault = path.join(vaultPath, "docs", "inside.md");
        expect(toVaultRelativePath(absoluteInsideVault, vaultPath)).toBe("docs/inside.md");
    });

    it("rejects relative path traversal that escapes vault", () => {
        expect(() => toVaultRelativePath("../escape.md", vaultPath)).toThrow("outside of the local database directory");
    });
});
