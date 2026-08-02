import type { Locator, Page } from "playwright";
import { captureObsidianDialogue, withObsidianPage } from "./ui.ts";

const remoteSetupStateKey = "__livesyncE2ERemoteSetup";

export type RemoteInspectionMode = "failed" | "verified";

export type RemoteSetupCall = {
    journalFormat: string;
    operation: "create" | "inspect" | "test";
    remoteType: string;
};

type RemoteSetupBrowserState = {
    calls: RemoteSetupCall[];
    inspectionMode: RemoteInspectionMode;
    nextProfileName: string;
    unregister?: () => void;
};

type RuntimeRemoteConfiguration = {
    id: string;
    isEncrypted: boolean;
    name: string;
    uri: string;
};

type RuntimeSettings = {
    activeConfigurationId: string;
    remoteConfigurations: Record<string, RuntimeRemoteConfiguration>;
};

type RuntimePlugin = {
    core: {
        services: {
            replicator: {
                getNewReplicator: {
                    addHandler: (...args: unknown[]) => () => void;
                } & ((settingOverride?: Record<string, unknown>) => Promise<unknown>);
            };
            setting: {
                currentSettings(): RuntimeSettings;
            };
            UI: {
                confirm: {
                    askString(
                        title: string,
                        label: string,
                        placeholder: string,
                        isPassword?: boolean
                    ): Promise<string | false>;
                };
            };
        };
    };
};

type RuntimeSettingsController = {
    close(): void;
    open(): void;
    openTabById(tabId: string): void;
};

type RuntimeApp = {
    plugins?: { plugins: Record<string, RuntimePlugin | undefined> };
    setting?: RuntimeSettingsController;
};

type RuntimeGlobal = typeof globalThis & {
    app?: RuntimeApp;
    [remoteSetupStateKey]?: RemoteSetupBrowserState;
};

export function remoteSelectionModal(page: Page): Locator {
    return page.locator(".modal-container").filter({
        has: page.locator(".modal-title").filter({ hasText: "Choose a synchronisation remote" }),
    });
}

export function remoteProviderModal(page: Page, title: string): Locator {
    return page.locator(".modal-container").filter({
        has: page.locator(".modal-title").filter({ hasText: title }),
    });
}

export function remoteConfigurationPanel(page: Page): Locator {
    return page
        .locator(".sls-setting h4.sls-setting-panel-title")
        .filter({ hasText: "Connection settings" })
        .locator("..");
}

function remoteProfileRow(page: Page, profileName: string): Locator {
    return remoteConfigurationPanel(page).locator(".sls-remote-list .setting-item").filter({ hasText: profileName });
}

async function tooltipButton(container: Locator, label: string, fallbackText: string): Promise<Locator> {
    const labelled = container.locator(`button[aria-label="${label}"], button[title="${label}"]`);
    if ((await labelled.count()) > 0) return labelled.first();
    return container.locator("button").filter({ hasText: fallbackText }).first();
}

export async function installRemoteSetupTestSeam(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate((stateKey) => {
            const runtime = globalThis as RuntimeGlobal;
            const plugin = runtime.app?.plugins?.plugins["obsidian-livesync"];
            if (!plugin) throw new Error("Self-hosted LiveSync is not loaded");
            const state: RemoteSetupBrowserState = {
                calls: [],
                inspectionMode: "verified",
                nextProfileName: "",
            };
            runtime[stateKey as typeof remoteSetupStateKey] = state;

            const getNewReplicator = plugin.core.services.replicator.getNewReplicator;
            const replacements = {
                async createReplicator(settingOverride: Record<string, unknown> = {}) {
                    const remoteType = String(settingOverride.remoteType ?? "");
                    const journalFormat = String(settingOverride.journalFormat ?? "");
                    state.calls.push({ journalFormat, operation: "create", remoteType });
                    return {
                        async inspectJournalStorageConnection(settings: Record<string, unknown>) {
                            state.calls.push({
                                journalFormat: String(settings.journalFormat ?? ""),
                                operation: "inspect",
                                remoteType: String(settings.remoteType ?? ""),
                            });
                            if (state.inspectionMode === "failed") {
                                return {
                                    adaptiveCapabilities: {
                                        byteRange: { status: "not-checked" },
                                        required: { missing: ["conditional-create"], status: "unsupported" },
                                    },
                                    available: false,
                                    remoteFormat: "empty",
                                };
                            }
                            return {
                                adaptiveCapabilities: {
                                    byteRange: { status: "verified" },
                                    required: { status: "verified" },
                                },
                                available: true,
                                remoteFormat: "empty",
                            };
                        },
                        async tryConnectRemote(settings: Record<string, unknown>) {
                            state.calls.push({
                                journalFormat: String(settings.journalFormat ?? ""),
                                operation: "test",
                                remoteType: String(settings.remoteType ?? ""),
                            });
                            return state.inspectionMode === "verified";
                        },
                    };
                },
                async askString(title: string, label: string, placeholder: string, isPassword: boolean = false) {
                    if (title !== "Remote name") return await originalAskString(title, label, placeholder, isPassword);
                    const name = state.nextProfileName;
                    state.nextProfileName = "";
                    if (!name) throw new Error("The remote setup E2E did not supply a profile name");
                    return name;
                },
            };
            state.unregister = getNewReplicator.addHandler(replacements.createReplicator, -1000, true);

            const confirm = plugin.core.services.UI.confirm;
            const originalAskString = confirm.askString.bind(confirm);
            confirm.askString = replacements.askString;
        }, remoteSetupStateKey);
    });
}

