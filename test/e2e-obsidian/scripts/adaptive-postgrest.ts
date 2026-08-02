/**
 * Exercises the Adaptive-only PostgREST Journal provider through visible,
 * safety-gated onboarding. The shared Adaptive Journal runner owns restart
 * persistence, device-generated Setup URI transfer, Fast Fetch, and a
 * two-device text and binary return journey.
 */
import { parsePostgRESTConnectionURI } from "@vrtmrz/livesync-commonlib/journal-storage";
import { runAdaptiveJournalObsidianRoundTrip, runNpmScript } from "../runner/adaptiveJournal.ts";
import { assertEqual } from "../runner/liveSyncWorkflow.ts";
import { captureGuideDialogue, modalByTitle, selectRadioOption, type SetupState } from "../runner/setupUri.ts";
import { withObsidianPage } from "../runner/ui.ts";

type PostgRESTConfig = {
    apiKey: string;
    endpoint: string;
    schema: string;
    vaultCredential: string;
    vaultId: string;
};

const supportedArguments = new Set(["--keep-postgrest", "--manage-postgrest"]);
const unsupportedArguments = process.argv.slice(2).filter((argument) => !supportedArguments.has(argument));
if (unsupportedArguments.length > 0) {
    throw new Error(`Unsupported Adaptive PostgREST argument: ${unsupportedArguments.join(", ")}`);
}

const managePostgREST = process.argv.includes("--manage-postgrest");
const keepPostgRESTFixture = process.argv.includes("--keep-postgrest");
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETUP_URI_TIMEOUT_MS ?? 30000);
const remoteTimeoutMs = Number(process.env.E2E_OBSIDIAN_POSTGREST_TIMEOUT_MS ?? 30000);

function environmentValue(primary: string, legacy: string, fallback: string): string {
    return process.env[primary] ?? process.env[legacy] ?? fallback;
}

function loadPostgRESTConfig(): PostgRESTConfig {
    const endpoint = environmentValue("POSTGREST_ENDPOINT", "postgrestEndpoint", "http://127.0.0.1:3001").replace(
        /\/+$/u,
        ""
    );
    const endpointUrl = new URL(endpoint);
    if (
        (endpointUrl.protocol !== "http:" && endpointUrl.protocol !== "https:") ||
        endpointUrl.username !== "" ||
        endpointUrl.password !== "" ||
        endpointUrl.search !== "" ||
        endpointUrl.hash !== ""
    ) {
        throw new Error("Adaptive PostgREST requires a complete HTTP or HTTPS endpoint without embedded credentials.");
    }
    const config = {
        apiKey: environmentValue("POSTGREST_API_KEY", "postgrestApiKey", ""),
        endpoint,
        schema: environmentValue("POSTGREST_SCHEMA", "postgrestSchema", "livesync_api"),
        vaultCredential: environmentValue(
            "POSTGREST_VAULT_CREDENTIAL",
            "postgrestVaultCredential",
            "adaptive-cli-vault-credential-0000000000001"
        ),
        vaultId: environmentValue("POSTGREST_VAULT_ID", "postgrestVaultId", "adaptive-cli-vault-01"),
    };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(config.schema)) {
        throw new Error("Adaptive PostgREST requires a valid exposed schema identifier.");
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/u.test(config.vaultId) || config.vaultCredential.length === 0) {
        throw new Error("Adaptive PostgREST requires a provisioned Vault ID and Vault credential.");
    }
    return config;
}

function postgRESTHeaders(config: PostgRESTConfig): Headers {
    const headers = new Headers({
        Accept: "application/json",
        "Accept-Profile": config.schema,
        "Content-Profile": config.schema,
        "X-LiveSync-Vault-Credential": config.vaultCredential,
        "X-LiveSync-Vault-ID": config.vaultId,
    });
    if (config.apiKey) headers.set("apikey", config.apiKey);
    return headers;
}

