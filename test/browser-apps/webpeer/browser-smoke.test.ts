import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { chromium } from "playwright";

import { observePageFailures, startStaticServer, waitFor } from "../helpers/browser.ts";

const webPeerDist = resolve(import.meta.dirname!, "../../../src/apps/webpeer/dist");

Deno.test({
    name: "WebPeer: production bundle starts and reloads its persisted settings",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const server = await startStaticServer(webPeerDist);
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            const assertNoPageFailures = observePageFailures(page);
            await page.goto(server.baseUrl);
            await page.getByRole("heading", { name: "Peer to Peer Replicator", exact: true }).waitFor({
                timeout: 30_000,
            });
            await page.getByText("No Connection", { exact: true }).waitFor();

            await page.getByPlaceholder("anything-you-like").fill("browser-e2e-room");
            await page.getByPlaceholder("iphone-16").fill("browser-e2e-peer");
            await page.getByText("Optional TURN server settings", { exact: true }).click();
            await page.getByPlaceholder("turn:turn.example.com:3478").fill("turn:127.0.0.1:3478");
            await page.getByPlaceholder("Enter TURN username").fill("browser-turn-user");
            await page.getByPlaceholder("Enter TURN credential").fill("browser-turn-credential");
            const saveTurn = page.getByRole("button", { name: "Save TURN settings", exact: true });
            await saveTurn.click();
            await waitFor(async () => await saveTurn.isDisabled(), "WebPeer did not finish applying its TURN settings");
            const save = page.getByRole("button", { name: "Save and Apply", exact: true });
            await save.click();
            await waitFor(async () => await save.isDisabled(), "WebPeer did not finish applying its settings");

            await page.reload();
            await page.getByRole("heading", { name: "Peer to Peer Replicator", exact: true }).waitFor({
                timeout: 30_000,
            });
            assertEquals(await page.getByPlaceholder("anything-you-like").inputValue(), "browser-e2e-room");
            assertEquals(await page.getByPlaceholder("iphone-16").inputValue(), "browser-e2e-peer");
            await page.getByText("Optional TURN server settings", { exact: true }).click();
            assertEquals(await page.getByPlaceholder("turn:turn.example.com:3478").inputValue(), "turn:127.0.0.1:3478");
            assertEquals(await page.getByPlaceholder("Enter TURN username").inputValue(), "browser-turn-user");
            assertEquals(
                await page.getByPlaceholder("Enter TURN credential").inputValue(),
                "browser-turn-credential"
            );
            assertEquals(await page.getByRole("button", { name: "Connect", exact: true }).isVisible(), true);
            assertNoPageFailures();
        } finally {
            await browser.close();
            await server.close();
        }
    },
});
