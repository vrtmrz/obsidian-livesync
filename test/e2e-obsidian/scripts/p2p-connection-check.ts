import { spawn } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { dirname, extname, relative, resolve } from "node:path";
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";

import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import {
    acknowledgeDisabledOptionalFeatures,
    captureAndStartInitialisation,
    confirmRebuild,
    enterSetupURI,
    finishInitialisation,
    resumeCompatibilityReviewIfShown,
    type SetupArtifact,
    type SetupCaptureNames,
} from "../runner/setupUri.ts";
import { obsidianRemoteDebuggingPort } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "90000";

const captures: SetupCaptureNames = { scenario: "p2p-connection-check", guide: "p2p-setup" };
const connectionTimeoutMs = Number(process.env.E2E_P2P_CHECK_CONNECTION_TIMEOUT_MS ?? 60000);
const webPeerDist = resolve(process.cwd(), "src/apps/webpeer/dist");

type StaticServer = {
    readonly baseUrl: string;
    close(): Promise<void>;
};

function contentType(path: string): string {
    switch (extname(path)) {
        case ".css":
            return "text/css; charset=utf-8";
        case ".html":
            return "text/html; charset=utf-8";
        case ".js":
            return "text/javascript; charset=utf-8";
        case ".json":
        case ".map":
            return "application/json; charset=utf-8";
        case ".svg":
            return "image/svg+xml";
        default:
            return "application/octet-stream";
    }
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolveClose, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolveClose();
        });
    });
}

async function startStaticServer(): Promise<StaticServer> {
    const distribution = await stat(webPeerDist).catch(() => undefined);
    if (!distribution?.isDirectory()) {
        throw new Error(
            `WebPeer production bundle was not found at ${webPeerDist}. Build the webpeer workspace first.`
        );
    }

    const server = createServer((request, response) => {
        void (async () => {
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
            const candidate = resolve(webPeerDist, requestedPath);
            const relativePath = relative(webPeerDist, candidate);
            if (relativePath.startsWith("..") || relativePath.includes("\0")) {
                response.writeHead(404).end("Not found");
                return;
            }

            try {
                const candidateStat = await stat(candidate);
                const filePath = candidateStat.isDirectory() ? resolve(candidate, "index.html") : candidate;
                const body = await readFile(filePath);
                response.writeHead(200, {
                    "cache-control": "no-store",
                    "content-type": contentType(filePath),
                });
                response.end(body);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                    response.writeHead(404).end("Not found");
                    return;
                }
                throw error;
            }
        })().catch((error: unknown) => {
            response.writeHead(500).end("Internal server error");
            console.error(error instanceof Error ? error.stack : error);
        });
    });

    await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolveListen();
        });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        await closeServer(server);
        throw new Error("The WebPeer static server did not expose a TCP port.");
    }

    return {
        baseUrl: `http://127.0.0.1:${address.port}/`,
        close: async () => await closeServer(server),
    };
}

