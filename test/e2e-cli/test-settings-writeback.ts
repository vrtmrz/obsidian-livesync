import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { TempDir } from "./helpers/temp.ts";
import { runCli } from "./helpers/cli.ts";
import { initSettingsFile } from "./helpers/settings.ts";

async function prepareSettingsFixture(prefix: string) {
    const workDir = await TempDir.create(prefix);
    const settingsFile = workDir.join("settings.json");
    const databaseDir = workDir.join("database");
    await mkdir(databaseDir, { recursive: true });
    await initSettingsFile(settingsFile);
    return { workDir, settingsFile, databaseDir };
}

test("settings-changing commands persist durable settings without CLI runtime suspension", async () => {
    const fixture = await prepareSettingsFixture("livesync-cli-settings-command");
    await using workDir = fixture.workDir;
    const { settingsFile, databaseDir } = fixture;

    const settings = JSON.parse(await readFile(settingsFile, "utf8"));
    settings.liveSync = true;
    settings.syncOnStart = true;
    settings.periodicReplication = true;
    settings.P2P_Enabled = true;
    settings.P2P_AutoStart = true;
    settings.P2P_AutoBroadcast = true;
    await writeFile(settingsFile, JSON.stringify(settings, null, 2));

    const result = await runCli(
        databaseDir,
        "--settings",
        settingsFile,
        "remote-add",
        "test-remote",
        "sls+https://user:pass@example.com/database"
    );
    assert.deepStrictEqual(result.code, 0, result.combined);
    const firstRemoteId = result.stdout.trim().split("\t")[0];
    assert(firstRemoteId, `remote-add did not return an ID: ${result.combined}`);

    let persisted = JSON.parse(await readFile(settingsFile, "utf8"));
    const remotesByName = Object.values(persisted.remoteConfigurations ?? {}) as Array<{ name?: string }>;
    assert(
        remotesByName.some((remote) => remote.name === "test-remote"),
        "remote-add did not persist the new profile"
    );
    assert.deepStrictEqual(persisted.liveSync, true);
    assert.deepStrictEqual(persisted.syncOnStart, true);
    assert.deepStrictEqual(persisted.periodicReplication, true);
    assert.deepStrictEqual(persisted.P2P_Enabled, true);
    assert.deepStrictEqual(persisted.P2P_AutoStart, true);
    assert.deepStrictEqual(persisted.P2P_AutoBroadcast, true);

    const secondAdd = await runCli(
        databaseDir,
        "--settings",
        settingsFile,
        "remote-add",
        "second-remote",
        "sls+https://other:secret@example.net/second"
    );
    assert.deepStrictEqual(secondAdd.code, 0, secondAdd.combined);
    const secondRemoteId = secondAdd.stdout.trim().split("\t")[0];
    assert(secondRemoteId, `second remote-add did not return an ID: ${secondAdd.combined}`);

    const activate = await runCli(databaseDir, "--settings", settingsFile, "remote-activate", secondRemoteId);
    assert.deepStrictEqual(activate.code, 0, activate.combined);
    persisted = JSON.parse(await readFile(settingsFile, "utf8"));
    assert.deepStrictEqual(persisted.activeConfigurationId, secondRemoteId);

    const set = await runCli(
        databaseDir,
        "--settings",
        settingsFile,
        "remote-set",
        secondRemoteId,
        "sls+https://replacement:secret@example.org/replaced"
    );
    assert.deepStrictEqual(set.code, 0, set.combined);
    const exported = await runCli(databaseDir, "--settings", settingsFile, "remote-export", secondRemoteId);
    assert.deepStrictEqual(exported.code, 0, exported.combined);
    assert(exported.stdout.includes("replacement"), "remote-set did not persist the replacement URI");

    const remove = await runCli(databaseDir, "--settings", settingsFile, "remote-rm", secondRemoteId);
    assert.deepStrictEqual(remove.code, 0, remove.combined);
    persisted = JSON.parse(await readFile(settingsFile, "utf8"));
    const remotesById = Object.values(persisted.remoteConfigurations ?? {}) as Array<{ id?: string }>;
    assert(!remotesById.some((remote) => remote.id === secondRemoteId), "remote-rm did not persist the removal");
    assert.deepStrictEqual(persisted.activeConfigurationId, firstRemoteId);
});

test("ordinary commands keep the settings file unchanged by default", async () => {
    const fixture = await prepareSettingsFixture("livesync-cli-settings-readonly");
    await using workDir = fixture.workDir;
    const { settingsFile, databaseDir } = fixture;

    const settings = JSON.parse(await readFile(settingsFile, "utf8"));
    settings.settingVersion = 9;
    const original = JSON.stringify(settings, null, 2);
    await writeFile(settingsFile, original);

    const result = await runCli(databaseDir, "--settings", settingsFile, "ls");
    assert.deepStrictEqual(result.code, 0, result.combined);
    assert.deepStrictEqual(await readFile(settingsFile, "utf8"), original);
});

test("--write-settings persists durable start-up setting changes", async () => {
    const fixture = await prepareSettingsFixture("livesync-cli-settings-explicit");
    await using workDir = fixture.workDir;
    const { settingsFile, databaseDir } = fixture;

    const settings = JSON.parse(await readFile(settingsFile, "utf8"));
    settings.settingVersion = 9;
    delete settings.useIndexedDBAdapter;
    await writeFile(settingsFile, JSON.stringify(settings, null, 2));

    const result = await runCli(databaseDir, "--settings", settingsFile, "--write-settings", "ls");
    assert.deepStrictEqual(result.code, 0, result.combined);

    const persisted = JSON.parse(await readFile(settingsFile, "utf8"));
    assert.deepStrictEqual(persisted.settingVersion, 10);
    assert(!("useIndexedDBAdapter" in persisted), "the CLI-only adapter override was written to the settings file");
});

test("failed settings-changing commands leave the settings file unchanged", async () => {
    const fixture = await prepareSettingsFixture("livesync-cli-settings-failure");
    await using workDir = fixture.workDir;
    const { settingsFile, databaseDir } = fixture;

    const original = await readFile(settingsFile, "utf8");
    const result = await runCli(databaseDir, "--settings", settingsFile, "remote-rm", "missing-remote");
    assert(result.code !== 0, "remote-rm unexpectedly succeeded");
    assert.deepStrictEqual(await readFile(settingsFile, "utf8"), original);
});
