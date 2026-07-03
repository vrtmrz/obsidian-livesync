import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type TemporaryVault = {
    path: string;
    name: string;
    id: string;
    homePath: string;
    xdgConfigPath: string;
    xdgCachePath: string;
    xdgDataPath: string;
    userDataPath: string;
    dispose: () => Promise<void>;
};

export async function createTemporaryVault(prefix = "obsidian-livesync-e2e-"): Promise<TemporaryVault> {
    const vaultPath = await mkdtemp(join(tmpdir(), prefix));
    const statePath = await mkdtemp(join(tmpdir(), `${prefix}state-`));
    const name = vaultPath.split(/[\\/]/).pop() ?? "obsidian-livesync-e2e";
    await mkdir(join(vaultPath, ".obsidian"), { recursive: true });
    const homePath = join(statePath, "home");
    const xdgConfigPath = join(statePath, "xdg-config");
    const xdgCachePath = join(statePath, "xdg-cache");
    const xdgDataPath = join(statePath, "xdg-data");
    const userDataPath = join(statePath, "user-data");
    const id = `livesync-e2e-${Date.now()}`;
    await mkdir(homePath, { recursive: true });
    await mkdir(xdgConfigPath, { recursive: true });
    await mkdir(xdgCachePath, { recursive: true });
    await mkdir(xdgDataPath, { recursive: true });
    await mkdir(userDataPath, { recursive: true });
    await writeFile(
        join(vaultPath, ".obsidian", "app.json"),
        JSON.stringify({ legacyEditor: false, safeMode: false }, null, 4)
    );
    await writeFile(
        join(vaultPath, ".obsidian", "community-plugins.json"),
        JSON.stringify(["obsidian-livesync"], null, 4)
    );
    await writeObsidianVaultRegistry(id, vaultPath, name, homePath, xdgConfigPath, userDataPath);

    return {
        path: vaultPath,
        name,
        id,
        homePath,
        xdgConfigPath,
        xdgCachePath,
        xdgDataPath,
        userDataPath,
        dispose: async () => {
            if (process.env.E2E_OBSIDIAN_KEEP_VAULT === "true") {
                console.log(`Keeping temporary vault: ${vaultPath}`);
                console.log(`Keeping temporary Obsidian state: ${statePath}`);
                return;
            }
            await Promise.all([
                rm(vaultPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
                rm(statePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
            ]);
        },
    };
}

async function writeObsidianVaultRegistry(
    vaultId: string,
    vaultPath: string,
    vaultName: string,
    homePath: string,
    xdgConfigPath: string,
    userDataPath: string
): Promise<void> {
    const vaultRecord = {
        path: vaultPath,
        ts: Date.now(),
        open: true,
        name: vaultName,
    };
    const registry = {
        cli: true,
        vaults: {
            [vaultId]: vaultRecord,
        },
    };
    const registryText = JSON.stringify(registry, null, 4);
    for (const configRoot of [join(homePath, ".config"), xdgConfigPath]) {
        const obsidianConfigDir = join(configRoot, "obsidian");
        await mkdir(obsidianConfigDir, { recursive: true });
        await writeFile(join(obsidianConfigDir, "obsidian.json"), registryText);
    }
    await writeFile(join(userDataPath, "obsidian.json"), registryText);
    await writeFile(join(userDataPath, `${vaultId}.json`), JSON.stringify(vaultRecord, null, 4));
}
