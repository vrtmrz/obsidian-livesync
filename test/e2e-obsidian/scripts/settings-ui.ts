import { mkdir } from "node:fs/promises";
import { VER } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { assertMobileDialogueLayout, setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import {
    allowPendingObsidianTestVaultOpenAction,
    captureObsidianDialogue,
    obsidianRemoteDebuggingPort,
    openLiveSyncSettings,
    preseedTrustedVaultState,
    waitForVisibleObsidianDialogue,
    withObsidianPage,
} from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";
import type { Locator, Page } from "playwright";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETTINGS_TIMEOUT_MS ?? 10000);
const settingsOnly = process.env.E2E_OBSIDIAN_SETTINGS_ONLY === "true";
const diagnosticsDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
const settingsInitialisationRunStateKey = "__livesyncE2ESettingsInitialisation";
const settingsScreenshotOptions = {
    animations: "disabled" as const,
    style: ".notice-container { visibility: hidden !important; }",
};
const compatibilityReviewMessage = "Review the internal database compatibility change before synchronisation resumes.";

type LiveSyncTestPlugin = {
    core: {
        modules: {
            constructor: { name: string };
            applySettingsWithInitialisationChoice?: (options: {
                applySettings: () => Promise<void>;
                isP2P: boolean;
            }) => Promise<unknown>;
            settingTab?: {
                editingSettings: { isConfigured: boolean };
                initialSettings?: { isConfigured: boolean };
                requestCatalogueRefresh(): void;
            };
        }[];
        settings: {
            handleFilenameCaseSensitive: boolean;
        };
        services: {
            setting: {
                currentSettings(): {
                    versionUpFlash: string;
                    allowSleepDuringSynchronisation: boolean;
                    allowSleepDuringSynchronisationOnDesktop: boolean;
                    useAdvancedMode: boolean;
                    usePowerUserMode: boolean;
                    useEdgeCaseMode: boolean;
                    hashCacheMaxCount: number;
                };
                getSmallConfig(key: string): string | null;
            };
        };
    };
};

type SettingsInitialisationRunState = {
    done: boolean;
    error?: string;
    result?: unknown;
};

