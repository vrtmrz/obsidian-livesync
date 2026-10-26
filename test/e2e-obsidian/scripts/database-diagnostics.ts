import assert from "node:assert/strict";
import type { Locator, Page } from "playwright";
import {
    assertLocatorHasMinimumTouchTarget,
    assertLocatorWithinSafeArea,
    assertNoHorizontalOverflow,
} from "@vrtmrz/obsidian-test-session";
import { DoctorRegulation } from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import { createDiagnosticNameMapper, parseDiagnosticPathToken } from "@vrtmrz/livesync-commonlib/diagnostics";
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

async function findVisibleElement(page: Page, selector: string): Promise<Locator> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const candidate of page.context().pages()) {
            const element = candidate.locator(selector);
            if (await element.isVisible()) return element;
        }
        await page.waitForTimeout(50);
    }
    throw new Error(`No Obsidian renderer contains the visible element: ${selector}`);
}

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
    const remoteChoice = dialogue.getByRole("checkbox", { name: "Include remote database", exact: true });
    if (kind === "integrity") {
        assert.equal(await remoteChoice.count(), 1);
        assert.equal(await remoteChoice.isChecked(), true, "The remote database must be included by default");
    } else assert.equal(await remoteChoice.count(), 0, "Usage analysis has no remote database option");
    assert.equal(await dialogue.getAttribute("data-diagnostic-phase"), "choice");
    assert.equal(await dialogue.locator("textarea").count(), 0);
    return dialogue;
}

async function assertDesktopDiagnosticChoiceLayout(page: Page, dialogue: Locator): Promise<void> {
    const modal = page.locator(".modal-container").filter({ has: dialogue }).locator(".modal");
    const layout = await modal.evaluate((element) => {
        const modalBounds = element.getBoundingClientRect();
        const choice = element.querySelector<HTMLElement>(".diagnostic-remote-choice");
        if (!choice) return { contained: false, outerScroll: Math.max(0, element.scrollHeight - element.clientHeight) };
        const choiceBounds = choice.getBoundingClientRect();
        return {
            contained: choiceBounds.top >= modalBounds.top - 1 && choiceBounds.bottom <= modalBounds.bottom + 1,
            outerScroll: Math.max(0, element.scrollHeight - element.clientHeight),
        };
    });
    assert.equal(layout.contained, true, "The remote database option must remain inside the desktop modal");
    assert.ok(
        layout.outerScroll <= 1,
        `The diagnostic choice must not need outer scrolling; got ${layout.outerScroll}px`
    );
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

async function assertDiagnosticExportActionsWithinModal(page: Page, dialogue: Locator, action: string): Promise<void> {
    for (const name of ["Copy report", "Save report"]) {
        const button = dialogue.getByRole("button", { name, exact: true });
        assert.equal(await button.isVisible(), true, `${name} must remain visible after ${action}`);
        const contained = await button.evaluate((element) => {
            const modalElement = element.closest<HTMLElement>(".modal");
            if (!modalElement || !modalElement.contains(element)) return false;
            const buttonBounds = element.getBoundingClientRect();
            const modalBounds = modalElement.getBoundingClientRect();
            return buttonBounds.top >= modalBounds.top - 1 && buttonBounds.bottom <= modalBounds.bottom + 1;
        });
        assert.equal(contained, true, `${name} must remain inside the modal after ${action}`);
    }
}

async function assertDesktopDiagnosticResultLayout(page: Page, dialogue: Locator, action: string): Promise<void> {
    const modal = page.locator(".modal-container").filter({ has: dialogue }).locator(".modal");
    const outerScroll = await modal.evaluate((element) => Math.max(0, element.scrollHeight - element.clientHeight));
    assert.ok(
        outerScroll <= 1,
        `The diagnostic modal must not need outer scrolling after ${action}; got ${outerScroll}px`
    );
    await assertDiagnosticExportActionsWithinModal(page, dialogue, action);
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
        `(async()=>{const gate=globalThis.databaseDiagnosticReadGate;if(gate){gate.release();if(gate.reached&&gate.drainPromise)await gate.drainPromise;const db=app.plugins.plugins['obsidian-livesync'].core.localDatabase.localDatabase;db.get=gate.originalGet;delete globalThis.databaseDiagnosticReadGate;}return JSON.stringify(true);})()`,
        session.cliEnv
    );
}

