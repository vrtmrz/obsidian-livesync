import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { launchObsidian } from "../runner/launch.ts";
import { runObsidianCli } from "../runner/cli.ts";
import { createTemporaryVault } from "../runner/vault.ts";
import { installBuiltPlugin } from "../runner/pluginInstaller.ts";

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }
    const vault = await createTemporaryVault();
    let app;
    try {
        await installBuiltPlugin(vault.path);
        app = await launchObsidian({
            binary,
            vaultPath: vault.path,
            homePath: vault.homePath,
            xdgConfigPath: vault.xdgConfigPath,
            userDataPath: vault.userDataPath,
        });
        const cliEnv = {
            ...process.env,
            HOME: vault.homePath,
            XDG_CONFIG_HOME: vault.xdgConfigPath,
            XDG_CACHE_HOME: vault.xdgCachePath,
            XDG_DATA_HOME: vault.xdgDataPath,
        };
        await runObsidianCli(cli.binary, [`obsidian://open?path=${encodeURIComponent(vault.path)}`], cliEnv);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (process.env.E2E_OBSIDIAN_RELOAD_PLUGIN === "true") {
            await runObsidianCli(cli.binary, ["eval", "code=(async()=>app.plugins.setEnable(true))()"], cliEnv);
            await runObsidianCli(cli.binary, ["plugin:reload", "id=obsidian-livesync"], cliEnv);
        }
        const cliArgs = process.argv.slice(2);
        const result = await runObsidianCli(cli.binary, cliArgs.length > 0 ? cliArgs : ["--help"], cliEnv);
        console.log(result.stdout);
        console.error(result.stderr);
        process.exitCode = result.code ?? 1;
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