type ObsidianTestApp = {
    plugins?: { plugins: Record<string, LiveSyncTestPlugin | undefined> };
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

const settingsPageNames = [
    "Appearance",
    "Logging",
    "Extra menus",
    "Remote Configuration",
    "Sync Settings",
    "Maintenance",
    "Hatch",
    "Selector",
    "Customisation sync",
    "Advanced",
    "Power users",
    "Patches",
    "Help and troubleshooting",
    "Change Log",
] as const;

async function assertDeclarativeLandingOrder(root: Locator, configured: boolean): Promise<void> {
    const synchronisation = ["Synchronisation", "Remote Configuration", "Sync Settings"];
    const generalSettings = ["General Settings", "Appearance", "Logging", "Extra menus"];
    const setup = configured
        ? [...synchronisation, ...generalSettings, "📲 Set up other devices", "Quick Setup"]
        : ["Quick Setup", ...synchronisation, ...generalSettings, "📲 Set up other devices"];
    const labels = [
        ...setup,
        "Maintenance and recovery",
        "Maintenance",
        "Hatch",
        "Extra features",
        "Selector",
        "Customisation sync",
        "Advanced settings",
        "Advanced",
        "Power users",
        "Patches",
        "Help and information",
        "Help and troubleshooting",
        "Change Log",
    ];
    await root
        .locator(".vertical-tab-content:visible")
        .last()
        .evaluate((container, expectedLabels) => {
            const labelledElements = Array.from(
                container.querySelectorAll(".setting-item-heading, .setting-item-name, h1, h2, h3, h4")
            );
            const matchingElements = expectedLabels.map((label) => {
                const match = labelledElements.find((element) => element.textContent?.trim().endsWith(label));
                if (!match) throw new Error(`The settings landing page did not contain '${label}'.`);
                return match;
            });
            for (let index = 1; index < matchingElements.length; index++) {
                const previous = matchingElements[index - 1];
                const current = matchingElements[index];
                if (!(previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING)) {
                    throw new Error(`The settings landing page was not ordered as ${expectedLabels.join(" -> ")}.`);
                }
            }
        }, labels);
}

async function scrollDeclarativeLandingToTop(root: Locator, configured: boolean): Promise<void> {
    const firstHeading = root
        .locator(".setting-item-heading")
        .filter({ hasText: configured ? "Synchronisation" : "Quick Setup" })
        .first();
    await firstHeading.waitFor({ state: "visible", timeout: uiTimeoutMs });
    await firstHeading.scrollIntoViewIfNeeded();
}

async function setConfiguredStateForLandingInspection(page: Page, configured: boolean): Promise<void> {
    await page.evaluate((nextConfigured) => {
        const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
        if (plugin === undefined) throw new Error("Self-hosted LiveSync is unavailable");
        const settingDialogue = plugin.core.modules.find(
            (module) => module.constructor.name === "ModuleObsidianSettingDialogue"
        );
        if (settingDialogue?.settingTab === undefined) {
            throw new Error("The Self-hosted LiveSync setting tab is unavailable");
        }
        settingDialogue.settingTab.editingSettings.isConfigured = nextConfigured;
        if (settingDialogue.settingTab.initialSettings !== undefined) {
            settingDialogue.settingTab.initialSettings.isConfigured = nextConfigured;
        }
        settingDialogue.settingTab.requestCatalogueRefresh();
    }, configured);
}

async function captureDeclarativeMobileLanding(): Promise<string | undefined> {
    const port = obsidianRemoteDebuggingPort();
    await setObsidianMobileTestMode(port, true, uiTimeoutMs);
    try {
        return await withObsidianPage(port, async (page) => {
            const settingsNavigator = await openLiveSyncSettings(page, uiTimeoutMs);
            if (settingsNavigator.renderer !== "declarative") {
                await settingsNavigator.close();
                return undefined;
            }
            await settingsNavigator.returnToCatalogue();
            await scrollDeclarativeLandingToTop(settingsNavigator.dialogue, true);
            await assertDeclarativeLandingOrder(settingsNavigator.dialogue, true);
            const remoteConfiguration = settingsNavigator.dialogue
                .locator(".setting-item-name")
                .filter({ hasText: "Remote Configuration" })
                .first();
            await remoteConfiguration.waitFor({ state: "visible", timeout: uiTimeoutMs });
            const path = `${diagnosticsDirectory}/settings-declarative-landing-mobile.png`;
            await settingsNavigator.dialogue.screenshot({ ...settingsScreenshotOptions, path });
            const remotePosition = await remoteConfiguration.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                return { top: bounds.top, bottom: bounds.bottom, viewportHeight: window.innerHeight };
            });
            if (remotePosition.top < 0 || remotePosition.bottom > remotePosition.viewportHeight) {
                throw new Error("Remote Configuration was not visible at the top of the mobile settings landing page.");
            }
            await settingsNavigator.close();
            return path;
        });
    } finally {
        await setObsidianMobileTestMode(port, false, uiTimeoutMs);
    }
}

async function openSettingsInitialisationDialogueForInspection(isP2P: boolean): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.evaluate(
            ({ stateKey, isP2P }) => {
                const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                if (plugin === undefined) throw new Error("Self-hosted LiveSync is unavailable");
                const manager = plugin.core.modules.find((module) => module.constructor.name === "SetupManager");
                if (typeof manager?.applySettingsWithInitialisationChoice !== "function") {
                    throw new Error("Could not find the pending-settings initialisation workflow");
                }
                const state: SettingsInitialisationRunState = { done: false };
                (globalThis as unknown as Record<string, SettingsInitialisationRunState>)[stateKey] = state;
                void manager
                    .applySettingsWithInitialisationChoice({
                        isP2P,
                        applySettings: Promise.resolve.bind(Promise),
                    })
                    .then(
                        (result) => {
                            state.result = result;
                            state.done = true;
                        },
                        (error: unknown) => {
                            state.error = error instanceof Error ? error.message : String(error);
                            state.done = true;
                        }
                    );
            },
            { stateKey: settingsInitialisationRunStateKey, isP2P }
        );
    });
}

