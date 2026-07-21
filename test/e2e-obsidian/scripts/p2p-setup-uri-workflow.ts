import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { assertEqual, waitForLocalDatabaseEntry } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import {
    acknowledgeDisabledOptionalFeatures,
    captureAndStartInitialisation,
    captureGuideDialogue,
    confirmFastFetch,
    confirmRebuild,
    enterSetupURI,
    finishInitialisation,
    generateSetupURIFromDevice,
    modalByTitle,
    resumeCompatibilityReviewIfShown,
    type SetupArtifact,
    type SetupCaptureNames,
} from "../runner/setupUri.ts";
import {
    captureObsidianElement,
    captureObsidianPage,
    obsidianRemoteDebuggingPort,
    withObsidianPage,
} from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "90000";

const execFileAsync = promisify(execFile);
const captures: SetupCaptureNames = { scenario: "p2p-setup-uri", guide: "p2p-setup" };
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_P2P_WORKFLOW_TIMEOUT_MS ?? 60000);
const noteFromFirst = "E2E/p2p/from-first.md";
const noteFromSecond = "E2E/p2p/from-second.md";
const firstContent = "# P2P from the first device\n\nThis note was fetched directly from the first device.\n";
const secondContent = "# P2P from the second device\n\nThis note completed the return journey.\n";

type RunnerContext = {
    binary: string;
    cliBinary: string;
    activeSessions: Set<ObsidianLiveSyncSession>;
};

function sessionEnvironment(port: number): NodeJS.ProcessEnv {
    return { ...process.env, E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT: String(port) };
}

function sessionPorts(): readonly [number, number] {
    const first = obsidianRemoteDebuggingPort(process.env);
    const second = Number(process.env.E2E_OBSIDIAN_SECONDARY_REMOTE_DEBUGGING_PORT ?? first + 1);
    if (!Number.isInteger(second) || second < 1 || second > 65535 || second === first) {
        throw new Error(`Invalid secondary Obsidian remote debugging port: ${second}`);
    }
    return [first, second];
}

async function runDeno(script: string, environment: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execFileAsync(
        "deno",
        [
            "run",
            "--minimum-dependency-age=0",
            "--config=utils/flyio/deno.jsonc",
            "--frozen",
            "--lock=utils/flyio/deno.lock",
            "--allow-env",
            script,
        ],
        { cwd: process.cwd(), env: environment, maxBuffer: 4 * 1024 * 1024 }
    );
    return stdout;
}

async function generateBootstrapSetupURI(relay: string): Promise<SetupArtifact> {
    const setupPassphrase = randomBytes(24).toString("base64url");
    const output = await runDeno("utils/setup/generate_setup_uri.ts", {
        ...process.env,
        remote_type: "p2p",
        p2p_relays: relay,
        p2p_room_id: `real-obsidian-${randomBytes(12).toString("hex")}`,
        p2p_passphrase: randomBytes(24).toString("base64url"),
        p2p_app_id: "self-hosted-livesync-real-obsidian-e2e",
        p2p_auto_start: "false",
        p2p_auto_broadcast: "false",
        passphrase: randomBytes(24).toString("base64url"),
        uri_passphrase: setupPassphrase,
    });
    const setupURI = output.split(/\r?\n/u).find((line) => line.startsWith("obsidian://setuplivesync?settings="));
    if (!setupURI) throw new Error("The public Setup URI generator did not emit a P2P Setup URI.");
    return { setupURI, setupPassphrase };
}

async function waitForRelay(relay: string): Promise<void> {
    const endpoint = new URL(relay);
    const port = Number(endpoint.port || (endpoint.protocol === "wss:" ? 443 : 80));
    const host = endpoint.hostname === "localhost" ? "127.0.0.1" : endpoint.hostname;
    const deadline = Date.now() + Number(process.env.E2E_P2P_RELAY_READY_TIMEOUT_MS ?? 30000);
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            await new Promise<void>((resolve, reject) => {
                const socket = connect({ host, port });
                socket.setTimeout(1000);
                socket.once("connect", () => {
                    socket.destroy();
                    resolve();
                });
                socket.once("timeout", () => {
                    socket.destroy();
                    reject(new Error("connection timed out"));
                });
                socket.once("error", reject);
            });
            await new Promise((resolve) => setTimeout(resolve, 1500));
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }
    throw new Error(
        `P2P relay is not ready at ${relay}: ${lastError instanceof Error ? lastError.message : lastError}`
    );
}

async function startSession(
    context: RunnerContext,
    vault: TemporaryVault,
    port: number
): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        env: sessionEnvironment(port),
    });
    context.activeSessions.add(session);
    return session;
}

