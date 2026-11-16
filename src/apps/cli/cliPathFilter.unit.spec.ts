import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { path } from "@vrtmrz/livesync-commonlib/node";
import { parseFilePath, type FilePath } from "@vrtmrz/livesync-commonlib/storage";
import {
    isHiddenPath,
    isIgnoredFilePath,
    isIgnoredVaultPath,
    toVaultRelativePath,
    type VaultRelativePath,
} from "./cliPathFilter";

const vaultRoot = path.resolve(path.sep, "vault");

function checkedRelativePath(relativePath: string): VaultRelativePath {
    const converted = toVaultRelativePath(vaultRoot, path.join(vaultRoot, relativePath));
    if (converted === undefined) {
        throw new Error(`Expected a valid Vault-relative fixture: ${relativePath}`);
    }
    return converted;
}

describe("toVaultRelativePath", () => {
    it.each(["", "note.md", "notes/note.md", "..draft.md", "Notes/e\u0301.md"])(
        "retains the relative spelling of %j without requiring a filesystem entry",
        (relativePath) => {
            expect(toVaultRelativePath(vaultRoot, path.join(vaultRoot, relativePath))).toBe(relativePath);
        }
    );

    it("uses the selected root even when it or its parents have excluded names", () => {
        const root = path.resolve(path.sep, ".hidden", "archive-livesync-v2", ".vault");
        const converted = toVaultRelativePath(root, path.join(root, "note.md"));
        expect(converted).toBe("note.md");
        expect(converted !== undefined && isIgnoredVaultPath(converted)).toBe(false);
    });

    it.each([
        [".", path.join(vaultRoot, "note.md")],
        [vaultRoot, "note.md"],
        [vaultRoot, path.resolve(vaultRoot, "..", "outside.md")],
        [vaultRoot, path.join(vaultRoot + "-sibling", "note.md")],
        [vaultRoot, path.dirname(vaultRoot)],
    ])("rejects a non-Vault candidate (%s, %s)", (root, candidate) => {
        expect(toVaultRelativePath(root, candidate)).toBeUndefined();
    });

    it.skipIf(process.platform !== "win32")("rejects a candidate on another drive", () => {
        expect(toVaultRelativePath("C:\\vault", "D:\\note.md")).toBeUndefined();
    });

    it("keeps the refinement compatible with existing file paths and rejects unconverted inputs", () => {
        expectTypeOf<VaultRelativePath>().toMatchTypeOf<FilePath>();
        expectTypeOf<Parameters<typeof isIgnoredVaultPath>[0]>().toEqualTypeOf<VaultRelativePath>();
        expectTypeOf<string>().not.toMatchTypeOf<Parameters<typeof isIgnoredVaultPath>[0]>();
        expectTypeOf<FilePath>().not.toMatchTypeOf<Parameters<typeof isIgnoredVaultPath>[0]>();
        expectTypeOf<Parameters<typeof isIgnoredFilePath>[0]>().toEqualTypeOf<FilePath>();
        expectTypeOf<string>().not.toMatchTypeOf<Parameters<typeof isIgnoredFilePath>[0]>();
    });
});

