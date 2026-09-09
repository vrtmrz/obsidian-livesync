import { describe, expect, it } from "vitest";

import { CustomisationSyncRecentEventDeduplicator } from "./customisationSyncRecentEventDeduplicator.ts";

describe("Customisation Sync recent raw-event keys", () => {
    it("admits a key once and keeps newer keys first", () => {
        const history = new CustomisationSyncRecentEventDeduplicator();

        expect(history.admit("old")).toBe(true);
        expect(history.admit("new")).toBe(true);
        expect(history.admit("old")).toBe(false);
    });

    it("evicts the oldest key when the newest-first history exceeds 100 entries", () => {
        const history = new CustomisationSyncRecentEventDeduplicator();

        for (let index = 0; index < 101; index++) {
            expect(history.admit(`key-${index}`)).toBe(true);
        }

        expect(history.admit("key-0")).toBe(true);
        expect(history.admit("key-100")).toBe(false);
    });
});
