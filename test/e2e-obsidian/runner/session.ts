import { startObsidianPluginSession, type ObsidianPluginSession } from "@vrtmrz/obsidian-test-session";
import type { TemporaryVault } from "./vault.ts";

export type ObsidianLiveSyncSession = ObsidianPluginSession;

export type StartObsidianLiveSyncSessionOptions = {
    binary: string;
    cliBinary: string;
    vault: TemporaryVault;
    startupGraceMs?: number;
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
    });
}
