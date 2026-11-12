import assert from "node:assert/strict";
import { mkdir, readFile, readdir, realpath, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { startCliInBackground, type BackgroundCliProcess } from "./helpers/backgroundCli.ts";
import { runCliOrFail, runCliWithInputOrFail, sanitiseCatStdout } from "./helpers/cli.ts";
import { startCouchdb, stopCouchdb } from "./helpers/docker.ts";
import { applyRemoteSyncSettings, initSettingsFile } from "./helpers/settings.ts";
import { TempDir } from "./helpers/temp.ts";

const INITIAL_REPLICATION_COMPLETE = "[Daemon] Initial replication complete";
const LIVESYNC_ACTIVE = "LiveSync active";
const TEST_PASSPHRASE = "issue-1340-couchdb-test-passphrase";

interface MetadataInfo {
    id: string;
    revision: string;
}

function envOrDefault(keys: string[], fallback: string): string {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return fallback;
}

function waitForTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 100));
}

async function setChunkRetrievalSettings(settingsPath: string): Promise<void> {
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    settings.readChunksOnline = true;
    settings.useOnlyLocalChunk = false;
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

async function readMetadataInfo(
    databasePath: string,
    vaultPath: string,
    settingsPath: string,
    filePath: string
): Promise<MetadataInfo> {
    const infoText = await runCliOrFail(
        databasePath,
        "--vault",
        vaultPath,
        "--settings",
        settingsPath,
        "info",
        filePath
    );
    const info = JSON.parse(infoText) as { id?: unknown; revision?: unknown };
    assert.equal(typeof info.id, "string", "Metadata ID is missing for " + filePath + ": " + infoText);
    assert.equal(typeof info.revision, "string", "Metadata revision is missing for " + filePath + ": " + infoText);
    return {
        id: info.id as string,
        revision: info.revision as string,
    };
}

async function readDatabaseSuffix(settingsPath: string): Promise<string> {
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    const suffix = settings.additionalSuffixOfDatabaseName;
    assert.equal(typeof suffix, "string", "Fetch did not save a selected local database suffix");
    assert.notEqual(suffix, "", "Fetch saved an empty local database suffix");
    return suffix as string;
}

async function waitForFileBytes(filePath: string, expected: Uint8Array, timeoutMs = 45_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let actual: Uint8Array | undefined;
    while (Date.now() < deadline) {
        try {
            actual = await readFile(filePath);
            if (Buffer.compare(actual, expected) === 0) return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await waitForTick();
    }
    throw new Error(
        "Timed out waiting for exact bytes at " + filePath + "; actual=" + JSON.stringify(actual?.toString())
    );
}

async function waitForMissing(filePath: string, timeoutMs = 45_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await stat(filePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
        await waitForTick();
    }
    throw new Error("Timed out waiting for " + filePath + " to be removed from the observer Vault");
}

async function assertMissing(filePath: string, message: string): Promise<void> {
    try {
        await stat(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    assert.fail(message);
}

/** Return DB/Vault owner identities so restart checks can detect a second state scope. */
async function readRuntimeScopePaths(databasePath: string): Promise<string[]> {
    const scopesRoot = join(databasePath, ".livesync", "runtime", "scopes");
    let databaseDirectories;
    try {
        databaseDirectories = await readdir(scopesRoot, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }

    const scopes: string[] = [];
    for (const databaseDirectory of databaseDirectories) {
        if (!databaseDirectory.isDirectory()) continue;
        const databaseScopePath = join(scopesRoot, databaseDirectory.name);
        const vaultDirectories = await readdir(databaseScopePath, { withFileTypes: true });
        for (const vaultDirectory of vaultDirectories) {
            if (vaultDirectory.isDirectory()) {
                scopes.push(join(databaseDirectory.name, vaultDirectory.name));
            }
        }
    }
    return scopes.sort();
}

async function assertDatabaseBytes(
    databasePath: string,
    vaultPath: string,
    settingsPath: string,
    filePath: string,
    expected: Uint8Array,
    message: string,
    revision?: string
): Promise<void> {
    const command = revision ? ["cat-rev", filePath, revision] : ["cat", filePath];
    const output = await runCliOrFail(databasePath, "--vault", vaultPath, "--settings", settingsPath, ...command);
    assert.deepEqual(Buffer.from(sanitiseCatStdout(output), "utf8"), expected, message);
}

// Call only after stopping the daemon. Inspect stored Metadata so reflection
// exclusions cannot hide an accidental upload from a Vault-only assertion.
async function readDatabasePaths(databasePath: string, vaultPath: string, settingsPath: string): Promise<Set<string>> {
    const listing = await runCliOrFail(databasePath, "--vault", vaultPath, "--settings", settingsPath, "ls");
    return new Set(
        listing
            .split(/\r?\n/)
            .map((line) => line.split("\t", 1)[0])
            .filter((filePath) => filePath !== undefined && filePath !== "")
    );
}

async function assertCouchdbRevisionAncestor(
    couchdbUri: string,
    couchdbUser: string,
    couchdbPassword: string,
    dbname: string,
    documentId: string,
    currentRevision: string,
    ancestorRevision: string
): Promise<void> {
    const response = await fetch(
        couchdbUri + "/" + encodeURIComponent(dbname) + "/" + encodeURIComponent(documentId) + "?revs=true",
        {
            headers: {
                Authorization: "Basic " + Buffer.from(couchdbUser + ":" + couchdbPassword).toString("base64"),
            },
        }
    );
    const responseText = await response.text();
    assert.equal(response.status, 200, "CouchDB must return the seeded baseline Metadata: " + responseText);
    const document = JSON.parse(responseText) as {
        _rev?: unknown;
        _revisions?: { start?: unknown; ids?: unknown };
    };
    assert.equal(document._rev, currentRevision, "CouchDB must retain the selected baseline revision");

    const ancestorMatch = /^(\d+)-(.+)$/.exec(ancestorRevision);
    assert.ok(ancestorMatch, "Original revision must include its generation and hash");
    const ancestorGeneration = Number(ancestorMatch[1]);
    const history = document._revisions;
    assert.ok(history, "CouchDB response must include the revision history");
    assert.equal(typeof history.start, "number", "CouchDB revision history must include its starting generation");
    assert.ok(Array.isArray(history.ids), "CouchDB revision history must include its revision hashes");
    const ancestorIndex = (history.start as number) - ancestorGeneration;
    assert.ok(
        Number.isSafeInteger(ancestorIndex) && ancestorIndex >= 0 && ancestorIndex < history.ids.length,
        "CouchDB revision history must include the original baseline generation"
    );
    assert.equal(
        history.ids[ancestorIndex],
        ancestorMatch[2],
        "CouchDB revision history must retain the original baseline revision"
    );
}

async function stopDaemon(daemon: BackgroundCliProcess | undefined): Promise<void> {
    if (!daemon) return;
    await daemon.stop().catch(() => {});
}

test(
    "daemon: monitors a hidden-parent Vault through a visible symlink and retains its scope after restart",
    { timeout: 240_000 },
    async () => {
        await using workDir = await TempDir.create("livesync-cli-daemon-watch-paths");

        const couchdbUri = envOrDefault(["COUCHDB_URI", "hostname"], "http://127.0.0.1:5989").replace(/\/$/, "");
        const couchdbUser = envOrDefault(["COUCHDB_USER", "username"], "admin");
        const couchdbPassword = envOrDefault(["COUCHDB_PASSWORD", "password"], "testpassword");
        const dbPrefix = envOrDefault(["COUCHDB_DBNAME", "dbname"], "livesync-test-db-ci");
        const dbname = (
            dbPrefix +
            "-daemon-watch-paths-" +
            Date.now() +
            "-" +
            Math.floor(Math.random() * 1_000_000)
        ).toLowerCase();

        const sourceDatabase = workDir.join("source-database");
        const targetDatabase = workDir.join("target-database");
        const observerDatabase = workDir.join("observer-database");
        const sourceVault = workDir.join("source-vault");
        const physicalVault = workDir.join(".obsidian", "physical-vault");
        const visibleVault = workDir.join("visible-vault");
        const observerVault = workDir.join("observer-vault");
        const sourceSettings = workDir.join("source-settings.json");
        const targetSettings = workDir.join("target-settings.json");
        const observerSettings = workDir.join("observer-settings.json");

        const baselinePath = "notes/baseline.md";
        const watchedPath = "notes/created-after-fetch.md";
        const restartedPath = "notes/created-after-restart.md";
        const dbLikePath = "notes/archive-livesync-v2/note.md";
        const hiddenPath = "notes/.private.md";
        const ignoredPath = "notes/ignored.ignored.md";
        const initialBytes = Buffer.from("Baseline revision one.\n", "utf8");
        const baselineBytes = Buffer.from("Baseline revision two with preserved ancestry.\n", "utf8");
        const createdBytes = Buffer.from("Created through the visible symlink.\n", "utf8");
        const modifiedBytes = Buffer.from("Modified through the visible symlink.\n", "utf8");
        const restartedBytes = Buffer.from("Created after restarting with the physical root.\n", "utf8");
        const dbLikeInitialBytes = Buffer.from("Nested DB-like path before option restart.\n", "utf8");
        const dbLikeModifiedBytes = Buffer.from("Nested DB-like path modified with the option.\n", "utf8");
        const targetBaseline = join(physicalVault, baselinePath);
        const observerBaseline = join(observerVault, baselinePath);
        const observerWatched = join(observerVault, watchedPath);
        const observerRestarted = join(observerVault, restartedPath);
        const observerDbLike = join(observerVault, dbLikePath);
        const observerHidden = join(observerVault, hiddenPath);
        const observerIgnored = join(observerVault, ignoredPath);

        await Promise.all([
            mkdir(sourceDatabase, { recursive: true }),
            mkdir(targetDatabase, { recursive: true }),
            mkdir(observerDatabase, { recursive: true }),
            mkdir(sourceVault, { recursive: true }),
            mkdir(physicalVault, { recursive: true }),
            mkdir(observerVault, { recursive: true }),
        ]);
        await mkdir(join(physicalVault, ".livesync"), { recursive: true });
        await mkdir(join(physicalVault, "notes"), { recursive: true });
        await writeFile(join(physicalVault, ".livesync", "ignore"), "*.ignored.md\n");
        await symlink(physicalVault, visibleVault, process.platform === "win32" ? "junction" : "dir");
        assert.equal(
            await realpath(visibleVault),
            await realpath(physicalVault),
            "Visible Vault path must resolve to the hidden physical Vault"
        );

        let targetDaemon: BackgroundCliProcess | undefined;
        let observerDaemon: BackgroundCliProcess | undefined;
        try {
            await startCouchdb(couchdbUri, couchdbUser, couchdbPassword, dbname);
            for (const settingsPath of [sourceSettings, targetSettings, observerSettings]) {
                await initSettingsFile(settingsPath);
            }
            const encryptedCouchdbSettings = {
                remoteType: "COUCHDB" as const,
                couchdbUri,
                couchdbUser,
                couchdbPassword,
                couchdbDbname: dbname,
                encrypt: true,
                passphrase: TEST_PASSPHRASE,
            };
            await Promise.all([
                applyRemoteSyncSettings(sourceSettings, encryptedCouchdbSettings),
                applyRemoteSyncSettings(targetSettings, encryptedCouchdbSettings),
                applyRemoteSyncSettings(observerSettings, encryptedCouchdbSettings),
            ]);
            await Promise.all([
                setChunkRetrievalSettings(sourceSettings),
                setChunkRetrievalSettings(targetSettings),
                setChunkRetrievalSettings(observerSettings),
            ]);

            await runCliWithInputOrFail(
                initialBytes,
                sourceDatabase,
                "--vault",
                sourceVault,
                "--settings",
                sourceSettings,
                "put",
                baselinePath
            );
            await runCliOrFail(sourceDatabase, "--vault", sourceVault, "--settings", sourceSettings, "sync");
            // Check the old body on its retaining source. Fresh peers need the
            // current contents and ancestry, without a guarantee of every historical body.
            const originalInfo = await readMetadataInfo(sourceDatabase, sourceVault, sourceSettings, baselinePath);
            await assertDatabaseBytes(
                sourceDatabase,
                sourceVault,
                sourceSettings,
                baselinePath,
                initialBytes,
                "Source must retain the original baseline revision before its update",
                originalInfo.revision
            );

            await runCliWithInputOrFail(
                baselineBytes,
                sourceDatabase,
                "--vault",
                sourceVault,
                "--settings",
                sourceSettings,
                "put",
                baselinePath
            );
            await runCliOrFail(sourceDatabase, "--vault", sourceVault, "--settings", sourceSettings, "sync");

            const seedInfo = await readMetadataInfo(sourceDatabase, sourceVault, sourceSettings, baselinePath);
            assert.equal(
                seedInfo.id,
                originalInfo.id,
                "Second put must update the original baseline Metadata document"
            );
            await assertDatabaseBytes(
                sourceDatabase,
                sourceVault,
                sourceSettings,
                baselinePath,
                baselineBytes,
                "Source must retain the current baseline revision bytes",
                seedInfo.revision
            );

            await runCliOrFail(
                targetDatabase,
                "--vault",
                visibleVault,
                "--settings",
                targetSettings,
                "fetch",
                "--force",
                "--write-settings"
            );
            assert.deepEqual(await readFile(targetBaseline), baselineBytes, "Fetch must preserve exact baseline bytes");
            assert.deepEqual(
                await readMetadataInfo(targetDatabase, visibleVault, targetSettings, baselinePath),
                seedInfo,
                "Fetch must preserve the current baseline document and revision identity"
            );
            await assertDatabaseBytes(
                targetDatabase,
                visibleVault,
                targetSettings,
                baselinePath,
                baselineBytes,
                "Fetch must preserve the current baseline revision bytes",
                seedInfo.revision
            );

            targetDaemon = startCliInBackground(
                targetDatabase,
                "--vault",
                visibleVault,
                "--settings",
                targetSettings,
                "daemon"
            );
            await targetDaemon.waitUntilContains(INITIAL_REPLICATION_COMPLETE, 45_000);
            await targetDaemon.waitUntilContains(LIVESYNC_ACTIVE, 45_000);

            observerDaemon = startCliInBackground(
                observerDatabase,
                "--vault",
                observerVault,
                "--settings",
                observerSettings,
                "daemon"
            );
            await observerDaemon.waitUntilContains(INITIAL_REPLICATION_COMPLETE, 45_000);
            await observerDaemon.waitUntilContains(LIVESYNC_ACTIVE, 45_000);
            await waitForFileBytes(observerBaseline, baselineBytes);

            const targetNotesViaSymlink = join(visibleVault, "notes");
            const targetNotesViaPhysicalRoot = join(physicalVault, "notes");
            await writeFile(join(targetNotesViaSymlink, ".private.md"), "Default hidden-entry exclusion.\n");
            await writeFile(join(targetNotesViaSymlink, "ignored.ignored.md"), "User ignore rule exclusion.\n");
            await mkdir(join(targetNotesViaSymlink, "archive-livesync-v2"), { recursive: true });
            await writeFile(join(targetNotesViaSymlink, "archive-livesync-v2", "note.md"), dbLikeInitialBytes);
            await writeFile(join(targetNotesViaSymlink, "created-after-fetch.md"), createdBytes);
            await waitForFileBytes(observerWatched, createdBytes);
            assert.deepEqual(
                await readFile(observerWatched),
                createdBytes,
                "Created note must reach the remote observer exactly"
            );
            await assertMissing(observerHidden, "A dot-prefixed Vault entry must remain excluded");
            await assertMissing(observerIgnored, "An entry matched by .livesync/ignore must remain excluded");

            await writeFile(join(targetNotesViaSymlink, "created-after-fetch.md"), modifiedBytes);
            await waitForFileBytes(observerWatched, modifiedBytes);
            assert.deepEqual(
                await readFile(observerWatched),
                modifiedBytes,
                "Modified note must reach the remote observer exactly"
            );

            await unlink(join(targetNotesViaSymlink, "created-after-fetch.md"));
            await waitForMissing(observerWatched);

            assert.equal(await targetDaemon.stop(), 0, targetDaemon.combined);
            targetDaemon = undefined;
            await stopDaemon(observerDaemon);
            observerDaemon = undefined;
            // Drain remote changes before inspecting the stopped observer's DB.
            // A missing reflected file alone would not establish that upload was excluded.
            await runCliOrFail(observerDatabase, "--vault", observerVault, "--settings", observerSettings, "sync");
            const defaultObserverPaths = await readDatabasePaths(observerDatabase, observerVault, observerSettings);
            assert.equal(
                defaultObserverPaths.has(dbLikePath),
                false,
                "Default policy must not upload a nested DB-like path to the remote database"
            );
            assert.equal(
                defaultObserverPaths.has(hiddenPath),
                false,
                "Default policy must exclude dot-prefixed entries"
            );
            assert.equal(
                defaultObserverPaths.has(ignoredPath),
                false,
                "Default policy must exclude entries matched by .livesync/ignore"
            );

            // Reuse the existing owners while changing both the root spelling and
            // the naming-rule opt-in; the next phase must not create a new dataset or scope.
            const selectedSuffix = await readDatabaseSuffix(targetSettings);
            const scopesBeforeRestart = await readRuntimeScopePaths(targetDatabase);
            assert.ok(scopesBeforeRestart.length > 0, "Alias startup must initialise a Vault runtime scope");

            targetDaemon = startCliInBackground(
                targetDatabase,
                "--vault",
                physicalVault,
                "--settings",
                targetSettings,
                "--include-db-like-dirs",
                "daemon"
            );
            await targetDaemon.waitUntilContains(INITIAL_REPLICATION_COMPLETE, 45_000);
            await targetDaemon.waitUntilContains(LIVESYNC_ACTIVE, 45_000);
            assert.equal(
                await readDatabaseSuffix(targetSettings),
                selectedSuffix,
                "Physical-root restart must retain the selected database suffix"
            );

            observerDaemon = startCliInBackground(
                observerDatabase,
                "--vault",
                observerVault,
                "--settings",
                observerSettings,
                "--include-db-like-dirs",
                "daemon"
            );
            await observerDaemon.waitUntilContains(INITIAL_REPLICATION_COMPLETE, 45_000);
            await observerDaemon.waitUntilContains(LIVESYNC_ACTIVE, 45_000);
            await waitForFileBytes(observerDbLike, dbLikeInitialBytes);
            assert.deepEqual(
                await readFile(observerDbLike),
                dbLikeInitialBytes,
                "Include option must replicate exact bytes for the previously excluded nested DB-like path"
            );

            await writeFile(join(targetNotesViaPhysicalRoot, "archive-livesync-v2", "note.md"), dbLikeModifiedBytes);
            await waitForFileBytes(observerDbLike, dbLikeModifiedBytes);
            assert.deepEqual(
                await readFile(observerDbLike),
                dbLikeModifiedBytes,
                "Include option must monitor and replicate modifications under a nested DB-like directory"
            );

            await unlink(join(targetNotesViaPhysicalRoot, "archive-livesync-v2", "note.md"));
            await waitForMissing(observerDbLike);

            await writeFile(join(targetNotesViaPhysicalRoot, "created-after-restart.md"), restartedBytes);
            await waitForFileBytes(observerRestarted, restartedBytes);
            assert.deepEqual(
                await readFile(observerRestarted),
                restartedBytes,
                "Physical-root restart must continue monitoring and replicate exact bytes"
            );
            assert.deepEqual(
                await readRuntimeScopePaths(targetDatabase),
                scopesBeforeRestart,
                "Physical-root restart must reuse the existing Vault runtime scope"
            );

            assert.equal(await targetDaemon.stop(), 0, targetDaemon.combined);
            targetDaemon = undefined;
            await stopDaemon(observerDaemon);
            observerDaemon = undefined;
            await runCliOrFail(observerDatabase, "--vault", observerVault, "--settings", observerSettings, "sync");

            for (const [databasePath, vaultPath, settingsPath] of [
                [targetDatabase, visibleVault, targetSettings],
                [observerDatabase, observerVault, observerSettings],
            ]) {
                assert.deepEqual(
                    await readMetadataInfo(databasePath, vaultPath, settingsPath, baselinePath),
                    seedInfo,
                    "Live monitoring must preserve the current baseline document and revision identity"
                );
                await assertDatabaseBytes(
                    databasePath,
                    vaultPath,
                    settingsPath,
                    baselinePath,
                    baselineBytes,
                    "Live monitoring must preserve the current baseline revision bytes",
                    seedInfo.revision
                );
            }
            assert.deepEqual(
                await readMetadataInfo(sourceDatabase, sourceVault, sourceSettings, baselinePath),
                seedInfo,
                "Source must retain the selected baseline document and revision"
            );
            await assertDatabaseBytes(
                sourceDatabase,
                sourceVault,
                sourceSettings,
                baselinePath,
                baselineBytes,
                "Source must retain the selected baseline revision bytes",
                seedInfo.revision
            );
            await assertDatabaseBytes(
                sourceDatabase,
                sourceVault,
                sourceSettings,
                baselinePath,
                initialBytes,
                "Source must retain the original baseline revision contents",
                originalInfo.revision
            );
            await assertCouchdbRevisionAncestor(
                couchdbUri,
                couchdbUser,
                couchdbPassword,
                dbname,
                seedInfo.id,
                seedInfo.revision,
                originalInfo.revision
            );
            await assertDatabaseBytes(
                observerDatabase,
                observerVault,
                observerSettings,
                restartedPath,
                restartedBytes,
                "Restarted daemon content must exist in the independently replicated database"
            );
            const observerPaths = await readDatabasePaths(observerDatabase, observerVault, observerSettings);
            assert.equal(
                observerPaths.has(watchedPath),
                false,
                "Deleted note must be absent from the independently replicated database"
            );
            assert.equal(
                observerPaths.has(dbLikePath),
                false,
                "Deleted DB-like path must be absent from the independently replicated database"
            );
            assert.equal(
                observerPaths.has(hiddenPath),
                false,
                "Dot-prefixed entry must be absent from the independently replicated database"
            );
            assert.equal(
                observerPaths.has(ignoredPath),
                false,
                "Entry matched by .livesync/ignore must be absent from the independently replicated database"
            );
        } finally {
            await stopDaemon(observerDaemon);
            await stopDaemon(targetDaemon);
            await stopCouchdb().catch(() => {});
        }
    }
);
