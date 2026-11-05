import { deepStrictEqual } from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { assertEqual } from "./liveSyncWorkflow.ts";
import { deleteObjectStoragePrefix, readObjectStorageJson, type ObjectStorageConfig } from "./objectStorage.ts";

const notePath = "Cafe\u0301/re\u0301sume\u0301.md";
const noteContent = "# CLI journal migration\n\nThe NFD physical path must keep its identity during migration.\n";

type CliFileInfo = {
    id: string;
    revision: string;
    path: string;
};

type JournalMilestone = {
    node_chunk_info?: Record<string, { current?: number }>;
};

type CliResult = {
    stdout: string;
    stderr: string;
};

type CliRunner = (...args: string[]) => Promise<CliResult>;

function cliErrorOutput(error: unknown): string {
    if (error === null || typeof error !== "object") {
        return String(error);
    }
    const details = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
    return [details.message, details.stdout, details.stderr]
        .filter((value): value is string => typeof value === "string")
        .join("\n");
}

async function readSingleMetadata(run: CliRunner, label: string): Promise<CliFileInfo> {
    const output = (await run("ls")).stdout.trimEnd();
    const paths = output === "" ? [] : output.split(/\r?\n/u).map((line) => line.split("\t", 1)[0] ?? "");
    assertEqual(paths.length, 1, `${label} did not contain exactly one Metadata document.`);
    const storedPath = paths[0];
    if (!storedPath) {
        throw new Error(`${label} did not report a stored path.`);
    }
    return JSON.parse((await run("info", storedPath)).stdout) as CliFileInfo;
}

