import { runObsidianCli } from "./cli.ts";

export type PluginReadiness = {
    status: "ready";
    pluginId: string;
    pluginVersion: string;
    vaultName: string;
};

function parseEvalJson(stdout: string): unknown {
    const marker = "=> ";
    const markerIndex = stdout.indexOf(marker);
    const text = markerIndex >= 0 ? stdout.slice(markerIndex + marker.length) : stdout;
    return JSON.parse(text.trim());
}

export async function waitForPluginReady(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_READY_TIMEOUT_MS ?? 20000)
): Promise<PluginReadiness> {
    const deadline = Date.now() + timeoutMs;
    let lastOutput = "";
    while (Date.now() < deadline) {
        const result = await runObsidianCli(
            cliBinary,
            [
                "eval",
                [
                    "code=(async()=>JSON.stringify({",
                    "status:!!app.plugins.plugins['obsidian-livesync']?'ready':'pending',",
                    "pluginId:'obsidian-livesync',",
                    "pluginVersion:app.plugins.manifests['obsidian-livesync']?.version,",
                    "vaultName:app.vault.getName()",
                    "}))()",
                ].join(""),
            ],
            env
        );
        lastOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
        try {
            const readiness = parseEvalJson(result.stdout) as PluginReadiness;
            if (readiness.status === "ready") {
                return readiness;
            }
        } catch {
            // Keep polling until Obsidian exposes the vault-side CLI and plug-in state.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for Self-hosted LiveSync readiness through Obsidian CLI.\n${lastOutput}`);
}
