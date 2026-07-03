// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { DevFeatureServices, DevFeatureModules } from "./types.ts";
/**
 * A service feature hook that initialises dev/testing utilities.
 * Handles missing translation captures, test panels, and debugging commands.
 */
export declare const useDevFeature: import("@/types.ts").ObsidianServiceFeatureFunction<DevFeatureServices, DevFeatureModules, "app" | "liveSyncPlugin", void>;
