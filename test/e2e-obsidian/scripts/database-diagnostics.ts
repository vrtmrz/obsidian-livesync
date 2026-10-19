import assert from "node:assert/strict";
import type { Locator, Page } from "playwright";
import {
    assertLocatorHasMinimumTouchTarget,
    assertLocatorWithinSafeArea,
    assertNoHorizontalOverflow,
} from "@vrtmrz/obsidian-test-session";
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
import { assertMobileDialogueLayout, iPhoneSafeArea, setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const fixturePath = "Private/diagnostic-秘密.md";
const fixtureContent = "Diagnostic fixture content which must never appear in a report.\n";
const shadowId = "zz-diagnostic-shadow-document";
const timeout = 15000;

type DiagnosticPageGlobal = typeof globalThis & {
    app: { commands: { executeCommandById(id: string): boolean } };
    databaseDiagnosticReadGate?: { reached: boolean };
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
    await dialogue.waitFor({ state: "visible", timeout });
    assert.equal(
        await dialogue.getByRole("group", { name: "Names in this report", exact: true }).getByRole("radio").count(),
        2,
        "Both name choices must be visible as radio buttons before inspection"
    );
    const names = dialogue.getByRole("group", { name: "Names in this report", exact: true });
    for (const name of ["Pseudonyms (recommended)", "Original names"])
        assert.equal(await names.getByRole("radio", { name, exact: true }).isVisible(), true);
    assert.equal(await names.getByRole("radio", { name: "Pseudonyms (recommended)", exact: true }).isChecked(), true);
    assert.equal(await names.getByRole("radio", { checked: true }).count(), 1);
    assert.equal(await dialogue.getAttribute("data-diagnostic-phase"), "choice");
    assert.equal(await dialogue.locator("textarea").count(), 0);
    return dialogue;
}

async function assertFormatChoices(dialogue: Locator, formats: string[]): Promise<void> {
    const group = dialogue.getByRole("group", { name: "Report format", exact: true });
    assert.equal(await group.getByRole("radio").count(), formats.length);
    for (const name of formats) assert.equal(await group.getByRole("radio", { name, exact: true }).isVisible(), true);
    assert.equal(await group.getByRole("radio", { checked: true }).count(), 1);
}

async function chooseFormat(dialogue: Locator, format: string): Promise<void> {
    const group = dialogue.getByRole("group", { name: "Report format", exact: true });
    const radio = group.getByRole("radio", { name: format.toUpperCase(), exact: true });
    await radio.check();
    assert.equal(await radio.isChecked(), true);
    assert.equal(await group.getByRole("radio", { checked: true }).count(), 1);
}

async function assertMobileRadioTargets(page: Page, dialogue: Locator, name: string): Promise<void> {
    const radios = dialogue.getByRole("group", { name, exact: true }).getByRole("radio");
    for (let index = 0; index < (await radios.count()); index++) {
        const target = radios.nth(index).locator("..");
        const label = `${name}: ${(await target.innerText()).trim()}`;
        await assertLocatorHasMinimumTouchTarget(page, target, { label });
        await assertLocatorWithinSafeArea(page, target, { label, safeAreaInsets: iPhoneSafeArea });
        await assertNoHorizontalOverflow(page, target, { label });
    }
}

async function readDatabaseState(cli: string, session: ObsidianLiveSyncSession) {
    return await evalObsidianJson<{ sequence: unknown; settings: string; names: string[] }>(
        cli,
        "(async()=>{const core=app.plugins.plugins['obsidian-livesync'].core;return JSON.stringify({sequence:(await core.localDatabase.localDatabase.info()).update_seq,settings:JSON.stringify(core.services.setting.currentSettings()),names:app.vault.getFiles().map(f=>f.path).sort()});})()",
        session.cliEnv
    );
}

async function installDiagnosticExportInterception(page: Page): Promise<void> {
    await page.evaluate(`(() => {
        globalThis.diagnosticClipboard = undefined;
        globalThis.diagnosticDownload = undefined;
        Object.defineProperty(navigator.clipboard, "writeText", {
            configurable: true,
            value: async (text) => { globalThis.diagnosticClipboard = text; },
        });
        if (!globalThis.databaseDiagnosticExportInterceptionInstalled) {
            document.addEventListener("click", (event) => {
                const link = event.target;
                if (!(link instanceof HTMLAnchorElement) || !link.download || !link.href.startsWith("blob:")) return;
                event.preventDefault();
                void fetch(link.href).then((response) => response.text()).then((content) => {
                    globalThis.diagnosticDownload = { name: link.download, content };
                });
            }, true);
            globalThis.databaseDiagnosticExportInterceptionInstalled = true;
        }
    })()`);
}

async function restoreDiagnosticReadGate(cli: string, session: ObsidianLiveSyncSession): Promise<void> {
    await evalObsidianJson(
        cli,
        `(async()=>{const gate=globalThis.databaseDiagnosticReadGate;if(gate){gate.release();const db=app.plugins.plugins['obsidian-livesync'].core.localDatabase.localDatabase;db.get=gate.originalGet;delete globalThis.databaseDiagnosticReadGate;}return JSON.stringify(true);})()`,
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
            artifactRoot: process.env.E2E_OBSIDIAN_ARTIFACT_ROOT?.trim() || undefined,
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
        let usageFixtureRow: { path: string; id: string; revision: string } | undefined;
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const choice = await openCommand(page, "usage");
            await choice.getByRole("radio", { name: "Pseudonyms (recommended)", exact: true }).focus();
            await page.keyboard.press("ArrowRight");
            assert.equal(await choice.getByRole("radio", { name: "Original names", exact: true }).isChecked(), true);
            await page.keyboard.press("ArrowLeft");
            assert.equal(
                await choice.getByRole("radio", { name: "Pseudonyms (recommended)", exact: true }).isChecked(),
                true
            );
            await choice.getByRole("button", { name: "Cancel", exact: true }).click();
            await choice.waitFor({ state: "hidden", timeout });
            const dialogue = await openCommand(page, "usage");
            assert.equal(
                await dialogue.getByRole("radio", { name: "Pseudonyms (recommended)", exact: true }).isChecked(),
                true
            );
            await dialogue.getByRole("button", { name: "Begin inspection", exact: true }).click();
            await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
            await assertFormatChoices(dialogue, ["TSV", "JSON"]);
            assert.equal(await dialogue.getByRole("radio", { name: "TSV", exact: true }).isChecked(), true);
            const tsv = await dialogue.locator("textarea").inputValue();
            assert.equal(tsv.split("\n")[0].split("\t").length, 9);
            assert.ok(!tsv.includes(fixturePath));
            assert.ok(!tsv.includes(shadowId));
            assert.ok(!tsv.includes(fixtureContent.trim()));
            await dialogue.getByRole("radio", { name: "TSV", exact: true }).focus();
            await page.keyboard.press("ArrowRight");
            assert.equal(await dialogue.getByRole("radio", { name: "JSON", exact: true }).isChecked(), true);
            usageJSON = await dialogue.locator("textarea").inputValue();
            const report = JSON.parse(usageJSON);
            assert.equal(report.status, "complete");
            assert.ok(report.versions.commonlib);
            assert.ok(report.rows.some((row: { path: string }) => row.path.startsWith("file-")));
            const fixtureRow = report.rows.find((row: { path: string; id: string; revision: string }) =>
                row.path.startsWith("file-")
            );
            assert.ok(fixtureRow);
            usageFixtureRow = { path: fixtureRow.path, id: fixtureRow.id, revision: fixtureRow.revision };

            // Capture exports inside the isolated renderer without changing the
            // host clipboard or leaving downloads in a user's download directory.
            await installDiagnosticExportInterception(page);
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
            await original.getByRole("radio", { name: "Original names", exact: true }).check();
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
            assert.equal(
                await integrity.getByRole("radio", { name: "Pseudonyms (recommended)", exact: true }).isChecked(),
                true
            );
            await integrity.getByRole("button", { name: "Begin inspection", exact: true }).click();
            await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
            await assertFormatChoices(integrity, ["MARKDOWN", "JSON"]);
            assert.equal(await integrity.getByRole("radio", { name: "MARKDOWN", exact: true }).isChecked(), true);
            await chooseFormat(integrity, "json");
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
        const cancellationOrder = await evalObsidianJson<{ fixtureId: string; orderedIds: string[] }>(
            cli,
            `(async()=>{const core=app.plugins.plugins['obsidian-livesync'].core;const db=core.localDatabase.localDatabase;return JSON.stringify({fixtureId:await core.services.path.path2id(${JSON.stringify(fixturePath)}),orderedIds:(await db.allDocs({include_docs:false})).rows.map(row=>row.id)});})()`,
            session.cliEnv
        );
        const fixturePosition = cancellationOrder.orderedIds.indexOf(cancellationOrder.fixtureId);
        const gatePosition = cancellationOrder.orderedIds.indexOf(shadowId);
        assert.ok(fixturePosition >= 0, "The cancellation fixture must exist in the local database");
        assert.ok(gatePosition >= 0, "The cancellation read gate must exist in the local database");
        assert.ok(fixturePosition < gatePosition, "The cancellation read gate must follow the report fixture");
        assert.ok(usageFixtureRow, "The complete report must contain the cancellation fixture");
        const expectedFixtureRow = usageFixtureRow;
        const cancellationEnv = session.cliEnv;

        try {
            await evalObsidianJson(
                cli,
                `(async()=>{const db=app.plugins.plugins['obsidian-livesync'].core.localDatabase.localDatabase;const gate={reached:false,release:null,releasePromise:null,originalGet:db.get};gate.releasePromise=new Promise(resolve=>{gate.release=resolve;});globalThis.databaseDiagnosticReadGate=gate;db.get=async function(id,options){if(id===${JSON.stringify(shadowId)}&&options?.rev&&!gate.reached){gate.reached=true;await gate.releasePromise;}return await gate.originalGet.call(this,id,options);};return JSON.stringify(true);})()`,
                session.cliEnv
            );
            await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                const dialogue = await openCommand(page, "usage");
                await dialogue.getByRole("button", { name: "Begin inspection", exact: true }).click();
                await page.waitForFunction(
                    () => (globalThis as DiagnosticPageGlobal).databaseDiagnosticReadGate?.reached === true,
                    undefined,
                    { timeout }
                );
                assert.equal(await dialogue.getAttribute("data-diagnostic-phase"), "running");
                await dialogue.getByRole("button", { name: "Cancel inspection", exact: true }).click();
                await dialogue.getByText("Cancelling inspection…", { exact: true }).waitFor({ timeout });
                await evalObsidianJson(
                    cli,
                    `(async()=>{globalThis.databaseDiagnosticReadGate?.release();return JSON.stringify(true);})()`,
                    cancellationEnv
                );
                await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
                const cancelledText = await dialogue.locator("textarea").inputValue();
                const cancelledReport = JSON.parse(cancelledText);
                assert.equal(cancelledReport.status, "cancelled");
                await assertFormatChoices(dialogue, ["JSON"]);
                assert.ok(
                    cancelledReport.rows.some(
                        (row: { path: string; id: string; revision: string }) =>
                            row.path === expectedFixtureRow.path &&
                            row.id === expectedFixtureRow.id &&
                            row.revision === expectedFixtureRow.revision
                    ),
                    "Cancellation must retain report rows collected before the gated database read"
                );
                for (const privateValue of [fixturePath, shadowId, fixtureContent.trim()])
                    assert.ok(!cancelledText.includes(privateValue));
                await dialogue.getByRole("button", { name: "Close", exact: true }).click();
                await dialogue.waitFor({ state: "hidden", timeout });
            });
        } finally {
            await restoreDiagnosticReadGate(cli, session);
        }
        const after = await readDatabaseState(cli, session);
        assert.deepEqual(
            after,
            before,
            "Diagnostics, including cancellation, must leave settings, revisions, and Vault files unchanged"
        );

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
            await assertMobileRadioTargets(page, modal, "Names in this report");
            await modal.getByRole("button", { name: "Cancel", exact: true }).click();
            await modal.waitFor({ state: "hidden", timeout });
        });
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const dialogue = await openCommand(page, "usage");
            await dialogue.getByRole("button", { name: "Begin inspection", exact: true }).click();
            await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
            const modal = page.locator(".modal-container").filter({ has: page.locator(".database-diagnostic") });
            await assertMobileDialogueLayout(page, modal, "Database diagnostic result");

            await assertFormatChoices(dialogue, ["TSV", "JSON"]);
            await assertMobileRadioTargets(page, dialogue, "Report format");
            await chooseFormat(dialogue, "json");
            const reportText = await dialogue.locator("textarea").inputValue();
            const report = JSON.parse(reportText);
            assert.equal(report.status, "complete");
            for (const privateValue of [fixturePath, shadowId, fixtureContent.trim()])
                assert.ok(!reportText.includes(privateValue));
            await chooseFormat(dialogue, "tsv");
            const tsv = await dialogue.locator("textarea").inputValue();
            assert.equal(tsv.split("\n")[0].split("\t").length, 9);
            assert.ok(!tsv.includes(fixturePath));
            assert.ok(!tsv.includes(shadowId));
            assert.ok(!tsv.includes(fixtureContent.trim()));
            await chooseFormat(dialogue, "json");
        });
        const mobileResultScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "database-diagnostics-mobile-result.png",
            (page) => page.locator(".modal-container").filter({ has: page.locator(".database-diagnostic") })
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const dialogue = page.locator(".database-diagnostic");
            await installDiagnosticExportInterception(page);
            const reportText = await dialogue.locator("textarea").inputValue();
            await dialogue.getByRole("button", { name: "Copy report", exact: true }).click();
            await dialogue.getByText("Report copied.", { exact: true }).waitFor({ timeout });
            const modal = page.locator(".modal-container").filter({ has: page.locator(".database-diagnostic") });
            await assertMobileDialogueLayout(page, modal, "Database diagnostic copied result");
            assert.equal(
                await page.evaluate(() => (globalThis as DiagnosticPageGlobal).diagnosticClipboard),
                reportText
            );
            await dialogue.getByRole("button", { name: "Save report", exact: true }).click();
            await page.waitForFunction(() => !!(globalThis as DiagnosticPageGlobal).diagnosticDownload, undefined, {
                timeout,
            });
            assert.deepEqual(await page.evaluate(() => (globalThis as DiagnosticPageGlobal).diagnosticDownload), {
                name: "database-usage-complete.json",
                content: reportText,
            });
            await assertMobileDialogueLayout(page, modal, "Database diagnostic saved result");
            await dialogue.getByRole("button", { name: "Close", exact: true }).click();
            await dialogue.waitFor({ state: "hidden", timeout });
        });
        console.log(
            JSON.stringify({
                status: "passed",
                desktopScreenshot,
                mobileScreenshot,
                mobileResultScreenshot,
                readOnly: true,
            })
        );
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
