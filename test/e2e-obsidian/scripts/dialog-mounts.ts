import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { assertMobileDialogueLayout, assertMobileNoticeLayout, setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianDialogue, obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const dialogRunStateKey = "__livesyncE2EDialogMount";
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_DIALOG_TIMEOUT_MS ?? 10000);

type DialogueMode = "desktop" | "mobile";

type DialogueRunState = {
    done: boolean;
    error?: string;
    kind: string;
    result?: unknown;
};

type SetupManagerHandle = {
    constructor: { name: string };
    onSelectServer?: (settings: unknown, remoteType: string) => Promise<unknown>;
};

type LiveSyncTestPlugin = {
    core: {
        modules: SetupManagerHandle[];
        settings: unknown;
    };
};

type ObsidianTestApp = {
    commands?: { executeCommandById(commandId: string): boolean };
    plugins?: { plugins: Record<string, LiveSyncTestPlugin | undefined> };
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

async function openRemoteSelectionDialogue(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.evaluate((stateKey) => {
            const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
            if (plugin === undefined) throw new Error("Self-hosted LiveSync is not loaded");
            const manager = plugin.core.modules.find((module) => module.constructor.name === "SetupManager");
            if (typeof manager?.onSelectServer !== "function") throw new Error("Could not find SetupManager");
            const state: DialogueRunState = { kind: "remote-selection", done: false };
            (globalThis as unknown as Record<string, DialogueRunState>)[stateKey] = state;
            void manager.onSelectServer(plugin.core.settings, "unknown").then(
                (result) => {
                    state.result = result;
                    state.done = true;
                },
                (error: unknown) => {
                    state.error = error instanceof Error ? error.message : String(error);
                    state.done = true;
                }
            );
        }, dialogRunStateKey);
    });
}

async function openSetupUriDialogue(): Promise<void> {
    const opened = await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        return await page.evaluate(
            (commandId) => (globalThis as ObsidianTestGlobal).app?.commands?.executeCommandById(commandId) === true,
            "obsidian-livesync:livesync-opensetupuri"
        );
    });
    if (!opened) {
        throw new Error("The Setup URI command was not registered or could not be executed.");
    }
}

async function assertDialogueRunCompleted(): Promise<void> {
    const state = await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.waitForFunction(
            (stateKey) =>
                (globalThis as unknown as Record<string, DialogueRunState | undefined>)[stateKey]?.done === true,
            dialogRunStateKey,
            { timeout: uiTimeoutMs }
        );
        return await page.evaluate(
            (stateKey) => (globalThis as unknown as Record<string, DialogueRunState | undefined>)[stateKey],
            dialogRunStateKey
        );
    });
    if (!state) {
        throw new Error("The remote selection dialogue did not record its completion state.");
    }
    if (state.error) {
        throw new Error(`The remote selection dialogue failed: ${state.error}`);
    }
}

async function verifyRemoteSizeNoticeAndDialogue(): Promise<{
    compatibilityReview: string;
    notice: string;
    dialogue: string;
}> {
    const compatibilityReviewScreenshot = await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        "compatibility-review-dialogue.png",
        async (page) => {
            const compatibilityReview = page.locator(".modal-container").filter({
                has: page
                    .locator(".modal-title")
                    .filter({ hasText: "Synchronisation paused for compatibility review" }),
            });
            await compatibilityReview.waitFor({ state: "visible", timeout: uiTimeoutMs });
            const actions = compatibilityReview.locator(".vpk-action-dialog__actions--vertical");
            await actions.waitFor({ state: "visible", timeout: uiTimeoutMs });
            const flexDirection = await actions.evaluate((element) => getComputedStyle(element).flexDirection);
            if (flexDirection !== "column") {
                throw new Error(`Expected vertically stacked compatibility actions, received ${flexDirection}.`);
            }
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const compatibilityReview = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Synchronisation paused for compatibility review" }),
        });
        await compatibilityReview
            .getByRole("button", { name: "Keep synchronisation paused" })
            .click({ timeout: uiTimeoutMs });
        await compatibilityReview.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });

    const noticeScreenshot = await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        "remote-size-startup-notice.png",
        async (page) => {
            const notice = page.locator(".notice").filter({
                hasText: "Remote storage size notifications are not configured.",
            });
            await notice.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await notice.getByRole("link", { name: "Review options" }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
        }
    );

    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const notice = page.locator(".notice").filter({
            hasText: "Remote storage size notifications are not configured.",
        });
        await notice.getByRole("link", { name: "Review options" }).click({ timeout: uiTimeoutMs });
        await notice.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });

    const dialogueScreenshot = await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        "remote-size-review-dialogue.png",
        async (page) => {
            const modal = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Setting up database size notification" }),
            });
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            for (const action of [
                "No, never warn please",
                "800MB (Cloudant, fly.io)",
                "2GB (Standard)",
                "Ask me later",
            ]) {
                await modal.getByRole("button", { name: action }).waitFor({ state: "visible", timeout: uiTimeoutMs });
            }
        }
    );

    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modal = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Setting up database size notification" }),
        });
        await modal.getByRole("button", { name: "Ask me later" }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });

    return {
        compatibilityReview: compatibilityReviewScreenshot,
        notice: noticeScreenshot,
        dialogue: dialogueScreenshot,
    };
}

