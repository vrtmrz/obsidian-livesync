import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evalObsidianJson } from "./cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "./environment.ts";
import {
    assertEqual,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "./liveSyncWorkflow.ts";
import { REMOTE_ACTIVITY_EXPECTED_STATE, waitForRemoteActivityState } from "./remoteActivity.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "./session.ts";
import {
    acknowledgeDisabledOptionalFeatures,
    captureAndStartInitialisation,
    confirmFastFetch,
    confirmRebuild,
    enterSetupURI,
    finishInitialisation,
    generateSetupURIFromDevice,
    modalByTitle,
    readSetupState,
    resumeCompatibilityReviewIfShown,
    skipMissingRemoteConfiguration,
    type SetupArtifact,
    type SetupCaptureNames,
    type SetupState,
} from "./setupUri.ts";
import { captureObsidianPage, withObsidianPage } from "./ui.ts";
import { createTemporaryVault, type TemporaryVault } from "./vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "90000";
process.env.E2E_OBSIDIAN_SETUP_INITIALISATION_TIMEOUT_MS ??= "180000";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETUP_URI_TIMEOUT_MS ?? 30000);
const binaryLength = 256 * 1024;
const firstBinarySeed = 0x1a2b3c4d;
const secondBinarySeed = 0x5e6f7788;

type RunnerContext = {
    binary: string;
    cliBinary: string;
    activeSessions: Set<ObsidianLiveSyncSession>;
};

export type AdaptiveJournalObsidianScenario = {
    /** Human-readable provider name, for example, 'Adaptive WebDAV'. */
    label: string;
    /** Stable lowercase name used for paths, screenshots, and setup captures. */
    slug: string;
    targetDescription: string;
    enterManualSettings(port: number, vaultPassphrase: string): Promise<string[]>;
    assertSettings(state: SetupState, label: string): void;
};

function assertRepositoryIdentity(state: SetupState, label: string, expectedRepositoryId?: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(state.expectedRepositoryId)) {
        throw new Error(`${label} did not retain a canonical repository ID.`);
    }
    if (expectedRepositoryId !== undefined) {
        assertEqual(state.expectedRepositoryId, expectedRepositoryId, `${label} retained a different repository ID.`);
    }
    return state.expectedRepositoryId;
}

function npmBinary(): string {
    return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function runNpmScript(script: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(npmBinary(), ["run", script], {
            cwd: process.cwd(),
            env: process.env,
            stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`${script} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`));
        });
    });
}

async function dismissRedundantExternalOpenPrompt(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const prompt = modalByTitle(page, "Run action from external link?");
        if (!(await prompt.isVisible({ timeout: 2000 }).catch(() => false))) return;
        await prompt.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: uiTimeoutMs });
        await prompt.waitFor({ state: "hidden", timeout: uiTimeoutMs });
    });
}

async function startSession(context: RunnerContext, vault: TemporaryVault): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
    });
    context.activeSessions.add(session);
    // Obsidian 1.12 can ask whether to repeat the CLI's 'open' action when the
    // isolated profile has already restored this exact Vault. The session has
    // already verified the active Vault, so dismiss only that redundant host
    // prompt before exercising LiveSync UI.
    await dismissRedundantExternalOpenPrompt(session.remoteDebuggingPort);
    return session;
}

async function stopSession(context: RunnerContext, session: ObsidianLiveSyncSession): Promise<void> {
    if (!context.activeSessions.has(session)) return;
    await session.app.stop();
    context.activeSessions.delete(session);
}

async function stopSessions(context: RunnerContext): Promise<void> {
    for (const session of [...context.activeSessions]) await stopSession(context, session);
}

async function captureFailure(
    session: ObsidianLiveSyncSession,
    scenario: AdaptiveJournalObsidianScenario,
    label: string
): Promise<void> {
    const screenshot = await captureObsidianPage(
        session.remoteDebuggingPort,
        `${scenario.slug}-${label}-failure.png`,
        async () => undefined
    ).catch(() => undefined);
    if (screenshot) console.error(`${scenario.label} failure screenshot: ${screenshot}`);
}

function deterministicBytes(length: number, seed: number): Uint8Array {
    const bytes = new Uint8Array(length);
    let state = seed;
    for (let index = 0; index < bytes.byteLength; index += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        bytes[index] = state & 0xff;
    }
    return bytes;
}

