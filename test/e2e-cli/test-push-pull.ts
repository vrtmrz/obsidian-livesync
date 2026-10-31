/**
 * Node.js port of test-push-pull-linux.sh
 *
 * Requires CouchDB connection details either via environment variables or a
 * .test.env file.  If neither is present the test logs a warning and the
 * CLI will likely fail at the push step.
 *
 * Run:
 *   node --test test-push-pull.ts
 *
 * With explicit CouchDB:
 *   COUCHDB_URI=http://127.0.0.1:5984 \
 *   COUCHDB_USER=admin \
 *   COUCHDB_PASSWORD=password \
 *   COUCHDB_DBNAME=livesync-test \
 *   node --test test-push-pull.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { join } from "node:path";
import { TempDir } from "./helpers/temp.ts";
import { runCliOrFail } from "./helpers/cli.ts";
import { applyCouchdbSettings, initSettingsFile } from "./helpers/settings.ts";
import { startCouchdb, stopCouchdb } from "./helpers/docker.ts";

const REMOTE_PATH = process.env["REMOTE_PATH"] ?? "test/push-pull.txt";

test("push/pull roundtrip", async () => {
    await using workDir = await TempDir.create("livesync-cli-push-pull");

    const settingsFile = workDir.join("data.json");
    const vaultDir = workDir.join("vault");
    await mkdir(join(vaultDir, "test"), { recursive: true });

    const uri = process.env["COUCHDB_URI"] ?? "http://127.0.0.1:5989/";
    const user = process.env["COUCHDB_USER"] ?? "admin";
    const password = process.env["COUCHDB_PASSWORD"] ?? "testpassword";
    const dbname = process.env["COUCHDB_DBNAME"] ?? `push-pull-${Date.now()}`;

    const shouldStartDocker = process.env["LIVESYNC_START_DOCKER"] !== "0";
    const keepDocker = process.env["LIVESYNC_DEBUG_KEEP_DOCKER"] === "1";

    if (shouldStartDocker) {
        await startCouchdb(uri, user, password, dbname);
    }

    try {
        await initSettingsFile(settingsFile);

        if (uri && user && password && dbname) {
            console.log("[INFO] applying CouchDB env vars to settings");
            await applyCouchdbSettings(settingsFile, uri, user, password, dbname);
        } else {
            console.warn(
                "[WARN] CouchDB env vars not fully set — push/pull may fail unless the generated settings already contain connection details"
            );
        }

        const srcFile = workDir.join("push-source.txt");
        const pulledFile = workDir.join("pull-result.txt");
        const content = `push-pull-test ${new Date().toISOString()}\n`;
        await writeFile(srcFile, content);

        console.log(`[INFO] push -> ${REMOTE_PATH}`);
        await runCliOrFail(vaultDir, "--settings", settingsFile, "push", srcFile, REMOTE_PATH);

        console.log(`[INFO] pull <- ${REMOTE_PATH}`);
        await runCliOrFail(vaultDir, "--settings", settingsFile, "pull", REMOTE_PATH, pulledFile);

        const pulled = await readFile(pulledFile, "utf8");
        assert.deepStrictEqual(content, pulled, "push/pull roundtrip content mismatch");
        console.log("[PASS] push/pull roundtrip matched");
    } finally {
        if (shouldStartDocker && !keepDocker) {
            await stopCouchdb().catch(() => {});
        }
    }
});
