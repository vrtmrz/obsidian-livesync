// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryObsidianServices } from "@/types.ts";
/**
 * Service keys required by the Obsidian document history feature.
 */
export type DocumentHistoryServices = "API" | "vault" | "database" | "UI" | "path" | "appLifecycle";
/**
 * Service modules required by the Obsidian document history feature.
 */
export type DocumentHistoryModules = never;
/**
 * The host type representing the injected service container with document history capabilities.
 */
export type DocumentHistoryHost = NecessaryObsidianServices<DocumentHistoryServices, DocumentHistoryModules, "app" | "liveSyncPlugin">;
