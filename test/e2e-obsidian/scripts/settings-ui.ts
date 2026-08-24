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
    withObsidianPage,
} from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETTINGS_TIMEOUT_MS ?? 10000);
const settingsOnly = process.env.E2E_OBSIDIAN_SETTINGS_ONLY === "true";
const diagnosticsDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
const settingsScreenshotOptions = {
    animations: "disabled" as const,
    style: ".notice-container { visibility: hidden !important; }",
};
const compatibilityReviewMessage = "Review the internal database compatibility change before synchronisation resumes.";

type LiveSyncTestPlugin = {
    core: {
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

type ObsidianTestApp = {
    plugins?: { plugins: Record<string, LiveSyncTestPlugin | undefined> };
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

const settingsPageNames = [
    "Change Log",
    "Setup",
    "General Settings",
    "Remote Configuration",
    "Sync Settings",
    "Selector",
    "Customisation sync",
    "Hatch",
    "Advanced",
    "Power users",
    "Patches",
    "Maintenance",
] as const;

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

async function verifyEffectiveSettings(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
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

        settingsPage = await settingsNavigator.openPage("Setup");
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
            await settingsNavigator.dialogue
                .locator(".vertical-tab-content:visible")
                .last()
                .evaluate((element) => {
                    element.scrollTop = 0;
                });
            await settingsNavigator.dialogue.screenshot({
                ...settingsScreenshotOptions,
                path: `${diagnosticsDirectory}/settings-declarative-catalogue.png`,
            });
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
        await verifyEffectiveSettings();
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
