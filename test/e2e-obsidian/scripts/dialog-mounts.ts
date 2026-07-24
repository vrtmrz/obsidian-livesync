import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { createE2eCouchDbPluginData, waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { assertMobileDialogueLayout, assertMobileNoticeLayout, setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import {
    captureObsidianDialogue,
    captureObsidianElement,
    captureObsidianPage,
    obsidianRemoteDebuggingPort,
    withObsidianPage,
} from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const dialogRunStateKey = "__livesyncE2EDialogMount";
const repairRunStateKey = "__livesyncE2ETroubleshootingRepair";
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_DIALOG_TIMEOUT_MS ?? 10000);

type DialogueMode = "desktop" | "mobile";

type DialogueRunState = {
    done: boolean;
    error?: string;
    expected?: unknown;
    kind: string;
    result?: unknown;
};

type SetupManagerHandle = {
    constructor: { name: string };
    onSelectServer?: (settings: unknown, remoteType: string) => Promise<unknown>;
    _askUseRemoteConfiguration?: (settings: unknown, preferred: unknown) => Promise<unknown>;
    _checkAndAskResolvingMismatchedTweaks?: (preferred: unknown) => Promise<unknown>;
    __addLog?: (message: string) => void;
};

type LiveSyncTestPlugin = {
    core: {
        fileHandler: {
            createAllChunks(force: boolean): Promise<unknown>;
        };
        modules: SetupManagerHandle[];
        settings: Record<string, unknown>;
    };
};

type ObsidianSettingsController = {
    open(): void;
    openTabById(tabId: string): void;
};

type ObsidianVaultFile = {
    path: string;
};

type ObsidianTestApp = {
    commands?: { executeCommandById(commandId: string): boolean };
    plugins?: { plugins: Record<string, LiveSyncTestPlugin | undefined> };
    setting?: ObsidianSettingsController;
    vault?: {
        delete(file: ObsidianVaultFile, force: boolean): Promise<void>;
        getFiles(): ObsidianVaultFile[];
        read(file: ObsidianVaultFile): Promise<string>;
    };
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

async function openConfigurationMismatchDialogue(
    kind: "connected" | "connected-rebuild-recommended" | "remote-configuration"
): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.evaluate(
            ({ stateKey, kind }) => {
                const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                if (plugin === undefined) throw new Error("Self-hosted LiveSync is not loaded");
                const resolver = plugin.core.modules.find(
                    (module) => module.constructor.name === "ModuleResolvingMismatchedTweaks"
                );
                if (resolver === undefined) throw new Error("Could not find ModuleResolvingMismatchedTweaks");
                if (kind === "connected-rebuild-recommended") {
                    plugin.core.settings.autoAcceptCompatibleTweak = false;
                }

                const preferred =
                    kind === "connected-rebuild-recommended"
                        ? {
                              ...plugin.core.settings,
                              hashAlg: plugin.core.settings.hashAlg === "xxhash32" ? "xxhash64" : "xxhash32",
                          }
                        : {
                              ...plugin.core.settings,
                              enableCompression: !Boolean(plugin.core.settings.enableCompression),
                          };
                const state: DialogueRunState = {
                    kind: `configuration-mismatch-${kind}`,
                    done: false,
                    expected: preferred,
                };
                (globalThis as unknown as Record<string, DialogueRunState>)[stateKey] = state;
                const operation =
                    kind === "remote-configuration"
                        ? resolver._askUseRemoteConfiguration?.(plugin.core.settings, preferred)
                        : resolver._checkAndAskResolvingMismatchedTweaks?.(preferred);
                if (operation === undefined) {
                    throw new Error(`The configuration mismatch resolver does not support ${kind}.`);
                }
                void operation.then(
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
            { stateKey: dialogRunStateKey, kind }
        );
    });
}

async function assertDialogueRunCompleted(): Promise<DialogueRunState> {
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
        throw new Error("The mounted dialogue did not record its completion state.");
    }
    if (state.error) {
        throw new Error(`The mounted dialogue failed: ${state.error}`);
    }
    return state;
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
            const message = compatibilityReview.locator(".vpk-action-dialog__message");
            const textSelection = await message.evaluate((element) => {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(element);
                selection?.removeAllRanges();
                selection?.addRange(range);
                const selectedText = selection?.toString() ?? "";
                selection?.removeAllRanges();
                return {
                    selectedText,
                    userSelect: getComputedStyle(element).userSelect,
                };
            });
            if (
                textSelection.userSelect !== "text" ||
                !textSelection.selectedText.includes("Remote synchronisation is paused on this device")
            ) {
                throw new Error(
                    `Expected the action dialogue message to be selectable, received user-select=${textSelection.userSelect} and selected text '${textSelection.selectedText}'.`
                );
            }
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
                has: page.locator(".modal-title").filter({ hasText: "Choose a synchronisation remote" }),
            });
            const dialogue = modal.locator(".dialog-host");
            await modal.waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            for (const label of ["CouchDB", "S3-compatible Object Storage", "Peer-to-Peer (P2P)"]) {
                await dialogue.getByText(label, { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });
            }
            const p2pDescription = dialogue.getByText(
                "No central data-storage server is required, but a signalling relay is required for peer discovery.",
                { exact: false }
            );
            await p2pDescription.waitFor({ state: "visible", timeout: uiTimeoutMs });
            const textSelection = await p2pDescription.evaluate((element) => {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(element);
                selection?.removeAllRanges();
                selection?.addRange(range);
                const selectedText = selection?.toString() ?? "";
                selection?.removeAllRanges();
                return {
                    selectedText,
                    userSelect: getComputedStyle(element).userSelect,
                };
            });
            if (
                textSelection.userSelect !== "text" ||
                !textSelection.selectedText.includes("signalling relay is required for peer discovery")
            ) {
                throw new Error(
                    `Expected Svelte dialogue prose to be selectable, received user-select=${textSelection.userSelect} and selected text '${textSelection.selectedText}'.`
                );
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
            has: page.locator(".modal-title").filter({ hasText: "Choose a synchronisation remote" }),
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

async function verifyCouchDBSettingsDialogue(mode: DialogueMode): Promise<string> {
    await openRemoteSelectionDialogue();
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const remoteSelection = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Choose a synchronisation remote" }),
        });
        await remoteSelection
            .locator("label")
            .filter({ hasText: "CouchDB" })
            .locator('input[type="radio"]')
            .first()
            .check({ timeout: uiTimeoutMs });
        await remoteSelection
            .getByRole("button", { name: "Continue to CouchDB setup", exact: true })
            .click({ timeout: uiTimeoutMs });
    });
    const screenshotPath = await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        `setup-couchdb-dialogue${mode === "mobile" ? "-mobile" : ""}.png`,
        async (page) => {
            const modal = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "CouchDB Configuration" }),
            });
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            for (const label of [
                "Check server requirements",
                "Test connection and save",
                "Save without connecting",
                "Cancel",
            ]) {
                await modal.getByRole("button", { name: label, exact: true }).waitFor({
                    state: "visible",
                    timeout: uiTimeoutMs,
                });
            }
            await modal
                .getByText(
                    "This optional check uses Obsidian's internal request API and sends the credentials above to the CouchDB server.",
                    { exact: false }
                )
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal
                .getByText("CouchDB validates the database name when you connect.", { exact: false })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            if ((await modal.getByRole("button", { name: "Continue anyway", exact: true }).count()) !== 0) {
                throw new Error("CouchDB onboarding still exposes the ambiguous Continue anyway action.");
            }
            const buttonGroups = modal.locator(".button-group");
            for (let index = 0; index < (await buttonGroups.count()); index++) {
                const flexDirection = await buttonGroups.nth(index).evaluate((element) => {
                    return getComputedStyle(element).flexDirection;
                });
                if (flexDirection !== "column") {
                    throw new Error(`Expected vertical CouchDB actions, received ${flexDirection}.`);
                }
            }
            if (mode === "mobile") {
                await assertMobileDialogueLayout(page, modal, "CouchDB settings dialogue");
            }
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modal = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "CouchDB Configuration" }),
        });
        await modal.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
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