export async function setRemoteInspectionMode(port: number, mode: RemoteInspectionMode): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate(
            ({ mode, stateKey }) => {
                const state = (globalThis as RuntimeGlobal)[stateKey as typeof remoteSetupStateKey];
                if (!state) throw new Error("The remote setup E2E seam is not installed");
                state.inspectionMode = mode;
            },
            { mode, stateKey: remoteSetupStateKey }
        );
    });
}

export async function remoteSetupCalls(port: number): Promise<RemoteSetupCall[]> {
    return await withObsidianPage(port, async (page) => {
        return await page.evaluate((stateKey) => {
            const state = (globalThis as RuntimeGlobal)[stateKey as typeof remoteSetupStateKey];
            if (!state) throw new Error("The remote setup E2E seam is not installed");
            return state.calls;
        }, remoteSetupStateKey);
    });
}

export async function openRemoteConfigurationSettings(port: number, timeoutMs: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate(() => {
            const setting = (globalThis as RuntimeGlobal).app?.setting;
            if (!setting) throw new Error("Obsidian settings are unavailable");
            setting.close();
        });
        await page.waitForTimeout(100);
        await page.evaluate(() => {
            const setting = (globalThis as RuntimeGlobal).app?.setting;
            if (!setting) throw new Error("Obsidian settings are unavailable");
            setting.open();
            setting.openTabById("obsidian-livesync");
        });
        const settings = page.locator(".sls-setting");
        try {
            await settings.waitFor({ state: "visible", timeout: timeoutMs });
        } catch (error) {
            const modalTitles = await page.locator(".modal-title").allTextContents();
            const settingTabs = await page.locator(".vertical-tab-nav-item").allTextContents();
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(
                `The LiveSync settings pane did not become visible. Open modal titles: ${JSON.stringify(modalTitles)}. Settings tabs: ${JSON.stringify(settingTabs)}. Cause: ${reason}`
            );
        }
        await settings.locator('.sls-setting-menu-btn[title="Remote Configuration"]').click({ timeout: timeoutMs });
        await remoteConfigurationPanel(page).waitFor({ state: "visible", timeout: timeoutMs });
    });
}

export async function closeRemoteConfigurationSettings(port: number, timeoutMs: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate(() => {
            const setting = (globalThis as RuntimeGlobal).app?.setting;
            if (!setting) throw new Error("Obsidian settings are unavailable");
            setting.close();
        });
        await page.locator(".sls-setting").waitFor({ state: "hidden", timeout: timeoutMs });
    });
}

export async function beginRemoteProfileSetup(port: number, profileName: string, timeoutMs: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate(
            ({ profileName, stateKey }) => {
                const state = (globalThis as RuntimeGlobal)[stateKey as typeof remoteSetupStateKey];
                if (!state) throw new Error("The remote setup E2E seam is not installed");
                state.nextProfileName = profileName;
            },
            { profileName, stateKey: remoteSetupStateKey }
        );
        const add = await tooltipButton(remoteConfigurationPanel(page), "Add new connection", "➕");
        await add.click({ timeout: timeoutMs });
        await remoteSelectionModal(page).waitFor({ state: "visible", timeout: timeoutMs });
    });
}

export async function captureRemoteProviderChoices(
    port: number,
    filename: string,
    labels: readonly string[],
    timeoutMs: number
): Promise<string> {
    return await captureObsidianDialogue(port, filename, async (page) => {
        const modal = remoteSelectionModal(page);
        await modal.waitFor({ state: "visible", timeout: timeoutMs });
        for (const label of labels) {
            await modal.getByText(label, { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
        }
    });
}

export async function selectRemoteProvider(
    port: number,
    choiceLabel: string,
    proceedLabel: string,
    providerTitle: string,
    timeoutMs: number
): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const selection = remoteSelectionModal(page);
        await selection
            .locator("label")
            .filter({ hasText: choiceLabel })
            .locator('input[type="radio"]')
            .first()
            .check({ timeout: timeoutMs });
        await selection.getByRole("button", { name: proceedLabel, exact: true }).click({ timeout: timeoutMs });
        await remoteProviderModal(page, providerTitle).waitFor({ state: "visible", timeout: timeoutMs });
    });
}

export async function captureAndCancelRemoteProvider(
    port: number,
    filename: string,
    providerTitle: string,
    timeoutMs: number
): Promise<string> {
    const screenshot = await captureObsidianDialogue(port, filename, async (page) => {
        await remoteProviderModal(page, providerTitle).waitFor({ state: "visible", timeout: timeoutMs });
    });
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, providerTitle);
        await modal.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: timeoutMs });
        await modal.waitFor({ state: "hidden", timeout: timeoutMs });
    });
    return screenshot;
}

export async function waitForSavedRemoteProfile(port: number, profileName: string, timeoutMs: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await remoteProfileRow(page, profileName).waitFor({ state: "visible", timeout: timeoutMs });
    });
}

export async function openSavedRemoteProfile(port: number, profileName: string, timeoutMs: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const row = remoteProfileRow(page, profileName);
        await row.waitFor({ state: "visible", timeout: timeoutMs });
        const configure = await tooltipButton(row, "Configure", "🔧");
        await configure.click({ timeout: timeoutMs });
    });
}

export async function runtimeRemoteSettings(port: number): Promise<RuntimeSettings> {
    return await withObsidianPage(port, async (page) => {
        return await page.evaluate(() => {
            const plugin = (globalThis as RuntimeGlobal).app?.plugins?.plugins["obsidian-livesync"];
            if (!plugin) throw new Error("Self-hosted LiveSync is not loaded");
            return structuredClone(plugin.core.services.setting.currentSettings());
        });
    });
}
