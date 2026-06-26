import { type NecessaryServices } from "@lib/interfaces/ServiceModule";

/**
 * A union of service keys required by the Obsidian events management feature.
 */
export type ObsidianEventsServices =
    | "API"
    | "setting"
    | "appLifecycle"
    | "control"
    | "replication"
    | "vault"
    | "fileProcessing"
    | "conflict"
    | "database"
    | "UI";

/**
 * A union of service module keys required by the Obsidian events management feature.
 */
export type ObsidianEventsModules = never;

/**
 * The host type representing the injected service container with Obsidian events capabilities.
 */
export type ObsidianEventsHost = NecessaryServices<ObsidianEventsServices, ObsidianEventsModules>;
