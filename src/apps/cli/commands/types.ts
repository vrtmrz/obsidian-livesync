import { LOG_LEVEL } from "@lib/common/types";

export const VALID_COMMANDS = ["sync", "help", "init", "clear-data"] as const;
export type CLICommand = (typeof VALID_COMMANDS)[number];

export interface CLIOptions {
    vaultPath: string;
    command: CLICommand;
    logLevel: LOG_LEVEL;
}