async function verifyCompatibleMismatchAutoAdjustment(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.evaluate((stateKey) => {
            const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
            if (plugin === undefined) throw new Error("Self-hosted LiveSync is not loaded");
            const resolver = plugin.core.modules.find(
                (module) => module.constructor.name === "ModuleResolvingMismatchedTweaks"
            );
            if (typeof resolver?._checkAndAskResolvingMismatchedTweaks !== "function") {
                throw new Error("Could not find the configuration mismatch resolver");
            }
            plugin.core.settings.autoAcceptCompatibleTweak = undefined;
            const currentModified =
                typeof plugin.core.settings.tweakModified === "number" ? plugin.core.settings.tweakModified : 0;
            const preferred = {
                ...plugin.core.settings,
                hashAlg: plugin.core.settings.hashAlg === "xxhash32" ? "xxhash64" : "xxhash32",
                tweakModified: currentModified + 1,
            };
            const state: DialogueRunState = {
                kind: "configuration-mismatch-compatible-auto-adjustment",
                done: false,
                expected: preferred,
            };
            (globalThis as unknown as Record<string, DialogueRunState>)[stateKey] = state;
            void resolver._checkAndAskResolvingMismatchedTweaks(preferred).then(
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

    const state = await assertDialogueRunCompleted();
    if (!Array.isArray(state.result) || state.result.length !== 2) {
        throw new Error("The compatible mismatch did not return its settings and rebuild decision.");
    }
    const [appliedSettings, shouldRebuild] = state.result;
    const expectedSettings = state.expected;
    if (
        typeof appliedSettings !== "object" ||
        appliedSettings === null ||
        typeof expectedSettings !== "object" ||
        expectedSettings === null ||
        !("hashAlg" in appliedSettings) ||
        !("hashAlg" in expectedSettings) ||
        appliedSettings.hashAlg !== expectedSettings.hashAlg ||
        shouldRebuild !== false
    ) {
        throw new Error("The compatible mismatch was not adjusted to the newer setting without a rebuild.");
    }
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const autoAcceptEnabled = await page.evaluate(() => {
            const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
            return plugin?.core.settings.autoAcceptCompatibleTweak;
        });
        if (autoAcceptEnabled !== true) {
            throw new Error("Compatible mismatch auto-adjustment was not persisted as the default.");
        }
        for (const title of ["Auto-Accept Available", "Configuration Mismatch Detected"]) {
            const dialogue = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: title }),
            });
            if ((await dialogue.count()) !== 0) {
                throw new Error(`Compatible mismatch auto-adjustment unexpectedly opened '${title}'.`);
            }
        }
    });
}