async function installDiagnosticReadGate(
    cli: string,
    session: ObsidianLiveSyncSession,
    documentId: string,
    readKind: "metadata" | "revision"
): Promise<void> {
    const condition = readKind === "metadata" ? "options?.conflicts" : "options?.rev";
    await evalObsidianJson(
        cli,
        `(async()=>{const db=app.plugins.plugins['obsidian-livesync'].core.localDatabase.localDatabase;const gate={reached:false,release:null,releasePromise:null,drain:null,drainPromise:null,originalGet:db.get};gate.releasePromise=new Promise(resolve=>{gate.release=resolve;});gate.drainPromise=new Promise(resolve=>{gate.drain=resolve;});globalThis.databaseDiagnosticReadGate=gate;db.get=async function(id,options){if(id===${JSON.stringify(documentId)}&&${condition}&&!gate.reached){gate.reached=true;try{await gate.releasePromise;return await gate.originalGet.call(this,id,options);}finally{gate.drain();}}return await gate.originalGet.call(this,id,options);};return JSON.stringify(true);})()`,
        session.cliEnv
    );
}

async function assertIntegrityProgress(dialogue: Locator): Promise<void> {
    const progress = dialogue.locator(".diagnostic-progress");
    await progress.getByText("Metadata · local", { exact: true }).waitFor({ state: "visible", timeout });
    const progressBar = progress.getByRole("progressbar");
    assert.equal(await progressBar.count(), 1, "Metadata inspection must expose a progressbar");
    assert.equal(await progressBar.isVisible(), true);
    const numericText = progress.getByText(/^[1-9]\d* \/ \d+ documents?$/);
    await numericText.waitFor({ state: "visible", timeout });
    const numeric = await numericText.innerText();
    const match = /^(\d+) \/ (\d+) documents?$/.exec(numeric);
    assert.ok(match, `Metadata progress must report its document count; got ${numeric}`);
    const [, processedText, totalText] = match;
    const processed = Number(processedText);
    const total = Number(totalText);
    assert.ok(processed > 0, `Metadata progress must report a positive processed count; got ${numeric}`);
    assert.ok(total >= processed, `Metadata progress must report its total; got ${numeric}`);
}

async function assertHatchReportingGroups(hatch: Locator): Promise<void> {
    const reportingHeading = hatch.getByRole("heading", { name: "Reporting Tools", exact: true });
    const checksHeading = hatch.getByRole("heading", { name: "Checks and Recovery", exact: true });
    assert.equal(await reportingHeading.count(), 1);
    assert.equal(await checksHeading.count(), 1);
    const reportingPanel = reportingHeading.locator("..");
    const checksPanel = checksHeading.locator("..");
    const reportingNames = [
        "Prepare the 'report' to create an issue",
        "Copy database information for a file",
        "Find a file from a report pseudonym",
        "Inspect database integrity",
        "Analyse database usage",
    ];
    assert.equal(await reportingPanel.locator(".setting-item").count(), reportingNames.length);
    for (const name of reportingNames) {
        assert.equal(
            await reportingPanel.getByText(name, { exact: true }).count(),
            1,
            `${name} belongs in Reporting Tools`
        );
        assert.equal(
            await checksPanel.getByText(name, { exact: true }).count(),
            0,
            `${name} must remain outside Checks and Recovery`
        );
    }
    assert.equal(await checksPanel.locator(".setting-item").count(), 2);
    for (const name of ["Run Doctor", "Scan for Broken files"]) {
        const button = checksPanel.getByRole("button", { name, exact: true });
        assert.equal(await button.count(), 1, `${name} belongs in Checks and Recovery`);
        assert.equal(await reportingPanel.getByRole("button", { name, exact: true }).count(), 0);
    }
}

