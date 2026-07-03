import { evalObsidianJson, openVaultWithObsidianCli, runObsidianCli } from "./cli.ts";
import { launchObsidian, type ObsidianProcess } from "./launch.ts";
import { installBuiltPlugin, type PluginInstallResult } from "./pluginInstaller.ts";
import { waitForPluginReady, type PluginReadiness } from "./readiness.ts";
import type { TemporaryVault } from "./vault.ts";
import { obsidianRemoteDebuggingPort, preseedTrustedVaultState, trustVaultIfPrompted } from "./ui.ts";

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
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_CLI_READY_TIMEOUT_MS ?? 60000);
    let lastOutput = "";
    while (Date.now() < deadline) {
        try {
            const result = await evalObsidianJson<{ hasLiveSync: boolean }>(
                cliBinary,
                ["JSON.stringify({", "hasLiveSync:!!app.plugins?.manifests?.['obsidian-livesync']", "})"].join(""),
                env
            );
            lastOutput = JSON.stringify(result);
            if (result.hasLiveSync) {
                return;
            }
        } catch (error) {
            lastOutput = error instanceof Error ? error.message : String(error);
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
    let enableState: { enabled?: boolean; loaded?: boolean; pluginKeys?: string[] };
    try {
        enableState = await evalObsidianJson<{ enabled?: boolean; loaded?: boolean; pluginKeys?: string[] }>(
            cliBinary,
            [
                "(async()=>{",
                "await app.plugins.setEnable(true);",
                "await app.plugins.enablePlugin('obsidian-livesync');",
                "return JSON.stringify({",
                "enabled:app.plugins.enabledPlugins?.has?.('obsidian-livesync'),",
                "loaded:!!app.plugins.plugins['obsidian-livesync'],",
                "pluginKeys:Object.keys(app.plugins.plugins)",
                "});",
                "})()",
            ].join(""),
            env
        );
    } catch (error) {
        throw new Error(
            [
                "Failed to enable Self-hosted LiveSync through Obsidian CLI.",
                error instanceof Error ? error.message : String(error),
            ]
                .filter(Boolean)
                .join("\n")
        );
    }
    if (!enableState.enabled) {
        throw new Error(
            [
                `Failed to mark Self-hosted LiveSync enabled through Obsidian CLI: ${JSON.stringify(enableState)}`,
            ]
                .filter(Boolean)
                .join("\n")
        );
    }
}

async function loadLiveSyncPlugin(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    try {
        await evalObsidianJson(
            cliBinary,
            [
                "(async()=>{",
                "if(!app.plugins.plugins['obsidian-livesync']){",
                "await app.plugins.loadPlugin('obsidian-livesync');",
                "}",
                "return JSON.stringify({",
                "loaded:!!app.plugins.plugins['obsidian-livesync'],",
                "pluginKeys:Object.keys(app.plugins.plugins)",
                "});",
                "})()",
            ].join(""),
            env
        );
    } catch (error) {
        throw new Error(
            [
                "Failed to load Self-hosted LiveSync through Obsidian CLI.",
                error instanceof Error ? error.message : String(error),
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
    const remoteDebuggingPort = obsidianRemoteDebuggingPort();
    let app = await launchObsidian({
        binary: options.binary,
        vaultPath: options.vault.path,
        homePath: options.vault.homePath,
        xdgConfigPath: options.vault.xdgConfigPath,
        xdgCachePath: options.vault.xdgCachePath,
        xdgDataPath: options.vault.xdgDataPath,
        userDataPath: options.vault.userDataPath,
        startupGraceMs: options.startupGraceMs,
    });
    const cliEnv = {
        ...process.env,
        HOME: options.vault.homePath,
        XDG_CONFIG_HOME: options.vault.xdgConfigPath,
        XDG_CACHE_HOME: options.vault.xdgCachePath,
        XDG_DATA_HOME: options.vault.xdgDataPath,
    };

    try {
        await preseedTrustedVaultState(remoteDebuggingPort, options.vault.id);
        await openVaultWithObsidianCli(options.cliBinary, options.vault.path, cliEnv);
        await trustVaultIfPrompted(remoteDebuggingPort);
        await waitForPluginCatalogue(options.cliBinary, cliEnv);
        await enableCommunityPlugins(options.cliBinary, cliEnv);
        await reloadLiveSyncPlugin(options.cliBinary, cliEnv);
        await app.stop();
        app = await launchObsidian({
            binary: options.binary,
            vaultPath: options.vault.path,
            homePath: options.vault.homePath,
            xdgConfigPath: options.vault.xdgConfigPath,
            xdgCachePath: options.vault.xdgCachePath,
            xdgDataPath: options.vault.xdgDataPath,
            userDataPath: options.vault.userDataPath,
            startupGraceMs: options.startupGraceMs,
        });
        await preseedTrustedVaultState(remoteDebuggingPort, options.vault.id);
        await openVaultWithObsidianCli(options.cliBinary, options.vault.path, cliEnv);
        await trustVaultIfPrompted(remoteDebuggingPort);
        await waitForPluginCatalogue(options.cliBinary, cliEnv);
        await loadLiveSyncPlugin(options.cliBinary, cliEnv);
        const readiness = await waitForPluginReady(options.cliBinary, cliEnv);
        return { app, cliEnv, install, readiness };
    } catch (error) {
        const output = app.output();
        await app.stop();
        throw new Error(
            [
                error instanceof Error ? error.message : String(error),
                output.stdout ? `Obsidian stdout:\n${output.stdout}` : undefined,
                output.stderr ? `Obsidian stderr:\n${output.stderr}` : undefined,
            ]
                .filter(Boolean)
                .join("\n")
        );
    }
}
