import type { Locator, Page } from "playwright";
import { evalObsidianJson } from "./cli.ts";
import { captureObsidianDialogue, captureObsidianElement, withObsidianPage } from "./ui.ts";

export type SetupArtifact = {
    setupURI: string;
    setupPassphrase: string;
};

export type SetupState = {
    configured: boolean;
    databaseReady: boolean;
    appReady: boolean;
    suspended: boolean;
    remoteType: string;
    activeConfigurationId: string;
    remoteConfigurationCount: number;
    endpoint: string;
    bucket: string;
    bucketPrefix: string;
    p2pEnabled: boolean;
    p2pRelays: string;
    p2pRoomId: string;
};

export type SetupCaptureNames = {
    scenario: string;
    guide: string;
};

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETUP_URI_TIMEOUT_MS ?? 30000);
const initialisationTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETUP_INITIALISATION_TIMEOUT_MS ?? 120000);

export function modalByTitle(page: Page, title: string): Locator {
    return page.locator(".modal-container").filter({
        has: page.locator(".modal-title").filter({ hasText: title }),
    });
}

export async function captureGuideDialogue(port: number, filename: string, title: string): Promise<string> {
    return await captureObsidianElement(port, filename, (page) => modalByTitle(page, title).locator(".modal").first());
}

export async function selectRadioOption(modal: Locator, title: string): Promise<void> {
    const radio = modal.locator("label").filter({ hasText: title }).locator('input[type="radio"]').first();
    await radio.check({ timeout: uiTimeoutMs });
}

export async function selectCheckbox(modal: Locator, title: string): Promise<void> {
    const checkbox = modal.locator("label").filter({ hasText: title }).locator('input[type="checkbox"]').first();
    await checkbox.check({ timeout: uiTimeoutMs });
}

export async function enterSetupURI(
    port: number,
    mode: "new" | "existing",
    artifact: SetupArtifact,
    captures: SetupCaptureNames
): Promise<string> {
    await withObsidianPage(port, async (page) => {
        const invitation = page.locator(".notice").filter({ hasText: "Welcome to Self-hosted LiveSync" });
        await invitation.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await invitation.locator(".sls-onboarding-invitation-action").click({ timeout: uiTimeoutMs });

        const intro = modalByTitle(page, "Welcome to Self-hosted LiveSync");
        await intro.waitFor({ state: "visible", timeout: uiTimeoutMs });
        if (mode === "new") {
            await selectRadioOption(intro, "I am setting this up for the first time");
            await intro
                .getByRole("button", { name: "Yes, I want to set up a new synchronisation" })
                .click({ timeout: uiTimeoutMs });
        } else {
            await selectRadioOption(intro, "I am adding a device to an existing synchronisation setup");
            await intro
                .getByRole("button", { name: "Yes, I want to add this device to my existing synchronisation" })
                .click({ timeout: uiTimeoutMs });
        }

        const method = modalByTitle(page, mode === "new" ? "Connection Method" : "Device Setup Method");
        await method.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await selectRadioOption(method, "Use a Setup URI (Recommended)");
        await method.getByRole("button", { name: "Proceed with Setup URI" }).click({ timeout: uiTimeoutMs });

        const setup = modalByTitle(page, "Enter Setup URI");
        await setup.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await setup.locator('input[placeholder^="obsidian://setuplivesync"]').fill(artifact.setupURI);
        await setup.locator('input[name="password"]').fill(artifact.setupPassphrase);
    });
    const screenshot = await captureGuideDialogue(
        port,
        `guide-${captures.guide}-${mode === "new" ? "first" : "second"}-setup-uri.png`,
        "Enter Setup URI"
    );
    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, "Enter Setup URI")
            .getByRole("button", { name: "Test Settings and Continue" })
            .click({ timeout: uiTimeoutMs });
    });
    return screenshot;
}

