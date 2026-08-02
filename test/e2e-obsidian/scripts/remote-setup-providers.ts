import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    defaultRemoteProviderRegistry,
    type BuiltInRemoteConfiguration,
    type RemoteConfiguration,
} from "@vrtmrz/livesync-commonlib/remote-configurations";
import { parsePostgRESTConnectionURI, parseWebDAVConnectionURI } from "@vrtmrz/livesync-commonlib/journal-storage";
import { enableAndReloadPlugin } from "@vrtmrz/obsidian-test-session";
import type { Locator, Page } from "playwright";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import {
    beginRemoteProfileSetup,
    captureAndCancelRemoteProvider,
    captureRemoteProviderChoices,
    closeRemoteConfigurationSettings,
    installRemoteSetupTestSeam,
    openRemoteConfigurationSettings,
    openSavedRemoteProfile,
    remoteProviderModal,
    remoteSetupCalls,
    runtimeRemoteSettings,
    selectRemoteProvider,
    setRemoteInspectionMode,
    waitForSavedRemoteProfile,
} from "../runner/remoteSetupUi.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import {
    captureObsidianDialogue,
    captureObsidianElement,
    obsidianRemoteDebuggingPort,
    withObsidianPage,
} from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_REMOTE_SETUP_TIMEOUT_MS ?? 10000);
const repositoryA = "A".repeat(43);
const repositoryB = `${"A".repeat(42)}Q`;

const profiles = {
    postgrest: {
        apiKey: "publishable-ui-key",
        credential: "remote-setup-ui-credential",
        endpoint: "https://postgrest.example.test/rest/v1",
        expectedRepositoryId: repositoryB,
        name: "PostgREST UI profile",
        schema: "livesync_api",
        vaultId: "remote-setup-vault-01",
    },
    s3: {
        accessKey: "remote-setup-access-key",
        bucket: "remote-setup-bucket",
        endpoint: "https://s3.example.test",
        name: "S3 UI profile",
        prefix: "adaptive-ui/",
        region: "us-east-1",
        secretKey: "remote-setup-secret-key",
    },
    webdav: {
        endpoint: "https://dav.example.test/remote.php/dav/files/tester",
        expectedRepositoryId: repositoryA,
        name: "WebDAV UI profile",
        password: "remote-setup-password",
        prefix: "adaptive-ui/",
        username: "remote-setup-user",
    },
} as const;

const providerChoices = [
    "CouchDB",
    "S3-compatible Object Storage",
    "WebDAV Journal",
    "PostgREST Journal",
    "Peer-to-Peer (P2P)",
] as const;

type PersistedSettings = {
    activeConfigurationId: string;
    remoteConfigurations: Record<string, RemoteConfiguration>;
};

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
}

function profileByName(settings: PersistedSettings, name: string): RemoteConfiguration {
    const profile = Object.values(settings.remoteConfigurations).find((candidate) => candidate.name === name);
    if (!profile) throw new Error(`Saved remote profile '${name}' was not found`);
    return profile;
}

function parseProfile(settings: PersistedSettings, name: string): BuiltInRemoteConfiguration {
    return defaultRemoteProviderRegistry.parse(profileByName(settings, name).uri);
}

