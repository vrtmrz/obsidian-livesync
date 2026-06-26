import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { launchObsidian } from "../runner/launch.ts";
import { installBuiltPlugin } from "../runner/pluginInstaller.ts";
import { waitForPluginReady } from "../runner/readiness.ts";
import { createTemporaryVault } from "../runner/vault.ts";
import { openVaultWithObsidianCli, runObsidianCli } from "../runner/cli.ts";

async function waitForPluginCatalogue(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_CLI_READY_TIMEOUT_MS ?? 15000);
    let lastOutput = "";
    while (Date.now() < deadline) {
        const result = await runObsidianCli(cliBinary, ["plugins", "filter=community"], env);
        lastOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
        if (result.stdout.includes("obsidian-livesync")) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for Obsidian plug-in catalogue through CLI.\n${lastOutput}`);
}

async function enableCommunityPlugins(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    const result = await runObsidianCli(cliBinary, ["eval", "code=(async()=>app.plugins.setEnable(true))()"], env);
    if (result.code !== 0 || result.stdout.includes("Error:")) {
        throw new Error(
            [
                `Failed to enable Obsidian community plug-ins through CLI. code=${result.code}, signal=${result.signal}`,
                result.stdout ? `stdout:\n${result.stdout}` : undefined,
                result.stderr ? `stderr:\n${result.stderr}` : undefined,
            ]
                .filter(Boolean)
                .join("\n")
        );
    }
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }
    const vault = await createTemporaryVault();
    let app;
    try {
        const install = await installBuiltPlugin(vault.path);
        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault: ${vault.path}`);
        console.log(`Installed plug-in artifacts: ${install.copied.join(", ")}`);

        app = await launchObsidian({
            binary,
            vaultPath: vault.path,
            homePath: vault.homePath,
            xdgConfigPath: vault.xdgConfigPath,
            userDataPath: vault.userDataPath,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        const cliEnv = {
            ...process.env,
            HOME: vault.homePath,
            XDG_CONFIG_HOME: vault.xdgConfigPath,
        };
        await openVaultWithObsidianCli(cli.binary, vault.path, cliEnv);
        await waitForPluginCatalogue(cli.binary, cliEnv);
        await enableCommunityPlugins(cli.binary, cliEnv);
        const reload = await runObsidianCli(cli.binary, ["plugin:reload", "id=obsidian-livesync"], cliEnv);
        if (reload.code !== 0 || !reload.stdout.includes("Reloaded: obsidian-livesync")) {
            throw new Error(
                [
                    `Failed to reload Self-hosted LiveSync through Obsidian CLI. code=${reload.code}, signal=${reload.signal}`,
                    reload.stdout ? `stdout:\n${reload.stdout}` : undefined,
                    reload.stderr ? `stderr:\n${reload.stderr}` : undefined,
                ]
                    .filter(Boolean)
                    .join("\n")
            );
        }
        const readiness = await waitForPluginReady(cli.binary, cliEnv);
        console.log(
            `Obsidian plug-in ready: ${readiness.pluginId}@${readiness.pluginVersion} in ${readiness.vaultName}`
        );
        await new Promise((resolve) => setTimeout(resolve, Number(process.env.E2E_OBSIDIAN_SMOKE_TIMEOUT_MS ?? 1000)));
        console.log("Obsidian stayed alive after the plug-in readiness check.");
    } finally {
        if (app) {
            await app.stop();
        }
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
