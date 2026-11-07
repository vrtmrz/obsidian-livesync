import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianElement, openLiveSyncSettings, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";
import type { Locator, Page } from "playwright";

const path = "revision-repair.md";
const sizeRepairPath = "revision-size-repair.md";
const sizeRepairContent = "Size repair fixture with multibyte text: 日本語\n";
const healthyDeletedPath = "healthy-logical-deletion.md";
const baseContent = "Revision repair\n\nShared base.\n";
const branchContents = [
    `Revision repair\n\nLeft branch.\n${"L".repeat(4096)}\n`,
    `Revision repair\n\nRight branch.\n${"R".repeat(4096)}\n`,
] as const;
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_REVISION_REPAIR_TIMEOUT_MS ?? 15000);

type BrokenRevisionFixture = {
    winnerRevision: string;
    conflictRevision: string;
    missingChunkId: string;
};

type RevisionTree = {
    winnerRevision: string;
    conflictRevisions: string[];
};

type VaultWinnerState = {
    matches: boolean;
    winnerRevision: string;
};

type SizeRepairFixture = {
    revisionWithWrongSize: string;
    expectedSize: number;
    expectedPath: string;
    expectedCtime: number;
    expectedMtime: number;
    expectedChunks: string[];
};

type SizeRepairState = SizeRepairFixture & {
    revision: string;
    size: number;
    path: string;
    ctime: number;
    mtime: number;
    chunks: string[];
    bodyMatches: boolean;
    chunksAvailable: boolean;
    historyStart: number;
    historyIds: string[];
    provenanceRevision: string | null;
};

async function createAndOpenBaseFile(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(baseContent)};`,
            "let file=app.vault.getAbstractFileByPath(path);",
            "if(!file) file=await app.vault.create(path,content);",
            "await app.workspace.getLeaf(false).openFile(file);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function createHealthyLogicalDeletion(cliBinary: string, env: NodeJS.ProcessEnv): Promise<string> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(healthyDeletedPath)};`,
            `const content=${JSON.stringify(`Healthy logical deletion\n\n${"D".repeat(4096)}\n`)};`,
            "let file=app.vault.getAbstractFileByPath(path);",
            "if(!file) file=await app.vault.create(path,content);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
    await waitForLocalDatabaseEntry(cliBinary, env, healthyDeletedPath);
    return await evalObsidianJson<string>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(healthyDeletedPath)};`,
            `const timeoutMs=${JSON.stringify(uiTimeoutMs)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const file=app.vault.getAbstractFileByPath(path);",
            "if(!file) throw new Error(`Logical-deletion fixture is missing from the Vault: ${path}`);",
            "await app.vault.delete(file);",
            "const id=await core.services.path.path2id(path);",
            "const deadline=Date.now()+timeoutMs;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "while(Date.now()<deadline){",
            "  await core.services.fileProcessing.commitPendingFileEvents();",
            "  const doc=await core.localDatabase.localDatabase.get(id,{conflicts:true}).catch(()=>false);",
            "  if(!app.vault.getAbstractFileByPath(path)&&doc?.deleted&&(doc._conflicts??[]).length===0){",
            "    return JSON.stringify(doc._rev);",
            "  }",
            "  await sleep(250);",
            "}",
            "throw new Error(`Timed out waiting for a healthy logical deletion: ${path}`);",
            "})()",
        ].join(""),
        env
    );
}

