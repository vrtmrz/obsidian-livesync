import assert from "node:assert/strict";
import type { Page } from "playwright";
import { DoctorRegulation } from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianElement, captureObsidianPage, openLiveSyncSettings, withObsidianPage } from "../runner/ui.ts";
import { assertMobileDialogueLayout, setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const fixturePath = "Private/diagnostic-秘密.md";
const fixtureContent = "Diagnostic fixture content which must never appear in a report.\n";
const shadowId = "diagnostic-shadow-document";
const timeout = 15000;

type DiagnosticPageGlobal = typeof globalThis & {
    app: { commands: { executeCommandById(id: string): boolean } };
    diagnosticClipboard?: string;
    diagnosticDownload?: { name: string; content: string };
};

async function openCommand(page: Page, kind: "usage" | "integrity") {
    const id = kind === "usage" ? "analyse-database" : "inspect-database-integrity";
    const opened = await page.evaluate(
        (command) => (globalThis as DiagnosticPageGlobal).app.commands.executeCommandById(command),
        `obsidian-livesync:${id}`
    );
    assert.equal(opened, true);
    const dialogue = page.locator(".database-diagnostic");
    await dialogue.locator("select").selectOption("pseudonym");
    assert.equal(await dialogue.getAttribute("data-diagnostic-phase"), "choice");
    assert.equal(await dialogue.locator("textarea").count(), 0);
    return dialogue;
}

async function readDatabaseState(cli: string, session: ObsidianLiveSyncSession) {
    return await evalObsidianJson<{ sequence: unknown; settings: string; names: string[] }>(
        cli,
        "(async()=>{const core=app.plugins.plugins['obsidian-livesync'].core;return JSON.stringify({sequence:(await core.localDatabase.localDatabase.info()).update_seq,settings:JSON.stringify(core.services.setting.currentSettings()),names:app.vault.getFiles().map(f=>f.path).sort()});})()",
        session.cliEnv
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = requireObsidianCli();
    const vault = await createTemporaryVault("obsidian-livesync-diagnostics-");
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli,
            vault,
            pluginData: {
                displayLanguage: "def",
                doctorProcessedVersion: DoctorRegulation.version,
                isConfigured: true,
                useAdvancedMode: true,
                readChunksOnline: true,
                liveSync: false,
                remoteType: "",
                couchDB_URI: "",
                couchDB_DBNAME: "",
                couchDB_USER: "",
                couchDB_PASSWORD: "",
                remoteConfigurations: {},
                activeConfigurationId: "",
                notifyThresholdOfRemoteStorageSize: -1,
                periodicReplication: false,
                syncAfterMerge: false,
                syncOnEditorSave: false,
                syncOnFileOpen: false,
                syncOnSave: false,
                syncOnStart: false,
                useEden: false,
            },
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cli, session.cliEnv);
        await evalObsidianJson(
            cli,
            `(async()=>{await app.vault.createFolder('Private');await app.vault.create(${JSON.stringify(fixturePath)},${JSON.stringify(fixtureContent)});return JSON.stringify(true);})()`,
            session.cliEnv
        );
        await waitForLocalDatabaseEntry(cli, session.cliEnv, fixturePath);
        await evalObsidianJson(
            cli,
            `(async()=>{const core=app.plugins.plugins['obsidian-livesync'].core;await core.services.fileProcessing.commitPendingFileEvents();const db=core.localDatabase.localDatabase;const id=await core.services.path.path2id(${JSON.stringify(fixturePath)});const original=await db.get(id);const shadow={...original,_id:${JSON.stringify(shadowId)}};delete shadow._rev;await db.put(shadow);return JSON.stringify(true);})()`,
            session.cliEnv
        );
        const before = await readDatabaseState(cli, session);
        let usageJSON = "";
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const choice = await openCommand(page, "usage");
            await choice.getByRole("button", { name: "Cancel", exact: true }).click();
            await choice.waitFor({ state: "hidden", timeout });
            const dialogue = await openCommand(page, "usage");
            assert.equal(await dialogue.locator("select").inputValue(), "pseudonym");
            await dialogue.getByRole("button", { name: "Begin inspection", exact: true }).click();
            await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
            const tsv = await dialogue.locator("textarea").inputValue();
            assert.equal(tsv.split("\n")[0].split("\t").length, 9);
            assert.ok(!tsv.includes(fixturePath));
            assert.ok(!tsv.includes(shadowId));
            assert.ok(!tsv.includes(fixtureContent.trim()));
            await dialogue.locator("select").selectOption("json");
            usageJSON = await dialogue.locator("textarea").inputValue();
            const report = JSON.parse(usageJSON);
            assert.equal(report.status, "complete");
            assert.ok(report.versions.commonlib);
            assert.ok(report.rows.some((row: { path: string }) => row.path.startsWith("file-")));

            // Capture exports inside the isolated renderer without changing the
            // host clipboard or leaving downloads in a user's download directory.
            await page.evaluate(`(() => {
                Object.defineProperty(navigator.clipboard, "writeText", {
                    configurable: true,
                    value: async (text) => { globalThis.diagnosticClipboard = text; },
                });
                document.addEventListener("click", (event) => {
                    const link = event.target;
                    if (!(link instanceof HTMLAnchorElement) || !link.download || !link.href.startsWith("blob:")) return;
                    event.preventDefault();
                    void fetch(link.href).then((response) => response.text()).then((content) => {
                        globalThis.diagnosticDownload = { name: link.download, content };
                    });
                }, true);
            })()`);
            await dialogue.getByRole("button", { name: "Copy report", exact: true }).click();
            assert.equal(
                await page.evaluate(() => (globalThis as DiagnosticPageGlobal).diagnosticClipboard),
                usageJSON
            );
            await dialogue.getByRole("button", { name: "Save report", exact: true }).click();
            await page.waitForFunction(() => !!(globalThis as DiagnosticPageGlobal).diagnosticDownload, undefined, {
                timeout,
            });
            assert.deepEqual(await page.evaluate(() => (globalThis as DiagnosticPageGlobal).diagnosticDownload), {
                name: "database-usage-complete.json",
                content: usageJSON,
            });
            await dialogue.getByRole("button", { name: "Close", exact: true }).click();
            await dialogue.waitFor({ state: "hidden", timeout });

            const original = await openCommand(page, "usage");
            await original.locator("select").selectOption("original");
            await original.getByRole("button", { name: "Begin inspection", exact: true }).click();
            await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
            const rawTSV = await original.locator("textarea").inputValue();
            assert.ok(rawTSV.includes(fixturePath));
            assert.ok(rawTSV.includes(shadowId));
            assert.ok(!rawTSV.includes(fixtureContent.trim()));
            await original.getByRole("button", { name: "Close", exact: true }).click();
            await original.waitFor({ state: "hidden", timeout });

            const settingsNavigator = await openLiveSyncSettings(page, timeout);
            const hatch = await settingsNavigator.openPage("Hatch");
            const setting = hatch
                .locator(".setting-item")
                .filter({ has: page.getByText("Inspect database integrity", { exact: true }) });
            await setting.getByRole("button", { name: "Inspect", exact: true }).click();
            const integrity = page.locator(".database-diagnostic");
            assert.equal(await integrity.locator("select").inputValue(), "pseudonym");
            await integrity.getByRole("button", { name: "Begin inspection", exact: true }).click();
            await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
            await integrity.locator("select").selectOption("json");
            const reportText = await integrity.locator("textarea").inputValue();
            const integrityReport = JSON.parse(reportText);
            assert.equal(integrityReport.status, "partial");
            assert.ok(
                integrityReport.errors.some((error: { reason: string }) => error.reason === "source-unavailable")
            );
            assert.ok(
                integrityReport.observations.some(
                    (observation: { identity: string }) => observation.identity === "document-id-mismatch"
                )
            );
            assert.ok(
                integrityReport.observations.some((observation: { comparisons: { relation: string }[] }) =>
                    observation.comparisons.some((comparison) => comparison.relation === "equal")
                )
            );
            for (const privateValue of [fixturePath, shadowId, fixtureContent.trim()])
                assert.ok(!reportText.includes(privateValue));
        });
        const desktopScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "database-diagnostics-desktop.png",
            (page) => page.locator(".modal-container").filter({ has: page.locator(".database-diagnostic") })
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.locator(".database-diagnostic").getByRole("button", { name: "Close", exact: true }).click();
            await page.keyboard.press("Escape");
        });
        const after = await readDatabaseState(cli, session);
        assert.deepEqual(after, before, "Diagnostics must leave settings, revisions, and Vault files unchanged");

        await setObsidianMobileTestMode(session.remoteDebuggingPort, true, timeout);
        await waitForLiveSyncCoreReady(cli, session.cliEnv);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await openCommand(page, "integrity");
        });
        const mobileScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "database-diagnostics-mobile.png",
            (page) => page.locator(".modal-container").filter({ has: page.locator(".database-diagnostic") })
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = page.locator(".modal-container").filter({ has: page.locator(".database-diagnostic") });
            await assertMobileDialogueLayout(page, modal, "Database diagnostic choice");
            await modal.getByRole("button", { name: "Cancel", exact: true }).click();
        });
        console.log(JSON.stringify({ status: "passed", desktopScreenshot, mobileScreenshot, readOnly: true }));
    } catch (error) {
        if (session) {
            await captureObsidianPage(
                session.remoteDebuggingPort,
                "database-diagnostics-failure.png",
                async () => {}
            ).catch(() => {});
        }
        throw error;
    } finally {
        if (session) await session.app.stop();
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
