import { assert, assertEquals } from "@std/assert";
import { TempDir } from "./helpers/temp.ts";
import { runCli } from "./helpers/cli.ts";
import { initSettingsFile } from "./helpers/settings.ts";

async function prepareSettingsFixture(prefix: string) {
    const workDir = await TempDir.create(prefix);
    const settingsFile = workDir.join("settings.json");
    const databaseDir = workDir.join("database");
    await Deno.mkdir(databaseDir, { recursive: true });
    await initSettingsFile(settingsFile);
    return { workDir, settingsFile, databaseDir };
}

Deno.test("settings-changing commands persist durable settings without CLI runtime suspension", async () => {
    const fixture = await prepareSettingsFixture("livesync-cli-settings-command");
    await using workDir = fixture.workDir;
    const { settingsFile, databaseDir } = fixture;

    const settings = JSON.parse(await Deno.readTextFile(settingsFile));
    settings.liveSync = true;
    settings.syncOnStart = true;
    settings.periodicReplication = true;
    settings.P2P_Enabled = true;
    settings.P2P_AutoStart = true;
    settings.P2P_AutoBroadcast = true;
    await Deno.writeTextFile(settingsFile, JSON.stringify(settings, null, 2));

    const result = await runCli(
        databaseDir,
        "--settings",
        settingsFile,
        "remote-add",
        "test-remote",
        "sls+https://user:pass@example.com/database"
    );
    assertEquals(result.code, 0, result.combined);
    const firstRemoteId = result.stdout.trim().split("\t")[0];
    assert(firstRemoteId, `remote-add did not return an ID: ${result.combined}`);

    let persisted = JSON.parse(await Deno.readTextFile(settingsFile));
    let remotes = Object.values(persisted.remoteConfigurations ?? {}) as Array<{ name?: string }>;
    assert(
        remotes.some((remote) => remote.name === "test-remote"),
        "remote-add did not persist the new profile"
    );
    assertEquals(persisted.liveSync, true);
    assertEquals(persisted.syncOnStart, true);
    assertEquals(persisted.periodicReplication, true);
    assertEquals(persisted.P2P_Enabled, true);
    assertEquals(persisted.P2P_AutoStart, true);
    assertEquals(persisted.P2P_AutoBroadcast, true);

    const secondAdd = await runCli(
        databaseDir,
        "--settings",
        settingsFile,
        "remote-add",
        "second-remote",
        "sls+https://other:secret@example.net/second"
    );
    assertEquals(secondAdd.code, 0, secondAdd.combined);
    const secondRemoteId = secondAdd.stdout.trim().split("\t")[0];
    assert(secondRemoteId, `second remote-add did not return an ID: ${secondAdd.combined}`);

    const activate = await runCli(databaseDir, "--settings", settingsFile, "remote-activate", secondRemoteId);
    assertEquals(activate.code, 0, activate.combined);
    persisted = JSON.parse(await Deno.readTextFile(settingsFile));
    assertEquals(persisted.activeConfigurationId, secondRemoteId);

    const set = await runCli(
        databaseDir,
        "--settings",
        settingsFile,
        "remote-set",
        secondRemoteId,
        "sls+https://replacement:secret@example.org/replaced"
    );
    assertEquals(set.code, 0, set.combined);
    const exported = await runCli(databaseDir, "--settings", settingsFile, "remote-export", secondRemoteId);
    assertEquals(exported.code, 0, exported.combined);
    assert(exported.stdout.includes("replacement"), "remote-set did not persist the replacement URI");

    const remove = await runCli(databaseDir, "--settings", settingsFile, "remote-rm", secondRemoteId);
    assertEquals(remove.code, 0, remove.combined);
    persisted = JSON.parse(await Deno.readTextFile(settingsFile));
    remotes = Object.values(persisted.remoteConfigurations ?? {}) as Array<{ id?: string }>;
    assert(!remotes.some((remote) => remote.id === secondRemoteId), "remote-rm did not persist the removal");
    assertEquals(persisted.activeConfigurationId, firstRemoteId);
});

Deno.test("ordinary commands keep the settings file unchanged by default", async () => {
    const fixture = await prepareSettingsFixture("livesync-cli-settings-readonly");
    await using workDir = fixture.workDir;
    const { settingsFile, databaseDir } = fixture;

    const settings = JSON.parse(await Deno.readTextFile(settingsFile));
    settings.settingVersion = 9;
    const original = JSON.stringify(settings, null, 2);
    await Deno.writeTextFile(settingsFile, original);

    const result = await runCli(databaseDir, "--settings", settingsFile, "ls");
    assertEquals(result.code, 0, result.combined);
    assertEquals(await Deno.readTextFile(settingsFile), original);
});

Deno.test("--write-settings persists durable start-up setting changes", async () => {
    const fixture = await prepareSettingsFixture("livesync-cli-settings-explicit");
    await using workDir = fixture.workDir;
    const { settingsFile, databaseDir } = fixture;

    const settings = JSON.parse(await Deno.readTextFile(settingsFile));
    settings.settingVersion = 9;
    delete settings.useIndexedDBAdapter;
    await Deno.writeTextFile(settingsFile, JSON.stringify(settings, null, 2));

    const result = await runCli(databaseDir, "--settings", settingsFile, "--write-settings", "ls");
    assertEquals(result.code, 0, result.combined);

    const persisted = JSON.parse(await Deno.readTextFile(settingsFile));
    assertEquals(persisted.settingVersion, 10);
    assert(!("useIndexedDBAdapter" in persisted), "the CLI-only adapter override was written to the settings file");
});

Deno.test("failed settings-changing commands leave the settings file unchanged", async () => {
    const fixture = await prepareSettingsFixture("livesync-cli-settings-failure");
    await using workDir = fixture.workDir;
    const { settingsFile, databaseDir } = fixture;

    const original = await Deno.readTextFile(settingsFile);
    const result = await runCli(databaseDir, "--settings", settingsFile, "remote-rm", "missing-remote");
    assert(result.code !== 0, "remote-rm unexpectedly succeeded");
    assertEquals(await Deno.readTextFile(settingsFile), original);
});
