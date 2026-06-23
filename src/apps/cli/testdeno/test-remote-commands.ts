/**
 * Deno port of test-remote-commands-linux.sh
 *
 * Tests remote management commands: remote-status, lock-remote, unlock-remote,
 * and mark-resolved.
 *
 * Scenario:
 *   1. Start CouchDB, create a test database, and perform an initial sync.
 *   2. Run remote-status and assert that the output contains the database name in JSON format.
 *   3. Run lock-remote and verify that the remote database is locked.
 *   4. Lock the remote database milestone manually, verify status, and run unlock-remote.
 *      Assert that the output of unlock-remote contains the unlocked verification status.
 *   5. Lock the remote database milestone manually, run mark-resolved, and verify that the
 *      current device is accepted.
 *
 * Run:
 *   deno test -A test-remote-commands.ts
 */

import { join } from "@std/path";
import { TempDir } from "./helpers/temp.ts";
import { runCli, assertContains } from "./helpers/cli.ts";
import { applyCouchdbSettings, initSettingsFile } from "./helpers/settings.ts";
import { startCouchdb, stopCouchdb, updateCouchdbDoc } from "./helpers/docker.ts";

async function runCliCombinedOrFail(...args: string[]): Promise<string> {
    const res = await runCli(...args);
    if (res.code !== 0) {
        throw new Error(`CLI exited with code ${res.code}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    }
    return res.combined;
}

Deno.test("remote management commands", async () => {
    await using workDir = await TempDir.create("livesync-cli-remote-cmds");

    const settingsFile = workDir.join("settings.json");
    const vaultDir = workDir.join("vault");
    await Deno.mkdir(vaultDir, { recursive: true });

    const uri = Deno.env.get("COUCHDB_URI") ?? "http://127.0.0.1:5989/";
    const user = Deno.env.get("COUCHDB_USER") ?? "admin";
    const password = Deno.env.get("COUCHDB_PASSWORD") ?? "testpassword";
    const dbSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const dbname = Deno.env.get("COUCHDB_DBNAME") ?? `remotes-${dbSuffix}`;

    const shouldStartDocker = Deno.env.get("LIVESYNC_START_DOCKER") !== "0";
    const keepDocker = Deno.env.get("LIVESYNC_DEBUG_KEEP_DOCKER") === "1";

    if (shouldStartDocker) {
        await startCouchdb(uri, user, password, dbname);
    }

    try {
        await initSettingsFile(settingsFile);
        await applyCouchdbSettings(settingsFile, uri, user, password, dbname, true);

        console.log("[INFO] Performing initial sync to create milestone document...");
        await runCliCombinedOrFail(vaultDir, "--settings", settingsFile, "sync");

        // 1. remote-status outputs valid JSON with CouchDB details
        console.log("[CASE] remote-status outputs valid JSON with CouchDB details");
        const statusOutput = await runCliCombinedOrFail(vaultDir, "--settings", settingsFile, "remote-status");
        assertContains(statusOutput, `"db_name": "${dbname}"`, "remote-status should return JSON containing db_name");
        console.log("[PASS] remote-status verified");

        // 2. lock-remote locks and verifies state
        console.log("[CASE] lock-remote locks and verifies state");
        const lockOutput = await runCliCombinedOrFail(vaultDir, "--settings", settingsFile, "lock-remote");
        assertContains(
            lockOutput,
            "[Verification] Remote Database: LOCKED",
            "lock-remote output should show that the remote database is locked"
        );
        console.log("[PASS] lock-remote verified");

        // 3. unlock-remote unlocks and verifies state
        console.log("[CASE] unlock-remote unlocks and verifies state");
        // Manually lock milestone
        console.log("[INFO] Manually locking milestone...");
        await updateCouchdbDoc(uri, user, password, `${dbname}/_local/obsydian_livesync_milestone`, (doc) => {
            doc.locked = true;
            doc.accepted_nodes = [];
            return doc;
        });

        // Run unlock-remote and verify output contains verification message
        const unlockOutput = await runCliCombinedOrFail(vaultDir, "--settings", settingsFile, "unlock-remote");
        assertContains(
            unlockOutput,
            "[Verification] Remote Database: UNLOCKED",
            "unlock-remote output should contain verification status"
        );
        console.log("[PASS] unlock-remote verified");

        // 4. mark-resolved resolves and verifies state
        console.log("[CASE] mark-resolved resolves and verifies state");
        // Manually lock milestone
        console.log("[INFO] Manually locking milestone...");
        await updateCouchdbDoc(uri, user, password, `${dbname}/_local/obsydian_livesync_milestone`, (doc) => {
            doc.locked = true;
            doc.accepted_nodes = [];
            return doc;
        });

        // Run mark-resolved and verify output contains verification messages
        const resolvedOutput = await runCliCombinedOrFail(vaultDir, "--settings", settingsFile, "mark-resolved");
        assertContains(
            resolvedOutput,
            "[Verification] Remote Database: LOCKED",
            "mark-resolved output should show that the remote database remains locked"
        );
        assertContains(
            resolvedOutput,
            "ACCEPTED",
            "mark-resolved output should show that the current device node is accepted"
        );
        console.log("[PASS] mark-resolved verified");

        console.log("[ALL PASS] All remote CLI commands verified successfully");
    } finally {
        if (shouldStartDocker && !keepDocker) {
            await stopCouchdb().catch(() => {});
        }
    }
});