export async function generateSetupURIFromDevice(
    port: number,
    setupPassphrase: string,
    captures: SetupCaptureNames
): Promise<{ artifact: SetupArtifact; screenshots: string[] }> {
    const opened = await withObsidianPage(port, async (page) => {
        return await page.evaluate(
            (commandId) =>
                (
                    globalThis as typeof globalThis & {
                        app?: { commands?: { executeCommandById(id: string): boolean } };
                    }
                ).app?.commands?.executeCommandById(commandId) === true,
            "obsidian-livesync:livesync-copysetupuri"
        );
    });
    if (!opened) throw new Error("The command for generating a Setup URI was not registered.");

    const promptTitle = "Encrypt your settings";
    await withObsidianPage(port, async (page) => {
        const prompt = modalByTitle(page, promptTitle);
        await prompt.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await prompt.locator('input[type="password"]').fill(setupPassphrase);
    });
    const promptScreenshot = await captureGuideDialogue(
        port,
        `guide-${captures.guide}-copy-setup-uri-passphrase.png`,
        promptTitle
    );
    await withObsidianPage(port, async (page) => {
        const prompt = modalByTitle(page, promptTitle);
        await prompt.getByRole("button", { name: "OK", exact: true }).click({ timeout: uiTimeoutMs });
        await prompt.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });

    const resultTitle = "Your Setup URI is ready to be copied";
    const setupURI = await withObsidianPage(port, async (page) => {
        const result = modalByTitle(page, resultTitle);
        await result.waitFor({ state: "visible", timeout: uiTimeoutMs });
        return await result.locator("textarea[readonly]").inputValue();
    });
    if (!setupURI.startsWith("obsidian://setuplivesync?settings=")) {
        throw new Error("The first device did not generate a valid Setup URI.");
    }
    const resultScreenshot = await captureGuideDialogue(
        port,
        `guide-${captures.guide}-copy-setup-uri-result.png`,
        resultTitle
    );
    await withObsidianPage(port, async (page) => {
        const result = modalByTitle(page, resultTitle);
        await result.getByRole("button", { name: "OK", exact: true }).click({ timeout: uiTimeoutMs });
        await result.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });

    return {
        artifact: { setupURI, setupPassphrase },
        screenshots: [promptScreenshot, resultScreenshot],
    };
}

export async function captureAndStartInitialisation(
    port: number,
    mode: "new" | "existing",
    captures: SetupCaptureNames
): Promise<string> {
    const p2pFirstDevice = mode === "new" && captures.guide === "p2p-setup";
    const title = p2pFirstDevice
        ? "Setup Complete: Preparing This P2P Device"
        : mode === "new"
          ? "Setup Complete: Preparing to Initialise Server"
          : "Setup Complete: Preparing to Fetch Synchronisation Data";
    const button = p2pFirstDevice
        ? "Restart and Prepare This Device"
        : mode === "new"
          ? "Restart and Initialise Server"
          : "Restart and Fetch Data";
    const screenshot = await captureGuideDialogue(
        port,
        `guide-${captures.guide}-${mode === "new" ? "first-initialise" : "second-fetch"}.png`,
        title
    );
    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, title).getByRole("button", { name: button }).click({ timeout: uiTimeoutMs });
    });
    return screenshot;
}

export async function confirmRebuild(port: number, captures: SetupCaptureNames): Promise<string> {
    const isP2P = captures.guide === "p2p-setup";
    const title = isP2P
        ? "Final Confirmation: Prepare This Device for P2P"
        : "Final Confirmation: Overwrite Server Data with This Device's Files";
    const screenshot = await captureGuideDialogue(
        port,
        `guide-${captures.guide}-first-rebuild-confirmation.png`,
        title
    );
    await withObsidianPage(port, async (page) => {
        const modal = modalByTitle(page, title);
        if (isP2P) {
            await selectCheckbox(
                modal,
                "I understand that this resets only this device's local synchronisation database."
            );
            await selectRadioOption(modal, "I understand the risks and will proceed without a backup.");
            await modal
                .getByRole("button", { name: "I Understand, Prepare This Device" })
                .click({ timeout: uiTimeoutMs });
            return;
        }
        await selectCheckbox(
            modal,
            "I understand that all changes made on other smartphones or computers possibly could be lost."
        );
        await selectCheckbox(
            modal,
            "I understand that other devices will no longer be able to synchronise, and will need to be reset the synchronisation information."
        );
        await selectCheckbox(modal, "I understand that this action is irreversible once performed.");
        await selectRadioOption(modal, "I understand the risks and will proceed without a backup.");
        await modal.getByRole("button", { name: "I Understand, Overwrite Server" }).click({ timeout: uiTimeoutMs });
    });
    return screenshot;
}

export async function skipMissingRemoteConfiguration(port: number, captures: SetupCaptureNames): Promise<string> {
    const title = "Fetch Remote Configuration Failed";
    const screenshot = await captureGuideDialogue(
        port,
        `guide-${captures.guide}-missing-remote-configuration.png`,
        title
    );
    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, title)
            .getByRole("button", { name: "Skip and proceed" })
            .click({ timeout: uiTimeoutMs });
    });
    return screenshot;
}

