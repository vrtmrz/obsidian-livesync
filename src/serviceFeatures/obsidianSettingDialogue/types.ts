import type { NecessaryObsidianServices } from "@/types.ts";

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
export type SettingDialogueHost = NecessaryObsidianServices<
    SettingDialogueServices,
    SettingDialogueModules,
    "app" | "liveSyncPlugin"
>;
