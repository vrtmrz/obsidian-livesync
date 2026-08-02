/**
 * Exercises Adaptive Journal WebDAV through visible safety-gated onboarding.
 * The shared Adaptive Journal runner owns restart persistence, device-generated
 * Setup URI transfer, Fast Fetch, and a two-device text and binary return
 * journey. This scenario retains only the WebDAV UI and live endpoint boundary.
 */
import { parseWebDAVConnectionURI } from "@vrtmrz/livesync-commonlib/journal-storage";
import { runAdaptiveJournalObsidianRoundTrip, runNpmScript } from "../runner/adaptiveJournal.ts";
import { assertEqual } from "../runner/liveSyncWorkflow.ts";
import { captureGuideDialogue, modalByTitle, selectRadioOption, type SetupState } from "../runner/setupUri.ts";
import { withObsidianPage } from "../runner/ui.ts";
import {
    assertWebDAVReachable,
    deleteWebDAVPrefix,
    loadWebDAVConfig,
    makeUniqueWebDAVPrefix,
    type WebDAVConfig,
} from "../runner/webDAV.ts";

const supportedArguments = new Set(["--keep-webdav", "--manage-webdav"]);
const unsupportedArguments = process.argv.slice(2).filter((argument) => !supportedArguments.has(argument));
if (unsupportedArguments.length > 0) {
    throw new Error(`Unsupported Adaptive WebDAV argument: ${unsupportedArguments.join(", ")}`);
}

const manageWebDAV = process.argv.includes("--manage-webdav");
const keepWebDAVFixture = process.argv.includes("--keep-webdav");
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETUP_URI_TIMEOUT_MS ?? 30000);

async function enterManualAdaptiveWebDAVSettings(
    port: number,
    webDAV: WebDAVConfig,
    prefix: string,
    vaultPassphrase: string
): Promise<string[]> {
    const screenshots: string[] = [];
    await withObsidianPage(port, async (page) => {
        const invitation = page.locator(".notice").filter({ hasText: "Welcome to Self-hosted LiveSync" });
        await invitation.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await invitation.locator(".sls-onboarding-invitation-action").click({ timeout: uiTimeoutMs });

        const intro = modalByTitle(page, "Welcome to Self-hosted LiveSync");
        await intro.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await selectRadioOption(intro, "I am setting this up for the first time");
        await intro
            .getByRole("button", { name: "Yes, I want to set up a new synchronisation" })
            .click({ timeout: uiTimeoutMs });

        const method = modalByTitle(page, "Connection Method");
        await method.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await selectRadioOption(method, "Configure a remote manually");
        await method.getByRole("button", { name: "Proceed with manual configuration" }).click({ timeout: uiTimeoutMs });

        const encryption = modalByTitle(page, "End-to-End Encryption");
        await encryption.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await encryption
            .locator("label.row")
            .filter({ hasText: "End-to-End Encryption" })
            .locator('input[type="checkbox"]')
            .first()
            .check({ timeout: uiTimeoutMs });
        await encryption.locator('input[name="e2ee-passphrase"]').fill(vaultPassphrase);
    });
    screenshots.push(await captureGuideDialogue(port, "guide-adaptive-webdav-encryption.png", "End-to-End Encryption"));

    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, "End-to-End Encryption")
            .getByRole("button", { name: "Proceed", exact: true })
            .click({ timeout: uiTimeoutMs });

        const remoteSelection = modalByTitle(page, "Choose a synchronisation remote");
        await remoteSelection.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await selectRadioOption(remoteSelection, "WebDAV Journal");
        await remoteSelection
            .getByRole("button", { name: "Continue to WebDAV setup", exact: true })
            .click({ timeout: uiTimeoutMs });

        const webDAVModal = modalByTitle(page, "WebDAV Journal Configuration");
        await webDAVModal.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await webDAVModal.locator('input[name="webdav-endpoint"]').fill(webDAV.endpoint);
        await webDAVModal.locator('input[name="webdav-username"]').fill(webDAV.username);
        await webDAVModal.locator('input[name="webdav-password"]').fill(webDAV.password);
        await webDAVModal.locator('input[name="webdav-prefix"]').fill(prefix);
        await webDAVModal.locator('input[name="webdav-use-internal-api"]').check({ timeout: uiTimeoutMs });
        await webDAVModal.locator("summary").filter({ hasText: "Advanced Settings" }).click();
        await webDAVModal.locator('select[name="webdav-journal-format"]').selectOption("adaptive-v1");
        const packPolicy = webDAVModal.locator('select[name="webdav-pack-read-policy"]');
        await packPolicy.waitFor({ state: "visible", timeout: uiTimeoutMs });
        assertEqual(
            await packPolicy.inputValue(),
            "whole-pack",
            "Adaptive WebDAV did not present complete Pack retrieval as the default."
        );
        if (
            (await webDAVModal
                .getByRole("button", { name: "Continue with verified settings", exact: true })
                .count()) !== 0
        ) {
            throw new Error("Adaptive WebDAV could continue before its endpoint safety check completed.");
        }
        await webDAVModal
            .getByRole("button", { name: "Run endpoint safety check", exact: true })
            .click({ timeout: uiTimeoutMs });
        await webDAVModal
            .getByText("Required Adaptive operations are supported by this WebDAV endpoint.", { exact: false })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        await webDAVModal
            .getByText("Exact HTTP byte-range retrieval is supported.", { exact: false })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        await webDAVModal
            .getByRole("button", { name: "Continue with verified settings", exact: true })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        if ((await webDAVModal.getByRole("button", { name: "Save without connecting", exact: true }).count()) !== 0) {
            throw new Error("Adaptive WebDAV onboarding exposed the unverified Settings-only save action.");
        }
    });
    screenshots.push(
        await captureGuideDialogue(port, "guide-adaptive-webdav-safety-check.png", "WebDAV Journal Configuration")
    );
    await withObsidianPage(port, async (page) => {
        const webDAVModal = modalByTitle(page, "WebDAV Journal Configuration");
        await webDAVModal
            .getByRole("button", { name: "Continue with verified settings", exact: true })
            .click({ timeout: uiTimeoutMs });
        await modalByTitle(page, "Setup Complete: Preparing to Initialise Server").waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
    });
    return screenshots;
}