async function assertSettingsInitialisationRunCancelled(): Promise<void> {
    const state = await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.waitForFunction(
            (stateKey) =>
                (globalThis as unknown as Record<string, SettingsInitialisationRunState | undefined>)[stateKey]
                    ?.done === true,
            settingsInitialisationRunStateKey,
            { timeout: uiTimeoutMs }
        );
        return await page.evaluate(
            (stateKey) =>
                (globalThis as unknown as Record<string, SettingsInitialisationRunState | undefined>)[stateKey],
            settingsInitialisationRunStateKey
        );
    });
    if (!state) throw new Error("The pending-settings initialisation dialogue did not record its result.");
    if (state.error) throw new Error(`The pending-settings initialisation dialogue failed: ${state.error}`);
    if (JSON.stringify(state.result) !== JSON.stringify({ result: "cancelled" })) {
        throw new Error(`The pending-settings initialisation dialogue returned ${JSON.stringify(state.result)}.`);
    }
}

async function captureP2PSettingsInitialisationDialogue(): Promise<string> {
    await openSettingsInitialisationDialogueForInspection(true);
    const path = `${diagnosticsDirectory}/settings-initialisation-p2p.png`;
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const dialogue = await waitForVisibleObsidianDialogue(
            page,
            "Apply Settings and Reinitialise Synchronisation",
            uiTimeoutMs
        );
        await dialogue.getByText("Prepare This Device from This Vault", { exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        await dialogue.getByText("Reset Synchronisation on This Device", { exact: true }).click({
            timeout: uiTimeoutMs,
        });
        await dialogue.getByRole("button", { name: "Restart and Select a Source Device", exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        if (
            (await dialogue.getByText("Overwrite Server Data with This Device's Files", { exact: true }).count()) !== 0
        ) {
            throw new Error("The P2P initialisation dialogue exposed the central-server overwrite operation.");
        }
        await dialogue.screenshot({ ...settingsScreenshotOptions, path });
        await dialogue
            .getByRole("button", { name: "Review another way to apply these settings", exact: true })
            .click({ timeout: uiTimeoutMs });
        await dialogue.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    await assertSettingsInitialisationRunCancelled();
    return path;
}

async function resumePendingCompatibilityReviewForSettings(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const review = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({
                hasText: "Synchronisation paused for compatibility review",
            }),
        });
        if (!(await review.isVisible())) return;
        await review.getByRole("button", { name: "Resume synchronisation" }).click({ timeout: uiTimeoutMs });
        await review.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
}

async function verifyCompatibilityReview(): Promise<void> {
    const port = obsidianRemoteDebuggingPort();
    const summaryScreenshot = await captureObsidianDialogue(port, "compatibility-review-summary.png", async (page) => {
        const modal = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({
                hasText: "Synchronisation paused for compatibility review",
            }),
        });
        await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await modal
            .getByText("Your automatic synchronisation preferences have not been changed.", { exact: false })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        await modal
            .getByRole("button", { name: "Review compatibility details" })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        await modal
            .getByRole("button", {
                name: "Resume synchronisation",
            })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        await modal
            .getByRole("button", { name: "Keep synchronisation paused" })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
    });

    await withObsidianPage(port, async (page) => {
        const markerBeforeAcknowledgement = await page.evaluate(() => {
            const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
            if (plugin === undefined) throw new Error("Self-hosted LiveSync is unavailable");
            return plugin.core.services.setting.getSmallConfig("database-compatibility-version");
        });
        if (markerBeforeAcknowledgement !== null && markerBeforeAcknowledgement !== "") {
            throw new Error(
                `The database version was marked as acknowledged before review: ${markerBeforeAcknowledgement}`
            );
        }
    });

    await setObsidianMobileTestMode(port, true, uiTimeoutMs);
    const mobileSummaryScreenshot = await captureObsidianDialogue(
        port,
        "compatibility-review-summary-mobile.png",
        async (page) => {
            const summary = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({
                    hasText: "Synchronisation paused for compatibility review",
                }),
            });
            await summary.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await assertMobileDialogueLayout(page, summary, "compatibility review summary");
            const doctor = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Self-hosted LiveSync Config Doctor" }),
            });
            if (await doctor.isVisible()) {
                throw new Error("Config Doctor must wait until the initial compatibility review has closed.");
            }
        }
    );

    await withObsidianPage(port, async (page) => {
        const summary = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({
                hasText: "Synchronisation paused for compatibility review",
            }),
        });
        await summary.getByRole("button", { name: "Review compatibility details" }).click();
    });

    const detailsScreenshot = await captureObsidianDialogue(
        port,
        "compatibility-review-details-mobile.png",
        async (page) => {
            const modal = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Compatibility review details" }),
            });
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.getByText("Why synchronisation is paused", { exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            await modal.getByText("Remote replication is blocked before work begins.", { exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            await modal
                .getByRole("button", { name: "Back to compatibility review" })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            if ((await modal.getByRole("button", { name: "Keep synchronisation paused" }).count()) !== 0) {
                throw new Error("The explanatory details dialogue must not make the pause decision.");
            }
            await assertMobileDialogueLayout(page, modal, "compatibility review details");
        }
    );

    await withObsidianPage(port, async (page) => {
        const details = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Compatibility review details" }),
        });
        await details.getByRole("button", { name: "Back to compatibility review" }).click();
        const summary = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({
                hasText: "Synchronisation paused for compatibility review",
            }),
        });
        await summary.waitFor({ state: "visible", timeout: uiTimeoutMs });
    });

    await setObsidianMobileTestMode(port, false, uiTimeoutMs);
    await withObsidianPage(port, async (page) => {
        const summary = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({
                hasText: "Synchronisation paused for compatibility review",
            }),
        });
        await summary
            .getByRole("button", {
                name: "Resume synchronisation",
            })
            .click();
        await summary.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        await page.waitForFunction(
            (expectedVersion) => {
                const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                if (plugin === undefined) return false;
                const setting = plugin.core.services.setting;
                return (
                    setting.getSmallConfig("database-compatibility-version") === expectedVersion &&
                    setting.currentSettings().versionUpFlash === ""
                );
            },
            `${VER}`,
            { timeout: uiTimeoutMs }
        );
    });

    console.log(
        `Compatibility review screenshots: ${summaryScreenshot}, ${mobileSummaryScreenshot}, ${detailsScreenshot}`
    );
}

