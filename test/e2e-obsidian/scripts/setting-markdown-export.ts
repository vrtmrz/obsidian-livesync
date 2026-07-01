import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { assertEqual, waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";

const settingPath = "LiveSync/settings-export.md";

async function waitForFileContaining(
    vaultPath: string,
    path: string,
    predicates: ((content: string) => boolean)[],
    timeoutMs = Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 10000)
): Promise<string> {
    const fullPath = join(vaultPath, path);
    const deadline = Date.now() + timeoutMs;
    let lastContent = "";
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            lastContent = await readFile(fullPath, "utf-8");
            if (predicates.every((predicate) => predicate(lastContent))) {
                return lastContent;
            }
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for setting Markdown: ${fullPath}\nLast error: ${String(lastError)}`);
}

async function configureSettingMarkdown(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.setting.applyExternalSettings({",
            `settingSyncFile:${JSON.stringify(settingPath)},`,
            "writeCredentialsForSettingSync:false,",
            "couchDB_USER:'e2e-user',",
            "couchDB_PASSWORD:'e2e-password',",
            "passphrase:'e2e-passphrase',",
            "showVerboseLog:true,",
            "},true);",
            "await core.services.setting.saveSettingData();",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;
    try {
        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault: ${vault.path}`);

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);

        await configureSettingMarkdown(cli.binary, session.cliEnv);
        const content = await waitForFileContaining(vault.path, settingPath, [
            (value) => value.includes("````yaml:livesync-setting"),
            (value) => value.includes(`settingSyncFile: ${settingPath}`),
            (value) => value.includes("showVerboseLog: true"),
        ]);

        assertEqual(
            content.includes("couchDB_PASSWORD: e2e-password"),
            false,
            "Credential leaked into setting Markdown."
        );
        assertEqual(content.includes("passphrase: e2e-passphrase"), false, "Passphrase leaked into setting Markdown.");

        console.log(`Generated setting Markdown without credentials: ${settingPath}`);
    } finally {
        if (session) {
            await session.app.stop();
        }
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
