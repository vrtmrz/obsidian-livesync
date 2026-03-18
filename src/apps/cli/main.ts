/**
 * Self-hosted LiveSync CLI
 * Command-line version of Self-hosted LiveSync plugin for syncing vaults without Obsidian
 */

if (!("localStorage" in globalThis)) {
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
defaultLoggerEnv.minLogLevel = LOG_LEVEL_DEBUG;

function printHelp(): void {
    console.log(`
Self-hosted LiveSync CLI

Usage:
  livesync-cli [database-path] [options] [command] [command-args]

Arguments:
  database-path           Path to the local database directory (required)

Commands:
  sync                    Run one replication cycle and exit
    p2p-peers <timeout>     Show discovered peers as [peer]<TAB><peer-id><TAB><peer-name>
    p2p-sync <peer> <timeout>
                            Sync with the specified peer-id or peer-name
    p2p-host                Start P2P host mode and wait until interrupted
    push <src> <dst>        Push local file <src> into local database path <dst>
    pull <src> <dst>        Pull file <src> from local database into local file <dst>
    pull-rev <src> <dst> <rev>   Pull file <src> at specific revision <rev> into local file <dst>
    setup <setupURI>        Apply setup URI to settings file
    put <dst>               Read UTF-8 content from stdin and write to local database path <dst>
    cat <src>               Read file <src> from local database and write to stdout
    cat-rev <src> <rev>     Read file <src> at specific revision <rev> and write to stdout
    ls [prefix]             List DB files as path<TAB>size<TAB>mtime<TAB>revision[*]
    info <path>             Show detailed metadata for a file (ID, revision, conflicts, chunks)
    rm <path>               Mark a file as deleted in local database
    resolve <path> <rev>    Resolve conflicts by keeping <rev> and deleting others
Examples:
    livesync-cli ./my-database sync
    livesync-cli ./my-database p2p-peers 5
    livesync-cli ./my-database p2p-sync my-peer-name 15
    livesync-cli ./my-database p2p-host
    livesync-cli ./my-database --settings ./custom-settings.json push ./note.md folder/note.md
    livesync-cli ./my-database pull folder/note.md ./exports/note.md
    livesync-cli ./my-database pull-rev folder/note.md ./exports/note.old.md 3-abcdef
    livesync-cli ./my-database setup "obsidian://setuplivesync?settings=..."
    echo "Hello" | livesync-cli ./my-database put notes/hello.md
    livesync-cli ./my-database cat notes/hello.md
    livesync-cli ./my-database cat-rev notes/hello.md 3-abcdef
    livesync-cli ./my-database ls notes/
    livesync-cli ./my-database info notes/hello.md
    livesync-cli ./my-database rm notes/hello.md
    livesync-cli ./my-database resolve notes/hello.md 3-abcdef
    livesync-cli init-settings ./data.json
    livesync-cli ./my-database --verbose
        `);
}

export function parseArgs(): CLIOptions {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        printHelp();
        process.exit(0);
    }

    let databasePath: string | undefined;
    let settingsPath: string | undefined;
    let verbose = false;
    let debug = false;
    let force = false;
    let command: CLICommand = "daemon";
    const commandArgs: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const token = args[i];
        switch (token) {
            case "--settings":
            case "-s": {
                i++;
                if (!args[i]) {
                    console.error(`Error: Missing value for ${token}`);
                    process.exit(1);
                }
                settingsPath = args[i];
                break;
            }
            case "--debug":
            case "-d":
                // debugging automatically enables verbose logging, as it is intended for debugging issues.
                debug = true;
            case "--verbose":
            case "-v":
                verbose = true;
                break;
            case "--force":
            case "-f":
                force = true;
                break;
            default: {
                if (!databasePath) {
                    if (command === "daemon" && VALID_COMMANDS.has(token as any)) {
                        command = token as CLICommand;
                        break;
                    }
                    if (command === "init-settings") {
                        commandArgs.push(token);
                        break;
                    }
                    databasePath = token;
                    break;
                }
                if (command === "daemon" && VALID_COMMANDS.has(token as any)) {
                    command = token as CLICommand;
                    break;
                }
                commandArgs.push(token);
                break;
            }
        }
    }

    if (!databasePath && command !== "init-settings") {
        console.error("Error: database-path is required");
        process.exit(1);
    }

    if (command === "daemon" && commandArgs.length > 0) {
        console.error(`Error: Unknown command '${commandArgs[0]}'`);
        process.exit(1);
    }

    return {
        databasePath,
        settingsPath,
        verbose,
        debug,
        force,
        command,
        commandArgs,
    };
}

