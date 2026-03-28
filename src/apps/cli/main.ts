/**
 * Self-hosted LiveSync CLI
 * Command-line version of Self-hosted LiveSync plugin for syncing vaults without Obsidian
 */

if (!("localStorage" in globalThis) || typeof (globalThis as any).localStorage?.getItem !== "function") {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
        clear: () => {
            store.clear();
        },
    };
}

import * as fs from "fs/promises";
import * as path from "path";
import { NodeServiceContext, NodeServiceHub } from "./services/NodeServiceHub";
import { LiveSyncBaseCore } from "../../LiveSyncBaseCore";
import { ModuleReplicatorP2P } from "../../modules/core/ModuleReplicatorP2P";
import { initialiseServiceModulesCLI } from "./serviceModules/CLIServiceModules";
import { DEFAULT_SETTINGS, LOG_LEVEL_VERBOSE, type LOG_LEVEL, type ObsidianLiveSyncSettings } from "@lib/common/types";
import type { InjectableServiceHub } from "@lib/services/implements/injectable/InjectableServiceHub";
import type { InjectableSettingService } from "@/lib/src/services/implements/injectable/InjectableSettingService";
import {
    LOG_LEVEL_DEBUG,
    setGlobalLogFunction,
    defaultLoggerEnv,
    LOG_LEVEL_INFO,
    LOG_LEVEL_URGENT,
    LOG_LEVEL_NOTICE,
} from "octagonal-wheels/common/logger";
import { runCommand } from "./commands/runCommand";
import { VALID_COMMANDS } from "./commands/types";
import type { CLICommand, CLIOptions } from "./commands/types";
import { getPathFromUXFileInfo } from "@lib/common/typeUtils";
import { stripAllPrefixes } from "@lib/string_and_binary/path";

const SETTINGS_FILE = ".livesync/settings.json";
const LIVESYNC_DIR_NAME = ".livesync";
defaultLoggerEnv.minLogLevel = LOG_LEVEL_DEBUG;

function printHelp(): void {
    console.log(`
Self-hosted LiveSync CLI

Usage:
  node main.js <command> [options]

Commands:
  init        Initialize a new vault for LiveSync.
  sync        Start continuous synchronization for the vault.
  clear-data  Removes all local synchronization data for the vault.
  help        Display this help message.

Options:
  --vaultPath <path>  Path to the Obsidian vault (required for init, sync, clear-data).
  --logLevel <level>  Set the logging level (e.g., debug, info, notice, urgent, verbose). Default: debug.

Examples:
  node main.js init --vaultPath /path/to/my/vault
  node main.js sync --vaultPath /path/to/my/vault
  node main.js clear-data --vaultPath /path/to/my/vault
  node main.js help
`);
}

async function clearLocalSyncData(vaultPath: string): Promise<void> {
    const livesyncDirPath = path.join(vaultPath, LIVESYNC_DIR_NAME);
    console.log(`Attempting to clear local sync data in: ${livesyncDirPath}`);
    try {
        await fs.rm(livesyncDirPath, { recursive: true, force: true });
        console.log("Local sync data cleared successfully.");
    } catch (error: any) {
        console.error(`Failed to clear local sync data: ${error.message}`);
        process.exit(1);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const options: CLIOptions = {
        vaultPath: "",
        command: "help",
        logLevel: LOG_LEVEL_DEBUG,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            const key = arg.slice(2);
            const value = args[++i];
            if (key === "vaultPath") {
                options.vaultPath = value;
            } else if (key === "logLevel") {
                options.logLevel = value as LOG_LEVEL;
            } else {
                console.warn(`Unknown option: ${arg}`);
            }
        } else if (VALID_COMMANDS.includes(arg as CLICommand)) {
            options.command = arg as CLICommand;
        } else {
            console.error(`Unknown argument or command: ${arg}`);
            printHelp();
            process.exit(1);
        }
    }

    setGlobalLogFunction((level, message) => {
        if (level >= options.logLevel) {
            console.log(`[${LOG_LEVEL[level]}] ${message}`);
        }
    });

    if (options.command === "help") {
        printHelp();
        process.exit(0);
    }

    if (!options.vaultPath && options.command !== "help") {
        console.error("Error: --vaultPath is required for this command.");
        printHelp();
        process.exit(1);
    }

    // Handle clear-data command early, as it doesn't require core services
    if (options.command === "clear-data") {
        await clearLocalSyncData(options.vaultPath);
        process.exit(0);
    }

    const serviceHub = new NodeServiceHub(options.vaultPath);
    initialiseServiceModulesCLI(serviceHub, options.vaultPath);
    const core = new LiveSyncBaseCore(serviceHub as InjectableServiceHub);

    await runCommand(options.command, options, serviceHub as InjectableServiceHub, core);
}

main();
