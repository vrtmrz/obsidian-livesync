import { NodeServiceContext, NodeServiceHub } from "./services/NodeServiceHub";
import { configureNodeLocalStorage, ensureGlobalNodeLocalStorage } from "./services/NodeLocalStorage";
import { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { initialiseServiceModulesCLI } from "./serviceModules/CLIServiceModules";
import {
    LOG_LEVEL_VERBOSE,
    type LOG_LEVEL,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import type { InjectableSettingService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableSettingService";
import {
    LOG_LEVEL_DEBUG,
    setGlobalLogFunction,
    defaultLoggerEnv,
    LOG_LEVEL_INFO,
    LOG_LEVEL_URGENT,
    LOG_LEVEL_NOTICE,
} from "octagonal-wheels/common/logger";
import { runCommand } from "./commands/runCommand";
import { isCLICommand } from "./commands/types";
import type { CLICommand, CLICommandContext, CLIOptions } from "./commands/types";
import { getPathFromUXFileInfo } from "@vrtmrz/livesync-commonlib/compat/common/typeUtils";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { IgnoreRules } from "./serviceModules/IgnoreRules";
import { useP2PReplicatorFeature } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/useP2PReplicatorFeature";
import type { UseP2PReplicatorResult } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/UseP2PReplicatorResult";
import { createNodeStandardIo, fsPromises as fs, path, fs as fsSync } from "@vrtmrz/livesync-commonlib/node";
import type { StandardIo } from "@vrtmrz/livesync-commonlib/context";
import { writeStderrLine, writeStdoutLine } from "./cliOutput";
import { createDefaultCliSettings } from "./cliSettingsDefaults";

const SETTINGS_FILE = ".livesync/settings.json";
ensureGlobalNodeLocalStorage();
defaultLoggerEnv.minLogLevel = LOG_LEVEL_DEBUG;

/** Injectable command boundary used by CLI integration probes. */
export type CliCommandRunner = (options: CLIOptions, context: CLICommandContext) => Promise<boolean>;

function printHelp(standardIo: StandardIo): void {
    writeStdoutLine(
        standardIo,
        `
Self-hosted LiveSync CLI

Usage:
  livesync-cli <database-path> [options] <command> [command-args]
  livesync-cli init-settings [path]

Arguments:
  database-path           Path to the local database directory

Commands:
    daemon                  (default) Run mirror scan then continuously sync CouchDB <-> local filesystem
    sync                    Run one replication cycle and exit
    p2p-peers <timeout>     Show discovered peers as [peer]\t<peer-id>\t<peer-name>
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
    ls [prefix]             List DB files as path\tsize\tmtime\trevision[*]
    info <path>             Show detailed metadata for a file (ID, revision, conflicts, chunks)
    rm <path>               Mark a file as deleted in local database
    resolve <path> <rev>    Resolve conflicts by keeping <rev> and deleting others
    mirror [vault-path]     Mirror database contents to the local file system (vault-path takes precedence over --vault; defaults to vault from --vault / database-path)
    remote-add <name> <connstr>
                            Add a remote configuration from a connection string
    remote-rm <remote-id>    Remove a remote configuration by ID
    remote-ls                List stored remote configurations
    remote-export <remote-id>
                            Export a remote connection string by ID
    remote-set <remote-id> <connstr>
                            Replace a stored remote connection string by ID
    remote-activate <remote-id>
                            Activate a stored remote configuration by ID
    mark-resolved [remote-id]
                            Resolve remote synchronisation status
    unlock-remote [remote-id]
                            Unlock remote database
    lock-remote [remote-id]
                            Lock remote database
    remote-status [remote-id]
                            Show remote database status

Options:
  --vault <path>, -V <path>  (daemon/mirror) Path to the vault directory containing .md files
                              (defaults to database-path; allows separate PouchDB and vault dirs)
  --interval <N>, -i <N>  (daemon only) Poll CouchDB every N seconds instead of using the _changes feed

Examples:
    livesync-cli ./my-database                        Run daemon (LiveSync mode)
    livesync-cli ./my-database --interval 30          Run daemon (polling every 30s)
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
    livesync-cli ./my-database remote-add my-remote "sls+https://user:pass@example.com/db"
    livesync-cli ./my-database remote-ls
    livesync-cli ./my-database remote-export remote-abc123
    livesync-cli ./my-database remote-set remote-abc123 "sls+s3://ak:sk@example.com/?endpoint=https%3A%2F%2Fs3.example.com&bucket=mybucket"
    livesync-cli ./my-database remote-activate remote-abc123
    livesync-cli ./my-database remote-rm remote-abc123
    livesync-cli ./my-database mark-resolved remote-abc123
    livesync-cli ./my-database unlock-remote remote-abc123
    livesync-cli ./my-database lock-remote remote-abc123
    livesync-cli ./my-database remote-status remote-abc123
    livesync-cli init-settings ./data.json
    livesync-cli ./my-database --verbose
        `
    );
}

export function parseArgs(standardIo: StandardIo = createNodeStandardIo()): CLIOptions {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        printHelp(standardIo);
        process.exit(0);
    }

    let databasePath: string | undefined;
    let vaultPath: string | undefined;
    let settingsPath: string | undefined;
    let verbose = false;
    let debug = false;
    let force = false;
    let interval: number | undefined;
    let command: CLICommand = "daemon";
    const commandArgs: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const token = args[i];
        switch (token) {
            case "--vault":
            case "-V": {
                i++;
                if (!args[i]) {
                    writeStderrLine(standardIo, `Error: Missing value for ${token}`);
                    process.exit(1);
                }
                vaultPath = args[i];
                break;
            }
            case "--settings":
            case "-s": {
                i++;
                if (!args[i]) {
                    writeStderrLine(standardIo, `Error: Missing value for ${token}`);
                    process.exit(1);
                }
                settingsPath = args[i];
                break;
            }
            case "--interval":
            case "-i": {
                i++;
                if (!args[i]) {
                    writeStderrLine(standardIo, `Error: Missing value for ${token}`);
                    process.exit(1);
                }
                const n = parseInt(args[i], 10);
                if (!Number.isInteger(n) || n <= 0) {
                    writeStderrLine(standardIo, `Error: --interval requires a positive integer, got '${args[i]}'`);
                    process.exit(1);
                }
                interval = n;
                break;
            }
            case "--debug":
            case "-d":
                // debugging automatically enables verbose logging, as it is intended for debugging issues.
                debug = true;
                verbose = true;
                break;
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
                    if (command === "daemon" && isCLICommand(token)) {
                        command = token;
                        break;
                    }
                    if (command === "init-settings") {
                        commandArgs.push(token);
                        break;
                    }
                    databasePath = token;
                    break;
                }
                if (command === "daemon" && isCLICommand(token)) {
                    command = token;
                    break;
                }
                commandArgs.push(token);
                break;
            }
        }
    }

    if (!databasePath && command !== "init-settings") {
        writeStderrLine(standardIo, "Error: database-path is required");
        process.exit(1);
    }

    if (command === "daemon" && commandArgs.length > 0) {
        writeStderrLine(standardIo, `Error: Unknown command '${commandArgs[0]}'`);
        process.exit(1);
    }

    return {
        databasePath,
        vaultPath,
        settingsPath,
        verbose,
        debug,
        force,
        command,
        commandArgs,
        interval,
    };
}

