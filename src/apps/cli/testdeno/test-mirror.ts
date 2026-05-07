/**
 * Deno port of test-mirror-linux.sh
 *
 * Tests the `mirror` command — bidirectional synchronisation between a local
 * storage directory (vault) and an in-process database.
 *
 * Covered cases (identical to the bash test):
 *   1. Storage-only file   -> synced into DB            (UPDATE DATABASE)
 *   2. DB-only file        -> restored to storage       (UPDATE STORAGE)
 *   3. DB-deleted file     -> NOT restored to storage   (UPDATE STORAGE skip)
 *   4. Both, storage newer -> DB updated                (SYNC: STORAGE -> DB)
 *   5. Both, DB newer      -> storage updated           (SYNC: DB -> STORAGE)
 *   6. Compatibility mode  -> omitted vault-path works  (same DB + vault path)
 *
 * No external services are required.
 *
 * Run:
 *   deno test -A test-mirror.ts
 */

import { assert } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { runCliOrFail } from "./helpers/cli.ts";
import { initSettingsFile, markSettingsConfigured } from "./helpers/settings.ts";

Deno.test("mirror: storage <-> DB synchronisation", async (t) => {
    await using workDir = await TempDir.create("livesync-cli-mirror");

    // -------------------------------------------------------------------
    // Shared setup
    // -------------------------------------------------------------------
    const settingsFile = workDir.join("data.json");
    const vaultDir = workDir.join("vault");
    const dbDir = workDir.join("db");
    await Deno.mkdir(workDir.join("vault", "test"), { recursive: true });
    await Deno.mkdir(dbDir, { recursive: true });

    await initSettingsFile(settingsFile);
    // isConfigured=true is required for canProceedScan in the mirror command.
    await markSettingsConfigured(settingsFile);

    // Copy settings to the DB directory (separated-path mode)
    const dbSettings = workDir.join("db", "settings.json");
    await Deno.copyFile(settingsFile, dbSettings);

    /** Run mirror in separated-path mode: DB dir ≠ vault dir. */
    const runMirror = () => runCliOrFail(dbDir, "--settings", dbSettings, "mirror", vaultDir);

    /** Run mirror in compatibility mode: DB path = vault path. */
    const runMirrorCompat = () => runCliOrFail(vaultDir, "--settings", settingsFile, "mirror");

    // Helper wrappers
    const dbRun = (...args: string[]) => runCliOrFail(dbDir, "--settings", dbSettings, ...args);
    const compatRun = (...args: string[]) => runCliOrFail(vaultDir, "--settings", settingsFile, ...args);

    // -------------------------------------------------------------------
    // Case 1: storage-only -> DB (UPDATE DATABASE)
    // -------------------------------------------------------------------
    await t.step("case 1: storage-only file is synced into DB", async () => {
        const storageFile = workDir.join("vault", "test", "storage-only.md");
        await Deno.writeTextFile(storageFile, "storage-only content\n");

        await runMirror();

        const resultFile = workDir.join("case1-pull.txt");
        await dbRun("pull", "test/storage-only.md", resultFile);

        const storageContent = await Deno.readTextFile(storageFile);
        const pulledContent = await Deno.readTextFile(resultFile);
        assert(
            storageContent === pulledContent,
            `storage-only file NOT synced into DB\nexpected: ${storageContent}\ngot: ${pulledContent}`
        );
        console.log("[PASS] case 1: storage-only file was synced into DB");
    });

    // -------------------------------------------------------------------
    // Case 2: DB-only -> storage (UPDATE STORAGE)
    // -------------------------------------------------------------------
    await t.step("case 2: DB-only file is restored to storage", async () => {
        await dbRun(
            "push",
            // write inline via push (pipe not needed — push takes a file path)
            // create a temp file with content and push it
            await (async () => {
                const tmp = workDir.join("db-only-src.txt");
                await Deno.writeTextFile(tmp, "db-only content\n");
                return tmp;
            })(),
            "test/db-only.md"
        );

        const storagePath = workDir.join("vault", "test", "db-only.md");
        assert(!(await exists(storagePath)), "db-only.md unexpectedly exists in storage before mirror");

        await runMirror();

        assert(await exists(storagePath), "DB-only file NOT restored to storage after mirror");
        const content = await Deno.readTextFile(storagePath);
        assert(content === "db-only content\n", `DB-only file restored but content mismatch: '${content}'`);
        console.log("[PASS] case 2: DB-only file was restored to storage");
    });

    // -------------------------------------------------------------------
    // Case 3: DB-deleted -> storage untouched
    // -------------------------------------------------------------------
    await t.step("case 3: DB-deleted entry is NOT restored to storage", async () => {
        const deletedSrc = workDir.join("deleted-src.txt");
        await Deno.writeTextFile(deletedSrc, "to-be-deleted\n");
        await dbRun("push", deletedSrc, "test/deleted.md");
        await dbRun("rm", "test/deleted.md");

        await runMirror();

        const storagePath = workDir.join("vault", "test", "deleted.md");
        assert(!(await exists(storagePath)), "deleted DB entry was incorrectly restored to storage");
        console.log("[PASS] case 3: deleted DB entry was NOT restored to storage");
    });

    // -------------------------------------------------------------------
    // Case 4: storage newer -> DB updated (SYNC: STORAGE -> DB)
    // -------------------------------------------------------------------
    await t.step("case 4: storage newer than DB -> DB is updated", async () => {
        // Seed DB with old content (mtime ~ now)
        const seedFile = workDir.join("case4-seed.txt");
        await Deno.writeTextFile(seedFile, "old content\n");
        await dbRun("push", seedFile, "test/sync-storage-newer.md");

        // Write new content to storage with a timestamp 1 hour in the future
        const storageFile = workDir.join("vault", "test", "sync-storage-newer.md");
        await Deno.writeTextFile(storageFile, "new content\n");
        await Deno.utime(storageFile, new Date(), new Date(Date.now() + 3600_000));

        await runMirror();

        const resultFile = workDir.join("case4-pull.txt");
        await dbRun("pull", "test/sync-storage-newer.md", resultFile);
        const storageContent = await Deno.readTextFile(storageFile);
        const pulledContent = await Deno.readTextFile(resultFile);
        assert(
            storageContent === pulledContent,
            `DB NOT updated to match newer storage file\nexpected: ${storageContent}\ngot: ${pulledContent}`
        );
        console.log("[PASS] case 4: DB updated to match newer storage file");
    });

    // -------------------------------------------------------------------
    // Case 5: DB newer -> storage updated (SYNC: DB -> STORAGE)
    // -------------------------------------------------------------------
    await t.step("case 5: DB newer than storage -> storage is updated", async () => {
        // Write old content to storage with a timestamp 1 hour in the past
        const storageFile = workDir.join("vault", "test", "sync-db-newer.md");
        await Deno.writeTextFile(storageFile, "old storage content\n");
        await Deno.utime(storageFile, new Date(), new Date(Date.now() - 3600_000));

        // Write new content to DB only (mtime ~ now, newer than the storage file)
        const dbNewFile = workDir.join("case5-db-new.txt");
        await Deno.writeTextFile(dbNewFile, "new db content\n");
        await dbRun("push", dbNewFile, "test/sync-db-newer.md");

        await runMirror();

        const content = await Deno.readTextFile(storageFile);
        assert(content === "new db content\n", `storage NOT updated to match newer DB entry (got: '${content}')`);
        console.log("[PASS] case 5: storage updated to match newer DB entry");
    });

    // -------------------------------------------------------------------
    // Case 6: compatibility mode (vault path = DB path)
    // -------------------------------------------------------------------
    await t.step("case 6: compatibility mode (omitted vault-path)", async () => {
        const compatFile = workDir.join("vault", "compat.md");
        await Deno.writeTextFile(compatFile, "compat-content\n");

        await runMirrorCompat();

        const resultFile = workDir.join("case6-pull.txt");
        await compatRun("pull", "compat.md", resultFile);
        const pulled = await Deno.readTextFile(resultFile);
        assert(pulled === "compat-content\n", `Compatibility mode failed to sync file into DB (got: '${pulled}')`);
        console.log("[PASS] case 6: compatibility mode works");
    });
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

async function exists(path: string): Promise<boolean> {
    try {
        await Deno.stat(path);
        return true;
    } catch {
        return false;
    }
}
