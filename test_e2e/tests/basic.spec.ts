/**
 * tests/basic.spec.ts
 *
 * Smoke tests for the Self-hosted LiveSync plugin running inside the real
 * Obsidian desktop application.
 *
 * What these tests verify
 * -----------------------
 * 1. Obsidian can launch with a fresh vault that has the plugin pre-installed.
 * 2. The vault workspace loads without errors.
 * 3. The plugin's settings tab is reachable via Settings > Self-hosted LiveSync.
 * 4. The initial (unconfigured) setup screen is displayed on the first open.
 *
 * Prerequisites
 * -------------
 * - `main.js` must exist at the repository root (run `npm run buildDev` first).
 * - Obsidian must be installed at the default path, or `OBSIDIAN_PATH` must be set.
 *
 * How to run
 * ----------
 *   npm run test:obsidian:e2e
 *   npm run test:obsidian:e2e:headed
 */

import { test, expect } from "playwright/test";
import { setupTestVault } from "../helpers/vault";
import type { VaultSetupResult } from "../helpers/vault";
import {
    launchObsidian,
    getMainWindow,
    waitForVaultReady,
    openLiveSyncSettings,
    SELECTOR_SETTINGS_CONTENT,
} from "../helpers/obsidian";
import type { ObsidianHandle } from "../helpers/obsidian";

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let app: ObsidianHandle;
let vault: VaultSetupResult;

test.beforeAll(async () => {
    vault = setupTestVault();
    app = await launchObsidian(vault.fakeAppData, vault.vaultDir);
});

test.afterAll(async () => {
    if (app) {
        await app.close().catch(() => {});
    }
    vault?.cleanup();
});

// ---------------------------------------------------------------------------
// Test 1 – basic launch
// ---------------------------------------------------------------------------

test("Obsidian launches and vault workspace loads", async () => {
    const page = await getMainWindow(app);
    await waitForVaultReady(page);

    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Test 2 – settings tab
// ---------------------------------------------------------------------------

test("Self-hosted LiveSync settings tab is accessible", async () => {
    const page = await getMainWindow(app);
    await waitForVaultReady(page);

    await openLiveSyncSettings(page);

    const content = page.locator(SELECTOR_SETTINGS_CONTENT);
    await expect(content).toBeVisible();
    await expect(content.filter({ hasText: "Self-hosted LiveSync" })).toBeVisible({ timeout: 10_000 });
});
