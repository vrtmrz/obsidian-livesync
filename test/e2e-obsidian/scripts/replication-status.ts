import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";
import type { Page } from "playwright";

const fixturePath = "replication-status-e2e.md";
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_UI_TIMEOUT_MS ?? 10000);
const fastForwardLingerMs = 3000;
const numericKeys = ["network", "sent", "push-remaining", "arrived", "pull-remaining", "ff"] as const;

type TestReplicationStatics = {
    sent: number;
    arrived: number;
    maxPullSeq: number;
    maxPushSeq: number;
    lastSyncPullSeq: number;
    lastSyncPushSeq: number;
    syncStatus: "CONNECTED";
    couchDB: {
        phase: "continuous";
        pull: { checkedChanges: number; completedBatches: number; checking: boolean };
        push: { checkedChanges: number; completedBatches: number; checking: boolean };
    };
};

type WritableSource<T> = { value: T };
type TestLeaf = {
    containerEl?: HTMLElement;
    view?: { containerEl?: HTMLElement };
    openFile?: (file: unknown) => Promise<void>;
    detach?: () => void;
};
type TestWorkspace = {
    activeLeaf?: TestLeaf | null;
    getLeaf?: (newLeaf?: boolean | "split" | "tab" | "window", direction?: "horizontal" | "vertical") => TestLeaf;
    openPopoutLeaf?: () => TestLeaf;
    setActiveLeaf?: (leaf: TestLeaf, params?: { focus?: boolean }) => void;
    iterateAllLeaves?: (callback: (leaf: TestLeaf) => void) => void;
    getActiveFile?: () => { path?: string } | null;
};
type TestLogModule = {
    statusLog?: WritableSource<string>;
    statusDiv?: HTMLElement;
    statusLine?: HTMLElement;
    statusLineRenderer?: { render?: (parts: readonly unknown[]) => void };
    statusBarLabels?: WritableSource<{ parts: readonly unknown[] }>;
    __addLog?: (message: unknown, level?: number, key?: string) => void;
};
type TestCore = {
    modules?: unknown[];
    services?: {
        setting?: { currentSettings?: () => Record<string, unknown> };
        replicator?: {
            replicationStatics?: WritableSource<TestReplicationStatics>;
        };
        API?: {
            requestCount?: WritableSource<number>;
            responseCount?: WritableSource<number>;
        };
    };
};
type TestApp = {
    plugins?: {
        plugins?: { "obsidian-livesync"?: { core?: TestCore } };
    };
    vault?: {
        getAbstractFileByPath?: (path: string) => unknown | null;
        create?: (path: string, content: string) => Promise<unknown>;
    };
    workspace?: TestWorkspace;
};
type TestWindow = typeof globalThis & {
    app?: TestApp;
    require?: (moduleName: string) => unknown;
    __livesyncStatusFixtureFile?: unknown;
    __livesyncStatusFirstLeaf?: TestLeaf;
    __livesyncStatusSplitLeaf?: TestLeaf;
    __livesyncStatusPopoutLeaf?: TestLeaf;
    __livesyncStatusNode?: HTMLElement;
};
type MainWindowControl = {
    hidden: boolean;
    method?: string;
    reason?: string;
    restore(): Promise<void>;
};

