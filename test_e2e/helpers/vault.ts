/* eslint-disable obsidianmd/prefer-window-timers */
// This file is a test helper and is allowed to use Node.js modules.
/* eslint-disable obsidianmd/hardcoded-config-path */
// This file is a test helper and is allowed to use Node.js modules.
/* eslint-disable import/no-nodejs-modules */
/**
 * helpers/vault.ts
 *
 * Creates a fully-isolated, throwaway Obsidian vault for each test run.
 *
 * Directory layout produced by `setupTestVault()`:
 *
 *   <tmpdir>/livesync-e2e-<id>/
 *     obsidian.json          <- registered vault list (Obsidian userData config)
 *     vault/
 *       .obsidian/
 *         app.json             <- safe-mode disabled
 *         community-plugins.json
 *         plugins/
 *           obsidian-livesync/
 *             main.js          <- built plugin (copied from repo root)
 *             manifest.json
 *             styles.css
 */

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";

/** Absolute path to the repository root (two levels above helpers/). */
// eslint-disable-next-line no-undef
const REPO_ROOT = path.resolve(__dirname, "../..");

export interface VaultSetupResult {
    /** The vault directory that Obsidian will open. */
    vaultDir: string;
    /**
     * The directory used as `--user-data-dir` for the Obsidian process.
     * Obsidian reads its vault registry from `<fakeAppData>/obsidian.json`.
     */
    fakeAppData: string;
    /** Removes the entire temporary tree. */
    cleanup: () => void;
}

export interface VaultSettingsOptions {
    /** Optional custom app.json content under <vault>/.obsidian/app.json */
    appJson?: Record<string, unknown>;
    /** Community plugin IDs to mark as enabled. */
    communityPlugins?: string[];
    /** Per-plugin configuration keyed by plugin ID. */
    pluginData?: Record<string, unknown>;
}

/**
 * Creates a throw-away vault with the built plugin pre-installed and
 * registered in an isolated Obsidian configuration directory.
 *
 * Call `cleanup()` (or use `test.afterAll`) to delete the temporary files.
 */
export function setupTestVault(): VaultSetupResult {
    return setupTestVaultWithSettings({});
}

/**
 * Creates a throw-away vault with optional initial Obsidian/plugin settings.
 *
 * This helper is intended for real-Obsidian e2e tests that need to open a
 * vault in a known configuration state.
 */
export function setupTestVaultWithSettings(options: VaultSettingsOptions = {}): VaultSetupResult {
    const id = randomBytes(4).toString("hex");
    const baseDir = path.join(os.tmpdir(), `livesync-e2e-${id}`);
    const fakeAppData = baseDir;
    const vaultDir = path.join(baseDir, "vault");

    // ------------------------------------------------------------------ vault
    const dotObsidian = path.join(vaultDir, ".obsidian");
    const pluginDir = path.join(dotObsidian, "plugins", "obsidian-livesync");
    mkdirSync(pluginDir, { recursive: true });

    // Copy the built plugin artefacts from the repository root.
    for (const file of ["main.js", "manifest.json", "styles.css"]) {
        const src = path.join(REPO_ROOT, file);
        if (existsSync(src)) {
            copyFileSync(src, path.join(pluginDir, file));
        } else {
            console.warn(`[vault setup] Expected file not found: ${src}`);
        }
    }

    // Disable Obsidian safe mode so community plugins are allowed to load.
    writeFileSync(
        path.join(dotObsidian, "app.json"),
        JSON.stringify({ promptDelete: false, ...(options.appJson ?? {}) }, null, 2),
        "utf-8"
    );

    // Tell Obsidian which community plugins are enabled.
    writeFileSync(
        path.join(dotObsidian, "community-plugins.json"),
        // JSON.stringify(options.communityPlugins ?? ["obsidian-livesync"], null, 2),
        // You should enable the plugin(s) explicitly
        JSON.stringify(options.communityPlugins ?? [], null, 2),
        "utf-8"
    );

    if (options.pluginData) {
        for (const [pluginId, value] of Object.entries(options.pluginData)) {
            const target = path.join(dotObsidian, "plugins", pluginId, "data.json");
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, JSON.stringify(value, null, 2), "utf-8");
        }
    }

    // ------------------------------------------------ Obsidian global config
    // With --user-data-dir=<fakeAppData>, Obsidian reads its vault registry
    // directly from <fakeAppData>/obsidian.json.
    mkdirSync(fakeAppData, { recursive: true });

    const vaultId = randomBytes(8).toString("hex");

    writeFileSync(
        path.join(fakeAppData, "obsidian.json"),
        JSON.stringify(
            {
                vaults: {
                    [vaultId]: {
                        path: vaultDir,
                        ts: Date.now(),
                        open: true,
                    },
                },
                updateDisabled: true,
            },
            null,
            2
        ),
        "utf-8"
    );

    return {
        vaultDir,
        fakeAppData,
        cleanup: () =>
            void (async () => {
                for (let attempt = 1; attempt <= 5; attempt++) {
                    try {
                        rmSync(baseDir, { recursive: true, force: true });
                        console.log(`[vault cleanup] Successfully removed temporary directory: ${baseDir}`);
                        return;
                    } catch {
                        console.warn(
                            `[vault cleanup] Attempt ${attempt} failed to remove temporary directory: ${baseDir}`
                        );
                        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
                    }
                }
                console.error(
                    `[vault cleanup] Failed to remove temporary directory after multiple attempts: ${baseDir}`
                );
            })(),
    };
}
