import { chromium, type Page } from "playwright";

export function obsidianRemoteDebuggingPort(): number {
    const port = Number(process.env.E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT ?? 9222);
    process.env.E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT = String(port);
    return port;
}

async function waitForCdp(port: number): Promise<void> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_CDP_TIMEOUT_MS ?? 30000);
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (response.ok) {
                return;
            }
        } catch {
            // Keep polling until Obsidian exposes the debugging endpoint.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for Obsidian DevTools endpoint on port ${port}`);
}

export async function withObsidianPage<T>(port: number, operation: (page: Page) => Promise<T>): Promise<T> {
    await waitForCdp(port);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    try {
        const context = browser.contexts()[0];
        const page = context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 10000 }));
        return await operation(page);
    } finally {
        await browser.close();
    }
}

export async function preseedTrustedVaultState(port: number, vaultId: string): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate((id) => {
            localStorage.setItem(`enable-plugin-${id}`, "true");
        }, vaultId);
        await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => undefined);
        await page.waitForTimeout(1000);
    });
}

export async function trustVaultIfPrompted(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_TRUST_PROMPT_TIMEOUT_MS ?? 30000);
        while (Date.now() < deadline) {
            const yesButton = page.getByRole("button", { name: "Yes" });
            if (await yesButton.isVisible({ timeout: 1000 }).catch(() => false)) {
                await yesButton.click();
                await page.waitForTimeout(500);
                continue;
            }

            const trustButton = page.getByText("Trust author and enable plugins");
            if (await trustButton.isVisible({ timeout: 1000 }).catch(() => false)) {
                await trustButton.click();
                await page.waitForTimeout(500);
                continue;
            }

            const workspace = page.locator(".workspace");
            if (await workspace.isVisible({ timeout: 1000 }).catch(() => false)) {
                return;
            }
        }
    });
}

export async function clickJsonResolveOption(port: number, mode: "AB" | "BA"): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const option = page.locator(`label:has(input[name="disp"][value="${mode}"])`);
        await option.click({ timeout: 10000 });
        const checked = await page.locator(`input[name="disp"][value="${mode}"]`).isChecked({ timeout: 10000 });
        if (!checked) {
            throw new Error(`JSON Resolve option was not selected: ${mode}`);
        }
        await page.getByRole("button", { name: "Apply" }).click({ timeout: 10000 });
    });
}
