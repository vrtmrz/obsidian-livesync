/**
 * Verifies the complete user-visible contract of the P2P status pane in real
 * Obsidian: a configured CouchDB-only Vault with no P2P profile is not
 * presented with P2P controls, while configured P2P devices can deliberately
 * open the current pane in the appropriate workspace area.
 *
 * Desktop and mobile use separate Vaults, profiles, and Obsidian processes.
 * Mobile mode is enabled before LiveSync's first load so that command and view
 * registration observe the mobile application state, and no desktop workspace
 * state can make a misplaced or restored pane appear correct.
 *
 * Command registration, automatic-opening policy, ribbon availability,
 * workspace ownership, layout, and screenshots are kept in one scenario
 * because together they describe one navigation path. Checking them in
 * isolation could miss a pane which is registered correctly but opens in the
 * wrong area, or one which is visible only because another session restored it.
 */
import { assertLocatorWithinViewport, assertNoHorizontalOverflow } from "@vrtmrz/obsidian-test-session";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type.js";
import { upsertRemoteConfigurationInPlace } from "@vrtmrz/livesync-commonlib/remote-configurations.js";
import type { ConsoleMessage, Page } from "playwright";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { setObsidianMobileTestModeBeforePluginStart } from "../runner/mobileUi.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianPage, obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_P2P_PANE_TIMEOUT_MS ?? 10000);

type ObsidianTestLeaf = {
    containerEl?: HTMLElement;
    view?: { getViewType?: () => string };
};

type ObsidianTestWorkspace = {
    activeLeaf?: ObsidianTestLeaf;
    getLeavesOfType?: (type: string) => ObsidianTestLeaf[];
    getRightLeaf?: (split: boolean) => ObsidianTestLeaf | null;
    rightSplit?: { containerEl?: HTMLElement };
};