async function waitForRelay(relay: string): Promise<void> {
    const endpoint = new URL(relay);
    if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
        throw new Error(`P2P relay must use ws: or wss:, received ${endpoint.protocol}`);
    }
    const port = Number(endpoint.port || (endpoint.protocol === "wss:" ? 443 : 80));
    const host = endpoint.hostname === "localhost" ? "127.0.0.1" : endpoint.hostname;
    const deadline = Date.now() + Number(process.env.E2E_P2P_RELAY_READY_TIMEOUT_MS ?? 30000);
    let lastError: unknown;
    let consecutiveConnections = 0;

    while (Date.now() < deadline) {
        try {
            await new Promise<void>((resolveConnection, reject) => {
                const socket = connect({ host, port });
                socket.setTimeout(1000);
                socket.once("connect", () => {
                    socket.destroy();
                    resolveConnection();
                });
                socket.once("timeout", () => {
                    socket.destroy();
                    reject(new Error("connection timed out"));
                });
                socket.once("error", reject);
            });
            consecutiveConnections += 1;
            if (consecutiveConnections >= 3) return;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        } catch (error) {
            lastError = error;
            consecutiveConnections = 0;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
        }
    }

    throw new Error(
        `P2P relay is not ready at ${relay}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
}

async function readDiagnostics(page: Page): Promise<Record<string, string>> {
    return {
        new: (await page.getByTestId("diag-new").textContent())?.trim() ?? "",
        successful: (await page.getByTestId("diag-successful").textContent())?.trim() ?? "",
        failed: (await page.getByTestId("diag-failed").textContent())?.trim() ?? "",
        closed: (await page.getByTestId("diag-closed").textContent())?.trim() ?? "",
    };
}

async function waitForSuccessfulConnection(page: Page, consoleErrors: string[]): Promise<Record<string, string>> {
    try {
        await page.waitForFunction(
            () => Number(document.querySelector('[data-testid="diag-successful"]')?.textContent ?? "0") > 0,
            undefined,
            { timeout: connectionTimeoutMs }
        );
    } catch (error) {
        throw new Error(
            `${error instanceof Error ? error.message : String(error)}\n` +
                `Browser diagnostics: ${JSON.stringify(await readDiagnostics(page))}\n` +
                `Browser console errors: ${JSON.stringify(consoleErrors)}`
        );
    }
    await page.getByRole("heading", { name: "P2P connection observed", exact: true }).waitFor({
        timeout: 5000,
    });
    return await readDiagnostics(page);
}

function sessionPorts(): readonly [number, number] {
    const first = obsidianRemoteDebuggingPort();
    const second = Number(process.env.E2E_OBSIDIAN_SECONDARY_REMOTE_DEBUGGING_PORT ?? first + 1);
    if (!Number.isInteger(second) || second < 1 || second > 65535 || second === first) {
        throw new Error(`Invalid secondary Obsidian remote debugging port: ${second}`);
    }
    return [first, second];
}

function sessionEnvironment(port: number): NodeJS.ProcessEnv {
    return { ...process.env, E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT: String(port) };
}

function npmBinary(): string {
    return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runNpmScript(script: string, optional = false): Promise<void> {
    return new Promise((resolveRun, reject) => {
        const child = spawn(npmBinary(), ["run", script], {
            cwd: process.cwd(),
            env: process.env,
            stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code, signal) => {
            if (code === 0 || optional) {
                resolveRun();
                return;
            }
            reject(new Error(`${script} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
        });
    });
}

