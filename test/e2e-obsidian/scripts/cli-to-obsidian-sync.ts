import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    configureCouchDb,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";
process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ??= "30000";
process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ??= "30000";

const liveSyncCli = resolve("src/apps/cli/dist/index.cjs");
const notePath = "E2E/cli-to-obsidian.md";
const noteContent = [
    "# CLI to real Obsidian",
    "",
    "This note was created by the Self-hosted LiveSync CLI.",
    "The real Obsidian plug-in must retrieve the same content from CouchDB.",
    "0123456789 abcdefghijklmnopqrstuvwxyz 0123456789 abcdefghijklmnopqrstuvwxyz",
    "",
].join("\n");
const e2eePassphrase = "real-obsidian-cli-compatibility-e2e";

type LiveSyncCliCommand = {
    executable: string;
    prefixArgs: string[];
};

type CliResult = {
    stdout: string;
    stderr: string;
};

type CliFileInfo = {
    id: string;
    children: string[];
};

function parseCommandLine(value: string): string[] {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== "string")) {
            throw new Error("LIVESYNC_CLI_COMMAND JSON form must be a non-empty array of strings.");
        }
        return parsed;
    }

    const parts: string[] = [];
    let current = "";
    let quote: "'" | '"' | undefined;
    let tokenStarted = false;
    for (let index = 0; index < trimmed.length; index++) {
        const character = trimmed[index];
        if (quote) {
            if (character === quote) {
                quote = undefined;
                continue;
            }
            if (character === "\\" && quote === '"' && ['"', "\\"].includes(trimmed[index + 1] ?? "")) {
                current += trimmed[++index];
                continue;
            }
            current += character;
            continue;
        }
        if (character === "'" || character === '"') {
            quote = character;
            tokenStarted = true;
            continue;
        }
        if (character === "\\" && ["'", '"', "\\", " ", "\t"].includes(trimmed[index + 1] ?? "")) {
            current += trimmed[++index];
            tokenStarted = true;
            continue;
        }
        if (/\s/u.test(character)) {
            if (tokenStarted) {
                parts.push(current);
                current = "";
                tokenStarted = false;
            }
            continue;
        }
        current += character;
        tokenStarted = true;
    }
    if (quote) {
        throw new Error("LIVESYNC_CLI_COMMAND contains an unterminated quoted value.");
    }
    if (tokenStarted) {
        parts.push(current);
    }
    if (parts.length === 0) {
        throw new Error("LIVESYNC_CLI_COMMAND must not be empty.");
    }
    return parts;
}

function resolveLiveSyncCliCommand(): LiveSyncCliCommand {
    const override = process.env.LIVESYNC_CLI_COMMAND;
    if (override !== undefined) {
        const [executable, ...prefixArgs] = parseCommandLine(override);
        return { executable, prefixArgs };
    }
    return { executable: process.execPath, prefixArgs: [liveSyncCli] };
}