async function writePayloadViaObsidian(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    textPath: string,
    binaryPath: string,
    text: string,
    binarySeed: number
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const textPath=${JSON.stringify(textPath)};`,
            `const binaryPath=${JSON.stringify(binaryPath)};`,
            `const text=${JSON.stringify(text)};`,
            `const binaryLength=${JSON.stringify(binaryLength)};`,
            `let state=${JSON.stringify(binarySeed)};`,
            "let folder='';",
            "for(const part of textPath.split('/').slice(0,-1)){",
            "folder=folder?`${folder}/${part}`:part;",
            "if(!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);",
            "}",
            "const existingText=app.vault.getAbstractFileByPath(textPath);",
            "if(existingText) await app.vault.modify(existingText,text);",
            "else await app.vault.create(textPath,text);",
            "const bytes=new Uint8Array(binaryLength);",
            "for(let i=0;i<bytes.byteLength;i++){",
            "state^=state<<13;state^=state>>>17;state^=state<<5;bytes[i]=state&0xff;",
            "}",
            "const existingBinary=app.vault.getAbstractFileByPath(binaryPath);",
            "if(existingBinary) await app.vault.modifyBinary(existingBinary,bytes.buffer);",
            "else await app.vault.createBinary(binaryPath,bytes.buffer);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment
    );
    await waitForLocalDatabaseEntry(cliBinary, environment, textPath);
    await waitForLocalDatabaseEntry(cliBinary, environment, binaryPath);
}

async function waitForText(vault: TemporaryVault, textPath: string, expected: string): Promise<void> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 30000);
    let lastContent = "";
    while (Date.now() < deadline) {
        try {
            lastContent = await readFile(join(vault.path, textPath), "utf8");
            if (lastContent === expected) return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${textPath}. Last content:\n${lastContent}`);
}

