import {
    createTemporaryVault as createGenericTemporaryVault,
    type TemporaryVault,
} from "@vrtmrz/obsidian-test-session";

export type { TemporaryVault };

export async function createTemporaryVault(prefix = "obsidian-livesync-e2e-"): Promise<TemporaryVault> {
    return await createGenericTemporaryVault({
        prefix,
        pluginIds: ["obsidian-livesync"],
        idPrefix: "livesync-e2e",
    });
}
