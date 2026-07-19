import {
    assertLocatorHasMinimumTouchTarget,
    assertLocatorWithinSafeArea,
    assertLocatorWithinViewport,
    assertNoHorizontalOverflow,
} from "@vrtmrz/obsidian-test-session";
import type { Locator, Page } from "playwright";
import { withObsidianPage } from "./ui.ts";

export const mobileViewport = { width: 390, height: 844 } as const;
export const desktopViewport = { width: 1024, height: 768 } as const;
export const iPhoneSafeArea = { top: 47, right: 0, bottom: 34, left: 0 } as const;

type ObsidianTestApp = {
    emulateMobile?: (mobile: boolean) => void;
    plugins?: { plugins: Record<string, unknown> };
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

export async function setObsidianMobileTestMode(port: number, enabled: boolean, timeoutMs: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.setViewportSize(enabled ? mobileViewport : desktopViewport);
        await page.evaluate((nextEnabled) => {
            const obsidianApp = (globalThis as ObsidianTestGlobal).app;
            if (typeof obsidianApp?.emulateMobile !== "function") {
                throw new Error("app.emulateMobile is unavailable");
            }
            obsidianApp.emulateMobile(nextEnabled);
        }, enabled);
        await page.waitForFunction(
            (nextEnabled) => {
                const obsidianApp = (globalThis as ObsidianTestGlobal).app;
                return (
                    document.body.classList.contains("is-mobile") === nextEnabled &&
                    obsidianApp?.plugins?.plugins["obsidian-livesync"] !== undefined
                );
            },
            enabled,
            { timeout: timeoutMs }
        );
        await page.evaluate(
            (safeArea) => {
                for (const edge of ["top", "right", "bottom", "left"] as const) {
                    const property = `--safe-area-inset-${edge}`;
                    if (safeArea === null) document.body.style.removeProperty(property);
                    else document.body.style.setProperty(property, `${safeArea[edge]}px`);
                }
            },
            enabled ? iPhoneSafeArea : null
        );
    });
}

export async function assertMobileDialogueLayout(page: Page, container: Locator, label: string): Promise<void> {
    const dialogue = container.locator(".modal").last();
    const closeButton = dialogue.locator(".modal-close-button");
    await assertLocatorWithinViewport(page, dialogue, { label });
    await assertNoHorizontalOverflow(page, dialogue, { label });
    await assertLocatorWithinSafeArea(page, dialogue, {
        label,
        safeAreaInsets: iPhoneSafeArea,
    });
    await assertLocatorWithinSafeArea(page, closeButton, {
        label: `${label} close button`,
        safeAreaInsets: iPhoneSafeArea,
    });
    await assertLocatorHasMinimumTouchTarget(page, closeButton, {
        label: `${label} close button`,
    });

    const visibleButtons = dialogue.locator("button:visible");
    for (let index = 0; index < (await visibleButtons.count()); index++) {
        const button = visibleButtons.nth(index);
        const buttonLabel = (await button.innerText()).trim() || `button ${index + 1}`;
        await assertLocatorWithinViewport(page, button, { label: `${label}: ${buttonLabel}` });
        await assertLocatorWithinSafeArea(page, button, {
            label: `${label}: ${buttonLabel}`,
            safeAreaInsets: iPhoneSafeArea,
        });
        await assertNoHorizontalOverflow(page, button, { label: `${label}: ${buttonLabel}` });
        await assertLocatorHasMinimumTouchTarget(page, button, { label: `${label}: ${buttonLabel}` });
    }
}

export async function assertMobileNoticeLayout(
    page: Page,
    notice: Locator,
    label: string,
    reservedRightPx = 56
): Promise<void> {
    await assertLocatorWithinViewport(page, notice, { label });
    await assertNoHorizontalOverflow(page, notice, { label });
    await assertLocatorWithinSafeArea(page, notice, {
        label,
        safeAreaInsets: iPhoneSafeArea,
    });
    const box = await notice.boundingBox();
    if (box === null) {
        throw new Error(`${label} did not expose a measurable viewport rectangle.`);
    }
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    const rightEdge = box.x + box.width;
    if (rightEdge > viewportWidth - reservedRightPx) {
        throw new Error(
            `${label} overlaps the reserved close-control column: right edge ${rightEdge}, limit ${viewportWidth - reservedRightPx}.`
        );
    }
}
