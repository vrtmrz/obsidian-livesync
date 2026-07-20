import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { VER } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { Locator, Page } from "playwright";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
    type CouchDbConfig,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    pushLocalChanges,
    waitForLocalDatabaseEntry,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianDialogue, captureObsidianPage, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "90000";
process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ??= "30000";

const execFileAsync = promisify(execFile);
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETUP_URI_TIMEOUT_MS ?? 30000);
const initialisationTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETUP_INITIALISATION_TIMEOUT_MS ?? 120000);
const hiddenFileCliTimeoutMs = Number(process.env.E2E_OBSIDIAN_HIDDEN_FILE_CLI_TIMEOUT_MS ?? 90000);
const notePath = "E2E/setup-uri/provisioned-workflow.md";
const noteContent = "# Provisioned Setup URI\n\nThis note travelled through the generated CouchDB Setup URI.\n";
const snippetPath = ".obsidian/snippets/setup-uri-workflow.css";
const snippetContent = [
    "body {",
    "    --setup-uri-workflow-colour: #245a70;",
    "}",
    "",
    ".setup-uri-workflow {",
    "    color: var(--setup-uri-workflow-colour);",
    "}",
    "",
].join("\n");

type SetupArtifact = {
    setupURI: string;
    setupPassphrase: string;
};

type SetupState = {
    configured: boolean;
    databaseReady: boolean;
    appReady: boolean;
    suspended: boolean;
    remoteType: string;
    activeConfigurationId: string;
    remoteConfigurationCount: number;
    syncInternalFiles: boolean;
    syncInternalFilesBeforeReplication: boolean;
};

type RunnerContext = {
    binary: string;
    cliBinary: string;
    couchDb: CouchDbConfig;
    dbName: string;
    activeSessions: Set<ObsidianLiveSyncSession>;
};

function modalByTitle(page: Page, title: string): Locator {
    return page.locator(".modal-container").filter({
        has: page.locator(".modal-title").filter({ hasText: title }),
    });
}

async function selectRadioOption(modal: Locator, title: string): Promise<void> {
    const radio = modal.locator("label").filter({ hasText: title }).locator('input[type="radio"]').first();
    await radio.check({ timeout: uiTimeoutMs });
}

async function selectCheckbox(modal: Locator, title: string): Promise<void> {
    const checkbox = modal.locator("label").filter({ hasText: title }).locator('input[type="checkbox"]').first();
    await checkbox.check({ timeout: uiTimeoutMs });
}

