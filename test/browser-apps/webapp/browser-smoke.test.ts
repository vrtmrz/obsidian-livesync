import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { chromium } from "playwright";

import { observePageFailures, startStaticServer, waitFor } from "../helpers/browser.ts";

const webAppDist = resolve(import.meta.dirname!, "../../../src/apps/webapp/dist");

Deno.test({
    name: "WebApp: production bundle selects a Vault and preserves the main remote while saving P2P settings",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const server = await startStaticServer(webAppDist);
        const browser = await chromium.launch({ headless: true });
        try {
            const cancellationPage = await browser.newPage();
            const assertNoCancellationFailures = observePageFailures(cancellationPage);
            await cancellationPage.addInitScript(`
                Object.defineProperty(globalThis, "showDirectoryPicker", {
                    configurable: true,
                    value: async () => {
                        throw new DOMException("Cancelled by WebApp browser test", "AbortError");
                    },
                });
            `);
            await cancellationPage.goto(new URL("webapp.html", server.baseUrl).href);
            await cancellationPage.locator("#status").filter({ hasText: "Select a vault folder" }).waitFor();
            const picker = cancellationPage.getByRole("button", { name: "Choose new vault folder" });
            await picker.click();
            await cancellationPage
                .locator("#status.warning")
                .filter({ hasText: "Vault selection was cancelled" })
                .waitFor();
            assertEquals(await picker.isEnabled(), true);
            assertEquals(await cancellationPage.locator("#vault-selector").isVisible(), true);
            assertNoCancellationFailures();
            await cancellationPage.close();

            const runtimePage = await browser.newPage();
            const assertNoRuntimeFailures = observePageFailures(runtimePage);
            await runtimePage.addInitScript(`
                Object.defineProperty(globalThis, "showDirectoryPicker", {
                    configurable: true,
                    value: async () => {
                        const originRoot = await navigator.storage.getDirectory();
                        try {
                            await originRoot.removeEntry("livesync-webapp-smoke", { recursive: true });
                        } catch (error) {
                            if (error?.name !== "NotFoundError") throw error;
                        }
                        return await originRoot.getDirectoryHandle("livesync-webapp-smoke", { create: true });
                    },
                });
            `);
            await runtimePage.goto(new URL("webapp.html", server.baseUrl).href);
            await runtimePage.getByRole("button", { name: "Choose new vault folder" }).click();
            await runtimePage.locator("#vault-selector").waitFor({ state: "hidden", timeout: 30_000 });
            await runtimePage.waitForFunction("globalThis.livesyncApp?.getRuntime() != null");
            await runtimePage.locator("#status.warning").filter({ hasText: "Please configure CouchDB" }).waitFor();

            const state = await runtimePage.evaluate(async () => {
                const app = (
                    globalThis as typeof globalThis & {
                        livesyncApp?: {
                            getRuntime(): unknown;
                            historyStore: {
                                getVaultHistory(): Promise<Array<{ name: string }>>;
                            };
                        };
                    }
                ).livesyncApp;
                return {
                    historyNames: (await app!.historyStore.getVaultHistory()).map((item) => item.name),
                    runtimeStarted: app!.getRuntime() != null,
                };
            });
            assertEquals(state, {
                historyNames: ["livesync-webapp-smoke"],
                runtimeStarted: true,
            });

            await runtimePage.getByRole("heading", { name: "Peer to Peer Replicator", exact: true }).waitFor();
            await runtimePage.evaluate(() => {
                const runtime = (
                    globalThis as typeof globalThis & {
                        livesyncApp?: {
                            getRuntime(): {
                                events: {
                                    emitEvent(name: string, payload: unknown): void;
                                };
                            } | null;
                        };
                    }
                ).livesyncApp?.getRuntime();
                runtime?.events.emitEvent("p2p-server-status", {
                    isConnected: true,
                    knownAdvertisements: [
                        {
                            isAccepted: true,
                            name: "Peer without WebApp menu",
                            peerId: "peer-without-webapp-menu",
                        },
                    ],
                    serverPeerId: "webapp-browser-smoke",
                });
            });
            await runtimePage.getByText("Peer without WebApp menu", { exact: true }).waitFor();
            assertEquals(
                await runtimePage.getByRole("button", { name: "...", exact: true }).count(),
                0,
                "WebApp must not render a peer-menu action without a menu capability"
            );
            await runtimePage.locator(".p2p-control input[type='checkbox']").first().check();
            await runtimePage.getByPlaceholder("wss://exp-relay.vrtmrz.net, wss://xxxxx").fill("ws://127.0.0.1:4010/");
            await runtimePage.getByPlaceholder("anything-you-like").fill("browser-e2e-room");
            await runtimePage.getByPlaceholder("password").fill("browser-e2e-passphrase");
            await runtimePage.getByPlaceholder("iphone-16").fill("browser-e2e-webapp");
            const save = runtimePage.getByRole("button", { name: "Save and Apply", exact: true });
            await save.click();
            await waitFor(async () => await save.isDisabled(), "WebApp did not finish applying P2P settings");

            const primaryRemote = await runtimePage.evaluate(() => {
                const runtime = (
                    globalThis as typeof globalThis & {
                        livesyncApp?: {
                            getRuntime(): {
                                p2pPaneHost: {
                                    services: {
                                        setting: {
                                            currentSettings(): {
                                                isConfigured: boolean;
                                                remoteType: string;
                                            };
                                        };
                                    };
                                };
                            } | null;
                        };
                    }
                ).livesyncApp?.getRuntime();
                const settings = runtime?.p2pPaneHost.services.setting.currentSettings();
                return {
                    isConfigured: settings?.isConfigured,
                    remoteType: settings?.remoteType,
                };
            });
            assertEquals(primaryRemote, {
                isConfigured: false,
                remoteType: "",
            });
            await runtimePage.getByRole("button", { name: "Scan local files", exact: true }).waitFor();
            assertNoRuntimeFailures();
        } finally {
            await browser.close();
            await server.close();
        }
    },
});