async function readEstimatedSize(config: PostgRESTConfig): Promise<number> {
    const response = await fetch(`${config.endpoint}/rpc/livesync_adaptive_status`, {
        headers: postgRESTHeaders(config),
        method: "GET",
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Adaptive PostgREST status failed with HTTP ${response.status}.`);
    }
    const value = (await response.json()) as unknown;
    const body = Array.isArray(value) && value.length === 1 ? value[0] : value;
    const estimatedSize = Number(
        body && typeof body === "object" && !Array.isArray(body)
            ? (body as { estimated_size?: unknown }).estimated_size
            : Number.NaN
    );
    if (!Number.isFinite(estimatedSize) || estimatedSize < 0) {
        throw new Error("Adaptive PostgREST status returned an invalid estimated size.");
    }
    return estimatedSize;
}

async function assertPostgRESTReachable(config: PostgRESTConfig): Promise<void> {
    await readEstimatedSize(config);
}

async function enterManualAdaptivePostgRESTSettings(
    port: number,
    config: PostgRESTConfig,
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
    screenshots.push(
        await captureGuideDialogue(port, "guide-adaptive-postgrest-encryption.png", "End-to-End Encryption")
    );

    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, "End-to-End Encryption")
            .getByRole("button", { name: "Proceed", exact: true })
            .click({ timeout: uiTimeoutMs });

        const remoteSelection = modalByTitle(page, "Choose a synchronisation remote");
        await remoteSelection.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await selectRadioOption(remoteSelection, "PostgREST Journal");
        await remoteSelection
            .getByRole("button", { name: "Continue to PostgREST setup", exact: true })
            .click({ timeout: uiTimeoutMs });

        const postgRESTModal = modalByTitle(page, "PostgREST Journal Configuration");
        await postgRESTModal.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await postgRESTModal.locator('input[name="postgrest-endpoint"]').fill(config.endpoint);
        await postgRESTModal.locator('input[name="postgrest-vault-id"]').fill(config.vaultId);
        await postgRESTModal.locator('input[name="postgrest-vault-credential"]').fill(config.vaultCredential);
        await postgRESTModal.locator('input[name="postgrest-schema"]').fill(config.schema);
        if (config.apiKey) await postgRESTModal.locator('input[name="postgrest-api-key"]').fill(config.apiKey);
        await postgRESTModal.locator('input[name="postgrest-use-internal-api"]').check({ timeout: uiTimeoutMs });

        if (
            (await postgRESTModal.locator('select[name="postgrest-journal-format"]').count()) !== 0 ||
            (await postgRESTModal.locator('select[name="postgrest-pack-read-policy"]').count()) !== 0
        ) {
            throw new Error("Adaptive-only PostgREST onboarding exposed an Opaque or Pack retrieval choice.");
        }
        if (
            (await postgRESTModal
                .getByRole("button", { name: "Continue with verified settings", exact: true })
                .count()) !== 0
        ) {
            throw new Error("Adaptive PostgREST could continue before its server safety check completed.");
        }
        await postgRESTModal
            .getByRole("button", { name: "Check PostgREST server", exact: true })
            .click({ timeout: uiTimeoutMs });
        await postgRESTModal
            .getByText("The required PostgREST RPC operations and binary semantics were verified.", { exact: false })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        await postgRESTModal
            .getByRole("button", { name: "Continue with verified settings", exact: true })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
        if (
            (await postgRESTModal.getByRole("button", { name: "Save without connecting", exact: true }).count()) !== 0
        ) {
            throw new Error("Adaptive PostgREST onboarding exposed the unverified Settings-only save action.");
        }
    });
    screenshots.push(
        await captureGuideDialogue(port, "guide-adaptive-postgrest-safety-check.png", "PostgREST Journal Configuration")
    );
    await withObsidianPage(port, async (page) => {
        const postgRESTModal = modalByTitle(page, "PostgREST Journal Configuration");
        await postgRESTModal
            .getByRole("button", { name: "Continue with verified settings", exact: true })
            .click({ timeout: uiTimeoutMs });
        await modalByTitle(page, "Setup Complete: Preparing to Initialise Server").waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
    });
    return screenshots;
}

function assertAdaptivePostgRESTSettings(state: SetupState, config: PostgRESTConfig, label: string): void {
    assertEqual(state.remoteType, "POSTGREST", `${label} did not retain PostgREST as its active remote.`);
    assertEqual(state.journalFormat, "adaptive-v1", `${label} did not retain the Adaptive Journal format.`);
    assertEqual(state.packReadPolicy, "whole-pack", `${label} did not retain complete Pack retrieval.`);
    assertEqual(state.remoteConfigurationCount, 1, `${label} did not retain exactly one remote profile.`);
    const connection = parsePostgRESTConnectionURI(state.postgrestActiveConnectionURI);
    assertEqual(connection.endpoint, config.endpoint, `${label} retained a different PostgREST endpoint.`);
    assertEqual(connection.schema, config.schema, `${label} retained a different PostgREST schema.`);
    if (connection.vaultId !== config.vaultId || connection.vaultCredential !== config.vaultCredential) {
        throw new Error(`${label} did not retain the provisioned PostgREST Vault ID and Vault credential.`);
    }
    if (connection.apiKey !== config.apiKey) {
        throw new Error(`${label} did not retain the configured PostgREST client API key.`);
    }
    assertEqual(
        connection.useCustomRequestHandler,
        true,
        `${label} did not retain the Obsidian internal request API selection.`
    );
}

async function main(): Promise<void> {
    const config = loadPostgRESTConfig();
    let shouldStopPostgREST = false;
    let observedEstimatedSize = 0;

    try {
        if (managePostgREST) {
            await runNpmScript("test:docker-postgrest:start");
            shouldStopPostgREST = !keepPostgRESTFixture;
        }
        await assertPostgRESTReachable(config);
        await runAdaptiveJournalObsidianRoundTrip({
            label: "Adaptive PostgREST",
            slug: "adaptive-postgrest",
            targetDescription: `Temporary PostgREST target: ${config.endpoint}`,
            enterManualSettings: async (port, vaultPassphrase) =>
                await enterManualAdaptivePostgRESTSettings(port, config, vaultPassphrase),
            assertSettings: (state, label) => assertAdaptivePostgRESTSettings(state, config, label),
            assertPublished: async (minimumWriters, minimumCommits) => {
                const deadline = Date.now() + remoteTimeoutMs;
                let lastSize = 0;
                while (Date.now() < deadline) {
                    lastSize = await readEstimatedSize(config);
                    if (lastSize > observedEstimatedSize && lastSize > 0) {
                        observedEstimatedSize = lastSize;
                        return;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
                throw new Error(
                    `Timed out waiting for Adaptive PostgREST publication stage ${minimumWriters}/${minimumCommits}; last estimated size was ${lastSize}.`
                );
            },
        });
    } finally {
        if (shouldStopPostgREST) {
            await runNpmScript("test:docker-postgrest:stop").catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
