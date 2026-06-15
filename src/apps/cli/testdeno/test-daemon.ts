/**
 * Deno port of test-daemon-linux.sh
 *
 * Tests daemon-related ignore rules behaviour.
 *
 * Tests that are runnable without a long-running daemon process are exercised
 * here using the 'mirror' command, which calls the same 'isTargetFile' handler
 * stack that the daemon uses.
 *
 * Covered cases:
 *   1. .livesync/ignore with *.tmp pattern  → ignored file is not synced to database
 *   2. .livesync/ignore missing             → no error, and normal synchronisation continues
 *   3. import: .gitignore directive         → patterns from .gitignore are merged
 *
 * Run:
 *   deno test -A test-daemon.ts
 */

import { join } from "@std/path";
import { assertEquals } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { runCliOrFail, runCli, assertContains, assertNotContains } from "./helpers/cli.ts";
import { initSettingsFile, markSettingsConfigured } from "./helpers/settings.ts";

Deno.test("daemon: ignore rules behaviour", async (t) => {
    // -------------------------------------------------------------------------
    // Case 1: .livesync/ignore with *.tmp → ignored file not synced to database
    // -------------------------------------------------------------------------
    await t.step("case 1: .livesync/ignore *.tmp prevents sync", async () => {
        await using workDir = await TempDir.create("livesync-cli-daemon-c1");
        const settingsFile = workDir.join("data.json");
        const vaultDir = workDir.join("vault");

        await Deno.mkdir(join(vaultDir, ".livesync"), { recursive: true });
        await Deno.mkdir(join(vaultDir, "notes"), { recursive: true });

        await initSettingsFile(settingsFile);
        await markSettingsConfigured(settingsFile);

        await Deno.writeTextFile(join(vaultDir, ".livesync", "ignore"), "*.tmp\n");
        await Deno.writeTextFile(join(vaultDir, "notes", "normal.md"), "normal content\n");
        await Deno.writeTextFile(join(vaultDir, "notes", "scratch.tmp"), "tmp content\n");

        console.log("[INFO] Running mirror for Case 1...");
        await runCliOrFail(vaultDir, "--settings", settingsFile, "mirror");

        // The normal file should be in the database.
        const resultNormal = workDir.join("case1-normal.txt");
        await runCliOrFail(vaultDir, "--settings", settingsFile, "pull", "notes/normal.md", resultNormal);
        const normalContent = await Deno.readTextFile(resultNormal);
        assertEquals(normalContent, "normal content\n", "normal.md content mismatch after mirror");

        // The .tmp file should NOT be in the database.
        const dbList = await runCliOrFail(vaultDir, "--settings", settingsFile, "ls");
        assertNotContains(dbList, "scratch.tmp", "scratch.tmp (ignored) was unexpectedly synced to database");
        assertContains(dbList, "normal.md", "normal.md was not found in database after mirror");
        console.log("[PASS] Case 1 verified successfully");
    });

    // -------------------------------------------------------------------------
    // Case 2: .livesync/ignore absent → no error, and normal synchronisation continues
    // -------------------------------------------------------------------------
    await t.step("case 2: .livesync/ignore absent does not cause failure", async () => {
        await using workDir = await TempDir.create("livesync-cli-daemon-c2");
        const settingsFile = workDir.join("data2.json");
        const vaultDir = workDir.join("vault2");

        await Deno.mkdir(join(vaultDir, "notes"), { recursive: true });

        await initSettingsFile(settingsFile);
        await markSettingsConfigured(settingsFile);

        // No .livesync directory at all.
        await Deno.writeTextFile(join(vaultDir, "notes", "hello.md"), "hello\n");

        console.log("[INFO] Running mirror for Case 2...");
        const result = await runCli(vaultDir, "--settings", settingsFile, "mirror");
        assertEquals(result.code, 0, "mirror exited non-zero when .livesync/ignore is absent");

        // The normal file should have been synced.
        const resultHello = workDir.join("case2-hello.txt");
        await runCliOrFail(vaultDir, "--settings", settingsFile, "pull", "notes/hello.md", resultHello);
        const helloContent = await Deno.readTextFile(resultHello);
        assertEquals(helloContent, "hello\n", "file content mismatch when .livesync/ignore is absent");
        console.log("[PASS] Case 2 verified successfully");
    });

    // -------------------------------------------------------------------------
    // Case 3: import: .gitignore merges patterns
    // -------------------------------------------------------------------------
    await t.step("case 3: import: .gitignore directive merges patterns", async () => {
        await using workDir = await TempDir.create("livesync-cli-daemon-c3");
        const settingsFile = workDir.join("data3.json");
        const vaultDir = workDir.join("vault3");

        await Deno.mkdir(join(vaultDir, ".livesync"), { recursive: true });
        await Deno.mkdir(join(vaultDir, "notes"), { recursive: true });

        await initSettingsFile(settingsFile);
        await markSettingsConfigured(settingsFile);

        await Deno.writeTextFile(join(vaultDir, ".livesync", "ignore"), "import: .gitignore\n");
        await Deno.writeTextFile(join(vaultDir, ".gitignore"), "# gitignore comment\n*.log\nbuild/\n");

        await Deno.writeTextFile(join(vaultDir, "notes", "regular.md"), "regular note\n");
        await Deno.writeTextFile(join(vaultDir, "notes", "debug.log"), "log content\n");

        console.log("[INFO] Running mirror for Case 3...");
        await runCliOrFail(vaultDir, "--settings", settingsFile, "mirror");

        const dbList = await runCliOrFail(vaultDir, "--settings", settingsFile, "ls");
        assertNotContains(
            dbList,
            "debug.log",
            "debug.log (ignored via .gitignore import) was unexpectedly synced to database"
        );
        assertContains(dbList, "regular.md", "regular.md was not synced normally alongside .gitignore import rules");
        console.log("[PASS] Case 3 verified successfully");
    });
});