async function verifyConfigDoctorFollowsCompatibilityReview(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const doctor = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Self-hosted LiveSync Config Doctor" }),
        });
        await doctor.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await doctor.getByText("Per-file-saved customization sync", { exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        await doctor.getByText("Enhance chunk size", { exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        if ((await doctor.getByText("Data Compression", { exact: true }).count()) !== 0) {
            throw new Error("Config Doctor still treats supported Data Compression as a problem.");
        }
        await doctor.getByRole("button", { name: /No, and do not ask again/u }).click();
        await doctor.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
}

async function verifyEffectiveSettings(): Promise<"declarative" | "imperative"> {
    return await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const sleepPreferences = await page.evaluate(() => {
            const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
            if (plugin === undefined) throw new Error("Self-hosted LiveSync is unavailable");
            const settings = plugin.core.services.setting.currentSettings();
            return {
                general: settings.allowSleepDuringSynchronisation,
                desktop: settings.allowSleepDuringSynchronisationOnDesktop,
                advancedMode: settings.useAdvancedMode,
                powerUserMode: settings.usePowerUserMode,
                edgeCaseMode: settings.useEdgeCaseMode,
            };
        });
        if (
            sleepPreferences.general !== false ||
            sleepPreferences.desktop !== true ||
            sleepPreferences.advancedMode !== false ||
            sleepPreferences.powerUserMode !== false ||
            sleepPreferences.edgeCaseMode !== false
        ) {
            throw new Error(`Unexpected effective sleep preferences: ${JSON.stringify(sleepPreferences)}`);
        }

        let settingsNavigator = await openLiveSyncSettings(page, uiTimeoutMs);
        if (settingsNavigator.renderer === "imperative") {
            await settingsNavigator.dialogue.screenshot({
                ...settingsScreenshotOptions,
                path: `${diagnosticsDirectory}/settings-imperative-landing.png`,
            });
        }
        for (const hiddenPage of ["Selector", "Customisation sync", "Advanced", "Power users", "Patches"]) {
            if (await settingsNavigator.isPageListed(hiddenPage)) {
                throw new Error(`${hiddenPage} was visible before its feature level was enabled.`);
            }
        }

        let settingsPage = await settingsNavigator.openPage("Change Log");
        const removedAcknowledgements = settingsPage.getByRole("button", {
            name: /I got it and updated|OK, I have read everything/u,
        });
        if ((await removedAcknowledgements.count()) !== 0) {
            throw new Error("The Change Log still contains a compatibility or release-note acknowledgement control.");
        }

        settingsPage = await settingsNavigator.openPage("Remote Configuration");
        const connectionPanel = settingsPage
            .locator("h4.sls-setting-panel-title")
            .filter({ hasText: "Connection settings" })
            .locator("..");
        await connectionPanel.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await connectionPanel.getByText("Saved connections", { exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });

        settingsPage = await settingsNavigator.openPage("Sync Settings");
        const generalSleepSetting = settingsPage.locator(".setting-item").filter({
            has: settingsNavigator.page.getByText("Allow sleep during synchronisation", { exact: true }),
        });
        await generalSleepSetting.waitFor({ state: "visible", timeout: uiTimeoutMs });
        if ((await generalSleepSetting.locator(".checkbox-container.is-enabled").count()) !== 0) {
            throw new Error("The general sleep preference must be disabled by default.");
        }

        const desktopSleepSetting = settingsPage.locator(".setting-item").filter({
            has: settingsNavigator.page.getByText("Allow sleep during synchronisation on the desktop", {
                exact: true,
            }),
        });
        await desktopSleepSetting.waitFor({ state: "visible", timeout: uiTimeoutMs });
        if ((await desktopSleepSetting.locator(".checkbox-container.is-enabled").count()) !== 1) {
            throw new Error("The desktop sleep preference must be enabled by default.");
        }

        settingsPage = await settingsNavigator.openPage(
            settingsNavigator.renderer === "declarative" ? "Extra menus" : "General Settings"
        );
        const advancedModeSetting = settingsPage.locator(".setting-item").filter({
            has: settingsNavigator.page.getByText("Enable advanced features", { exact: true }),
        });
        await advancedModeSetting.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await advancedModeSetting.locator(".checkbox-container").click();
        await page.waitForFunction(
            () => {
                const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                return plugin?.core.services.setting.currentSettings().useAdvancedMode === true;
            },
            undefined,
            { timeout: uiTimeoutMs }
        );

        if (settingsNavigator.renderer === "declarative") {
            for (const mode of [
                { label: "Enable poweruser features", key: "usePowerUserMode" },
                { label: "Enable edge case treatment features", key: "useEdgeCaseMode" },
            ] as const) {
                const modeSetting = settingsPage.locator(".setting-item").filter({
                    has: settingsNavigator.page.getByText(mode.label, { exact: true }),
                });
                await modeSetting.locator(".checkbox-container").click({ timeout: uiTimeoutMs });
                await page.waitForFunction(
                    (key) => {
                        const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                        return plugin?.core.services.setting.currentSettings()[key] === true;
                    },
                    mode.key,
                    { timeout: uiTimeoutMs }
                );
            }
        }

        settingsPage = await settingsNavigator.openPage("Advanced");
        const cacheSizeSetting = settingsPage.locator(".setting-item").filter({
            has: settingsNavigator.page.getByText("Memory cache size (by total items)", { exact: true }),
        });
        await cacheSizeSetting.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const cacheSizeInput = cacheSizeSetting.locator('input[type="number"]');
        if (settingsNavigator.renderer === "declarative") {
            await cacheSizeInput.click();
            await cacheSizeInput.press("ControlOrMeta+A");
            await cacheSizeInput.pressSequentially("321");
            await cacheSizeInput.press("Enter");
        } else {
            await cacheSizeInput.fill("321");
        }
        await page.waitForFunction(
            () => {
                const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                return plugin?.core.services.setting.currentSettings().hashCacheMaxCount === 321;
            },
            undefined,
            { timeout: uiTimeoutMs }
        );

        if (settingsNavigator.renderer === "declarative") {
            await settingsNavigator.returnToCatalogue();
            await scrollDeclarativeLandingToTop(settingsNavigator.dialogue, true);
            await settingsNavigator.dialogue.screenshot({
                ...settingsScreenshotOptions,
                path: `${diagnosticsDirectory}/settings-declarative-landing.png`,
            });
            await assertDeclarativeLandingOrder(settingsNavigator.dialogue, true);
            await setConfiguredStateForLandingInspection(page, false);
            await scrollDeclarativeLandingToTop(settingsNavigator.dialogue, false);
            await assertDeclarativeLandingOrder(settingsNavigator.dialogue, false);
            await settingsNavigator.dialogue.screenshot({
                ...settingsScreenshotOptions,
                path: `${diagnosticsDirectory}/settings-declarative-landing-unconfigured.png`,
            });
            await setConfiguredStateForLandingInspection(page, true);
            await scrollDeclarativeLandingToTop(settingsNavigator.dialogue, true);
            await assertDeclarativeLandingOrder(settingsNavigator.dialogue, true);
            const rerunOnboarding = settingsNavigator.dialogue
                .locator(".setting-item-name")
                .filter({ hasText: "Rerun Onboarding Wizard" })
                .first();
            await rerunOnboarding
                .locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' setting-item ')][1]")
                .click({ timeout: uiTimeoutMs });
            const onboarding = await waitForVisibleObsidianDialogue(
                page,
                "Welcome to Self-hosted LiveSync",
                uiTimeoutMs
            );
            await onboarding
                .getByRole("button", { name: "No, please take me back", exact: true })
                .click({ timeout: uiTimeoutMs });
            await onboarding.waitFor({ state: "hidden", timeout: uiTimeoutMs });
            const search = settingsNavigator.dialogue.locator(".setting-search-container input");
            await search.fill("Memory cache size (by total items)");
            const searchResult = settingsNavigator.dialogue.locator(".setting-search-result-item").filter({
                has: settingsNavigator.page.getByText("Memory cache size (by total items)", { exact: true }),
            });
            await settingsNavigator.dialogue.screenshot({
                ...settingsScreenshotOptions,
                path: `${diagnosticsDirectory}/settings-declarative-search.png`,
            });
            await searchResult.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await search.fill("");

            for (const pageName of settingsPageNames) {
                const pageRoot = await settingsNavigator.openPage(pageName);
                await pageRoot.waitFor({ state: "visible", timeout: uiTimeoutMs });
            }
            settingsPage = await settingsNavigator.openPage("Advanced");
            await settingsNavigator.dialogue.screenshot({
                ...settingsScreenshotOptions,
                path: `${diagnosticsDirectory}/settings-declarative-advanced.png`,
            });
        }

        settingsPage = await settingsNavigator.openPage("Sync Settings");

        const deletionPanel = settingsPage
            .locator("h4.sls-setting-panel-title")
            .filter({ hasText: "Deletion Propagation" })
            .locator("..");
        await deletionPanel
            .getByText("Keep empty folder", { exact: true })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });

        // Retirement guard: the removed toggle must not reappear in the current settings pane.
        const obsoleteToggleCount = await deletionPanel.getByText("Use the trash bin", { exact: true }).count();
        if (obsoleteToggleCount !== 0) {
            throw new Error(
                `The obsolete LiveSync trash toggle is still present in the settings UI (${obsoleteToggleCount} found).`
            );
        }

        if (settingsNavigator.renderer === "declarative") {
            await settingsNavigator.close();
            settingsNavigator = await openLiveSyncSettings(page, uiTimeoutMs);
            settingsPage = await settingsNavigator.openPage("Advanced");
            const restoredValue = await settingsPage
                .locator(".setting-item")
                .filter({
                    has: settingsNavigator.page.getByText("Memory cache size (by total items)", { exact: true }),
                })
                .locator('input[type="number"]')
                .inputValue();
            if (restoredValue !== "321") {
                throw new Error(`The declarative Advanced value was not restored after reopening: ${restoredValue}`);
            }
        }

        const renderer = settingsNavigator.renderer;
        await settingsNavigator.close();
        return renderer;
    });
}