type ObsidianTestApp = {
    commands?: {
        commands?: Record<string, unknown>;
        executeCommandById(commandId: string): boolean;
    };
    isMobile?: boolean;
    plugins?: {
        plugins?: Record<
            string,
            {
                core?: {
                    services?: {
                        API?: {
                            isMobile?: () => boolean;
                        };
                    };
                };
            }
        >;
    };
    workspace?: ObsidianTestWorkspace;
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

async function openP2PStatusPane(page: Page) {
    return await page.evaluate((commandId) => {
        const app = (globalThis as ObsidianTestGlobal).app;
        const plugin = app?.plugins?.plugins?.["obsidian-livesync"];
        return {
            opened: app?.commands?.executeCommandById(commandId) === true,
            appIsMobile: app?.isMobile ?? null,
            apiIsMobile: plugin?.core?.services?.API?.isMobile?.() ?? null,
            bodyIsMobile: document.body.classList.contains("is-mobile"),
        };
    }, "obsidian-livesync:open-p2p-server-status");
}

async function collectP2PWorkspaceState(page: Page) {
    return await page.evaluate(() => {
        const workspace = (globalThis as ObsidianTestGlobal).app?.workspace;
        const activeLeaf = workspace?.activeLeaf;
        const p2pLeaves = workspace?.getLeavesOfType?.("p2p-server-status") ?? [];
        const rightLeaf = workspace?.getRightLeaf?.(false);
        return {
            bodyClasses: document.body.className,
            activeLeaf: {
                type: activeLeaf?.view?.getViewType?.() ?? null,
                visible: activeLeaf?.containerEl?.checkVisibility?.() ?? null,
                classes: activeLeaf?.containerEl?.className ?? null,
            },
            p2pLeaves: p2pLeaves.map((leaf) => ({
                type: leaf.view?.getViewType?.() ?? null,
                visible: leaf.containerEl?.checkVisibility?.() ?? null,
                classes: leaf.containerEl?.className ?? null,
            })),
            rightLeaf: {
                type: rightLeaf?.view?.getViewType?.() ?? null,
                visible: rightLeaf?.containerEl?.checkVisibility?.() ?? null,
                classes: rightLeaf?.containerEl?.className ?? null,
            },
            visibleP2PContents: document.querySelectorAll(
                ".workspace-leaf-content[data-type='p2p-server-status']:not(.is-hidden)"
            ).length,
        };
    });
}

async function assertMobileP2PPlacement(page: Page): Promise<void> {
    const placement = await page.evaluate(() => {
        const workspace = (globalThis as ObsidianTestGlobal).app?.workspace;
        const p2pLeaves = workspace?.getLeavesOfType?.("p2p-server-status") ?? [];
        const rightSplit = workspace?.rightSplit?.containerEl;
        const rightLeaf = workspace?.getRightLeaf?.(false);
        return {
            p2pLeafCount: p2pLeaves.length,
            inRightSplit: p2pLeaves.some(
                (leaf) =>
                    (rightSplit?.contains(leaf.containerEl ?? null) ?? false) ||
                    (leaf.containerEl?.closest(".mod-right-split, .workspace-drawer.mod-right") ?? null) !== null
            ),
            rightLeafType: rightLeaf?.view?.getViewType?.() ?? null,
            p2pLeafClasses: p2pLeaves.map((leaf) => leaf.containerEl?.className ?? null),
            rightSplitClasses: rightSplit?.className ?? null,
        };
    });
    if (!placement.inRightSplit) {
        throw new Error(`The mobile P2P status view was not opened in the right leaf: ${JSON.stringify(placement)}`);
    }
}

async function verifyP2PStatusPane(filename: string, mobile: boolean): Promise<string> {
    return await captureObsidianPage(obsidianRemoteDebuggingPort(), filename, async (page) => {
        const runtimeErrors: string[] = [];
        const onPageError = (error: Error) => runtimeErrors.push(`pageerror: ${error.message}`);
        const onConsole = (message: ConsoleMessage) => {
            if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
        };
        page.on("pageerror", onPageError);
        page.on("console", onConsole);
        let dispatchState: Awaited<ReturnType<typeof openP2PStatusPane>> | undefined;
        const heading = page.getByRole("heading", { name: "Signalling Status" }).last();
        try {
            dispatchState = await openP2PStatusPane(page);
            if (!dispatchState.opened) {
                throw new Error("The P2P status command was not registered or could not be executed.");
            }
            if (
                mobile &&
                (dispatchState.appIsMobile !== true ||
                    dispatchState.apiIsMobile !== true ||
                    dispatchState.bodyIsMobile !== true)
            ) {
                throw new Error(
                    `The mobile P2P command did not observe a fully mobile application state: ${JSON.stringify(dispatchState)}`
                );
            }
            await heading.waitFor({ state: "visible", timeout: uiTimeoutMs });
        } catch (error) {
            const workspaceState = await collectP2PWorkspaceState(page);
            console.error(
                `P2P command state after failed open: ${JSON.stringify({ dispatchState, runtimeErrors })}`
            );
            console.error(`P2P workspace state after failed open: ${JSON.stringify(workspaceState)}`);
            throw error;
        } finally {
            page.off("pageerror", onPageError);
            page.off("console", onConsole);
        }
        if (mobile) {
            await assertMobileP2PPlacement(page);
        }
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
        const remoteSelectionDeadline = Date.now() + uiTimeoutMs;
        let remoteConfigurationId = "";
        while (Date.now() < remoteSelectionDeadline) {
            remoteConfigurationId = (await remoteSelector.inputValue()).trim();
            if (remoteConfigurationId !== "") break;
            await page.waitForTimeout(50);
        }
        if (remoteConfigurationId === "") {
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
            throw new Error("The P2P status pane opened automatically for a CouchDB user without P2P configured.");
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

async function assertConfiguredP2PCommandIsAvailable(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const state = await page.evaluate(() => {
            const app = (globalThis as ObsidianTestGlobal).app;
            const commands = app?.commands?.commands ?? {};
            return {
                commandRegistered: commands["obsidian-livesync:open-p2p-server-status"] !== undefined,
                openPaneCount: app?.workspace?.getLeavesOfType?.("p2p-server-status").length ?? 0,
            };
        });
        if (!state.commandRegistered) {
            throw new Error("The configured P2P status command was not registered in mobile mode.");
        }
        if (state.openPaneCount !== 0) {
            throw new Error("The configured P2P status pane opened before the mobile user requested it.");
        }
    });
}

async function dismissOpenNotices(page: Page): Promise<void> {
    const deadline = Date.now() + uiTimeoutMs;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
        const dismissed = await page.evaluate(() => {
            const notices = (Array.from(document.querySelectorAll(".notice")) as HTMLElement[]).filter(
                (notice) => notice.checkVisibility?.() ?? notice.offsetParent !== null
            );
            for (const notice of notices) {
                const closeButton = notice.querySelector(".notice-close-button") as HTMLElement | null;
                // Obsidian 1.12 does not render a separate close control for
                // every Notice; clicking the Notice itself is its standard
                // dismiss action.
                (closeButton ?? notice).click();
            }
            return notices.length;
        });
        if (dismissed === 0) {
            if (Date.now() - quietSince >= 500) {
                return;
            }
            await page.waitForTimeout(100);
            continue;
        }
        quietSince = Date.now();
        await page.waitForTimeout(50);
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
    verify: () => Promise<void>,
    options: { mobileBeforePluginStart?: boolean } = {}
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
            lifecycle: options.mobileBeforePluginStart
                ? {
                      beforePluginStart: async ({ remoteDebuggingPort }) => {
                          await setObsidianMobileTestModeBeforePluginStart(
                              remoteDebuggingPort,
                              true,
                              uiTimeoutMs
                          );
                      },
                  }
                : undefined,
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
            console.log(
                `Configured P2P status UI remained opt-in and was reachable on desktop. Screenshot: ${desktopScreenshot}`
            );
        }
    );

    await withP2PSession(
        binary,
        cli.binary,
        createConfiguredP2PPluginData(),
        async () => {
            await assertConfiguredP2PCommandIsAvailable();
            const mobileScreenshot = await verifyP2PStatusPane("p2p-status-pane-mobile.png", true);
            console.log(
                `Configured P2P status UI remained opt-in and was reachable on mobile. Screenshot: ${mobileScreenshot}`
            );
        },
        { mobileBeforePluginStart: true }
    );
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
