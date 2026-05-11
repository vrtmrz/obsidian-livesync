/**
 * helpers/obsidian.ts
 *
 * Launch / teardown helpers for the Obsidian Electron application and
 * common UI interactions needed across test files.
 *
 * Launch strategy
 * ---------------
 * Playwright's `_electron.launch()` cannot reliably connect to Obsidian.exe
 * via CDP because Obsidian's startup sequence does not expose the DevTools
 * URL on stdout/stderr in a way Playwright can detect.  Instead, we:
 *   1. Spawn Obsidian with a fixed `--remote-debugging-port`.
 *   2. Poll `http://127.0.0.1:<port>/json/version` until the port is ready.
 *   3. Connect with `chromium.connectOverCDP()`.
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import os from "node:os";

import type { Browser, Page } from "playwright";
import type { ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Executable path resolution
// ---------------------------------------------------------------------------

function defaultObsidianPath(): string {
    switch (os.platform()) {
        case "win32":
            return path.join(os.homedir(), "AppData", "Local", "Obsidian", "Obsidian.exe");
        case "darwin":
            return "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
        default:
            return process.env["OBSIDIAN_PATH"] ?? "/usr/bin/obsidian";
    }
}

/**
 * Path to the Obsidian executable.
 * Override with the `OBSIDIAN_PATH` environment variable if needed.
 */
export const OBSIDIAN_EXECUTABLE: string = process.env["OBSIDIAN_PATH"] ?? defaultObsidianPath();

/** Fixed CDP port used for all test runs (workers: 1, so no collisions). */
const CDP_PORT = 19222;

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/**
 * Handle returned by `launchObsidian`.  Provides just enough surface to drive
 * the Obsidian window and shut it down cleanly.
 */
export interface ObsidianHandle {
    /** Returns the main Obsidian renderer page. */
    firstWindow(): Promise<Page>;
    /** Closes the CDP connection and kills the Obsidian process. */
    close(): Promise<void>;
}

/** Poll `http://127.0.0.1:<port>/json/version` until Obsidian is ready. */
async function waitForCDP(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ready = await new Promise<boolean>((resolve) => {
            const req = http.get(`http://127.0.0.1:${port}/json/version`, (res: any) => {
                res.resume();
                resolve(res.statusCode === 200);
            });
            req.on("error", () => resolve(false));
            req.setTimeout(1_000, () => {
                req.destroy();
                resolve(false);
            });
        });
        if (ready) return;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Obsidian CDP port ${port} was not ready within ${timeoutMs}ms`);
}

/**
 * Launches Obsidian with an isolated user-data directory and opens the
 * given vault via the `obsidian://open` URI scheme.
 *
 * Uses a fixed `--remote-debugging-port` so we can poll and connect via
 * `chromium.connectOverCDP()` without relying on Playwright's electron
 * startup detection, which does not work with Obsidian.exe.
 */
export async function launchObsidian(fakeAppData: string, vaultDir: string): Promise<ObsidianHandle> {
    const proc: ChildProcess = spawn(
        OBSIDIAN_EXECUTABLE,
        [
            `--remote-debugging-port=${CDP_PORT}`,
            `--user-data-dir=${fakeAppData}`,
            "--no-sandbox",
            "--lang=en",
            `obsidian://open?path=${encodeURIComponent(vaultDir)}`,
        ],
        { env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: "1" } }
    );

    proc.on("error", (err: Error) => {
        console.error("[launchObsidian] spawn error:", err.message);
    });

    await waitForCDP(CDP_PORT, 60_000);

    const browser: Browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);

    return {
        close: async () => {
            try {
                await browser.close();
            } catch {
                /* ignore */
            }
            try {
                proc.kill();
            } catch {
                /* ignore */
            }
        },
        firstWindow: async (): Promise<Page> => {
            const deadline = Date.now() + 30_000;
            while (Date.now() < deadline) {
                for (const ctx of browser.contexts()) {
                    const pages = ctx.pages().filter((p: Page) => !p.isClosed());
                    if (pages.length > 0) return pages[0];
                }
                await new Promise((r) => setTimeout(r, 300));
            }
            throw new Error("No Obsidian window found after 30s");
        },
    };
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

/**
 * Returns the main Obsidian window and waits for its DOM to be ready.
 */
export async function getMainWindow(app: ObsidianHandle): Promise<Page> {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    return page;
}

/**
 * Waits until the Obsidian vault workspace has finished loading.
 *
 * Handles the 'Trust author and enable plugins' prompt and the
 * community-plugins information modal that appear on a first-time vault open.
 */
export async function waitForVaultReady(page: Page): Promise<void> {
    // Trust prompt — must be dismissed before the workspace renders.
    const trustButton = page.getByRole("button", { name: /trust author and enable plugins/i });
    try {
        await trustButton.waitFor({ state: "visible", timeout: 15_000 });
        await trustButton.click();
        await page.waitForTimeout(1_500);
    } catch {
        // Not shown — vault already trusted or safe mode off.
    }

    // Community-plugins modal — dismiss with Escape.
    try {
        const modal = page.locator(".modal-container").filter({ hasText: /community plugins/i });
        await modal.waitFor({ state: "visible", timeout: 5_000 });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
    } catch {
        // Modal not shown.
    }

    await page.waitForSelector(".workspace-ribbon", { timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// Settings modal helpers
// ---------------------------------------------------------------------------

/**
 * Opens the Obsidian Settings modal via the standard keyboard shortcut and
 * waits for the navigation panel to become visible.
 */
export async function openSettings(page: Page): Promise<void> {
    await page.keyboard.press("Control+,");
    await page.waitForSelector(".modal-container .vertical-tab-nav-item", { timeout: 15_000 });
}

/**
 * Clicks a settings navigation tab identified by its visible text label.
 */
export async function clickSettingsTab(page: Page, label: string): Promise<void> {
    const tab = page.locator(".vertical-tab-nav-item", { hasText: label });
    await tab.first().click();
    await page.waitForTimeout(300);
}

/**
 * Opens Settings and navigates directly to the Self-hosted LiveSync tab.
 */
export async function openLiveSyncSettings(page: Page): Promise<void> {
    await openSettings(page);
    await clickSettingsTab(page, "Self-hosted LiveSync");
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** CSS selector for the settings-tab content area. */
export const SELECTOR_SETTINGS_CONTENT = ".vertical-tab-content-container";

/** CSS selector for Obsidian notice toasts. */
export const SELECTOR_NOTICE = ".notice-container .notice";
