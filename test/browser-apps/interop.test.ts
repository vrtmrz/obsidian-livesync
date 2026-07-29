import { assertEquals, assertStringIncludes } from "@std/assert";
import { extname, relative, resolve } from "@std/path";
import { chromium, type Locator, type Page } from "playwright";

import {
  type BackgroundCliProcess,
  initSettingsFile,
  runCli,
  sanitiseCatStdout,
  startCliInBackground,
  TemporaryDirectory,
  waitForPort,
} from "./helpers/cli-fixture.ts";

const repositoryRoot = resolve(import.meta.dirname!, "../..");
const webAppDist = resolve(repositoryRoot, "src/apps/webapp/dist");
const webPeerDist = resolve(repositoryRoot, "src/apps/webpeer/dist");

function contentType(path: string): string {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function resolveStaticPath(pathname: string): string | undefined {
  const decodedPath = decodeURIComponent(pathname);
  const routes: Array<[string, string]> = [
    ["/webapp/", webAppDist],
    ["/webpeer/", webPeerDist],
  ];
  for (const [prefix, root] of routes) {
    if (!decodedPath.startsWith(prefix)) {
      continue;
    }
    const requested = decodedPath.slice(prefix.length) || "index.html";
    const candidate = resolve(root, requested);
    const relativePath = relative(root, candidate);
    if (relativePath.startsWith("..") || relativePath.includes("\0")) {
      return undefined;
    }
    return candidate;
  }
  return undefined;
}

async function serveBrowserApplications(request: Request): Promise<Response> {
  const filePath = resolveStaticPath(new URL(request.url).pathname);
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const stat = await Deno.stat(filePath);
    const resolvedFile = stat.isDirectory
      ? resolve(filePath, "index.html")
      : filePath;
    const file = await Deno.open(resolvedFile, { read: true });
    return new Response(file.readable, {
      headers: {
        "content-type": contentType(resolvedFile),
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

function observePageFailures(page: Page): () => void {
  const failures: string[] = [];
  page.on("pageerror", (error) => {
    failures.push(`pageerror: ${error.stack ?? error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(`console.error: ${message.text()}`);
    }
  });
  return () => assertEquals(failures, [], failures.join("\n"));
}

function formatError(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

async function captureBrowserPage(
  page: Page,
  screenshotDirectory: string | undefined,
  filename: string,
  fullPage = true,
): Promise<void> {
  if (screenshotDirectory === undefined) {
    return;
  }
  const screenshotPath = resolve(screenshotDirectory, filename);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage,
    path: screenshotPath,
  });
  console.log(`[Browser applications E2E] Captured ${screenshotPath}`);
}

async function webPeerLogs(page: Page): Promise<string> {
  return await page
    .locator(".logslist")
    .innerText()
    .catch(() => "<WebPeer logs unavailable>");
}

async function waitForWebPeerLog(
  page: Page,
  message: string,
  timeoutMilliseconds: number,
): Promise<void> {
  try {
    await page.locator(".logslist").filter({ hasText: message }).waitFor({
      timeout: timeoutMilliseconds,
    });
  } catch (error) {
    throw new Error(
      `${formatError(error)}\n\nWebPeer logs:\n${await webPeerLogs(page)}`,
    );
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMilliseconds = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error(message);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

async function configureP2PPane(
  root: Locator,
  settings: {
    deviceName: string;
    passphrase: string;
    relay: string;
    room: string;
    turnCredential: string;
    turnServers: string;
    turnUsername: string;
  },
): Promise<void> {
  const pane = root.locator("article");
  const transportSettings = root.locator(".browser-p2p-transport-settings");
  await pane.locator("input[type='checkbox']").first().check();
  await pane.getByPlaceholder("wss://exp-relay.vrtmrz.net, wss://xxxxx").fill(
    settings.relay,
  );
  await pane.getByPlaceholder("anything-you-like").fill(settings.room);
  await pane.getByPlaceholder("password").fill(settings.passphrase);
  await pane.getByPlaceholder("iphone-16").fill(settings.deviceName);
  if (settings.turnServers !== "") {
    await transportSettings.getByText("Optional TURN server settings", {
      exact: true,
    }).click();
    await transportSettings.getByPlaceholder("turn:turn.example.com:3478").fill(
      settings.turnServers,
    );
    await transportSettings.getByPlaceholder("Enter TURN username").fill(
      settings.turnUsername,
    );
    await transportSettings.getByPlaceholder("Enter TURN credential").fill(
      settings.turnCredential,
    );
    const saveTurn = transportSettings.getByRole("button", {
      name: "Save TURN settings",
      exact: true,
    });
    await saveTurn.click();
    await waitFor(
      async () => await saveTurn.isDisabled(),
      `${settings.deviceName} did not apply its TURN settings`,
    );
  }
  const save = pane.getByRole("button", {
    name: "Save and Apply",
    exact: true,
  });
  await save.click();
  await waitFor(
    async () => await save.isDisabled(),
    `${settings.deviceName} did not apply its P2P settings`,
  );
}

async function configureCliSettings(
  settingsPath: string,
  settings: {
    deviceName: string;
    passphrase: string;
    relay: string;
    room: string;
    turnCredential: string;
    turnServers: string;
    turnUsername: string;
  },
): Promise<void> {
  await initSettingsFile(settingsPath);
  const current = JSON.parse(await Deno.readTextFile(settingsPath)) as Record<
    string,
    unknown
  >;
  Object.assign(current, {
    P2P_AppID: "self-hosted-livesync",
    P2P_AutoAcceptingPeers: "~.*",
    P2P_AutoBroadcast: false,
    P2P_AutoDenyingPeers: "",
    P2P_AutoStart: false,
    P2P_DevicePeerName: settings.deviceName,
    P2P_Enabled: true,
    P2P_IsHeadless: true,
    P2P_passphrase: settings.passphrase,
    P2P_relays: settings.relay,
    P2P_roomID: settings.room,
    P2P_turnCredential: settings.turnCredential,
    P2P_turnServers: settings.turnServers,
    P2P_turnUsername: settings.turnUsername,
    encrypt: false,
    isConfigured: true,
    passphrase: "",
    remoteType: "ONLY_P2P",
    usePathObfuscation: false,
  });
  await Deno.writeTextFile(settingsPath, JSON.stringify(current, null, 2));
}

async function waitForBackgroundExit(
  process: BackgroundCliProcess,
  timeoutMilliseconds: number,
): Promise<number> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const status = await Promise.race([
      process.child.status,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`CLI process timed out\n${process.combined}`)),
          timeoutMilliseconds,
        );
      }),
    ]);
    await process.stop();
    return status.code;
  } catch (error) {
    await process.stop();
    throw error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

Deno.test({
  name: "browser applications: WebApp to WebPeer to CLI",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const relay = Deno.env.get("BROWSER_APPS_P2P_RELAY_URL") ??
      "ws://127.0.0.1:4000/";
    const turnServers = Deno.env.get("BROWSER_APPS_P2P_TURN_SERVERS") ?? "";
    const turnUsername = Deno.env.get("BROWSER_APPS_P2P_TURN_USERNAME") ?? "";
    const turnCredential = Deno.env.get("BROWSER_APPS_P2P_TURN_CREDENTIAL") ??
      "";
    const port = Number(Deno.env.get("BROWSER_APPS_INTEROP_PORT") ?? "43920");
    const screenshotDirectory =
      Deno.env.get("BROWSER_APPS_SCREENSHOT_DIR")?.trim() || undefined;
    const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const room = `browser-interop-${nonce}`;
    const p2pPassphrase = `browser-interop-passphrase-${nonce}`;
    const webAppDeviceName = `webapp-${nonce}`;
    const webPeerDeviceName = `webpeer-${nonce}`;
    const cliDeviceName = `cli-${nonce}`;
    const rootName = `browser-interop-root-${nonce}`;
    const notePath = "webapp-to-cli.md";
    const noteContent =
      `# Browser interoperability\n\nTransferred through WebApp, WebPeer, and CLI.\n${nonce}\n`;

    if (screenshotDirectory !== undefined) {
      await Deno.mkdir(screenshotDirectory, { recursive: true });
    }
    await using workDir = await TemporaryDirectory.create(
      "livesync-browser-apps-interop",
    );
    const cliDatabasePath = workDir.resolve("cli-database");
    const cliSettingsPath = workDir.resolve("cli-settings.json");
    await Deno.mkdir(cliDatabasePath, { recursive: true });
    await configureCliSettings(cliSettingsPath, {
      deviceName: cliDeviceName,
      passphrase: p2pPassphrase,
      relay,
      room,
      turnCredential,
      turnServers,
      turnUsername,
    });

    const relayUrl = new URL(relay);
    await waitForPort(
      relayUrl.hostname,
      Number(relayUrl.port || (relayUrl.protocol === "wss:" ? 443 : 80)),
      {
        timeoutMs: 30_000,
      },
    );
    if (turnServers.startsWith("turn:")) {
      const [hostnameAndPort] = turnServers.slice("turn:".length).split("?");
      const separatorIndex = hostnameAndPort.lastIndexOf(":");
      const hostname = hostnameAndPort.slice(0, separatorIndex);
      const turnPort = Number(hostnameAndPort.slice(separatorIndex + 1));
      if (hostname === "" || !Number.isFinite(turnPort)) {
        throw new Error(`Unsupported TURN server URL: ${turnServers}`);
      }
      await waitForPort(hostname, turnPort, { timeoutMs: 30_000 });
    }
    const server = Deno.serve(
      {
        hostname: "127.0.0.1",
        onListen: () => {},
        port,
      },
      serveBrowserApplications,
    );
    const browser = await chromium.launch({ headless: true });
    const webAppContext = await browser.newContext();
    const webPeerContext = await browser.newContext();
    const webAppPage = await webAppContext.newPage();
    const webPeerPage = await webPeerContext.newPage();
    const assertNoWebAppFailures = observePageFailures(webAppPage);
    const assertNoWebPeerFailures = observePageFailures(webPeerPage);
    const baseUrl = `http://127.0.0.1:${port}/`;

    const pickerScript = `
            const rootName = ${JSON.stringify(rootName)};
            const notePath = ${JSON.stringify(notePath)};
            const noteContent = ${JSON.stringify(noteContent)};
            Object.defineProperty(globalThis, "showDirectoryPicker", {
                configurable: true,
                value: async () => {
                    const originRoot = await navigator.storage.getDirectory();
                    try {
                        await originRoot.removeEntry(rootName, { recursive: true });
                    } catch (error) {
                        if (error?.name !== "NotFoundError") throw error;
                    }
                    const selectedRoot = await originRoot.getDirectoryHandle(rootName, { create: true });
                    const note = await selectedRoot.getFileHandle(notePath, { create: true });
                    const writable = await note.createWritable();
                    await writable.write(noteContent);
                    await writable.close();
                    return selectedRoot;
                },
            });
        `;
    await webAppPage.addInitScript(pickerScript);

    try {
      await webPeerPage.goto(new URL("webpeer/", baseUrl).href);
      await webPeerPage.getByRole("heading", {
        name: "Peer to Peer Replicator",
        exact: true,
      }).waitFor({
        timeout: 30_000,
      });
      await captureBrowserPage(
        webPeerPage,
        screenshotDirectory,
        "webpeer-initial.png",
      );
      await configureP2PPane(webPeerPage.locator(".control"), {
        deviceName: webPeerDeviceName,
        passphrase: p2pPassphrase,
        relay,
        room,
        turnCredential,
        turnServers,
        turnUsername,
      });
      await webPeerPage.getByRole("button", { name: "Connect", exact: true })
        .click();
      await webPeerPage.getByText("Connected to Signaling Server", {
        exact: false,
      }).waitFor({
        timeout: 30_000,
      });
      await captureBrowserPage(
        webPeerPage,
        screenshotDirectory,
        "webpeer-configured.png",
      );

      await webAppPage.goto(new URL("webapp/webapp.html", baseUrl).href);
      await webAppPage.locator("#vault-selector").waitFor({
        state: "visible",
        timeout: 30_000,
      });
      await captureBrowserPage(
        webAppPage,
        screenshotDirectory,
        "webapp-root-selection.png",
      );
      await webAppPage.getByRole("button", {
        name: "Choose new vault folder",
        exact: true,
      }).click();
      await webAppPage.locator("#vault-selector").waitFor({
        state: "hidden",
        timeout: 30_000,
      });
      const webAppP2P = webAppPage.locator(".p2p-control");
      await webAppP2P.getByRole("heading", {
        name: "Peer to Peer Replicator",
        exact: true,
      }).waitFor();
      await configureP2PPane(webAppP2P, {
        deviceName: webAppDeviceName,
        passphrase: p2pPassphrase,
        relay,
        room,
        turnCredential,
        turnServers,
        turnUsername,
      });
      await webAppP2P.getByRole("button", {
        name: "Scan local files",
        exact: true,
      }).click();
      await webAppP2P
        .getByRole("status")
        .filter({ hasText: "Local files are ready for synchronisation." })
        .waitFor({ timeout: 30_000 });
      await webAppP2P.getByRole("button", { name: "Connect", exact: true })
        .click();
      await webAppP2P.getByText("Connected to Signaling Server", {
        exact: false,
      }).waitFor({
        timeout: 30_000,
      });
      await captureBrowserPage(
        webAppPage,
        screenshotDirectory,
        "webapp-configured.png",
      );

      const webAppPeerRow = webPeerPage.locator("table.peers tbody tr").filter({
        hasText: webAppDeviceName,
      });
      await webAppPeerRow.waitFor({ timeout: 30_000 });
      await webAppPeerRow.getByRole("button", { name: "Accept", exact: true })
        .click();
      await webAppPeerRow.getByRole("button", { name: "🔄", exact: true })
        .click();

      const webAppConnectionRequest = webAppPage.locator(
        "dialog.vpk-browser-dialog[open]",
      );
      await webAppConnectionRequest.waitFor({
        state: "visible",
        timeout: 30_000,
      });
      assertEquals(
        await webAppConnectionRequest.getByRole("heading").innerText(),
        "P2P Connection Request",
      );
      await captureBrowserPage(
        webAppPage,
        screenshotDirectory,
        "webapp-connection-request.png",
        false,
      );
      await webAppConnectionRequest
        .getByRole("button", { name: "Accept", exact: true })
        .evaluate((button: { click(): void }) => button.click());
      await webAppConnectionRequest.waitFor({
        state: "hidden",
        timeout: 5_000,
      });
      try {
        await waitForWebPeerLog(
          webPeerPage,
          "P2P Replication has been done",
          60_000,
        );
      } catch (error) {
        throw new Error(
          `${formatError(error)}\n\nWebApp state:\n${await webAppPage.locator(
            "body",
          ).innerText()}`,
        );
      }
      await captureBrowserPage(
        webAppPage,
        screenshotDirectory,
        "webapp-webpeer-replicated.png",
      );
      await captureBrowserPage(
        webPeerPage,
        screenshotDirectory,
        "webpeer-webapp-replicated.png",
      );

      await webAppP2P.getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await webAppP2P.getByText("No Connection", { exact: true }).waitFor({
        timeout: 30_000,
      });
      await webAppContext.close();

      const cliSync = startCliInBackground(
        cliDatabasePath,
        "--settings",
        cliSettingsPath,
        "p2p-sync",
        webPeerDeviceName,
        "20",
      );
      const cliPeerRow = webPeerPage.locator("table.peers tbody tr").filter({
        hasText: cliDeviceName,
      });
      try {
        await cliPeerRow.waitFor({ timeout: 20_000 });
        const webPeerConnectionRequest = webPeerPage.locator(
          "dialog.vpk-browser-dialog[open]",
        );
        await webPeerConnectionRequest.waitFor({
          state: "visible",
          timeout: 20_000,
        });
        assertEquals(
          await webPeerConnectionRequest.getByRole("heading").innerText(),
          "P2P Connection Request",
        );
        await captureBrowserPage(
          webPeerPage,
          screenshotDirectory,
          "webpeer-cli-connection-request.png",
          false,
        );
        await webPeerConnectionRequest
          .getByRole("button", { name: "Accept", exact: true })
          .evaluate((button: { click(): void }) => button.click());
        await webPeerConnectionRequest.waitFor({
          state: "hidden",
          timeout: 5_000,
        });
        const syncExitCode = await waitForBackgroundExit(cliSync, 45_000);
        assertEquals(syncExitCode, 0, cliSync.combined);
      } catch (error) {
        await cliSync.stop();
        throw new Error(
          `${
            formatError(error)
          }\n\nCLI output:\n${cliSync.combined}\n\nWebPeer logs:\n${await webPeerLogs(
            webPeerPage,
          )}`,
        );
      }

      const catResult = await runCli(
        cliDatabasePath,
        "--settings",
        cliSettingsPath,
        "cat",
        notePath,
      );
      assertEquals(catResult.code, 0, catResult.combined);
      assertEquals(sanitiseCatStdout(catResult.stdout), noteContent);
      assertStringIncludes(catResult.stderr, "[Command] cat");
      await captureBrowserPage(
        webPeerPage,
        screenshotDirectory,
        "webpeer-cli-completed.png",
      );

      assertNoWebAppFailures();
      assertNoWebPeerFailures();
    } finally {
      await webAppContext.close().catch(() => {});
      await webPeerContext.close().catch(() => {});
      await browser.close();
      await server.shutdown();
    }
  },
});