async function waitForBinary(vault: TemporaryVault, binaryPath: string, expected: Uint8Array): Promise<void> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 30000);
    let lastLength = -1;
    while (Date.now() < deadline) {
        try {
            const actual = await readFile(join(vault.path, binaryPath));
            lastLength = actual.byteLength;
            if (actual.byteLength === expected.byteLength && actual.equals(Buffer.from(expected))) return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${binaryPath}; last length was ${lastLength}.`);
}

async function pushAndObserve(
    scenario: AdaptiveJournalObsidianScenario,
    session: ObsidianLiveSyncSession,
    cliBinary: string
): Promise<number> {
    const before = await waitForRemoteActivityState(session.remoteDebuggingPort, REMOTE_ACTIVITY_EXPECTED_STATE.idle);
    await pushLocalChanges(cliBinary, session.cliEnv);
    const after = await waitForRemoteActivityState(session.remoteDebuggingPort, REMOTE_ACTIVITY_EXPECTED_STATE.idle);
    if (after.requestCount <= before.requestCount) {
        throw new Error(`${scenario.label} synchronisation did not advance the tracked remote-request count.`);
    }
    assertEqual(
        after.responseCount,
        after.requestCount,
        `${scenario.label} remote-request counters did not rebalance after synchronisation.`
    );
    return after.requestCount - before.requestCount;
}

export async function runAdaptiveJournalObsidianRoundTrip(scenario: AdaptiveJournalObsidianScenario): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);

    const vaultPassphrase = randomBytes(24).toString("base64url");
    const vaultA = await createTemporaryVault();
    const vaultB = await createTemporaryVault();
    const context: RunnerContext = { binary, cliBinary: cli.binary, activeSessions: new Set() };
    const captures: SetupCaptureNames = { scenario: scenario.slug, guide: scenario.slug };
    const secondDeviceCaptures: SetupCaptureNames = {
        scenario: `${scenario.slug}-second-device`,
        guide: `${scenario.slug}-second-device`,
    };
    const textPath = `E2E/${scenario.slug}/round-trip.md`;
    const binaryPath = `E2E/${scenario.slug}/round-trip.bin`;
    const firstText = `# ${scenario.label}\n\nCreated by the first real Obsidian device.\n`;
    const secondText = `# ${scenario.label}\n\nUpdated by the second real Obsidian device.\n`;
    const screenshots: string[] = [];
    let generatedSetup: SetupArtifact | undefined;
    let observedRequests = 0;
    let repositoryId = "";

    try {
        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary Vault A: ${vaultA.path}`);
        console.log(`Temporary Vault B: ${vaultB.path}`);
        console.log(scenario.targetDescription);

        let session = await startSession(context, vaultA);
        try {
            screenshots.push(...(await scenario.enterManualSettings(session.remoteDebuggingPort, vaultPassphrase)));
            screenshots.push(await captureAndStartInitialisation(session.remoteDebuggingPort, "new", captures));
            screenshots.push(await confirmRebuild(session.remoteDebuggingPort, captures));
            screenshots.push(await skipMissingRemoteConfiguration(session.remoteDebuggingPort, captures));
            screenshots.push(await acknowledgeDisabledOptionalFeatures(session.remoteDebuggingPort, captures));
            const state = await finishInitialisation(session.remoteDebuggingPort, context.cliBinary, session.cliEnv);
            await resumeCompatibilityReviewIfShown(session.remoteDebuggingPort);
            scenario.assertSettings(state, "The first device");
            repositoryId = assertRepositoryIdentity(state, "The first device");

            await writePayloadViaObsidian(
                context.cliBinary,
                session.cliEnv,
                textPath,
                binaryPath,
                firstText,
                firstBinarySeed
            );
            observedRequests += await pushAndObserve(scenario, session, context.cliBinary);
        } catch (error) {
            await captureFailure(session, scenario, "first-device");
            throw error;
        } finally {
            await stopSession(context, session);
        }

        session = await startSession(context, vaultA);
        try {
            await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
            await resumeCompatibilityReviewIfShown(session.remoteDebuggingPort);
            const state = await readSetupState(context.cliBinary, session.cliEnv);
            scenario.assertSettings(state, "The restarted first device");
            assertRepositoryIdentity(state, "The restarted first device", repositoryId);
            const generated = await generateSetupURIFromDevice(
                session.remoteDebuggingPort,
                randomBytes(24).toString("base64url"),
                captures
            );
            generatedSetup = generated.artifact;
            screenshots.push(...generated.screenshots);
        } catch (error) {
            await captureFailure(session, scenario, "first-device-restart");
            throw error;
        } finally {
            await stopSession(context, session);
        }

        session = await startSession(context, vaultB);
        try {
            if (!generatedSetup) throw new Error("The first device did not generate a Setup URI.");
            screenshots.push(
                await enterSetupURI(session.remoteDebuggingPort, "existing", generatedSetup, secondDeviceCaptures)
            );
            screenshots.push(
                await captureAndStartInitialisation(session.remoteDebuggingPort, "existing", secondDeviceCaptures)
            );
            screenshots.push(...(await confirmFastFetch(session.remoteDebuggingPort, secondDeviceCaptures)));
            // Journal remotes do not expose the legacy remote-configuration
            // document. The device-generated Setup URI is the authoritative
            // connection input, so acknowledge its expected absence explicitly.
            screenshots.push(await skipMissingRemoteConfiguration(session.remoteDebuggingPort, secondDeviceCaptures));
            const state = await finishInitialisation(session.remoteDebuggingPort, context.cliBinary, session.cliEnv);
            await resumeCompatibilityReviewIfShown(session.remoteDebuggingPort);
            scenario.assertSettings(state, "The second device");
            assertRepositoryIdentity(state, "The second device", repositoryId);
            observedRequests += await pushAndObserve(scenario, session, context.cliBinary);
            await waitForText(vaultB, textPath, firstText);
            await waitForBinary(vaultB, binaryPath, deterministicBytes(binaryLength, firstBinarySeed));

            await writePayloadViaObsidian(
                context.cliBinary,
                session.cliEnv,
                textPath,
                binaryPath,
                secondText,
                secondBinarySeed
            );
            observedRequests += await pushAndObserve(scenario, session, context.cliBinary);
        } catch (error) {
            await captureFailure(session, scenario, "second-device");
            throw error;
        } finally {
            await stopSession(context, session);
        }

        session = await startSession(context, vaultA);
        try {
            await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
            await resumeCompatibilityReviewIfShown(session.remoteDebuggingPort);
            const state = await readSetupState(context.cliBinary, session.cliEnv);
            scenario.assertSettings(state, "The final first-device session");
            assertRepositoryIdentity(state, "The final first-device session", repositoryId);
            observedRequests += await pushAndObserve(scenario, session, context.cliBinary);
            await waitForText(vaultA, textPath, secondText);
            await waitForBinary(vaultA, binaryPath, deterministicBytes(binaryLength, secondBinarySeed));
        } catch (error) {
            await captureFailure(session, scenario, "return-journey");
            throw error;
        } finally {
            await stopSession(context, session);
        }

        console.log(
            `${scenario.label} passed visible safety-gated onboarding, restart persistence, a device-generated Setup URI, and a two-device text and binary return journey. Tracked requests across measured synchronisations: ${observedRequests}. Screenshots: ${screenshots.join(", ")}`
        );
    } finally {
        await stopSessions(context).catch((error: unknown) => {
            console.warn(error instanceof Error ? error.message : error);
        });
        await vaultA.dispose();
        await vaultB.dispose();
    }
}