Deno.test({
    name: "WebApp: rejects NFC settings before opening a database, scanning, writing, or synchronising",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const server = await startStaticServer(webAppDist);
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            const assertNoFailures = observePageFailures(page);
            await page.addInitScript(`
                Object.defineProperty(globalThis, "showDirectoryPicker", {
                    configurable: true,
                    value: async () => {
                        const originRoot = await navigator.storage.getDirectory();
                        const root = await originRoot.getDirectoryHandle("livesync-webapp-nfc-refusal", { create: true });
                        const settingsDirectory = await root.getDirectoryHandle(".livesync", { create: true });
                        const settingsText = JSON.stringify({
                            pathNormalizationVersion: 1, isConfigured: true, liveSync: true,
                            couchDB_URI: "https://couchdb.example.invalid", couchDB_DBNAME: "nfc-refusal-test"
                        });
                        const settingsWriter = await (await settingsDirectory.getFileHandle("settings.json", { create: true })).createWritable();
                        await settingsWriter.write(settingsText);
                        await settingsWriter.close();
                        const sentinelWriter = await (await root.getFileHandle("Résumé.md".normalize("NFD"), { create: true })).createWritable();
                        await sentinelWriter.write("retained native content");
                        await sentinelWriter.close();
                        const audit = globalThis.webAppIdentityAudit = {
                            settingsText, writes: 0, scans: 0, opens: [], remoteRequests: [],
                            databaseNamesBefore: (await indexedDB.databases()).map(item => item.name).sort()
                        };
                        const open = IDBFactory.prototype.open;
                        IDBFactory.prototype.open = function(...args) {
                            audit.opens.push(String(args[0]));
                            return Reflect.apply(open, this, args);
                        };
                        const createWritable = FileSystemFileHandle.prototype.createWritable;
                        FileSystemFileHandle.prototype.createWritable = function(...args) {
                            audit.writes++;
                            return Reflect.apply(createWritable, this, args);
                        };
                        for (const key of ["entries", "values", Symbol.asyncIterator]) {
                            const original = FileSystemDirectoryHandle.prototype[key];
                            if (typeof original !== "function") continue;
                            FileSystemDirectoryHandle.prototype[key] = function(...args) {
                                audit.scans++;
                                return Reflect.apply(original, this, args);
                            };
                        }
                        const fetch = globalThis.fetch;
                        globalThis.fetch = function(input, ...args) {
                            const url = String(input?.url ?? input);
                            if (url.startsWith("https://couchdb.example.invalid")) {
                                audit.remoteRequests.push(url);
                                return Promise.resolve(new Response("{}", { status: 503 }));
                            }
                            return Reflect.apply(fetch, this, [input, ...args]);
                        };
                        return root;
                    }
                });
            `);
            await page.goto(new URL("webapp.html", server.baseUrl).href);
            await page.locator("#status").filter({ hasText: "Select a vault folder" }).waitFor();
            await page.getByRole("button", { name: "Choose new vault folder" }).click();
            await page.locator("#status.error").filter({ hasText: "WebApp supports Legacy path identity" }).waitFor();
            const state = await page.evaluate(async () => {
                const globals = globalThis as typeof globalThis & {
                    webAppIdentityAudit: {
                        settingsText: string;
                        writes: number;
                        scans: number;
                        opens: string[];
                        remoteRequests: string[];
                        databaseNamesBefore: Array<string | undefined>;
                    };
                    livesyncApp: { getRuntime(): unknown };
                };
                const audit = globals.webAppIdentityAudit;
                const root = await (
                    await navigator.storage.getDirectory()
                ).getDirectoryHandle("livesync-webapp-nfc-refusal");
                const settingsDirectory = await root.getDirectoryHandle(".livesync");
                return {
                    runtime: globals.livesyncApp.getRuntime(),
                    writes: audit.writes,
                    scans: audit.scans,
                    appDatabaseOpens: audit.opens.filter((name) => name !== "livesync-webapp-handles"),
                    remoteRequests: audit.remoteRequests,
                    databaseNamesBefore: audit.databaseNamesBefore,
                    databaseNamesAfter: (await indexedDB.databases()).map((item) => item.name).sort(),
                    settingsUnchanged:
                        (await (await (await settingsDirectory.getFileHandle("settings.json")).getFile()).text()) ===
                        audit.settingsText,
                    sentinel: await (await (await root.getFileHandle("Résumé.md".normalize("NFD"))).getFile()).text(),
                };
            });
            assertEquals(state.runtime, null);
            assertEquals(state.writes, 0);
            assertEquals(state.scans, 0);
            assertEquals(state.appDatabaseOpens, []);
            assertEquals(state.remoteRequests, []);
            assertEquals(state.databaseNamesAfter, state.databaseNamesBefore);
            assertEquals(state.settingsUnchanged, true);
            assertEquals(state.sentinel, "retained native content");
            assertEquals(await page.locator("#vault-selector").isVisible(), true);
            assertEquals(await page.getByRole("button", { name: "Scan local files", exact: true }).count(), 0);
            assertNoFailures();
        } finally {
            await browser.close();
            await server.close();
        }
    },
});
