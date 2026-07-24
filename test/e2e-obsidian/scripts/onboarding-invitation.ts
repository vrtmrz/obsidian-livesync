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
import { captureObsidianDialogue, obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
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

type ObsidianTestApp = {
    setting?: {
        open(): void;
        openTabById(tabId: string): void;
    };
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

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
        await onboardingNotice(page).locator(".sls-onboarding-invitation-action").click({ timeout: uiTimeoutMs });
    });
    return screenshot;
}

async function captureAndCloseIntro(filename: string, mobile: boolean): Promise<string> {
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
    await withObsidianPage(port, async (page) => {
        const container = onboardingDialogue(page);
        await container.getByRole("button", { name: "No, please take me back" }).click({ timeout: uiTimeoutMs });
        await container.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    return screenshot;
}

async function openOnboardingFromSettings(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.evaluate(() => {
            const setting = (globalThis as ObsidianTestGlobal).app?.setting;
            if (setting === undefined) throw new Error("Obsidian settings are unavailable");
            setting.open();
            setting.openTabById("obsidian-livesync");
        });

        const liveSyncSettings = page.locator(".sls-setting");
        await liveSyncSettings.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await liveSyncSettings.locator('.sls-setting-menu-btn[title="Setup"]').click({ timeout: uiTimeoutMs });

        const onboardingSetting = liveSyncSettings.locator(".setting-item").filter({
            has: page.locator(".setting-item-name").filter({ hasText: "Rerun Onboarding Wizard" }),
        });
        await onboardingSetting.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await onboardingSetting
            .getByRole("button", { name: "Rerun Wizard", exact: true })
            .click({ timeout: uiTimeoutMs });
        await onboardingDialogue(page).waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
}

async function closeSettings(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const settingsContainer = page.locator(".modal-container").filter({
            has: page.locator(".sls-setting"),
        });
        await settingsContainer.locator(".modal-close-button").click({ timeout: uiTimeoutMs });
        await settingsContainer.waitFor({ state: "hidden", timeout: uiTimeoutMs });
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
        await openOnboardingFromSettings();
        const settingsIntro = await captureAndCloseIntro("onboarding-intro-settings-desktop.png", false);
        await closeSettings();
        const mobileInvitation = await captureAndSelectMobileInvitation();
        const mobileIntro = await captureAndCloseIntro("onboarding-intro-mobile.png", true);

        console.log(
            `Onboarding remained opt-in and kept unconfigured startup inert. Screenshots: ${[
                desktopInvitation,
                mobileInvitation,
                mobileIntro,
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
