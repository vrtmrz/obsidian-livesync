import { type NecessaryServices } from "@lib/interfaces/ServiceModule";

/**
 * Service keys required by the logging and status bar feature.
 */
export type LogFeatureServices =
    | "API"
    | "setting"
    | "replication"
    | "conflict"
    | "fileProcessing"
    | "appLifecycle"
    | "vault"
    | "replicator"
    | "UI";

/**
 * Service modules required by the logging and status bar feature.
 */
export type LogFeatureModules = "storageAccess";

/**
 * The host type representing the injected service container with logging capabilities.
 */
export type LogFeatureHost = NecessaryServices<LogFeatureServices, LogFeatureModules>;