export async function acknowledgeDisabledOptionalFeatures(port: number, captures: SetupCaptureNames): Promise<string> {
    const title = "All optional features are disabled";
    const screenshot = await captureGuideDialogue(
        port,
        `guide-${captures.guide}-optional-features-disabled.png`,
        title
    );
    await withObsidianPage(port, async (page) => {
        const modal = modalByTitle(page, title);
        await modal.getByRole("button", { name: "OK" }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    return screenshot;
}

export async function confirmFastFetch(port: number, captures: SetupCaptureNames): Promise<string[]> {
    const firstTitle = "Data retrieval scheduled";
    const firstScreenshot = await captureGuideDialogue(
        port,
        `guide-${captures.guide}-retrieval-method.png`,
        firstTitle
    );
    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, firstTitle)
            .getByRole("button", { name: "Overwrite all with remote files" })
            .click({ timeout: uiTimeoutMs });
    });

    const secondTitle = "How to handle extra existing local files?";
    const secondScreenshot = await captureGuideDialogue(
        port,
        `guide-${captures.guide}-local-file-policy.png`,
        secondTitle
    );
    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, secondTitle)
            .getByRole("button", { name: "Keep local files even if not on remote" })
            .click({ timeout: uiTimeoutMs });
    });
    return [firstScreenshot, secondScreenshot];
}

function isConfiguredSetupReady(state: SetupState): boolean {
    return (
        state.configured &&
        state.databaseReady &&
        state.appReady &&
        !state.suspended &&
        state.activeConfigurationId !== "" &&
        state.remoteConfigurationCount === 1
    );
}

export async function readSetupState(cliBinary: string, environment: NodeJS.ProcessEnv): Promise<SetupState> {
    return await evalObsidianJson<SetupState>(
        cliBinary,
        [
            "(()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const settings=core.services.setting.currentSettings();",
            "return JSON.stringify({",
            "configured:settings.isConfigured===true,",
            "databaseReady:core.services.database.isDatabaseReady(),",
            "appReady:core.services.appLifecycle.isReady(),",
            "suspended:core.services.appLifecycle.isSuspended(),",
            "remoteType:settings.remoteType||'',",
            "activeConfigurationId:settings.activeConfigurationId||'',",
            "remoteConfigurationCount:Object.keys(settings.remoteConfigurations||{}).length,",
            "endpoint:settings.endpoint||'',",
            "bucket:settings.bucket||'',",
            "bucketPrefix:settings.bucketPrefix||'',",
            "p2pEnabled:settings.P2P_Enabled===true,",
            "p2pRelays:settings.P2P_relays||'',",
            "p2pRoomId:settings.P2P_roomID||'',",
            "});",
            "})()",
        ].join(""),
        environment
    );
}

export async function waitForConfiguredSetup(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    timeoutMs = initialisationTimeoutMs
): Promise<SetupState> {
    const deadline = Date.now() + timeoutMs;
    let lastState: SetupState | undefined;
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            lastState = await readSetupState(cliBinary, environment);
            if (isConfiguredSetupReady(lastState)) return lastState;
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
        `Timed out waiting for configured Setup URI state: ${JSON.stringify(lastState)}${
            lastError instanceof Error ? `; last error: ${lastError.message}` : ""
        }`
    );
}

export async function finishInitialisation(
    port: number,
    cliBinary: string,
    environment: NodeJS.ProcessEnv
): Promise<SetupState> {
    const message = "Do you want to resume file and database processing, and restart obsidian now?";
    const deadline = Date.now() + initialisationTimeoutMs;
    let readySince: number | undefined;
    while (Date.now() < deadline) {
        const resumeVisible = await withObsidianPage(port, async (page) => {
            return await modalByTitle(page, "Confirmation").filter({ hasText: message }).isVisible();
        }).catch(() => false);
        if (resumeVisible) {
            await withObsidianPage(port, async (page) => {
                const modal = modalByTitle(page, "Confirmation").filter({ hasText: message });
                await modal.getByRole("button", { name: "Yes", exact: true }).click({ timeout: uiTimeoutMs });
                await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
            });
            return await waitForConfiguredSetup(cliBinary, environment);
        }
        try {
            const state = await readSetupState(cliBinary, environment);
            if (isConfiguredSetupReady(state)) {
                readySince ??= Date.now();
                if (Date.now() - readySince >= 1000) return state;
            } else {
                readySince = undefined;
            }
        } catch {
            // Obsidian may be reloading while the scheduled operation runs.
            readySince = undefined;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Timed out waiting for Setup URI initialisation to finish.");
}

export async function resumeCompatibilityReviewIfShown(port: number): Promise<boolean> {
    const title = "Synchronisation paused for compatibility review";
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_UI_TIMEOUT_MS ?? 10000);
    let available = false;
    while (Date.now() < deadline && !available) {
        available = await withObsidianPage(port, async (page) => {
            const modal = modalByTitle(page, title);
            if (await modal.isVisible()) return true;
            const reminder = page.locator(".notice.livesync-compatibility-review-notice");
            if (!(await reminder.isVisible())) return false;
            await reminder.getByRole("link", { name: "Review why" }).click({ timeout: uiTimeoutMs });
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            return true;
        }).catch(() => false);
        if (!available) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!available) return false;
    await withObsidianPage(port, async (page) => {
        const modal = modalByTitle(page, title);
        await modal.getByRole("button", { name: "Resume synchronisation" }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    return true;
}
