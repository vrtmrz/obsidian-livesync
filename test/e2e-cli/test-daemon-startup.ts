import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TempDir } from "./helpers/temp.ts";
import { runCliOrFail, runCliWithInputOrFail } from "./helpers/cli.ts";
import { applyCouchdbSettings, initSettingsFile } from "./helpers/settings.ts";
import { startCliInBackground, type BackgroundCliProcess } from "./helpers/backgroundCli.ts";
import { startCouchdb, stopCouchdb } from "./helpers/docker.ts";

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

async function waitForText(filePath: string, expected: string, timeoutMs = 45_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let actual = "";
    while (Date.now() < deadline) {
        try {
            actual = await readFile(filePath, "utf8");
            if (actual === expected) return;
        } catch (error) {
            if ((error as { code?: string }).code !== "ENOENT") throw error;
        }
        await waitForTick();
    }
    throw new Error(
        `Timed out waiting for ${filePath} to contain ${JSON.stringify(expected)}; actual=${JSON.stringify(actual)}`
    );
}

async function waitForMissing(filePath: string, timeoutMs = 45_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await stat(filePath);
        } catch (error) {
            if ((error as { code?: string }).code === "ENOENT") return;
            throw error;
        }
        await waitForTick();
    }
    throw new Error(`Timed out waiting for ${filePath} to be removed`);
}

async function stopDaemon(daemon: BackgroundCliProcess | undefined): Promise<void> {
    if (!daemon) return;
    await daemon.stop().catch(() => {});
}

test("daemon: startup scan uploads, reconciles, and reflects CouchDB files", async () => {
    await using workDir = await TempDir.create("livesync-cli-daemon-startup");

    const couchdbUri = envOrDefault(["COUCHDB_URI", "hostname"], "http://127.0.0.1:5989").replace(/\/$/, "");
    const couchdbUser = envOrDefault(["COUCHDB_USER", "username"], "admin");
    const couchdbPassword = envOrDefault(["COUCHDB_PASSWORD", "password"], "testpassword");
    const dbPrefix = envOrDefault(["COUCHDB_DBNAME", "dbname"], "livesync-test-db-ci");
    const dbname = `${dbPrefix}-daemon-startup-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`.toLowerCase();

    const databaseA = workDir.join("database-a");
    const databaseB = workDir.join("database-b");
    const databaseC = workDir.join("database-c");
    const vaultA = workDir.join("vault-a");
    const vaultB = workDir.join("vault-b");
    const vaultC = workDir.join("vault-c");
    const settingsA = workDir.join("settings-a.json");
    const settingsB = workDir.join("settings-b.json");
    const settingsC = workDir.join("settings-c.json");

    await Promise.all([
        mkdir(databaseA, { recursive: true }),
        mkdir(databaseB, { recursive: true }),
        mkdir(databaseC, { recursive: true }),
        mkdir(vaultA, { recursive: true }),
        mkdir(vaultB, { recursive: true }),
        mkdir(vaultC, { recursive: true }),
    ]);

    const startupPath = "notes/present-before-start.md";
    const deletePath = "notes/deleted-while-stopped.md";
    const remoteOnlyPath = "notes/remote-only.md";
    const startupFileA = join(vaultA, startupPath);
    const deleteFileA = join(vaultA, deletePath);
    const startupFileB = join(vaultB, startupPath);
    const deleteFileB = join(vaultB, deletePath);
    const remoteOnlyFileB = join(vaultB, remoteOnlyPath);

    await mkdir(join(vaultA, "notes"), { recursive: true });
    await writeFile(startupFileA, "created before daemon startup\n");
    const initialTime = new Date(Date.now() - 10_000);
    await utimes(startupFileA, initialTime, initialTime);
    await writeFile(deleteFileA, "delete this after the first run\n");

    let daemonA: BackgroundCliProcess | undefined;
    let daemonB: BackgroundCliProcess | undefined;
    try {
        await startCouchdb(couchdbUri, couchdbUser, couchdbPassword, dbname);
        for (const settings of [settingsA, settingsB, settingsC]) {
            await initSettingsFile(settings);
            await applyCouchdbSettings(settings, couchdbUri, couchdbUser, couchdbPassword, dbname, true);
        }

        // A pre-existing local file must be uploaded by the daemon's startup scan.
        daemonA = startCliInBackground(databaseA, "--vault", vaultA, "--settings", settingsA, "daemon");
        await daemonA.waitUntilContains("[Daemon] Initial replication complete", 45_000);

        // A separate daemon proves that the first startup replication reached CouchDB
        // and that remote files are reflected into its filesystem.
        daemonB = startCliInBackground(databaseB, "--vault", vaultB, "--settings", settingsB, "daemon");
        await daemonB.waitUntilContains("[Daemon] Initial replication complete", 45_000);
        await waitForText(startupFileB, "created before daemon startup\n");
        await waitForText(deleteFileB, "delete this after the first run\n");

        // Changes made while A is stopped must be found by its next startup scan.
        assert.deepStrictEqual(await daemonA.stop(), 0, daemonA.combined);
        daemonA = undefined;
        await writeFile(startupFileA, "edited while daemon was stopped\n");
        await unlink(deleteFileA);

        daemonA = startCliInBackground(databaseA, "--vault", vaultA, "--settings", settingsA, "daemon");
        await daemonA.waitUntilContains("[Daemon] Initial replication complete", 45_000);
        await waitForText(startupFileB, "edited while daemon was stopped\n");
        await waitForMissing(deleteFileB);

        // Seed a file into a third local database without creating it in vault C.
        // After C's finite sync, it exists only remotely from B's point of view.
        await runCliWithInputOrFail(
            "created in a different local database\n",
            databaseC,
            "--vault",
            vaultC,
            "--settings",
            settingsC,
            "put",
            remoteOnlyPath
        );
        await runCliOrFail(databaseC, "--vault", vaultC, "--settings", settingsC, "sync");
        await waitForText(remoteOnlyFileB, "created in a different local database\n");
        assert.deepStrictEqual(await readFile(startupFileB, "utf8"), "edited while daemon was stopped\n");
        assert.deepStrictEqual(((await stat(remoteOnlyFileB))).isFile(), true);
    } finally {
        await stopDaemon(daemonB);
        await stopDaemon(daemonA);
        await stopCouchdb().catch(() => {});
    }
});
