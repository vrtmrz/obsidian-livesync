import type { NecessaryObsidianServices } from "@/types.ts";
import { type Writable } from "svelte/store";

/**
 * Service keys required by the development utility feature.
 */
export type DevFeatureServices =
    | "API"
    | "setting"
    | "appLifecycle"
    | "test"
    | "path"
    | "vault"
    | "keyValueDB"
    | "database"
    | "UI";

/**
 * Service modules required by the development utility feature.
 */
export type DevFeatureModules = "storageAccess" | "databaseFileAccess";

/**
 * The host type representing the injected service container with dev capabilities.
 */
export type DevFeatureHost = NecessaryObsidianServices<DevFeatureServices, DevFeatureModules, "app" | "liveSyncPlugin">;

/**
 * Interface for the dev feature matching the shape expected by Svelte test panes.
 */
export interface ModuleDev {
    testResults: Writable<[boolean, string, string][]>;
}
