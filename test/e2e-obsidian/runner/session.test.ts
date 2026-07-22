import { beforeEach, describe, expect, it, vi } from "vitest";
import { startObsidianPluginSession } from "@vrtmrz/obsidian-test-session";
import {
    startObsidianLiveSyncSession,
    type StartObsidianLiveSyncSessionOptions,
} from "./session.ts";

vi.mock("@vrtmrz/obsidian-test-session", () => ({
    startObsidianPluginSession: vi.fn(async () => ({
        app: {},
        cliEnv: {},
        install: {},
        readiness: {},
        pluginId: "obsidian-livesync",
        remoteDebuggingPort: 28052,
    })),
}));

describe("LiveSync real-Obsidian session", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("installs an explicitly selected plug-in artefact while retaining the supplied Vault and profile", async () => {
        const vault = {
            path: "/tmp/upgrade-vault",
            statePath: "/tmp/upgrade-state",
            name: "upgrade-vault",
            id: "upgrade-vault-id",
            homePath: "/tmp/upgrade-state/home",
            xdgConfigPath: "/tmp/upgrade-state/xdg-config",
            xdgCachePath: "/tmp/upgrade-state/xdg-cache",
            xdgDataPath: "/tmp/upgrade-state/xdg-data",
            userDataPath: "/tmp/upgrade-state/user-data",
            processMarker: "/tmp/upgrade-state",
            dispose: vi.fn(async () => undefined),
        };
        const options: StartObsidianLiveSyncSessionOptions & { artifactRoot: string } = {
            binary: "/Applications/Obsidian",
            cliBinary: "obsidian-cli",
            vault,
            artifactRoot: "/tmp/obsidian-livesync-0.25.83",
        };

        await startObsidianLiveSyncSession(options);

        expect(startObsidianPluginSession).toHaveBeenCalledWith(
            expect.objectContaining({
                artifactRoot: options.artifactRoot,
                pluginId: "obsidian-livesync",
                vault,
            })
        );
    });
});
