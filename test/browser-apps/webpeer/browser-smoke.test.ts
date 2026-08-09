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
            assertEquals(
                await page
                    .getByRole("link", { name: "Try the P2P connection check", exact: true })
                    .getAttribute("href"),
                "./check.html"
            );

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
            assertEquals(await page.getByPlaceholder("Enter TURN credential").inputValue(), "browser-turn-credential");
            assertEquals(await page.getByRole("button", { name: "Connect", exact: true }).isVisible(), true);
            assertNoPageFailures();
        } finally {
            await browser.close();
            await server.close();
        }
    },
});

Deno.test({
    name: "WebPeer: P2P connection check prepares a local Setup URI and zeroed diagnostics",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const server = await startStaticServer(webPeerDist);
        const browser = await chromium.launch({ headless: true });
        try {
            for (const target of ["desktop", "mobile"] as const) {
                const page = await browser.newPage();
                const assertNoPageFailures = observePageFailures(page);
                try {
                    await page.goto(`${server.baseUrl}check.html`);
                    await page.getByRole("heading", { name: "P2P connection check", exact: true }).waitFor({
                        timeout: 30_000,
                    });
                    if (target === "mobile") {
                        await page.locator('input[type="radio"][value="mobile"]').check();
                    }

                    await page.getByRole("button", { name: `Prepare ${target} check`, exact: true }).click();
                    await page.getByAltText(`Setup URI QR code for the ${target} check`, { exact: true }).waitFor({
                        timeout: 30_000,
                    });

                    const setupURI = await page.getByLabel("Setup URI", { exact: true }).inputValue();
                    const passphrase = await page.getByLabel("Setup URI passphrase", { exact: true }).inputValue();
                    const qrSource = await page
                        .getByAltText(`Setup URI QR code for the ${target} check`, { exact: true })
                        .getAttribute("src");

                    assertEquals(setupURI.startsWith("obsidian://setuplivesync?settings="), true);
                    assertEquals(/^[a-z2-9]{4}(?:-[a-z2-9]{4}){3}$/.test(passphrase), true);
                    assertEquals(qrSource?.startsWith("data:image/"), true);
                    for (const label of ["Setup URI", "Setup URI passphrase"] as const) {
                        const credentialField = page.getByLabel(label, { exact: true });
                        assertEquals(await credentialField.getAttribute("autocomplete"), "off");
                        assertEquals(await credentialField.getAttribute("spellcheck"), "false");
                    }
                    assertEquals(await page.getByTestId("diag-new").textContent(), "0");
                    assertEquals(await page.getByTestId("diag-successful").textContent(), "0");
                    assertEquals(await page.getByTestId("diag-failed").textContent(), "0");
                    assertEquals(await page.getByTestId("diag-closed").textContent(), "0");
                    assertEquals(
                        await page.getByRole("button", { name: "Start connection monitor", exact: true }).isVisible(),
                        true
                    );
                    assertEquals(
                        await page
                            .getByRole("button", { name: "Try another device without resetting", exact: true })
                            .count(),
                        0
                    );

                    await page.locator(".results-card").scrollIntoViewIfNeeded();
                    await page.getByRole("button", { name: "Show the Setup QR again", exact: true }).click();
                    await waitFor(
                        async () =>
                            await page
                                .getByAltText(`Setup URI QR code for the ${target} check`, { exact: true })
                                .evaluate((element) => {
                                    const rect = element.getBoundingClientRect();
                                    return rect.top >= 0 && rect.bottom <= document.documentElement.clientHeight;
                                }),
                        `The ${target} Setup QR did not return to the viewport`
                    );
                    assertEquals(await page.getByLabel("Setup URI", { exact: true }).inputValue(), setupURI);
                    assertNoPageFailures();
                } finally {
                    await page.close();
                }
            }
        } finally {
            await browser.close();
            await server.close();
        }
    },
});
