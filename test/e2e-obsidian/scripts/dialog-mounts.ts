import {
    assertLocatorHasMinimumTouchTarget,
    assertLocatorWithinSafeArea,
    assertLocatorWithinViewport,
    assertNoHorizontalOverflow,
} from "@vrtmrz/obsidian-test-session";
import type { Locator, Page } from "playwright";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianDialogue, obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const dialogRunStateKey = "__livesyncE2EDialogMount";
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_DIALOG_TIMEOUT_MS ?? 10000);
const mobileViewport = { width: 390, height: 844 } as const;
const iPhoneSafeArea = { top: 47, right: 0, bottom: 34, left: 0 } as const;

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
    emulateMobile?: (mobile: boolean) => void;
    plugins?: { plugins: Record<string, LiveSyncTestPlugin | undefined> };
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

async function setMobileDialogueTestMode(enabled: boolean): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        if (enabled) {
            await page.setViewportSize(mobileViewport);
        }
        await page.evaluate((nextEnabled) => {
            const obsidianApp = (globalThis as ObsidianTestGlobal).app;
            if (typeof obsidianApp?.emulateMobile !== "function") {
                throw new Error("app.emulateMobile is unavailable");
            }
            obsidianApp.emulateMobile(nextEnabled);
        }, enabled);
        await page.waitForFunction(
            (nextEnabled) => {
                const obsidianApp = (globalThis as ObsidianTestGlobal).app;
                return (
                    document.body.classList.contains("is-mobile") === nextEnabled &&
                    obsidianApp?.plugins?.plugins["obsidian-livesync"] !== undefined
                );
            },
            enabled,
            { timeout: uiTimeoutMs }
        );
        await page.evaluate(
            (safeArea) => {
                for (const edge of ["top", "right", "bottom", "left"] as const) {
                    const property = `--safe-area-inset-${edge}`;
                    if (safeArea === null) document.body.style.removeProperty(property);
                    else document.body.style.setProperty(property, `${safeArea[edge]}px`);
                }
            },
            enabled ? iPhoneSafeArea : null
        );
    });
}

async function assertMobileDialogueLayout(page: Page, container: Locator, label: string): Promise<void> {
    const dialogue = container.locator(".modal").last();
    const closeButton = dialogue.locator(".modal-close-button");
    await assertLocatorWithinViewport(page, dialogue, { label });
    await assertNoHorizontalOverflow(page, dialogue, { label });
    await assertLocatorWithinSafeArea(page, dialogue, {
        label,
        safeAreaInsets: iPhoneSafeArea,
    });
    await assertLocatorWithinSafeArea(page, closeButton, {
        label: `${label} close button`,
        safeAreaInsets: iPhoneSafeArea,
    });
    await assertLocatorHasMinimumTouchTarget(page, closeButton, {
        label: `${label} close button`,
    });
}

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
                lastReadUpdates: Number.MAX_SAFE_INTEGER,
                liveSync: false,
                notifyThresholdOfRemoteStorageSize: 0,
                syncOnStart: false,
                syncOnSave: false,
                syncOnEditorSave: false,
                syncOnFileOpen: false,
                syncAfterMerge: false,
                periodicReplication: false,
            },
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);

        const remoteScreenshot = await verifyRemoteSelectionDialogue("desktop");
        console.log(`Remote selection dialogue mounted and closed successfully. Screenshot: ${remoteScreenshot}`);
        const setupUriScreenshot = await verifySetupUriDialogue("desktop");
        console.log(`Setup URI dialogue mounted and closed successfully. Screenshot: ${setupUriScreenshot}`);

        await setMobileDialogueTestMode(true);
        try {
            const mobileRemoteScreenshot = await verifyRemoteSelectionDialogue("mobile");
            console.log(
                `Mobile remote selection dialogue passed viewport, safe-area, touch-target, and close-control checks. Screenshot: ${mobileRemoteScreenshot}`
            );
            const mobileSetupUriScreenshot = await verifySetupUriDialogue("mobile");
            console.log(
                `Mobile Setup URI dialogue passed viewport, safe-area, and touch-target checks. Screenshot: ${mobileSetupUriScreenshot}`
            );
        } finally {
            await setMobileDialogueTestMode(false);
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
