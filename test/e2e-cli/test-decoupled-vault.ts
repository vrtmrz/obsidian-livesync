/**
 * Node.js port of test-decoupled-vault-linux.sh
 *
 * Tests push, pull, and mirror command behaviour when the vault directory is
 * decoupled (separated) from the database directory.
 *
 * Run:
 *   node --test test-decoupled-vault.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";

import { join } from "node:path";
import { TempDir } from "./helpers/temp.ts";
import { runCliOrFail } from "./helpers/cli.ts";
import { applyCouchdbSettings, initSettingsFile, markSettingsConfigured } from "./helpers/settings.ts";
import { startCouchdb, stopCouchdb } from "./helpers/docker.ts";

const REMOTE_PATH = process.env["REMOTE_PATH"] ?? "test/push-pull-decoupled.txt";

test("decoupled database and vault", async () => {
    await using workDir = await TempDir.create("livesync-cli-decoupled");

    const settingsFile = workDir.join("data.json");
    const vaultDir = workDir.join("vault");
    const dbDir = workDir.join("db");

    await mkdir(join(vaultDir, "test"), { recursive: true });
    await mkdir(dbDir, { recursive: true });

    const uri = process.env["COUCHDB_URI"] ?? "http://127.0.0.1:5989/";
    const user = process.env["COUCHDB_USER"] ?? "admin";
    const password = process.env["COUCHDB_PASSWORD"] ?? "testpassword";
    const dbname = process.env["COUCHDB_DBNAME"] ?? `decoupled-${Date.now()}`;

    const shouldStartDocker = process.env["LIVESYNC_START_DOCKER"] !== "0";
    const keepDocker = process.env["LIVESYNC_DEBUG_KEEP_DOCKER"] === "1";

    if (shouldStartDocker) {
        await startCouchdb(uri, user, password, dbname);
    }

    try {
        await initSettingsFile(settingsFile);

        if (uri && user && password && dbname) {
            console.log("[INFO] applying CouchDB environment variables to settings");
            await applyCouchdbSettings(settingsFile, uri, user, password, dbname);
        } else {
            console.warn("[WARN] CouchDB environment variables are not fully set. Push and pull operations may fail.");
            await markSettingsConfigured(settingsFile);
        }

        const srcFile = workDir.join("push-source.txt");
        const pulledFile = workDir.join("pull-result.txt");
        const content = `push-pull-decoupled-test ${new Date().toISOString()}\n`;
        await writeFile(srcFile, content);

        // 1. Test push command with decoupled vault directory
        console.log(`[INFO] push with decoupled vault -> ${REMOTE_PATH}`);
        await runCliOrFail(dbDir, "--vault", vaultDir, "--settings", settingsFile, "push", srcFile, REMOTE_PATH);

        // 2. Test pull command with decoupled vault directory
        console.log(`[INFO] pull with decoupled vault <- ${REMOTE_PATH}`);
        await runCliOrFail(dbDir, "--vault", vaultDir, "--settings", settingsFile, "pull", REMOTE_PATH, pulledFile);

        const pulled = await readFile(pulledFile, "utf8");
        assert.deepStrictEqual(pulled, content, "push/pull roundtrip with decoupled vault content mismatch");
        console.log("[PASS] push/pull roundtrip with decoupled vault matched");

        // 3. Clean up pulled file and vault test directory to verify mirror
        await unlink(pulledFile).catch(() => {});
        await rm(join(vaultDir, "test"), { recursive: true }).catch(() => {});

        // 4. Test mirror command with decoupled vault directory
        console.log("[INFO] mirror with decoupled vault");
        await runCliOrFail(dbDir, "--vault", vaultDir, "--settings", settingsFile, "mirror");

        const restoredFile = join(vaultDir, REMOTE_PATH);
        const restored = await readFile(restoredFile, "utf8");
        assert.deepStrictEqual(restored, content, "mirror with decoupled vault content mismatch");
        console.log("[PASS] mirror with decoupled vault matched");
    } finally {
        if (shouldStartDocker && !keepDocker) {
            await stopCouchdb().catch(() => {});
        }
    }
});
