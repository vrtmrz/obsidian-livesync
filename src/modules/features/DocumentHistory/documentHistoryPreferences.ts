import { requireApiVersion, type App } from "@/deps.ts";

export const DOCUMENT_HISTORY_PREFERENCE_KEYS = {
    diffOnly: "ols-history-diffonly",
    highlightDiff: "ols-history-highlightdiff",
} as const;

export type DocumentHistoryPreferenceKey =
    (typeof DOCUMENT_HISTORY_PREFERENCE_KEYS)[keyof typeof DOCUMENT_HISTORY_PREFERENCE_KEYS];

export function loadDocumentHistoryPreference(app: App, key: DocumentHistoryPreferenceKey): boolean {
    if (requireApiVersion("1.8.7")) {
        return app.loadLocalStorage(key) === "1";
    }
    return false;
}

export function saveDocumentHistoryPreference(app: App, key: DocumentHistoryPreferenceKey, enabled: boolean): void {
    if (requireApiVersion("1.8.7")) {
        app.saveLocalStorage(key, enabled ? "1" : null);
    }
}