function assertAdaptiveWebDAVSettings(state: SetupState, webDAV: WebDAVConfig, prefix: string, label: string): void {
    assertEqual(state.remoteType, "WEBDAV", `${label} did not retain WebDAV as its active remote.`);
    assertEqual(state.journalFormat, "adaptive-v1", `${label} did not retain the Adaptive Journal format.`);
    assertEqual(state.packReadPolicy, "whole-pack", `${label} did not retain complete Pack retrieval.`);
    assertEqual(state.remoteConfigurationCount, 1, `${label} did not retain exactly one remote profile.`);
    const connection = parseWebDAVConnectionURI(state.webDAVactiveConnectionURI);
    assertEqual(connection.endpoint, webDAV.endpoint, `${label} retained a different WebDAV endpoint.`);
    assertEqual(connection.username, webDAV.username, `${label} retained a different WebDAV username.`);
    assertEqual(connection.password, webDAV.password, `${label} retained a different WebDAV password.`);
    assertEqual(connection.prefix, prefix, `${label} retained a different WebDAV prefix.`);
    assertEqual(
        connection.useCustomRequestHandler,
        true,
        `${label} did not retain the Obsidian internal request API selection.`
    );
}

async function main(): Promise<void> {
    const webDAV = await loadWebDAVConfig();
    const prefix = makeUniqueWebDAVPrefix("adaptive-obsidian");
    let shouldStopWebDAV = false;

    try {
        if (manageWebDAV) {
            await runNpmScript("test:docker-webdav:start");
            shouldStopWebDAV = !keepWebDAVFixture;
        }
        await assertWebDAVReachable(webDAV);
        await runAdaptiveJournalObsidianRoundTrip({
            label: "Adaptive WebDAV",
            slug: "adaptive-webdav",
            targetDescription: `Temporary WebDAV target: ${webDAV.endpoint}/${prefix}`,
            enterManualSettings: async (port, vaultPassphrase) =>
                await enterManualAdaptiveWebDAVSettings(port, webDAV, prefix, vaultPassphrase),
            assertSettings: (state, label) => assertAdaptiveWebDAVSettings(state, webDAV, prefix, label),
        });
    } finally {
        if (process.env.E2E_OBSIDIAN_KEEP_WEBDAV !== "true") {
            await deleteWebDAVPrefix(webDAV, prefix).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
        if (shouldStopWebDAV) {
            await runNpmScript("test:docker-webdav:stop").catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
