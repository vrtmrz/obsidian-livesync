import { describe, expect, it, vi } from "vitest";
import type { CompatibilityPause } from "@/common/databaseCompatibility.ts";
import { compatibilityReviewDetailsMarkdown } from "./compatibilityReviewMarkdown.ts";
import { ObsidianCompatibilityReviewUi } from "./compatibilityReviewObsidian.ts";

vi.mock("@/deps.ts", () => ({
    Notice: class {
        hide() {}
    },
}));

const unresolvedFilenameCasePause: CompatibilityPause = {
    resumable: true,
    reasons: [
        {
            source: "settings-schema",
            sourceVersion: 10,
            currentVersion: 10,
            isFromFutureSchema: false,
            resumable: true,
            reviewReasons: [
                {
                    code: "filename-case-sensitivity-unresolved",
                    fromVersion: 10,
                    toVersion: 10,
                },
            ],
        },
    ],
};

describe("Obsidian compatibility review", () => {
    it("explains why a configured Vault can be missing its device-local acknowledgement", async () => {
        const pause: CompatibilityPause = {
            resumable: true,
            reasons: [
                {
                    source: "database-version",
                    state: "missing",
                    currentVersion: 12,
                    resumable: true,
                },
            ],
        };

        const details = compatibilityReviewDetailsMarkdown(pause);
        expect(details).toContain("copied or restored");
        expect(details).toContain("new Obsidian profile");
        expect(details).toContain("does not mean that it is safe to resume automatically");
    });

    it("explains the safe choices for an unresolved filename-case policy", () => {
        const details = compatibilityReviewDetailsMarkdown(unresolvedFilenameCasePause);
        expect(details).toContain("file-name case policy");
        expect(details).toContain("case-sensitive handling preserves the earlier behaviour");
        expect(details).toContain("case-insensitive handling requires a database rebuild");
    });

    it("offers the legacy-compatible case decision instead of a generic resume action", async () => {
        const label = "Keep case-sensitive handling and resume";
        const confirmWithMessage = vi.fn().mockResolvedValue(label);
        const ui = new ObsidianCompatibilityReviewUi({ confirmWithMessage } as never);

        await expect(ui.showSummary(unresolvedFilenameCasePause)).resolves.toBe("use-case-sensitive");
        expect(confirmWithMessage).toHaveBeenCalledWith(
            "Synchronisation paused for compatibility review",
            expect.any(String),
            ["Review compatibility details", label, "Keep synchronisation paused"],
            "Keep synchronisation paused",
            undefined,
            "vertical"
        );
    });
});
