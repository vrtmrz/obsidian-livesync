import { describe, expect, it } from "vitest";
import { disableLegacyBulkChunkPreSend, usesLegacyIndexedDBAdapter } from "./compatibilitySettings.ts";

describe("compatibility settings", () => {
    it.each([true, false])("preserves the operative legacy adapter selection (%s)", (useIndexedDBAdapter) => {
        expect(usesLegacyIndexedDBAdapter({ useIndexedDBAdapter })).toBe(useIndexedDBAdapter);
    });

    it("disables automatic bulk chunk pre-send and restores its inert size value", () => {
        const settings = { sendChunksBulk: true, sendChunksBulkMaxSize: 16 };

        expect(disableLegacyBulkChunkPreSend(settings)).toBe(true);
        expect(settings).toEqual({ sendChunksBulk: false, sendChunksBulkMaxSize: 1 });
    });

    it("leaves an already migrated bulk chunk setting unchanged", () => {
        const settings = { sendChunksBulk: false, sendChunksBulkMaxSize: 4 };

        expect(disableLegacyBulkChunkPreSend(settings)).toBe(false);
        expect(settings).toEqual({ sendChunksBulk: false, sendChunksBulkMaxSize: 4 });
    });
});