async function stopSessions(context: RunnerContext): Promise<void> {
    for (const session of [...context.activeSessions]) {
        await session.app.stop();
        context.activeSessions.delete(session);
    }
}

async function writeNote(
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
    await waitForLocalDatabaseEntry(cliBinary, environment, path);
}

async function waitForPathContent(vault: TemporaryVault, path: string, expected: string): Promise<void> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 60000);
    let lastContent = "";
    while (Date.now() < deadline) {
        try {
            lastContent = await readFile(join(vault.path, path), "utf8");
            if (lastContent === expected) return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${path}. Last content:\n${lastContent}`);
}

async function readReflectionDiagnostics(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    path: string
): Promise<unknown> {
    return await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const settings=core.services.setting.currentSettings();",
            "const entry=await core.localDatabase.getDBEntry(path,undefined,false,true).catch(()=>false);",
            "const chunks=entry&&Array.isArray(entry.children)?await Promise.all(entry.children.map(async(id)=>{",
            "const chunk=await core.localDatabase.getDBEntry(id,undefined,false,true).catch(()=>false);",
            "return {id,found:!!chunk};",
            "})):[];",
            "return JSON.stringify({",
            "suspendFileWatching:settings.suspendFileWatching,",
            "suspendParseReplicationResult:settings.suspendParseReplicationResult,",
            "configured:settings.isConfigured,",
            "entry:entry?{id:entry._id,path:entry.path,children:entry.children||[]}:false,",
            "chunks,",
            "databaseQueueCount:core.services.replication.databaseQueueCount?.value,",
            "storageApplyingCount:core.services.replication.storageApplyingCount?.value,",
            "replicationResultCount:core.services.replication.replicationResultCount?.value,",
            "});",
            "})()",
        ].join(""),
        environment
    );
}

async function executeCommand(port: number, commandId: string): Promise<void> {
    const opened = await withObsidianPage(port, async (page) => {
        return await page.evaluate(
            (id) =>
                (
                    globalThis as typeof globalThis & {
                        app?: { commands?: { executeCommandById(commandId: string): boolean } };
                    }
                ).app?.commands?.executeCommandById(id) === true,
            commandId
        );
    });
    if (!opened) throw new Error(`Obsidian command was not available: ${commandId}`);
}

async function openP2PStatus(port: number, filename: string): Promise<string> {
    await executeCommand(port, "obsidian-livesync:open-p2p-server-status");
    await withObsidianPage(port, async (page) => {
        const heading = page.getByRole("heading", { name: "Signalling Status" }).last();
        await heading.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const pane = heading.locator(
            "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' workspace-leaf-content ')][1]"
        );
        const open = pane.getByRole("button", { name: "Open connection" });
        if (await open.isVisible()) {
            const blockingDialogues = await page.locator(".modal-container:visible").evaluateAll((elements) =>
                elements.map((element) => ({
                    title: element.querySelector(".modal-title")?.textContent?.trim() ?? "",
                    text: element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 240) ?? "",
                }))
            );
            if (blockingDialogues.length > 0) {
                throw new Error(
                    `P2P connection control is blocked by a dialogue: ${JSON.stringify(blockingDialogues)}`
                );
            }
            await open.click({ timeout: uiTimeoutMs });
        }
        await pane.locator(".status-value.connected").waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
    return await captureObsidianElement(port, filename, (page) => {
        const heading = page.getByRole("heading", { name: "Signalling Status" }).last();
        return heading.locator(
            "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' workspace-leaf-content ')][1]"
        );
    });
}

async function reconnectP2PStatus(port: number): Promise<void> {
    await executeCommand(port, "obsidian-livesync:open-p2p-server-status");
    await withObsidianPage(port, async (page) => {
        const heading = page.getByRole("heading", { name: "Signalling Status" }).last();
        await heading.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const pane = heading.locator(
            "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' workspace-leaf-content ')][1]"
        );
        const disconnect = pane.getByRole("button", { name: "Disconnect", exact: true });
        if (await disconnect.isVisible()) {
            await disconnect.click({ timeout: uiTimeoutMs });
        }
        const open = pane.getByRole("button", { name: "Open connection", exact: true });
        await open.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await open.click({ timeout: uiTimeoutMs });
        await pane.locator(".status-value.connected").waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
}

async function acceptConnectionRequests(
    ports: readonly number[],
    stop: () => boolean,
    screenshots: string[]
): Promise<void> {
    const captured = new Set<number>();
    while (!stop()) {
        for (const port of ports) {
            const visible = await withObsidianPage(port, async (page) => {
                return await modalByTitle(page, "P2P Connection Request").isVisible();
            }).catch(() => false);
            if (!visible) continue;
            if (!captured.has(port)) {
                const requestNumber =
                    screenshots.filter((filename) => filename.includes("guide-p2p-setup-connection-request-")).length +
                    1;
                screenshots.push(
                    await captureGuideDialogue(
                        port,
                        `guide-p2p-setup-connection-request-${requestNumber}.png`,
                        "P2P Connection Request"
                    )
                );
                captured.add(port);
            }
            await withObsidianPage(port, async (page) => {
                await modalByTitle(page, "P2P Connection Request")
                    .getByRole("button", { name: "Accept", exact: true })
                    .click({ timeout: uiTimeoutMs });
            });
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

async function fetchFromFirstPeer(
    sessionA: ObsidianLiveSyncSession,
    portA: number,
    portB: number,
    screenshots: string[]
): Promise<void> {
    try {
        await withObsidianPage(portB, async (page) => {
            const modal = modalByTitle(page, "P2P Rebuild");
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.locator(".peer-item").first().waitFor({ state: "visible", timeout: uiTimeoutMs });
        });
    } catch (error) {
        const firstDeviceAlive = sessionA.app.process.exitCode === null && sessionA.app.process.signalCode === null;
        const firstDeviceUi = await withObsidianPage(portA, async (page) => {
            return await page.locator("body").innerText();
        }).catch(() => undefined);
        const secondDeviceDialogue = await withObsidianPage(portB, async (page) => {
            return await modalByTitle(page, "P2P Rebuild").innerText();
        }).catch(() => undefined);
        throw new Error(
            [
                error instanceof Error ? error.message : String(error),
                `First Obsidian process alive: ${firstDeviceAlive}`,
                `First Obsidian CDP reachable: ${firstDeviceUi !== undefined}`,
                firstDeviceUi === undefined ? undefined : `First device UI: ${firstDeviceUi.slice(0, 1_500)}`,
                secondDeviceDialogue === undefined
                    ? undefined
                    : `Second-device P2P Rebuild dialogue: ${secondDeviceDialogue.slice(0, 1_500)}`,
                sessionA.app.output().stderr
                    ? `First Obsidian stderr: ${sessionA.app.output().stderr.slice(-2_000)}`
                    : undefined,
            ]
                .filter(Boolean)
                .join("\n")
        );
    }
    screenshots.push(await captureGuideDialogue(portB, "guide-p2p-setup-select-first-device.png", "P2P Rebuild"));

    let finished = false;
    const acceptor = acceptConnectionRequests([portA, portB], () => finished, screenshots);
    try {
        await withObsidianPage(portB, async (page) => {
            const modal = modalByTitle(page, "P2P Rebuild");
            await modal
                .locator(".peer-item")
                .first()
                .getByRole("button", { name: "Sync", exact: true })
                .click({ timeout: uiTimeoutMs });
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });
    } finally {
        finished = true;
        await acceptor;
    }

    await withObsidianPage(portB, async (page) => {
        const modal = modalByTitle(page, "P2P Rebuild");
        if (await modal.isVisible()) {
            await modal.getByRole("button", { name: "Skip and close" }).click({ timeout: uiTimeoutMs });
        }
    });
}

async function replicateFromStatusPane(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const heading = page.getByRole("heading", { name: "Detected Peers" }).last();
        await heading.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const pane = heading.locator(
            "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' workspace-leaf-content ')][1]"
        );
        await pane.getByRole("button", { name: "Refresh", exact: true }).click({ timeout: uiTimeoutMs });
        const replicate = pane.getByRole("button", { name: "Replicate now" }).first();
        await replicate.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await replicate.click({ timeout: uiTimeoutMs });
    });
}

async function waitForDetectedPeer(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const heading = page.getByRole("heading", { name: "Detected Peers" }).last();
        await heading.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const pane = heading.locator(
            "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' workspace-leaf-content ')][1]"
        );
        await pane.getByRole("button", { name: "Refresh", exact: true }).click({ timeout: uiTimeoutMs });
        await pane.getByRole("button", { name: "Replicate now" }).first().waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
    });
}

async function captureNote(port: number, path: string, text: string, filename: string): Promise<string> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate((notePath) => {
            const obsidian = globalThis as typeof globalThis & {
                app?: {
                    workspace?: { openLinkText(path: string, sourcePath: string, newLeaf: boolean): Promise<void> };
                };
            };
            return obsidian.app?.workspace?.openLinkText(notePath, "", false);
        }, path);
    });
    await captureObsidianPage(port, `${filename}.full.png`, async (page) => {
        await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: uiTimeoutMs });
    });
    return await captureObsidianElement(port, filename, (page) => page.locator(".workspace-leaf.mod-active").first());
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);

    const relay = process.env.E2E_P2P_RELAY_URL ?? `ws://127.0.0.1:${process.env.E2E_P2P_RELAY_PORT ?? "4010"}/`;
    await waitForRelay(relay);
    const bootstrapArtifact = await generateBootstrapSetupURI(relay);
    const vaultA = await createTemporaryVault();
    const vaultB = await createTemporaryVault();
    const [portA, portB] = sessionPorts();
    const context: RunnerContext = { binary, cliBinary: cli.binary, activeSessions: new Set() };
    const screenshots: string[] = [];

    try {
        console.log(`Temporary P2P relay: ${relay}`);
        console.log(`Temporary P2P devices: ${vaultA.name}, ${vaultB.name}`);

        const sessionA = await startSession(context, vaultA, portA);
        screenshots.push(await enterSetupURI(portA, "new", bootstrapArtifact, captures));
        screenshots.push(await captureAndStartInitialisation(portA, "new", captures));
        screenshots.push(await confirmRebuild(portA, captures));
        screenshots.push(await acknowledgeDisabledOptionalFeatures(portA, captures));
        const firstState = await finishInitialisation(portA, context.cliBinary, sessionA.cliEnv);
        await resumeCompatibilityReviewIfShown(portA);
        assertEqual(firstState.p2pEnabled, true, "The first device did not enable P2P.");
        assertEqual(firstState.p2pRelays, relay, "The first device did not activate the P2P relay.");
        await writeNote(context.cliBinary, sessionA.cliEnv, noteFromFirst, firstContent);

        const generated = await generateSetupURIFromDevice(portA, randomBytes(24).toString("base64url"), captures);
        if (generated.artifact.setupURI === bootstrapArtifact.setupURI) {
            throw new Error("The first device returned the bootstrap Setup URI instead of generating a new one.");
        }
        screenshots.push(...generated.screenshots);
        screenshots.push(await openP2PStatus(portA, "guide-p2p-setup-first-device-connected.png"));

        const sessionB = await startSession(context, vaultB, portB);
        screenshots.push(await enterSetupURI(portB, "existing", generated.artifact, captures));
        screenshots.push(await captureAndStartInitialisation(portB, "existing", captures));
        screenshots.push(...(await confirmFastFetch(portB, captures)));
        await fetchFromFirstPeer(sessionA, portA, portB, screenshots);
        await waitForLocalDatabaseEntry(context.cliBinary, sessionB.cliEnv, noteFromFirst, {
            timeoutMs: uiTimeoutMs,
        });
        const secondState = await finishInitialisation(portB, context.cliBinary, sessionB.cliEnv);
        await resumeCompatibilityReviewIfShown(portB);
        assertEqual(secondState.p2pEnabled, true, "The second device did not enable P2P.");
        assertEqual(secondState.p2pRelays, relay, "The second device did not import the P2P relay.");
        assertEqual(secondState.p2pRoomId, firstState.p2pRoomId, "The two devices did not join the same P2P room.");
        try {
            await waitForPathContent(vaultB, noteFromFirst, firstContent);
        } catch (error) {
            const diagnostics = await readReflectionDiagnostics(context.cliBinary, sessionB.cliEnv, noteFromFirst);
            throw new Error(
                `${error instanceof Error ? error.message : String(error)}\nReflection diagnostics: ${JSON.stringify(diagnostics)}`
            );
        }
        screenshots.push(
            await captureNote(portB, noteFromFirst, "P2P from the first device", "guide-p2p-setup-first-to-second.png")
        );

        await writeNote(context.cliBinary, sessionB.cliEnv, noteFromSecond, secondContent);
        await reconnectP2PStatus(portA);
        await reconnectP2PStatus(portB);
        await waitForDetectedPeer(portA);
        screenshots.push(await openP2PStatus(portA, "guide-p2p-setup-devices-connected.png"));
        let returnJourneyFinished = false;
        const returnJourneyAcceptor = acceptConnectionRequests(
            [portA, portB],
            () => returnJourneyFinished,
            screenshots
        );
        try {
            await replicateFromStatusPane(portA);
            await waitForPathContent(vaultA, noteFromSecond, secondContent);
        } finally {
            returnJourneyFinished = true;
            await returnJourneyAcceptor;
        }
        screenshots.push(
            await captureNote(
                portA,
                noteFromSecond,
                "P2P from the second device",
                "guide-p2p-setup-second-to-first.png"
            )
        );

        console.log(`P2P Setup URI and two-device roundtrip succeeded. Screenshots: ${screenshots.join(", ")}`);
    } finally {
        await stopSessions(context).catch((error: unknown) => {
            console.warn(error instanceof Error ? error.message : error);
        });
        await vaultA.dispose();
        await vaultB.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
