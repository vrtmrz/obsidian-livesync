// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryObsidianServices } from "@/types.ts";
/**
 * Service keys required by the logging and status bar feature.
 */
export type LogFeatureServices = "API" | "setting" | "replication" | "conflict" | "fileProcessing" | "appLifecycle" | "vault" | "replicator" | "UI";
/**
 * Service modules required by the logging and status bar feature.
 */
export type LogFeatureModules = "storageAccess";
/**
 * The host type representing the injected service container with logging capabilities.
 */
export type LogFeatureHost = NecessaryObsidianServices<LogFeatureServices, LogFeatureModules, "app" | "liveSyncPlugin">;
