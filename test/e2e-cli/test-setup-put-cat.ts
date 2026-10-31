/**
 * Node.js port of test-setup-put-cat-linux.sh
 *
 * Tests all local-DB file operations that require no external remote:
 *   setup /
 *   push / cat / ls / info / rm / resolve / cat-rev / pull-rev
 *
 * Run (no external services needed):
 *   node --test test-setup-put-cat.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { join } from "node:path";
import { TempDir } from "./helpers/temp.ts";
import { runCli, runCliOrFail, runCliWithInput, sanitiseCatStdout } from "./helpers/cli.ts";
import { generateSetupUriFromSettings, initSettingsFile } from "./helpers/settings.ts";

const REMOTE_PATH = process.env["REMOTE_PATH"] ?? "test/setup-put-cat.txt";
const SETUP_PASSPHRASE = process.env["SETUP_PASSPHRASE"] ?? "setup-passphrase";

test("CLI file operations: push / cat / ls / info / rm / resolve / cat-rev / pull-rev", async (t) => {
    await using workDir = await TempDir.create("livesync-cli-setup-put-cat");

    const settingsFile = workDir.join("data.json");
    const vaultDir = workDir.join("vault");
    await mkdir(join(vaultDir, "test"), { recursive: true });

    await initSettingsFile(settingsFile);

    const setupUri = await generateSetupUriFromSettings(settingsFile, SETUP_PASSPHRASE);
    const setupResult = await runCliWithInput(
        `${SETUP_PASSPHRASE}\n`,
        vaultDir,
        "--settings",
        settingsFile,
        "setup",
        setupUri
    );
    assert(setupResult.code === 0, `setup command exited with ${setupResult.code}\n${setupResult.combined}`);
    assert(
        setupResult.combined.includes("[Command] setup ->"),
        `setup command did not execute expected code path\n${setupResult.combined}`
    );
    const persistedSetup = JSON.parse(await readFile(settingsFile, "utf8"));
    assert.deepStrictEqual(persistedSetup.isConfigured, true, "setup did not persist the configured state");
    assert(
        typeof persistedSetup.encryptedCouchDBConnection === "string" &&
            persistedSetup.encryptedCouchDBConnection.length > 0,
        "setup did not persist the encrypted connection settings"
    );

    const run = (...args: string[]) => runCliOrFail(vaultDir, "--settings", settingsFile, ...args);

    // ------------------------------------------------------------------
    // push / cat roundtrip
    // ------------------------------------------------------------------
    await t.test("push/cat roundtrip", async () => {
        const srcFile = workDir.join("put-source.txt");
        const content = `setup-put-cat-test ${new Date().toISOString()}\nline-2\n`;
        await writeFile(srcFile, content);

        console.log(`[INFO] push -> ${REMOTE_PATH}`);
        await runCliWithInput(content, vaultDir, "--settings", settingsFile, "put", REMOTE_PATH);

        console.log(`[INFO] cat <- ${REMOTE_PATH}`);
        const rawOutput = await run("cat", REMOTE_PATH);
        const catOutput = sanitiseCatStdout(rawOutput);

        assert.deepStrictEqual(content, catOutput, "push/cat roundtrip content mismatch");
        console.log("[PASS] push/cat roundtrip matched");
    });

    // ------------------------------------------------------------------
    // ls: single file
    // ------------------------------------------------------------------
    await t.test("ls output format (single file)", async () => {
        const lsOutput = await run("ls", REMOTE_PATH);
        const line = lsOutput
            .trim()
            .split("\n")
            .find((l) => l.startsWith(REMOTE_PATH + "\t"));
        assert(line, `ls output did not include ${REMOTE_PATH}`);

        const [lsPath, lsSize, lsMtime, lsRev] = line.split("\t");
        assert.deepStrictEqual(lsPath, REMOTE_PATH, "ls path column mismatch");
        assert(/^\d+$/.test(lsSize), `ls size not numeric: ${lsSize}`);
        assert(/^\d+$/.test(lsMtime), `ls mtime not numeric: ${lsMtime}`);
        assert(lsRev?.length > 0, "ls revision column is empty");
        console.log("[PASS] ls output format matched");
    });

    // ------------------------------------------------------------------
    // ls: prefix filter and sort order
    // ------------------------------------------------------------------
    await t.test("ls prefix filter and sort order", async () => {
        await runCliWithInput("file-a\n", vaultDir, "--settings", settingsFile, "put", "test/a-first.txt");
        await runCliWithInput("file-z\n", vaultDir, "--settings", settingsFile, "put", "test/z-last.txt");

        const lsOut = await run("ls", "test/");
        const lines = lsOut.trim().split("\n").filter(Boolean);
        assert(lines.length >= 3, "ls prefix output expected at least 3 rows");

        // Verify sorted ascending by path
        const paths = lines.map((l) => l.split("\t")[0]);
        for (let i = 1; i < paths.length; i++) {
            assert(paths[i - 1] <= paths[i], `ls output not sorted: ${paths[i - 1]} > ${paths[i]}`);
        }
        assert(
            lines.some((l) => l.startsWith("test/a-first.txt\t")),
            "ls prefix output missing test/a-first.txt"
        );
        assert(
            lines.some((l) => l.startsWith("test/z-last.txt\t")),
            "ls prefix output missing test/z-last.txt"
        );
        console.log("[PASS] ls prefix and sorting matched");
    });

    // ------------------------------------------------------------------
    // ls: no-match prefix returns empty output
    // ------------------------------------------------------------------
    await t.test("ls no-match prefix returns empty", async () => {
        const lsOut = await run("ls", "no-such-prefix/");
        assert.deepStrictEqual(lsOut.trim(), "", "ls no-match prefix should produce empty output");
        console.log("[PASS] ls no-match prefix matched");
    });

    // ------------------------------------------------------------------
    // info: JSON output format
    // ------------------------------------------------------------------
    await t.test("info output JSON format", async () => {
        const infoOut = await run("info", REMOTE_PATH);
        let data: Record<string, unknown>;
        try {
            data = JSON.parse(infoOut);
        } catch {
            throw new Error(`info output is not valid JSON:\n${infoOut}`);
        }
        assert.deepStrictEqual(data.path, REMOTE_PATH, "info .path mismatch");
        assert.deepStrictEqual(data.filename, REMOTE_PATH.split("/").at(-1), "info .filename mismatch");
        assert(typeof data.size === "number" && data.size >= 0, `info .size invalid: ${data.size}`);
        assert(typeof data.chunks === "number" && data.chunks >= 1, `info .chunks invalid: ${data.chunks}`);
        assert.deepStrictEqual(data.conflicts, "N/A", "info .conflicts should be N/A");
        console.log("[PASS] info output format matched");
    });

    // ------------------------------------------------------------------
    // info: non-existent path exits non-zero
    // ------------------------------------------------------------------
    await t.test("info non-existent path returns non-zero", async () => {
        const r = await runCli(vaultDir, "--settings", settingsFile, "info", "no-such-file.md");
        assert(r.code !== 0, "info on non-existent file should exit non-zero");
        console.log("[PASS] info non-existent path returns non-zero");
    });

    // ------------------------------------------------------------------
    // rm: removes file from ls and makes cat fail
    // ------------------------------------------------------------------
    await t.test("rm removes target from ls and cat", async () => {
        await run("rm", "test/z-last.txt");

        const catResult = await runCli(vaultDir, "--settings", settingsFile, "cat", "test/z-last.txt");
        assert(catResult.code !== 0, "rm target should not be readable by cat");

        const lsOut = await run("ls", "test/");
        assert(!lsOut.includes("test/z-last.txt\t"), "rm target should not appear in ls output");
        console.log("[PASS] rm removed target from visible entries");
    });

    // ------------------------------------------------------------------
    // resolve: accepts current revision, rejects invalid revision
    // ------------------------------------------------------------------
    await t.test("resolve: valid and invalid revisions", async () => {
        const lsLine = (await run("ls", "test/a-first.txt")).trim().split("\n")[0];
        assert(lsLine, "could not fetch revision for resolve test");
        const rev = lsLine.split("\t")[3];
        assert(rev?.length > 0, "revision was empty for resolve test");

        await run("resolve", "test/a-first.txt", rev);
        console.log("[PASS] resolve accepted current revision");

        const badR = await runCli(vaultDir, "--settings", settingsFile, "resolve", "test/a-first.txt", "9-no-such-rev");
        assert(badR.code !== 0, "resolve with non-existent revision should exit non-zero");
        console.log("[PASS] resolve non-existent revision returns non-zero");
    });

    // ------------------------------------------------------------------
    // cat-rev / pull-rev: retrieve a past revision
    // ------------------------------------------------------------------
    await t.test("cat-rev / pull-rev: retrieve past revision", async () => {
        const revPath = "test/revision-history.txt";
        await runCliWithInput("revision-v1\n", vaultDir, "--settings", settingsFile, "put", revPath);
        await runCliWithInput("revision-v2\n", vaultDir, "--settings", settingsFile, "put", revPath);
        await runCliWithInput("revision-v3\n", vaultDir, "--settings", settingsFile, "put", revPath);

        const infoOut = await run("info", revPath);
        const infoData = JSON.parse(infoOut) as {
            revisions?: string[];
        };
        const revisions = Array.isArray(infoData.revisions) ? infoData.revisions : [];
        const pastRev = revisions.find((r): r is string => typeof r === "string" && r !== "N/A");
        assert(pastRev, "info output did not include any past revision");

        const catRevOut = await run("cat-rev", revPath, pastRev);
        const catRevClean = sanitiseCatStdout(catRevOut);
        assert(
            catRevClean === "revision-v1\n" || catRevClean === "revision-v2\n",
            `cat-rev output did not match expected past revision:\n${catRevClean}`
        );
        console.log("[PASS] cat-rev matched one of the past revisions from info");

        const pullRevFile = workDir.join("rev-pull-output.txt");
        await run("pull-rev", revPath, pullRevFile, pastRev);
        const pullRevContent = await readFile(pullRevFile, "utf8");
        assert(
            pullRevContent === "revision-v1\n" || pullRevContent === "revision-v2\n",
            `pull-rev output did not match expected past revision:\n${pullRevContent}`
        );
        console.log("[PASS] pull-rev matched one of the past revisions from info");
    });
});