function assertPersistedProfiles(settings: PersistedSettings): void {
    const s3 = parseProfile(settings, profiles.s3.name);
    assertEqual(s3.type, "s3", "The S3 dialogue returned the wrong provider type.");
    if (s3.type !== "s3") return;
    assertEqual(s3.settings.endpoint, profiles.s3.endpoint, "The S3 endpoint was not saved.");
    assertEqual(s3.settings.bucket, profiles.s3.bucket, "The S3 bucket was not saved.");
    assertEqual(s3.settings.bucketPrefix, profiles.s3.prefix, "The S3 prefix was not saved.");
    assertEqual(s3.settings.journalFormat, "adaptive-v1", "The S3 Adaptive format was not saved.");
    assertEqual(s3.settings.packReadPolicy, "range", "The S3 Range policy was not saved.");

    const webdav = parseProfile(settings, profiles.webdav.name);
    assertEqual(webdav.type, "webdav", "The WebDAV dialogue returned the wrong provider type.");
    if (webdav.type !== "webdav") return;
    const webdavConnection = parseWebDAVConnectionURI(webdav.settings.webDAVactiveConnectionURI);
    assertEqual(webdavConnection.endpoint, profiles.webdav.endpoint, "The WebDAV endpoint was not saved.");
    assertEqual(webdavConnection.prefix, profiles.webdav.prefix, "The WebDAV prefix was not saved.");
    assertEqual(webdavConnection.username, profiles.webdav.username, "The WebDAV username was not saved.");
    assertEqual(webdav.settings.expectedRepositoryId, repositoryA, "The WebDAV repository ID was not saved.");
    assertEqual(webdav.settings.journalFormat, "adaptive-v1", "The WebDAV Adaptive format was not saved.");
    assertEqual(webdav.settings.packReadPolicy, "range", "The WebDAV Range policy was not saved.");

    const postgrest = parseProfile(settings, profiles.postgrest.name);
    assertEqual(postgrest.type, "postgrest", "The PostgREST dialogue returned the wrong provider type.");
    if (postgrest.type !== "postgrest") return;
    const postgrestConnection = parsePostgRESTConnectionURI(postgrest.settings.postgrestActiveConnectionURI);
    assertEqual(postgrestConnection.endpoint, profiles.postgrest.endpoint, "The PostgREST endpoint was not saved.");
    assertEqual(postgrestConnection.schema, profiles.postgrest.schema, "The PostgREST schema was not saved.");
    assertEqual(postgrestConnection.vaultId, profiles.postgrest.vaultId, "The PostgREST Vault ID was not saved.");
    assertEqual(postgrest.settings.expectedRepositoryId, repositoryB, "The PostgREST repository ID was not saved.");
    assertEqual(postgrest.settings.journalFormat, "adaptive-v1", "PostgREST did not retain its fixed format.");
    assertEqual(postgrest.settings.packReadPolicy, "whole-pack", "PostgREST did not retain its fixed read policy.");
}

function assertEncryptedProfilesAtRest(settings: PersistedSettings): void {
    for (const fixture of [profiles.s3, profiles.webdav, profiles.postgrest]) {
        const profile = profileByName(settings, fixture.name);
        assertEqual(profile.isEncrypted, true, `Saved remote profile '${fixture.name}' was not encrypted at rest.`);
        for (const exposed of [
            profiles.s3.endpoint,
            profiles.s3.secretKey,
            profiles.webdav.endpoint,
            profiles.webdav.password,
            profiles.postgrest.endpoint,
            profiles.postgrest.credential,
        ]) {
            if (profile.uri.includes(exposed)) {
                throw new Error(`Saved remote profile '${fixture.name}' exposed a connection secret or endpoint.`);
            }
        }
    }
}

async function fill(locator: Locator, value: string): Promise<void> {
    await locator.fill(value, { timeout: uiTimeoutMs });
}

async function openAdvanced(modal: Locator): Promise<void> {
    const details = modal.locator("details").filter({ hasText: "Advanced Settings" }).first();
    await details.waitFor({ state: "visible", timeout: uiTimeoutMs });
    if (!(await details.getAttribute("open"))) {
        await details.locator("summary").click({ timeout: uiTimeoutMs });
    }
}

async function expectInputValue(modal: Locator, name: string, expected: string): Promise<void> {
    const actual = await modal.locator(`[name="${name}"]`).inputValue({ timeout: uiTimeoutMs });
    assertEqual(actual, expected, `Reloaded control '${name}' has the wrong value.`);
}

async function mountLegacyProvider(
    port: number,
    profileName: string,
    choice: string,
    proceed: string,
    title: string,
    screenshotName: string
): Promise<string> {
    await beginRemoteProfileSetup(port, profileName, uiTimeoutMs);
    await selectRemoteProvider(port, choice, proceed, title, uiTimeoutMs);
    return await captureAndCancelRemoteProvider(port, screenshotName, title, uiTimeoutMs);
}

