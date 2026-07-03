// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryObsidianServices } from "@/types.ts";
export type MigrationServices = "API" | "appLifecycle" | "setting" | "database" | "path" | "vault" | "replicator" | "UI" | "keyValueDB";
export type MigrationModules = "storageAccess" | "fileHandler" | "rebuilder";
export type MigrationHost = NecessaryObsidianServices<MigrationServices, MigrationModules>;
