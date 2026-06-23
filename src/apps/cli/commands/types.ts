import { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { ServiceContext } from "@lib/services/base/ServiceBase";
import type { ObsidianLiveSyncSettings } from "@lib/common/types";

export type CLICommand =
    | "daemon"
    | "sync"
    | "p2p-peers"
    | "p2p-sync"
    | "p2p-host"
    | "push"
    | "pull"
    | "pull-rev"
    | "setup"
    | "put"
    | "cat"
    | "cat-rev"
    | "ls"
    | "info"
    | "rm"
    | "resolve"
    | "mirror"
    | "remote-add"
    | "remote-rm"
    | "remote-ls"
    | "remote-export"
    | "remote-set"
    | "remote-activate"
    | "mark-resolved"
    | "unlock-remote"
    | "lock-remote"
    | "remote-status"
    | "init-settings";

export interface CLIOptions {
    databasePath?: string;
    vaultPath?: string;
    settingsPath?: string;
    verbose?: boolean;
    debug?: boolean;
    force?: boolean;
    command: CLICommand;
    commandArgs: string[];
    interval?: number;
}

export interface CLICommandContext {
    databasePath: string;
    vaultPath: string;
    core: LiveSyncBaseCore<ServiceContext, never>;
    settingsPath: string;
    originalSyncSettings: Pick<
        ObsidianLiveSyncSettings,
        | "liveSync"
        | "syncOnStart"
        | "periodicReplication"
        | "syncOnSave"
        | "syncOnEditorSave"
        | "syncOnFileOpen"
        | "syncAfterMerge"
    >;
}

export const VALID_COMMANDS = new Set([
    "daemon",
    "sync",
    "p2p-peers",
    "p2p-sync",
    "p2p-host",
    "push",
    "pull",
    "pull-rev",
    "setup",
    "put",
    "cat",
    "cat-rev",
    "ls",
    "info",
    "rm",
    "resolve",
    "mirror",
    "remote-add",
    "remote-rm",
    "remote-ls",
    "remote-export",
    "remote-set",
    "remote-activate",
    "mark-resolved",
    "unlock-remote",
    "lock-remote",
    "remote-status",
    "init-settings",
] as const);