async function verifyRemoteSelectionDialogue(mode: DialogueMode): Promise<string> {
    await openRemoteSelectionDialogue();
    const screenshotPath = await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        `setup-remote-selection-dialogue${mode === "mobile" ? "-mobile" : ""}.png`,
        async (page) => {
            const modal = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Enter Server Information" }),
            });
            const dialogue = modal.locator(".dialog-host");
            await modal.waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            for (const label of ["CouchDB", "S3/MinIO/R2 Object Storage", "Peer-to-Peer only"]) {
                await dialogue.getByText(label, { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });
            }
            await modal
                .getByRole("button", { name: "No, please take me back" })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            if (mode === "mobile") {
                await assertMobileDialogueLayout(page, modal, "remote selection dialogue");
            }
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modal = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Enter Server Information" }),
        });
        if (mode === "mobile") {
            const previousDialogue = await modal.locator(".modal").last().elementHandle();
            if (previousDialogue === null) {
                throw new Error("The remote selection dialogue did not expose a close control.");
            }
            await modal.locator(".modal-close-button").click({ timeout: uiTimeoutMs });
            await page.waitForFunction((element) => !element.isConnected, previousDialogue, { timeout: uiTimeoutMs });
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
        }
        await modal.getByRole("button", { name: "No, please take me back" }).click({ timeout: uiTimeoutMs });
    });
    await assertDialogueRunCompleted();
    return screenshotPath;
}

async function verifySetupUriDialogue(mode: DialogueMode): Promise<string> {
    await openSetupUriDialogue();
    const screenshotPath = await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        `setup-uri-dialogue${mode === "mobile" ? "-mobile" : ""}.png`,
        async (page) => {
            const modal = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Enter Setup URI" }),
            });
            await modal.waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            await modal
                .locator('input[placeholder^="obsidian://setuplivesync"]')
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.locator('input[name="password"]').waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal
                .getByRole("button", { name: "Test Settings and Continue" })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.getByRole("button", { name: "Cancel" }).waitFor({ state: "visible", timeout: uiTimeoutMs });
            if (mode === "mobile") {
                await assertMobileDialogueLayout(page, modal, "Setup URI dialogue");
            }
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modal = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Enter Setup URI" }),
        });
        await modal.getByRole("button", { name: "Cancel" }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    return screenshotPath;
}

async function verifyMobileStartupReviews(): Promise<{ compatibilityReview: string; remoteSizeReview: string }> {
    const compatibilityReviewScreenshot = await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        "compatibility-review-dialogue-mobile.png",
        async (page) => {
            const modal = page.locator(".modal-container").filter({
                has: page
                    .locator(".modal-title")
                    .filter({ hasText: "Synchronisation paused for compatibility review" }),
            });
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.locator(".vpk-action-dialog__actions--vertical").waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            await assertMobileDialogueLayout(page, modal, "compatibility review dialogue");
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modal = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Synchronisation paused for compatibility review" }),
        });
        await modal.getByRole("button", { name: "Keep synchronisation paused" }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });

        const compatibilityReminder = page.locator(".livesync-compatibility-review-notice");
        await compatibilityReminder.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await assertMobileNoticeLayout(page, compatibilityReminder, "compatibility review reminder");

        const notice = page.locator(".notice").filter({
            hasText: "Remote storage size notifications are not configured.",
        });
        await notice.getByRole("link", { name: "Review options" }).click({ timeout: uiTimeoutMs });
        await notice.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });

    const remoteSizeReviewScreenshot = await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        "remote-size-review-dialogue-mobile.png",
        async (page) => {
            const modal = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Setting up database size notification" }),
            });
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await assertMobileDialogueLayout(page, modal, "remote size review dialogue");
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modal = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Setting up database size notification" }),
        });
        await modal.getByRole("button", { name: "Ask me later" }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });

    return {
        compatibilityReview: compatibilityReviewScreenshot,
        remoteSizeReview: remoteSizeReviewScreenshot,
    };
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
                notifyThresholdOfRemoteStorageSize: -1,
                syncOnStart: false,
                syncOnSave: false,
                syncOnEditorSave: false,
                syncOnFileOpen: false,
                syncAfterMerge: false,
                periodicReplication: false,
            },
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);

        const remoteSizeScreenshots = await verifyRemoteSizeNoticeAndDialogue();
        console.log(
            `Compatibility review actions were stacked vertically, and the remote-size startup notice opened an untimed review dialogue successfully. Screenshots: ${remoteSizeScreenshots.compatibilityReview}, ${remoteSizeScreenshots.notice}, ${remoteSizeScreenshots.dialogue}`
        );

        const remoteScreenshot = await verifyRemoteSelectionDialogue("desktop");
        console.log(`Remote selection dialogue mounted and closed successfully. Screenshot: ${remoteScreenshot}`);
        const setupUriScreenshot = await verifySetupUriDialogue("desktop");
        console.log(`Setup URI dialogue mounted and closed successfully. Screenshot: ${setupUriScreenshot}`);

        await setObsidianMobileTestMode(obsidianRemoteDebuggingPort(), true, uiTimeoutMs);
        try {
            const mobileStartupScreenshots = await verifyMobileStartupReviews();
            console.log(
                `Mobile compatibility and remote-size reviews passed viewport, safe-area, touch-target, and vertical-action checks. Screenshots: ${mobileStartupScreenshots.compatibilityReview}, ${mobileStartupScreenshots.remoteSizeReview}`
            );
            const mobileRemoteScreenshot = await verifyRemoteSelectionDialogue("mobile");
            console.log(
                `Mobile remote selection dialogue passed viewport, safe-area, touch-target, and close-control checks. Screenshot: ${mobileRemoteScreenshot}`
            );
            const mobileSetupUriScreenshot = await verifySetupUriDialogue("mobile");
            console.log(
                `Mobile Setup URI dialogue passed viewport, safe-area, and touch-target checks. Screenshot: ${mobileSetupUriScreenshot}`
            );
        } finally {
            await setObsidianMobileTestMode(obsidianRemoteDebuggingPort(), false, uiTimeoutMs);
        }
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
