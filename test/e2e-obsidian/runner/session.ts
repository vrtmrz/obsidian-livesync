import {
    startObsidianPluginSession,
    type ObsidianPluginSession,
    type ObsidianPluginSessionLifecycle,
    type ObsidianPluginStartupMode,
} from "@vrtmrz/obsidian-test-session";
import type { TemporaryVault } from "./vault.ts";

export type ObsidianLiveSyncSession = ObsidianPluginSession;

export type StartObsidianLiveSyncSessionOptions = {
    binary: string;
    cliBinary: string;
    vault: TemporaryVault;
    artifactRoot?: string;
    startupGraceMs?: number;
    pluginData?: Record<string, unknown>;
    localStorageEntries?: Readonly<Record<string, string>>;
    pluginStartup?: ObsidianPluginStartupMode;
    lifecycle?: ObsidianPluginSessionLifecycle;
    env?: NodeJS.ProcessEnv;
};

export async function startObsidianLiveSyncSession(
    options: StartObsidianLiveSyncSessionOptions
): Promise<ObsidianLiveSyncSession> {
    return await startObsidianPluginSession({
        binary: options.binary,
        cliBinary: options.cliBinary,
        vault: options.vault,
        pluginId: "obsidian-livesync",
        artifactRoot: options.artifactRoot ?? process.cwd(),
        startupGraceMs: options.startupGraceMs,
        pluginData: options.pluginData,
        localStorageEntries: options.localStorageEntries,
        pluginStartup: options.pluginStartup,
        lifecycle: options.lifecycle,
        env: options.env,
    });
}
