#!/usr/bin/env node
/**
 * Self-hosted LiveSync CLI
 * Command-line version of Obsidian LiveSync plugin for syncing vaults without Obsidian
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
import { ServiceContext } from "@lib/services/base/ServiceBase";
import { initialiseServiceModulesCLI } from "./serviceModules/CLIServiceModules";
import {
    DEFAULT_SETTINGS,
    LOG_LEVEL_VERBOSE,
    type LOG_LEVEL,
    type ObsidianLiveSyncSettings,
    type FilePathWithPrefix,
} from "@lib/common/types";
import type { InjectableServiceHub } from "@lib/services/implements/injectable/InjectableServiceHub";
import type { InjectableSettingService } from "@/lib/src/services/implements/injectable/InjectableSettingService";
import { LOG_LEVEL_DEBUG, setGlobalLogFunction, defaultLoggerEnv } from "octagonal-wheels/common/logger";
import PouchDb from "pouchdb-core";

const SETTINGS_FILE = ".livesync/settings.json";
const VALID_COMMANDS = new Set(["sync", "push", "pull", "init-settings"] as const);

type CLICommand = "daemon" | "sync" | "push" | "pull" | "init-settings";
defaultLoggerEnv.minLogLevel = LOG_LEVEL_DEBUG;
// DI the log again.
// const recentLogEntries = reactiveSource<LogEntry[]>([]);
// const globalLogFunction = (message: any, level?: number, key?: string) => {
//     const messageX =
//         message instanceof Error
//             ? new LiveSyncError("[Error Logged]: " + message.message, { cause: message })
//             : message;
//     const entry = { message: messageX, level, key } as LogEntry;
//     recentLogEntries.value = [...recentLogEntries.value, entry];
// };

setGlobalLogFunction((msg, level) => {
    console.log(`[${level}] ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    if (msg instanceof Error) {
        console.error(msg);
    }
});
interface CLIOptions {
    databasePath?: string;
    settingsPath?: string;
    verbose?: boolean;
    force?: boolean;
    command: CLICommand;
    commandArgs: string[];
}

function printHelp(): void {
    console.log(`
Self-hosted LiveSync CLI

Usage:
  livesync-cli [database-path] [options] [command] [command-args]

Arguments:
  database-path           Path to the local database directory (required)

Commands:
  sync                    Run one replication cycle and exit
  push <src> <dst>        Push local file <src> into local database path <dst>
  pull <src> <dst>        Pull file <src> from local database into local file <dst>
    init-settings [path]    Create settings JSON from DEFAULT_SETTINGS

Options:
  --settings, -s <path>   Path to settings file (default: .livesync/settings.json in local database directory)
    --force, -f             Overwrite existing file on init-settings
  --verbose, -v           Enable verbose logging
  --help, -h              Show this help message

Examples:
  livesync-cli ./my-database sync
  livesync-cli ./my-database --settings ./custom-settings.json push ./note.md folder/note.md
  livesync-cli ./my-database pull folder/note.md ./exports/note.md
    livesync-cli init-settings ./data.json
  livesync-cli ./my-database --verbose
        `);
}

function parseArgs(): CLIOptions {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        printHelp();
        process.exit(0);
    }

    let databasePath: string | undefined;
    let settingsPath: string | undefined;
    let verbose = false;
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

    return {
        databasePath,
        settingsPath,
        verbose,
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

function toArrayBuffer(data: Buffer): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function toVaultRelativePath(inputPath: string, vaultPath: string): string {
    const stripped = inputPath.replace(/^[/\\]+/, "");
    if (!path.isAbsolute(inputPath)) {
        return stripped.replace(/\\/g, "/");
    }
    const resolved = path.resolve(inputPath);
    const rel = path.relative(vaultPath, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`Path ${inputPath} is outside of the local database directory`);
    }
    return rel.replace(/\\/g, "/");
}

async function runCommand(
    options: CLIOptions,
    vaultPath: string,
    core: LiveSyncBaseCore<ServiceContext, any>
): Promise<boolean> {
    await core.services.control.activated;
    if (options.command === "daemon") {
        return true;
    }

    if (options.command === "sync") {
        console.log("[Command] sync");
        const result = await core.services.replication.replicate(true);
        return !!result;
    }

    if (options.command === "push") {
        if (options.commandArgs.length < 2) {
            throw new Error("push requires two arguments: <src> <dst>");
        }
        const sourcePath = path.resolve(options.commandArgs[0]);
        const destinationVaultPath = toVaultRelativePath(options.commandArgs[1], vaultPath);
        const sourceData = await fs.readFile(sourcePath);
        const sourceStat = await fs.stat(sourcePath);
        console.log(`[Command] push ${sourcePath} -> ${destinationVaultPath}`);

        await core.serviceModules.storageAccess.writeFileAuto(destinationVaultPath, toArrayBuffer(sourceData), {
            mtime: sourceStat.mtimeMs,
            ctime: sourceStat.ctimeMs,
        });
        const destinationPathWithPrefix = destinationVaultPath as FilePathWithPrefix;
        const stored = await core.serviceModules.fileHandler.storeFileToDB(destinationPathWithPrefix, true);
        return stored;
    }

    if (options.command === "pull") {
        if (options.commandArgs.length < 2) {
            throw new Error("pull requires two arguments: <src> <dst>");
        }
        const sourceVaultPath = toVaultRelativePath(options.commandArgs[0], vaultPath);
        const destinationPath = path.resolve(options.commandArgs[1]);
        console.log(`[Command] pull ${sourceVaultPath} -> ${destinationPath}`);

        const sourcePathWithPrefix = sourceVaultPath as FilePathWithPrefix;
        const restored = await core.serviceModules.fileHandler.dbToStorage(sourcePathWithPrefix, null, true);
        if (!restored) {
            return false;
        }
        const data = await core.serviceModules.storageAccess.readFileAuto(sourceVaultPath);
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        if (typeof data === "string") {
            await fs.writeFile(destinationPath, data, "utf-8");
        } else {
            await fs.writeFile(destinationPath, new Uint8Array(data));
        }
        return true;
    }

    throw new Error(`Unsupported command: ${options.command}`);
}

async function main() {
    const options = parseArgs();

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

    console.log(`Self-hosted LiveSync CLI`);
    console.log(`Vault: ${vaultPath}`);
    console.log(`Settings: ${settingsPath}`);
    console.log();

    // Create service context and hub
    const context = new NodeServiceContext(vaultPath);
    const serviceHubInstance = new NodeServiceHub<NodeServiceContext>(vaultPath, context);
    serviceHubInstance.API.addLog.setHandler((message: string, level: LOG_LEVEL) => {
        const prefix = `[${level}]`;
        if (level <= LOG_LEVEL_VERBOSE) {
            if (!options.verbose) return;
        }
        console.log(`${prefix} ${message}`);
    });
    // Prevent replication result to be processed automatically.
    serviceHubInstance.replication.processSynchroniseResult.addHandler(async () => {
        console.log(`[Info] Replication result received, but not processed automatically in CLI mode.`);
        return await Promise.resolve(true);
    }, -100);
    // Setup settings handlers
    const settingService = serviceHubInstance.setting;

    (settingService as InjectableSettingService<NodeServiceContext>).saveData.setHandler(
        async (data: ObsidianLiveSyncSettings) => {
            try {
                await fs.writeFile(settingsPath, JSON.stringify(data, null, 2), "utf-8");
                if (options.verbose) {
                    console.log(`[Settings] Saved to ${settingsPath}`);
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
                    console.log(`[Settings] Loaded from ${settingsPath}`);
                }
                // Force disable IndexedDB adapter in CLI environment
                data.useIndexedDBAdapter = false;
                return data;
            } catch (error) {
                if (options.verbose) {
                    console.log(`[Settings] File not found, using defaults`);
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
        () => [], // No extra modules
        () => [], // No add-ons
        () => [] // No serviceFeatures
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
        console.log(`[Starting] Initializing LiveSync...`);

        const loadResult = await core.services.control.onLoad();
        if (!loadResult) {
            console.error(`[Error] Failed to initialize LiveSync`);
            process.exit(1);
        }

        await core.services.control.onReady();

        console.log(`[Ready] LiveSync is running`);
        console.log(`[Ready] Press Ctrl+C to stop`);
        console.log();

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
            console.log(`[Info] LiveSync is configured and ready`);
            console.log(`[Info] Database: ${settings.couchDB_URI}/${settings.couchDB_DBNAME}`);
            console.log();
        }

        const result = await runCommand(options, vaultPath, core);
        if (!result) {
            console.error(`[Error] Command '${options.command}' failed`);
            process.exitCode = 1;
        } else if (options.command !== "daemon") {
            console.log(`[Done] Command '${options.command}' completed`);
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
}

// Run main
main().catch((error) => {
    console.error(`[Fatal Error]`, error);
    process.exit(1);
});