async function addS3Profile(port: number): Promise<string> {
    await beginRemoteProfileSetup(port, profiles.s3.name, uiTimeoutMs);
    await selectRemoteProvider(
        port,
        "S3-compatible Object Storage",
        "Continue to Object Storage setup",
        "S3/MinIO/R2 Configuration",
        uiTimeoutMs
    );
    const screenshot = await captureObsidianDialogue(port, "remote-setup-s3-adaptive.png", async (page) => {
        const modal = remoteProviderModal(page, "S3/MinIO/R2 Configuration");
        const testButton = modal.getByRole("button", { name: "Test Settings and Continue", exact: true });
        if (!(await testButton.isDisabled()))
            throw new Error("Incomplete S3 settings did not disable connection testing.");
        await fill(modal.locator('[name="s3-endpoint"]'), profiles.s3.endpoint);
        await fill(modal.locator('[name="s3-access-key-id"]'), profiles.s3.accessKey);
        await fill(modal.locator('[name="s3-secret-access-key"]'), profiles.s3.secretKey);
        await fill(modal.locator('[name="s3-bucket-name"]'), profiles.s3.bucket);
        await fill(modal.locator('[name="s3-region"]'), profiles.s3.region);
        await fill(modal.locator('[name="s3-folder-prefix"]'), profiles.s3.prefix);
        await openAdvanced(modal);
        await modal.locator('[name="s3-journal-format"]').selectOption("adaptive-v1");
        await modal.locator('[name="s3-pack-read-policy"]').selectOption("range");
        if (await testButton.isDisabled()) throw new Error("Complete S3 settings did not enable connection testing.");
    });
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, "S3/MinIO/R2 Configuration");
        await modal.getByRole("button", { name: "Test Settings and Continue", exact: true }).click({
            timeout: uiTimeoutMs,
        });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    await waitForSavedRemoteProfile(port, profiles.s3.name, uiTimeoutMs);
    return screenshot;
}

