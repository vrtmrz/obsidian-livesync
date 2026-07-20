export interface OptionalSyncFeatures {
    DISABLE: "DISABLE";
    CUSTOMIZE: "CUSTOMIZE";
    DISABLE_CUSTOM: "DISABLE_CUSTOM";
    FETCH: "FETCH";
    OVERWRITE: "OVERWRITE";
    MERGE: "MERGE";
    DISABLE_HIDDEN: "DISABLE_HIDDEN";
}

export type OptionalSyncFeatureMode = keyof OptionalSyncFeatures;
export type HiddenFileSyncMode = Extract<
    OptionalSyncFeatureMode,
    "FETCH" | "OVERWRITE" | "MERGE" | "DISABLE" | "DISABLE_HIDDEN"
>;

declare global {
    interface OPTIONAL_SYNC_FEATURES {
        DISABLE: "DISABLE";
        CUSTOMIZE: "CUSTOMIZE";
        DISABLE_CUSTOM: "DISABLE_CUSTOM";
        FETCH: "FETCH";
        OVERWRITE: "OVERWRITE";
        MERGE: "MERGE";
        DISABLE_HIDDEN: "DISABLE_HIDDEN";
    }
}
