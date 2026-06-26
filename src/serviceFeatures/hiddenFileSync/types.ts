import type { NecessaryObsidianServices } from "@/types.ts";

export type HiddenFileSyncServices =
    | "API"
    | "appLifecycle"
    | "setting"
    | "vault"
    | "path"
    | "database"
    | "databaseEvents"
    | "fileProcessing"
    | "keyValueDB"
    | "replication"
    | "conflict"
    | "control";

export type HiddenFileSyncModules = "storageAccess" | "fileHandler";

export type HiddenFileSyncHost = NecessaryObsidianServices<HiddenFileSyncServices, HiddenFileSyncModules, "app">;
