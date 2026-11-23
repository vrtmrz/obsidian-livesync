import assert from "node:assert/strict";
import { mkdir, readFile, readdir, realpath, rename, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { BackgroundCliProcess } from "./helpers/backgroundCli.ts";
import { CLI_DIR, CLI_DIST, runCli, runCliOrFail } from "./helpers/cli.ts";
import { spawnProcess } from "./helpers/process.ts";
import { initSettingsFile } from "./helpers/settings.ts";
import { TempDir } from "./helpers/temp.ts";

const committed = JSON.stringify([{ type: "SENTINEL_FLUSH" }]);
const restoreHeld = "[Snapshot fixture] Committed snapshot read; holding restore";

const preload = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const target = process.env.LIVESYNC_TEST_SNAPSHOT;
const mode = process.env.LIVESYNC_TEST_SNAPSHOT_MODE;
const readFile = fs.promises.readFile;
fs.promises.readFile = async function (path, ...options) {
    const bytes = await readFile.call(this, path, ...options);
    if (path !== target) return bytes;
    if (mode === "unwritable") {
        // Prevent the final atomic replacement after the real snapshot has been read.
        fs.renameSync(target, target + ".committed");
        fs.mkdirSync(target);
    } else {
        process.stdout.write(${JSON.stringify(restoreHeld + "\n")});
        await new Promise(() => setInterval(() => {}, 1000));
    }
    return bytes;
};
syncBuiltinESMExports();
`;

async function prepare(work: TempDir) {
    const database = work.join("database");
    const vault = work.join("vault");
    const settings = work.join("settings.json");
    await Promise.all([mkdir(database), mkdir(vault)]);
    await initSettingsFile(settings);
    const data = JSON.parse(await readFile(settings, "utf8"));
    await writeFile(
        settings,
        JSON.stringify({
            ...data,
            isConfigured: true,
            liveSync: false,
            syncOnStart: false,
            syncOnSave: false,
            periodicReplication: false,
        })
    );
    const args = ["-d", database, "--vault", vault, "--settings", settings, "mirror"];
    await runCliOrFail(...args);
    const scopes = join(database, ".livesync", "runtime", "scopes");
    const keyValueFiles = (await readdir(scopes, { recursive: true })).filter((path) =>
        path.endsWith("keyvalue-db.json")
    );
    assert.equal(keyValueFiles.length, 1, "The test Vault must own a single runtime scope");
    const directory = await realpath(dirname(join(scopes, keyValueFiles[0])));
    const snapshot = join(directory, "storage-events.json");
    const preloadFile = work.join("snapshot-fixture.mjs");
    await writeFile(preloadFile, preload);
    return { args, directory, snapshot, preloadFile };
}

function startWithFixture(
    fixture: Awaited<ReturnType<typeof prepare>>,
    mode: "unwritable" | "hold"
): BackgroundCliProcess {
    const child = spawnProcess(process.execPath, {
        args: ["--import", fixture.preloadFile, CLI_DIST, ...fixture.args],
        cwd: CLI_DIR,
        env: {
            LIVESYNC_TEST_SNAPSHOT: fixture.snapshot,
            LIVESYNC_TEST_SNAPSHOT_MODE: mode,
        },
    });
    return new BackgroundCliProcess(child, fixture.args);
}

async function waitForExit(process: BackgroundCliProcess) {
    const timeout = new AbortController();
    try {
        return await Promise.race([
            process.waitForExit(),
            delay(10_000, undefined, { signal: timeout.signal }).then(() => {
                throw new Error(`CLI did not exit\n${process.combined}`);
            }),
        ]);
    } finally {
        timeout.abort();
    }
}

test("CLI reports corrupt and unwritable snapshots and retains the previous contents", async () => {
    await using work = await TempDir.create("livesync-cli-snapshot-errors");
    const fixture = await prepare(work);

    for (const [contents, diagnostic] of [
        ["[invalid", /SyntaxError/],
        ['{"type":"SENTINEL_FLUSH"}', /The CLI storage-event snapshot must be an array/],
    ] as const) {
        await writeFile(fixture.snapshot, contents);
        const outcome = await runCli(...fixture.args);
        assert.equal(outcome.code, 1, outcome.combined);
        assert.match(outcome.stderr, /\[Error\] Failed to start/);
        assert.match(outcome.stderr, diagnostic);
        assert.equal(await readFile(fixture.snapshot, "utf8"), contents);
    }

    await writeFile(fixture.snapshot, committed);
    const cli = startWithFixture(fixture, "unwritable");
    try {
        const outcome = await waitForExit(cli);
        assert.equal(outcome.signal, null, cli.combined);
        assert.match(cli.stderr, /Failed to save snapshot/);
        assert.match(cli.stderr, /EISDIR|ENOTEMPTY|EEXIST|EPERM|EACCES/);
        assert.match(cli.stderr, /Storage operation remains pending after a failure/);
        assert.equal(await readFile(fixture.snapshot + ".committed", "utf8"), committed);
        assert.deepEqual(await readdir(fixture.snapshot), []);
        assert.equal(
            (await readdir(fixture.directory)).some((path) => path.endsWith(".tmp")),
            false
        );
    } finally {
        cli.child.kill("SIGKILL");
        await cli.waitForExit();
    }

    await rmdir(fixture.snapshot);
    await rename(fixture.snapshot + ".committed", fixture.snapshot);
    await runCliOrFail(...fixture.args);
    assert.deepEqual(JSON.parse(await readFile(fixture.snapshot, "utf8")), []);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    test(
        `CLI ${signal} joins unload and preserves a snapshot while start-up replay is held`,
        {
            skip: process.platform === "win32" && "Requires delivery of POSIX signals to the CLI subprocess",
        },
        async () => {
            await using work = await TempDir.create("livesync-cli-snapshot-shutdown");
            const fixture = await prepare(work);
            await writeFile(fixture.snapshot, committed);
            const cli = startWithFixture(fixture, "hold");
            try {
                await cli.waitUntilContains(restoreHeld, 10_000);
                cli.child.kill(signal);
                const outcome = await waitForExit(cli);
                assert.equal(outcome.code, 0, cli.combined);
                assert.equal(outcome.signal, null);
                assert.equal(cli.stdout.split(`[Shutdown] Received ${signal}`).length - 1, 1, cli.combined);
                assert.equal(cli.stdout.split("[Shutdown] Complete").length - 1, 1, cli.combined);
                assert.equal(cli.stderr.split("[ControlService]").length - 1, 1, cli.combined);
                assert.doesNotMatch(cli.combined, /\[Shutdown\] Error:|\[Command\] mirror/);
                assert.equal(await readFile(fixture.snapshot, "utf8"), committed);
            } finally {
                cli.child.kill("SIGKILL");
                await cli.waitForExit();
            }

            await runCliOrFail(...fixture.args);
            assert.deepEqual(JSON.parse(await readFile(fixture.snapshot, "utf8")), []);
        }
    );
}
