import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    assertLocatorHasMinimumTouchTarget,
    assertLocatorWithinSafeArea,
    assertNoHorizontalOverflow,
} from "@vrtmrz/obsidian-test-session";
import { CURRENT_SETTING_VERSION } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import { REVIEW_HARNESS_STATE_KEY } from "../../../src/features/ReviewHarness/reviewHarnessController.ts";
import { REVIEW_HARNESS_FIXTURE_ROOT } from "../../../src/features/ReviewHarness/reviewHarnessVaultFixture.ts";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { iPhoneSafeArea, setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import {
    captureObsidianDialogue,
    captureObsidianPage,
    obsidianRemoteDebuggingPort,
    withObsidianPage,
} from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_REVIEW_HARNESS_TIMEOUT_MS ?? 15000);

type ObsidianTestApp = {
    commands?: { executeCommandById(commandId: string): boolean };
    plugins?: { plugins: Record<string, unknown> };
    vault?: { getAbstractFileByPath(path: string): unknown | null };
};

type ReviewHarnessTestGlobal = typeof globalThis & {
    app?: ObsidianTestApp;
    reviewHarnessCopiedReport?: string;
};

type ReviewHarnessReadinessSnapshot = {
    coreAvailable: boolean;
    databaseReady?: boolean;
    appReady?: boolean;
    configured?: boolean;
    remoteType?: string;
    settingVersion?: number;
    suspended?: boolean;
    unresolvedMessages: string[];
};

const sensitiveDiagnosticLine =
    /security seed|passphrase|password|credential|secret|access.?key|jwt.?key|authori[sz]ation|obsidian:\/\/setuplivesync|sls\+/iu;
const interruptedStartupMessages = [
    "No replicator has been activated or has not been initialised yet.",
    "Self-hosted LiveSync cannot be initialised, exiting loading.",
];

function redactDiagnosticLine(line: string): string {
    if (sensitiveDiagnosticLine.test(line)) return "[REDACTED SENSITIVE LOG LINE]";
    return line.replace(/\bhttps?:\/\/[^/\s:@]+:[^@\s/]+@/giu, "https://[REDACTED]@");
}

async function assertNoInterruptedStartupNotice(stage: string): Promise<void> {
    const notices = await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.waitForTimeout(1500);
        return await page.locator(".notice").allTextContents();
    });
    const interrupted = notices.filter((notice) =>
        interruptedStartupMessages.some((message) => notice.includes(message))
    );
    if (interrupted.length > 0) {
        throw new Error(`LiveSync emitted an interrupted-startup Notice during ${stage}: ${interrupted.join(" | ")}`);
    }
    console.log(`No interrupted-startup Notice observed during ${stage}.`);
}

