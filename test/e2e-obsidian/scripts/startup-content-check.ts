/** Checks the default and strict body checks across natural Obsidian restarts. */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import {
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianElement, captureObsidianPage, openLiveSyncSettings, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

const targetPath = "startup-content-check-00000.md";
const versions = [
    "Startup content check fixture body A\n",
    "Startup content check fixture body B\n",
    "Startup content check fixture body C\n",
] as const;

type TargetState = {
    rev: string;
    rawMtime: number | null;
    metadataMtime: number;
    size: number;
    documentSize: number;
    dbContent: string;
    vaultContent: string;
    branchCount: number;
    conflictCount: number;
    provenanceRevision: string | null;
    contentHash: string | null;
    contentSize: number | null;
    fileMtime: number | null;
    adapterMtime: number | null;
    storageMtime: number | null;
    adapterSize: number | null;
    storageSize: number | null;
};

type InitialState = {
    fileCount: number;
    indexedCount: number;
    conflictCount: number;
    pendingCount: number;
    strictContentCheckOnStartup: boolean;
    targetProvenanceValid: boolean;
    target: TargetState;
};

type ManualScanState = TargetState & {
    scanResult: boolean | string;
    scanMs: number;
    strictContentCheckOnStartup: boolean;
};

type StartupFailureCore = {
    services?: {
        database?: { isDatabaseReady?: () => boolean };
        appLifecycle?: {
            isReady?: () => boolean;
            isSuspended?: () => boolean;
            getUnresolvedMessages?: () => Promise<unknown[][]>;
        };
    };
};

type StartupFailureGlobal = typeof globalThis & {
    app?: {
        commands?: { executeCommandById?: (commandId: string) => boolean };
        plugins?: { plugins?: Record<string, { core?: StartupFailureCore }> };
    };
};

const sensitiveDiagnosticLine =
    /security seed|passphrase|password|credential|secret|access.?key|jwt.?key|authori[sz]ation|obsidian:\/\/setuplivesync|sls\+/iu;

function redactDiagnosticLine(line: string): string {
    if (sensitiveDiagnosticLine.test(line)) return "[REDACTED SENSITIVE LOG LINE]";
    return line.replace(/\bhttps?:\/\/[^/\s:@]+:[^@\s/]+@/giu, "https://[REDACTED]@");
}

function requireCondition(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) {
        throw new Error(message + "\nExpected: " + String(expected) + "\nActual: " + String(actual));
    }
}

function fileCountFromEnvironment(): number {
    const raw = process.env.E2E_STARTUP_CHECK_FILE_COUNT ?? "20";
    if (!/^[1-9]\d*$/.test(raw)) {
        throw new Error("E2E_STARTUP_CHECK_FILE_COUNT must be a positive integer; received " + raw + ".");
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > 5000) {
        throw new Error("E2E_STARTUP_CHECK_FILE_COUNT must be between 1 and 5000; received " + raw + ".");
    }
    return value;
}

function fixturePath(index: number): string {
    return "startup-content-check-" + String(index).padStart(5, "0") + ".md";
}

function fixtureContent(index: number): string {
    if (index === 0) return versions[0];
    return "Startup content check fixture " + String(index).padStart(5, "0") + "\n";
}

function sha256(content: string): string {
    return "sha256:" + createHash("sha256").update(content).digest("hex");
}

function assertExactMtime(state: TargetState, label: string): void {
    const expected = state.rawMtime;
    if (expected === null || !Number.isFinite(expected)) {
        throw new Error(
            "Fixture precision mismatch during " + label + ": persisted provenance raw mtime was unavailable."
        );
    }
    for (const [name, actual] of [
        ["TFile", state.fileMtime],
        ["Vault adapter", state.adapterMtime],
        ["StorageAccess", state.storageMtime],
    ] as const) {
        if (actual !== expected) {
            throw new Error(
                "Fixture precision mismatch during " +
                    label +
                    ": " +
                    name +
                    " mtime " +
                    String(actual) +
                    " did not exactly match persisted raw mtime " +
                    expected +
                    "."
            );
        }
    }
    assertEqual(state.metadataMtime, expected, label + ": Metadata and raw mtimes differed.");
}

