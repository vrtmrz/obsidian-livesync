/**
 * Deno port of test-sync-locked-remote-linux.sh
 *
 * Verifies CLI sync behaviour when the remote milestone document is unlocked
 * versus locked.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { runCli } from "./helpers/cli.ts";
import { applyCouchdbSettings, initSettingsFile } from "./helpers/settings.ts";
import { createCouchdbDatabase, startCouchdb, stopCouchdb, updateCouchdbDoc } from "./helpers/docker.ts";

const MILESTONE_DOC = "_local/obsydian_livesync_milestone";

function requireEnv(...keys: string[]): string {
    for (const key of keys) {
        const value = Deno.env.get(key)?.trim();
        if (value) return value;
    }
    throw new Error(`Required env var is missing: ${keys.join(" or ")}`);
}

Deno.test("sync: actionable error against locked remote DB", async () => {
    const couchdbUri = requireEnv("COUCHDB_URI", "hostname").replace(/\/$/, "");
    const couchdbUser = requireEnv("COUCHDB_USER", "username");
    const couchdbPassword = requireEnv("COUCHDB_PASSWORD", "password");
    const dbPrefix = requireEnv("COUCHDB_DBNAME", "dbname");
    const dbname = `${dbPrefix}-locked-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    await using workDir = await TempDir.create("livesync-cli-locked-test");
    const vaultDir = workDir.join("vault");
    const settingsFile = workDir.join("settings.json");
    await Deno.mkdir(vaultDir, { recursive: true });

    const shouldStartDocker = Deno.env.get("LIVESYNC_START_DOCKER") !== "0";
    const keepDocker = Deno.env.get("LIVESYNC_DEBUG_KEEP_DOCKER") === "1";

    if (shouldStartDocker) {
        console.log(`[INFO] starting CouchDB and creating test database: ${dbname}`);
        await startCouchdb(couchdbUri, couchdbUser, couchdbPassword, dbname);
    } else {
        console.log(`[INFO] using existing CouchDB and creating test database: ${dbname}`);
        await createCouchdbDatabase(couchdbUri, couchdbUser, couchdbPassword, dbname);
    }

    try {
        await initSettingsFile(settingsFile);
        await applyCouchdbSettings(settingsFile, couchdbUri, couchdbUser, couchdbPassword, dbname, true);

        console.log("[CASE] initial sync to create milestone document");
        const initialSync = await runCli(vaultDir, "--settings", settingsFile, "sync");
        assert(
            initialSync.code === 0,
            `initial sync failed\nstdout: ${initialSync.stdout}\nstderr: ${initialSync.stderr}`
        );

        const updateMilestone = async (locked: boolean) => {
            await updateCouchdbDoc(couchdbUri, couchdbUser, couchdbPassword, `${dbname}/${MILESTONE_DOC}`, (doc) => ({
                ...doc,
                locked,
                accepted_nodes: [],
            }));
        };

        console.log("[CASE] sync should succeed when remote is not locked");
        await updateMilestone(false);
        const unlockedSync = await runCli(vaultDir, "--settings", settingsFile, "sync");
        assert(
            unlockedSync.code === 0,
            `sync should succeed when remote is not locked\nstdout: ${unlockedSync.stdout}\nstderr: ${unlockedSync.stderr}`
        );
        assert(
            !unlockedSync.combined.includes("The remote database is locked"),
            `locked error should not appear when remote is not locked\n${unlockedSync.combined}`
        );
        console.log("[PASS] unlocked remote DB syncs successfully");

        console.log("[CASE] sync should fail with actionable error when remote is locked");
        await updateMilestone(true);
        const lockedSync = await runCli(vaultDir, "--settings", settingsFile, "sync");
        assert(
            lockedSync.code !== 0,
            `sync should fail when remote is locked\nstdout: ${lockedSync.stdout}\nstderr: ${lockedSync.stderr}`
        );
        assertStringIncludes(lockedSync.combined, "The remote database is locked and this device is not yet accepted");
        console.log("[PASS] locked remote DB produces actionable CLI error");
    } finally {
        if (shouldStartDocker && !keepDocker) {
            await stopCouchdb().catch(() => {});
        }
    }
});