function failUnless(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function replicationStats(checkedChanges: number, sent: number, arrived: number): TestReplicationStatics {
    return {
        sent,
        arrived,
        maxPullSeq: sent + 1,
        maxPushSeq: sent + 1,
        lastSyncPullSeq: 1,
        lastSyncPushSeq: 1,
        syncStatus: "CONNECTED",
        couchDB: {
            phase: "continuous",
            pull: { checkedChanges, completedBatches: 0, checking: true },
            push: { checkedChanges: 0, completedBatches: 0, checking: false },
        },
    };
}

async function installFixtureFile(page: Page): Promise<void> {
    const result = await page.evaluate(async (path) => {
        const app = (globalThis as TestWindow).app;
        const workspace = app?.workspace;
        const vault = app?.vault;
        if (!workspace?.getLeaf || !workspace.setActiveLeaf || !vault?.create || !vault.getAbstractFileByPath) {
            return { ready: false, reason: "Obsidian workspace APIs are unavailable." };
        }
        let file = vault.getAbstractFileByPath(path);
        if (!file) file = await vault.create(path, "Replication status renderer fixture.\n");
        const leaf = workspace.getLeaf(false);
        if (!leaf.openFile) return { ready: false, reason: "The active workspace leaf cannot open a file." };
        await leaf.openFile(file);
        workspace.setActiveLeaf(leaf, { focus: true });
        (globalThis as TestWindow).__livesyncStatusFixtureFile = file;
        (globalThis as TestWindow).__livesyncStatusFirstLeaf = leaf;
        return { ready: true };
    }, fixturePath);
    if (!result.ready)
        throw new Error("reason" in result ? result.reason : "Could not initialise the fixture editor leaf.");
}

async function injectReplicationStats(
    page: Page,
    stats: TestReplicationStatics,
    requestCount: number,
    responseCount: number
): Promise<void> {
    const result = await page.evaluate(
        ({ stats, requestCount, responseCount }) => {
            const core = (globalThis as TestWindow).app?.plugins?.plugins?.["obsidian-livesync"]?.core;
            const replicator = core?.services?.replicator;
            const api = core?.services?.API;
            if (!replicator?.replicationStatics || !api?.requestCount || !api.responseCount) {
                return { ready: false, reason: "LiveSync replication status sources are unavailable." };
            }
            replicator.replicationStatics.value = stats;
            api.requestCount.value = requestCount;
            api.responseCount.value = responseCount;
            return { ready: true };
        },
        { stats, requestCount, responseCount }
    );
    if (!result.ready)
        throw new Error("reason" in result ? result.reason : "Could not inject replication status fixtures.");
}

async function appendLiveSyncLog(page: Page, message: string): Promise<void> {
    const result = await page.evaluate((message) => {
        const core = (globalThis as TestWindow).app?.plugins?.plugins?.["obsidian-livesync"]?.core;
        const modules = core?.modules ?? [];
        const moduleLog = modules.find((entry): entry is TestLogModule => {
            if (typeof entry !== "object" || entry === null) return false;
            const candidate = entry as TestLogModule;
            return typeof candidate.__addLog === "function" && candidate.statusLog !== undefined;
        });
        if (!moduleLog?.__addLog) return { ready: false, reason: "LiveSync logging is unavailable." };
        moduleLog.__addLog(message);
        return { ready: true };
    }, message);
    if (!result.ready) throw new Error("reason" in result ? result.reason : "Could not append a LiveSync log entry.");
}

async function waitForPartText(page: Page, key: string, expected: string): Promise<void> {
    const selector = `.livesync-status-statusline .livesync-stat-${key} .livesync-stat-value`;
    await page.waitForFunction(
        ({ selector, expected }) => document.querySelector(selector)?.textContent?.trim() === expected,
        { selector, expected },
        { timeout: uiTimeoutMs }
    );
}

async function waitForLogMessage(page: Page, expected: string, timeout = uiTimeoutMs): Promise<void> {
    await page.waitForFunction(
        (message) => document.querySelector(".livesync-status-logmessage")?.textContent?.includes(message) === true,
        expected,
        { timeout }
    );
}

async function assertSingleOverlay(contextPages: Page[], expectedCount = 1): Promise<void> {
    const counts = await Promise.all(
        contextPages.map(
            async (page) =>
                await page
                    .locator(".livesync-status")
                    .count()
                    .catch(() => 0)
        )
    );
    const actualCount = counts.reduce((total, count) => total + count, 0);
    failUnless(
        actualCount === expectedCount,
        `Expected ${expectedCount} LiveSync status overlay across Obsidian windows, found ${actualCount} (${counts.join(", ")}).`
    );
}

async function waitForOverlayOnActiveLeaf(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const host = globalThis as TestWindow;
            const status = host.__livesyncStatusNode;
            const activeLeaf = host.app?.workspace?.activeLeaf;
            return (
                status !== undefined &&
                document.querySelectorAll(".livesync-status").length === 1 &&
                document.querySelector(".livesync-status") === status &&
                activeLeaf?.view?.containerEl?.contains(status) === true
            );
        },
        undefined,
        { timeout: uiTimeoutMs }
    );
}

