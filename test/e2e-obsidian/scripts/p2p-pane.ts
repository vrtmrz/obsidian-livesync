import { assertLocatorWithinViewport, assertNoHorizontalOverflow } from "@vrtmrz/obsidian-test-session";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type";
import { upsertRemoteConfigurationInPlace } from "@vrtmrz/livesync-commonlib/remote-configurations";
import type { Page } from "playwright";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianPage, obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_P2P_PANE_TIMEOUT_MS ?? 10000);

type ObsidianTestApp = {
    commands?: {
        commands?: Record<string, unknown>;
        executeCommandById(commandId: string): boolean;
    };
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

async function openP2PStatusPane(): Promise<void> {
    const opened = await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        return await page.evaluate(
            (commandId) => (globalThis as ObsidianTestGlobal).app?.commands?.executeCommandById(commandId) === true,
            "obsidian-livesync:open-p2p-server-status"
        );
    });
    if (!opened) {
        throw new Error("The P2P status command was not registered or could not be executed.");
    }
}

async function verifyP2PStatusPane(filename: string, mobile: boolean): Promise<string> {
    await openP2PStatusPane();
    return await captureObsidianPage(obsidianRemoteDebuggingPort(), filename, async (page) => {
        const heading = page.getByRole("heading", { name: "Signalling Status" }).last();
        await heading.waitFor({ state: "visible", timeout: uiTimeoutMs });
        const pane = heading.locator(
            "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' workspace-leaf-content ')][1]"
        );
        await pane.getByText("Connection:", { exact: true }).waitFor({ state: "visible", timeout: uiTimeoutMs });
        await pane.getByRole("button", { name: "Open connection" }).waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        const remoteSelector = pane.getByRole("combobox", { name: "Select active P2P remote" });
        await remoteSelector.waitFor({ state: "visible", timeout: uiTimeoutMs });
        if ((await remoteSelector.inputValue()).trim() === "") {
            throw new Error("The configured P2P status pane did not select an active P2P remote.");
        }
        if (
            (await pane.getByText("Please select an active P2P remote configuration to change P2P sync targets.").count()) !==
            0
        ) {
            throw new Error("The configured P2P status pane still requested an active P2P remote.");
        }
        await assertNoHorizontalOverflow(page, pane, { label: "P2P status pane" });
        if (mobile) {
            await assertLocatorWithinViewport(page, pane, { label: "mobile P2P status pane" });
        }
        await dismissOpenNotices(page);
    });
}

async function assertP2PUIIsOptIn(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const state = await page.evaluate(() => {
            const commands = (globalThis as ObsidianTestGlobal).app?.commands?.commands ?? {};
            return {
                currentCommand: commands["obsidian-livesync:open-p2p-server-status"] !== undefined,
                legacyCommand: commands["obsidian-livesync:open-p2p-replicator"] !== undefined,
            };
        });
        if (!state.currentCommand) {
            throw new Error("The current P2P status command was not registered.");
        }
        if (state.legacyCommand) {
            throw new Error("The retired P2P pane command is still exposed.");
        }
        if ((await page.locator(".workspace-leaf-content[data-type='p2p-server-status']:visible").count()) !== 0) {
            throw new Error("The P2P status pane opened automatically for an unconfigured CouchDB user.");
        }
        if ((await page.locator(".livesync-ribbon-p2p-server-status").count()) !== 0) {
            throw new Error("The P2P ribbon icon was shown without a P2P configuration.");
        }
    });
}

async function assertConfiguredP2PUIIsAvailable(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.locator(".livesync-ribbon-p2p-server-status").waitFor({
            state: "visible",
            timeout: uiTimeoutMs,
        });
        if ((await page.locator(".workspace-leaf-content[data-type='p2p-server-status']:visible").count()) !== 0) {
            throw new Error("The configured P2P status pane opened before the user requested it.");
        }
    });
}

async function dismissOpenNotices(page: Page): Promise<void> {
    const deadline = Date.now() + uiTimeoutMs;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
        const notices = page.locator(".notice:visible");
        if ((await notices.count()) === 0) {
            if (Date.now() - quietSince >= 500) {
                return;
            }
            await page.waitForTimeout(100);
            continue;
        }
        quietSince = Date.now();
        const closeButton = notices.first().locator(".notice-close-button");
        if ((await closeButton.count()) > 0) {
            await closeButton.click({ force: true, timeout: uiTimeoutMs });
        } else {
            // Obsidian 1.12 does not render a separate close control for every
            // Notice; clicking the Notice itself is its standard dismiss action.
            await notices.first().click({ force: true, position: { x: 2, y: 2 }, timeout: uiTimeoutMs });
        }
    }
    throw new Error("Transient Obsidian notices did not become quiet before the P2P status screenshot.");
}

function createBaseP2PPluginData(): Record<string, unknown> {
    return createE2eCouchDbPluginData(
        {
            uri: "http://127.0.0.1:5984",
            username: "",
            password: "",
            dbName: "p2p-pane-ui-only",
        },
        {
            notifyThresholdOfRemoteStorageSize: -1,
            periodicReplication: false,
            P2P_Enabled: false,
            P2P_AutoStart: false,
            syncAfterMerge: false,
            syncOnEditorSave: false,
            syncOnFileOpen: false,
            syncOnSave: false,
            syncOnStart: false,
        }
    );
}

function createConfiguredP2PPluginData(): Record<string, unknown> {
    const pluginData = {
        ...createBaseP2PPluginData(),
        P2P_roomID: "configured-p2p-room",
        P2P_passphrase: "configured-p2p-passphrase",
    };
    upsertRemoteConfigurationInPlace(pluginData as ObsidianLiveSyncSettings, "p2p", {
        id: "e2e-p2p",
        name: "P2P Remote",
        activateForP2P: true,
    });
    return pluginData;
}

async function withP2PSession(
    binary: string,
    cliBinary: string,
    pluginData: Record<string, unknown>,
    verify: () => Promise<void>
): Promise<void> {
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData,
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await verify();
    } finally {
        if (session) {
            await session.app.stop();
        }
        await vault.dispose();
    }
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    await withP2PSession(binary, cli.binary, createBaseP2PPluginData(), async () => {
        await assertP2PUIIsOptIn();
    });

    await withP2PSession(
        binary,
        cli.binary,
        createConfiguredP2PPluginData(),
        async () => {
            await assertConfiguredP2PUIIsAvailable();
            const desktopScreenshot = await verifyP2PStatusPane("p2p-status-pane.png", false);
            await setObsidianMobileTestMode(obsidianRemoteDebuggingPort(), true, uiTimeoutMs);
            try {
                const mobileScreenshot = await verifyP2PStatusPane("p2p-status-pane-mobile.png", true);
                console.log(
                    `Configured P2P status UI remained opt-in and was reachable on desktop and mobile. Screenshots: ${desktopScreenshot}, ${mobileScreenshot}`
                );
            } finally {
                await setObsidianMobileTestMode(obsidianRemoteDebuggingPort(), false, uiTimeoutMs);
            }
        }
    );
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