async function runLiveSyncCli(command: LiveSyncCliCommand, args: string[]): Promise<CliResult> {
    return await new Promise((resolvePromise, reject) => {
        const timeoutMs = Number(process.env.E2E_LIVESYNC_CLI_TIMEOUT_MS ?? 60000);
        const child = spawn(command.executable, [...command.prefixArgs, ...args], {
            cwd: process.cwd(),
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf-8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf-8");
        });
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
        }, timeoutMs);
        child.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on("exit", (code, signal) => {
            clearTimeout(timeout);
            const result = {
                stdout,
                stderr,
            };
            if (timedOut) {
                reject(
                    new Error(
                        `LiveSync CLI timed out after ${timeoutMs} ms\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
                    )
                );
                return;
            }
            if (code === 0) {
                resolvePromise(result);
                return;
            }
            reject(
                new Error(
                    `LiveSync CLI failed with ${signal ? `signal ${signal}` : `exit code ${String(code)}`}\n` +
                        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
                )
            );
        });
    });
}

async function configureLiveSyncCli(
    command: LiveSyncCliCommand,
    settingsPath: string,
    couchDb: Awaited<ReturnType<typeof loadCouchDbConfig>>,
    dbName: string
): Promise<void> {
    await runLiveSyncCli(command, ["init-settings", "--force", settingsPath]);
    const settings = JSON.parse(await readFile(settingsPath, "utf-8")) as Record<string, unknown>;
    Object.assign(settings, {
        couchDB_URI: couchDb.uri,
        couchDB_USER: couchDb.username,
        couchDB_PASSWORD: couchDb.password,
        couchDB_DBNAME: dbName,
        remoteType: "",
        liveSync: false,
        syncOnStart: false,
        syncOnSave: false,
        usePluginSync: false,
        usePluginSyncV2: true,
        useEden: false,
        customChunkSize: 60,
        sendChunksBulk: false,
        sendChunksBulkMaxSize: 1,
        chunkSplitterVersion: "v3-rabin-karp",
        readChunksOnline: true,
        disableCheckingConfigMismatch: false,
        enableCompression: false,
        hashAlg: "xxhash64",
        handleFilenameCaseSensitive: false,
        doNotUseFixedRevisionForChunks: true,
        E2EEAlgorithm: "v2",
        encrypt: true,
        passphrase: e2eePassphrase,
        usePathObfuscation: true,
        doctorProcessedVersion: "0.25.27",
        isConfigured: true,
    });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

async function writeCliNote(
    command: LiveSyncCliCommand,
    databasePath: string,
    settingsPath: string,
    sourcePath: string
): Promise<CliFileInfo> {
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, noteContent, "utf-8");
    await runLiveSyncCli(command, [databasePath, "--settings", settingsPath, "push", sourcePath, notePath]);
    const info = await runLiveSyncCli(command, [databasePath, "--settings", settingsPath, "info", notePath]);
    const fileInfo = JSON.parse(info.stdout) as CliFileInfo;
    if (!fileInfo.id || !Array.isArray(fileInfo.children) || fileInfo.children.length === 0) {
        throw new Error(`LiveSync CLI did not create complete metadata for ${notePath}: ${info.stdout}`);
    }
    await runLiveSyncCli(command, [databasePath, "--settings", settingsPath, "sync"]);
    return fileInfo;
}

async function waitForVaultContent(
    vaultPath: string,
    path: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS)
): Promise<string> {
    const fullPath = join(vaultPath, path);
    const deadline = Date.now() + timeoutMs;
    let lastContent = "";
    while (Date.now() < deadline) {
        try {
            lastContent = await readFile(fullPath, "utf-8");
            if (lastContent === noteContent) {
                return lastContent;
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    throw new Error(`Timed out waiting for CLI-created note at ${fullPath}. Last content:\n${lastContent}`);
}

async function main(): Promise<void> {
    const liveSyncCliCommand = resolveLiveSyncCliCommand();
    if (process.env.LIVESYNC_CLI_COMMAND === undefined) {
        await access(liveSyncCli).catch(() => {
            throw new Error(
                `Built LiveSync CLI was not found at ${liveSyncCli}. Run 'npm run build -w self-hosted-livesync-cli' first, or set LIVESYNC_CLI_COMMAND.`
            );
        });
    }

    const binary = requireObsidianBinary();
    const obsidianCli = discoverObsidianCli();
    if (!obsidianCli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${obsidianCli.checked.join(", ")}`);
    }

    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "cli-to-obsidian");
    const cliState = await mkdtemp(join(tmpdir(), "livesync-cli-to-obsidian-e2e-"));
    const cliDatabasePath = join(cliState, "database");
    const cliSettingsPath = join(cliState, "settings.json");
    const cliSourcePath = join(cliState, "source", "cli-to-obsidian.md");
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);
        await mkdir(cliDatabasePath, { recursive: true });
        await configureLiveSyncCli(liveSyncCliCommand, cliSettingsPath, couchDb, dbName);

        if (process.env.LIVESYNC_CLI_COMMAND === undefined) {
            console.log(`Using locally built LiveSync CLI: ${liveSyncCli}`);
        } else {
            console.log(
                `Using LiveSync CLI command override: ${JSON.stringify(liveSyncCliCommand.executable)} ` +
                    `with ${liveSyncCliCommand.prefixArgs.length} prefix argument(s)`
            );
        }
        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary Obsidian vault: ${vault.path}`);
        console.log(`Temporary CouchDB database: ${dbName}`);

        const cliFileInfo = await writeCliNote(liveSyncCliCommand, cliDatabasePath, cliSettingsPath, cliSourcePath);
        await waitForCouchDbDocs(couchDb, dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            return ids.has(cliFileInfo.id) && cliFileInfo.children.every((childId) => ids.has(childId));
        });

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: obsidianCli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        await waitForLiveSyncCoreReady(obsidianCli.binary, session.cliEnv);
        await configureCouchDb(
            obsidianCli.binary,
            session.cliEnv,
            {
                uri: couchDb.uri,
                username: couchDb.username,
                password: couchDb.password,
                dbName,
            },
            {
                encrypt: true,
                passphrase: e2eePassphrase,
                usePathObfuscation: true,
                E2EEAlgorithm: "v2",
            }
        );
        await waitForLiveSyncCoreReady(obsidianCli.binary, session.cliEnv);
        await prepareRemote(obsidianCli.binary, session.cliEnv);
        await pushLocalChanges(obsidianCli.binary, session.cliEnv);

        const received = await waitForVaultContent(vault.path, notePath);
        assertEqual(received, noteContent, "The real Obsidian plug-in did not materialise the CLI-created note.");
        console.log("CLI-created encrypted note was retrieved by the real Obsidian plug-in with identical content.");
    } finally {
        if (session) {
            await session.app.stop();
        }
        await vault.dispose();
        await rm(cliState, { recursive: true, force: true });
        if (process.env.E2E_OBSIDIAN_KEEP_COUCHDB !== "true") {
            await deleteCouchDbDatabase(couchDb, dbName).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
