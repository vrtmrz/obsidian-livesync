import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    createTemporaryVault,
    installBuiltPlugin,
    launchObsidian,
    preseedTrustedVaultState,
    trustVaultIfPrompted,
    waitForObsidianVault,
    waitForPluginReady,
    withObsidianPage,
    requireObsidianBinary,
    assertNoHorizontalOverflow,
    type ObsidianProcess,
} from "@vrtmrz/obsidian-test-session";
import { CURRENT_SETTING_VERSION } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import { DoctorRegulation } from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import { setObsidianMobileTestMode } from "../runner/mobileUi.ts";

const vault = await createTemporaryVault({ prefix: "livesync-idb-review-", pluginIds: ["obsidian-livesync"] });
const port = Number(process.env.E2E_OBSIDIAN_REMOTE_DEBUGGING_PORT ?? 19360);
let application: ObsidianProcess | undefined;
try {
    await installBuiltPlugin(vault.path, {
        pluginId: "obsidian-livesync",
        artifactRoot: process.cwd(),
        pluginData: {
            enableDebugTools: true,
            isConfigured: true,
            settingVersion: CURRENT_SETTING_VERSION,
            doctorProcessedVersion: DoctorRegulation.version,
            versionUpFlash: "",
            syncOnStart: false,
            liveSync: false,
            periodicReplication: false,
            P2P_Enabled: false,
            P2P_AutoStart: false,
            notifyThresholdOfRemoteStorageSize: 0,
        },
    });
    application = await launchObsidian({
        binary: requireObsidianBinary(),
        vaultPath: vault.path,
        homePath: vault.homePath,
        xdgConfigPath: vault.xdgConfigPath,
        xdgCachePath: vault.xdgCachePath,
        xdgDataPath: vault.xdgDataPath,
        userDataPath: vault.userDataPath,
        remoteDebuggingPort: port,
        staleProcessPattern: vault.processMarker,
    });
    await preseedTrustedVaultState(port, vault.id);
    await waitForObsidianVault(port, vault.path);
    await trustVaultIfPrompted(port);
    await waitForPluginReady(port, "obsidian-livesync");
    await setObsidianMobileTestMode(port, true, 15000);
    await withObsidianPage(port, async (page) => {
        await page.waitForFunction(() => {
            const host = window as unknown as { app?: { commands?: { commands?: Record<string, unknown> } } };
            return Boolean(host.app?.commands?.commands?.["obsidian-livesync:open-review-harness"]);
        });
        await page.evaluate(async () => {
            const host = window as unknown as {
                app: {
                    plugins: {
                        plugins: Record<
                            string,
                            { core: { services: { API: { showWindow(type: string): Promise<void> } } } }
                        >;
                    };
                };
            };
            await host.app.plugins.plugins["obsidian-livesync"].core.services.API.showWindow(
                "self-hosted-livesync-review-harness"
            );
        });
        const harness = page.locator('[data-testid="review-harness"]');
        await harness.waitFor({ state: "visible" });
        for (const mode of ["database-connection-loss", "database-background-events"]) {
            await page.locator(`[data-testid="review-harness-run-${mode}"]`).click();
            const confirmation = page
                .locator(".modal-container")
                .filter({ hasText: "Review Harness: IndexedDB connection observation" });
            await confirmation.getByRole("button", { name: "Yes" }).click();
            const finish = page.locator('[data-testid="review-harness-database-finish"]');
            await finish.waitFor({ state: "visible" });
            const guide = page.locator(`[data-testid="review-harness-database-guide-${mode}"]`);
            await guide.getByText("fixture-native.close: listener=registered", { exact: false }).first().waitFor();
            if (mode === "database-connection-loss") {
                await page.locator('[data-testid="review-harness-database-close-native"]').click();
                await page.locator('[data-testid="review-harness-database-reopen"]').waitFor({ state: "visible" });
                await guide.getByText("retained.get=error; name=InvalidStateError", { exact: false }).first().waitFor();
                await page.locator('[data-testid="review-harness-database-reopen"]').click();
                await page
                    .locator('[data-testid="review-harness-database-close-native"]')
                    .waitFor({ state: "visible" });
                await guide.getByText("contentMatches=true; revisionMatches=true", { exact: false }).first().waitFor();
            } else {
                // A synthetic event checks the pipeline, not a mobile operating-system suspension.
                await page.evaluate(() => {
                    window.dispatchEvent(new Event("pagehide"));
                });
                await guide
                    .getByText("window.pagehide: listener=registered; received=1", { exact: false })
                    .first()
                    .waitFor();
                await page.locator('[data-testid="review-harness-database-check"]').click();
                await finish.waitFor({ state: "visible" });
            }
            await assertNoHorizontalOverflow(page, harness, { label: "Database observation guide" });
            await finish.click();
            await page
                .locator(`[data-testid="review-harness-result-${mode}"]`)
                .getByText(mode === "database-connection-loss" ? "Passed:" : "Not observed:", { exact: false })
                .waitFor();
        }
        const abortMode = "database-transaction-abort";
        const restartButton = page.locator('[data-testid="review-harness-abort-restart"]');
        assert.equal(await restartButton.count(), 0);
        await page.evaluate(() => {
            const target = window as unknown as {
                app: {
                    plugins: {
                        plugins: Record<string, { core: { services: { appLifecycle: { performRestart(): void } } } }>;
                    };
                };
                abortRestartRequests: number;
                restoreAbortRestartProbe(): void;
            };
            const lifecycle = target.app.plugins.plugins["obsidian-livesync"].core.services.appLifecycle;
            const descriptor = Object.getOwnPropertyDescriptor(lifecycle, "performRestart");
            target.abortRestartRequests = 0;
            lifecycle.performRestart = () => {
                target.abortRestartRequests++;
            };
            target.restoreAbortRestartProbe = () => {
                if (descriptor) {
                    Object.defineProperty(lifecycle, "performRestart", descriptor);
                } else {
                    Reflect.deleteProperty(lifecycle, "performRestart");
                }
            };
        });
        await page.locator(`[data-testid="review-harness-run-${abortMode}"]`).click();
        await page
            .locator(".modal-container")
            .filter({ hasText: "Review Harness: transaction abort" })
            .getByRole("button", { name: "Yes" })
            .click();
        const abortResult = page.locator(`[data-testid="review-harness-result-${abortMode}"]`);
        await abortResult.getByText("Observed:", { exact: false }).waitFor({ timeout: 25000 });
        await assertNoHorizontalOverflow(page, harness, { label: "Transaction-abort observations" });
        await page.evaluate(() => {
            const target = window as unknown as { databaseProbeCopiedReport?: string };
            navigator.clipboard.writeText = async (value) => {
                target.databaseProbeCopiedReport = value;
            };
        });
        await page.locator('[data-testid="review-harness-copy-report"]').click();
        const report = await page.evaluate(
            () => (window as unknown as { databaseProbeCopiedReport: string }).databaseProbeCopiedReport
        );
        assert.ok(report.includes("fixture-native.close: listener=registered; received=0"));
        assert.ok(report.includes("window.pagehide: listener=registered; received=1"));
        assert.ok(report.includes("active-local-native.close: listener=unavailable"));
        assert.ok(report.includes("active-local.info=ok"));
        assert.ok(report.includes("revisionMatches=true"));
        for (const adapter of ["idb", "indexeddb"]) {
            assert.ok(report.includes(`${adapter}.abort.injected=true; operation=pending; drain=false`));
            assert.ok(report.includes(`${adapter}.reopen=not-attempted; this diagnostic observes the aborted read`));
            assert.ok(report.includes(`${adapter}.cleanup=completed`));
        }
        assert.ok(!report.includes(vault.name));
        const restartRequests = () =>
            page.evaluate(() => (window as unknown as { abortRestartRequests: number }).abortRestartRequests);
        assert.equal(await restartRequests(), 0);
        await restartButton.click();
        assert.equal(await restartRequests(), 1);
        await page.evaluate(() =>
            (window as unknown as { restoreAbortRestartProbe(): void }).restoreAbortRestartProbe()
        );
        const directory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/livesync-database-probe";
        await mkdir(directory, { recursive: true });
        await writeFile(resolve(directory, "obsidian-report.md"), report);
        await page.screenshot({ path: resolve(directory, "obsidian-database-probe.png") });
        console.log(
            "Real Obsidian: controlled close, diagnostic reopen, event-only run, unfinished stock-adapter reads, mobile width, and copied report observations passed"
        );
    });
} finally {
    await application?.stop();
    await vault.dispose();
}