async function createSizeRepairFixture(cliBinary: string, env: NodeJS.ProcessEnv): Promise<SizeRepairFixture> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(sizeRepairPath)};`,
            `const content=${JSON.stringify(sizeRepairContent)};`,
            "const file=app.vault.getAbstractFileByPath(path)??await app.vault.create(path,content);",
            "await app.workspace.getLeaf(false).openFile(file);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
    const saved = await waitForLocalDatabaseEntry(cliBinary, env, sizeRepairPath);
    return await evalObsidianJson<SizeRepairFixture>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(sizeRepairPath)};`,
            `const expectedSize=new TextEncoder().encode(${JSON.stringify(sizeRepairContent)}).length;`,
            `const savedRevision=${JSON.stringify(saved.rev)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const id=await core.services.path.path2id(path);",
            "const original=await core.localDatabase.localDatabase.get(id);",
            "if(original._rev!==savedRevision) throw new Error('Size repair source changed before fixture setup');",
            "const wrong=await core.localDatabase.putRaw({...original,size:expectedSize+7});",
            "if(!wrong.ok) throw new Error('Could not create size-only Metadata fixture');",
            "core.localDatabase.clearCaches();",
            "const revision=await core.localDatabase.localDatabase.get(id);",
            "return JSON.stringify({revisionWithWrongSize:revision._rev,expectedSize,expectedPath:path,expectedCtime:original.ctime,expectedMtime:original.mtime,expectedChunks:original.children??[]});",
            "})()",
        ].join(""),
        env
    );
}

async function readSizeRepairState(cliBinary: string, env: NodeJS.ProcessEnv): Promise<SizeRepairState> {
    return await evalObsidianJson<SizeRepairState>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(sizeRepairPath)};`,
            `const expected=${JSON.stringify(sizeRepairContent)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const id=await core.services.path.path2id(path);",
            "const raw=await core.localDatabase.localDatabase.get(id,{revs:true});",
            "const entry=await core.localDatabase.getDBEntry(path,undefined,false,true,true);",
            "if(!entry) throw new Error('Corrected size repair entry cannot be decoded');",
            "const body=await new Blob(Array.isArray(entry.data)?entry.data:[entry.data]).text();",
            "const children=raw.children??[];",
            "const rows=children.length?await core.localDatabase.allDocsRaw({keys:children}):{rows:[]};",
            "const available=rows.rows.filter(row=>row.value?.rev&&!row.value?.deleted).length===children.length;",
            "const provenance=await core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1').get(path);",
            "const revisions=raw._revisions??{start:0,ids:[]};",
            "return JSON.stringify({revision:raw._rev,size:raw.size,path:raw.path,ctime:raw.ctime,mtime:raw.mtime,chunks:children,bodyMatches:body===expected,chunksAvailable:available,historyStart:revisions.start,historyIds:revisions.ids,provenanceRevision:provenance?.revision??null});",
            "})()",
        ].join(""),
        env
    );
}

async function createBrokenConflict(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    baseRevision: string
): Promise<BrokenRevisionFixture> {
    return await evalObsidianJson<BrokenRevisionFixture>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const baseRevision=${JSON.stringify(baseRevision)};`,
            `const contents=${JSON.stringify(branchContents)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const id=await core.services.path.path2id(path);",
            "for(const [index,content] of contents.entries()){",
            "  const blob=new Blob([content],{type:'text/plain'});",
            "  const now=Date.now()+index;",
            "  const result=await core.localDatabase.putDBEntry({",
            "    _id:id,path,data:blob,ctime:now,mtime:now,",
            "    size:(await blob.arrayBuffer()).byteLength,children:[],",
            "    datatype:'plain',type:'plain',eden:{},",
            "  },false,baseRevision);",
            "  if(!result?.ok) throw new Error(`Could not create repair conflict: ${path}`);",
            "}",
            "const tree=await core.localDatabase.localDatabase.get(id,{conflicts:true});",
            "const conflictRevision=tree._conflicts?.[0];",
            "if(!tree._rev||!conflictRevision){",
            "  throw new Error(`Repair fixture did not produce two live revisions: ${path}`);",
            "}",
            "const conflict=await core.localDatabase.localDatabase.get(id,{rev:conflictRevision});",
            "const embedded=new Set(Object.keys(conflict.eden??{}));",
            "const missingChunkId=(conflict.children??[]).find((child)=>!embedded.has(child));",
            "if(!missingChunkId){",
            "  throw new Error(`Repair fixture did not create an independent chunk: ${conflictRevision}`);",
            "}",
            "const chunk=await core.localDatabase.localDatabase.get(missingChunkId);",
            "await core.localDatabase.localDatabase.remove(chunk);",
            "core.localDatabase.clearCaches();",
            "const unreadable=await core.localDatabase.getDBEntry(path,{rev:conflictRevision},false,true,true);",
            "if(unreadable!==false){",
            "  throw new Error(`The selected revision remained readable after its chunk was removed: ${conflictRevision}`);",
            "}",
            "return JSON.stringify({",
            "  winnerRevision:tree._rev,",
            "  conflictRevision,",
            "  missingChunkId,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function readRevisionTree(cliBinary: string, env: NodeJS.ProcessEnv): Promise<RevisionTree> {
    return await evalObsidianJson<RevisionTree>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const id=await core.services.path.path2id(path);",
            "const tree=await core.localDatabase.localDatabase.get(id,{conflicts:true});",
            "return JSON.stringify({",
            "  winnerRevision:tree._rev,",
            "  conflictRevisions:tree._conflicts??[],",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function readVaultWinnerState(cliBinary: string, env: NodeJS.ProcessEnv): Promise<VaultWinnerState> {
    return await evalObsidianJson<VaultWinnerState>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const file=app.vault.getAbstractFileByPath(path);",
            "if(!file) throw new Error(`Vault file is missing: ${path}`);",
            "const entry=await core.localDatabase.getDBEntry(path,undefined,false,true,true);",
            "if(!entry||!entry._rev) throw new Error(`Database winner is missing: ${path}`);",
            "const vaultContent=await app.vault.read(file);",
            "const data=Array.isArray(entry.data)?entry.data:[entry.data];",
            "const databaseContent=await new Blob(data).text();",
            "return JSON.stringify({",
            "  matches:vaultContent===databaseContent,",
            "  winnerRevision:entry._rev,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function readFileReflectionProvenance(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    targetPath = path
): Promise<{ revision: string; observedStorageMtime?: number } | null> {
    return await evalObsidianJson<{ revision: string; observedStorageMtime?: number } | null>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(targetPath)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const store=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');",
            "return JSON.stringify((await store.get(path))??null);",
            "})()",
        ].join(""),
        env
    );
}

function repairCard(settings: Locator, targetPath = path): Locator {
    return settings.locator(".sls-repair-result").filter({ hasText: targetPath });
}

function revisionCard(settings: Locator, revision: string, targetPath = path): Locator {
    return repairCard(settings, targetPath).locator(".sls-repair-revision").filter({ hasText: revision });
}

async function openRevisionActionMenu(page: Page, settings: Locator, revision: string, targetPath = path): Promise<Locator> {
    const actionButton = revisionCard(settings, revision, targetPath).getByRole("button", {
        name: `More actions for revision ${revision}`,
        exact: true,
    });
    await actionButton.locator("svg.lucide-wrench").waitFor({
        state: "visible",
        timeout: uiTimeoutMs,
    });
    await actionButton.click({ timeout: uiTimeoutMs });
    const menu = page.locator(".menu:visible").last();
    await menu.waitFor({ state: "visible", timeout: uiTimeoutMs });
    const box = await menu.boundingBox();
    const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
    }));
    if (
        box === null ||
        box.y < 0 ||
        box.y + box.height > viewport.height - 4
    ) {
        throw new Error(
            `Revision action menu is outside the viewport: ${JSON.stringify({
                box,
                viewport,
            })}`
        );
    }
    return menu;
}

async function selectRevisionAction(page: Page, settings: Locator, revision: string, action: string, targetPath = path): Promise<void> {
    const menu = await openRevisionActionMenu(page, settings, revision, targetPath);
    const item = menu.getByText(action, { exact: true });
    await item.waitFor({ state: "visible", timeout: uiTimeoutMs });
    await item.click({ timeout: uiTimeoutMs });
}

async function requestConflictCheck(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "core.localDatabase.clearCaches();",
            "await core.services.conflict.queueCheckFor(path);",
            "await core.services.conflict.ensureAllProcessed();",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }
    const cliBinary = cli.binary;
    const vault = await createTemporaryVault("obsidian-livesync-revision-repair-");
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: {
                doctorProcessedVersion: "1.0.0",
                isConfigured: true,
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
                disableMarkdownAutoMerge: true,
                showMergeDialogOnlyOnActive: true,
                useEden: false,
            },
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await createAndOpenBaseFile(cliBinary, session.cliEnv);
        const base = await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, path);
        const healthyDeletionRevision = await createHealthyLogicalDeletion(cliBinary, session.cliEnv);
        const sizeRepairFixture = await createSizeRepairFixture(cliBinary, session.cliEnv);
        const fixture = await createBrokenConflict(cliBinary, session.cliEnv, base.rev);
        const healthyDeletionProvenance = await readFileReflectionProvenance(
            cliBinary,
            session.cliEnv,
            healthyDeletedPath
        );
        if (healthyDeletionProvenance !== null) {
            throw new Error(
                `A healthy logical deletion retained Vault provenance indefinitely: ${JSON.stringify({
                    healthyDeletedPath,
                    healthyDeletionRevision,
                    healthyDeletionProvenance,
                })}`
            );
        }

        await requestConflictCheck(cliBinary, session.cliEnv);
        const afterAutomaticCheck = await readRevisionTree(cliBinary, session.cliEnv);
        if (
            afterAutomaticCheck.winnerRevision !== fixture.winnerRevision ||
            !afterAutomaticCheck.conflictRevisions.includes(fixture.conflictRevision)
        ) {
            throw new Error(
                `Automatic conflict checking discarded the unreadable revision: ${JSON.stringify({
                    fixture,
                    afterAutomaticCheck,
                })}`
            );
        }

        const sizeRepairPort = session.remoteDebuggingPort;
        await withObsidianPage(sizeRepairPort, async (page) => {
            const settingsNavigator = await openLiveSyncSettings(page, uiTimeoutMs);
            const settings = await settingsNavigator.openPage("Hatch");
            const verifySetting = settings.locator(".setting-item").filter({
                has: settingsNavigator.page.getByText("Inspect conflicts and file/database differences", {
                    exact: true,
                }),
            });
            await verifySetting.getByRole("button", { name: "Begin inspection", exact: true }).click({
                timeout: uiTimeoutMs,
            });
            const card = repairCard(settings);
            await card.waitFor({ state: "visible", timeout: uiTimeoutMs });
            if ((await settings.locator(".sls-repair-result").filter({ hasText: healthyDeletedPath }).count()) !== 0) {
                throw new Error(
                    `File/database inspection reported the healthy logical deletion ${healthyDeletedPath} (${healthyDeletionRevision}).`
                );
            }
            const winnerRevision = revisionCard(settings, fixture.winnerRevision);
            const brokenRevision = revisionCard(settings, fixture.conflictRevision);
            await brokenRevision
                .getByText(/🧩 Missing chunks: 1/u)
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            await brokenRevision.getByText(fixture.missingChunkId, { exact: false }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            if ((await card.locator(".sls-repair-revision").count()) !== 2) {
                throw new Error("Verify and Repair did not render the winner and conflict revision separately.");
            }
            for (const label of [
                /📦 DB: recorded/u,
                /📁 Vault:/u,
                /Δsize vs DB/u,
                /🕒 DB /u,
                /Δtime /u,
                /⚠️ Differs from Vault/u,
            ]) {
                await winnerRevision.getByText(label).waitFor({
                    state: "visible",
                    timeout: uiTimeoutMs,
                });
            }
            await brokenRevision.getByText(/decoded unavailable/u).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            const winnerMenu = await openRevisionActionMenu(page, settings, fixture.winnerRevision);
            for (const label of [
                "Compare with Vault",
                "Apply this revision to Vault",
                "Store Vault file as a child of this revision",
                "Discard this branch",
            ]) {
                await winnerMenu.getByText(label, { exact: true }).waitFor({
                    state: "visible",
                    timeout: uiTimeoutMs,
                });
            }
            if (
                (await winnerMenu
                    .getByText("Mark this revision as the Vault version", {
                        exact: true,
                    })
                    .count()) !== 0
            ) {
                throw new Error("A differing revision incorrectly offered to record an exact Vault match.");
            }
            await page.keyboard.press("Escape");
        });

        const repairCardScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "revision-repair-unreadable-conflict.png",
            (page) => page.locator(".sls-repair-result").filter({ hasText: path })
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const card = page.locator(".sls-repair-result").filter({ hasText: path });
            await card.evaluate((element) => {
                const htmlElement = element as HTMLElement;
                htmlElement.dataset.e2eOriginalStyle = htmlElement.getAttribute("style") ?? "";
                htmlElement.style.width = "360px";
                htmlElement.style.maxWidth = "100%";
            });
            const dimensions = await card.evaluate((element) => ({
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
            }));
            if (dimensions.scrollWidth > dimensions.clientWidth + 1) {
                throw new Error(
                    `Revision repair card overflowed at mobile width: ${JSON.stringify(dimensions)}`
                );
            }
        });
        const mobileWidthScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "revision-repair-mobile-width.png",
            (page) => page.locator(".sls-repair-result").filter({ hasText: path })
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const card = page.locator(".sls-repair-result").filter({ hasText: path });
            await card.evaluate((element) => {
                const htmlElement = element as HTMLElement;
                const originalStyle = htmlElement.dataset.e2eOriginalStyle ?? "";
                if (originalStyle.length > 0) {
                    htmlElement.setAttribute("style", originalStyle);
                } else {
                    htmlElement.removeAttribute("style");
                }
                delete htmlElement.dataset.e2eOriginalStyle;
            });
        });

        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const settings = page.locator(".sls-setting");
            await openRevisionActionMenu(page, settings, fixture.winnerRevision);
        });
        const readableMenuScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "revision-repair-readable-actions.png",
            (page) => page.locator(".menu:visible").last()
        );

        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.keyboard.press("Escape");
            const settings = page.locator(".sls-setting");
            await selectRevisionAction(page, settings, fixture.winnerRevision, "Compare with Vault");
            const modal = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({
                    hasText: "Vault and database revision",
                }),
            });
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.getByText(path, { exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            await modal.getByText(/Vault file:/u).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            await modal.getByText(/Database revision:/u).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            const actions = modal.locator(".conflict-action-container");
            await actions.getByRole("button", { name: "Close", exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            for (const action of ["Use Vault file", "Use Database revision", "Concat both", "Not now"]) {
                if ((await actions.getByRole("button", { name: action, exact: true }).count()) !== 0) {
                    throw new Error(`Read-only comparison exposed the resolution action '${action}'.`);
                }
            }
        });
        const comparisonScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "revision-repair-read-only-comparison.png",
            (page) =>
                page.locator(".modal-container").filter({
                    has: page.locator(".modal-title").filter({
                        hasText: "Vault and database revision",
                    }),
                })
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({
                    hasText: "Vault and database revision",
                }),
            });
            await modal
                .locator(".conflict-action-container")
                .getByRole("button", { name: "Close", exact: true })
                .click({ timeout: uiTimeoutMs });
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        const beforeApply = await readRevisionTree(cliBinary, session.cliEnv);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const settings = page.locator(".sls-setting");
            await selectRevisionAction(page, settings, fixture.winnerRevision, "Apply this revision to Vault");
            const confirmation = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({
                    hasText: "Apply database revision to Vault",
                }),
            });
            await confirmation.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await confirmation.getByRole("button", { name: "Yes", exact: true }).click({ timeout: uiTimeoutMs });
            await revisionCard(settings, fixture.winnerRevision)
                .getByText("✅ Matches Vault", { exact: true })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            const status = repairCard(settings).locator(".sls-repair-status");
            await status
                .getByText("✅ Vault matches winner", { exact: true })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            await status
                .getByText("⚠️ Conflicts: 1", { exact: true })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
        });
        const matchedWinnerWithConflictScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "revision-repair-winner-match-with-conflict.png",
            (page) => page.locator(".sls-repair-result").filter({ hasText: path })
        );
        const afterApply = await readRevisionTree(cliBinary, session.cliEnv);
        if (JSON.stringify(afterApply) !== JSON.stringify(beforeApply)) {
            throw new Error(
                `Applying a live revision to the Vault changed the revision tree: ${JSON.stringify({
                    beforeApply,
                    afterApply,
                })}`
            );
        }
        const vaultWinner = await readVaultWinnerState(cliBinary, session.cliEnv);
        const appliedProvenance = await readFileReflectionProvenance(cliBinary, session.cliEnv);
        if (
            !vaultWinner.matches ||
            vaultWinner.winnerRevision !== fixture.winnerRevision ||
            appliedProvenance?.revision !== fixture.winnerRevision
        ) {
            throw new Error(
                `Applying the winner did not preserve exact Vault provenance: ${JSON.stringify({
                    vaultWinner,
                    appliedProvenance,
                    fixture,
                })}`
            );
        }

        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const settings = page.locator(".sls-setting");
            const menu = await openRevisionActionMenu(page, settings, fixture.winnerRevision);
            await menu
                .getByText("Mark this revision as the Vault version", { exact: true })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            await menu
                .getByText("Discard this branch", { exact: true })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            await menu
                .getByText("Mark this revision as the Vault version", { exact: true })
                .click({ timeout: uiTimeoutMs });
            await revisionCard(settings, fixture.winnerRevision)
                .getByText("✅ Matches Vault", { exact: true })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
        });
        const afterExactMark = await readRevisionTree(cliBinary, session.cliEnv);
        const markedProvenance = await readFileReflectionProvenance(cliBinary, session.cliEnv);
        if (
            JSON.stringify(afterExactMark) !== JSON.stringify(beforeApply) ||
            markedProvenance?.revision !== fixture.winnerRevision
        ) {
            throw new Error(
                `Recording an exact Vault match changed the tree or lost provenance: ${JSON.stringify({
                    beforeApply,
                    afterExactMark,
                    markedProvenance,
                })}`
            );
        }

        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const settings = page.locator(".sls-setting");
            const menu = await openRevisionActionMenu(page, settings, fixture.conflictRevision);
            for (const label of [
                "Store Vault file as a child of this revision",
                "Retry reading revision",
                "Discard this branch",
            ]) {
                await menu.getByText(label, { exact: true }).waitFor({
                    state: "visible",
                    timeout: uiTimeoutMs,
                });
            }
        });
        const unreadableMenuScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "revision-repair-unreadable-actions-context.png",
            (page) => page.locator("body")
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.keyboard.press("Escape");
            const settings = page.locator(".sls-setting");
            await selectRevisionAction(page, settings, fixture.conflictRevision, "Retry reading revision");
            await revisionCard(settings, fixture.conflictRevision)
                .getByText(/🧩 Missing chunks:/u)
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
        });

        const afterRetry = await readRevisionTree(cliBinary, session.cliEnv);
        if (JSON.stringify(afterRetry) !== JSON.stringify(beforeApply)) {
            throw new Error(`Retry changed the revision tree: ${JSON.stringify(afterRetry)}`);
        }

        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const settings = page.locator(".sls-setting");
            await selectRevisionAction(page, settings, fixture.conflictRevision, "Discard this branch");
            const confirmation = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Discard branch" }),
            });
            await confirmation.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await confirmation.getByRole("button", { name: "No", exact: true }).click({ timeout: uiTimeoutMs });
            await confirmation.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        const afterCancellation = await readRevisionTree(cliBinary, session.cliEnv);
        if (JSON.stringify(afterCancellation) !== JSON.stringify(beforeApply)) {
            throw new Error(`Cancelling discard changed the revision tree: ${JSON.stringify(afterCancellation)}`);
        }

        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const settings = page.locator(".sls-setting");
            await selectRevisionAction(page, settings, fixture.conflictRevision, "Discard this branch");
            const confirmation = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Discard branch" }),
            });
            await confirmation.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await confirmation.getByRole("button", { name: "Yes", exact: true }).click({ timeout: uiTimeoutMs });
            await repairCard(settings).waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        const afterDiscard = await readRevisionTree(cliBinary, session.cliEnv);
        if (afterDiscard.winnerRevision !== fixture.winnerRevision || afterDiscard.conflictRevisions.length !== 0) {
            throw new Error(
                `Explicit discard did not remove only the selected unreadable revision: ${JSON.stringify({
                    fixture,
                    afterDiscard,
                })}`
            );
        }
        const finalVaultWinner = await readVaultWinnerState(cliBinary, session.cliEnv);
        const finalProvenance = await readFileReflectionProvenance(cliBinary, session.cliEnv);
        if (
            !finalVaultWinner.matches ||
            finalVaultWinner.winnerRevision !== fixture.winnerRevision ||
            finalProvenance?.revision !== fixture.winnerRevision
        ) {
            throw new Error(
                `Discarding the unreadable branch disturbed the healthy Vault reflection: ${JSON.stringify({
                    finalVaultWinner,
                    finalProvenance,
                    fixture,
                })}`
            );
        }

        await withObsidianPage(sizeRepairPort, async (page) => {
            const settingsNavigator = await openLiveSyncSettings(page, uiTimeoutMs);
            const settings = await settingsNavigator.openPage("Hatch");
            const verifySetting = settings.locator(".setting-item").filter({
                has: settingsNavigator.page.getByText("Inspect conflicts and file/database differences", {
                    exact: true,
                }),
            });
            await verifySetting.getByRole("button", { name: "Begin inspection", exact: true }).click({
                timeout: uiTimeoutMs,
            });
            const card = repairCard(settings, sizeRepairPath);
            await card.waitFor({ state: "visible", timeout: uiTimeoutMs });
            const winner = revisionCard(settings, sizeRepairFixture.revisionWithWrongSize, sizeRepairPath);
            await winner.getByText(/^📦 DB:.*Δsize/u).waitFor({ state: "visible", timeout: uiTimeoutMs });
            const menu = await openRevisionActionMenu(
                page,
                settings,
                sizeRepairFixture.revisionWithWrongSize,
                sizeRepairPath
            );
            await menu.getByText("Correct recorded file size", { exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            const screenshot = await captureObsidianElement(
                sizeRepairPort,
                "revision-repair-size-correction-actions.png",
                (currentPage) => currentPage.locator(".menu:visible").last()
            );
            console.log(`Size correction actions screenshot: ${screenshot}`);
            await page.keyboard.press("Escape");
            await selectRevisionAction(
                page,
                settings,
                sizeRepairFixture.revisionWithWrongSize,
                "Correct recorded file size",
                sizeRepairPath
            );
            await card.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });
        const sizeRepairState = await readSizeRepairState(cliBinary, session.cliEnv);
        const correctedRevisionGeneration = Number(sizeRepairState.revision.split("-")[0]);
        const expectedParentId = sizeRepairFixture.revisionWithWrongSize.split("-").slice(1).join("-");
        if (
            sizeRepairState.revision === sizeRepairFixture.revisionWithWrongSize ||
            sizeRepairState.size !== sizeRepairFixture.expectedSize ||
            sizeRepairState.path !== sizeRepairFixture.expectedPath ||
            sizeRepairState.ctime !== sizeRepairFixture.expectedCtime ||
            sizeRepairState.mtime !== sizeRepairFixture.expectedMtime ||
            JSON.stringify(sizeRepairState.chunks) !== JSON.stringify(sizeRepairFixture.expectedChunks) ||
            !sizeRepairState.bodyMatches ||
            !sizeRepairState.chunksAvailable ||
            sizeRepairState.historyStart !== correctedRevisionGeneration ||
            sizeRepairState.historyIds[1] !== expectedParentId ||
            sizeRepairState.provenanceRevision !== sizeRepairState.revision
        ) {
            throw new Error(
                `Size repair did not preserve the exact file body, Chunks, Metadata fields, ancestry, and provenance: ${JSON.stringify({
                    fixture: sizeRepairFixture,
                    state: sizeRepairState,
                })}`
            );
        }

        console.log(
            "Real Obsidian omitted a healthy logical deletion; rendered each live revision with compact actions and diagnostics; showed that the Vault matched the winner while one conflict remained; compared and applied an exact readable revision without changing the tree; preserved Vault provenance; kept an unreadable branch through automatic checking, retry, and cancelled discard; discarded only the selected branch after confirmation; and corrected a Vault-matching Metadata size through Verify while preserving its body, Chunks, timestamps, ancestry, and provenance."
        );
        console.log(`Repair card screenshot: ${repairCardScreenshot}`);
        console.log(`Mobile-width repair card screenshot: ${mobileWidthScreenshot}`);
        console.log(`Readable revision actions screenshot: ${readableMenuScreenshot}`);
        console.log(`Read-only comparison screenshot: ${comparisonScreenshot}`);
        console.log(`Matching winner with conflict screenshot: ${matchedWinnerWithConflictScreenshot}`);
        console.log(`Unreadable revision actions screenshot: ${unreadableMenuScreenshot}`);
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
