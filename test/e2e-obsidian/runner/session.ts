import { openVaultWithObsidianCli, runObsidianCli } from "./cli.ts";
import { launchObsidian, type ObsidianProcess } from "./launch.ts";
import { installBuiltPlugin, type PluginInstallResult } from "./pluginInstaller.ts";
import { waitForPluginReady, type PluginReadiness } from "./readiness.ts";
import type { TemporaryVault } from "./vault.ts";

export type ObsidianLiveSyncSession = {
    app: ObsidianProcess;
    cliEnv: NodeJS.ProcessEnv;
    install: PluginInstallResult;
    readiness: PluginReadiness;
};

export type StartObsidianLiveSyncSessionOptions = {
    binary: string;
    cliBinary: string;
    vault: TemporaryVault;
    startupGraceMs?: number;
};

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

async function reloadLiveSyncPlugin(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    const reload = await runObsidianCli(cliBinary, ["plugin:reload", "id=obsidian-livesync"], env);
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
}

export async function startObsidianLiveSyncSession(
    options: StartObsidianLiveSyncSessionOptions
): Promise<ObsidianLiveSyncSession> {
    const install = await installBuiltPlugin(options.vault.path);
    const app = await launchObsidian({
        binary: options.binary,
        vaultPath: options.vault.path,
        homePath: options.vault.homePath,
        xdgConfigPath: options.vault.xdgConfigPath,
        userDataPath: options.vault.userDataPath,
        startupGraceMs: options.startupGraceMs,
    });
    const cliEnv = {
        ...process.env,
        HOME: options.vault.homePath,
        XDG_CONFIG_HOME: options.vault.xdgConfigPath,
    };

    try {
        await openVaultWithObsidianCli(options.cliBinary, options.vault.path, cliEnv);
        await waitForPluginCatalogue(options.cliBinary, cliEnv);
        await enableCommunityPlugins(options.cliBinary, cliEnv);
        await reloadLiveSyncPlugin(options.cliBinary, cliEnv);
        const readiness = await waitForPluginReady(options.cliBinary, cliEnv);
        return { app, cliEnv, install, readiness };
    } catch (error) {
        await app.stop();
        throw error;
    }
}