async function getStatusDiagnostics(page: Page): Promise<Record<string, unknown>> {
    return await page.evaluate(() => {
        const app = (globalThis as TestWindow).app;
        const core = app?.plugins?.plugins?.["obsidian-livesync"]?.core;
        const moduleLog = core?.modules?.find((entry): entry is TestLogModule => {
            if (typeof entry !== "object" || entry === null) return false;
            const candidate = entry as TestLogModule;
            return candidate.statusDiv !== undefined || candidate.statusLineRenderer !== undefined;
        });
        const currentSettings = core?.services?.setting?.currentSettings?.();
        const status = document.querySelector<HTMLElement>(".livesync-status");
        const statusParent = status?.parentElement;
        const activeLeaf = app?.workspace?.activeLeaf;
        const recentLeaf = app?.workspace?.getLeaf?.(false);
        const statusStyle = status ? getComputedStyle(status) : undefined;
        const statusParentStyle = statusParent ? getComputedStyle(statusParent) : undefined;
        const activeLeafContainer = activeLeaf?.view?.containerEl;
        const recentLeafContainer = recentLeaf?.view?.containerEl;
        const activeLeafStyle = activeLeafContainer ? getComputedStyle(activeLeafContainer) : undefined;
        const recentLeafStyle = recentLeafContainer ? getComputedStyle(recentLeafContainer) : undefined;
        return {
            settings: currentSettings
                ? {
                      isConfigured: currentSettings.isConfigured,
                      showStatusOnEditor: currentSettings.showStatusOnEditor,
                      showStatusOnStatusbar: currentSettings.showStatusOnStatusbar,
                  }
                : undefined,
            statusCount: document.querySelectorAll(".livesync-status").length,
            status: status
                ? {
                      tag: status.tagName,
                      className: status.className,
                      display: statusStyle?.display,
                      visibility: statusStyle?.visibility,
                  }
                : undefined,
            statusParent: statusParent
                ? {
                      tag: statusParent.tagName,
                      className: statusParent.className,
                      display: statusParentStyle?.display,
                      visibility: statusParentStyle?.visibility,
                  }
                : undefined,
            moduleHasStatusDiv: moduleLog?.statusDiv !== undefined,
            moduleStatusLine: moduleLog?.statusLine
                ? {
                      tag: moduleLog.statusLine.tagName,
                      className: moduleLog.statusLine.className,
                  }
                : undefined,
            activeFile: app?.workspace?.getActiveFile?.()?.path,
            activeLeafContainer: activeLeafContainer
                ? {
                      tag: activeLeafContainer.tagName,
                      className: activeLeafContainer.className,
                      display: activeLeafStyle?.display,
                      visibility: activeLeafStyle?.visibility,
                  }
                : undefined,
            recentLeafContainer: recentLeafContainer
                ? {
                      tag: recentLeafContainer.tagName,
                      className: recentLeafContainer.className,
                      display: recentLeafStyle?.display,
                      visibility: recentLeafStyle?.visibility,
                  }
                : undefined,
            statusInActiveLeaf: activeLeafContainer?.contains(status) ?? false,
            statusInRecentLeaf: recentLeafContainer?.contains(status) ?? false,
        };
    });
}

