import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
    assertLocatorHasMinimumTouchTarget,
    assertLocatorWithinSafeArea,
    assertNoHorizontalOverflow,
} from "@vrtmrz/obsidian-test-session";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { assertMobileDialogueLayout, iPhoneSafeArea, setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import {
    captureObsidianDialogue,
    obsidianRemoteDebuggingPort,
    openLiveSyncSettings,
    waitForVisibleObsidianDialogue,
    withObsidianPage,
} from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_ONBOARDING_TIMEOUT_MS ?? 15000);
const markerPath = "E2E/unconfigured-startup-must-not-scan.md";

type UnconfiguredStartupEvidence = {
    configured: boolean;
    markerInDatabase: boolean;
    offlineScanInitialised: boolean;
    recommendedDefaults: {
        usePluginSyncV2: boolean;
        handleFilenameCaseSensitive: boolean;
    };
};

async function writeMarker(vaultPath: string): Promise<void> {
    const fullPath = join(vaultPath, markerPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, "# This file must remain outside the database until setup completes.\n", "utf8");
}

async function inspectUnconfiguredStartup(
    cliBinary: string,
    env: NodeJS.ProcessEnv
): Promise<UnconfiguredStartupEvidence> {
    return await evalObsidianJson<UnconfiguredStartupEvidence>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `const markerPath=${JSON.stringify(markerPath)};`,
            "let entry=false;",
            "try{entry=await core.localDatabase.getDBEntry(markerPath,undefined,false,false);}catch{}",
            "let initialised=false;",
            "try{initialised=(await core.kvDB.get('initialized'))===true;}catch{}",
            "const settings=core.services.setting.currentSettings();",
            "return JSON.stringify({",
            "configured:settings?.isConfigured===true,",
            "markerInDatabase:Boolean(entry&&entry._id),",
            "offlineScanInitialised:initialised,",
            "recommendedDefaults:{",
            "usePluginSyncV2:settings?.usePluginSyncV2,",
            "handleFilenameCaseSensitive:settings?.handleFilenameCaseSensitive,",
            "},",
            "});",
            "})()",
        ].join(""),
        env
    );
}

function onboardingNotice(page: Parameters<Parameters<typeof withObsidianPage>[1]>[0]) {
    return page.locator(".notice").filter({ hasText: "Welcome to Self-hosted LiveSync" });
}

function onboardingDialogue(page: Parameters<Parameters<typeof withObsidianPage>[1]>[0]) {
    return page.locator(".modal-container").filter({ hasText: "Welcome to Self-hosted LiveSync" });
}

async function requireInvitationWithoutDialogue(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const invitation = onboardingNotice(page);
        await invitation.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await invitation.locator(".sls-onboarding-invitation-action").waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        if ((await onboardingDialogue(page).count()) !== 0) {
            throw new Error("The onboarding dialogue opened before the user selected the invitation.");
        }
        const compatibilityReview = page.locator(".modal-container").filter({
            hasText: "Synchronisation paused for compatibility review",
        });
        if ((await compatibilityReview.count()) !== 0) {
            throw new Error("A new unconfigured Vault was incorrectly treated as an existing compatibility state.");
        }
    });
}

async function captureDesktopInvitation(): Promise<string> {
    return await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        "onboarding-invitation-desktop.png",
        async (page) => {
            const invitation = onboardingNotice(page);
            await invitation.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await assertNoHorizontalOverflow(page, invitation, { label: "desktop onboarding invitation" });
        }
    );
}

