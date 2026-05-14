import type { Locator, Page } from "playwright";
import { type ObsidianHandle, launchObsidian } from "./obsidian";
import { type VaultSettingsOptions, type VaultSetupResult, setupTestVaultWithSettings } from "./vault";

// ---------------------------------------------------------------------------
// Helpers (vault setup, test scaffolding, etc.)
// ---------------------------------------------------------------------------
export async function withSeededVault(
    options: VaultSettingsOptions,
    run: (context: { app: ObsidianHandle; vault: VaultSetupResult }) => Promise<void>
): Promise<void> {
    const vault = setupTestVaultWithSettings(options);
    const app = await launchObsidian(vault.fakeAppData, vault.vaultDir);

    try {
        await run({ app, vault });
    } finally {
        await app.close().catch(() => {});
        vault.cleanup();
    }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** CSS selector for the settings-tab content area. */
export const SELECTOR_SETTINGS_CONTENT = ".vertical-tab-content-container";

/** CSS selector for Obsidian notice toasts. */
export const SELECTOR_NOTICE = ".notice-container .notice";

export function locateModalByTitle(page: Page, title: string): Locator {
    return page.locator(".modal-container .modal-title").filter({ hasText: title });
}
