import { type NecessaryServices } from "@lib/interfaces/ServiceModule";

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
export type DocumentHistoryHost = NecessaryServices<DocumentHistoryServices, DocumentHistoryModules>;
