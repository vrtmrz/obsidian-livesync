import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

for (const width of [320, 390, 768]) {
    test(`P2P pane controls fit a ${width}px viewport`, async () => {
        const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
        try {
            const page = await browser.newPage({
                viewport: { width, height: 844 },
                colorScheme: width === 320 ? "dark" : "light",
            });
            const errors: string[] = [];
            page.on("pageerror", (error) => errors.push(error.message));
            const base = process.env.DIAG_UI_BASE_URL ?? "http://127.0.0.1:5157";
            await page.goto(`${base}/test/p2p-diagnostics/status-pane/index.html`);
            await page.waitForSelector(".peer-item");
            assert.deepEqual(errors, [], "Fixture must load without browser errors");
            const undersized = await page.locator(".peers-section button").evaluateAll((buttons) =>
                buttons
                    .filter((button) => {
                        const rect = button.getBoundingClientRect();
                        return rect.width < 43.5 || rect.height < 43.5;
                    })
                    .map((button) => ({
                        label: button.textContent?.trim(),
                        width: button.getBoundingClientRect().width,
                        height: button.getBoundingClientRect().height,
                    }))
            );
            assert.deepEqual(undersized, [], "Peer buttons must have at least a 44px target at the default font size");
            const overflow = await page.locator(".peer-item").evaluateAll((items) =>
                items.flatMap((item, index) => {
                    const rect = item.getBoundingClientRect();
                    const style = getComputedStyle(item);
                    const left = rect.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
                    const right = rect.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
                    return Array.from(item.querySelectorAll("button")).flatMap((button) => {
                        const bounds = button.getBoundingClientRect();
                        return bounds.left < left - 1 || bounds.right > right + 1
                            ? [
                                  {
                                      peer: index,
                                      button: button.textContent?.trim(),
                                      left: bounds.left,
                                      right: bounds.right,
                                      container: [left, right],
                                  },
                              ]
                            : [];
                    });
                })
            );
            assert.deepEqual(overflow, [], "Every peer action must stay inside its card content");
            const clipped = await page
                .locator(".peer-actions .action-button")
                .evaluateAll((buttons) =>
                    buttons
                        .filter((button) => button.scrollWidth > button.clientWidth + 1)
                        .map((button) => button.textContent?.trim())
                );
            assert.deepEqual(clipped, [], "Peer action labels must remain readable in full");
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
                "Long names must not cause horizontal page overflow"
            );
            assert.equal(await page.locator(".diag-grid").isVisible(), true);
            assert.deepEqual(await page.locator(".diag-item > span:last-child").allTextContents(), [
                "4",
                "2",
                "1",
                "1",
            ]);
            if (process.env.DIAG_LAYOUT_SCREENSHOT_PREFIX) {
                await page.screenshot({
                    path: `${process.env.DIAG_LAYOUT_SCREENSHOT_PREFIX}-${width}.png`,
                    fullPage: true,
                });
            }
            await page.locator(".peer-item").nth(0).getByRole("button", { name: "Replicate now", exact: true }).click();
            assert.deepEqual(JSON.parse((await page.locator("#action").textContent()) ?? "null"), {
                sync: "permanent-peer",
            });
            await page
                .locator(".peer-item")
                .nth(2)
                .getByRole("button", { name: "Allow in session", exact: true })
                .click();
            assert.deepEqual(JSON.parse((await page.locator("#action").textContent()) ?? "null"), {
                peerId: "new-peer",
                name: "New device",
                decision: true,
                isTemporary: true,
            });
            assert.deepEqual(errors, []);
        } finally {
            await browser.close();
        }
    });
}