async function runScenario(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const relay = process.env.E2E_P2P_RELAY_URL ?? `ws://127.0.0.1:${process.env.E2E_P2P_RELAY_PORT ?? "4010"}/`;
    await waitForRelay(relay);

    const server = await startStaticServer();
    let browser: Browser | undefined;
    const vaults: TemporaryVault[] = [];
    const sessions: ObsidianLiveSyncSession[] = [];
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];

    try {
        const browserExecutable = process.env.E2E_PLAYWRIGHT_CHROMIUM?.trim();
        browser = await chromium.launch({
            headless: true,
            ...(browserExecutable ? { executablePath: browserExecutable } : {}),
        });
        const firstVault = await createTemporaryVault("obsidian-livesync-p2p-check-first-e2e-");
        vaults.push(firstVault);
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
        page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
        page.on("console", (message: ConsoleMessage) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });

        const checkUrl = new URL("check.html", server.baseUrl);
        checkUrl.searchParams.set("relay", relay);
        await page.goto(checkUrl.href);
        await page.getByRole("heading", { name: "P2P connection check", exact: true }).waitFor({ timeout: 30000 });
        await page.getByRole("button", { name: "Prepare desktop check", exact: true }).click();
        await page.getByAltText("Setup URI QR code for the desktop check", { exact: true }).waitFor({
            timeout: 30000,
        });

        const artifact: SetupArtifact = {
            setupURI: await page.getByLabel("Setup URI", { exact: true }).inputValue(),
            setupPassphrase: await page.getByLabel("Setup URI passphrase", { exact: true }).inputValue(),
        };
        if (!artifact.setupURI.startsWith("obsidian://setuplivesync?settings=")) {
            throw new Error("The browser did not generate a Setup URI.");
        }
        await page.getByText(relay, { exact: true }).waitFor({ timeout: 5000 });
        await page.getByRole("button", { name: "Start connection monitor", exact: true }).click();
        await page.getByRole("button", { name: "Monitoring is active", exact: true }).waitFor({ timeout: 30000 });

        const [firstPort, secondPort] = sessionPorts();
        const firstSession = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault: firstVault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            env: sessionEnvironment(firstPort),
        });
        sessions.push(firstSession);

        await enterSetupURI(firstPort, "new", artifact, captures);
        await captureAndStartInitialisation(firstPort, "new", captures);
        await confirmRebuild(firstPort, captures);
        await acknowledgeDisabledOptionalFeatures(firstPort, captures);
        const firstSetupState = await finishInitialisation(firstPort, cli.binary, firstSession.cliEnv);
        await resumeCompatibilityReviewIfShown(firstPort);
        if (!firstSetupState.p2pEnabled || firstSetupState.p2pRelays !== relay) {
            throw new Error(
                `The first Obsidian device did not apply the browser P2P setup: ${JSON.stringify(firstSetupState)}`
            );
        }

        const firstDiagnostics = await waitForSuccessfulConnection(page, consoleErrors);
        const tryAnotherDevice = page.getByRole("button", {
            name: "Try another device without resetting",
            exact: true,
        });
        await tryAnotherDevice.click({ timeout: connectionTimeoutMs });
        await page
            .getByRole("heading", { name: "Use this same one-off configuration on another device", exact: true })
            .waitFor({ timeout: 5000 });
        await page.getByAltText("Setup URI QR code for another device", { exact: true }).waitFor({ timeout: 5000 });
        if ((await page.getByLabel("Setup URI", { exact: true }).inputValue()) !== artifact.setupURI) {
            throw new Error("The additional-device action regenerated or replaced the Setup URI.");
        }

        const secondVault = await createTemporaryVault("obsidian-livesync-p2p-check-second-e2e-");
        vaults.push(secondVault);
        const secondSession = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault: secondVault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            env: sessionEnvironment(secondPort),
        });
        sessions.push(secondSession);

        await enterSetupURI(secondPort, "new", artifact, captures);
        await captureAndStartInitialisation(secondPort, "new", captures);
        await confirmRebuild(secondPort, captures);
        await acknowledgeDisabledOptionalFeatures(secondPort, captures);
        const secondSetupState = await finishInitialisation(secondPort, cli.binary, secondSession.cliEnv);
        await resumeCompatibilityReviewIfShown(secondPort);
        if (
            !secondSetupState.p2pEnabled ||
            secondSetupState.p2pRelays !== relay ||
            secondSetupState.p2pRoomId !== firstSetupState.p2pRoomId
        ) {
            throw new Error(
                `The second Obsidian device did not reuse the browser P2P setup: ${JSON.stringify(secondSetupState)}`
            );
        }

        await page.getByRole("heading", { name: "An additional connection was observed", exact: true }).waitFor({
            timeout: connectionTimeoutMs,
        });
        const diagnostics = await readDiagnostics(page);
        if (pageErrors.length > 0) {
            throw new Error(`The browser page reported runtime errors: ${JSON.stringify(pageErrors)}`);
        }

        const screenshotPath = resolve(
            process.env.E2E_P2P_CHECK_SCREENSHOT ??
                resolve(
                    process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e",
                    "p2p-connection-check-browser-success.png"
                )
        );
        await mkdir(dirname(screenshotPath), { recursive: true });
        await page.locator(".results-card").screenshot({
            animations: "disabled",
            caret: "hide",
            path: screenshotPath,
        });

        console.log(
            `Browser-to-two-Obsidian P2P connection check succeeded through ${relay}. ` +
                `First diagnostics: ${JSON.stringify(firstDiagnostics)}; final diagnostics: ${JSON.stringify(diagnostics)}`
        );
        console.log(`Browser result screenshot: ${screenshotPath}`);
        if (consoleErrors.length > 0) {
            console.warn(`Browser console errors after successful connection: ${JSON.stringify(consoleErrors)}`);
        }
    } finally {
        for (const session of sessions.reverse()) {
            await session.app.stop().catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
        for (const vault of vaults.reverse()) {
            await vault.dispose().catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
        await browser?.close().catch((error: unknown) => {
            console.warn(error instanceof Error ? error.message : error);
        });
        await server.close().catch((error: unknown) => {
            console.warn(error instanceof Error ? error.message : error);
        });
    }
}

async function main(): Promise<void> {
    const manageP2P = process.argv.includes("--manage-p2p");
    let shouldStopP2P = false;
    try {
        if (manageP2P) {
            await runNpmScript("test:docker-p2p:stop", true);
            await runNpmScript("test:docker-p2p:start");
            shouldStopP2P = true;
        }
        await runScenario();
    } finally {
        if (shouldStopP2P) {
            await runNpmScript("test:docker-p2p:stop", true);
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