function requireRecordedMtime(state: TargetState, label: string): number {
    if (state.rawMtime === null || !Number.isFinite(state.rawMtime)) {
        throw new Error(
            "Fixture precision mismatch before " + label + ": persisted provenance raw mtime was unavailable."
        );
    }
    return state.rawMtime;
}

async function createFixtures(vaultPath: string, fileCount: number, fixtureMtime: number): Promise<string[]> {
    const paths = Array.from({ length: fileCount }, (_, index) => fixturePath(index));
    const exactMtime = new Date(fixtureMtime);
    const batchSize = 100;
    for (let offset = 0; offset < paths.length; offset += batchSize) {
        await Promise.all(
            paths.slice(offset, offset + batchSize).map(async (path, index) => {
                const fileIndex = offset + index;
                const fullPath = join(vaultPath, path);
                await writeFile(fullPath, fixtureContent(fileIndex), "utf-8");
                await utimes(fullPath, exactMtime, exactMtime);
                const created = await stat(fullPath);
                if (created.mtimeMs !== fixtureMtime) {
                    throw new Error(
                        "Fixture precision mismatch before bootstrap: filesystem mtimeMs " +
                            created.mtimeMs +
                            " did not exactly match requested integer-millisecond mtime " +
                            fixtureMtime +
                            "."
                    );
                }
            })
        );
    }
    return paths;
}

async function restoreOfflineEdit(
    vaultPath: string,
    content: string,
    expectedMtime: number,
    expectedSize: number,
    label: string
): Promise<void> {
    const fullPath = join(vaultPath, targetPath);
    if (Buffer.byteLength(content, "utf-8") !== expectedSize) {
        throw new Error(label + ": the offline edit did not preserve the recorded byte size.");
    }
    if (!Number.isFinite(expectedMtime)) {
        throw new Error(label + ": the persisted raw mtime was not a finite number.");
    }
    await writeFile(fullPath, content, "utf-8");
    const exactMtime = new Date(expectedMtime);
    await utimes(fullPath, exactMtime, exactMtime);
    const restored = await stat(fullPath);
    if (restored.mtimeMs !== expectedMtime) {
        throw new Error(
            "Fixture precision mismatch before " +
                label +
                ": filesystem mtimeMs " +
                restored.mtimeMs +
                " did not exactly match persisted raw mtime " +
                expectedMtime +
                "."
        );
    }
    assertEqual(restored.size, expectedSize, label + ": the restored fixture byte size differed from Metadata.");
}

