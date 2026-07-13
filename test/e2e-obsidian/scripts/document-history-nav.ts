import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { waitForLiveSyncCoreReady } from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { obsidianRemoteDebuggingPort, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";
process.env.E2E_OBSIDIAN_CORE_READY_TIMEOUT_MS ??= "60000";
process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ??= "30000";

const notePath = "E2E/document-history-nav.md";
const revisions = ["Version one alpha", "Version two beta keyword", "Version three gamma"];

type RevisionInfo = {
    revCount: number;
    id: string;
};

type OpenHistoryResult = {
    opened: boolean;
    modalTitle: string | null;
};

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
}

function assertTrue(value: boolean, message: string): void {
    if (!value) {
        throw new Error(message);
    }
}

async function dismissWelcomeWizard(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const cancel = page.getByText("No, please take me back");
        if (await cancel.isVisible({ timeout: 5000 }).catch(() => false)) {
            await cancel.click();
            await page.waitForTimeout(500);
        }
    });
}

async function configureMinimalLocalMode(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<{ isConfigured: boolean }>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.setting.applyExternalSettings({",
            "liveSync:false,",
            "syncOnStart:false,",
            "syncOnSave:false,",
            "isConfigured:true,",
            "doctorProcessedVersion:'0.25.27',",
            "},true);",
            "await core.services.control.applySettings();",
            "const current=core.services.setting.currentSettings();",
            "return JSON.stringify({isConfigured:current.isConfigured});",
            "})()",
        ].join(""),
        env
    );
}

async function seedRevisions(cliBinary: string, env: NodeJS.ProcessEnv): Promise<RevisionInfo> {
    return await evalObsidianJson<RevisionInfo>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(notePath)};`,
            `const revisions=${JSON.stringify(revisions)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "if(!(await app.vault.adapter.exists('E2E'))) await app.vault.createFolder('E2E');",
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.delete(existing);",
            "const id=await core.services.path.path2id(path);",
            "let baseRev='';",
            "for(const content of revisions){",
            "  const blob=new Blob([content],{type:'text/plain'});",
            "  const now=Date.now();",
            "  const result=await core.localDatabase.putDBEntry({",
            "    _id:id,",
            "    path,",
            "    data:blob,",
            "    ctime:now,",
            "    mtime:now,",
            "    size:(await blob.arrayBuffer()).byteLength,",
            "    children:[],",
            "    datatype:'plain',",
            "    type:'plain',",
            "    eden:{},",
            "  },false,baseRev||undefined);",
            "  if(!result?.ok) throw new Error(`Could not store revision for ${path}`);",
            "  baseRev=result.rev;",
            "  await sleep(100);",
            "}",
            `await app.vault.create(path,revisions[revisions.length-1]);`,
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "const raw=await core.localDatabase.getRaw(id,{revs_info:true});",
            "const revCount=(raw._revs_info||[]).filter((e)=>e&&e.status==='available').length;",
            "return JSON.stringify({revCount,id});",
            "})()",
        ].join(""),
        env
    );
}

