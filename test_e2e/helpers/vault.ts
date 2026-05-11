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

/**
 * Creates a throw-away vault with the built plugin pre-installed and
 * registered in an isolated Obsidian configuration directory.
 *
 * Call `cleanup()` (or use `test.afterAll`) to delete the temporary files.
 */
export function setupTestVault(): VaultSetupResult {
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
    writeFileSync(path.join(dotObsidian, "app.json"), JSON.stringify({ promptDelete: false }, null, 2), "utf-8");

    // Tell Obsidian which community plugins are enabled.
    writeFileSync(
        path.join(dotObsidian, "community-plugins.json"),
        JSON.stringify(["obsidian-livesync"], null, 2),
        "utf-8"
    );

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
        cleanup: () => rmSync(baseDir, { recursive: true, force: true }),
    };
}
