import type { NecessaryObsidianServices } from "@/types.ts";

/**
 * Service keys required by the global history feature.
 */
export type GlobalHistoryServices = "API" | "appLifecycle";

/**
 * Service modules required by the global history feature.
 */
export type GlobalHistoryModules = never;

/**
 * The host type representing the injected service container with global history capabilities.
 */
export type GlobalHistoryHost = NecessaryObsidianServices<GlobalHistoryServices, never, "liveSyncPlugin">;
