// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LogFeatureServices } from "./types.ts";
/**
 * A service feature hook that initialises and manages logging, status display, and debug report generation.
 */
export declare const useLogFeature: import("@/types.ts").ObsidianServiceFeatureFunction<LogFeatureServices, "storageAccess", "app" | "liveSyncPlugin", void>;