export async function runCliJournalMigration(
    objectStorage: ObjectStorageConfig,
    bucketPrefix: string,
    sourceSettings: Record<string, unknown>
): Promise<void> {
    const migrationPrefix = `${bucketPrefix}migration/`;
    const cliRoot = await mkdtemp(join(tmpdir(), "livesync-cli-journal-migration-"));
    const sourceRoot = join(cliRoot, "source");
    const targetRoot = join(cliRoot, "target");
    const sourceDatabasePath = join(sourceRoot, "database");
    const targetDatabasePath = join(targetRoot, "database");
    const sourceVaultPath = join(sourceRoot, "vault");
    const targetVaultPath = join(targetRoot, "vault");
    const sourceSettingsPath = join(sourceRoot, "settings.json");
    const targetSettingsPath = join(targetRoot, "settings.json");
    const physicalParent = notePath.split("/")[0] ?? "";
    const physicalFilename = notePath.split("/").slice(-1)[0] ?? "";

    const writeCliSettings = async (settingsPath: string, pathNormalizationVersion: number) => {
        const previous = await readFile(settingsPath, "utf8").then(
            (text) => JSON.parse(text) as Record<string, unknown>,
            (error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
                return undefined;
            }
        );
        await writeFile(
            settingsPath,
            JSON.stringify({
                ...(previous ?? {
                    ...DEFAULT_SETTINGS,
                    ...objectStorage,
                    ...sourceSettings,
                    remoteType: "MINIO",
                    bucketPrefix: migrationPrefix,
                    isConfigured: true,
                }),
                pathNormalizationVersion,
                liveSync: false,
                syncOnStart: false,
                syncOnSave: false,
                syncOnEditorSave: false,
                syncOnFileOpen: false,
                syncAfterMerge: false,
                periodicReplication: false,
            })
        );
    };

    try {
        await mkdir(sourceDatabasePath, { recursive: true });
        await mkdir(targetDatabasePath, { recursive: true });
        await mkdir(dirname(join(sourceVaultPath, notePath)), { recursive: true });
        await mkdir(dirname(join(targetVaultPath, notePath)), { recursive: true });
        await writeFile(join(sourceVaultPath, notePath), noteContent);
        await writeFile(join(targetVaultPath, notePath), noteContent);
        await writeCliSettings(sourceSettingsPath, 0);
        await writeCliSettings(targetSettingsPath, 0);

        const execute = promisify(execFile);
        const createRunner =
            (databasePath: string, vaultPath: string, settingsPath: string): CliRunner =>
            async (...args: string[]) =>
                await execute(
                    process.execPath,
                    [
                        resolve("src/apps/cli/dist/index.cjs"),
                        databasePath,
                        "--vault",
                        vaultPath,
                        "--settings",
                        settingsPath,
                        ...args,
                    ],
                    { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
                );

        const source = createRunner(sourceDatabasePath, sourceVaultPath, sourceSettingsPath);
        const target = createRunner(targetDatabasePath, targetVaultPath, targetSettingsPath);

        await source("--force", "--write-settings", "rebuild");
        await target("mirror");

        const legacySource = await readSingleMetadata(source, "Legacy CLI source");
        const legacyTarget = await readSingleMetadata(target, "Legacy CLI target");
        const targetVaultEntriesBeforeFetch = await readdir(targetVaultPath);
        const targetParentEntriesBeforeFetch = await readdir(dirname(join(targetVaultPath, notePath)));
        assertEqual(
            targetVaultEntriesBeforeFetch.includes(physicalParent),
            true,
            "The legacy CLI target did not retain the NFD physical parent."
        );
        assertEqual(
            targetParentEntriesBeforeFetch.includes(physicalFilename),
            true,
            "The legacy CLI target did not retain the NFD physical filename."
        );

        await writeCliSettings(sourceSettingsPath, 1);
        await source("--force", "--write-settings", "rebuild");

        const migratedSource = await readSingleMetadata(source, "Migrated CLI source");
        if (migratedSource.id === legacySource.id) {
            throw new Error("The NFC migration did not change the source Metadata ID.");
        }
        assertEqual(
            (await source("cat", notePath.normalize("NFC"))).stdout,
            noteContent,
            "The migrated CLI source did not retain the canonical Chunk content."
        );

        const milestoneKey = `${migrationPrefix}_00000000-milestone.json`;
        const milestoneBeforeFailedFetch = await readObjectStorageJson<JournalMilestone>(objectStorage, milestoneKey);
        const migrationVersions = Object.values(milestoneBeforeFailedFetch.node_chunk_info ?? {}).map(
            (node) => node.current
        );
        assertEqual(migrationVersions.includes(4), true, "The migrated Journal milestone did not declare version 4.");

        let legacyFetchError: unknown;
        try {
            await target("--force", "--write-settings", "fetch");
        } catch (error) {
            legacyFetchError = error;
        }
        if (legacyFetchError === undefined) {
            throw new Error("The legacy CLI target unexpectedly fetched a Journal with NFC path identity.");
        }
        const legacyFetchOutput = cliErrorOutput(legacyFetchError);
        if (!/path identity/iu.test(legacyFetchOutput)) {
            throw new Error(
                `The legacy CLI Fetch failed without the expected path identity error. Output: ${legacyFetchOutput}`
            );
        }

        const targetAfterFailedFetch = await readSingleMetadata(target, "Legacy CLI target after failed Fetch");
        assertEqual(
            targetAfterFailedFetch.id,
            legacyTarget.id,
            "The failed legacy Fetch changed the target Metadata ID."
        );
        assertEqual(
            targetAfterFailedFetch.revision,
            legacyTarget.revision,
            "The failed legacy Fetch changed the target Metadata revision."
        );
        const milestoneAfterFailedFetch = await readObjectStorageJson<JournalMilestone>(objectStorage, milestoneKey);
        deepStrictEqual(
            milestoneAfterFailedFetch,
            milestoneBeforeFailedFetch,
            "The failed legacy Fetch changed the remote Journal milestone."
        );

        await writeCliSettings(targetSettingsPath, 1);
        await target("--force", "--write-settings", "fetch");

        const migratedTarget = await readSingleMetadata(target, "Migrated CLI target");
        assertEqual(migratedTarget.id, migratedSource.id, "The CLI source and target Metadata IDs did not converge.");
        assertEqual(
            (await target("cat", notePath.normalize("NFC"))).stdout,
            noteContent,
            "The migrated CLI target did not retain the canonical Chunk content."
        );
        assertEqual(
            await readFile(join(targetVaultPath, notePath), "utf8"),
            noteContent,
            "The migrated CLI Fetch changed the NFD physical file contents."
        );

        const targetVaultEntriesAfterFetch = await readdir(targetVaultPath);
        const targetParentEntriesAfterFetch = await readdir(dirname(join(targetVaultPath, notePath)));
        deepStrictEqual(
            targetVaultEntriesAfterFetch,
            targetVaultEntriesBeforeFetch,
            "The migrated CLI Fetch changed the physical Vault parent names."
        );
        deepStrictEqual(
            targetParentEntriesAfterFetch,
            targetParentEntriesBeforeFetch,
            "The migrated CLI Fetch changed the physical NFD filename."
        );

        console.log(
            "CLI_JOURNAL_MIGRATION: legacy Fetch rejection, safe migration, and NFD physical path preservation verified."
        );
    } finally {
        try {
            await rm(cliRoot, { recursive: true, force: true });
        } finally {
            await deleteObjectStoragePrefix(objectStorage, migrationPrefix);
        }
    }
}
