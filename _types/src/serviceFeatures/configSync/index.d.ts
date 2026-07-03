// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ConfigSyncServices, ConfigSyncModules } from "./types.ts";
/**
 * A service feature hook that initialises and manages the configuration synchronisation module.
 * This sets up the scanning processors, watches for local/remote config changes, and binds UI dialogues.
 */
export declare const useConfigSync: import("@/types.ts").ObsidianServiceFeatureFunction<ConfigSyncServices, ConfigSyncModules, "plugin" | "app" | "liveSyncPlugin", void>;