async function verifyPendingSettingsInitialisationFlow(): Promise<{ choice: string; fallback: string }> {
    return await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const settingsNavigator = await openLiveSyncSettings(page, uiTimeoutMs);
        if (settingsNavigator.renderer === "imperative") {
            const general = await settingsNavigator.openPage("General Settings");
            const edgeCaseMode = general.locator(".setting-item").filter({
                has: settingsNavigator.page.getByText("Enable edge case treatment features", { exact: true }),
            });
            await edgeCaseMode.locator(".checkbox-container").click({ timeout: uiTimeoutMs });
            await page.waitForFunction(
                () => {
                    const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                    return plugin?.core.services.setting.currentSettings().useEdgeCaseMode === true;
                },
                undefined,
                { timeout: uiTimeoutMs }
            );
        }

        const patches = await settingsNavigator.openPage("Patches");
        const caseSensitiveSetting = patches.locator(".setting-item").filter({
            has: settingsNavigator.page.getByText("Handle files as Case-Sensitive", { exact: true }),
        });
        await caseSensitiveSetting.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const toggle = caseSensitiveSetting.locator(".checkbox-container");
        if ((await toggle.evaluate((element) => element.classList.contains("is-enabled"))) === true) {
            throw new Error("The pending-settings fixture expected case-sensitive file handling to be disabled.");
        }
        await toggle.click({ timeout: uiTimeoutMs });

        if (settingsNavigator.renderer === "declarative") {
            await settingsNavigator.returnToCatalogue();
        }
        const applySetting = settingsNavigator.dialogue
            .locator(settingsNavigator.renderer === "declarative" ? ".setting-item" : ".sls-setting-menu-buttons")
            .filter({
                has: settingsNavigator.page.getByText("Changes need to be applied!", { exact: true }),
            });
        await applySetting.waitFor({ state: "visible", timeout: uiTimeoutMs });
        if (settingsNavigator.renderer === "declarative") {
            await applySetting.click({ timeout: uiTimeoutMs });
        } else {
            await applySetting.getByRole("button", { name: "Apply", exact: true }).click({ timeout: uiTimeoutMs });
        }

        const choiceDialogue = await waitForVisibleObsidianDialogue(
            settingsNavigator.page,
            "Apply Settings and Reinitialise Synchronisation",
            uiTimeoutMs
        );
        await choiceDialogue.getByText("Reset Synchronisation on This Device", { exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        await choiceDialogue
            .getByText("Overwrite Server Data with This Device's Files", { exact: true })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        await choiceDialogue.getByText("Reset Synchronisation on This Device", { exact: true }).click({
            timeout: uiTimeoutMs,
        });
        await choiceDialogue
            .getByRole("button", { name: "Restart and Fetch Synchronisation Data", exact: true })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        const choice = `${diagnosticsDirectory}/settings-initialisation-choice.png`;
        await choiceDialogue.screenshot({ ...settingsScreenshotOptions, path: choice });
        await choiceDialogue
            .getByRole("button", { name: "Review another way to apply these settings", exact: true })
            .click({ timeout: uiTimeoutMs });
        await choiceDialogue.waitFor({ state: "hidden", timeout: uiTimeoutMs });

        const fallbackDialogue = await waitForVisibleObsidianDialogue(
            settingsNavigator.page,
            "Apply Settings without Initialisation?",
            uiTimeoutMs
        );
        await fallbackDialogue
            .getByRole("button", { name: "Apply without Initialisation", exact: true })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        await fallbackDialogue.getByRole("button", { name: "Keep Editing", exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        const fallback = `${diagnosticsDirectory}/settings-initialisation-fallback.png`;
        await fallbackDialogue.screenshot({ ...settingsScreenshotOptions, path: fallback });
        await fallbackDialogue.getByRole("button", { name: "Keep Editing", exact: true }).click({
            timeout: uiTimeoutMs,
        });
        await fallbackDialogue.waitFor({ state: "hidden", timeout: uiTimeoutMs });

        const persistedCaseSensitivity = await page.evaluate(() => {
            const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
            if (plugin === undefined) throw new Error("Self-hosted LiveSync is unavailable");
            return plugin.core.settings.handleFilenameCaseSensitive;
        });
        if (persistedCaseSensitivity !== false) {
            throw new Error("Cancelling initialisation unexpectedly persisted the pending case-sensitivity setting.");
        }
        await applySetting.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await settingsNavigator.close();
        return { choice, fallback };
    });
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }
    const vault = await createTemporaryVault();
    await mkdir(diagnosticsDirectory, { recursive: true });
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: {
                doctorProcessedVersion: settingsOnly ? "1.0.0" : "0.25.27",
                isConfigured: true,
                liveSync: false,
                versionUpFlash: settingsOnly ? "" : compatibilityReviewMessage,
                notifyThresholdOfRemoteStorageSize: 0,
                syncOnStart: false,
                syncOnSave: false,
                syncOnEditorSave: false,
                syncOnFileOpen: false,
                syncAfterMerge: false,
                periodicReplication: false,
                handleFilenameCaseSensitive: false,
                useAdvancedMode: false,
                usePowerUserMode: false,
                useEdgeCaseMode: false,
            },
            lifecycle: settingsOnly
                ? {
                      afterLaunch: async ({ remoteDebuggingPort }) => {
                          await preseedTrustedVaultState(remoteDebuggingPort, vault.id);
                          await allowPendingObsidianTestVaultOpenAction(remoteDebuggingPort, vault.path, uiTimeoutMs);
                      },
                  }
                : undefined,
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        if (settingsOnly) {
            await resumePendingCompatibilityReviewForSettings();
        } else {
            await verifyCompatibilityReview();
            await verifyConfigDoctorFollowsCompatibilityReview();
        }
        const settingsRenderer = await verifyEffectiveSettings();
        const initialisation = await verifyPendingSettingsInitialisationFlow();
        const p2pInitialisation = await captureP2PSettingsInitialisationDialogue();
        const mobileLanding = settingsRenderer === "declarative" ? await captureDeclarativeMobileLanding() : undefined;
        if (mobileLanding) console.log(`Declarative mobile settings landing page: ${mobileLanding}`);
        console.log(
            `Pending-settings initialisation screenshots: ${initialisation.choice}, ${initialisation.fallback}, ${p2pInitialisation}`
        );
        console.log("Compatibility review and settings expose only effective user controls.");
    } finally {
        if (session) {
            await session.app.stop();
        }
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
