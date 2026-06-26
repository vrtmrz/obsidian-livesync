import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type PluginInstallResult = {
    pluginDir: string;
    copied: string[];
};

const pluginId = "obsidian-livesync";

export async function installBuiltPlugin(vaultPath: string, rootDir = process.cwd()): Promise<PluginInstallResult> {
    const pluginDir = join(vaultPath, ".obsidian", "plugins", pluginId);
    const copied: string[] = [];
    await mkdir(pluginDir, { recursive: true });

    const requiredArtifacts = ["main.js", "manifest.json"];
    for (const artifact of requiredArtifacts) {
        const source = resolve(rootDir, artifact);
        if (!existsSync(source)) {
            throw new Error(`Required plug-in artifact is missing: ${source}`);
        }
        await copyFile(source, join(pluginDir, artifact));
        copied.push(artifact);
    }

    const optionalArtifacts = ["styles.css"];
    for (const artifact of optionalArtifacts) {
        const source = resolve(rootDir, artifact);
        if (!existsSync(source)) {
            continue;
        }
        await copyFile(source, join(pluginDir, artifact));
        copied.push(artifact);
    }

    await writeFile(join(vaultPath, ".obsidian", "community-plugins.json"), JSON.stringify([pluginId], null, 4));
    return { pluginDir, copied };
}