async function createDefaultSettingsFile(options: CLIOptions, standardIo: StandardIo) {
    const targetPath = options.settingsPath
        ? path.resolve(options.settingsPath)
        : options.commandArgs[0]
          ? path.resolve(options.commandArgs[0])
          : path.resolve(process.cwd(), "data.json");

    if (!options.force) {
        try {
            await fs.stat(targetPath);
            throw new Error(`Settings file already exists: ${targetPath} (use --force to overwrite)`);
        } catch (ex) {
            if (!(ex && (ex as { code?: string })?.code === "ENOENT")) {
                throw ex;
            }
        }
    }

    const settings = createDefaultCliSettings();

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(settings, null, 2), "utf-8");
    writeStdoutLine(standardIo, `[Done] Created settings file: ${targetPath}`);
}

export async function main(
    standardIo: StandardIo = createNodeStandardIo(),
    commandRunner: CliCommandRunner = runCommand
) {
    const options = parseArgs(standardIo);
    if (options.interval && options.command !== "daemon") {
        writeStderrLine(standardIo, `Warning: --interval is only used in daemon mode, ignored for '${options.command}'`);
    }
    const avoidStdoutNoise =
        options.command === "cat" ||
        options.command === "cat-rev" ||
        options.command === "ls" ||
        options.command === "remote-add" ||
        options.command === "remote-ls" ||
        options.command === "remote-export" ||
        options.command === "p2p-peers" ||
        options.command === "info" ||
        options.command === "rm" ||
        options.command === "resolve" ||
        options.command === "mark-resolved" ||
        options.command === "unlock-remote" ||
        options.command === "lock-remote" ||
        options.command === "remote-status";
    const infoLog = (...values: readonly unknown[]) => {
        const writeLine = avoidStdoutNoise ? writeStderrLine : writeStdoutLine;
        writeLine(standardIo, ...values);
    };
    if (options.debug) {
        setGlobalLogFunction((msg, level) => {
            writeStderrLine(standardIo, `[${level}]`, msg);
        });
    } else {
        setGlobalLogFunction((msg, level) => {
            // NO OP, leave it to logFunction
        });
    }
    if (options.command === "init-settings") {
        await createDefaultSettingsFile(options, standardIo);
        return;
    }

    // Resolve database path
    const databasePath = path.resolve(options.databasePath!);
    // Check if database directory exists
    try {
        const stat = await fs.stat(databasePath);
        if (!stat.isDirectory()) {
            writeStderrLine(standardIo, `Error: ${databasePath} is not a directory`);
            process.exit(1);
        }
    } catch {
        writeStderrLine(standardIo, `Error: Database directory ${databasePath} does not exist`);
        process.exit(1);
    }

    // Resolve settings path
    const settingsPath = options.settingsPath
        ? path.resolve(options.settingsPath)
        : path.join(databasePath, SETTINGS_FILE);
    configureNodeLocalStorage(path.join(databasePath, ".livesync", "runtime", "local-storage.json"));

    // Resolve vault path: mirror positional argument takes priority,
    // then --vault flag, otherwise fall back to databasePath.
    // For daemon mode, enable chokidar file watching so the _changes feed picks up events.
    // mirror runs a single full scan and doesn't need continuous watching.
    const watchEnabled = options.command === "daemon";
    const vaultPath =
        options.command === "mirror" && options.commandArgs[0]
            ? path.resolve(options.commandArgs[0])
            : options.vaultPath
              ? path.resolve(options.vaultPath)
              : databasePath;

    // Check if vault directory exists
    try {
        const stat = await fs.stat(vaultPath);
        if (!stat.isDirectory()) {
            writeStderrLine(standardIo, `Error: Vault path ${vaultPath} is not a directory`);
            process.exit(1);
        }
    } catch {
        writeStderrLine(standardIo, `Error: Vault directory ${vaultPath} does not exist`);
        process.exit(1);
    }

    infoLog(`Self-hosted LiveSync CLI`);
    infoLog(`Database Path: ${databasePath}`);
    infoLog(`Vault Path:    ${vaultPath}`);
    infoLog(`Settings: ${settingsPath}`);
    infoLog("");
    let ignoreRules: IgnoreRules | undefined;
    if (options.command === "daemon" || options.command === "mirror") {
        ignoreRules = new IgnoreRules(vaultPath, (message, detail) => {
            if (detail === undefined) {
                writeStderrLine(standardIo, message);
            } else {
                writeStderrLine(standardIo, message, detail);
            }
        });
        await ignoreRules.load();
    }

    // Create service context and hub
    const context = new NodeServiceContext(databasePath, standardIo);
    const serviceHubInstance = new NodeServiceHub<NodeServiceContext>(databasePath, context);
    serviceHubInstance.API.addLog.setHandler((message: unknown, level: LOG_LEVEL) => {
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
                levelStr = String(level);
        }
        const prefix = `(${levelStr})`;
        if (level <= LOG_LEVEL_INFO) {
            if (!options.verbose) return;
        }
        writeStderrLine(standardIo, prefix, message);
    });
    // Prevent replication result from being processed automatically in non-daemon commands.
    // In daemon mode the default handler must run so changes are applied to the filesystem.
    if (options.command !== "daemon") {
        serviceHubInstance.replication.processSynchroniseResult.addHandler(async () => {
            writeStderrLine(standardIo, `[Info] Replication result received, but not processed automatically in CLI mode.`);
            return await Promise.resolve(true);
        }, -100);
    }

    // Setup settings handlers
    const settingService = serviceHubInstance.setting;

    (settingService as InjectableSettingService<NodeServiceContext>).saveData.setHandler(
        async (data: ObsidianLiveSyncSettings) => {
            try {
                await fs.writeFile(settingsPath, JSON.stringify(data, null, 2), "utf-8");
                if (options.verbose) {
                    writeStderrLine(standardIo, `[Settings] Saved to ${settingsPath}`);
                }
            } catch (error) {
                writeStderrLine(standardIo, `[Settings] Failed to save:`, error);
            }
        }
    );

    (settingService as InjectableSettingService<NodeServiceContext>).loadData.setHandler(
        async (): Promise<ObsidianLiveSyncSettings | undefined> => {
            try {
                const content = await fs.readFile(settingsPath, "utf-8");
                const data = JSON.parse(content) as ObsidianLiveSyncSettings;
                if (options.verbose) {
                    writeStderrLine(standardIo, `[Settings] Loaded from ${settingsPath}`);
                }
                // Force disable IndexedDB adapter in CLI environment without mutating the loaded settings object.
                return { ...data, useIndexedDBAdapter: false };
            } catch {
                if (options.verbose) {
                    writeStderrLine(standardIo, `[Settings] File not found, using defaults`);
                }
                return undefined;
            }
        }
    );

    // Create LiveSync core
    let p2pReplicator: UseP2PReplicatorResult | undefined;
    const core = new LiveSyncBaseCore(
        serviceHubInstance,
        (core: LiveSyncBaseCore<NodeServiceContext, never>, serviceHub: InjectableServiceHub<NodeServiceContext>) => {
            return initialiseServiceModulesCLI(vaultPath, core, serviceHub, ignoreRules, watchEnabled);
        },
        (core) => [],
        () => [], // No add-ons
        (core) => {
            // Register P2P replicator feature.
            p2pReplicator = useP2PReplicatorFeature(core);
            // Add target filter to prevent internal files are handled
            core.services.vault.isTargetFile.addHandler(async (target) => {
                const targetPath = stripAllPrefixes(getPathFromUXFileInfo(target));
                const parts = targetPath.split(path.sep);
                // if some part of the path starts with dot, treat it as internal file and ignore.
                if (parts.some((part) => part.startsWith("."))) {
                    return await Promise.resolve(false);
                }
                // PouchDB LevelDB database directory lives in the vault directory.
                if (parts[0]?.endsWith("-livesync-v2")) {
                    return await Promise.resolve(false);
                }
                return await Promise.resolve(true);
            }, -1 /* highest priority */);

            // Apply user-defined ignore rules for daemon mode (lower priority, runs after dotfile check).
            if (ignoreRules) {
                const rules = ignoreRules;
                core.services.vault.isTargetFile.addHandler(async (target) => {
                    const targetPath = stripAllPrefixes(getPathFromUXFileInfo(target));
                    if (rules.shouldIgnore(targetPath)) {
                        return false;
                    }
                    // At least this handler think it is a target file, but other handlers may still veto it.
                    return true;
                }, 0);
            }
        }
    );

    // Setup signal handlers for graceful shutdown
    const shutdown = async (signal: string) => {
        writeStdoutLine(standardIo);
        writeStdoutLine(standardIo, `[Shutdown] Received ${signal}, shutting down gracefully...`);
        try {
            await core.services.control.onUnload();
            writeStdoutLine(standardIo, `[Shutdown] Complete`);
            process.exit(0);
        } catch (error) {
            writeStderrLine(standardIo, `[Shutdown] Error:`, error);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));

    // Save the settings file before any lifecycle events can mutate and persist them.
    // suspendAllSync and other lifecycle hooks clobber sync settings in memory, and
    // various code paths persist the clobbered state to disk. We restore on shutdown.
    const settingsBackup = await fs.readFile(settingsPath, "utf-8").catch(() => null!);

    // Restore settings file on any exit to undo lifecycle mutations.
    // Write to a temp path first so a crash mid-write doesn't leave a truncated file.
    process.on("exit", () => {
        if (settingsBackup) {
            const tmpPath = settingsPath + ".tmp";
            try {
                fsSync.writeFileSync(tmpPath, settingsBackup, "utf-8");
                fsSync.renameSync(tmpPath, settingsPath);
            } catch (err) {
                writeStderrLine(standardIo, "[Settings] Failed to restore settings on exit:", err);
            }
        }
    });

    // Start the core
    try {
        infoLog(`[Starting] Initializing LiveSync...`);

        const loadResult = await core.services.control.onLoad();
        if (!loadResult) {
            writeStderrLine(standardIo, `[Error] Failed to initialize LiveSync`);
            process.exit(1);
        }
        // Capture sync settings before suspendAllSync() clobbers them.
        // Used by daemon mode to restore the correct sync behaviour after the mirror scan.
        const settingsBeforeSuspend = core.services.setting.currentSettings();
        const originalSyncSettings = {
            liveSync: settingsBeforeSuspend.liveSync,
            syncOnStart: settingsBeforeSuspend.syncOnStart,
            periodicReplication: settingsBeforeSuspend.periodicReplication,
            syncOnSave: settingsBeforeSuspend.syncOnSave,
            syncOnEditorSave: settingsBeforeSuspend.syncOnEditorSave,
            syncOnFileOpen: settingsBeforeSuspend.syncOnFileOpen,
            syncAfterMerge: settingsBeforeSuspend.syncAfterMerge,
        };
        await core.services.setting.suspendAllSync();
        await core.services.control.onReady();

        infoLog(`[Ready] LiveSync is running`);
        infoLog(`[Ready] Press Ctrl+C to stop`);
        infoLog("");

        // Check if configured
        const settings = core.services.setting.currentSettings();
        if (!settings.isConfigured) {
            writeStderrLine(standardIo, `[Warning] LiveSync is not configured yet`);
            writeStderrLine(standardIo, `[Warning] Please edit ${settingsPath} to configure CouchDB connection`);
            writeStderrLine(standardIo);
            writeStderrLine(standardIo, `Required settings:`);
            writeStderrLine(standardIo, `  - couchDB_URI: CouchDB server URL`);
            writeStderrLine(standardIo, `  - couchDB_USER: CouchDB username`);
            writeStderrLine(standardIo, `  - couchDB_PASSWORD: CouchDB password`);
            writeStderrLine(standardIo, `  - couchDB_DBNAME: Database name`);
            writeStderrLine(standardIo);
        } else {
            infoLog(`[Info] LiveSync is configured and ready`);
            infoLog(`[Info] Database: ${settings.couchDB_URI}/${settings.couchDB_DBNAME}`);
            infoLog("");
        }

        const result = await commandRunner(options, {
            databasePath,
            vaultPath,
            core,
            p2pReplicator,
            settingsPath,
            originalSyncSettings,
        });
        if (!result) {
            writeStderrLine(standardIo, `[Error] Command '${options.command}' failed`);
            process.exitCode = 1;
        } else if (options.command !== "daemon") {
            infoLog(`[Done] Command '${options.command}' completed`);
        }

        if (options.command === "daemon" && result) {
            // Keep the process running
            await new Promise(() => {});
        } else {
            await core.services.control.onUnload();
        }
    } catch (error) {
        writeStderrLine(standardIo, `[Error] Failed to start:`, error);
        process.exit(1);
    }
    // To prevent unexpected hanging in webRTC connections.
    process.exit(process.exitCode ?? 0);
}
