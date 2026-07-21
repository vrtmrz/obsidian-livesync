import { startObsidianPluginSession, type ObsidianPluginSession } from "@vrtmrz/obsidian-test-session";
import type { TemporaryVault } from "./vault.ts";

export type ObsidianLiveSyncSession = ObsidianPluginSession;

export type StartObsidianLiveSyncSessionOptions = {
    binary: string;
    cliBinary: string;
    vault: TemporaryVault;
    startupGraceMs?: number;
    pluginData?: Record<string, unknown>;
    localStorageEntries?: Readonly<Record<string, string>>;
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
        artifactRoot: process.cwd(),
        startupGraceMs: options.startupGraceMs,
        pluginData: options.pluginData,
        localStorageEntries: options.localStorageEntries,
        env: options.env,
    });
}
