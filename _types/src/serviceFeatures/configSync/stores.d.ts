// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { PluginManifest } from "@/deps.ts";
import type { PluginDataExDisplay } from "./types.ts";
/**
 * A Svelte store holding the list of plug-ins and their synchronisation details for UI display.
 */
export declare const pluginList: import("svelte/store").Writable<PluginDataExDisplay[]>;
/**
 * A Svelte store indicating whether the plug-in enumeration process is currently running.
 */
export declare const pluginIsEnumerating: import("svelte/store").Writable<boolean>;
/**
 * A Svelte store representing the progress of version 2 plug-in synchronisation (from 0 to 1).
 */
export declare const pluginV2Progress: import("svelte/store").Writable<number>;
/**
 * A local map caching plug-in manifests by their identifier keys.
 */
export declare const pluginManifests: Map<string, PluginManifest>;
/**
 * A Svelte store wrapper around {@link pluginManifests} to notify subscribers of updates.
 */
export declare const pluginManifestStore: import("svelte/store").Writable<Map<string, PluginManifest>>;
/**
 * Updates a plug-in's manifest inside {@link pluginManifests} and notifies the store subscribers
 * if the manifest has changed.
 *
 * @param key - The plug-in identifier key.
 * @param manifest - The new plug-in manifest data.
 */
export declare function setManifest(key: string, manifest: PluginManifest): void;
