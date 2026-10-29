import { spawn } from "node:child_process";
import { access, appendFile, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
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
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";
import { evalObsidianJson } from "../runner/cli.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";
process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ??= "30000";
process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ??= "30000";

const liveSyncCli = resolve("src/apps/cli/dist/index.cjs");
const migrateUnicodePaths = process.env.E2E_OBSIDIAN_UNICODE_MIGRATION === "true";
const unicodePaths = migrateUnicodePaths || process.env.E2E_OBSIDIAN_UNICODE_PATHS === "true";
const useEncryption = !unicodePaths || process.env.E2E_OBSIDIAN_UNICODE_ENCRYPTION === "true";
const notePath = unicodePaths ? "Cafe\u0301/r\u00e9sume\u0301.md" : "E2E/cli-to-obsidian.md";
const receivedNotePath = unicodePaths ? notePath.normalize("NFC") : notePath;
const noteContent = [
    "# CLI to real Obsidian",
    "",
    "This note was created by the Self-hosted LiveSync CLI.",
    "The real Obsidian plug-in must retrieve the same content from CouchDB.",
    "0123456789 abcdefghijklmnopqrstuvwxyz 0123456789 abcdefghijklmnopqrstuvwxyz",
    "",
].join("\n");
const e2eePassphrase = "real-obsidian-cli-compatibility-e2e";
const editedNoteContent = `${noteContent}\nCLI in-place edit.\n`;

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
    expectedCtime?: number;
    legacyId?: string;
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

async function runLiveSyncCli(command: LiveSyncCliCommand, args: string[], input?: string): Promise<CliResult> {
    return await new Promise((resolvePromise, reject) => {
        const timeoutMs = Number(process.env.E2E_LIVESYNC_CLI_TIMEOUT_MS ?? 60000);
        const child = spawn(command.executable, [...command.prefixArgs, ...args], {
            cwd: process.cwd(),
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"],
        });
        child.stdin.end(input);
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
    dbName: string,
    pathNormalizationVersion = unicodePaths ? 1 : 0
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
        encrypt: useEncryption,
        passphrase: e2eePassphrase,
        usePathObfuscation: useEncryption,
        encryptInternalMetadata: useEncryption,
        deleteMetadataOfDeletedFiles: false,
        pathNormalizationVersion,
        doctorProcessedVersion: "0.25.27",
        isConfigured: true,
    });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

async function startLiveSyncCliDaemon(command: LiveSyncCliCommand, databasePath: string, settingsPath: string) {
    const child = spawn(
        command.executable,
        [...command.prefixArgs, databasePath, "--settings", settingsPath, "--interval", "1", "daemon"],
        { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    let spawnError: Error | undefined;
    child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
        spawnError = error;
    });
    const stop = async () => {
        if (child.exitCode !== null || child.signalCode !== null || spawnError) return;
        await new Promise<void>((resolvePromise) => {
            const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
            child.once("exit", () => {
                clearTimeout(timeout);
                resolvePromise();
            });
            child.kill("SIGTERM");
        });
    };
    const deadline = Date.now() + Number(process.env.E2E_LIVESYNC_CLI_TIMEOUT_MS ?? 60000);
    try {
        while (!output.includes("[Daemon] Polling mode:")) {
            if (spawnError) throw spawnError;
            if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline) {
                throw new Error(`The CLI daemon did not become ready.\n${output}`);
            }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
        return { stop, getOutput: () => output };
    } catch (error) {
        await stop();
        throw error;
    }
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
    const storagePath = join(databasePath, notePath);
    const originalStat = await stat(storagePath);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    await appendFile(storagePath, "\nCLI in-place edit.\n");
    // The mirror scanner compares modification times at a two-second resolution.
    await utimes(storagePath, new Date(), new Date(originalStat.mtimeMs + 5000));
    const editedStat = await stat(storagePath);
    if (
        originalStat.birthtimeMs > 0 &&
        originalStat.birthtimeMs === editedStat.birthtimeMs &&
        Math.floor(editedStat.ctimeMs) > Math.floor(originalStat.birthtimeMs)
    ) {
        fileInfo.expectedCtime = Math.floor(originalStat.birthtimeMs);
    }
    await runLiveSyncCli(command, [databasePath, "--settings", settingsPath, "mirror"]);
    const editedInfo = await runLiveSyncCli(command, [databasePath, "--settings", settingsPath, "info", notePath]);
    const editedFileInfo = JSON.parse(editedInfo.stdout) as CliFileInfo;
    fileInfo.children = editedFileInfo.children;
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
            if (lastContent === editedNoteContent) {
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

async function migrateCliDatabases(
    command: LiveSyncCliCommand,
    cliState: string,
    databasePath: string,
    settingsPath: string,
    couchDb: Awaited<ReturnType<typeof loadCouchDbConfig>>,
    dbName: string,
    legacyFileInfo: CliFileInfo
): Promise<CliFileInfo> {
    await runLiveSyncCli(
        command,
        [databasePath, "--settings", settingsPath, "put", receivedNotePath],
        "Obsolete composed-path content.\n"
    );
    const aliasInfo = await runLiveSyncCli(command, [
        databasePath,
        "--settings",
        settingsPath,
        "info",
        receivedNotePath,
    ]);
    const deletedAliasId = (JSON.parse(aliasInfo.stdout) as CliFileInfo).id;
    if (deletedAliasId === legacyFileInfo.id)
        throw new Error("The legacy Unicode fixture needs distinct Metadata IDs.");
    await runLiveSyncCli(command, [databasePath, "--settings", settingsPath, "rm", receivedNotePath]);
    await runLiveSyncCli(command, [databasePath, "--settings", settingsPath, "sync"]);
    await waitForCouchDbDocs(couchDb, dbName, (docs) =>
        docs.some((doc) => doc._id === deletedAliasId && doc.deleted === true)
    );

    const secondaryDatabasePath = join(cliState, "secondary-database");
    const secondarySettingsPath = join(cliState, "secondary-settings.json");
    await mkdir(secondaryDatabasePath, { recursive: true });
    await configureLiveSyncCli(command, secondarySettingsPath, couchDb, dbName, 0);
    await runLiveSyncCli(command, [secondaryDatabasePath, "--settings", secondarySettingsPath, "sync"]);
    await runLiveSyncCli(command, [secondaryDatabasePath, "--settings", secondarySettingsPath, "mirror"]);
    assertEqual(
        await readFile(join(secondaryDatabasePath, notePath), "utf-8"),
        editedNoteContent,
        "The secondary CLI did not materialise the legacy NFD note before migration."
    );

    for (const path of [settingsPath, secondarySettingsPath]) {
        const settings = JSON.parse(await readFile(path, "utf-8"));
        settings.pathNormalizationVersion = 1;
        await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
    }
    await runLiveSyncCli(command, [databasePath, "--settings", settingsPath, "rebuild", "--force", "--write-settings"]);
    const info = await runLiveSyncCli(command, [databasePath, "--settings", settingsPath, "info", notePath]);
    const fileInfo = JSON.parse(info.stdout) as CliFileInfo;
    if (fileInfo.id === legacyFileInfo.id) {
        throw new Error("Rebuild retained the legacy NFD document ID.");
    }
    await waitForCouchDbDocs(couchDb, dbName, (docs) => {
        const ids = new Set(docs.map((doc) => doc._id));
        return (
            !ids.has(legacyFileInfo.id) &&
            ids.has(fileInfo.id) &&
            fileInfo.children.every((childId) => ids.has(childId)) &&
            docs.some((doc) => Array.isArray(doc.used_features) && doc.used_features.includes("nfc-path-identity-v1"))
        );
    });
    await runLiveSyncCli(command, [
        secondaryDatabasePath,
        "--settings",
        secondarySettingsPath,
        "fetch",
        "--force",
        "--write-settings",
    ]);
    const secondaryInfo = await runLiveSyncCli(command, [
        secondaryDatabasePath,
        "--settings",
        secondarySettingsPath,
        "info",
        notePath,
    ]);
    assertEqual(
        (JSON.parse(secondaryInfo.stdout) as CliFileInfo).id,
        fileInfo.id,
        "Fetch did not replace the secondary CLI's legacy document identity."
    );
    for (const path of [databasePath, secondaryDatabasePath]) {
        assertEqual(
            await readFile(join(path, notePath), "utf-8"),
            editedNoteContent,
            "Migration changed the content of the original NFD physical file."
        );
        await access(join(path, receivedNotePath)).then(
            () => {
                throw new Error("Migration created a second NFC physical file.");
            },
            (error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
            }
        );
    }
    console.log("CLI Rebuild and Fetch passed with obsolete logical deletions and preserved both NFD physical files.");
    return { ...fileInfo, expectedCtime: legacyFileInfo.expectedCtime, legacyId: legacyFileInfo.id };
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
    let daemon: Awaited<ReturnType<typeof startLiveSyncCliDaemon>> | undefined;

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);
        await mkdir(cliDatabasePath, { recursive: true });
        await configureLiveSyncCli(
            liveSyncCliCommand,
            cliSettingsPath,
            couchDb,
            dbName,
            migrateUnicodePaths ? 0 : undefined
        );

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

        let cliFileInfo = await writeCliNote(liveSyncCliCommand, cliDatabasePath, cliSettingsPath, cliSourcePath);
        if (migrateUnicodePaths) {
            cliFileInfo = await migrateCliDatabases(
                liveSyncCliCommand,
                cliState,
                cliDatabasePath,
                cliSettingsPath,
                couchDb,
                dbName,
                cliFileInfo
            );
        }
        if (unicodePaths && !useEncryption) {
            assertEqual(cliFileInfo.id, receivedNotePath.toLowerCase(), "The CLI did not derive an NFC document ID.");
        }
        await waitForCouchDbDocs(couchDb, dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            return ids.has(cliFileInfo.id) && cliFileInfo.children.every((childId) => ids.has(childId));
        });

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: obsidianCli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: createE2eCouchDbPluginData(
                {
                    uri: couchDb.uri,
                    username: couchDb.username,
                    password: couchDb.password,
                    dbName,
                },
                {
                    encrypt: useEncryption,
                    passphrase: e2eePassphrase,
                    usePathObfuscation: useEncryption,
                    encryptInternalMetadata: useEncryption,
                    pathNormalizationVersion: unicodePaths ? 1 : 0,
                    E2EEAlgorithm: "v2",
                }
            ),
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(obsidianCli.binary, session.cliEnv);
        await prepareRemote(obsidianCli.binary, session.cliEnv);
        await pushLocalChanges(obsidianCli.binary, session.cliEnv);

        const received = await waitForVaultContent(vault.path, receivedNotePath);
        assertEqual(received, editedNoteContent, "The real Obsidian plug-in did not materialise the CLI-edited note.");
        if (cliFileInfo.legacyId) {
            const fetched = await evalObsidianJson<{
                obsoleteRetained: boolean;
                currentDeleted: boolean;
                currentPath: string;
                previousPath: string;
                content: string;
            }>(
                obsidianCli.binary,
                [
                    "(async()=>{",
                    "const core=app.plugins.plugins['obsidian-livesync'].core;",
                    "if(core.settings.useRequestAPI) throw new Error('This case requires Streaming Fast Fetch.');",
                    "await core.services.setting.applyPartial({suspendParseReplicationResult:true,suspendFileWatching:true});",
                    `const legacyId=${JSON.stringify(cliFileInfo.legacyId)};`,
                    `const {_rev,...current}=await core.localDatabase.localDatabase.get(${JSON.stringify(cliFileInfo.id)});`,
                    `await core.localDatabase.localDatabase.put({...current,_id:legacyId,path:${JSON.stringify(notePath)},deleted:true});`,
                    "await core.serviceModules.rebuilder.$fetchLocalDBFast(true);",
                    `const restored=await core.localDatabase.localDatabase.get(${JSON.stringify(cliFileInfo.id)});`,
                    "const rows=await core.localDatabase.localDatabase.allDocs();",
                    "return JSON.stringify({",
                    "obsoleteRetained:rows.rows.some(row=>row.id===legacyId),",
                    "currentDeleted:restored.deleted===true,",
                    "currentPath:restored.path,",
                    "previousPath:current.path,",
                    `content:await app.vault.adapter.read(${JSON.stringify(receivedNotePath)}),`,
                    "});",
                    "})()",
                ].join(""),
                session.cliEnv
            );
            assertEqual(fetched.obsoleteRetained, false, "Fast Fetch retained obsolete local Metadata.");
            assertEqual(fetched.currentDeleted, false, "Fast Fetch returned logically deleted current Metadata.");
            assertEqual(fetched.currentPath, fetched.previousPath, "Fast Fetch changed the current Metadata path.");
            assertEqual(fetched.content, editedNoteContent, "Fast Fetch changed the synchronised file content.");
            console.log(
                "Real Obsidian Fast Fetch replaced obsolete logical deletions and retained current Metadata and file content."
            );
        }
        if (cliFileInfo.expectedCtime !== undefined) {
            const receivedCtime = await evalObsidianJson<number>(
                obsidianCli.binary,
                [
                    "(async()=>{",
                    "const core=app.plugins.plugins['obsidian-livesync'].core;",
                    `const entry=await core.localDatabase.getDBEntry(${JSON.stringify(receivedNotePath)},undefined,false,true);`,
                    "return JSON.stringify(entry.ctime);",
                    "})()",
                ].join(""),
                session.cliEnv
            );
            assertEqual(
                receivedCtime,
                cliFileInfo.expectedCtime,
                "The CLI edit changed creation time in synchronised Metadata."
            );
            console.log("The CLI edit retained the filesystem creation time in the real Obsidian client's Metadata.");
        } else {
            console.log(
                "Creation-time verification skipped: native stats did not expose distinct creation and change times."
            );
        }
        if (unicodePaths) {
            const returnedContent = `${editedNoteContent}\nUpdated in Obsidian.\n`;
            await evalObsidianJson(
                obsidianCli.binary,
                [
                    "(async()=>{",
                    `const path=${JSON.stringify(receivedNotePath)};`,
                    "const file=app.vault.getAbstractFileByPath(path);",
                    "await new Promise(resolve=>setTimeout(resolve,Math.max(0,file.stat.mtime+2500-Date.now())));",
                    `await app.vault.modify(file,${JSON.stringify(returnedContent)});`,
                    "return JSON.stringify(true);})()",
                ].join(""),
                session.cliEnv
            );
            await pushLocalChanges(obsidianCli.binary, session.cliEnv);
            await runLiveSyncCli(liveSyncCliCommand, [cliDatabasePath, "--settings", cliSettingsPath, "sync"]);
            await runLiveSyncCli(liveSyncCliCommand, [cliDatabasePath, "--settings", cliSettingsPath, "mirror"]);
            assertEqual(
                await readFile(join(cliDatabasePath, notePath), "utf-8"),
                returnedContent,
                "The Obsidian update did not reach the original NFD physical file."
            );
            await access(join(cliDatabasePath, receivedNotePath)).then(
                () => {
                    throw new Error("The CLI created a second NFC physical file.");
                },
                (error: NodeJS.ErrnoException) => {
                    if (error.code !== "ENOENT") throw error;
                }
            );
            // The mirror command intentionally keeps tombstoned local files. The daemon applies remote deletions.
            daemon = await startLiveSyncCliDaemon(liveSyncCliCommand, cliDatabasePath, cliSettingsPath);
            await evalObsidianJson(
                obsidianCli.binary,
                [
                    "(async()=>{",
                    `const file=app.vault.getAbstractFileByPath(${JSON.stringify(receivedNotePath)});`,
                    "await new Promise(resolve=>setTimeout(resolve,Math.max(0,file.stat.mtime+2500-Date.now())));",
                    "await app.vault.delete(file);",
                    "return JSON.stringify(true);})()",
                ].join(""),
                session.cliEnv
            );
            await pushLocalChanges(obsidianCli.binary, session.cliEnv);
            const deletionDeadline = Date.now() + Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS);
            for (;;) {
                try {
                    await access(join(cliDatabasePath, notePath));
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                    break;
                }
                if (Date.now() >= deletionDeadline) {
                    throw new Error(
                        `The Obsidian deletion did not remove the original NFD physical file.\n${daemon.getOutput()}`
                    );
                }
                await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
            }
            await daemon.stop();
            daemon = undefined;
            console.log(
                "NFC path identity preserved the NFD physical name through creation, remote update, and deletion."
            );
        }
        console.log("CLI-edited note was retrieved by the real Obsidian plug-in with identical content.");
    } finally {
        await daemon?.stop();
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