async function writeVaultFile(vaultPath: string, path: string, content: string): Promise<void> {
    const fullPath = join(vaultPath, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
}

async function readVaultFile(vaultPath: string, path: string): Promise<string> {
    return await readFile(join(vaultPath, path), "utf8");
}

async function waitForPathContent(
    vaultPath: string,
    path: string,
    expected: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 30000)
): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastContent = "";
    while (Date.now() < deadline) {
        try {
            lastContent = await readVaultFile(vaultPath, path);
            if (lastContent === expected) return lastContent;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${path}. Last content:\n${lastContent}`);
}

async function runDeno(script: string, permissions: string[], environment: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execFileAsync(
        "deno",
        [
            "run",
            "--minimum-dependency-age=0",
            "--config=utils/flyio/deno.jsonc",
            "--frozen",
            "--lock=utils/flyio/deno.lock",
            ...permissions,
            script,
        ],
        {
            cwd: process.cwd(),
            env: environment,
            maxBuffer: 4 * 1024 * 1024,
        }
    );
    return stdout;
}

async function provisionAndGenerateSetupURI(couchDb: CouchDbConfig, dbName: string): Promise<SetupArtifact> {
    const setupPassphrase = randomBytes(24).toString("base64url");
    const environment = {
        ...process.env,
        hostname: couchDb.uri,
        username: couchDb.username,
        password: couchDb.password,
        database: dbName,
        passphrase: randomBytes(24).toString("base64url"),
        uri_passphrase: setupPassphrase,
        remote_type: "couchdb",
        retry_count: "3",
        retry_delay_ms: "250",
    };

    await runDeno("utils/couchdb/provision.ts", ["--allow-env", "--allow-net"], environment);
    const output = await runDeno("utils/setup/generate_setup_uri.ts", ["--allow-env"], environment);
    const setupURI = output.split(/\r?\n/u).find((line) => line.startsWith("obsidian://setuplivesync?settings="));
    if (!setupURI) throw new Error("The public Setup URI generator did not emit a Setup URI.");
    return { setupURI, setupPassphrase };
}

async function startUnconfiguredSession(
    context: RunnerContext,
    vault: TemporaryVault
): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
    });
    context.activeSessions.add(session);
    return session;
}

async function stopTrackedSession(context: RunnerContext, session: ObsidianLiveSyncSession): Promise<void> {
    if (!context.activeSessions.has(session)) return;
    await session.app.stop();
    context.activeSessions.delete(session);
}

async function stopTrackedSessions(context: RunnerContext): Promise<void> {
    for (const session of [...context.activeSessions]) {
        await stopTrackedSession(context, session);
    }
}

async function enterSetupURI(port: number, mode: "new" | "existing", artifact: SetupArtifact): Promise<void> {
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
        await setup.getByRole("button", { name: "Test Settings and Continue" }).click({ timeout: uiTimeoutMs });
    });
}

async function captureAndStartInitialisation(port: number, mode: "new" | "existing"): Promise<string> {
    const title =
        mode === "new"
            ? "Setup Complete: Preparing to Initialise Server"
            : "Setup Complete: Preparing to Fetch Synchronisation Data";
    const button = mode === "new" ? "Restart and Initialise Server" : "Restart and Fetch Data";
    const screenshot = await captureObsidianDialogue(
        port,
        `setup-uri-${mode === "new" ? "first-initialise" : "second-fetch"}.png`,
        async (page) => {
            await modalByTitle(page, title).waitFor({ state: "visible", timeout: uiTimeoutMs });
        }
    );
    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, title).getByRole("button", { name: button }).click({ timeout: uiTimeoutMs });
    });
    return screenshot;
}

async function confirmRebuild(port: number): Promise<string> {
    const title = "Final Confirmation: Overwrite Server Data with This Device's Files";
    const screenshot = await captureObsidianDialogue(port, "setup-uri-first-rebuild-confirmation.png", async (page) => {
        await modalByTitle(page, title).waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
    await withObsidianPage(port, async (page) => {
        const modal = modalByTitle(page, title);
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

async function skipMissingRemoteConfiguration(port: number): Promise<string> {
    const title = "Fetch Remote Configuration Failed";
    const screenshot = await captureObsidianDialogue(
        port,
        "setup-uri-first-missing-remote-configuration.png",
        async (page) => {
            const modal = modalByTitle(page, title);
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal
                .getByText("If you are new to the Self-hosted LiveSync, this might be expected.", {
                    exact: false,
                })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
        }
    );
    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, title)
            .getByRole("button", { name: "Skip and proceed" })
            .click({ timeout: uiTimeoutMs });
    });
    return screenshot;
}

async function acknowledgeDisabledOptionalFeatures(port: number): Promise<string> {
    const title = "All optional features are disabled";
    const screenshot = await captureObsidianDialogue(
        port,
        "setup-uri-first-optional-features-disabled.png",
        async (page) => {
            const modal = modalByTitle(page, title);
            await modal.waitFor({ state: "visible", timeout: initialisationTimeoutMs });
            await modal
                .getByText("Please enable them from the settings screen after setup is complete.", {
                    exact: false,
                })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
        }
    );
    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, title).getByRole("button", { name: "OK" }).click({ timeout: uiTimeoutMs });
    });
    return screenshot;
}

async function confirmFastFetch(port: number): Promise<string[]> {
    const firstTitle = "Data retrieval scheduled";
    const firstScreenshot = await captureObsidianDialogue(
        port,
        "setup-uri-second-retrieval-method.png",
        async (page) => {
            await modalByTitle(page, firstTitle).waitFor({ state: "visible", timeout: uiTimeoutMs });
        }
    );
    await withObsidianPage(port, async (page) => {
        await modalByTitle(page, firstTitle)
            .getByRole("button", { name: "Overwrite all with remote files" })
            .click({ timeout: uiTimeoutMs });
    });

    const secondTitle = "How to handle extra existing local files?";
    const secondScreenshot = await captureObsidianDialogue(
        port,
        "setup-uri-second-local-file-policy.png",
        async (page) => {
            await modalByTitle(page, secondTitle).waitFor({ state: "visible", timeout: uiTimeoutMs });
        }
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

async function finishInitialisation(
    port: number,
    filename: string,
    cliBinary: string,
    environment: NodeJS.ProcessEnv
): Promise<{ state: SetupState; screenshot?: string }> {
    const message = "Do you want to resume file and database processing, and restart obsidian now?";
    const deadline = Date.now() + initialisationTimeoutMs;
    let lastState: SetupState | undefined;
    let lastError: unknown;
    while (Date.now() < deadline) {
        const resumeVisible = await withObsidianPage(port, async (page) => {
            return await modalByTitle(page, "Confirmation").filter({ hasText: message }).isVisible();
        }).catch(() => false);
        if (resumeVisible) {
            const screenshot = await captureObsidianDialogue(port, filename, async (page) => {
                await modalByTitle(page, "Confirmation")
                    .filter({ hasText: message })
                    .waitFor({ state: "visible", timeout: uiTimeoutMs });
            });
            await withObsidianPage(port, async (page) => {
                const modal = modalByTitle(page, "Confirmation").filter({ hasText: message });
                await modal.getByText(message, { exact: true }).click({ timeout: uiTimeoutMs });
                await modal.getByRole("button", { name: "Yes", exact: true }).click({ timeout: uiTimeoutMs });
            });
            return {
                state: await waitForConfiguredSetup(cliBinary, environment, initialisationTimeoutMs),
                screenshot,
            };
        }
        try {
            lastState = await readSetupState(cliBinary, environment);
            if (isConfiguredSetupReady(lastState)) return { state: lastState };
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
        `Timed out waiting for Setup URI initialisation to finish: ${JSON.stringify(lastState)}${
            lastError instanceof Error ? `; last error: ${lastError.message}` : ""
        }`
    );
}

async function readSetupState(cliBinary: string, environment: NodeJS.ProcessEnv): Promise<SetupState> {
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
            "remoteType:settings.remoteType,",
            "activeConfigurationId:settings.activeConfigurationId||'',",
            "remoteConfigurationCount:Object.keys(settings.remoteConfigurations||{}).length,",
            "syncInternalFiles:settings.syncInternalFiles===true,",
            "syncInternalFilesBeforeReplication:settings.syncInternalFilesBeforeReplication===true,",
            "});",
            "})()",
        ].join(""),
        environment
    );
}

async function waitForConfiguredSetup(
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
            if (isConfiguredSetupReady(lastState)) {
                return lastState;
            }
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

async function enableHiddenFileSync(cliBinary: string, environment: NodeJS.ProcessEnv): Promise<SetupState> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.setting.applyPartial({",
            "syncInternalFiles:true,",
            "syncInternalFilesBeforeReplication:true,",
            "},true);",
            "await core.services.control.applySettings();",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment
    );
    const state = await readSetupState(cliBinary, environment);
    if (!state.syncInternalFiles || !state.syncInternalFilesBeforeReplication) {
        throw new Error(`Hidden File Sync was not enabled after setup: ${JSON.stringify(state)}`);
    }
    return state;
}

async function writeNoteViaObsidian(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    path: string,
    content: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(content)};`,
            "const folder=path.split('/').slice(0,-1).join('/');",
            "if(folder&&!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);",
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.modify(existing,content);",
            "else await app.vault.create(path,content);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment
    );
}

