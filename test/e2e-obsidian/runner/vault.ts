import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type TemporaryVault = {
    path: string;
    name: string;
    homePath: string;
    xdgConfigPath: string;
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
    const userDataPath = join(statePath, "user-data");
    await mkdir(homePath, { recursive: true });
    await mkdir(xdgConfigPath, { recursive: true });
    await mkdir(userDataPath, { recursive: true });
    await writeFile(
        join(vaultPath, ".obsidian", "app.json"),
        JSON.stringify({ legacyEditor: false, safeMode: false }, null, 4)
    );
    await writeObsidianVaultRegistry(vaultPath, name, homePath, xdgConfigPath, userDataPath);

    return {
        path: vaultPath,
        name,
        homePath,
        xdgConfigPath,
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
    vaultPath: string,
    vaultName: string,
    homePath: string,
    xdgConfigPath: string,
    userDataPath: string
): Promise<void> {
    const vaultId = `livesync-e2e-${Date.now()}`;
    const registry = {
        cli: true,
        vaults: {
            [vaultId]: {
                path: vaultPath,
                ts: Date.now(),
                open: true,
                name: vaultName,
            },
        },
    };
    const registryText = JSON.stringify(registry, null, 4);
    for (const configRoot of [join(homePath, ".config"), xdgConfigPath]) {
        const obsidianConfigDir = join(configRoot, "obsidian");
        await mkdir(obsidianConfigDir, { recursive: true });
        await writeFile(join(obsidianConfigDir, "obsidian.json"), registryText);
    }
    await writeFile(join(userDataPath, "obsidian.json"), registryText);
}
