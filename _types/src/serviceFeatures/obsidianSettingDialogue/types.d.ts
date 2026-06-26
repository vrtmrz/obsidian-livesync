// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type NecessaryServices } from "@lib/interfaces/ServiceModule";
/**
 * Service keys required by the Obsidian setting tab dialogue feature.
 */
export type SettingDialogueServices = "API" | "appLifecycle";
/**
 * Service modules required by the Obsidian setting tab dialogue feature.
 */
export type SettingDialogueModules = never;
/**
 * The host type representing the injected service container with setting tab capabilities.
 */
export type SettingDialogueHost = NecessaryServices<SettingDialogueServices, SettingDialogueModules>;
