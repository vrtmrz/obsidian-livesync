import {
    cleanupStaleObsidianE2EProcesses as cleanupStaleProcesses,
    launchObsidian as launchObsidianSession,
    type LaunchObsidianOptions,
    type ObsidianProcess,
    type ObsidianProcessOutput,
} from "@vrtmrz/obsidian-test-session";

export type { LaunchObsidianOptions, ObsidianProcess, ObsidianProcessOutput };

const STALE_PROCESS_PATTERN = "obsidian-livesync-e2e-state";

export async function cleanupStaleObsidianE2EProcesses(): Promise<void> {
    await cleanupStaleProcesses(STALE_PROCESS_PATTERN);
}

export async function launchObsidian(options: LaunchObsidianOptions): Promise<ObsidianProcess> {
    const configuredPort =
        options.env?.E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT ?? process.env.E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT;
    return await launchObsidianSession({
        ...options,
        remoteDebuggingPort:
            options.remoteDebuggingPort ?? (configuredPort === undefined ? undefined : Number(configuredPort)),
        staleProcessPattern: options.staleProcessPattern ?? STALE_PROCESS_PATTERN,
    });
}
