import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { chromium, type Page } from "playwright";

import { observePageFailures, startStaticServer } from "../helpers/browser.ts";

const pagesSiteRoot = resolve(Deno.env.get("PAGES_SITE_ROOT") ?? resolve(import.meta.dirname!, "../../../_site"));

function observeNetworkFailures(page: Page): () => void {
    const failures: string[] = [];
    page.on("requestfailed", (request) => {
        failures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "request failed"}`);
    });
    page.on("response", (response) => {
        if (response.status() >= 400) {
            failures.push(`${response.request().method()} ${response.url()}: HTTP ${response.status()}`);
        }
    });
    return () => assertEquals(failures, [], failures.join("\n"));
}

Deno.test({
    name: "GitHub Pages package serves browser applications from their final subpaths",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const server = await startStaticServer(pagesSiteRoot);
        const browser = await chromium.launch({ headless: true });
        try {
            const aggregator = await browser.newPage();
            const assertNoAggregatorFailures = observePageFailures(aggregator);
            const assertNoAggregatorNetworkFailures = observeNetworkFailures(aggregator);
            await aggregator.goto(new URL("aggregator.html#id=pages-smoke&n=2&i=0&d=before%2", server.baseUrl).href);
            await aggregator.getByText("1 / 2 Loaded", { exact: true }).waitFor();
            await aggregator.goto(
                new URL("aggregator.html#id=pages-smoke&n=2&i=1&d=3after%26amp%2Bplus%25percent", server.baseUrl)
                    .href
            );
            assertEquals(
                await aggregator.getByRole("link", { name: "Open Obsidian to complete setup" }).getAttribute("href"),
                "obsidian://setuplivesync?settingsQR=before%23after%26amp%2Bplus%25percent"
            );
            assertNoAggregatorFailures();
            assertNoAggregatorNetworkFailures();
            await aggregator.close();

            const webApp = await browser.newPage();
            const assertNoWebAppFailures = observePageFailures(webApp);
            const assertNoWebAppNetworkFailures = observeNetworkFailures(webApp);
            await webApp.addInitScript(`
                Object.defineProperty(globalThis, "showDirectoryPicker", {
                    configurable: true,
                    value: async () => {
                        throw new DOMException("Cancelled by Pages browser test", "AbortError");
                    },
                });
            `);
            await webApp.goto(new URL("webapp/", server.baseUrl).href);
            await webApp.waitForURL(/\/webapp\/webapp\.html$/);
            const vaultPicker = webApp.getByRole("button", { name: "Choose new vault folder" });
            await vaultPicker.click();
            await webApp.locator("#status.warning").filter({ hasText: "Vault selection was cancelled" }).waitFor();
            assertEquals(await vaultPicker.isEnabled(), true);
            assertNoWebAppFailures();
            assertNoWebAppNetworkFailures();
            await webApp.close();

            const webPeer = await browser.newPage();
            const assertNoWebPeerFailures = observePageFailures(webPeer);
            const assertNoWebPeerNetworkFailures = observeNetworkFailures(webPeer);
            await webPeer.goto(new URL("webpeer/", server.baseUrl).href);
            await webPeer.getByRole("heading", { name: "Peer to Peer Replicator", exact: true }).waitFor({
                timeout: 30_000,
            });
            await webPeer.getByText("No Connection", { exact: true }).waitFor();
            assertEquals(new URL(webPeer.url()).pathname, "/webpeer/");
            const manifest = await webPeer.request.get(new URL("webpeer/manifest.json", server.baseUrl).href);
            assertEquals(manifest.status(), 200);
            assertNoWebPeerFailures();
            assertNoWebPeerNetworkFailures();
        } finally {
            await browser.close();
            await server.close();
        }
    },
});
