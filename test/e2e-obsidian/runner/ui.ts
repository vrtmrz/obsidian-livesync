import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withObsidianPage } from "@vrtmrz/obsidian-test-session";
import type { Locator, Page } from "playwright";

export {
    obsidianRemoteDebuggingPort,
    preseedTrustedVaultState,
    trustVaultIfPrompted,
    withObsidianPage,
} from "@vrtmrz/obsidian-test-session";

export async function captureObsidianPage(
    port: number,
    filename: string,
    assertReady: (page: Page) => Promise<void>
): Promise<string> {
    const outputDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
    const screenshotPath = join(outputDirectory, filename);
    await mkdir(dirname(screenshotPath), { recursive: true });

    await withObsidianPage(port, async (page) => {
        try {
            await assertReady(page);
        } catch (error) {
            const failurePath = screenshotPath.replace(/\.png$/u, ".failure.png");
            await page.screenshot({ path: failurePath, fullPage: true });
            console.error(`UI failure screenshot: ${failurePath}`);
            throw error;
        }
        await page.screenshot({ path: screenshotPath, fullPage: true });
    });

    return screenshotPath;
}

export async function captureObsidianDialogue(
    port: number,
    filename: string,
    assertReady: (page: Page) => Promise<void>
): Promise<string> {
    return await captureObsidianPage(port, filename, assertReady);
}

export async function captureObsidianElement(
    port: number,
    filename: string,
    resolveElement: (page: Page) => Locator | Promise<Locator>
): Promise<string> {
    const outputDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
    const screenshotPath = join(outputDirectory, filename);
    await mkdir(dirname(screenshotPath), { recursive: true });

    await withObsidianPage(port, async (page) => {
        try {
            const element = await resolveElement(page);
            await element.waitFor({ state: "visible", timeout: 10000 });
            await element.screenshot({
                path: screenshotPath,
                animations: "disabled",
                style: ".notice-container { visibility: hidden !important; }",
            });
        } catch (error) {
            const failurePath = screenshotPath.replace(/\.png$/u, ".failure.png");
            await page.screenshot({ path: failurePath, fullPage: true });
            console.error(`UI element failure screenshot: ${failurePath}`);
            throw error;
        }
    });

    return screenshotPath;
}

export async function captureJsonResolveDialogue(port: number): Promise<string> {
    return await captureObsidianDialogue(port, "hidden-file-json-resolve-dialogue.png", async (page) => {
        const optionAB = page.locator('label:has(input[name="disp"][value="AB"])');
        const optionBA = page.locator('label:has(input[name="disp"][value="BA"])');
        const applyButton = page.getByRole("button", { name: "Apply" });
        await optionAB.waitFor({ state: "visible", timeout: 10000 });
        await optionBA.waitFor({ state: "visible", timeout: 10000 });
        await applyButton.waitFor({ state: "visible", timeout: 10000 });
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