async function scanHiddenStorage(cliBinary: string, environment: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('HiddenFileSync');",
            "await addOn.scanAllStorageChanges(true);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment,
        hiddenFileCliTimeoutMs
    );
}

async function scanHiddenDatabase(cliBinary: string, environment: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('HiddenFileSync');",
            "await addOn.scanAllDatabaseChanges(true);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment,
        hiddenFileCliTimeoutMs
    );
}

async function waitForRemoteEntry(context: RunnerContext, entry: LocalDatabaseEntry): Promise<void> {
    await waitForCouchDbDocs(context.couchDb, context.dbName, (docs) => {
        const ids = new Set(docs.map((doc) => doc._id));
        return ids.has(entry.id) && entry.children.every((childId) => ids.has(childId));
    });
}

async function uploadWorkflowFiles(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    vault: TemporaryVault
): Promise<void> {
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, notePath, noteContent);
    await writeVaultFile(vault.path, snippetPath, snippetContent);
    await scanHiddenStorage(context.cliBinary, session.cliEnv);
    const noteEntry = await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, notePath);
    const snippetEntry = await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, snippetPath, {
        hidden: true,
    });
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await waitForRemoteEntry(context, noteEntry);
    await waitForRemoteEntry(context, snippetEntry);
}

async function captureSynchronisedNote(port: number): Promise<string> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate((path) => {
            const obsidian = globalThis as typeof globalThis & {
                app?: {
                    workspace?: { openLinkText(path: string, sourcePath: string, newLeaf: boolean): Promise<void> };
                };
            };
            return obsidian.app?.workspace?.openLinkText(path, "", false);
        }, notePath);
    });
    return await captureObsidianPage(port, "setup-uri-synchronised-note.png", async (page) => {
        await page.getByText("Provisioned Setup URI", { exact: false }).first().waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
    });
}

