import type { P2PSyncSetting } from "@/lib/src/common/types";
import { delay } from "octagonal-wheels/promises";
import type { BrowserContext, Page } from "playwright";
import type { Plugin } from "vitest/config";
import type { BrowserCommand } from "vitest/node";
import { serialized } from "octagonal-wheels/concurrency/lock";
export const grantClipboardPermissions: BrowserCommand = async (ctx) => {
    if (ctx.provider.name === "playwright") {
        await ctx.context.grantPermissions(["clipboard-read", "clipboard-write"]);
        console.log("Granted clipboard permissions");
        return;
    }
};
let peerPage: Page | undefined;
let peerPageContext: BrowserContext | undefined;
let previousName = "";
async function setValue(page: Page, selector: string, value: string) {
    const e = await page.waitForSelector(selector);
    await e.fill(value);
}
async function closePeerContexts() {
    const peerPageLocal = peerPage;
    const peerPageContextLocal = peerPageContext;
    if (peerPageLocal) {
        await peerPageLocal.close();
    }
    if (peerPageContextLocal) {
        await peerPageContextLocal.close();
    }
}
export const openWebPeer: BrowserCommand<[P2PSyncSetting, serverPeerName: string]> = async (
    ctx,
    setting: P2PSyncSetting,
    serverPeerName: string = "p2p-livesync-web-peer"
) => {
    if (ctx.provider.name === "playwright") {
        const previousPage = ctx.page;
        if (peerPage !== undefined) {
            if (previousName === serverPeerName) {
                console.log(`WebPeer for ${serverPeerName} already opened`);
                return;
            }
            console.log(`Closing previous WebPeer for ${previousName}`);
            await closePeerContexts();
        }
        console.log(`Opening webPeer`);
        return serialized("webpeer", async () => {
            const browser = ctx.context.browser()!;
            const context = await browser.newContext();
            peerPageContext = context;
            peerPage = await context.newPage();
            previousName = serverPeerName;
            console.log(`Navigating...`);
            await peerPage.goto("http://localhost:8081");
            await peerPage.waitForLoadState();
            console.log(`Navigated!`);
            await setValue(peerPage, "#app > main  [placeholder*=wss]", setting.P2P_relays);
            await setValue(peerPage, "#app > main  [placeholder*=anything]", setting.P2P_roomID);
            await setValue(peerPage, "#app > main  [placeholder*=password]", setting.P2P_passphrase);
            await setValue(peerPage, "#app > main  [placeholder*=iphone]", serverPeerName);
            // await peerPage.getByTitle("Enable P2P Replicator").setChecked(true);
            await peerPage.getByRole("checkbox").first().setChecked(true);
            // (await peerPage.waitForSelector("Save and Apply")).click();
            await peerPage.getByText("Save and Apply").click();
            await delay(100);
            await peerPage.reload();
            await delay(500);
            for (let i = 0; i < 10; i++) {
                await delay(100);
                const btn = peerPage.getByRole("button").filter({ hasText: /^connect/i });
                if ((await peerPage.getByText(/disconnect/i).count()) > 0) {
                    break;
                }
                await btn.click();
            }
            await previousPage.bringToFront();
            ctx.context.on("close", async () => {
                console.log("Browser context is closing, closing peer page if exists");
                await closePeerContexts();
            });
            console.log("Web peer page opened");
        });
    }
};

export const closeWebPeer: BrowserCommand = async (ctx) => {
    if (ctx.provider.name === "playwright") {
        return serialized("webpeer", async () => {
            await closePeerContexts();
            peerPage = undefined;
            peerPageContext = undefined;
            previousName = "";
            console.log("Web peer page closed");
        });
    }
};
export const acceptWebPeer: BrowserCommand = async (ctx) => {
    if (peerPage) {
        // Detect dialogue
        const buttonsOnDialogs = await peerPage.$$("popup .buttons button");
        for (const b of buttonsOnDialogs) {
            const text = (await b.innerText()).toLowerCase();
            // console.log(`Dialog button found: ${text}`);
            if (text === "accept") {
                console.log("Accepting dialog");
                await b.click({ timeout: 300 });
                await delay(500);
            }
        }
        const buttons = peerPage.getByRole("button").filter({ hasText: /^accept$/i });
        const a = await buttons.all();
        for (const b of a) {
            await b.click({ timeout: 300 });
        }
    }
    return false;
};

export default function BrowserCommands(): Plugin {
    return {
        name: "vitest:custom-commands",
        config() {
            return {
                test: {
                    browser: {
                        commands: {
                            grantClipboardPermissions,
                            openWebPeer,
                            closeWebPeer,
                            acceptWebPeer,
                        },
                    },
                },
            };
        },
    };
}
declare module "vitest/browser" {
    interface BrowserCommands {
        grantClipboardPermissions: () => Promise<void>;
        openWebPeer: (setting: P2PSyncSetting, serverPeerName: string) => Promise<void>;
        closeWebPeer: () => Promise<void>;
        acceptWebPeer: () => Promise<boolean>;
    }
}
