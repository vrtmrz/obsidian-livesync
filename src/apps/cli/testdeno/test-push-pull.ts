/**
 * Deno port of test-push-pull-linux.sh
 *
 * Requires CouchDB connection details either via environment variables or a
 * .test.env file.  If neither is present the test logs a warning and the
 * CLI will likely fail at the push step.
 *
 * Run:
 *   deno test -A test-push-pull.ts
 *
 * With explicit CouchDB:
 *   COUCHDB_URI=http://127.0.0.1:5984 \
 *   COUCHDB_USER=admin \
 *   COUCHDB_PASSWORD=password \
 *   COUCHDB_DBNAME=livesync-test \
 *   deno test -A test-push-pull.ts
 */

import { join } from "@std/path";
import { assertEquals } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { runCliOrFail } from "./helpers/cli.ts";
import { applyCouchdbSettings, initSettingsFile } from "./helpers/settings.ts";

const REMOTE_PATH = Deno.env.get("REMOTE_PATH") ?? "test/push-pull.txt";

Deno.test("push/pull roundtrip", async () => {
    await using workDir = await TempDir.create("livesync-cli-push-pull");

    const settingsFile = workDir.join("data.json");
    const vaultDir = workDir.join("vault");
    await Deno.mkdir(join(vaultDir, "test"), { recursive: true });

    await initSettingsFile(settingsFile);

    const uri = Deno.env.get("COUCHDB_URI") ?? "";
    const user = Deno.env.get("COUCHDB_USER") ?? "";
    const password = Deno.env.get("COUCHDB_PASSWORD") ?? "";
    const dbname = Deno.env.get("COUCHDB_DBNAME") ?? "";

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
    await Deno.writeTextFile(srcFile, content);

    console.log(`[INFO] push -> ${REMOTE_PATH}`);
    await runCliOrFail(vaultDir, "--settings", settingsFile, "push", srcFile, REMOTE_PATH);

    console.log(`[INFO] pull <- ${REMOTE_PATH}`);
    await runCliOrFail(vaultDir, "--settings", settingsFile, "pull", REMOTE_PATH, pulledFile);

    const pulled = await Deno.readTextFile(pulledFile);
    assertEquals(content, pulled, "push/pull roundtrip content mismatch");
    console.log("[PASS] push/pull roundtrip matched");
});
