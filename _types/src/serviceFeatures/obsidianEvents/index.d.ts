// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ObsidianEventsServices } from "./types.ts";
/**
 * A service feature hook that initialises and manages Obsidian application event bindings.
 * This hooks into vault file changes, window focus, visibility states, and schedules restarts.
 */
export declare const useObsidianEvents: import("@/types.ts").ObsidianServiceFeatureFunction<ObsidianEventsServices, never, "plugin" | "app", void>;
