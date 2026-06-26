import { evalObsidianJson } from "./cli.ts";

export type PluginReadiness = {
    status: "ready";
    pluginId: string;
    pluginVersion: string;
    vaultName: string;
};

export async function waitForPluginReady(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_READY_TIMEOUT_MS ?? 20000)
): Promise<PluginReadiness> {
    const deadline = Date.now() + timeoutMs;
    let lastOutput = "";
    while (Date.now() < deadline) {
        try {
            const readiness = await evalObsidianJson<PluginReadiness>(
                cliBinary,
                [
                    "(async()=>JSON.stringify({",
                    "status:!!app.plugins.plugins['obsidian-livesync']?'ready':'pending',",
                    "pluginId:'obsidian-livesync',",
                    "pluginVersion:app.plugins.manifests['obsidian-livesync']?.version,",
                    "vaultName:app.vault.getName()",
                    "}))()",
                ].join(""),
                env
            );
            if (readiness.status === "ready") {
                return readiness;
            }
        } catch (error) {
            lastOutput = error instanceof Error ? error.message : String(error);
            // Keep polling until Obsidian exposes the vault-side CLI and plug-in state.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for Self-hosted LiveSync readiness through Obsidian CLI.\n${lastOutput}`);
}