async function createDefaultSettingsFile(options: CLIOptions) {
    const targetPath = options.settingsPath
        ? path.resolve(options.settingsPath)
        : options.commandArgs[0]
          ? path.resolve(options.commandArgs[0])
          : path.resolve(process.cwd(), "data.json");

    if (!options.force) {
        try {
            await fs.stat(targetPath);
            throw new Error(`Settings file already exists: ${targetPath} (use --force to overwrite)`);
        } catch (ex: any) {
            if (!(ex && ex?.code === "ENOENT")) {
                throw ex;
            }
        }
    }

    const settings = {
        ...DEFAULT_SETTINGS,
        useIndexedDBAdapter: false,
    } as ObsidianLiveSyncSettings;

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(settings, null, 2), "utf-8");
    console.log(`[Done] Created settings file: ${targetPath}`);
}

export async function main() {
    const options = parseArgs();
    const avoidStdoutNoise =
        options.command === "cat" ||
        options.command === "cat-rev" ||
        options.command === "ls" ||
        options.command === "p2p-peers" ||
        options.command === "info" ||
        options.command === "rm" ||
        options.command === "resolve";
    const infoLog = avoidStdoutNoise ? console.error : console.log;
    if (options.debug) {
        setGlobalLogFunction((msg, level) => {
            console.error(`[${level}] ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
            if (msg instanceof Error) {
                console.error(msg);
            }
        });
    } else {
        setGlobalLogFunction((msg, level) => {
            // NO OP, leave it to logFunction
        });
    }
    if (options.command === "init-settings") {
        await createDefaultSettingsFile(options);
        return;
    }

    // Resolve vault path
    const vaultPath = path.resolve(options.databasePath!);
    // Check if vault directory exists
    try {
        const stat = await fs.stat(vaultPath);
        if (!stat.isDirectory()) {
            console.error(`Error: ${vaultPath} is not a directory`);
            process.exit(1);
        }
    } catch (error) {
        console.error(`Error: Vault directory ${vaultPath} does not exist`);
        process.exit(1);
    }

    // Resolve settings path
    const settingsPath = options.settingsPath
        ? path.resolve(options.settingsPath)
        : path.join(vaultPath, SETTINGS_FILE);

    infoLog(`Self-hosted LiveSync CLI`);
    infoLog(`Vault: ${vaultPath}`);
    infoLog(`Settings: ${settingsPath}`);
    infoLog("");

    // Create service context and hub
    const context = new NodeServiceContext(vaultPath);
    const serviceHubInstance = new NodeServiceHub<NodeServiceContext>(vaultPath, context);
    serviceHubInstance.API.addLog.setHandler((message: string, level: LOG_LEVEL) => {
        let levelStr = "";
        switch (level) {
            case LOG_LEVEL_DEBUG:
                levelStr = "debug";
                break;
            case LOG_LEVEL_VERBOSE:
                levelStr = "Verbose";
                break;
            case LOG_LEVEL_INFO:
                levelStr = "Info";
                break;
            case LOG_LEVEL_NOTICE:
                levelStr = "Notice";
                break;
            case LOG_LEVEL_URGENT:
                levelStr = "Urgent";
                break;
            default:
                levelStr = `${level}`;
        }
        const prefix = `(${levelStr})`;
        if (level <= LOG_LEVEL_INFO) {
            if (!options.verbose) return;
        }
        console.error(`${prefix} ${message}`);
    });
    // Prevent replication result to be processed automatically.
    serviceHubInstance.replication.processSynchroniseResult.addHandler(async () => {
        console.error(`[Info] Replication result received, but not processed automatically in CLI mode.`);
        return await Promise.resolve(true);
    }, -100);

    // Setup settings handlers
    const settingService = serviceHubInstance.setting;

    (settingService as InjectableSettingService<NodeServiceContext>).saveData.setHandler(
        async (data: ObsidianLiveSyncSettings) => {
            try {
                await fs.writeFile(settingsPath, JSON.stringify(data, null, 2), "utf-8");
                if (options.verbose) {
                    console.error(`[Settings] Saved to ${settingsPath}`);
                }
            } catch (error) {
                console.error(`[Settings] Failed to save:`, error);
            }
        }
    );

    (settingService as InjectableSettingService<NodeServiceContext>).loadData.setHandler(
        async (): Promise<ObsidianLiveSyncSettings | undefined> => {
            try {
                const content = await fs.readFile(settingsPath, "utf-8");
                const data = JSON.parse(content);
                if (options.verbose) {
                    console.error(`[Settings] Loaded from ${settingsPath}`);
                }
                // Force disable IndexedDB adapter in CLI environment
                data.useIndexedDBAdapter = false;
                return data;
            } catch (error) {
                if (options.verbose) {
                    console.error(`[Settings] File not found, using defaults`);
                }
                return undefined;
            }
        }
    );

    // Create LiveSync core
    const core = new LiveSyncBaseCore(
        serviceHubInstance,
        (core: LiveSyncBaseCore<NodeServiceContext, any>, serviceHub: InjectableServiceHub<NodeServiceContext>) => {
            return initialiseServiceModulesCLI(vaultPath, core, serviceHub);
        },
        (core) => [
            // No modules need to be registered for P2P replication in CLI. Directly using Replicators in p2p.ts
            // new ModuleReplicatorP2P(core),
        ],
        () => [], // No add-ons
        (core) => {
            // Add target filter to prevent internal files are handled
            core.services.vault.isTargetFile.addHandler(async (target) => {
                const vaultPath = stripAllPrefixes(getPathFromUXFileInfo(target));
                const parts = vaultPath.split(path.sep);
                // if some part of the path starts with dot, treat it as internal file and ignore.
                if (parts.some((part) => part.startsWith("."))) {
                    return await Promise.resolve(false);
                }
                return await Promise.resolve(true);
            }, -1 /* highest priority */);
        }
    );

    // Setup signal handlers for graceful shutdown
    const shutdown = async (signal: string) => {
        console.log();
        console.log(`[Shutdown] Received ${signal}, shutting down gracefully...`);
        try {
            await core.services.control.onUnload();
            console.log(`[Shutdown] Complete`);
            process.exit(0);
        } catch (error) {
            console.error(`[Shutdown] Error:`, error);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Start the core
    try {
        infoLog(`[Starting] Initializing LiveSync...`);

        const loadResult = await core.services.control.onLoad();
        if (!loadResult) {
            console.error(`[Error] Failed to initialize LiveSync`);
            process.exit(1);
        }
        await core.services.setting.suspendAllSync();
        await core.services.control.onReady();

        infoLog(`[Ready] LiveSync is running`);
        infoLog(`[Ready] Press Ctrl+C to stop`);
        infoLog("");

        // Check if configured
        const settings = core.services.setting.currentSettings();
        if (!settings.isConfigured) {
            console.warn(`[Warning] LiveSync is not configured yet`);
            console.warn(`[Warning] Please edit ${settingsPath} to configure CouchDB connection`);
            console.warn();
            console.warn(`Required settings:`);
            console.warn(`  - couchDB_URI: CouchDB server URL`);
            console.warn(`  - couchDB_USER: CouchDB username`);
            console.warn(`  - couchDB_PASSWORD: CouchDB password`);
            console.warn(`  - couchDB_DBNAME: Database name`);
            console.warn();
        } else {
            infoLog(`[Info] LiveSync is configured and ready`);
            infoLog(`[Info] Database: ${settings.couchDB_URI}/${settings.couchDB_DBNAME}`);
            infoLog("");
        }

        const result = await runCommand(options, { vaultPath, core, settingsPath });
        if (!result) {
            console.error(`[Error] Command '${options.command}' failed`);
            process.exitCode = 1;
        } else if (options.command !== "daemon") {
            infoLog(`[Done] Command '${options.command}' completed`);
        }

        if (options.command === "daemon") {
            // Keep the process running
            await new Promise(() => {});
        } else {
            await core.services.control.onUnload();
        }
    } catch (error) {
        console.error(`[Error] Failed to start:`, error);
        process.exit(1);
    }
    // To prevent unexpected hanging in webRTC connections.
    process.exit(process.exitCode ?? 0);
}