async function openDocumentHistory(cliBinary: string, env: NodeJS.ProcessEnv): Promise<OpenHistoryResult> {
    return await evalObsidianJson<OpenHistoryResult>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(notePath)};`,
            "const file=app.vault.getAbstractFileByPath(path);",
            "if(!file) throw new Error('Note missing before opening history');",
            "document.querySelectorAll('.modal-close-button').forEach((btn)=>btn.click());",
            "await new Promise((resolve)=>setTimeout(resolve,300));",
            "const leaf=app.workspace.getLeaf(false);",
            "await leaf.openFile(file);",
            "await new Promise((resolve)=>setTimeout(resolve,300));",
            "await app.commands.executeCommandById('obsidian-livesync:livesync-history');",
            "await new Promise((resolve)=>setTimeout(resolve,500));",
            "const modal=document.querySelector('.modal-container .modal-title');",
            "return JSON.stringify({opened:!!modal,modalTitle:modal?modal.textContent:null});",
            "})()",
        ].join(""),
        env
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);

    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;
    const port = obsidianRemoteDebuggingPort();

    const screenshotDir = process.env.E2E_OBSIDIAN_HISTORY_SCREENSHOT_DIR ?? "/opt/cursor/artifacts/screenshots/document-history-nav";
    const reportPath = process.env.E2E_OBSIDIAN_HISTORY_REPORT ?? join(screenshotDir, "report.txt");

    async function captureStep(page: import("playwright").Page, step: string): Promise<string> {
        await mkdir(screenshotDir, { recursive: true });
        const path = join(screenshotDir, `${step}.png`);
        await page.screenshot({ path, fullPage: true });
        console.log(`Screenshot: ${path}`);
        return path;
    }

    try {
        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault: ${vault.path}`);

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);

        await dismissWelcomeWizard(port);
        await configureMinimalLocalMode(cli.binary, session.cliEnv);
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);

        const revisionInfo = await seedRevisions(cli.binary, session.cliEnv);
        console.log(`Seeded local history: ${revisionInfo.revCount} revisions for ${revisionInfo.id}`);
        assertTrue(revisionInfo.revCount >= 2, `Expected at least 2 revisions, got ${revisionInfo.revCount}`);

        const opened = await openDocumentHistory(cli.binary, session.cliEnv);
        assertEqual(opened.opened, true, "Document History modal did not open.");
        assertEqual(opened.modalTitle, "Document History", "Unexpected modal title.");

        const report = await withObsidianPage(port, async (page) => {
            const modal = page.locator(".modal-container").filter({ hasText: "Document History" });
            await modal.waitFor({ state: "visible", timeout: 10000 });

            const revNavRow = modal.locator(".history-rev-nav-row");
            await revNavRow.waitFor({ state: "visible", timeout: 10000 });

            const indicator = revNavRow.locator(".history-rev-indicator");
            const initialIndicator = (await indicator.innerText()).trim();

            const prevBtn = revNavRow.locator(".history-rev-nav-btn").first();
            const nextBtn = revNavRow.locator(".history-rev-nav-btn").last();
            const range = revNavRow.locator('input[type="range"]');

            assertTrue(/Rev \d+\/\d+/.test(initialIndicator), `Unexpected initial indicator: ${initialIndicator}`);

            const initialRange = await range.inputValue();

            const screenshotPaths: string[] = [];
            screenshotPaths.push(await captureStep(page, "01-initial-latest-rev"));

            await prevBtn.click();
            await page.waitForTimeout(1000);
            const afterPrevIndicator = (await indicator.innerText()).trim();
            const afterPrevRange = await range.inputValue();
            assertTrue(
                Number(afterPrevRange) < Number(initialRange),
                `◀ did not move to an older revision. before=${initialRange}, after=${afterPrevRange}`
            );
            assertTrue(afterPrevIndicator !== initialIndicator, "◀ did not update Rev indicator.");
            screenshotPaths.push(await captureStep(page, "02-after-click-older-rev"));

            await nextBtn.click();
            await page.waitForTimeout(1000);
            const afterNextIndicator = (await indicator.innerText()).trim();
            const afterNextRange = await range.inputValue();
            assertEqual(afterNextRange, initialRange, "▶ did not return to the original revision.");
            assertEqual(afterNextIndicator, initialIndicator, "▶ did not restore the Rev indicator.");
            screenshotPaths.push(await captureStep(page, "03-after-click-newer-rev"));

            const searchInput = modal.locator(".history-search-input");
            await searchInput.fill("keyword");
            await page.waitForTimeout(1500);

            const searchIndicator = modal.locator(".history-search-result-indicator");
            const searchText = (await searchIndicator.innerText()).trim();
            assertTrue(/matches/.test(searchText), `Search indicator did not report matches: ${searchText}`);
            screenshotPaths.push(await captureStep(page, "04-after-search-keyword"));

            const searchPrev = modal.locator(".history-search-row button").nth(0);
            const searchNext = modal.locator(".history-search-row button").nth(1);
            assertTrue(!(await searchPrev.isDisabled()), "Search ▲ should be enabled when matches exist.");
            assertTrue(!(await searchNext.isDisabled()), "Search ▼ should be enabled when matches exist.");

            await searchNext.click();
            await page.waitForTimeout(1000);

            const afterSearchIndicator = (await searchIndicator.innerText()).trim();
            assertTrue(/1\/\d+ matches/.test(afterSearchIndicator), `Search navigation failed: ${afterSearchIndicator}`);
            screenshotPaths.push(await captureStep(page, "05-after-search-next-match"));

            return [
                `initialIndicator: ${initialIndicator}`,
                `afterPrevIndicator: ${afterPrevIndicator}`,
                `afterNextIndicator: ${afterNextIndicator}`,
                `searchIndicator: ${searchText}`,
                `afterSearchIndicator: ${afterSearchIndicator}`,
                "",
                "Screenshots:",
                ...screenshotPaths.map((p) => `- ${p}`),
            ].join("\n");
        });

        await writeFile(reportPath, report, "utf-8");
        console.log(`Document History UI test passed.`);
        console.log(`Report: ${reportPath}`);
        console.log(`Screenshots: ${screenshotDir}`);
    } finally {
        if (session) await session.app.stop();
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});