describe("isIgnoredVaultPath", () => {
    it.each([
        [".hidden.md", true],
        ["notes/.hidden.md", true],
        [".git/config", true],
        ["local-livesync-v2/state", true],
        ["notes/local-livesync-v2/state", true],
        ["notes/local-livesync-v2-mrview-0123456789abcdef/CURRENT", true],
        ["-livesync-v2", true],
        ["notes/note.md", false],
        ["local-livesync-v2.md", false],
        ["local-livesync-v2-copy/state", false],
    ])("filters %s within the selected Vault", (candidate, ignored) => {
        expect(isIgnoredVaultPath(checkedRelativePath(candidate))).toBe(ignored);
        expect(isIgnoredFilePath(parseFilePath(candidate))).toBe(ignored);
    });

    it("keeps the root watchable even when user rules exclude every entry", () => {
        const rules = { shouldIgnore: vi.fn(() => true) };
        expect(isIgnoredVaultPath(checkedRelativePath(""), rules)).toBe(false);
        expect(rules.shouldIgnore).not.toHaveBeenCalled();
        expect(isIgnoredVaultPath(checkedRelativePath("note.md"), rules)).toBe(true);
    });

    it("passes only the relative path to user rules", () => {
        const rules = { shouldIgnore: vi.fn((candidate: string) => candidate === "private/note.md") };
        expect(isIgnoredVaultPath(checkedRelativePath("private/note.md"), rules)).toBe(true);
        expect(rules.shouldIgnore).toHaveBeenCalledWith("private/note.md");
        expect(isIgnoredVaultPath(checkedRelativePath("public/note.md"), rules)).toBe(false);
    });

    it("includes DB-like entries outside the configured database namespace when requested", () => {
        const options = { includeDbLikeDirs: true, databaseRoot: checkedRelativePath("state") };
        for (const candidate of ["archive-livesync-v2/note.md", "notes/archive-livesync-v2/note.md"]) {
            expect(isIgnoredVaultPath(checkedRelativePath(candidate), undefined, options)).toBe(false);
            expect(isIgnoredFilePath(parseFilePath(candidate), undefined, options)).toBe(false);
        }
        for (const candidate of [
            "state/current-livesync-v2/CURRENT",
            "state/previous-livesync-v2/CURRENT",
            "state/current-livesync-v2-mrview-index/CURRENT",
            "state/previous-livesync-v2-mrview-temp/CURRENT",
        ]) {
            expect(isIgnoredVaultPath(checkedRelativePath(candidate), undefined, options)).toBe(true);
        }
        expect(isIgnoredVaultPath(checkedRelativePath("state"), undefined, options)).toBe(false);
        expect(
            isIgnoredVaultPath(checkedRelativePath("state-copy/archive-livesync-v2/note.md"), undefined, options)
        ).toBe(false);
    });

    it("protects colocated database entries while allowing nested DB-like user directories", () => {
        const options = { includeDbLikeDirs: true, databaseRoot: checkedRelativePath("") };
        expect(isIgnoredVaultPath(checkedRelativePath("local-livesync-v2/CURRENT"), undefined, options)).toBe(true);
        expect(
            isIgnoredVaultPath(checkedRelativePath("local-livesync-v2-mrview-index/CURRENT"), undefined, options)
        ).toBe(true);
        expect(isIgnoredVaultPath(checkedRelativePath("notes/local-livesync-v2/note.md"), undefined, options)).toBe(
            false
        );
        expect(isIgnoredVaultPath(checkedRelativePath(""), undefined, options)).toBe(false);
    });

    it("keeps hidden entries and user rules excluded when DB-like entries are included", () => {
        const options = { includeDbLikeDirs: true };
        const rules = { shouldIgnore: vi.fn((candidate: string) => candidate.endsWith(".tmp")) };
        expect(isIgnoredVaultPath(checkedRelativePath(".livesync/settings.json"), rules, options)).toBe(true);
        expect(isIgnoredVaultPath(checkedRelativePath("notes/.private/note.md"), rules, options)).toBe(true);
        expect(isIgnoredVaultPath(checkedRelativePath("archive-livesync-v2/note.tmp"), rules, options)).toBe(true);
        expect(rules.shouldIgnore).toHaveBeenCalledWith("archive-livesync-v2/note.tmp");
        expect(isIgnoredVaultPath(checkedRelativePath("archive-livesync-v2/note.md"), rules, options)).toBe(false);
    });

    it("preserves the existing hidden-path predicate for its current callers", () => {
        expect(isHiddenPath("notes/.draft.md")).toBe(true);
        expect(isHiddenPath("notes/draft.md")).toBe(false);
    });
});
