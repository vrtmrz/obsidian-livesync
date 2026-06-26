import { writable } from "svelte/store";
import type { PluginManifest } from "@/deps.ts";
import type { PluginDataExDisplay } from "./types.ts";
import { isObjectDifferent } from "@lib/common/utils.ts";

/**
 * A Svelte store holding the list of plug-ins and their synchronisation details for UI display.
 */
export const pluginList = writable([] as PluginDataExDisplay[]);

/**
 * A Svelte store indicating whether the plug-in enumeration process is currently running.
 */
export const pluginIsEnumerating = writable(false);

/**
 * A Svelte store representing the progress of version 2 plug-in synchronisation (from 0 to 1).
 */
export const pluginV2Progress = writable(0);

/**
 * A local map caching plug-in manifests by their identifier keys.
 */
export const pluginManifests = new Map<string, PluginManifest>();

/**
 * A Svelte store wrapper around {@link pluginManifests} to notify subscribers of updates.
 */
export const pluginManifestStore = writable(pluginManifests);

/**
 * Updates a plug-in's manifest inside {@link pluginManifests} and notifies the store subscribers
 * if the manifest has changed.
 *
 * @param key - The plug-in identifier key.
 * @param manifest - The new plug-in manifest data.
 */
export function setManifest(key: string, manifest: PluginManifest) {
    const old = pluginManifests.get(key);
    if (old && !isObjectDifferent(manifest, old)) {
        return;
    }
    pluginManifests.set(key, manifest);
    pluginManifestStore.set(pluginManifests);
}
