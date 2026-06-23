import * as path from "path";
import { describe, expect, it } from "vitest";
import { toDatabaseRelativePath } from "./utils";

describe("toDatabaseRelativePath", () => {
    const databasePath = path.resolve("/tmp/livesync-vault");

    it("rejects absolute paths outside vault", () => {
        expect(() => toDatabaseRelativePath("/etc/passwd", databasePath)).toThrow(
            "outside of the local database directory"
        );
    });

    it("normalizes leading slash for absolute path inside vault", () => {
        const absoluteInsideVault = path.join(databasePath, "notes", "foo.md");
        expect(toDatabaseRelativePath(absoluteInsideVault, databasePath)).toBe("notes/foo.md");
    });

    it("normalizes Windows-style separators", () => {
        expect(toDatabaseRelativePath("notes\\daily\\2026-03-12.md", databasePath)).toBe("notes/daily/2026-03-12.md");
    });

    it("returns vault-relative path for another absolute path inside vault", () => {
        const absoluteInsideVault = path.join(databasePath, "docs", "inside.md");
        expect(toDatabaseRelativePath(absoluteInsideVault, databasePath)).toBe("docs/inside.md");
    });

    it("rejects relative path traversal that escapes vault", () => {
        expect(() => toDatabaseRelativePath("../escape.md", databasePath)).toThrow(
            "outside of the local database directory"
        );
    });
});
