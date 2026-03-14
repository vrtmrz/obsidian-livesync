import { LiveSyncBaseCore } from "../../../LiveSyncBaseCore";
import { ServiceContext } from "@lib/services/base/ServiceBase";

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
    | "init-settings";

export interface CLIOptions {
    databasePath?: string;
    settingsPath?: string;
    verbose?: boolean;
    debug?: boolean;
    force?: boolean;
    command: CLICommand;
    commandArgs: string[];
}

export interface CLICommandContext {
    vaultPath: string;
    core: LiveSyncBaseCore<ServiceContext, any>;
    settingsPath: string;
}

export const VALID_COMMANDS = new Set([
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
    "init-settings",
] as const);