async function captureFailure(session: ObsidianLiveSyncSession): Promise<void> {
    await captureObsidianPage(
        session.remoteDebuggingPort,
        "setup-uri-workflow.failure.png",
        async () => undefined
    ).catch(() => undefined);
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);

    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "setup-uri-workflow");
    const vaultA = await createTemporaryVault();
    const vaultB = await createTemporaryVault();
    const context: RunnerContext = {
        binary,
        cliBinary: cli.binary,
        couchDb,
        dbName,
        activeSessions: new Set(),
    };
    const screenshots: string[] = [];

    try {
        await assertCouchDbReachable(couchDb);
        const artifact = await provisionAndGenerateSetupURI(couchDb, dbName);
        const provisionedDocs = await waitForCouchDbDocs(couchDb, dbName, (docs) =>
            docs.some((doc) => doc._id === "obsydian_livesync_version" && doc.version === VER)
        );
        if (!provisionedDocs.some((doc) => doc._id === "obsydian_livesync_version" && doc.version === VER)) {
            throw new Error("The public provisioning tool did not initialise the Commonlib database version.");
        }

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault A: ${vaultA.path}`);
        console.log(`Temporary vault B: ${vaultB.path}`);
        console.log(`Temporary provisioned CouchDB database: ${dbName}`);

        let session = await startUnconfiguredSession(context, vaultA);
        try {
            await enterSetupURI(session.remoteDebuggingPort, "new", artifact);
            screenshots.push(await captureAndStartInitialisation(session.remoteDebuggingPort, "new"));
            screenshots.push(await confirmRebuild(session.remoteDebuggingPort));
            screenshots.push(await skipMissingRemoteConfiguration(session.remoteDebuggingPort));
            screenshots.push(await acknowledgeDisabledOptionalFeatures(session.remoteDebuggingPort));
            const firstCompletion = await finishInitialisation(
                session.remoteDebuggingPort,
                "setup-uri-first-initialisation-complete.png",
                context.cliBinary,
                session.cliEnv
            );
            if (firstCompletion.screenshot) screenshots.push(firstCompletion.screenshot);
            const firstState = firstCompletion.state;
            assertEqual(firstState.remoteType, "", "The first device did not activate the CouchDB remote profile.");
            assertEqual(
                firstState.syncInternalFiles,
                false,
                "Rebuild did not retain the documented optional-feature safety boundary."
            );
            await enableHiddenFileSync(context.cliBinary, session.cliEnv);
            await uploadWorkflowFiles(context, session, vaultA);
        } catch (error) {
            await captureFailure(session);
            throw error;
        } finally {
            await stopTrackedSession(context, session);
        }

        session = await startUnconfiguredSession(context, vaultB);
        try {
            await enterSetupURI(session.remoteDebuggingPort, "existing", artifact);
            screenshots.push(await captureAndStartInitialisation(session.remoteDebuggingPort, "existing"));
            screenshots.push(...(await confirmFastFetch(session.remoteDebuggingPort)));
            const secondCompletion = await finishInitialisation(
                session.remoteDebuggingPort,
                "setup-uri-second-initialisation-complete.png",
                context.cliBinary,
                session.cliEnv
            );
            if (secondCompletion.screenshot) screenshots.push(secondCompletion.screenshot);
            const secondState = secondCompletion.state;
            assertEqual(secondState.remoteType, "", "The second device did not activate the CouchDB remote profile.");
            await enableHiddenFileSync(context.cliBinary, session.cliEnv);
            await pushLocalChanges(context.cliBinary, session.cliEnv);
            await scanHiddenDatabase(context.cliBinary, session.cliEnv);
            const receivedNote = await waitForPathContent(vaultB.path, notePath, noteContent);
            const receivedSnippet = await waitForPathContent(vaultB.path, snippetPath, snippetContent);
            assertEqual(receivedNote, noteContent, "The ordinary note did not reach the second Setup URI device.");
            assertEqual(
                receivedSnippet,
                snippetContent,
                "The hidden snippet did not reach the second Setup URI device."
            );
            screenshots.push(await captureSynchronisedNote(session.remoteDebuggingPort));
        } catch (error) {
            await captureFailure(session);
            throw error;
        } finally {
            await stopTrackedSession(context, session);
        }

        console.log(
            `The public provisioning and Setup URI workflow configured two fresh devices, synchronised a note, and synchronised a hidden snippet. Screenshots: ${screenshots.join(", ")}`
        );
    } finally {
        await stopTrackedSessions(context).catch((error: unknown) => {
            console.warn(error instanceof Error ? error.message : error);
        });
        await vaultA.dispose();
        await vaultB.dispose();
        if (process.env.E2E_OBSIDIAN_KEEP_COUCHDB !== "true") {
            await deleteCouchDbDatabase(couchDb, dbName).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