async function verifyCompatibleAlignmentSettingDefault(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const persistedValue = await page.evaluate(() => {
            const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
            if (plugin === undefined) throw new Error("Self-hosted LiveSync is not loaded");
            return plugin.core.settings.autoAcceptCompatibleTweak;
        });
        if (persistedValue !== undefined) {
            throw new Error(
                `The default-display fixture expected an undefined preference, received ${persistedValue}.`
            );
        }

        await page.evaluate(() => {
            const setting = (globalThis as ObsidianTestGlobal).app?.setting;
            if (setting === undefined) throw new Error("Obsidian settings are unavailable");
            setting.open();
            setting.openTabById("obsidian-livesync");
        });
        const liveSyncSettings = page.locator(".sls-setting");
        await liveSyncSettings.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await liveSyncSettings.locator('.sls-setting-menu-btn[title="Advanced"]').click({ timeout: uiTimeoutMs });
        const settingItem = liveSyncSettings.locator(".setting-item").filter({
            has: page.getByText("Auto-accept compatible tweak mismatches", { exact: true }),
        });
        await settingItem.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const toggle = settingItem.locator(".checkbox-container");
        if (!(await toggle.evaluate((element) => element.classList.contains("is-enabled")))) {
            throw new Error("The automatic compatible-setting policy was displayed as disabled while still undefined.");
        }
    });
}