async function main(): Promise<void> {
    const fileCount = fileCountFromEnvironment();
    if (fileCount >= 1000) {
        process.env.E2E_OBSIDIAN_CORE_READY_TIMEOUT_MS ??= "120000";
        process.env.E2E_OBSIDIAN_READY_TIMEOUT_MS ??= "120000";
    }
    for (const content of versions) {
        assertEqual(
            Buffer.byteLength(content, "utf-8"),
            Buffer.byteLength(versions[0], "utf-8"),
            "The same-stat offline edit fixtures must have identical byte lengths."
        );
    }

    const binary = requireObsidianBinary();
    const cliBinary = requireObsidianCli();
    const bundleHash = createHash("sha256")
        .update(new Uint8Array(await readFile("main.js")))
        .digest("hex");
    const vault = await createTemporaryVault("obsidian-startup-content-check-");
    const fixtureMtime = Math.floor(Date.now());
    const sessionState: { current: ObsidianLiveSyncSession | undefined } = { current: undefined };
    const pluginData = createE2eCouchDbPluginData(
        // Replication is disabled; the scenario uses only the persisted local database.
        { uri: "http://127.0.0.1:1", username: "unused", password: "unused", dbName: "startup-content-check-local" },
        {
            deviceAndVaultName: "startup-content-check-device",
            strictContentCheckOnStartup: false,
            liveSync: false,
            periodicReplication: false,
            syncOnStart: false,
            syncOnSave: false,
            syncOnFileOpen: false,
            syncOnEditorSave: false,
            syncAfterMerge: false,
        }
    );

    async function launch(pluginStartup: "controlled" | "natural", label: string, bootstrap = false): Promise<number> {
        console.log("Starting " + label + " with the real Obsidian process.");
        const startedAt = Date.now();
        const options = {
            binary,
            cliBinary,
            vault,
            pluginStartup,
            ...(bootstrap
                ? {
                      pluginData,
                      localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
                  }
                : {}),
        };
        const currentSession = await startObsidianLiveSyncSession(options);
        sessionState.current = currentSession;
        const readiness = await waitForLiveSyncCoreReady(cliBinary, currentSession.cliEnv);
        requireCondition(
            readiness.databaseReady && readiness.appReady,
            "Self-hosted LiveSync did not reach core readiness: " + JSON.stringify(readiness)
        );
        const elapsedMs = Date.now() - startedAt;
        console.log("Reached LiveSync core readiness for " + label + " in " + elapsedMs + " ms.");
        return elapsedMs;
    }

    async function evaluate<T>(body: string): Promise<T> {
        const currentSession = sessionState.current;
        if (!currentSession) throw new Error("The Obsidian session is not running.");
        const script = [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync']?.core;",
            "const require=(condition,message)=>{if(!condition)throw new Error(message);};",
            "const contentOf=value=>Array.isArray(value)?value.join(''):value;",
            "const targetState=async path=>{",
            "  require(core,'Self-hosted LiveSync did not load');",
            "  const meta=await core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);",
            "  require(meta&&meta._rev,'The target Metadata was missing');",
            "  const document=await core.localDatabase.getDBEntryFromMeta(meta);",
            "  require(document&&document.data!==undefined,'The target Chunks could not be loaded');",
            "  const dbContent=contentOf(document.data);",
            "  require(typeof dbContent==='string','The text fixture did not load as text');",
            "  const file=app.vault.getAbstractFileByPath(path);",
            "  require(file&&file.stat,'The target Vault file was missing');",
            "  const adapterStat=await app.vault.adapter.stat(path);",
            "  const storage=core.serviceModules.storageAccess;",
            "  const storageStat=await storage.statHidden(path);",
            "  const provenance=await core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1').get(path);",
            "  return {rev:meta._rev,rawMtime:provenance?.observedStorageMtime??null,metadataMtime:Number(meta.mtime),",
            "    size:Number(meta.size),documentSize:Number(document.size),dbContent,",
            "    vaultContent:await app.vault.adapter.read(path),",
            "    branchCount:1+(meta._conflicts??[]).length,conflictCount:(meta._conflicts??[]).length,",
            "    provenanceRevision:provenance?.revision??null,contentHash:provenance?.contentHash??null,",
            "    contentSize:provenance?.contentSize??null,fileMtime:file.stat.mtime??null,",
            "    adapterMtime:adapterStat?.mtime??null,storageMtime:storageStat?.mtime??null,",
            "    adapterSize:adapterStat?.size??null,storageSize:storageStat?.size??null};",
            "};",
            body,
            "})()",
        ].join("\n");
        return await evalObsidianJson<T>(cliBinary, script, currentSession.cliEnv);
    }

    async function stopSession(): Promise<void> {
        const currentSession = sessionState.current;
        if (!currentSession) return;
        await currentSession.app.stop();
        sessionState.current = undefined;
    }

    async function captureSettingScreenshots(): Promise<{ advancedPage: string; settingRow: string }> {
        const currentSession = sessionState.current;
        if (!currentSession) throw new Error("The Obsidian session is not running.");
        const port = currentSession.remoteDebuggingPort;
        const outputDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
        const advancedPagePath = join(outputDirectory, "startup-content-check-setting-location.png");
        await mkdir(outputDirectory, { recursive: true });

        await withObsidianPage(port, async (page) => {
            const navigator = await openLiveSyncSettings(page);
            const advanced = await navigator.openPage("Advanced");
            const section = advanced.getByText("Local Database Tweak", { exact: true }).first();
            await section.waitFor({ state: "visible" });
            await section.scrollIntoViewIfNeeded();
            const row = advanced.locator(".setting-item").filter({
                has: navigator.page.getByText("Strict content check on startup", { exact: true }),
            });
            await row.waitFor({ state: "visible" });
            await row
                .getByText(
                    "Compare file contents even when modification time and size match. This can slow startup in large vaults.",
                    { exact: true }
                )
                .waitFor({ state: "visible" });
            assertEqual(
                await row.locator(".checkbox-container.is-enabled").count(),
                0,
                "The screenshot fixture toggle was not visibly OFF."
            );
            await navigator.dialogue.screenshot({
                path: advancedPagePath,
                animations: "disabled",
                style: ".notice-container { visibility: hidden !important; }",
            });
        });

        const settingRowPath = await captureObsidianElement(
            port,
            "startup-content-check-setting-row.png",
            async (page) => {
                const navigator = await openLiveSyncSettings(page);
                const advanced = await navigator.openPage("Advanced");
                const row = advanced.locator(".setting-item").filter({
                    has: navigator.page.getByText("Strict content check on startup", { exact: true }),
                });
                await row.waitFor({ state: "visible" });
                await row
                    .getByText(
                        "Compare file contents even when modification time and size match. This can slow startup in large vaults.",
                        { exact: true }
                    )
                    .waitFor({ state: "visible" });
                assertEqual(
                    await row.locator(".checkbox-container.is-enabled").count(),
                    0,
                    "The cropped screenshot fixture toggle was not visibly OFF."
                );
                return row;
            }
        );

        await withObsidianPage(port, async (page) => {
            const navigator = await openLiveSyncSettings(page);
            await navigator.close();
        });
        return { advancedPage: advancedPagePath, settingRow: settingRowPath };
    }

    async function captureFailureEvidence(error: unknown): Promise<void> {
        const currentSession = sessionState.current;
        if (!currentSession) return;
        const outputDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
        const visibleScreenshotPath = join(outputDirectory, "startup-content-check-failure-visible.png");
        const screenshotPath = join(outputDirectory, "startup-content-check-failure.png");
        const snapshotPath = join(outputDirectory, "startup-content-check-failure.json");
        await mkdir(outputDirectory, { recursive: true });

        const processOutput = currentSession.app.output();
        const snapshot: {
            capturedAt: string;
            failure: string;
            screenshotPath: string;
            visibleScreenshotPath: string;
            rendererState: unknown;
            recentLog: string[];
            logCaptureError?: string;
            processOutput: { stdout: string; stderr: string };
        } = {
            capturedAt: new Date().toISOString(),
            failure: redactDiagnosticLine(
                (error instanceof Error ? (error.stack ?? error.message) : String(error)).slice(0, 2000)
            ),
            screenshotPath,
            visibleScreenshotPath,
            rendererState: { unavailable: true },
            recentLog: [],
            processOutput: {
                stdout: processOutput.stdout
                    .split(/\r?\n/u)
                    .slice(-30)
                    .map(redactDiagnosticLine)
                    .join("\n")
                    .slice(-3000),
                stderr: processOutput.stderr
                    .split(/\r?\n/u)
                    .slice(-30)
                    .map(redactDiagnosticLine)
                    .join("\n")
                    .slice(-3000),
            },
        };

        const capturedScreenshot = await captureObsidianPage(
            currentSession.remoteDebuggingPort,
            "startup-content-check-failure.png",
            async (page) => {
                await page.screenshot({ path: visibleScreenshotPath, fullPage: true });
                try {
                    snapshot.rendererState = await page.evaluate(async () => {
                        const host = globalThis as StartupFailureGlobal;
                        const core = host.app?.plugins?.plugins?.["obsidian-livesync"]?.core;
                        let unresolvedMessages: string[] = [];
                        let unresolvedMessagesError: string | undefined;
                        try {
                            const messages = await core?.services?.appLifecycle?.getUnresolvedMessages?.();
                            unresolvedMessages = (messages ?? [])
                                .flat()
                                .filter((message) => message !== undefined && message !== null)
                                .map((message) => String(message).slice(0, 300))
                                .slice(-20);
                        } catch (diagnosticError) {
                            unresolvedMessagesError =
                                diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError);
                        }
                        return {
                            url: location.href,
                            title: document.title,
                            bodyText: (document.body?.innerText ?? "").slice(0, 1200),
                            notices: Array.from(document.querySelectorAll(".notice"))
                                .slice(0, 10)
                                .map((notice) => (notice.textContent ?? "").trim().slice(0, 300)),
                            coreAvailable: core !== undefined,
                            databaseReady: core?.services?.database?.isDatabaseReady?.() ?? false,
                            appReady: core?.services?.appLifecycle?.isReady?.() ?? false,
                            suspended: core?.services?.appLifecycle?.isSuspended?.() ?? false,
                            unresolvedMessages,
                            unresolvedMessagesError,
                        };
                    });
                } catch (snapshotError) {
                    snapshot.rendererState = {
                        error: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
                    };
                }

                try {
                    const opened = await page.evaluate(
                        (commandId) =>
                            (globalThis as StartupFailureGlobal).app?.commands?.executeCommandById?.(commandId) ===
                            true,
                        "obsidian-livesync:view-log"
                    );
                    if (!opened) throw new Error("The Show log command was not registered.");
                    const logPane = page.locator(".logpane");
                    await logPane.waitFor({ state: "visible", timeout: 3000 });
                    snapshot.recentLog = (await logPane.locator(".log pre").allTextContents())
                        .slice(-30)
                        .map((line) => redactDiagnosticLine(line.slice(0, 800)));
                } catch (logError) {
                    snapshot.logCaptureError = logError instanceof Error ? logError.message : String(logError);
                }
                await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
                console.error("Startup content check failure diagnostics: " + snapshotPath);
            }
        );
        console.error("Startup content check failure screenshot: " + capturedScreenshot);
        console.error("Startup content check visible-page screenshot: " + visibleScreenshotPath);
    }

    const countJson = JSON.stringify(fileCount);
    const targetPathJson = JSON.stringify(targetPath);

    try {
        await createFixtures(vault.path, fileCount, fixtureMtime);
        // The controlled bootstrap establishes the isolated profile and compatibility marker.
        // The two compared starts below are natural Obsidian cold restarts.
        const bootstrapMs = await launch("controlled", "controlled bootstrap", true);
        const initial = await evaluate<InitialState>(
            [
                "require(core,'Self-hosted LiveSync did not load');",
                "require(core.services.setting.currentSettings().strictContentCheckOnStartup===false,",
                "  'The bootstrap did not use strictContentCheckOnStartup=false');",
                "require(await core.services.fileProcessing.commitPendingFileEvents(),",
                "  'The bootstrap local file events did not flush');",
                "const fixturePaths=new Set(Array.from({length:",
                countJson,
                "},(_,index)=>'startup-content-check-'+String(index).padStart(5,'0')+'.md'));",
                "let indexedCount=0,conflictCount=0;",
                "for await(const meta of core.localDatabase.findAllNormalDocs({conflicts:true})||[]){",
                "  if(!fixturePaths.has(meta.path))continue;",
                "  indexedCount++;",
                "  if((meta._conflicts??[]).length>0)conflictCount++;",
                "}",
                "const pending=await core.serviceModules.storageAccess.vaultManager.adapter.persistence.loadSnapshot()??[];",
                "const target=await targetState(",
                targetPathJson,
                ");",
                "return JSON.stringify({fileCount:",
                countJson,
                ",indexedCount,conflictCount,pendingCount:pending.length,",
                "strictContentCheckOnStartup:core.services.setting.currentSettings().strictContentCheckOnStartup===true,",
                "targetProvenanceValid:target.provenanceRevision===target.rev&&",
                "  typeof target.contentHash==='string'&&target.contentHash!==''&&target.contentSize===target.size,",
                "target});",
            ].join("\n")
        );
        assertEqual(initial.fileCount, fileCount, "The reported initial fixture count differed.");
        assertEqual(initial.indexedCount, fileCount, "The pre-created files were not all indexed on bootstrap.");
        assertEqual(initial.conflictCount, 0, "The initial fixture unexpectedly contained conflict branches.");
        assertEqual(initial.pendingCount, 0, "Pending storage work remained before the cold restart.");
        assertEqual(
            initial.strictContentCheckOnStartup,
            false,
            "The initial strict startup setting was unexpectedly enabled."
        );
        assertEqual(
            initial.targetProvenanceValid,
            true,
            "The target did not have current persisted content provenance."
        );
        assertEqual(
            initial.target.rawMtime,
            fixtureMtime,
            "The initial provenance did not retain the fixture's exact integer-millisecond mtime."
        );
        assertEqual(initial.target.dbContent, versions[0], "The initial target body was not stored.");
        assertEqual(initial.target.vaultContent, versions[0], "The initial target Vault body differed.");
        assertEqual(initial.target.documentSize, initial.target.size, "The initial Chunk size differed from Metadata.");
        assertEqual(
            initial.target.adapterSize,
            initial.target.size,
            "The initial adapter byte size differed from Metadata."
        );
        assertEqual(
            initial.target.storageSize,
            initial.target.size,
            "The initial StorageAccess byte size differed from Metadata."
        );
        assertEqual(
            initial.target.contentHash,
            sha256(versions[0]),
            "The initial provenance hash did not match the body."
        );
        assertEqual(
            initial.target.contentSize,
            Buffer.byteLength(versions[0], "utf-8"),
            "The initial provenance byte size was wrong."
        );
        assertEqual(
            initial.target.provenanceRevision,
            initial.target.rev,
            "Initial provenance did not match the current branch."
        );
        assertEqual(initial.target.conflictCount, 0, "The initial target had a conflict branch.");
        assertEqual(initial.target.branchCount, 1, "The initial target did not have exactly one branch.");
        assertExactMtime(initial.target, "bootstrap");

        await stopSession();
        await restoreOfflineEdit(
            vault.path,
            versions[1],
            requireRecordedMtime(initial.target, "default-off cold restart"),
            initial.target.size,
            "default-off cold restart"
        );

        const ordinaryStartupMs = await launch("natural", "default-off natural cold restart");
        const ordinary = await evaluate<TargetState & { strictContentCheckOnStartup: boolean; pendingCount: number }>(
            [
                "const state=await targetState(",
                targetPathJson,
                ");",
                "const pending=await core.serviceModules.storageAccess.vaultManager.adapter.persistence.loadSnapshot()??[];",
                "return JSON.stringify({...state,pendingCount:pending.length,strictContentCheckOnStartup:",
                "core.services.setting.currentSettings().strictContentCheckOnStartup===true});",
            ].join("\n")
        );
        assertEqual(
            ordinary.strictContentCheckOnStartup,
            false,
            "The natural default-off restart enabled strict body checks."
        );
        assertEqual(ordinary.pendingCount, 0, "Pending storage work remained during the default-off restart.");
        assertEqual(ordinary.rev, initial.target.rev, "The default-off restart changed the local Metadata revision.");
        assertEqual(ordinary.dbContent, versions[0], "The default-off restart changed the local database body.");
        assertEqual(ordinary.vaultContent, versions[1], "The default-off restart overwrote the offline Vault edit.");
        assertEqual(ordinary.size, initial.target.size, "The default-off restart changed the Metadata byte size.");
        assertEqual(ordinary.documentSize, initial.target.size, "The default-off restart changed the Chunk byte size.");
        assertEqual(
            ordinary.adapterSize,
            initial.target.size,
            "The default-off restart changed the adapter byte size."
        );
        assertEqual(
            ordinary.storageSize,
            initial.target.size,
            "The default-off restart changed the StorageAccess byte size."
        );
        assertEqual(
            ordinary.provenanceRevision,
            initial.target.rev,
            "The default-off restart changed persisted provenance."
        );
        assertEqual(
            ordinary.contentHash,
            initial.target.contentHash,
            "The default-off restart changed the recorded content hash."
        );
        assertEqual(
            ordinary.contentSize,
            initial.target.contentSize,
            "The default-off restart changed the recorded byte size."
        );
        assertEqual(ordinary.conflictCount, 0, "The default-off restart created a conflict branch.");
        assertEqual(ordinary.branchCount, 1, "The default-off restart changed the branch count.");
        assertExactMtime(ordinary, "default-off natural restart");

        const manual = await evaluate<ManualScanState>(
            [
                "const startedAt=Date.now();",
                "const scanResult=await core.services.vault.scanVault(true);",
                "const scanMs=Date.now()-startedAt;",
                "require(scanResult===true,'The explicit strict manual Vault scan did not complete');",
                "const state=await targetState(",
                targetPathJson,
                ");",
                "core.settings.strictContentCheckOnStartup=true;",
                "await core.services.setting.saveSettingData();",
                "require(core.services.setting.currentSettings().strictContentCheckOnStartup===true,",
                "  'The strict startup setting did not persist in the active settings');",
                "return JSON.stringify({...state,scanResult,scanMs,strictContentCheckOnStartup:",
                "core.services.setting.currentSettings().strictContentCheckOnStartup===true});",
            ].join("\n")
        );
        assertEqual(manual.scanResult, true, "The explicit strict manual scan returned an unexpected result.");
        assertEqual(manual.dbContent, versions[1], "The manual strict scan did not detect the same-stat offline edit.");
        assertEqual(manual.vaultContent, versions[1], "The manual strict scan changed the Vault body.");
        assertEqual(manual.size, initial.target.size, "The manual strict scan changed the Metadata byte size.");
        assertEqual(manual.documentSize, initial.target.size, "The manual strict scan changed the Chunk byte size.");
        assertEqual(manual.adapterSize, initial.target.size, "The manual strict scan changed the adapter byte size.");
        assertEqual(
            manual.storageSize,
            initial.target.size,
            "The manual strict scan changed the StorageAccess byte size."
        );
        requireCondition(
            manual.rev !== ordinary.rev,
            "The manual strict scan did not create a revision for the offline edit."
        );
        assertEqual(
            manual.provenanceRevision,
            manual.rev,
            "The manual scan did not record provenance for the detected edit."
        );
        assertEqual(manual.contentHash, sha256(versions[1]), "The manual scan recorded the wrong content hash.");
        assertEqual(manual.contentSize, initial.target.size, "The manual scan recorded the wrong content size.");
        assertEqual(manual.conflictCount, 0, "The manual strict scan created a conflict branch.");
        assertEqual(manual.branchCount, 1, "The manual strict scan changed the branch count.");
        assertEqual(manual.strictContentCheckOnStartup, true, "The strict startup setting was not saved.");
        assertExactMtime(manual, "manual strict scan");

        await stopSession();
        await restoreOfflineEdit(
            vault.path,
            versions[2],
            requireRecordedMtime(manual, "strict cold restart"),
            manual.size,
            "strict cold restart"
        );

        const strictStartupMs = await launch("natural", "strict natural cold restart");
        const strict = await evaluate<TargetState & { strictContentCheckOnStartup: boolean; pendingCount: number }>(
            [
                "const state=await targetState(",
                targetPathJson,
                ");",
                "const pending=await core.serviceModules.storageAccess.vaultManager.adapter.persistence.loadSnapshot()??[];",
                "return JSON.stringify({...state,pendingCount:pending.length,strictContentCheckOnStartup:",
                "core.services.setting.currentSettings().strictContentCheckOnStartup===true});",
            ].join("\n")
        );
        assertEqual(strict.strictContentCheckOnStartup, true, "The natural strict restart did not retain its setting.");
        assertEqual(strict.pendingCount, 0, "Pending storage work remained during the strict restart.");
        requireCondition(
            strict.rev !== manual.rev,
            "The strict natural restart did not detect the same-stat offline edit."
        );
        assertEqual(strict.dbContent, versions[2], "The strict natural restart did not store the offline Vault body.");
        assertEqual(strict.vaultContent, versions[2], "The strict natural restart changed the offline Vault body.");
        assertEqual(strict.size, manual.size, "The strict natural restart changed the Metadata byte size.");
        assertEqual(strict.documentSize, manual.size, "The strict natural restart changed the Chunk byte size.");
        assertEqual(strict.adapterSize, manual.size, "The strict natural restart changed the adapter byte size.");
        assertEqual(strict.storageSize, manual.size, "The strict natural restart changed the StorageAccess byte size.");
        assertEqual(
            strict.provenanceRevision,
            strict.rev,
            "The strict restart did not persist current file provenance."
        );
        assertEqual(strict.contentHash, sha256(versions[2]), "The strict restart recorded the wrong content hash.");
        assertEqual(strict.contentSize, manual.size, "The strict restart recorded the wrong byte size.");
        assertEqual(strict.conflictCount, 0, "The strict natural restart created a conflict branch.");
        assertEqual(strict.branchCount, 1, "The strict natural restart changed the branch count.");
        assertExactMtime(strict, "strict natural restart");

        const screenshotSettings = await evaluate<{ strictContentCheckOnStartup: boolean; useAdvancedMode: boolean }>(
            [
                "core.settings.strictContentCheckOnStartup=false;",
                "core.settings.useAdvancedMode=true;",
                "await core.services.setting.saveSettingData();",
                "const settings=core.services.setting.currentSettings();",
                "return JSON.stringify({strictContentCheckOnStartup:settings.strictContentCheckOnStartup===true,",
                "useAdvancedMode:settings.useAdvancedMode===true});",
            ].join("\n")
        );
        assertEqual(
            screenshotSettings.strictContentCheckOnStartup,
            false,
            "The screenshot fixture did not reset strict content checking to OFF after the startup assertions."
        );
        assertEqual(
            screenshotSettings.useAdvancedMode,
            true,
            "The screenshot fixture did not expose the Advanced page."
        );
        const settingScreenshots = await captureSettingScreenshots();

        console.log(
            JSON.stringify(
                {
                    ok: true,
                    bundleSha256: bundleHash,
                    fixtureFileCount: fileCount,
                    localOnly: true,
                    bootstrapPluginStartup: "controlled",
                    measuredRestartsPluginStartup: "natural",
                    observations: {
                        bootstrap: {
                            indexedCount: initial.indexedCount,
                            targetProvenanceValid: initial.targetProvenanceValid,
                            conflictCount: initial.conflictCount,
                            pendingCount: initial.pendingCount,
                        },
                        defaultOffRestart: {
                            revisionUnchanged: ordinary.rev === initial.target.rev,
                            databaseBodyUnchanged: ordinary.dbContent === versions[0],
                            offlineVaultBodyPreserved: ordinary.vaultContent === versions[1],
                            branchCount: ordinary.branchCount,
                            provenanceRevision: ordinary.provenanceRevision,
                        },
                        manualStrictScan: {
                            detectedOfflineEdit: manual.dbContent === versions[1],
                            revisionChanged: manual.rev !== ordinary.rev,
                            branchCount: manual.branchCount,
                            provenanceRevision: manual.provenanceRevision,
                            scanMs: manual.scanMs,
                        },
                        strictRestart: {
                            detectedOfflineEdit: strict.dbContent === versions[2],
                            revisionChanged: strict.rev !== manual.rev,
                            branchCount: strict.branchCount,
                            provenanceRevision: strict.provenanceRevision,
                        },
                    },
                    timing: {
                        scope: "Bootstrap and natural restart timings run from startObsidianLiveSyncSession() invocation through waitForLiveSyncCoreReady() completion. They include Obsidian launch, Vault open, plug-in startup, and runner readiness; they are not isolated scanner timings. manualStrictScanMs measures only the scanVault(true) call inside the running renderer.",
                        bootstrapMs,
                        ordinaryStartupMs,
                        manualStrictScanMs: manual.scanMs,
                        strictStartupMs,
                    },
                    settingScreenshots,
                },
                null,
                2
            )
        );
    } catch (error) {
        try {
            await captureFailureEvidence(error);
        } catch (captureError) {
            console.warn(
                "Could not capture startup content check failure evidence: " +
                    (captureError instanceof Error ? captureError.message : String(captureError))
            );
        }
        throw error;
    } finally {
        try {
            await stopSession();
        } finally {
            await vault.dispose();
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
