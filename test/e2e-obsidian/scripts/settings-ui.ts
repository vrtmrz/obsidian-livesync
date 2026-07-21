import { VER } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { assertMobileDialogueLayout, setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianDialogue, obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETTINGS_TIMEOUT_MS ?? 10000);
const compatibilityReviewMessage = "Review the internal database compatibility change before synchronisation resumes.";

type ObsidianSettingsController = {
    open(): void;
    openTabById(tabId: string): void;
};

type LiveSyncTestPlugin = {
    core: {
        services: {
            setting: {
                currentSettings(): { versionUpFlash: string };
                getSmallConfig(key: string): string | null;
            };
        };
    };
};

type ObsidianTestApp = {
    setting?: ObsidianSettingsController;
    plugins?: { plugins: Record<string, LiveSyncTestPlugin | undefined> };
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

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
        await page.evaluate(() => {
            const setting = (globalThis as ObsidianTestGlobal).app?.setting;
            if (setting === undefined) throw new Error("Obsidian settings are unavailable");
            setting.open();
            setting.openTabById("obsidian-livesync");
        });

        const liveSyncSettings = page.locator(".sls-setting");
        await liveSyncSettings.waitFor({ state: "visible", timeout: uiTimeoutMs });

        await liveSyncSettings.locator('.sls-setting-menu-btn[title="Change Log"]').click();
        const removedAcknowledgements = liveSyncSettings.getByRole("button", {
            name: /I got it and updated|OK, I have read everything/u,
        });
        if ((await removedAcknowledgements.count()) !== 0) {
            throw new Error("The Change Log still contains a compatibility or release-note acknowledgement control.");
        }

        await liveSyncSettings.locator('.sls-setting-menu-btn[title="Sync Settings"]').click();
        const deletionPanel = liveSyncSettings
            .locator("h4.sls-setting-panel-title")
            .filter({ hasText: "Deletion Propagation" })
            .locator("..");
        await deletionPanel
            .getByText("Keep empty folder", { exact: true })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });

        const obsoleteToggleCount = await deletionPanel.getByText("Use the trash bin", { exact: true }).count();
        if (obsoleteToggleCount !== 0) {
            throw new Error(
                `The obsolete LiveSync trash toggle is still present in the settings UI (${obsoleteToggleCount} found).`
            );
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
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: {
                doctorProcessedVersion: "0.25.27",
                isConfigured: true,
                liveSync: false,
                versionUpFlash: compatibilityReviewMessage,
                notifyThresholdOfRemoteStorageSize: 0,
                syncOnStart: false,
                syncOnSave: false,
                syncOnEditorSave: false,
                syncOnFileOpen: false,
                syncAfterMerge: false,
                periodicReplication: false,
                handleFilenameCaseSensitive: false,
                useAdvancedMode: true,
                useEdgeCaseMode: true,
            },
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await verifyCompatibilityReview();
        await verifyConfigDoctorFollowsCompatibilityReview();
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
