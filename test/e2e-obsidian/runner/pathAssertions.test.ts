import { describe, expect, it } from "vitest";
import { hasExactCaseOnlyRename } from "./pathEntries.ts";

describe("case-only rename assertions", () => {
    it("accepts only the exact new spelling", () => {
        expect(hasExactCaseOnlyRename(["case-rename.md"], "Case-Rename.md", "case-rename.md")).toBe(true);
    });

    it("rejects the old spelling even when a case-insensitive lookup would resolve it", () => {
        expect(hasExactCaseOnlyRename(["Case-Rename.md"], "Case-Rename.md", "case-rename.md")).toBe(false);
    });

    it("rejects an ambiguous directory containing both spellings", () => {
        expect(hasExactCaseOnlyRename(["Case-Rename.md", "case-rename.md"], "Case-Rename.md", "case-rename.md")).toBe(
            false
        );
    });
});
