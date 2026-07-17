import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_SETTINGS_TIMEOUT_MS ?? 10000);

type ObsidianSettingsController = {
    open(): void;
    openTabById(tabId: string): void;
};

type ObsidianTestApp = {
    setting?: ObsidianSettingsController;
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

async function verifyDeletionSettings(): Promise<void> {
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.evaluate(() => {
            const setting = (globalThis as ObsidianTestGlobal).app?.setting;
            if (setting === undefined) throw new Error("Obsidian settings are unavailable");
            setting.open();
            setting.openTabById("obsidian-livesync");
        });

        const liveSyncSettings = page.locator(".sls-setting");
        await liveSyncSettings.waitFor({ state: "visible", timeout: uiTimeoutMs });
        await liveSyncSettings.locator('.sls-setting-menu-btn[title="Sync Settings"]').click();

        const deletionPanel = liveSyncSettings
            .locator("h4.sls-setting-panel-title")
            .filter({ hasText: "Deletion Propagation" })
            .locator("..");
        await deletionPanel
            .getByText("Keep empty folder", { exact: true })
            .waitFor({ state: "visible", timeout: uiTimeoutMs });

        const obsoleteToggleCount = await deletionPanel.getByText("Use the trash bin", { exact: true }).count();
        if (obsoleteToggleCount !== 0) {
            throw new Error(
                `The obsolete LiveSync trash toggle is still present in the settings UI (${obsoleteToggleCount} found).`
            );
        }
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
                lastReadUpdates: Number.MAX_SAFE_INTEGER,
                liveSync: false,
                notifyThresholdOfRemoteStorageSize: 0,
                syncOnStart: false,
                syncOnSave: false,
                syncOnEditorSave: false,
                syncOnFileOpen: false,
                syncAfterMerge: false,
                periodicReplication: false,
                useAdvancedMode: true,
            },
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await verifyDeletionSettings();
        console.log("Deletion settings expose only effective user controls.");
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
