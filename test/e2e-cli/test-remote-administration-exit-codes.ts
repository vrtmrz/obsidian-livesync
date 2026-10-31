import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { TempDir } from "./helpers/temp.ts";
import { runCli } from "./helpers/cli.ts";
import { applyCouchdbSettings, applyP2pSettings, applyP2pTestTweaks, initSettingsFile } from "./helpers/settings.ts";

function assertStringIncludes(actual: string, expected: string, message?: string): void {
    assert.ok(actual.includes(expected), message ?? `Expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`);
}

async function prepareFixture(prefix: string) {
    const workDir = await TempDir.create(prefix);
    const settingsFile = workDir.join("settings.json");
    const databaseDir = workDir.join("database");
    await mkdir(databaseDir, { recursive: true });
    await initSettingsFile(settingsFile);
    return { workDir, settingsFile, databaseDir };
}

test("remote administration process exit policy distinguishes returned verification failure", async () => {
    const fixture = await prepareFixture("livesync-cli-remote-admin-exit");
    await using workDir = fixture.workDir;
    const { settingsFile, databaseDir } = fixture;

    await applyP2pSettings(
        settingsFile,
        "remote-admin-exit-room",
        "remote-admin-exit-passphrase",
        "remote-admin-exit-tests",
        "ws://127.0.0.1:1/",
        "~.*",
        "none"
    );
    await applyP2pTestTweaks(settingsFile, "remote-admin-exit-device", "remote-admin-exit-passphrase");

    const defaultFailure = await runCli(databaseDir, "--settings", settingsFile, "mark-resolved");
    assert.deepStrictEqual(defaultFailure.code, 1, defaultFailure.combined);
    assertStringIncludes(
        defaultFailure.combined,
        "[Verification] Remote administration is unavailable for this provider."
    );
    assertStringIncludes(defaultFailure.combined, "[Error] Command 'mark-resolved' failed");

    const compatibilitySuccess = await runCli(
        databaseDir,
        "--settings",
        settingsFile,
        "--compat-remote-admin-exit-zero",
        "mark-resolved"
    );
    assert.deepStrictEqual(compatibilitySuccess.code, 0, compatibilitySuccess.combined);
    assertStringIncludes(
        compatibilitySuccess.combined,
        "[Verification] Remote administration is unavailable for this provider."
    );
    assertStringIncludes(compatibilitySuccess.combined, "[Done] Command 'mark-resolved' completed");
});

test("remote administration compatibility does not hide a thrown mutation failure", async () => {
    const fixture = await prepareFixture("livesync-cli-remote-admin-mutation");
    await using workDir = fixture.workDir;
    const { settingsFile, databaseDir } = fixture;

    await applyCouchdbSettings(
        settingsFile,
        "http://127.0.0.1:1/",
        "unreachable-user",
        "unreachable-password",
        "unreachable-database"
    );

    const mutationFailure = await runCli(
        databaseDir,
        "--settings",
        settingsFile,
        "--compat-remote-admin-exit-zero",
        "mark-resolved"
    );
    assert.deepStrictEqual(mutationFailure.code, 1, mutationFailure.combined);
    assertStringIncludes(mutationFailure.combined, "[Command] mark-resolved");
    assertStringIncludes(mutationFailure.combined, "[Error] Failed to start:");
});
