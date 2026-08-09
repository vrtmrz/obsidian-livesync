import { describe, expect, it } from "vitest";
import { inspectTroubleshootingDocs } from "./inspect-troubleshooting-docs";

describe("troubleshooting documentation contract", () => {
    it("uses current English UI labels and resolves every local guide reference", async () => {
        const result = await inspectTroubleshootingDocs();

        expect(result.checkedFiles).toEqual([
            "docs/troubleshooting.md",
            "docs/recovery.md",
            "docs/tips/p2p-sync-tips.md",
        ]);
        expect(result.checkedLocalReferences).toBeGreaterThan(0);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
    });
});