async function captureAndSelectMobileInvitation(): Promise<string> {
    const port = obsidianRemoteDebuggingPort();
    await setObsidianMobileTestMode(port, true, uiTimeoutMs);
    const screenshot = await captureObsidianDialogue(port, "onboarding-invitation-mobile.png", async (page) => {
        const invitation = onboardingNotice(page);
        const action = invitation.locator(".sls-onboarding-invitation-action");
        await invitation.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await assertLocatorWithinSafeArea(page, invitation, {
            label: "mobile onboarding invitation",
            safeAreaInsets: iPhoneSafeArea,
        });
        await assertNoHorizontalOverflow(page, invitation, { label: "mobile onboarding invitation" });
        await assertLocatorHasMinimumTouchTarget(page, action, {
            label: "mobile onboarding invitation action",
        });
    });
    await withObsidianPage(port, async (page) => {
        const invitation = onboardingNotice(page);
        await invitation.locator(".sls-onboarding-invitation-action").click({ timeout: uiTimeoutMs });
        await invitation.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    return screenshot;
}

async function captureMobilePasswordToggle(): Promise<string> {
    const port = obsidianRemoteDebuggingPort();
    await withObsidianPage(port, async (page) => {
        const intro = onboardingDialogue(page);
        await intro
            .locator("label")
            .filter({ hasText: "I am setting this up for the first time" })
            .locator('input[type="radio"]')
            .first()
            .check({ timeout: uiTimeoutMs });
        await intro
            .getByRole("button", { name: "Yes, I want to set up a new synchronisation" })
            .click({ timeout: uiTimeoutMs });

        const method = page.locator(".modal-container").filter({ hasText: "Connection Method" });
        await method.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await method
            .locator("label")
            .filter({ hasText: "Configure a remote manually" })
            .locator('input[type="radio"]')
            .first()
            .check({ timeout: uiTimeoutMs });
        await method.getByRole("button", { name: "Proceed with manual configuration" }).click({ timeout: uiTimeoutMs });

        const encryption = page.locator(".modal-container").filter({ hasText: "End-to-End Encryption" });
        await encryption.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await encryption
            .locator("label.row")
            .filter({ hasText: "End-to-End Encryption" })
            .locator('input[type="checkbox"]')
            .first()
            .check({ timeout: uiTimeoutMs });
    });
    const screenshot = await captureObsidianDialogue(port, "onboarding-e2ee-mobile.png", async (page) => {
        const encryption = page.locator(".modal-container").filter({ hasText: "End-to-End Encryption" });
        const passwordToggle = encryption.locator("button.sls-password-toggle");
        await passwordToggle.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await passwordToggle.evaluate((element) => element.scrollIntoView({ block: "center" }));
        await assertLocatorHasMinimumTouchTarget(page, passwordToggle, {
            label: "mobile password visibility button",
        });
    });
    await withObsidianPage(port, async (page) => {
        const encryption = page.locator(".modal-container").filter({ hasText: "End-to-End Encryption" });
        await encryption.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: uiTimeoutMs });
        await encryption.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    return screenshot;
}

async function captureIntro(filename: string, mobile: boolean, closeAfterCapture = true): Promise<string> {
    const port = obsidianRemoteDebuggingPort();
    const screenshot = await captureObsidianDialogue(port, filename, async (page) => {
        const container = onboardingDialogue(page);
        await container.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await container.getByText("I am setting this up for the first time", { exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        await container
            .getByText("I am adding a device to an existing synchronisation setup", { exact: true })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        if (mobile) await assertMobileDialogueLayout(page, container, "mobile onboarding introduction");
    });
    if (closeAfterCapture) {
        await withObsidianPage(port, async (page) => {
            const container = onboardingDialogue(page);
            await container.getByRole("button", { name: "No, please take me back" }).click({ timeout: uiTimeoutMs });
            await container.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });
    }
    return screenshot;
}

async function openOnboardingFromSettings(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const settingsNavigator = await openLiveSyncSettings(page, uiTimeoutMs);
        const liveSyncSettings =
            settingsNavigator.renderer === "declarative"
                ? (await settingsNavigator.returnToCatalogue(), settingsNavigator.dialogue)
                : await settingsNavigator.openPage("Quick Setup");

        const onboardingSetting = liveSyncSettings.locator(".setting-item").filter({
            has: settingsNavigator.page.locator(".setting-item-name").filter({ hasText: "Rerun Onboarding Wizard" }),
        });
        await onboardingSetting.waitFor({ state: "visible", timeout: uiTimeoutMs });
        if (settingsNavigator.renderer === "declarative") {
            await onboardingSetting.click({ timeout: uiTimeoutMs });
        } else {
            await onboardingSetting
                .getByRole("button", { name: "Rerun Wizard", exact: true })
                .click({ timeout: uiTimeoutMs });
        }
        await waitForVisibleObsidianDialogue(settingsNavigator.page, "Welcome to Self-hosted LiveSync", uiTimeoutMs);
    });
}

async function dismissVisibleNotices(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const notices = page.locator(".notice:visible");
        let noticeIndex = 0;
        while ((await notices.count()) > 0) {
            const marker = `livesync-e2e-notice-${noticeIndex++}`;
            await notices
                .first()
                .evaluate((element, value) => element.setAttribute("data-livesync-e2e-notice", value), marker);
            const markedNotice = page.locator(`[data-livesync-e2e-notice="${marker}"]`);
            await markedNotice.click({ position: { x: 8, y: 8 }, timeout: uiTimeoutMs });
            // Follow the notice which was clicked. Another concurrently added
            // notice must not make a total-count wait look permanently stuck.
            await markedNotice.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        }
    });
}

async function closeSettings(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const settingsNavigator = await openLiveSyncSettings(page, uiTimeoutMs);
        await settingsNavigator.close();
    });
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;
    try {
        await writeMarker(vault.path);
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });

        await requireInvitationWithoutDialogue();
        const evidence = await inspectUnconfiguredStartup(cli.binary, session.cliEnv);
        if (
            evidence.configured ||
            evidence.markerInDatabase ||
            evidence.offlineScanInitialised ||
            evidence.recommendedDefaults.usePluginSyncV2 !== true ||
            evidence.recommendedDefaults.handleFilenameCaseSensitive !== false
        ) {
            throw new Error(`Fresh Vault startup state did not match its contract: ${JSON.stringify(evidence)}`);
        }
        console.log(`Fresh Vault startup evidence: ${JSON.stringify(evidence)}`);

        const desktopInvitation = await captureDesktopInvitation();
        const mobileInvitation = await captureAndSelectMobileInvitation();
        const mobileIntro = await captureIntro("onboarding-intro-mobile.png", true, false);
        const mobileEncryption = await captureMobilePasswordToggle();
        await setObsidianMobileTestMode(obsidianRemoteDebuggingPort(), false, uiTimeoutMs);
        await openOnboardingFromSettings();
        const settingsIntro = await captureIntro("onboarding-intro-settings-desktop.png", false);
        await dismissVisibleNotices();
        await closeSettings();

        console.log(
            `Onboarding remained opt-in and kept unconfigured startup inert. Screenshots: ${[
                desktopInvitation,
                mobileInvitation,
                mobileIntro,
                mobileEncryption,
                settingsIntro,
            ].join(", ")}`
        );
    } finally {
        if (session) {
            await setObsidianMobileTestMode(obsidianRemoteDebuggingPort(), false, uiTimeoutMs).catch(() => undefined);
            await session.app.stop();
        }
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
