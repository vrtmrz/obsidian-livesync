import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withObsidianPage } from "@vrtmrz/obsidian-test-session";
import type { Locator, Page } from "playwright";

type ObsidianSettingsHost = typeof globalThis & {
    app?: {
        setting?: {
            open(): void;
            openTabById(tabId: string): void;
            close(): void;
        };
        vault?: {
            adapter?: { getBasePath?: () => string; basePath?: string };
        };
    };
};

export type LiveSyncSettingsRenderer = "imperative" | "declarative";

export type LiveSyncSettingsNavigator = {
    dialogue: Locator;
    page: Page;
    renderer: LiveSyncSettingsRenderer;
    close(): Promise<void>;
    openPage(name: string): Promise<Locator>;
    returnToCatalogue(): Promise<void>;
    isPageListed(name: string): Promise<boolean>;
};

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

/** Wait for a visible Obsidian dialogue, including one opened outside the settings window. */
export async function waitForVisibleObsidianDialogue(page: Page, text: string, timeoutMs = 10_000): Promise<Locator> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const candidate of page.context().pages()) {
            const dialogue = candidate.locator(".modal-container").filter({ hasText: text }).last();
            if (await dialogue.isVisible().catch(() => false)) return dialogue;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Obsidian did not open the expected dialogue: ${text}`);
}

function declarativePageEntry(dialogue: Locator, name: string): Locator {
    return dialogue
        .locator(".setting-item.mod-navigable")
        .filter({ hasText: new RegExp(`${escapeRegExp(name)}\\s*$`, "u") });
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Open the Self-hosted LiveSync settings tab through the renderer selected by
 * the running Obsidian version.
 *
 * Obsidian 1.13 may open settings in a separate window. The returned navigator
 * owns that renderer difference for both supported settings implementations.
 */
export async function openLiveSyncSettings(page: Page, timeoutMs = 10_000): Promise<LiveSyncSettingsNavigator> {
    let hostPage: Page | undefined;
    for (const candidate of page.context().pages()) {
        const hasSettingsHost = await candidate
            .evaluate(() => (globalThis as ObsidianSettingsHost).app?.setting !== undefined)
            .catch(() => false);
        if (hasSettingsHost) {
            hostPage = candidate;
            break;
        }
    }
    if (hostPage === undefined) throw new Error("Obsidian settings are unavailable");

    await hostPage.evaluate(() => {
        const host = globalThis as ObsidianSettingsHost;
        const setting = host.app?.setting;
        if (setting === undefined) throw new Error("Obsidian settings are unavailable");
        setting.open();
    });

    const deadline = Date.now() + timeoutMs;
    let settingsPage: Page | undefined;
    while (Date.now() < deadline && settingsPage === undefined) {
        for (const candidate of page.context().pages()) {
            if (
                await candidate
                    .locator(".modal.mod-settings:visible")
                    .last()
                    .isVisible()
                    .catch(() => false)
            ) {
                settingsPage = candidate;
                break;
            }
        }
        if (settingsPage === undefined) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (settingsPage === undefined) throw new Error("Obsidian did not open its settings interface");

    // Obsidian may discard a tab selection made before the settings modal has
    // finished opening. Select the plug-in only after a settings renderer is
    // visible so slower real-runtime sessions cannot remain on the About tab.
    await hostPage.evaluate(() => {
        const host = globalThis as ObsidianSettingsHost;
        const setting = host.app?.setting;
        if (setting === undefined) throw new Error("Obsidian settings are unavailable");
        setting.openTabById("obsidian-livesync");
    });

    const dialogue = settingsPage.locator(".modal.mod-settings:visible").last();
    const imperativeRoot = dialogue.locator(".sls-setting:visible").last();
    const firstDeclarativeEntry = declarativePageEntry(dialogue, "Change Log");
    await settingsPage.waitForFunction(
        () =>
            document.querySelector(".modal.mod-settings .sls-setting") !== null ||
            Array.from(document.querySelectorAll(".modal.mod-settings .setting-item-name")).some(
                (element) => element.textContent?.trim().endsWith("Change Log") === true
            ),
        undefined,
        { timeout: timeoutMs }
    );
    const renderer: LiveSyncSettingsRenderer = (await imperativeRoot.isVisible()) ? "imperative" : "declarative";

    const returnToCatalogue = async (): Promise<void> => {
        if (renderer === "imperative" || (await firstDeclarativeEntry.isVisible())) return;
        const backButton = dialogue.locator(".setting-page-back-button:visible, .modal-setting-back-button:visible");
        await backButton.last().click({ timeout: timeoutMs });
        await firstDeclarativeEntry.waitFor({ state: "visible", timeout: timeoutMs });
    };

    const openPage = async (name: string): Promise<Locator> => {
        if (renderer === "imperative") {
            const root = dialogue.locator(".sls-setting:visible").last();
            await root.locator(`.sls-setting-menu-btn[title="${name}"]`).click({ timeout: timeoutMs });
            return root;
        }

        await returnToCatalogue();
        const entry = declarativePageEntry(dialogue, name);
        await entry.waitFor({ state: "visible", timeout: timeoutMs });
        await entry.click({ timeout: timeoutMs });
        await entry.waitFor({ state: "hidden", timeout: timeoutMs });
        const content = dialogue.locator(".vertical-tab-content:visible").last();
        await content.waitFor({ state: "visible", timeout: timeoutMs });
        return content;
    };

    const isPageListed = async (name: string): Promise<boolean> => {
        if (renderer === "imperative") {
            return await dialogue
                .locator(`.sls-setting-menu-btn[title="${name}"]`)
                .isVisible()
                .catch(() => false);
        }
        await returnToCatalogue();
        return await declarativePageEntry(dialogue, name)
            .isVisible()
            .catch(() => false);
    };

    const close = async (): Promise<void> => {
        await hostPage
            .evaluate(() => {
                const setting = (globalThis as ObsidianSettingsHost).app?.setting;
                if (setting === undefined) throw new Error("Obsidian settings are unavailable");
                setTimeout(() => setting.close(), 0);
            })
            .catch((error: unknown) => {
                if (!hostPage.isClosed() && !settingsPage.isClosed()) throw error;
            });
        await Promise.race([
            dialogue.waitFor({ state: "hidden", timeout: timeoutMs }),
            settingsPage.waitForEvent("close", { timeout: timeoutMs }),
        ]).catch((error: unknown) => {
            if (!settingsPage.isClosed()) throw error;
        });
    };

    return {
        dialogue,
        page: settingsPage,
        renderer,
        close,
        openPage,
        returnToCatalogue,
        isPageListed,
    };
}

/** Allow only the isolated E2E Vault path in Obsidian's external-action prompt. */
export async function allowPendingObsidianTestVaultOpenAction(
    port: number,
    expectedVaultPath: string,
    timeoutMs = 10_000
): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const context = page.context();
        const action = page.locator(".modal.mod-uri-action:visible").last();
        const visible = await action
            .waitFor({ state: "visible", timeout: Math.min(timeoutMs, 2_000) })
            .then(() => true)
            .catch(() => false);
        if (visible) {
            const actionText = await action.innerText();
            if (!actionText.includes(expectedVaultPath)) {
                throw new Error(`Refusing an unexpected Obsidian URI action: ${actionText}`);
            }
            await action.locator(".mod-checkbox").click({ timeout: timeoutMs });
            await action.getByRole("button", { name: "Continue" }).click({ timeout: timeoutMs });
            await action.waitFor({ state: "hidden", timeout: timeoutMs });
        }

        const deadline = Date.now() + timeoutMs;
        let vaultPage: Page | undefined;
        while (Date.now() < deadline && vaultPage === undefined) {
            for (const candidate of context.pages()) {
                const activePath = await candidate
                    .evaluate(() => {
                        const host = globalThis as ObsidianSettingsHost;
                        const adapter = host.app?.vault?.adapter;
                        return adapter?.getBasePath?.() ?? adapter?.basePath ?? null;
                    })
                    .catch(() => null);
                if (activePath === expectedVaultPath) {
                    vaultPage = candidate;
                    break;
                }
            }
            if (vaultPage === undefined) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (vaultPage === undefined) {
            throw new Error(`Obsidian did not open the approved E2E Vault: ${expectedVaultPath}`);
        }
        for (const candidate of context.pages()) {
            if (candidate !== vaultPage && !candidate.isClosed()) await candidate.close();
        }
    });
}

export async function captureObsidianElement(
    port: number,
    filename: string,
    resolveElement: (page: Page) => Locator | Promise<Locator>,
    timeoutMs = 10_000
): Promise<string> {
    const outputDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
    const screenshotPath = join(outputDirectory, filename);
    await mkdir(dirname(screenshotPath), { recursive: true });

    await withObsidianPage(port, async (page) => {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const element = await resolveElement(page);
                await element.waitFor({ state: "visible", timeout: timeoutMs });
                await element.screenshot({
                    path: screenshotPath,
                    animations: "disabled",
                    style: ".notice-container { visibility: hidden !important; }",
                });
                return;
            } catch (error) {
                const detachedDuringCapture =
                    error instanceof Error && error.message.includes("not attached to the DOM");
                if (detachedDuringCapture && attempt < 2) {
                    await page.waitForTimeout(50);
                    continue;
                }
                const failurePath = screenshotPath.replace(/\.png$/u, ".failure.png");
                await page.screenshot({ path: failurePath, fullPage: true });
                console.error(`UI element failure screenshot: ${failurePath}`);
                throw error;
            }
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
