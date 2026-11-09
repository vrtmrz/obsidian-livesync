import { displayRev } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { startCliInBackground, type BackgroundCliProcess } from "./helpers/backgroundCli.ts";
import { runCli, runCliOrFail } from "./helpers/cli.ts";
import { startCouchdb, stopCouchdb } from "./helpers/docker.ts";
import { applyCouchdbSettings, initSettingsFile } from "./helpers/settings.ts";
import { TempDir } from "./helpers/temp.ts";

function envOrDefault(keys: string[], fallback: string): string {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return fallback;
}

async function setChunkRetrievalSettings(settingsPath: string, useOnlyLocalChunk: boolean): Promise<void> {
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    settings.readChunksOnline = true;
    settings.useOnlyLocalChunk = useOnlyLocalChunk;
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

async function assertMarkerAbsent(markerPath: string, message: string): Promise<void> {
    let exists = true;
    try {
        await stat(markerPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false;
        else throw error;
    }
    assert.equal(exists, false, message);
}

async function readMetadataRevision(
    databasePath: string,
    vaultPath: string,
    settingsPath: string,
    filePath: string
): Promise<string> {
    const infoText = await runCliOrFail(
        databasePath,
        "--vault",
        vaultPath,
        "--settings",
        settingsPath,
        "info",
        filePath
    );
    const info = JSON.parse(infoText) as { revision?: unknown };
    assert.equal(typeof info.revision, "string", "Metadata revision is missing for " + filePath + ": " + infoText);
    return info.revision as string;
}

async function stopDaemon(daemon: BackgroundCliProcess | undefined): Promise<void> {
    if (!daemon) return;
    await daemon.stop().catch(() => {});
}

test(
    "fetch: on-demand chunks preserve existing Vault Metadata and recover after an interrupted fetch",
    { timeout: 180_000 },
    async () => {
        await using workDir = await TempDir.create("livesync-cli-fetch-on-demand-chunks");

        const couchdbUri = envOrDefault(["COUCHDB_URI", "hostname"], "http://127.0.0.1:5989").replace(/\/$/, "");
        const couchdbUser = envOrDefault(["COUCHDB_USER", "username"], "admin");
        const couchdbPassword = envOrDefault(["COUCHDB_PASSWORD", "password"], "testpassword");
        const dbPrefix = envOrDefault(["COUCHDB_DBNAME", "dbname"], "livesync-test-db-ci");
        const dbname = (dbPrefix + "-fetch-on-demand-chunks-" + Date.now() + "-" + Math.floor(Math.random() * 1_000_000))
            .toLowerCase();

        const sourceDatabase = workDir.join("source-database");
        const receiverDatabase = workDir.join("receiver-database");
        const sourceVault = workDir.join("source-vault");
        const receiverVault = workDir.join("receiver-vault");
        const sourceSettings = workDir.join("source-settings.json");
        const receiverSettings = workDir.join("receiver-settings.json");
        const notePath = "notes/on-demand-chunks.md";
        const sourceNote = join(sourceVault, notePath);
        const receiverNote = join(receiverVault, notePath);
        const expectedBytes = Buffer.from("Repeated fetch must preserve this ASCII note.\n", "utf8");
        const sourceMarker = join(sourceDatabase, ".livesync", "reconstruction.json");
        const receiverMarker = join(receiverDatabase, ".livesync", "reconstruction.json");

        await Promise.all([
            mkdir(sourceDatabase, { recursive: true }),
            mkdir(receiverDatabase, { recursive: true }),
            mkdir(sourceVault, { recursive: true }),
            mkdir(receiverVault, { recursive: true }),
            mkdir(join(sourceVault, "notes"), { recursive: true }),
        ]);
        await writeFile(sourceNote, expectedBytes);

        let daemon: BackgroundCliProcess | undefined;
        try {
            await startCouchdb(couchdbUri, couchdbUser, couchdbPassword, dbname);
            await Promise.all([initSettingsFile(sourceSettings), initSettingsFile(receiverSettings)]);
            await Promise.all([
                applyCouchdbSettings(sourceSettings, couchdbUri, couchdbUser, couchdbPassword, dbname, true),
                applyCouchdbSettings(receiverSettings, couchdbUri, couchdbUser, couchdbPassword, dbname, true),
            ]);
            await Promise.all([
                setChunkRetrievalSettings(sourceSettings, false),
                setChunkRetrievalSettings(receiverSettings, false),
            ]);

            await runCliOrFail(
                sourceDatabase,
                "--vault",
                sourceVault,
                "--settings",
                sourceSettings,
                "rebuild",
                "--force",
                "--write-settings"
            );
            await assertMarkerAbsent(sourceMarker, "Source rebuild should clear reconstruction.json");
            assert.deepEqual(await readFile(sourceNote), expectedBytes, "Source rebuild must preserve the Vault bytes");

            await runCliOrFail(
                receiverDatabase,
                "--vault",
                receiverVault,
                "--settings",
                receiverSettings,
                "fetch",
                "--force",
                "--write-settings"
            );
            assert.deepEqual(await readFile(receiverNote), expectedBytes, "Initial fetch must reproduce the note bytes");
            await assertMarkerAbsent(receiverMarker, "Initial fetch should clear reconstruction.json");
            const originalRevision = await readMetadataRevision(receiverDatabase, receiverVault, receiverSettings, notePath);

            await runCliOrFail(
                receiverDatabase,
                "--vault",
                receiverVault,
                "--settings",
                receiverSettings,
                "fetch",
                "--force",
                "--write-settings"
            );
            assert.deepEqual(await readFile(receiverNote), expectedBytes, "Repeated fetch must preserve the Vault bytes");
            assert.equal(
                await readMetadataRevision(receiverDatabase, receiverVault, receiverSettings, notePath),
                originalRevision,
                "Repeated fetch must retain the original Metadata revision"
            );
            await assertMarkerAbsent(receiverMarker, "Repeated fetch should clear reconstruction.json");

            await setChunkRetrievalSettings(receiverSettings, true);
            const omittedChunkFetch = await runCli(
                "-v",
                receiverDatabase,
                "--vault",
                receiverVault,
                "--settings",
                receiverSettings,
                "fetch",
                "--force",
                "--write-settings"
            );
            assert.notEqual(omittedChunkFetch.code, 0, "Fetch must fail when local-only chunk reads omit the remote chunk");
            assert.ok(
                omittedChunkFetch.combined.includes(
                    `Could not reconcile ${notePath}: content for current database revision ${displayRev(originalRevision)} is unavailable;`
                ),
                omittedChunkFetch.combined
            );
            assert.deepEqual(
                await readFile(receiverNote),
                expectedBytes,
                "A failed fetch must preserve the receiver Vault bytes"
            );
            const failedMarker = JSON.parse(await readFile(receiverMarker, "utf8")) as {
                command?: unknown;
                phase?: unknown;
            };
            assert.equal(failedMarker.command, "fetch", "Failed fetch should retain its recovery marker");
            assert.equal(failedMarker.phase, "running", "Failed fetch marker should remain in the running phase");

            const blockedDaemon = await runCli(
                receiverDatabase,
                "--vault",
                receiverVault,
                "--settings",
                receiverSettings,
                "daemon"
            );
            assert.notEqual(blockedDaemon.code, 0, "Daemon must refuse to start while fetch recovery is required");
            assert.match(blockedDaemon.combined, /interrupted fetch requires recovery/i);

            await setChunkRetrievalSettings(receiverSettings, false);
            await runCliOrFail(
                receiverDatabase,
                "--vault",
                receiverVault,
                "--settings",
                receiverSettings,
                "fetch",
                "--force",
                "--write-settings"
            );
            await assertMarkerAbsent(receiverMarker, "Successful recovery fetch should clear reconstruction.json");
            assert.deepEqual(await readFile(receiverNote), expectedBytes, "Recovery fetch must preserve the Vault bytes");
            assert.equal(
                await readMetadataRevision(receiverDatabase, receiverVault, receiverSettings, notePath),
                originalRevision,
                "Recovery fetch must retain the original Metadata revision"
            );

            daemon = startCliInBackground(
                receiverDatabase,
                "--vault",
                receiverVault,
                "--settings",
                receiverSettings,
                "daemon"
            );
            await daemon.waitUntilContains("[Daemon] Initial replication complete", 45_000);
            assert.equal(await daemon.stop(), 0, daemon.combined);
            daemon = undefined;

            assert.deepEqual(await readFile(receiverNote), expectedBytes, "Daemon startup must preserve the Vault bytes");
            assert.equal(
                await readMetadataRevision(receiverDatabase, receiverVault, receiverSettings, notePath),
                originalRevision,
                "Daemon startup must not create an unnecessary Metadata revision"
            );
            await assertMarkerAbsent(receiverMarker, "Recovered operation should leave reconstruction.json absent");
        } finally {
            await stopDaemon(daemon);
            await stopCouchdb().catch(() => {});
        }
    }
);