async function assertDiagnosticFileLookup(
    page: Page,
    hatch: Locator,
    token: string,
    shadowRevision: string,
    session: ObsidianLiveSyncSession,
    mobile = false
): Promise<void> {
    const dialoguePage = hatch.page();
    const viewport = page.viewportSize();
    if (viewport) await dialoguePage.setViewportSize(viewport);
    const setting = hatch.locator(".setting-item").filter({
        has: hatch.page().getByText("Find a file from a report pseudonym", { exact: true }),
    });
    await setting.getByRole("button", { name: "Find file", exact: true }).click();
    const dialogue = dialoguePage.locator(".diagnostic-file-lookup");
    await dialogue.waitFor({ state: "visible", timeout });
    const input = dialogue.getByLabel("Report path pseudonym", { exact: true });
    await input.fill("file-001");
    await dialogue.getByRole("button", { name: "Find file", exact: true }).click();
    await dialogue.getByText("Enter a valid report path pseudonym.", { exact: true }).waitFor({ timeout });
    await input.fill(token);
    await dialogue.getByRole("button", { name: "Find file", exact: true }).click();
    const candidates = dialogue.locator("[data-diagnostic-candidate]");
    await candidates.first().waitFor({ timeout });
    assert.equal(await candidates.count(), 2, "Distinct Metadata IDs claiming the same path must remain selectable");
    if (mobile) {
        await assertNoHorizontalOverflow(dialoguePage, dialogue, { label: "Pseudonym file lookup matches" });
        await assertNoHorizontalOverflow(dialoguePage, dialogue.locator(".lookup-candidates"), {
            label: "Pseudonym file lookup candidate list",
        });
        assert.ok(
            (await dialogue.locator(".lookup-candidates").evaluate((element) => element.clientHeight)) >= 160,
            "The mobile lookup must leave enough room to read the matching file details"
        );
        await captureObsidianElement(
            session.remoteDebuggingPort,
            "database-diagnostics-file-matches-mobile.png",
            (page) => findVisibleElement(page, ".modal-container:has(.diagnostic-file-lookup)")
        );
    }
    const shadow = candidates.filter({ hasText: shadowId });
    assert.equal(await shadow.count(), 1);
    assert.ok((await shadow.textContent())?.includes(fixturePath));
    await shadow.getByRole("button", { name: "Open file", exact: true }).click();
    await page.waitForFunction(`app.workspace.getActiveFile()?.path === ${JSON.stringify(fixturePath)}`, undefined, {
        timeout,
    });
    await shadow.getByRole("button", { name: "Prepare follow-up report", exact: true }).click();
    await dialogue.locator("textarea").waitFor({ timeout });
    const json = await dialogue.locator("textarea").inputValue();
    const report = JSON.parse(json);
    const parsed = parseDiagnosticPathToken(token);
    assert.ok(parsed);
    const mapper = createDiagnosticNameMapper("pseudonym", parsed.salt);
    assert.equal(report.file.path, token);
    assert.equal(report.file.database.documentId, mapper.id(shadowId));
    assert.equal(report.file.database.currentRevision, mapper.revision(shadowRevision));
    assert.equal(report.file.database.remoteQueried, false);
    for (const privateValue of [fixturePath, shadowId, fixtureContent.trim()]) {
        assert.ok(!json.includes(privateValue), "A follow-up report must preserve the original report's pseudonyms");
    }
    await installDiagnosticExportInterception(dialoguePage);
    await dialogue.getByRole("button", { name: "Copy report", exact: true }).click();
    assert.equal(await dialoguePage.evaluate(() => (globalThis as DiagnosticPageGlobal).diagnosticClipboard), json);
    await dialogue.getByRole("button", { name: "Save report", exact: true }).click();
    await dialoguePage.waitForFunction(() => !!(globalThis as DiagnosticPageGlobal).diagnosticDownload, undefined, {
        timeout,
    });
    assert.deepEqual(await dialoguePage.evaluate(() => (globalThis as DiagnosticPageGlobal).diagnosticDownload), {
        name: "diagnostic-file-report.json",
        content: json,
    });
    await assertDesktopDiagnosticResultLayout(dialoguePage, dialogue, "saving a follow-up report");
    if (mobile) {
        const modal = dialoguePage.locator(".modal-container").filter({ has: dialogue });
        await assertMobileDialogueLayout(dialoguePage, modal, "Pseudonym file follow-up report");
        await assertNoHorizontalOverflow(dialoguePage, dialogue, { label: "Pseudonym file follow-up content" });
        await assertNoHorizontalOverflow(dialoguePage, dialogue.locator(".report-token"), {
            label: "Pseudonym file follow-up token",
        });
    }
    await captureObsidianElement(
        session.remoteDebuggingPort,
        mobile ? "database-diagnostics-file-follow-up-mobile.png" : "database-diagnostics-file-follow-up.png",
        (page) => findVisibleElement(page, ".modal-container:has(.diagnostic-file-lookup)")
    );
    await dialogue.getByRole("radio", { name: "MARKDOWN", exact: true }).check();
    const markdown = await dialogue.locator("textarea").inputValue();
    assert.ok(markdown.startsWith("<details>\n"));
    assert.ok(markdown.includes(json));
    await dialogue.getByRole("button", { name: "Back to matches", exact: true }).click();
    await candidates.first().waitFor({ timeout });
    await input.fill(createDiagnosticNameMapper("pseudonym", parsed.salt).path("not-present.md"));
    await dialogue.getByRole("button", { name: "Find file", exact: true }).click();
    await dialogue.getByText(/No matches were found in current Vault paths/).waitFor({ timeout });
    assert.equal(await candidates.count(), 0);
    await dialogue.getByRole("button", { name: "Close", exact: true }).click();
    await dialogue.waitFor({ state: "hidden", timeout });
}

