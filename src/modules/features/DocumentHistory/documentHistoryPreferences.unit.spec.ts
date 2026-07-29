import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiVersionMock = vi.hoisted(() => vi.fn<(version: string) => boolean>());

vi.mock("@/deps.ts", () => ({
    requireApiVersion: requireApiVersionMock,
}));

import {
    DOCUMENT_HISTORY_PREFERENCE_KEYS,
    loadDocumentHistoryPreference,
    saveDocumentHistoryPreference,
} from "./documentHistoryPreferences.ts";

function createAppStorage() {
    return {
        loadLocalStorage: vi.fn<(key: string) => unknown>(),
        saveLocalStorage: vi.fn<(key: string, value: unknown | null) => void>(),
    };
}

describe("document history preferences", () => {
    beforeEach(() => {
        requireApiVersionMock.mockReset();
    });

    it("falls back without accessing Vault local storage on older Obsidian versions", () => {
        requireApiVersionMock.mockReturnValue(false);
        const app = createAppStorage();

        expect(loadDocumentHistoryPreference(app as never, DOCUMENT_HISTORY_PREFERENCE_KEYS.highlightDiff)).toBe(false);
        saveDocumentHistoryPreference(app as never, DOCUMENT_HISTORY_PREFERENCE_KEYS.diffOnly, true);

        expect(requireApiVersionMock).toHaveBeenCalledWith("1.8.7");
        expect(app.loadLocalStorage).not.toHaveBeenCalled();
        expect(app.saveLocalStorage).not.toHaveBeenCalled();
    });

    it("loads and saves Vault-scoped preferences when the API is available", () => {
        requireApiVersionMock.mockReturnValue(true);
        const app = createAppStorage();
        app.loadLocalStorage.mockReturnValue("1");

        expect(loadDocumentHistoryPreference(app as never, DOCUMENT_HISTORY_PREFERENCE_KEYS.diffOnly)).toBe(true);
        saveDocumentHistoryPreference(app as never, DOCUMENT_HISTORY_PREFERENCE_KEYS.highlightDiff, true);
        saveDocumentHistoryPreference(app as never, DOCUMENT_HISTORY_PREFERENCE_KEYS.highlightDiff, false);

        expect(app.loadLocalStorage).toHaveBeenCalledWith("ols-history-diffonly");
        expect(app.saveLocalStorage).toHaveBeenNthCalledWith(1, "ols-history-highlightdiff", "1");
        expect(app.saveLocalStorage).toHaveBeenNthCalledWith(2, "ols-history-highlightdiff", null);
    });
});
