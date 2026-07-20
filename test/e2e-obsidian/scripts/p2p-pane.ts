import { assertNoHorizontalOverflow } from "@vrtmrz/obsidian-test-session";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { createE2eObsidianDeviceLocalState, waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianPage, obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_P2P_PANE_TIMEOUT_MS ?? 10000);

type ObsidianTestApp = {
    commands?: { executeCommandById(commandId: string): boolean };
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

async function verifyP2PStatusPane(): Promise<string> {
    await openP2PStatusPane();
    return await captureObsidianPage(obsidianRemoteDebuggingPort(), "p2p-status-pane.png", async (page) => {
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
        await assertNoHorizontalOverflow(page, pane, { label: "P2P status pane" });
    });
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: {
                doctorProcessedVersion: "0.25.27",
                isConfigured: true,
                liveSync: false,
                notifyThresholdOfRemoteStorageSize: -1,
                periodicReplication: false,
                P2P_Enabled: false,
                P2P_AutoStart: false,
                syncAfterMerge: false,
                syncOnEditorSave: false,
                syncOnFileOpen: false,
                syncOnSave: false,
                syncOnStart: false,
            },
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        const screenshot = await verifyP2PStatusPane();
        console.log(`P2P status pane mounted without network fixtures. Screenshot: ${screenshot}`);
    } finally {
        if (session) {
            await session.app.stop();
        }
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
