// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { ObsidianEventsServices } from "./types.ts";
/**
 * A service feature hook that initialises and manages Obsidian application event bindings.
 * This hooks into vault file changes, window focus, visibility states, and schedules restarts.
 */
export declare const useObsidianEvents: import("@lib/interfaces/ServiceModule").ServiceFeatureFunction<ObsidianEventsServices, never, void>;