async function waitForPopoutPage(page: Page, marker: string): Promise<Page> {
    const deadline = Date.now() + uiTimeoutMs;
    const selector = `[data-e2e-status-popout="${marker}"]`;
    while (Date.now() < deadline) {
        for (const candidate of page.context().pages()) {
            if (
                (await candidate
                    .locator(selector)
                    .count()
                    .catch(() => 0)) > 0
            )
                return candidate;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Obsidian did not expose the popout renderer containing ${selector}.`);
}

async function createPopoutLeaf(page: Page, marker: string): Promise<void> {
    const result = await page.evaluate(async (marker) => {
        const host = globalThis as TestWindow;
        const app = host.app;
        const workspace = app?.workspace;
        const file = host.__livesyncStatusFixtureFile;
        if (!workspace?.openPopoutLeaf || !workspace.setActiveLeaf || file === undefined) {
            return { ready: false, reason: "Obsidian popout workspace APIs are unavailable." };
        }
        const leaf = workspace.openPopoutLeaf();
        if (!leaf.openFile || !leaf.containerEl) return { ready: false, reason: "The popout leaf is incomplete." };
        leaf.containerEl.dataset.e2eStatusPopout = marker;
        await leaf.openFile(file);
        workspace.setActiveLeaf(leaf, { focus: true });
        host.__livesyncStatusPopoutLeaf = leaf;
        return { ready: true };
    }, marker);
    if (!result.ready) throw new Error("reason" in result ? result.reason : "Could not open an Obsidian popout leaf.");
}

async function switchToLeaf(page: Page, leafName: "first" | "split"): Promise<void> {
    const result = await page.evaluate((leafName) => {
        const host = globalThis as TestWindow;
        const workspace = host.app?.workspace;
        const leaf = leafName === "first" ? host.__livesyncStatusFirstLeaf : host.__livesyncStatusSplitLeaf;
        if (!workspace?.setActiveLeaf || !leaf) return { ready: false };
        workspace.setActiveLeaf(leaf, { focus: true });
        return { ready: true };
    }, leafName);
    failUnless(result.ready, `Could not activate the ${leafName} editor leaf.`);
    await waitForOverlayOnActiveLeaf(page);
}

async function createSplitLeaf(page: Page): Promise<void> {
    const result = await page.evaluate(async () => {
        const host = globalThis as TestWindow;
        const workspace = host.app?.workspace;
        const file = host.__livesyncStatusFixtureFile;
        if (!workspace?.getLeaf || !workspace.setActiveLeaf || file === undefined) {
            return { ready: false, reason: "Obsidian split workspace APIs are unavailable." };
        }
        const leaf = workspace.getLeaf("split", "vertical");
        if (!leaf.openFile) return { ready: false, reason: "The split leaf cannot open a file." };
        await leaf.openFile(file);
        workspace.setActiveLeaf(leaf, { focus: true });
        host.__livesyncStatusSplitLeaf = leaf;
        return { ready: true };
    });
    if (!result.ready) throw new Error("reason" in result ? result.reason : "Could not create a split editor leaf.");
}

async function observeRepeatedRendering(page: Page): Promise<{ mutationCount: number; elapsedMs: number }> {
    return await page.evaluate(async () => {
        const core = (globalThis as TestWindow).app?.plugins?.plugins?.["obsidian-livesync"]?.core;
        const modules = core?.modules ?? [];
        const moduleLog = modules.find((entry): entry is TestLogModule => {
            if (typeof entry !== "object" || entry === null) return false;
            const candidate = entry as TestLogModule;
            return (
                typeof candidate.statusLineRenderer?.render === "function" && candidate.statusBarLabels !== undefined
            );
        });
        const statusLine = document.querySelector(".livesync-status-statusline");
        if (!moduleLog?.statusLineRenderer?.render || !moduleLog.statusBarLabels || !statusLine) {
            throw new Error("The LiveSync status renderer is unavailable for the idempotence observation.");
        }
        let mutationCount = 0;
        const observer = new MutationObserver((records) => {
            mutationCount += records.length;
        });
        observer.observe(statusLine, { attributes: true, characterData: true, childList: true, subtree: true });
        const parts = moduleLog.statusBarLabels.value.parts;
        const startedAt = performance.now();
        for (let iteration = 0; iteration < 1000; iteration++) {
            moduleLog.statusLineRenderer.render(parts);
        }
        const elapsedMs = performance.now() - startedAt;
        await new Promise((resolve) => setTimeout(resolve, 0));
        observer.disconnect();
        return { mutationCount, elapsedMs };
    });
}

async function measureNumericWidths(page: Page): Promise<Record<(typeof numericKeys)[number], number>> {
    const measurements = await page.evaluate((keys) => {
        const result: Record<string, number> = {};
        const statusLine = document.querySelector(".livesync-status-statusline");
        if (!statusLine) throw new Error("The LiveSync editor status line is unavailable.");
        for (const key of keys) {
            const value = statusLine.querySelector<HTMLElement>(`.livesync-stat-${key} .livesync-stat-value`);
            if (!value || value.hidden) throw new Error(`The numeric status item ${key} is not visible.`);
            if (getComputedStyle(value).fontVariantNumeric !== "tabular-nums") {
                throw new Error(`The numeric status item ${key} does not use tabular figures.`);
            }
            result[key] = value.getBoundingClientRect().width;
        }
        return result;
    }, numericKeys);
    return measurements as Record<(typeof numericKeys)[number], number>;
}

async function assertNumericWidths(
    page: Page,
    expectedValue: string
): Promise<Record<(typeof numericKeys)[number], number>> {
    for (const key of numericKeys) await waitForPartText(page, key, expectedValue);
    const widths = await page.evaluate((keys) => {
        const result: Record<string, { width: string; value: string }> = {};
        const statusLine = document.querySelector(".livesync-status-statusline");
        if (!statusLine) throw new Error("The LiveSync editor status line is unavailable.");
        for (const key of keys) {
            const value = statusLine.querySelector<HTMLElement>(`.livesync-stat-${key} .livesync-stat-value`);
            if (!value || value.hidden) throw new Error(`The numeric status item ${key} is not visible.`);
            result[key] = {
                width: value.style.getPropertyValue("--livesync-stat-width"),
                value: value.textContent?.trim() ?? "",
            };
        }
        return result;
    }, numericKeys);
    for (const key of numericKeys) {
        failUnless(widths[key]?.value === expectedValue, `Status item ${key} did not render ${expectedValue}.`);
        failUnless(widths[key]?.width === "4ch", `Status item ${key} did not retain a 4ch width.`);
    }
    return await measureNumericWidths(page);
}

async function measureStatusBarNetworkWidth(
    page: Page,
    expectedValue: string
): Promise<{ cssWidth: string; renderedWidth: number }> {
    const selector = ".syncstatusbar .livesync-stat-network .livesync-stat-value";
    await page.waitForFunction(
        ({ selector, expectedValue }) => {
            const value = document.querySelector<HTMLElement>(selector);
            return value !== null && !value.hidden && value.textContent?.trim() === expectedValue;
        },
        { selector, expectedValue },
        { timeout: uiTimeoutMs }
    );
    return await page.locator(selector).evaluate((element) => {
        const value = element as HTMLElement;
        return {
            cssWidth: value.style.getPropertyValue("--livesync-stat-width"),
            renderedWidth: value.getBoundingClientRect().width,
        };
    });
}

async function hideMainWindow(page: Page): Promise<MainWindowControl> {
    const nativeWindow = await page.evaluate((action) => {
        type ElectronWindow = {
            isVisible?: () => boolean;
            hide?: () => void;
            show?: () => void;
            focus?: () => void;
        };
        type RemoteModule = { getCurrentWindow?: () => ElectronWindow };
        const host = globalThis as TestWindow;
        let electronModule: unknown;
        try {
            electronModule = host.require?.("electron");
        } catch {
            electronModule = undefined;
        }
        const electron = electronModule as { remote?: RemoteModule } | undefined;
        let remoteModule: unknown = electron?.remote;
        if (!remoteModule) {
            try {
                remoteModule = host.require?.("@electron/remote");
            } catch {
                remoteModule = undefined;
            }
        }
        const remote = remoteModule as RemoteModule | undefined;
        const currentWindow = remote?.getCurrentWindow?.();
        if (!currentWindow?.isVisible || !currentWindow.hide || !currentWindow.show) {
            return {
                available: false,
                visible: false,
                changed: false,
                reason: "Electron remote window controls are unavailable.",
            };
        }
        if (action === "hide") {
            if (!currentWindow.isVisible()) {
                return {
                    available: true,
                    visible: false,
                    changed: false,
                    reason: "The main Electron window was already hidden.",
                };
            }
            currentWindow.hide();
            const visible = currentWindow.isVisible();
            return { available: true, visible, changed: !visible };
        }
        currentWindow.show();
        currentWindow.focus?.();
        return { available: true, visible: currentWindow.isVisible(), changed: false };
    }, "hide");
    if (nativeWindow.available && nativeWindow.changed && !nativeWindow.visible) {
        return {
            hidden: true,
            method: "Electron remote",
            async restore() {
                const restored = await page.evaluate(() => {
                    type ElectronWindow = {
                        isVisible?: () => boolean;
                        hide?: () => void;
                        show?: () => void;
                        focus?: () => void;
                    };
                    type RemoteModule = { getCurrentWindow?: () => ElectronWindow };
                    const host = globalThis as TestWindow;
                    let electronModule: unknown;
                    try {
                        electronModule = host.require?.("electron");
                    } catch {
                        electronModule = undefined;
                    }
                    const electron = electronModule as { remote?: RemoteModule } | undefined;
                    let remoteModule: unknown = electron?.remote;
                    if (!remoteModule) {
                        try {
                            remoteModule = host.require?.("@electron/remote");
                        } catch {
                            remoteModule = undefined;
                        }
                    }
                    const remote = remoteModule as RemoteModule | undefined;
                    const currentWindow = remote?.getCurrentWindow?.();
                    if (!currentWindow?.show) return false;
                    currentWindow.show();
                    currentWindow.focus?.();
                    return currentWindow.isVisible?.() === true;
                });
                if (!restored) throw new Error("The hidden main Electron window could not be restored.");
            },
        };
    }
    return {
        hidden: false,
        reason: nativeWindow.reason ?? "Electron remote did not hide the main window.",
        restore: async () => {},
    };
}

async function runStatusScenario(session: ObsidianLiveSyncSession): Promise<void> {
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        let popoutMarker: string | undefined;
        let popoutPage: Page | undefined;
        let mainWindow: MainWindowControl | undefined;
        try {
            await installFixtureFile(page);
            try {
                await page.locator(".livesync-status").waitFor({ state: "attached", timeout: uiTimeoutMs });
            } catch (error) {
                const diagnostics = await getStatusDiagnostics(page);
                throw new Error(
                    `${error instanceof Error ? error.message : String(error)}\nLiveSync status setup: ${JSON.stringify(diagnostics)}`
                );
            }
            const setup = await getStatusDiagnostics(page);
            const settings = setup.settings as { showStatusOnEditor?: unknown } | undefined;
            failUnless(
                setup.moduleHasStatusDiv === true && settings?.showStatusOnEditor === true,
                `LiveSync editor status is not enabled in the isolated vault: ${JSON.stringify(setup)}`
            );
            await injectReplicationStats(page, replicationStats(0, 0, 0), 0, 0);
            try {
                await page.locator(".livesync-status").waitFor({ state: "visible", timeout: uiTimeoutMs });
            } catch (error) {
                const diagnostics = await getStatusDiagnostics(page);
                throw new Error(
                    `${error instanceof Error ? error.message : String(error)}\nLiveSync status setup: ${JSON.stringify(diagnostics)}`
                );
            }
            await page.evaluate(() => {
                const host = globalThis as TestWindow;
                const status = document.querySelector<HTMLElement>(".livesync-status");
                if (!status) throw new Error("LiveSync editor status overlay was not created.");
                host.__livesyncStatusNode = status;
            });
            await waitForOverlayOnActiveLeaf(page);

            const initialStats = replicationStats(1000, 1000, 0);
            const startedAt = Date.now();
            await injectReplicationStats(page, initialStats, 0, 0);
            await waitForPartText(page, "arrived", "0");
            await waitForPartText(page, "ff", "1000");
            const syncIcon = await page.locator(".livesync-status-statusline .livesync-stat-sync").textContent();
            failUnless(syncIcon?.includes("⏩"), "The fast-forward checking icon was not independent of arrivals.");

            for (let update = 1; update <= 3; update++) {
                await page.waitForTimeout(700);
                await injectReplicationStats(page, replicationStats(1000, 1000 + update, 0), 0, 0);
            }
            const remainingLinger = Math.max(0, fastForwardLingerMs + 350 - (Date.now() - startedAt));
            if (remainingLinger > 0) await page.waitForTimeout(remainingLinger);
            await page.waitForFunction(
                () =>
                    document.querySelector<HTMLElement>(".livesync-status-statusline .livesync-stat-ff")?.hidden ===
                    true,
                undefined,
                { timeout: uiTimeoutMs }
            );
            const iconAfterExpiry = await page.locator(".livesync-status-statusline .livesync-stat-sync").textContent();
            failUnless(
                iconAfterExpiry?.includes("⏩"),
                "The fast-forward checking icon disappeared when its count expired."
            );

            await injectReplicationStats(page, replicationStats(1001, 1001, 1001), 1001, 0);
            const wideWidths = await assertNumericWidths(page, "1001");
            const wideStatusBarWidth = await measureStatusBarNetworkWidth(page, "1001");
            failUnless(wideStatusBarWidth.cssWidth === "4ch", "The status-bar network count did not reserve 4ch.");
            await injectReplicationStats(page, replicationStats(7, 7, 7), 7, 0);
            const narrowWidths = await assertNumericWidths(page, "7");
            const narrowStatusBarWidth = await measureStatusBarNetworkWidth(page, "7");
            for (const key of numericKeys) {
                failUnless(
                    Math.abs(wideWidths[key] - narrowWidths[key]) < 0.01,
                    `Status item ${key} changed rendered width from ${wideWidths[key]}px to ${narrowWidths[key]}px.`
                );
            }
            failUnless(
                narrowStatusBarWidth.cssWidth === "4ch" &&
                    Math.abs(wideStatusBarWidth.renderedWidth - narrowStatusBarWidth.renderedWidth) < 0.01,
                `The status-bar network count changed width from ${wideStatusBarWidth.renderedWidth}px to ${narrowStatusBarWidth.renderedWidth}px.`
            );

            const repeatedRender = await observeRepeatedRendering(page);
            failUnless(
                repeatedRender.mutationCount === 0,
                `Repeated identical status rendering caused ${repeatedRender.mutationCount} DOM mutations.`
            );
            console.log(
                `Identical status render: 1000 iterations, 0 DOM mutations, ${repeatedRender.elapsedMs.toFixed(2)} ms.`
            );

            await createSplitLeaf(page);
            await assertSingleOverlay(page.context().pages());
            await waitForOverlayOnActiveLeaf(page);
            await switchToLeaf(page, "first");
            await assertSingleOverlay(page.context().pages());
            await switchToLeaf(page, "split");
            await assertSingleOverlay(page.context().pages());
            await switchToLeaf(page, "first");
            await assertSingleOverlay(page.context().pages());

            popoutMarker = `livesync-status-${process.pid}-${Date.now()}`;
            await createPopoutLeaf(page, popoutMarker);
            popoutPage = await waitForPopoutPage(page, popoutMarker);
            await popoutPage.locator(".livesync-status").waitFor({ state: "visible", timeout: uiTimeoutMs });
            await assertSingleOverlay(page.context().pages());
            await popoutPage.waitForFunction(
                (marker) => {
                    const leaf = document.querySelector<HTMLElement>(`[data-e2e-status-popout="${marker}"]`);
                    const status = document.querySelector<HTMLElement>(".livesync-status");
                    return leaf !== null && status !== null && leaf.contains(status);
                },
                popoutMarker,
                { timeout: uiTimeoutMs }
            );

            const popoutLog = `E2E popout log ${Date.now()}`;
            await appendLiveSyncLog(page, popoutLog);
            await waitForLogMessage(popoutPage, popoutLog);

            mainWindow = await hideMainWindow(page);
            if (!mainWindow.hidden) {
                console.warn(
                    `Skipped hidden-main-window assertion: ${mainWindow.reason ?? "minimisation unavailable"}`
                );
            } else {
                await popoutPage.bringToFront();
                const hiddenWindowLog = `E2E hidden-main log ${Date.now()}`;
                await appendLiveSyncLog(page, hiddenWindowLog);
                await waitForLogMessage(popoutPage, hiddenWindowLog, Math.min(uiTimeoutMs, 2500));
                console.log(`Popout log updated while the main window was hidden through ${mainWindow.method}.`);
            }
            await mainWindow.restore();
            mainWindow = undefined;
            await page.bringToFront();
            await switchToLeaf(page, "first");
            await assertSingleOverlay(page.context().pages());
            await waitForOverlayOnActiveLeaf(page);
            failUnless(
                await page.evaluate(
                    () => (globalThis as TestWindow).__livesyncStatusNode === document.querySelector(".livesync-status")
                ),
                "The LiveSync status overlay node was replaced while moving between editor windows."
            );
            const returnedLog = `E2E main-window log ${Date.now()}`;
            await appendLiveSyncLog(page, returnedLog);
            await waitForLogMessage(page, returnedLog);
            console.log("Replication status, split-pane ownership, and popout status/log checks passed.");
        } finally {
            if (mainWindow) await mainWindow.restore();
            await page.bringToFront().catch(() => {});
            if (popoutMarker !== undefined) {
                await page
                    .evaluate((marker) => {
                        const workspace = (globalThis as TestWindow).app?.workspace;
                        workspace?.iterateAllLeaves?.((leaf) => {
                            if (leaf.containerEl?.dataset.e2eStatusPopout === marker) leaf.detach?.();
                        });
                    }, popoutMarker)
                    .catch(() => {});
            }
            if (popoutPage) await popoutPage.close().catch(() => {});
        }
    });
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    const vault = await createTemporaryVault("obsidian-livesync-replication-status-");
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: {
                liveSync: false,
                syncOnStart: false,
                syncOnSave: false,
                isConfigured: false,
                remoteType: "",
                showStatusOnEditor: true,
                showOnlyIconsOnEditor: false,
                showStatusOnStatusbar: true,
                lessInformationInLog: false,
                writeLogToTheFile: false,
            },
        });
        failUnless(session.readiness.pluginId === "obsidian-livesync", "The LiveSync plug-in did not become ready.");
        await runStatusScenario(session);
    } finally {
        if (session) await session.app.stop();
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