async function verifyConfigurationMismatchDialogues(): Promise<{ general: string; fetch: string }> {
    await verifyCompatibleMismatchAutoAdjustment();
    await openConfigurationMismatchDialogue("remote-configuration");
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modal = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Use Remote Configuration" }),
        });
        await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await modal
            .getByRole("button", { name: "Use configured settings", exact: true })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        await modal.getByRole("button", { name: "Dismiss", exact: true }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    await assertDialogueRunCompleted();

    await openConfigurationMismatchDialogue("connected");
    const generalScreenshotPath = await captureObsidianElement(
        obsidianRemoteDebuggingPort(),
        "troubleshooting-configuration-mismatch-dialogue.png",
        async (page) => {
            const container = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Configuration Mismatch Detected" }),
            });
            const modal = container.locator(".modal").last();
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            for (const action of ["Apply settings to this device", "Update remote database settings"]) {
                await modal
                    .getByRole("button", { name: action, exact: true })
                    .waitFor({ state: "visible", timeout: uiTimeoutMs });
            }
            await modal.getByRole("button", { name: /Dismiss$/u }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            for (const retiredAction of ["Use configured", "Update with mine"]) {
                if ((await modal.getByRole("button", { name: retiredAction, exact: true }).count()) !== 0) {
                    throw new Error(`The mismatch dialogue still exposes the retired action '${retiredAction}'.`);
                }
            }
            const actions = modal.locator(".setting-item-control").last();
            const flexDirection = await actions.evaluate((element) => getComputedStyle(element).flexDirection);
            if (flexDirection !== "column") {
                throw new Error(`Expected vertically stacked mismatch actions, received ${flexDirection}.`);
            }
            return modal;
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modal = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Configuration Mismatch Detected" }),
        });
        await modal.getByRole("button", { name: /Dismiss$/u }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    await assertDialogueRunCompleted();

    await openConfigurationMismatchDialogue("connected-rebuild-recommended");
    const fetchScreenshotPath = await captureObsidianElement(
        obsidianRemoteDebuggingPort(),
        "troubleshooting-configuration-mismatch-fetch-dialogue.png",
        async (page) => {
            const container = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Configuration Mismatch Detected" }),
            });
            const modal = container.locator(".modal").last();
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal
                .getByRole("button", { name: "Apply settings to this device, and fetch again", exact: true })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            return modal;
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modal = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Configuration Mismatch Detected" }),
        });
        await modal
            .getByRole("button", { name: "Apply settings to this device, and fetch again", exact: true })
            .click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    const fetchResult = await assertDialogueRunCompleted();
    if (!Array.isArray(fetchResult.result) || fetchResult.result.length !== 2) {
        throw new Error("The configuration-mismatch Fetch action did not return its settings and Fetch decision.");
    }
    const [appliedSettings, shouldFetch] = fetchResult.result;
    const expectedSettings = fetchResult.expected;
    if (
        typeof appliedSettings !== "object" ||
        appliedSettings === null ||
        typeof expectedSettings !== "object" ||
        expectedSettings === null ||
        !("hashAlg" in appliedSettings) ||
        !("hashAlg" in expectedSettings) ||
        appliedSettings.hashAlg !== expectedSettings.hashAlg ||
        shouldFetch !== true
    ) {
        throw new Error("The configuration-mismatch Fetch action did not apply the remote setting before Fetch.");
    }

    return { general: generalScreenshotPath, fetch: fetchScreenshotPath };
}

