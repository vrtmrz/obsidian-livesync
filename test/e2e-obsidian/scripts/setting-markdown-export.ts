import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deriveIdKey } from "@vrtmrz/livesync-commonlib/settings";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { assertEqual } from "../runner/liveSyncWorkflow.ts";
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

async function configureSettingMarkdown(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    idDerivationKey: string
): Promise<void> {
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
            "idDerivationVersion:1,",
            `idDerivationKey:${JSON.stringify(idDerivationKey)},`,
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
    const idDerivationKey = await deriveIdKey("setting-markdown-export-independent-id-key-fixture");
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
        // The export is available while an unconfigured Vault remains outside
        // application readiness; the session helper has already loaded the plug-in.
        await configureSettingMarkdown(cli.binary, session.cliEnv, idDerivationKey);
        const content = await waitForFileContaining(vault.path, settingPath, [
            (value) => value.includes("````yaml:livesync-setting"),
            (value) => value.includes(`settingSyncFile: ${settingPath}`),
            (value) => value.includes("showVerboseLog: true"),
        ]);

        const persisted = JSON.parse(
            await readFile(join(vault.path, ".obsidian", "plugins", "obsidian-livesync", "data.json"), "utf-8")
        ) as {
            idDerivationVersion?: unknown;
            idDerivationKey?: unknown;
            encryptedIdDerivationKey?: unknown;
        };
        assertEqual(persisted.idDerivationVersion, 1, "The independent ID key fixture was not persisted.");
        assertEqual(persisted.idDerivationKey, "", "The independent ID key was stored in plain text locally.");
        const encryptedIdDerivationKey = persisted.encryptedIdDerivationKey;
        if (typeof encryptedIdDerivationKey !== "string" || encryptedIdDerivationKey.length === 0) {
            throw new Error("The independent ID key fixture was not saved in encrypted local settings.");
        }

        assertEqual(
            content.includes("couchDB_PASSWORD: e2e-password"),
            false,
            "Credential leaked into setting Markdown."
        );
        assertEqual(content.includes("passphrase: e2e-passphrase"), false, "Passphrase leaked into setting Markdown.");
        assertEqual(content.includes(idDerivationKey), false, "Plaintext ID key leaked into setting Markdown.");
        assertEqual(
            content.includes(encryptedIdDerivationKey),
            false,
            "Encrypted ID key leaked into setting Markdown."
        );

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