async function assertFollowUpStopsAfterClose(page: Page, hatch: Locator, token: string): Promise<void> {
    await page.evaluate(`(() => {
        const core = app.plugins.plugins['obsidian-livesync'].core;
        const db = core.localDatabase.localDatabase;
        const manager = core.services.UI.dialogManager;
        const gate = {
            reached: false, metadataReads: 0, chunkQueries: 0, outcome: null,
            originalGet: db.get, originalAllDocsRaw: core.localDatabase.allDocsRaw,
            originalOpen: manager.open,
        };
        gate.releasePromise = new Promise(resolve => { gate.release = resolve; });
        gate.settledPromise = new Promise(resolve => { gate.settle = resolve; });
        db.get = async function(id, options) {
            if (id === ${JSON.stringify(shadowId)} && options?.conflicts) {
                gate.metadataReads++;
                if (!gate.reached) {
                    gate.reached = true;
                    await gate.releasePromise;
                }
            }
            return await gate.originalGet.call(this, id, options);
        };
        core.localDatabase.allDocsRaw = async function(...args) {
            if (gate.reached) gate.chunkQueries++;
            return await gate.originalAllDocsRaw.apply(this, args);
        };
        manager.open = function(component, options, ...args) {
            if (typeof options?.prepareReport === 'function') {
                const prepare = options.prepareReport;
                options.prepareReport = async (...reportArgs) => {
                    try {
                        const result = await prepare(...reportArgs);
                        gate.outcome = 'completed';
                        return result;
                    } catch (error) {
                        gate.outcome = error.name;
                        throw error;
                    } finally {
                        gate.settle();
                    }
                };
            }
            return gate.originalOpen.call(this, component, options, ...args);
        };
        globalThis.diagnosticFollowUpCloseGate = gate;
    })()`);
    try {
        const setting = hatch.locator(".setting-item").filter({
            has: hatch.page().getByText("Find a file from a report pseudonym", { exact: true }),
        });
        await setting.getByRole("button", { name: "Find file", exact: true }).click();
        const dialogue = hatch.page().locator(".diagnostic-file-lookup");
        await dialogue.getByLabel("Report path pseudonym", { exact: true }).fill(token);
        await dialogue.getByRole("button", { name: "Find file", exact: true }).click();
        const candidate = dialogue.locator("[data-diagnostic-candidate]").filter({ hasText: shadowId });
        await candidate.getByRole("button", { name: "Prepare follow-up report", exact: true }).click();
        await page.waitForFunction("globalThis.diagnosticFollowUpCloseGate.reached", undefined, { timeout });
        await dialogue.getByRole("button", { name: "Close", exact: true }).click();
        await dialogue.waitFor({ state: "hidden", timeout });
        const result = await page.evaluate(`(async () => {
            const gate = globalThis.diagnosticFollowUpCloseGate;
            gate.release();
            await gate.settledPromise;
            return { outcome: gate.outcome, metadataReads: gate.metadataReads, chunkQueries: gate.chunkQueries };
        })()`);
        assert.deepEqual(
            result,
            { outcome: "AbortError", metadataReads: 1, chunkQueries: 0 },
            "Closing a pending follow-up must stop inspection after the active Metadata read settles"
        );
    } finally {
        await page.evaluate(`(() => {
            const gate = globalThis.diagnosticFollowUpCloseGate;
            const core = app.plugins.plugins['obsidian-livesync'].core;
            gate.release();
            core.localDatabase.localDatabase.get = gate.originalGet;
            core.localDatabase.allDocsRaw = gate.originalAllDocsRaw;
            core.services.UI.dialogManager.open = gate.originalOpen;
            delete globalThis.diagnosticFollowUpCloseGate;
        })()`);
    }
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
        const rawFixture = await evalObsidianJson<{ id: string; revision: string; shadowRevision: string }>(
            cli,
            `(async()=>{const core=app.plugins.plugins['obsidian-livesync'].core;await core.services.fileProcessing.commitPendingFileEvents();const db=core.localDatabase.localDatabase;const id=await core.services.path.path2id(${JSON.stringify(fixturePath)});const original=await db.get(id);const shadow={...original,_id:${JSON.stringify(shadowId)}};delete shadow._rev;const stored=await db.put(shadow);return JSON.stringify({id,revision:original._rev,shadowRevision:stored.rev});})()`,
            session.cliEnv
        );
        const before = await readDatabaseState(cli, session);
        const activeSession = session;
        let usageJSON = "";
        let usageFixtureRow: { path: string; id: string; revision: string } | undefined;
        const desktopScreenshot = await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.setViewportSize({ width: 800, height: 600 });
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
            await assertDesktopDiagnosticResultLayout(page, dialogue, "the result appearing");
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
            const token = report.rows.find((row: { path: string }) => parseDiagnosticPathToken(row.path))?.path;
            const parsedToken = parseDiagnosticPathToken(token ?? "");
            assert.ok(parsedToken, "The report must contain searchable salted path pseudonyms");
            const mapper = createDiagnosticNameMapper("pseudonym", parsedToken.salt);
            const fixtureRow = report.rows.find(
                (row: { path: string; id: string; revision: string }) => row.id === mapper.id(rawFixture.id)
            );
            assert.ok(fixtureRow);
            assert.equal(fixtureRow.path, mapper.path(fixturePath));
            assert.equal(fixtureRow.revision, mapper.revision(rawFixture.revision));
            assert.equal(fixtureRow.revision, `${fixtureRow.rev}-${fixtureRow.revHash}`);
            usageFixtureRow = { path: fixtureRow.path, id: fixtureRow.id, revision: fixtureRow.revision };

            // Capture exports inside the isolated renderer without changing the
            // host clipboard or leaving downloads in a user's download directory.
            await installDiagnosticExportInterception(page);
            await dialogue.getByRole("button", { name: "Copy report", exact: true }).click();
            await assertDesktopDiagnosticResultLayout(page, dialogue, "copying the report");
            assert.equal(
                await page.evaluate(() => (globalThis as DiagnosticPageGlobal).diagnosticClipboard),
                usageJSON
            );
            await dialogue.getByRole("button", { name: "Save report", exact: true }).click();
            await page.waitForFunction(() => !!(globalThis as DiagnosticPageGlobal).diagnosticDownload, undefined, {
                timeout,
            });
            await assertDesktopDiagnosticResultLayout(page, dialogue, "saving the report");
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
            let hatch = await settingsNavigator.openPage("Hatch");
            await assertHatchReportingGroups(hatch);
            assert.ok(usageFixtureRow);
            await assertDiagnosticFileLookup(
                page,
                hatch,
                usageFixtureRow.path,
                rawFixture.shadowRevision,
                activeSession
            );
            hatch = await (await openLiveSyncSettings(page, timeout)).openPage("Hatch");
            await assertFollowUpStopsAfterClose(page, hatch, usageFixtureRow.path);
            await captureObsidianElement(activeSession.remoteDebuggingPort, "database-diagnostics-hatch.png", (page) =>
                findVisibleElement(page, ".modal.mod-settings")
            );
            const setting = hatch
                .locator(".setting-item")
                .filter({ has: hatch.page().getByText("Inspect database integrity", { exact: true }) });
            await setting.getByRole("button", { name: "Inspect", exact: true }).click();
            const progressDialogue = await findVisibleElement(page, ".database-diagnostic");
            const progressPage = progressDialogue.page();
            await progressPage.setViewportSize({ width: 800, height: 600 });
            assert.equal(
                await progressDialogue
                    .getByRole("radio", { name: "Pseudonyms (recommended)", exact: true })
                    .isChecked(),
                true
            );
            assert.equal(
                await progressDialogue
                    .getByRole("checkbox", { name: "Include remote database", exact: true })
                    .isChecked(),
                true
            );
            await assertDesktopDiagnosticChoiceLayout(progressPage, progressDialogue);
            await installDiagnosticReadGate(cli, activeSession, shadowId, "metadata");
            try {
                await progressDialogue.getByRole("button", { name: "Begin inspection", exact: true }).click();
                await page.waitForFunction(
                    () => (globalThis as DiagnosticPageGlobal).databaseDiagnosticReadGate?.reached === true,
                    undefined,
                    { timeout }
                );
                assert.equal(await progressDialogue.getAttribute("data-diagnostic-phase"), "running");
                await assertIntegrityProgress(progressDialogue);
                await captureObsidianElement(
                    activeSession.remoteDebuggingPort,
                    "database-diagnostics-progress.png",
                    (page) => findVisibleElement(page, ".modal-container:has(.database-diagnostic)")
                );
                await progressDialogue.getByRole("button", { name: "Cancel inspection", exact: true }).click();
                await evalObsidianJson(
                    cli,
                    `(async()=>{globalThis.databaseDiagnosticReadGate?.release();return JSON.stringify(true);})()`,
                    activeSession.cliEnv
                );
                await progressPage.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
                await assertFormatChoices(progressDialogue, ["MARKDOWN", "JSON"]);
                await chooseFormat(progressDialogue, "json");
                assert.equal(JSON.parse(await progressDialogue.locator("textarea").inputValue()).status, "cancelled");
                await progressDialogue.getByRole("button", { name: "Close", exact: true }).click();
                await progressDialogue.waitFor({ state: "hidden", timeout });
            } finally {
                await restoreDiagnosticReadGate(cli, activeSession);
            }

            await setting.getByRole("button", { name: "Inspect", exact: true }).click();
            const integrity = await findVisibleElement(page, ".database-diagnostic");
            const integrityPage = integrity.page();
            assert.equal(
                await integrity.getByRole("radio", { name: "Pseudonyms (recommended)", exact: true }).isChecked(),
                true
            );
            await integrity.getByRole("button", { name: "Begin inspection", exact: true }).click();
            await integrityPage.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
            await assertFormatChoices(integrity, ["MARKDOWN", "JSON"]);
            assert.equal(await integrity.getByRole("radio", { name: "MARKDOWN", exact: true }).isChecked(), true);
            const markdownReport = await integrity.locator("textarea").inputValue();
            const markdownDetailsWithCodeBlock =
                /<details>\s*<summary>Database integrity report \(partial\)<\/summary>\s*(`{3,})text\r?\n[\s\S]*?\1\s*<\/details>/;
            assert.match(markdownReport, markdownDetailsWithCodeBlock);
            await installDiagnosticExportInterception(integrityPage);
            await integrity.getByRole("button", { name: "Copy report", exact: true }).click();
            assert.equal(
                await integrityPage.evaluate(() => (globalThis as DiagnosticPageGlobal).diagnosticClipboard),
                markdownReport
            );
            await integrity.getByRole("button", { name: "Save report", exact: true }).click();
            await integrityPage.waitForFunction(
                () => !!(globalThis as DiagnosticPageGlobal).diagnosticDownload,
                undefined,
                {
                    timeout,
                }
            );
            assert.deepEqual(
                await integrityPage.evaluate(() => (globalThis as DiagnosticPageGlobal).diagnosticDownload),
                {
                    name: "database-integrity-partial.md",
                    content: markdownReport,
                }
            );
            await chooseFormat(integrity, "json");
            const reportText = await integrity.locator("textarea").inputValue();
            const integrityReport = JSON.parse(reportText);
            assert.equal(integrityReport.status, "partial");
            assert.ok(markdownReport.includes("## Reading the findings"));
            assert.ok(markdownReport.includes("## State counts"));
            assert.ok(markdownReport.includes("## Review index"));
            assert.ok(markdownReport.includes("chunks=total/unique/embedded"));
            assert.equal(markdownReport.match(/^### /gm)?.length, integrityReport.observations.length);
            for (const observation of integrityReport.observations) {
                assert.ok(markdownReport.includes(`### \`${observation.reference}\` source=${observation.source}`));
                assert.ok(markdownReport.includes(`path: \`${observation.path}\``));
                assert.ok(markdownReport.includes(`doc: \`${observation.id}\``));
                if (observation.revision !== undefined)
                    assert.ok(markdownReport.includes(`rev=\`${observation.revision}\``));
            }
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
            const screenshot = await captureObsidianElement(
                activeSession.remoteDebuggingPort,
                "database-diagnostics-desktop.png",
                (page) => findVisibleElement(page, ".modal-container:has(.database-diagnostic)")
            );
            await integrity.getByRole("button", { name: "Close", exact: true }).click();
            await integrity.waitFor({ state: "hidden", timeout });
            await settingsNavigator.close();
            return screenshot;
        });
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const localOnly = await openCommand(page, "integrity");
            await localOnly.getByRole("checkbox", { name: "Include remote database", exact: true }).uncheck();
            await localOnly.getByRole("button", { name: "Begin inspection", exact: true }).click();
            await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
            await chooseFormat(localOnly, "json");
            const report = JSON.parse(await localOnly.locator("textarea").inputValue());
            assert.equal(report.status, "complete");
            assert.equal(report.scope.remote, "excluded");
            assert.equal(report.coverage.remote.status, "not-checked");
            assert.deepEqual(report.errors, []);
            assert.ok(
                report.observations.some(
                    (row: { identity: string; vault: { status: string }; comparisons: { relation: string }[] }) =>
                        row.identity === "document-id-mismatch" &&
                        row.vault.status === "available" &&
                        row.comparisons.some((comparison) => comparison.relation === "equal")
                ),
                "Local discrepancies must retain Vault comparisons when the remote is excluded"
            );
            await localOnly.getByRole("button", { name: "Close", exact: true }).click();
            await localOnly.waitFor({ state: "hidden", timeout });
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
        const cancellationEnv = session.cliEnv;

        try {
            await installDiagnosticReadGate(cli, session, shadowId, "revision");
            await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                const dialogue = await openCommand(page, "usage");
                await dialogue.getByRole("button", { name: "Begin inspection", exact: true }).click();
                await page.waitForFunction(
                    () => (globalThis as DiagnosticPageGlobal).databaseDiagnosticReadGate?.reached === true,
                    undefined,
                    { timeout }
                );
                assert.equal(await dialogue.getAttribute("data-diagnostic-phase"), "running");
                const usageProgress = dialogue.locator(".diagnostic-progress");
                await usageProgress.getByText("Reading revisions", { exact: true }).waitFor({ timeout });
                await usageProgress.getByText(/^\d+ \/ \d+ revisions$/).waitFor({ timeout });
                await usageProgress.getByText(/Discovering revisions/).waitFor({ timeout });
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
                const cancelledToken = cancelledReport.rows.find((row: { path: string }) =>
                    parseDiagnosticPathToken(row.path)
                )?.path;
                const parsedToken = parseDiagnosticPathToken(cancelledToken ?? "");
                assert.ok(parsedToken);
                const mapper = createDiagnosticNameMapper("pseudonym", parsedToken.salt);
                assert.ok(
                    cancelledReport.rows.some(
                        (row: { path: string; id: string; revision: string }) =>
                            row.path === mapper.path(fixturePath) &&
                            row.id === mapper.id(rawFixture.id) &&
                            row.revision === mapper.revision(rawFixture.revision)
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
            await page.setViewportSize({ width: 375, height: 667 });
            await openCommand(page, "integrity");
        });
        const mobileScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "database-diagnostics-mobile.png",
            (page) => findVisibleElement(page, ".modal-container:has(.database-diagnostic)")
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.setViewportSize({ width: 375, height: 667 });
            const modal = page.locator(".modal-container").filter({ has: page.locator(".database-diagnostic") });
            await assertMobileDialogueLayout(page, modal, "Database diagnostic choice");
            await assertMobileRadioTargets(page, modal, "Names in this report");
            const remoteChoice = modal.getByRole("checkbox", { name: "Include remote database", exact: true });
            assert.equal(await remoteChoice.isChecked(), true);
            await assertLocatorHasMinimumTouchTarget(page, remoteChoice.locator(".."), {
                label: "Include remote database",
            });
            await assertLocatorWithinSafeArea(page, remoteChoice.locator(".."), {
                label: "Include remote database",
                safeAreaInsets: iPhoneSafeArea,
            });
            await assertNoHorizontalOverflow(page, remoteChoice.locator(".."), { label: "Include remote database" });
            await modal.getByRole("button", { name: "Cancel", exact: true }).click();
            await modal.waitFor({ state: "hidden", timeout });
        });
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.setViewportSize({ width: 375, height: 667 });
            const dialogue = await openCommand(page, "usage");
            await dialogue.getByRole("button", { name: "Begin inspection", exact: true }).click();
            await page.locator('[data-diagnostic-phase="result"]').waitFor({ timeout });
            const modal = page.locator(".modal-container").filter({ has: page.locator(".database-diagnostic") });
            await assertMobileDialogueLayout(page, modal, "Database diagnostic result");
            await assertDiagnosticExportActionsWithinModal(page, dialogue, "the mobile result appearing");

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
            (page) => findVisibleElement(page, ".modal-container:has(.database-diagnostic)")
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.setViewportSize({ width: 375, height: 667 });
            const dialogue = page.locator(".database-diagnostic");
            await installDiagnosticExportInterception(page);
            const reportText = await dialogue.locator("textarea").inputValue();
            await dialogue.getByRole("button", { name: "Copy report", exact: true }).click();
            await dialogue.getByText("Report copied.", { exact: true }).waitFor({ timeout });
            const modal = page.locator(".modal-container").filter({ has: page.locator(".database-diagnostic") });
            await assertMobileDialogueLayout(page, modal, "Database diagnostic copied result");
            await assertDiagnosticExportActionsWithinModal(page, dialogue, "copying the mobile report");
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
            await assertDiagnosticExportActionsWithinModal(page, dialogue, "saving the mobile report");
            await captureObsidianElement(
                activeSession.remoteDebuggingPort,
                "database-diagnostics-mobile-saved.png",
                (page) => findVisibleElement(page, ".modal-container:has(.database-diagnostic)")
            );
            await dialogue.getByRole("button", { name: "Close", exact: true }).click();
            await dialogue.waitFor({ state: "hidden", timeout });
        });
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.setViewportSize({ width: 375, height: 667 });
            const settings = await openLiveSyncSettings(page, timeout);
            const hatch = await settings.openPage("Hatch");
            assert.ok(usageFixtureRow);
            await assertDiagnosticFileLookup(
                page,
                hatch,
                usageFixtureRow.path,
                rawFixture.shadowRevision,
                activeSession,
                true
            );
            await settings.close();
        });
        assert.deepEqual(
            await readDatabaseState(cli, session),
            before,
            "File lookup and follow-up reports remain read-only"
        );
        console.log(
            JSON.stringify({
                status: "passed",
                desktopScreenshot,
                mobileScreenshot,
                mobileResultScreenshot,
                readOnly: true,
                followUpCloseCancellation: true,
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
