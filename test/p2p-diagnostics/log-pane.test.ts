import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

test("Log Pane shows diagnostics recorded before it opens and follows subsequent events", async () => {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const base = process.env.DIAG_UI_BASE_URL ?? "http://127.0.0.1:5157";
        await page.goto(`${base}/test/p2p-diagnostics/log-pane/index.html`);
        await page.waitForSelector(".logpane");
        assert.deepEqual(errors, [], "Fixture must load without browser errors");
        await page.waitForFunction(
            () => document.querySelector(".log")?.textContent?.includes("Earlier connection failure"),
            undefined,
            { timeout: 3_000 }
        );
        await page.click("#append");
        await page.waitForFunction(
            () => document.querySelector(".log")?.textContent?.includes("Later connection recovery"),
            undefined,
            { timeout: 3_000 }
        );
        assert.match((await page.locator(".log").textContent()) ?? "", /Earlier connection failure/);
        await page.click("#unmount");
        await page.waitForSelector(".logpane", { state: "detached" });
        await page.click("#append");
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});

test("P2P Stats has three diagnostic rows and opens the existing Log Pane", async () => {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const base = process.env.DIAG_UI_BASE_URL ?? "http://127.0.0.1:5157";
        await page.goto(`${base}/test/p2p-diagnostics/status-card/index.html`);
        await page.waitForSelector(".diag-details", { state: "attached", timeout: 3_000 });
        assert.equal(await page.locator(".diag-grid").isVisible(), true, "Stats remains visible");
        assert.equal(await page.getByRole("button", { name: "Open log", exact: true }).isVisible(), false);
        await page.click("#complete");
        assert.equal(await page.locator(".diag-summary").isVisible(), false, "New events do not expand the log");
        await page.locator(".diag-details > summary").focus();
        await page.keyboard.press("Enter");
        await page.waitForSelector(".diag-summary");
        assert.deepEqual(errors, [], "Fixture must load without browser errors");
        const rows = page.locator(".diag-summary > div");
        assert.equal(await rows.count(), 3);
        assert.match((await rows.nth(0).textContent()) ?? "", /Room opened; relay replies not observed/);
        assert.match((await rows.nth(1).textContent()) ?? "", /Peer left/);
        assert.match((await rows.nth(2).textContent()) ?? "", /Pull completed/);
        assert.equal(
            await page.locator(".diag-summary").evaluate((element) => getComputedStyle(element).fontSize),
            "12px"
        );
        if (process.env.DIAG_UI_SCREENSHOT) {
            await page.screenshot({ path: process.env.DIAG_UI_SCREENSHOT, fullPage: true });
        }
        await page.click("#complete");
        await page.waitForFunction(
            () => document.querySelector(".diag-summary")?.textContent?.includes("Pull completed"),
            undefined,
            { timeout: 3_000 }
        );
        await page.locator(".diag-details > summary").click();
        assert.equal(await page.locator(".diag-grid").isVisible(), true);
        assert.equal(await page.locator(".diag-summary").isVisible(), false);
        await page.locator(".diag-details > summary").focus();
        await page.keyboard.press("Space");
        await page.getByRole("button", { name: "Open log", exact: true }).click();
        await page.waitForSelector(".logpane");
        assert.equal(await page.locator("#opened").textContent(), "log-log");
        assert.match((await page.locator(".log").textContent()) ?? "", /Earlier connection failure/);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});
