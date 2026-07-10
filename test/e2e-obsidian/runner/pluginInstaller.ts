import {
    installBuiltPlugin as installGenericBuiltPlugin,
    type PluginInstallResult,
} from "@vrtmrz/obsidian-test-session";

export type { PluginInstallResult };

export async function installBuiltPlugin(vaultPath: string, rootDir = process.cwd()): Promise<PluginInstallResult> {
    return await installGenericBuiltPlugin(vaultPath, {
        pluginId: "obsidian-livesync",
        artifactRoot: rootDir,
    });
}
