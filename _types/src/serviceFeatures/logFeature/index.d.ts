// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { LogFeatureServices } from "./types.ts";
/**
 * A service feature hook that initialises and manages logging, status display, and debug report generation.
 */
export declare const useLogFeature: import("@lib/interfaces/ServiceModule.ts").ServiceFeatureFunction<LogFeatureServices, "storageAccess", void>;
