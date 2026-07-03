// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryObsidianServices } from "@/types.ts";
/**
 * A union of service keys required by the Obsidian events management feature.
 */
export type ObsidianEventsServices = "API" | "setting" | "appLifecycle" | "control" | "replication" | "vault" | "fileProcessing" | "conflict" | "database" | "UI";
/**
 * A union of service module keys required by the Obsidian events management feature.
 */
export type ObsidianEventsModules = never;
/**
 * The host type representing the injected service container with Obsidian events capabilities.
 */
export type ObsidianEventsHost = NecessaryObsidianServices<ObsidianEventsServices, ObsidianEventsModules, "app" | "plugin">;