async function captureReadinessFailure(
    cliBinary: string,
    session: ObsidianLiveSyncSession,
    readinessError: unknown
): Promise<void> {
    const outputDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
    await mkdir(outputDirectory, { recursive: true });

    const captureErrors: string[] = [];
    let screenshotPath: string | undefined;
    try {
        screenshotPath = await captureObsidianPage(
            obsidianRemoteDebuggingPort(),
            "review-harness-core-not-ready.png",
            async () => undefined
        );
    } catch (error) {
        captureErrors.push(`screenshot: ${error instanceof Error ? error.message : String(error)}`);
    }

    let readiness: ReviewHarnessReadinessSnapshot | undefined;
    try {
        readiness = await evalObsidianJson<ReviewHarnessReadinessSnapshot>(
            cliBinary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync']?.core;",
                "if(!core)return JSON.stringify({coreAvailable:false,unresolvedMessages:[]});",
                "const settings=core.services.setting.currentSettings();",
                "let unresolvedMessages=[];",
                "try{",
                "unresolvedMessages=(await core.services.appLifecycle.getUnresolvedMessages()).flat()",
                ".filter((message)=>message!==undefined&&message!==null)",
                ".map((message)=>String(message)).slice(-50);",
                "}catch(error){unresolvedMessages=[`Could not inspect unresolved messages: ${String(error)}`];}",
                "return JSON.stringify({",
                "coreAvailable:true,",
                "databaseReady:core.services.database.isDatabaseReady(),",
                "appReady:core.services.appLifecycle.isReady(),",
                "configured:settings?.isConfigured===true,",
                "remoteType:settings?.remoteType??'',",
                "settingVersion:settings?.settingVersion,",
                "suspended:core.services.appLifecycle.isSuspended(),",
                "unresolvedMessages,",
                "});",
                "})()",
            ].join(""),
            session.cliEnv
        );
        readiness.unresolvedMessages = readiness.unresolvedMessages.map(redactDiagnosticLine);
    } catch (error) {
        captureErrors.push(`readiness snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }

    let recentLog: string[] = [];
    try {
        recentLog = await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
            const opened = await page.evaluate(
                (commandId) =>
                    (globalThis as ReviewHarnessTestGlobal).app?.commands?.executeCommandById(commandId) === true,
                "obsidian-livesync:view-log"
            );
            if (!opened) throw new Error("The Show log command was not registered.");
            const logPane = page.locator(".logpane");
            await logPane.waitFor({ state: "visible", timeout: 5000 });
            return (await logPane.locator(".log pre").allTextContents()).slice(-80).map(redactDiagnosticLine);
        });
    } catch (error) {
        captureErrors.push(`recent log: ${error instanceof Error ? error.message : String(error)}`);
    }

    const resultPath = join(outputDirectory, "review-harness-core-not-ready.json");
    await writeFile(
        resultPath,
        `${JSON.stringify(
            {
                capturedAt: new Date().toISOString(),
                failure: readinessError instanceof Error ? readinessError.message : String(readinessError),
                screenshotPath,
                readiness,
                recentLog,
                captureErrors,
            },
            null,
            2
        )}\n`,
        "utf8"
    );
    if (screenshotPath) console.error(`Review Harness core readiness screenshot: ${screenshotPath}`);
    console.error(`Review Harness core readiness diagnostics: ${resultPath}`);
}

async function openHarness(): Promise<void> {
    const opened = await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        return await page.evaluate(
            (commandId) => (globalThis as ReviewHarnessTestGlobal).app?.commands?.executeCommandById(commandId) === true,
            "obsidian-livesync:open-review-harness"
        );
    });
    if (!opened) throw new Error("The Review Harness command was not registered.");
}

async function waitForHarness(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.locator('[data-testid="review-harness"]').waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
}

async function keepCompatibilityPaused(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const summary = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({
                hasText: "Synchronisation paused for compatibility review",
            }),
        });
        await summary.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await summary.getByRole("button", { name: "Keep synchronisation paused" }).click({ timeout: uiTimeoutMs });
        await summary.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
}

async function runAutomaticScenarios(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const harness = page.locator('[data-testid="review-harness"]');
        await harness.locator('[data-testid="review-harness-run-automatic"]').click({ timeout: uiTimeoutMs });
        for (const id of ["settings-lifecycle"]) {
            await harness
                .locator(`[data-testid="review-harness-result-${id}"]`)
                .getByText("Passed:", { exact: false })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
        }
    });
}

async function runVaultFixture(): Promise<string> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page
            .locator('[data-testid="review-harness-run-vault-round-trip"]')
            .click({ timeout: uiTimeoutMs });
        const confirmation = page.locator(".modal-container").filter({
            has: page.getByText("Review Harness: Vault fixture access", { exact: true }),
        });
        await confirmation.waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
    const screenshot = await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        "review-harness-vault-confirmation.png",
        async (page) => {
            const confirmation = page.locator(".modal-container").filter({
                has: page.getByText("Review Harness: Vault fixture access", { exact: true }),
            });
            await confirmation.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await assertNoHorizontalOverflow(page, confirmation, { label: "Vault fixture confirmation" });
        }
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const harness = page.locator('[data-testid="review-harness"]');
        const confirmation = page.locator(".modal-container").filter({
            has: page.getByText("Review Harness: Vault fixture access", { exact: true }),
        });
        await confirmation.getByRole("button", { name: "Yes" }).click({ timeout: uiTimeoutMs });
        await harness
            .locator('[data-testid="review-harness-result-vault-round-trip"]')
            .getByText("Passed:", { exact: false })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        const fixtureRemoved = await page.evaluate(
            (root) => (globalThis as ReviewHarnessTestGlobal).app?.vault?.getAbstractFileByPath(root) === null,
            REVIEW_HARNESS_FIXTURE_ROOT
        );
        if (!fixtureRemoved) throw new Error("The Review Harness fixture root remained after the scenario.");
    });
    return screenshot;
}

async function restartAndResumeHarness(): Promise<string> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const harness = page.locator('[data-testid="review-harness"]');
        await harness
            .locator('[data-testid="review-harness-run-compatibility-review"]')
            .click({ timeout: uiTimeoutMs });
        await harness
            .locator('[data-testid="review-harness-result-compatibility-review"]')
            .getByText("Waiting for review:", { exact: false })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        await harness.locator('[data-testid="review-harness-restart"]').click({ timeout: uiTimeoutMs });
    });

    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.waitForFunction(
            () => {
                const plugin = (globalThis as ReviewHarnessTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                if (typeof plugin !== "object" || plugin === null || !("core" in plugin)) return false;
                const core = (plugin as { core: { services: { appLifecycle: { isReady(): boolean } } } }).core;
                return core.services.appLifecycle.isReady();
            },
            undefined,
            { timeout: uiTimeoutMs * 2 }
        );
    });
    await keepCompatibilityPaused();
    await waitForHarness();
    return await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        "review-harness-resumed.png",
        async (page) => {
            const harness = page.locator('[data-testid="review-harness"]');
            await harness
                .locator('[data-testid="review-harness-resumed"]')
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            const continuationRemoved = await page.evaluate((stateKey) => {
                const plugin = (globalThis as ReviewHarnessTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
                if (typeof plugin !== "object" || plugin === null || !("core" in plugin)) {
                    throw new Error("Self-hosted LiveSync is unavailable after restart.");
                }
                const core = (plugin as { core: { services: { setting: { getSmallConfig(key: string): string } } } })
                    .core;
                return core.services.setting.getSmallConfig(stateKey) === "";
            }, REVIEW_HARNESS_STATE_KEY);
            if (!continuationRemoved) throw new Error("The one-shot continuation was not removed before use.");
            await assertNoHorizontalOverflow(page, harness, { label: "resumed Review Harness" });
        }
    );
}

async function completeResumedCompatibilityStep(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const harness = page.locator('[data-testid="review-harness"]');
        await harness
            .locator('[data-testid="review-harness-open-compatibility-review"]')
            .click({ timeout: uiTimeoutMs });
        const summary = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({
                hasText: "Synchronisation paused for compatibility review",
            }),
        });
        await summary.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await summary.getByRole("button", { name: "Resume synchronisation" }).click({ timeout: uiTimeoutMs });
        await summary.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        await harness
            .locator('[data-testid="review-harness-result-compatibility-review"]')
            .getByText("The device-local compatibility pause was reviewed and cleared.", { exact: false })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
}

async function copyAndReadReport(): Promise<string> {
    return await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.evaluate(`
            globalThis.reviewHarnessCopiedReport = undefined;
            navigator.clipboard.writeText = function (value) {
                globalThis.reviewHarnessCopiedReport = value;
                return Promise.resolve();
            };
        `);
        await page.locator('[data-testid="review-harness-copy-report"]').click({ timeout: uiTimeoutMs });
        await page.waitForFunction(
            () => typeof (globalThis as ReviewHarnessTestGlobal).reviewHarnessCopiedReport === "string",
            undefined,
            { timeout: uiTimeoutMs }
        );
        return await page.evaluate(
            () => (globalThis as ReviewHarnessTestGlobal).reviewHarnessCopiedReport ?? ""
        );
    });
}

async function verifyMobileHarness(): Promise<string> {
    await setObsidianMobileTestMode(obsidianRemoteDebuggingPort(), true, uiTimeoutMs);
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const harness = page.locator('[data-testid="review-harness"]');
        if (await harness.isVisible()) return;
        await page.evaluate(async (viewType) => {
            const plugin = (globalThis as ReviewHarnessTestGlobal).app?.plugins?.plugins["obsidian-livesync"];
            if (typeof plugin !== "object" || plugin === null || !("core" in plugin)) {
                throw new Error("Self-hosted LiveSync is unavailable in mobile test mode.");
            }
            const core = (plugin as {
                core: { services: { API: { showWindow(type: string): Promise<void> } } };
            }).core;
            await core.services.API.showWindow(viewType);
        }, "self-hosted-livesync-review-harness");
    });
    return await captureObsidianDialogue(
        obsidianRemoteDebuggingPort(),
        "review-harness-mobile.png",
        async (page) => {
            const harness = page.locator('[data-testid="review-harness"]');
            await harness.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await assertNoHorizontalOverflow(page, harness, { label: "mobile Review Harness" });
            const heading = harness.getByRole("heading", { name: "Self-hosted LiveSync review harness" });
            await assertLocatorWithinSafeArea(page, heading, {
                label: "mobile Review Harness heading",
                safeAreaInsets: iPhoneSafeArea,
            });
            for (const testId of [
                "review-harness-run-automatic",
                "review-harness-run-full",
                "review-harness-copy-report",
            ]) {
                await assertLocatorHasMinimumTouchTarget(page, harness.locator(`[data-testid="${testId}"]`), {
                    label: testId,
                });
            }
        }
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: {
                doctorProcessedVersion: "1.0.0",
                settingVersion: CURRENT_SETTING_VERSION,
                isConfigured: true,
                additionalSuffixOfDatabaseName: "",
                enableDebugTools: true,
                notifyThresholdOfRemoteStorageSize: 0,
                P2P_Enabled: false,
                P2P_AutoStart: false,
                liveSync: false,
                syncOnSave: false,
                syncOnEditorSave: true,
                syncOnStart: false,
                syncOnFileOpen: true,
                syncAfterMerge: false,
                periodicReplication: true,
            },
        });
        await assertNoInterruptedStartupNotice("plug-in session start");
        try {
            await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        } catch (error) {
            await captureReadinessFailure(cli.binary, session, error).catch((diagnosticError: unknown) => {
                console.error(
                    `Could not capture Review Harness readiness diagnostics: ${
                        diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
                    }`
                );
            });
            throw error;
        }
        await assertNoInterruptedStartupNotice("core readiness");
        await keepCompatibilityPaused();
        await openHarness();
        await waitForHarness();

        const initialScreenshot = await captureObsidianDialogue(
            obsidianRemoteDebuggingPort(),
            "review-harness-initial.png",
            async (page) => {
                const harness = page.locator('[data-testid="review-harness"]');
                await harness.waitFor({ state: "visible", timeout: uiTimeoutMs });
                await assertNoHorizontalOverflow(page, harness, { label: "Review Harness" });
            }
        );

        await runAutomaticScenarios();
        const vaultConfirmationScreenshot = await runVaultFixture();
        const resumedScreenshot = await restartAndResumeHarness();
        await completeResumedCompatibilityStep();
        const report = await copyAndReadReport();
        if (!report.includes("## Self-hosted LiveSync Review Harness report")) {
            throw new Error("The copied Review Harness report was not Markdown evidence.");
        }
        for (const forbidden of [vault.name, REVIEW_HARNESS_FIXTURE_ROOT]) {
            if (report.includes(forbidden)) throw new Error(`The Review Harness report exposed local state: ${forbidden}`);
        }

        const mobileScreenshot = await verifyMobileHarness();
        console.log(
            `Review Harness passed one-shot, fixture, report, and mobile checks. Screenshots: ${[
                initialScreenshot,
                vaultConfirmationScreenshot,
                resumedScreenshot,
                mobileScreenshot,
            ].join(", ")}`
        );
    } finally {
        if (session) await session.app.stop();
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