async function executeRegisteredCommand(commandId: string): Promise<void> {
    const opened = await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        return await page.evaluate(
            (id) => (globalThis as ObsidianTestGlobal).app?.commands?.executeCommandById(id) === true,
            commandId
        );
    });
    if (!opened) {
        throw new Error(`The command was not registered or could not be executed: ${commandId}`);
    }
}

async function verifyLogAndReportSurfaces(): Promise<{ log: string; report: string }> {
    await executeRegisteredCommand("obsidian-livesync:view-log");
    const logScreenshot = await captureObsidianElement(
        obsidianRemoteDebuggingPort(),
        "troubleshooting-show-log.png",
        async (page) => {
            const logPane = page.locator(".logpane");
            await logPane.waitFor({ state: "visible", timeout: uiTimeoutMs });
            for (const label of ["Wrap", "Auto scroll", "Pause"]) {
                await logPane.getByText(label, { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });
            }
            await logPane.getByRole("button", { name: "Close", exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            return logPane;
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const logPane = page.locator(".logpane");
        await logPane.getByRole("button", { name: "Close", exact: true }).click({ timeout: uiTimeoutMs });
        await logPane.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });

    await executeRegisteredCommand("obsidian-livesync:dump-debug-info");
    const reportScreenshot = await captureObsidianElement(
        obsidianRemoteDebuggingPort(),
        "troubleshooting-full-report.png",
        async (page) => {
            const modal = page.locator(".modal-container").filter({
                hasText: "Your Debug info is ready to be copied",
            });
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            const report = await modal.locator("textarea").inputValue({ timeout: uiTimeoutMs });
            if (!report.includes("# ---- Debug Info Dump ----")) {
                throw new Error("The full-report dialogue did not contain the generated debug report.");
            }
            await modal.getByRole("button", { name: "OK", exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            return modal.locator(".modal").last();
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modal = page.locator(".modal-container").filter({
            hasText: "Your Debug info is ready to be copied",
        });
        await modal.getByRole("button", { name: "OK", exact: true }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });

    return { log: logScreenshot, report: reportScreenshot };
}

async function verifyHatchSurfacesAndSafeActions(): Promise<string> {
    const screenshotPath = await captureObsidianElement(
        obsidianRemoteDebuggingPort(),
        "troubleshooting-hatch.png",
        async (page) => {
            await page.evaluate(() => {
                const setting = (globalThis as ObsidianTestGlobal).app?.setting;
                if (setting === undefined) throw new Error("Obsidian settings are unavailable");
                setting.open();
                setting.openTabById("obsidian-livesync");
            });
            const liveSyncSettings = page.locator(".sls-setting");
            await liveSyncSettings.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await liveSyncSettings.locator('.sls-setting-menu-btn[title="Hatch"]').click({ timeout: uiTimeoutMs });
            for (const label of [
                "Write logs into the file",
                "Recreate chunks for current Vault files",
                "Verify and repair all files",
            ]) {
                await liveSyncSettings.locator(".setting-item-name", { hasText: label }).waitFor({
                    state: "visible",
                    timeout: uiTimeoutMs,
                });
            }
            await liveSyncSettings.getByRole("button", { name: "Recreate current chunks", exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            await liveSyncSettings.getByRole("button", { name: "Verify all", exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            await liveSyncSettings
                .locator(".setting-item-name", { hasText: "Recreate chunks for current Vault files" })
                .scrollIntoViewIfNeeded();
            return liveSyncSettings;
        }
    );

    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const liveSyncSettings = page.locator(".sls-setting");
        const logSetting = liveSyncSettings.locator(".setting-item").filter({
            has: page.getByText("Write logs into the file", { exact: true }),
        });
        await logSetting.locator(".checkbox-container").click({ timeout: uiTimeoutMs });
        await page.waitForFunction(
            () => {
                const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                return plugin?.core.settings.writeLogToTheFile === true;
            },
            undefined,
            { timeout: uiTimeoutMs }
        );

        const persistentLogMarker = "E2E persistent troubleshooting log";
        await page.evaluate((marker) => {
            const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
            if (plugin === undefined) throw new Error("Self-hosted LiveSync is not loaded");
            const module = plugin.core.modules.find((candidate) => candidate.constructor.name === "ModuleLog");
            if (typeof module?.__addLog !== "function") throw new Error("Could not find ModuleLog");
            module.__addLog(marker);
        }, persistentLogMarker);
        await page.waitForFunction(
            async (marker) => {
                const vault = (globalThis as ObsidianTestGlobal).app?.vault;
                if (vault === undefined) return false;
                const logFile = vault.getFiles().find((file) => file.path.startsWith("livesync_log_"));
                if (logFile === undefined) return false;
                return (await vault.read(logFile)).includes(marker);
            },
            persistentLogMarker,
            { timeout: uiTimeoutMs }
        );

        // Saving a toggle refreshes the settings pane. Resolve the visible control again so the
        // second action does not target the detached pre-save element.
        const refreshedLogToggle = page
            .locator(".sls-setting:visible .setting-item:visible")
            .filter({
                has: page.getByText("Write logs into the file", { exact: true }),
            })
            .locator(".checkbox-container:visible")
            .last();
        await refreshedLogToggle.click({ timeout: uiTimeoutMs });
        await page.waitForFunction(
            () => {
                const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                return plugin?.core.settings.writeLogToTheFile === false;
            },
            undefined,
            { timeout: uiTimeoutMs }
        );
        await page.evaluate(async () => {
            const vault = (globalThis as ObsidianTestGlobal).app?.vault;
            if (vault === undefined) throw new Error("Obsidian Vault is unavailable");
            const logFile = vault.getFiles().find((file) => file.path.startsWith("livesync_log_"));
            if (logFile === undefined) throw new Error("The persistent troubleshooting log was not created");
            await vault.delete(logFile, true);
        });
        await page.waitForFunction(
            () =>
                !(globalThis as ObsidianTestGlobal).app?.vault
                    ?.getFiles()
                    .some((file) => file.path.startsWith("livesync_log_")),
            undefined,
            { timeout: uiTimeoutMs }
        );

        await page.evaluate((stateKey) => {
            const plugin = (globalThis as ObsidianTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
            if (plugin === undefined) throw new Error("Self-hosted LiveSync is not loaded");
            const original = plugin.core.fileHandler.createAllChunks.bind(plugin.core.fileHandler);
            const state: DialogueRunState = { kind: "recreate-missing-chunks", done: false };
            (globalThis as unknown as Record<string, DialogueRunState>)[stateKey] = state;
            plugin.core.fileHandler.createAllChunks = async (force) => {
                try {
                    state.result = await original(force);
                } catch (error) {
                    state.error = error instanceof Error ? error.message : String(error);
                } finally {
                    state.done = true;
                    plugin.core.fileHandler.createAllChunks = original;
                }
            };
        }, repairRunStateKey);
        await page
            .locator(".sls-setting:visible")
            .last()
            .getByRole("button", { name: "Recreate current chunks", exact: true })
            .click({
                timeout: uiTimeoutMs,
            });
        await page.waitForFunction(
            (stateKey) =>
                (globalThis as unknown as Record<string, DialogueRunState | undefined>)[stateKey]?.done === true,
            repairRunStateKey,
            { timeout: uiTimeoutMs }
        );
        const repairState = await page.evaluate(
            (stateKey) => (globalThis as unknown as Record<string, DialogueRunState | undefined>)[stateKey],
            repairRunStateKey
        );
        if (repairState?.error) {
            throw new Error(`Recreate missing chunks failed: ${repairState.error}`);
        }

        await page
            .locator(".sls-setting:visible")
            .last()
            .getByRole("button", { name: "Verify all", exact: true })
            .click({
                timeout: uiTimeoutMs,
            });
        await page
            .locator(".notice")
            .filter({ hasText: /^done$/u })
            .waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
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
            pluginData: createE2eCouchDbPluginData(
                {
                    uri: "http://127.0.0.1:5984",
                    username: "",
                    password: "",
                    dbName: "dialog-mounts-ui-only",
                },
                {
                    notifyThresholdOfRemoteStorageSize: -1,
                    syncOnStart: false,
                    syncOnSave: false,
                    syncOnEditorSave: false,
                    syncOnFileOpen: false,
                    syncAfterMerge: false,
                    periodicReplication: false,
                    useAdvancedMode: true,
                }
            ),
        });
        try {
            await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        } catch (error) {
            const screenshot = await captureObsidianPage(
                obsidianRemoteDebuggingPort(),
                "dialog-mounts-core-not-ready.png",
                async () => undefined
            );
            console.error(`Core readiness diagnostic screenshot: ${screenshot}`);
            const persistedSettings = JSON.parse(
                await readFile(join(session.install.pluginDir, "data.json"), "utf8")
            ) as Record<string, unknown>;
            console.error(
                `Persisted readiness settings: ${JSON.stringify({
                    isConfigured: persistedSettings.isConfigured,
                    remoteType: persistedSettings.remoteType,
                    settingVersion: persistedSettings.settingVersion,
                    couchDB_URI: persistedSettings.couchDB_URI,
                    couchDB_DBNAME: persistedSettings.couchDB_DBNAME,
                    remoteConfigurationCount: Object.keys(
                        (persistedSettings.remoteConfigurations as Record<string, unknown> | undefined) ?? {}
                    ).length,
                })}`
            );
            throw error;
        }

        const remoteSizeScreenshots = await verifyRemoteSizeNoticeAndDialogue();
        console.log(
            `Compatibility review actions were stacked vertically, and the remote-size startup notice opened an untimed review dialogue successfully. Screenshots: ${remoteSizeScreenshots.compatibilityReview}, ${remoteSizeScreenshots.notice}, ${remoteSizeScreenshots.dialogue}`
        );

        const remoteScreenshot = await verifyRemoteSelectionDialogue("desktop");
        console.log(`Remote selection dialogue mounted and closed successfully. Screenshot: ${remoteScreenshot}`);
        const couchDBScreenshot = await verifyCouchDBSettingsDialogue("desktop");
        console.log(
            `CouchDB settings mode exposed explicit connection, unverified-save, and server-check actions. Screenshot: ${couchDBScreenshot}`
        );
        const setupUriScreenshot = await verifySetupUriDialogue("desktop");
        console.log(`Setup URI dialogue mounted and closed successfully. Screenshot: ${setupUriScreenshot}`);
        await verifyCompatibleAlignmentSettingDefault();
        console.log("The undefined compatible-setting preference is displayed with its effective enabled default.");
        const mismatchScreenshots = await verifyConfigurationMismatchDialogues();
        console.log(
            `A mismatch limited to compatible chunk settings was adjusted without a dialogue, current manual mismatch actions mounted successfully, and the Fetch action applied the remote setting before scheduling Fetch. Screenshots: ${mismatchScreenshots.general}, ${mismatchScreenshots.fetch}`
        );
        const troubleshootingScreenshots = await verifyLogAndReportSurfaces();
        console.log(
            `Show log and the generated full-report dialogue were reached through their registered commands. Screenshots: ${troubleshootingScreenshots.log}, ${troubleshootingScreenshots.report}`
        );
        const hatchScreenshot = await verifyHatchSurfacesAndSafeActions();
        console.log(
            `Hatch repair controls were reachable, safe empty-fixture runs completed, and persistent logging was enabled, verified, disabled, and removed. Screenshot: ${hatchScreenshot}`
        );

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
            const mobileCouchDBScreenshot = await verifyCouchDBSettingsDialogue("mobile");
            console.log(
                `Mobile CouchDB settings dialogue passed viewport, touch-target, and vertical-action checks. Screenshot: ${mobileCouchDBScreenshot}`
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
