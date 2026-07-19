import { describe, expect, it } from "vitest";
import type { CompatibilityPause } from "@/common/databaseCompatibility.ts";
import { compatibilityReviewDetailsMarkdown } from "./compatibilityReviewMarkdown.ts";

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
});