async function addWebDAVProfile(port: number): Promise<string> {
    await beginRemoteProfileSetup(port, profiles.webdav.name, uiTimeoutMs);
    await selectRemoteProvider(
        port,
        "WebDAV Journal",
        "Continue to WebDAV setup",
        "WebDAV Journal Configuration",
        uiTimeoutMs
    );
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, "WebDAV Journal Configuration");
        await fill(modal.locator('[name="webdav-endpoint"]'), profiles.webdav.endpoint);
        await fill(modal.locator('[name="webdav-username"]'), profiles.webdav.username);
        await fill(modal.locator('[name="webdav-password"]'), profiles.webdav.password);
        await fill(modal.locator('[name="webdav-prefix"]'), profiles.webdav.prefix);
        await modal.locator('[name="webdav-use-internal-api"]').check({ timeout: uiTimeoutMs });
        await openAdvanced(modal);
        await modal.locator('[name="webdav-journal-format"]').selectOption("adaptive-v1");
        await fill(modal.locator('[name="webdav-expected-repository-id"]'), repositoryA);
        await modal.locator('[name="webdav-pack-read-policy"]').selectOption("range");
    });

    await setRemoteInspectionMode(port, "failed");
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, "WebDAV Journal Configuration");
        await modal.getByRole("button", { name: "Run endpoint safety check", exact: true }).click({
            timeout: uiTimeoutMs,
        });
        await modal.getByText("missing required Adaptive operations", { exact: false }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        if ((await modal.getByRole("button", { name: "Save verified settings", exact: true }).count()) !== 0) {
            throw new Error("A failed WebDAV safety check exposed the verified-save action.");
        }
    });

    await setRemoteInspectionMode(port, "verified");
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, "WebDAV Journal Configuration");
        await modal.getByRole("button", { name: "Run endpoint safety check", exact: true }).click({
            timeout: uiTimeoutMs,
        });
        await modal.getByRole("button", { name: "Save verified settings", exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        await fill(modal.locator('[name="webdav-prefix"]'), "stale-inspection/");
        if ((await modal.getByRole("button", { name: "Save verified settings", exact: true }).count()) !== 0) {
            throw new Error("Editing WebDAV settings did not invalidate the previous safety check.");
        }
        await fill(modal.locator('[name="webdav-prefix"]'), profiles.webdav.prefix);
        await modal.getByRole("button", { name: "Run endpoint safety check", exact: true }).click({
            timeout: uiTimeoutMs,
        });
        await modal.getByRole("button", { name: "Save verified settings", exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
    });
    const screenshot = await captureObsidianDialogue(port, "remote-setup-webdav-verified.png", async (page) => {
        await remoteProviderModal(page, "WebDAV Journal Configuration")
            .getByText("Required Adaptive operations are supported", { exact: false })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, "WebDAV Journal Configuration");
        await modal.getByRole("button", { name: "Save verified settings", exact: true }).click({
            timeout: uiTimeoutMs,
        });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    await waitForSavedRemoteProfile(port, profiles.webdav.name, uiTimeoutMs);
    return screenshot;
}

async function addPostgRESTProfile(port: number): Promise<string> {
    await beginRemoteProfileSetup(port, profiles.postgrest.name, uiTimeoutMs);
    await selectRemoteProvider(
        port,
        "PostgREST Journal",
        "Continue to PostgREST setup",
        "PostgREST Journal Configuration",
        uiTimeoutMs
    );
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, "PostgREST Journal Configuration");
        const check = modal.getByRole("button", { name: "Check PostgREST server", exact: true });
        if (!(await check.isDisabled())) {
            throw new Error("Incomplete PostgREST settings did not disable the server check.");
        }
        await fill(modal.locator('[name="postgrest-endpoint"]'), profiles.postgrest.endpoint);
        await fill(modal.locator('[name="postgrest-vault-id"]'), profiles.postgrest.vaultId);
        await fill(modal.locator('[name="postgrest-vault-credential"]'), profiles.postgrest.credential);
        await fill(modal.locator('[name="postgrest-schema"]'), profiles.postgrest.schema);
        await fill(modal.locator('[name="postgrest-api-key"]'), profiles.postgrest.apiKey);
        await modal.locator('[name="postgrest-use-internal-api"]').check({ timeout: uiTimeoutMs });
        await openAdvanced(modal);
        await fill(modal.locator('[name="postgrest-expected-repository-id"]'), repositoryB);
        if (await check.isDisabled()) throw new Error("Complete PostgREST settings did not enable the server check.");
        await check.click({ timeout: uiTimeoutMs });
        try {
            await modal.getByRole("button", { name: "Save verified settings", exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(
                `PostgREST verification did not enable saving. Dialogue text:\n${await modal.innerText()}\nCause: ${reason}`
            );
        }
        await fill(modal.locator('[name="postgrest-api-key"]'), "stale-publishable-key");
        if ((await modal.getByRole("button", { name: "Save verified settings", exact: true }).count()) !== 0) {
            throw new Error("Editing PostgREST settings did not invalidate the previous server check.");
        }
        await fill(modal.locator('[name="postgrest-api-key"]'), profiles.postgrest.apiKey);
        await modal.getByRole("button", { name: "Check PostgREST server", exact: true }).click({
            timeout: uiTimeoutMs,
        });
        await modal.getByRole("button", { name: "Save verified settings", exact: true }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
    });
    const screenshot = await captureObsidianDialogue(port, "remote-setup-postgrest-verified.png", async (page) => {
        await remoteProviderModal(page, "PostgREST Journal Configuration")
            .getByText("required PostgREST RPC operations", { exact: false })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, "PostgREST Journal Configuration");
        await modal.getByRole("button", { name: "Save verified settings", exact: true }).click({
            timeout: uiTimeoutMs,
        });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
    await waitForSavedRemoteProfile(port, profiles.postgrest.name, uiTimeoutMs);
    return screenshot;
}

async function assertReloadedS3(port: number): Promise<void> {
    await openSavedRemoteProfile(port, profiles.s3.name, uiTimeoutMs);
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, "S3/MinIO/R2 Configuration");
        await expectInputValue(modal, "s3-endpoint", profiles.s3.endpoint);
        await expectInputValue(modal, "s3-bucket-name", profiles.s3.bucket);
        await openAdvanced(modal);
        await expectInputValue(modal, "s3-journal-format", "adaptive-v1");
        await expectInputValue(modal, "s3-pack-read-policy", "range");
        await modal.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
}

async function assertReloadedWebDAV(port: number): Promise<void> {
    await openSavedRemoteProfile(port, profiles.webdav.name, uiTimeoutMs);
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, "WebDAV Journal Configuration");
        await expectInputValue(modal, "webdav-endpoint", profiles.webdav.endpoint);
        await expectInputValue(modal, "webdav-prefix", profiles.webdav.prefix);
        await openAdvanced(modal);
        await expectInputValue(modal, "webdav-journal-format", "adaptive-v1");
        await expectInputValue(modal, "webdav-expected-repository-id", repositoryA);
        await expectInputValue(modal, "webdav-pack-read-policy", "range");
        await modal.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
}

async function assertReloadedPostgREST(port: number): Promise<void> {
    await openSavedRemoteProfile(port, profiles.postgrest.name, uiTimeoutMs);
    await withObsidianPage(port, async (page) => {
        const modal = remoteProviderModal(page, "PostgREST Journal Configuration");
        await expectInputValue(modal, "postgrest-endpoint", profiles.postgrest.endpoint);
        await expectInputValue(modal, "postgrest-vault-id", profiles.postgrest.vaultId);
        await expectInputValue(modal, "postgrest-schema", profiles.postgrest.schema);
        await openAdvanced(modal);
        await expectInputValue(modal, "postgrest-expected-repository-id", repositoryB);
        await modal.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: uiTimeoutMs });
        await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
}

async function readPersistedSettings(pluginDir: string): Promise<PersistedSettings> {
    return JSON.parse(await readFile(join(pluginDir, "data.json"), "utf8")) as PersistedSettings;
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    const vault = await createTemporaryVault("obsidian-livesync-remote-setup-e2e-");
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
            pluginData: createE2eCouchDbPluginData(
                {
                    dbName: "remote-setup-ui-only",
                    password: "",
                    uri: "http://127.0.0.1:5984",
                    username: "",
                },
                {
                    notifyThresholdOfRemoteStorageSize: 0,
                    periodicReplication: false,
                    syncAfterMerge: false,
                    syncOnEditorSave: false,
                    syncOnFileOpen: false,
                    syncOnSave: false,
                    syncOnStart: false,
                    useAdvancedMode: true,
                }
            ),
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            vault,
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        const port = obsidianRemoteDebuggingPort();
        await installRemoteSetupTestSeam(port);
        await openRemoteConfigurationSettings(port, uiTimeoutMs);

        await beginRemoteProfileSetup(port, "Cancelled CouchDB profile", uiTimeoutMs);
        const selectionScreenshot = await captureRemoteProviderChoices(
            port,
            "remote-setup-provider-selection.png",
            providerChoices,
            uiTimeoutMs
        );
        await selectRemoteProvider(port, "CouchDB", "Continue to CouchDB setup", "CouchDB Configuration", uiTimeoutMs);
        const couchdbScreenshot = await captureAndCancelRemoteProvider(
            port,
            "remote-setup-couchdb.png",
            "CouchDB Configuration",
            uiTimeoutMs
        );
        const p2pScreenshot = await mountLegacyProvider(
            port,
            "Cancelled P2P profile",
            "Peer-to-Peer (P2P)",
            "Continue to P2P setup",
            "P2P Configuration",
            "remote-setup-p2p.png"
        );

        const s3Screenshot = await addS3Profile(port);
        const webdavScreenshot = await addWebDAVProfile(port);
        const postgrestScreenshot = await addPostgRESTProfile(port);
        const firstRuntimeSettings = (await runtimeRemoteSettings(port)) as PersistedSettings;
        assertPersistedProfiles(firstRuntimeSettings);
        const calls = await remoteSetupCalls(port);
        assertEqual(
            calls.filter((call) => call.operation === "test").length,
            1,
            "The S3 profile did not use the injected connection-test boundary exactly once."
        );
        if (calls.filter((call) => call.operation === "inspect").length < 5) {
            throw new Error("The WebDAV and PostgREST profiles did not exercise failure, stale, and verified checks.");
        }

        const pluginDir = session.install.pluginDir;
        assertEncryptedProfilesAtRest(await readPersistedSettings(pluginDir));
        await closeRemoteConfigurationSettings(port, uiTimeoutMs);
        await enableAndReloadPlugin(port, "obsidian-livesync");
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await openRemoteConfigurationSettings(port, uiTimeoutMs);
        await assertReloadedS3(port);
        await assertReloadedWebDAV(port);
        await assertReloadedPostgREST(port);
        const reloadedSettings = (await runtimeRemoteSettings(port)) as PersistedSettings;
        assertPersistedProfiles(reloadedSettings);
        assertEqual(
            Object.keys(reloadedSettings.remoteConfigurations).length,
            Object.keys(firstRuntimeSettings.remoteConfigurations).length,
            "Plug-in reload changed the saved remote profile count."
        );
        const listScreenshot = await captureObsidianElement(port, "remote-setup-reloaded-profiles.png", (page: Page) =>
            page.locator(".sls-setting .sls-remote-list")
        );

        console.log(
            `All registered providers mounted through the real Settings flow; S3, WebDAV, and PostgREST passed validation, injected checks, persistence, and plug-in reload. Screenshots: ${[
                selectionScreenshot,
                couchdbScreenshot,
                p2pScreenshot,
                s3Screenshot,
                webdavScreenshot,
                postgrestScreenshot,
                listScreenshot,
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
