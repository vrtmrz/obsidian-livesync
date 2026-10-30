import { readFileSync } from "node:fs";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";
import type { Page } from "playwright";
import { setObsidianMobileTestModeBeforePluginStart } from "../runner/mobileUi.ts";

const fixturePath = "replication-status-e2e.md";
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_UI_TIMEOUT_MS ?? 10000);
const fastForwardLingerMs = 3000;
const numericKeys = ["network", "sent", "push-remaining", "arrived", "pull-remaining", "ff-push", "ff-pull"] as const;

type TestReplicationStatics = {
    sent: number;
    arrived: number;
    maxPullSeq: number;
    maxPushSeq: number;
    lastSyncPullSeq: number;
    lastSyncPushSeq: number;
    syncStatus: "CONNECTED" | "PAUSED" | "ERRORED";
    couchDB: {
        phase: "continuous" | "idle";
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
    layoutReady?: boolean;
    getMostRecentLeaf?: () => TestLeaf | null;
    activeLeaf?: TestLeaf | null;
    getLeaf?: (newLeaf?: boolean | "split" | "tab" | "window", direction?: "horizontal" | "vertical") => TestLeaf;
    openPopoutLeaf?: () => TestLeaf;
    setActiveLeaf?: (leaf: TestLeaf, params?: { focus?: boolean }) => void;
    iterateAllLeaves?: (callback: (leaf: TestLeaf) => void) => void;
    getActiveFile?: () => { path?: string } | null;
};
type TestLogModule = {
    adjustStatusDivPosition?: () => void;
    statusLog?: WritableSource<string>;
    activeFileStatus?: WritableSource<string>;
    p2pLogCollector?: { p2pReplicationLine: WritableSource<string> };
    statusDiv?: HTMLElement;
    statusLine?: HTMLElement;
    statusLineRenderer?: { render?: (parts: readonly unknown[]) => void };
    statusBarRenderer?: { render?: (parts: readonly unknown[]) => void };
    statusBarLabels?: WritableSource<{ parts: readonly unknown[]; message: string }>;
    __addLog?: (message: unknown, level?: number, key?: string) => void;
};
type TestCore = {
    modules?: unknown[];
    services?: {
        setting?: { currentSettings?: () => Record<string, unknown> };
        replicator?: {
            replicationStatics?: WritableSource<TestReplicationStatics>;
        };
        replication?: {
            replicationResultCount: WritableSource<number>;
            databaseQueueCount: WritableSource<number>;
            storageApplyingCount: WritableSource<number>;
        };
        fileProcessing?: {
            processing: WritableSource<number>;
            totalQueued: WritableSource<number>;
            batched: WritableSource<number>;
        };
        conflict?: { conflictProcessQueueCount: WritableSource<number> };
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

function replicationStats(
    checkedChanges: number,
    sent: number,
    arrived: number,
    pushCheckedChanges = 0
): TestReplicationStatics {
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
            push: { checkedChanges: pushCheckedChanges, completedBatches: 0, checking: pushCheckedChanges > 0 },
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
        // Opening a new tab emits the active-leaf transition used by the overlay placement hook.
        const leaf = workspace.getLeaf("tab");
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
    const selector = `.livesync-status-statusline .livesync-stat-${key}:not(.livesync-stat-inactive) .livesync-stat-value`;
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
        const recentLeaf = app?.workspace?.getMostRecentLeaf?.();
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
            workspaceLayoutReady: app?.workspace?.layoutReady,
            moduleHasStatusDiv: moduleLog?.statusDiv !== undefined,
            moduleStatusDivConnected: moduleLog?.statusDiv?.isConnected,
            moduleStatusDivParent: moduleLog?.statusDiv?.parentElement?.className,
            recentLeafIsActive: recentLeaf === activeLeaf,
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
            if (getComputedStyle(value).textAlign !== "right") {
                throw new Error(`The numeric status item ${key} is not right-aligned.`);
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

async function assertEditorItemSpacing(page: Page, mobile: boolean): Promise<void> {
    const spacing = await page.evaluate(() => {
        const modules = (globalThis as TestWindow).app?.plugins?.plugins?.["obsidian-livesync"]?.core?.modules ?? [];
        const moduleLog = modules.find((entry): entry is TestLogModule => {
            if (typeof entry !== "object" || entry === null) return false;
            return typeof (entry as TestLogModule).statusLineRenderer?.render === "function";
        });
        if (!moduleLog?.statusLineRenderer?.render || !moduleLog.statusBarLabels) {
            throw new Error("The LiveSync editor status renderer is unavailable.");
        }
        const original = moduleLog.statusBarLabels.value.parts;
        const parts = [
            { key: "queue-replication", text: " 📥", value: 1 },
            { key: "queue-database", text: " 📄", value: 12 },
            { key: "queue-storage", text: " 💾", value: 3 },
        ];
        const results: { selector: string; gapsEm: number[] }[] = [];
        try {
            moduleLog.statusLineRenderer.render(parts);
            moduleLog.statusBarRenderer?.render?.(parts);
            for (const selector of [".livesync-status-statusline", ".syncstatusbar"]) {
                const root = document.querySelector<HTMLElement>(selector);
                if (!root || root.getBoundingClientRect().width === 0) continue;
                const firstItem = root.querySelector<HTMLElement>(`.livesync-stat-${parts[0].key}`);
                if (!firstItem || Number.parseFloat(getComputedStyle(firstItem).marginInlineStart) !== 0) {
                    throw new Error("Inactive predecessors left a gap before the first active status item.");
                }
                const fontSize = Number.parseFloat(getComputedStyle(root).fontSize);
                const gapsEm: number[] = [];
                for (let i = 1; i < parts.length; i++) {
                    const previous = root.querySelector<HTMLElement>(
                        `.livesync-stat-${parts[i - 1].key} .livesync-stat-value`
                    );
                    const next = root.querySelector<HTMLElement>(`.livesync-stat-${parts[i].key}`)?.firstChild;
                    if (!previous || next?.nodeType !== Node.TEXT_NODE)
                        throw new Error("A spacing fixture item is missing.");
                    const range = document.createRange();
                    range.setStart(next, next.textContent?.search(/\S/u) ?? 0);
                    range.setEnd(next, next.textContent?.length ?? 0);
                    const nextBox = range.getBoundingClientRect();
                    const previousBox = previous.getBoundingClientRect();
                    if (Math.abs(nextBox.top - previousBox.top) > 2)
                        throw new Error("The spacing fixture unexpectedly wrapped.");
                    gapsEm.push((nextBox.left - previousBox.right) / fontSize);
                }
                results.push({ selector, gapsEm });
            }
        } finally {
            moduleLog.statusLineRenderer.render(original);
            moduleLog.statusBarRenderer?.render?.(original);
        }
        return results;
    });
    const editor = spacing.find((entry) => entry.selector === ".livesync-status-statusline");
    failUnless(editor?.gapsEm.length === 2, "The editor status gaps could not be measured.");
    for (const gap of editor.gapsEm) {
        failUnless(gap >= 1 && gap <= 1.5, `Editor status items need a 1–1.5em gap; found ${gap.toFixed(3)}em.`);
    }
    if (!mobile) {
        const statusBar = spacing.find((entry) => entry.selector === ".syncstatusbar");
        failUnless(statusBar?.gapsEm.length === 2, "The status-bar gaps could not be measured.");
        failUnless(
            statusBar.gapsEm.every((gap) => gap < 1),
            "The status-bar items unexpectedly acquired the wider editor gaps."
        );
    }
    console.log(
        `${mobile ? "Mobile" : "Desktop"} editor item gaps: ${editor.gapsEm.map((gap) => gap.toFixed(3)).join(", ")}em.`
    );
}

async function assertStatusBarItemSpacing(page: Page): Promise<void> {
    const collapsedItems = await page.evaluate(() => {
        const items = document.querySelectorAll<HTMLElement>(".syncstatusbar > .livesync-stat-item");
        const collapsed: string[] = [];
        for (const item of items) {
            if (item.classList.contains("livesync-stat-inactive")) continue;
            const prefix = item.firstChild;
            if (prefix?.nodeType !== Node.TEXT_NODE || !prefix.textContent?.startsWith(" ")) continue;
            const range = document.createRange();
            range.setStart(prefix, 0);
            range.setEnd(prefix, 1);
            if (range.getBoundingClientRect().width <= 0) collapsed.push(item.className);
        }
        return collapsed;
    });
    failUnless(
        collapsedItems.length === 0,
        `Status-bar item separators lost their visible spaces: ${collapsedItems.join(", ")}.`
    );
}

async function assertInactiveItemStyling(page: Page): Promise<void> {
    const roots = [".livesync-status-statusline", ".syncstatusbar"];
    for (const root of roots) {
        const state = await page.locator(`${root} .livesync-stat-ff-pull`).evaluate((element) => {
            const item = element as HTMLElement;
            return {
                inactive: item.classList.contains("livesync-stat-inactive"),
                hidden: item.hidden,
                ariaHidden: item.getAttribute("aria-hidden"),
                display: getComputedStyle(item).display,
                text: item.textContent,
                width: item
                    .querySelector<HTMLElement>(".livesync-stat-value")
                    ?.style.getPropertyValue("--livesync-stat-width"),
                precedesUploads: item.nextElementSibling?.classList.contains("livesync-stat-sent"),
            };
        });
        failUnless(
            state.inactive && !state.hidden && state.ariaHidden === "true",
            `Inactive state was not exposed through the class in ${root}.`
        );
        failUnless(state.display === "none", `Inactive items were not hidden by the default CSS in ${root}.`);
        failUnless(
            state.text?.includes("1000") && state.width === "4ch" && state.precedesUploads,
            `An inactive item lost its content, width, or position in ${root}.`
        );
    }

    const snippet = await page.addStyleTag({
        content: ".livesync-stat-item.livesync-stat-inactive { display: inline-block; }",
    });
    try {
        for (const root of roots) {
            failUnless(
                await page.locator(`${root} .livesync-stat-ff-pull`).isVisible(),
                `A CSS override could not reveal the inactive item in ${root}.`
            );
        }
    } finally {
        await snippet.evaluate((element) => element.parentNode?.removeChild(element));
    }
    for (const root of roots) {
        failUnless(
            await page.locator(`${root} .livesync-stat-ff-pull`).isHidden(),
            `The default inactive style was not restored in ${root}.`
        );
    }
}

async function waitForComparisonCounts(page: Page, push?: number, pull?: number): Promise<void> {
    await page.waitForFunction(
        ({ push, pull }) =>
            [".livesync-status-statusline", ".syncstatusbar"].every((root) =>
                (["push", "pull"] as const).every((direction) => {
                    const value = document.querySelector(
                        `${root} .livesync-stat-ff-${direction}:not(.livesync-stat-inactive) .livesync-stat-value`
                    );
                    const expected = direction === "push" ? push : pull;
                    return expected === undefined ? value === null : value?.textContent?.trim() === String(expected);
                })
            ),
        { push, pull },
        { timeout: uiTimeoutMs }
    );
}

async function waitForSyncIcon(page: Page, icon: string): Promise<void> {
    await page.waitForFunction(
        (expected) =>
            [".livesync-status-statusline", ".syncstatusbar"].every(
                (root) => document.querySelector(`${root} .livesync-stat-sync`)?.textContent === `Sync: ${expected}`
            ),
        icon,
        { timeout: uiTimeoutMs }
    );
}

async function assertDirectionalComparison(page: Page): Promise<void> {
    const pushOnly = replicationStats(0, 0, 0, 71975);
    pushOnly.couchDB.pull.checking = false;
    await injectReplicationStats(page, pushOnly, 0, 0);
    await waitForComparisonCounts(page, 71975);
    await waitForSyncIcon(page, "⏩");
    for (const root of [".livesync-status-statusline", ".syncstatusbar"]) {
        failUnless(
            (await page.locator(`${root} .livesync-stat-sent .livesync-stat-value`).textContent())?.trim() === "0",
            `Push comparison changed the transfer count in ${root}.`
        );
    }

    await injectReplicationStats(page, replicationStats(4, 0, 0, 40), 0, 0);
    await waitForComparisonCounts(page, 40, 4);
    for (const direction of ["push", "pull"]) {
        const margin = await page
            .locator(`.livesync-status-statusline .livesync-stat-ff-${direction}`)
            .evaluate((element) => Number.parseFloat(getComputedStyle(element).marginInlineStart));
        failUnless(margin === 0, `The ${direction} comparison item acquired an extra ${margin}px editor gap.`);
    }
    for (let update = 1; update <= 3; update++) {
        await page.waitForTimeout(700);
        await injectReplicationStats(page, replicationStats(4, 0, 0, 40 + update), 0, 0);
    }
    await waitForComparisonCounts(page, 43);
    await waitForComparisonCounts(page);
    await injectReplicationStats(page, replicationStats(4, 7, 11, 43), 0, 0);
    await waitForPartText(page, "arrived", "11");
    await waitForComparisonCounts(page);

    const idle = replicationStats(4, 7, 11, 43);
    idle.syncStatus = "PAUSED";
    idle.couchDB.phase = "idle";
    idle.couchDB.push.checking = false;
    idle.couchDB.pull.checking = false;
    await injectReplicationStats(page, idle, 0, 0);
    await waitForSyncIcon(page, "💤");
    await waitForComparisonCounts(page);

    const failed = replicationStats(5, 7, 11, 44);
    failed.syncStatus = "ERRORED";
    await injectReplicationStats(page, failed, 0, 0);
    await waitForComparisonCounts(page, 44, 5);
    await waitForSyncIcon(page, "⚠");

    await injectReplicationStats(page, replicationStats(0, 0, 0), 0, 0);
    await waitForComparisonCounts(page);
    await injectReplicationStats(page, replicationStats(1, 0, 0, 1), 0, 0);
    await waitForComparisonCounts(page, 1, 1);
    await waitForSyncIcon(page, "⏩");
    const labels = await page.evaluate(() => {
        const modules = (globalThis as TestWindow).app?.plugins?.plugins?.["obsidian-livesync"]?.core?.modules ?? [];
        const moduleLog = modules.find(
            (entry): entry is TestLogModule =>
                typeof entry === "object" && entry !== null && (entry as TestLogModule).statusBarLabels !== undefined
        );
        return moduleLog?.statusBarLabels?.value.message;
    });
    failUnless(
        labels?.includes("(⏩↑ 1) (⏩↓ 1) ↑ 0 (LIVE) ↓ 0 (LIVE)"),
        `The plain-text status did not distinguish comparison directions from transfers: ${labels}`
    );
    console.log(
        "Directional comparison passed: push-only, independent expiry, idle/error icons, and fresh-run counts."
    );
}

function documentedAnimationSnippet(): string {
    const guide = readFileSync(new URL("../../../docs/tips/status-display.md", import.meta.url), "utf8");
    const section = guide.split("### Animate editor status items")[1];
    const snippet = section?.match(/```css\r?\n([\s\S]*?)\r?\n```/u)?.[1];
    failUnless(snippet, "The documented editor animation snippet could not be found.");
    return snippet;
}

async function assertDocumentedAnimation(page: Page): Promise<void> {
    const css = documentedAnimationSnippet();
    const fallbackCss = css.replace("@supports (width: calc-size(auto, size))", "@supports (width: e2e-unsupported)");
    failUnless(fallbackCss !== css, "The animation example is missing its calc-size feature guard.");
    const selector = ".livesync-status-statusline .livesync-stat-ff-push";
    await injectReplicationStats(page, replicationStats(0, 0, 0, 200), 0, 0);
    await waitForComparisonCounts(page, 200);
    const fallback = await page.addStyleTag({ content: fallbackCss });
    try {
        await injectReplicationStats(page, replicationStats(0, 0, 0), 0, 0);
        await waitForComparisonCounts(page);
        failUnless(
            (await page.locator(selector).evaluate((element) => getComputedStyle(element).display)) === "none",
            "An unsupported animation guard overrode the default inactive-item hiding."
        );
    } finally {
        await fallback.evaluate((element) => element.parentNode?.removeChild(element));
    }

    const supported = await page.evaluate(() => CSS.supports("width", "calc-size(auto, size)"));
    if (!supported) {
        console.log("Documented snippet: default hiding passed; this runtime does not support calc-size animations.");
        return;
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const style = await page.addStyleTag({ content: css });
    try {
        const item = page.locator(selector);
        await injectReplicationStats(page, replicationStats(0, 0, 0, 201), 0, 0);
        await waitForComparisonCounts(page, 201);
        await page.waitForFunction(
            (selector) => {
                const item = document.querySelector<HTMLElement>(selector);
                return item !== null && item.getBoundingClientRect().width > 1 && item.getAnimations().length === 0;
            },
            selector,
            { timeout: uiTimeoutMs }
        );
        const openWidth = await item.evaluate((element) => element.getBoundingClientRect().width);
        const original = await item.elementHandle();
        failUnless(original, "The animated comparison item is missing.");
        await injectReplicationStats(page, replicationStats(0, 0, 0), 0, 0);
        await page.waitForFunction(
            ({ selector, openWidth }) => {
                const item = document.querySelector<HTMLElement>(selector);
                const width = item?.getBoundingClientRect().width ?? 0;
                return item?.classList.contains("livesync-stat-inactive") && width > 0.5 && width < openWidth - 0.5;
            },
            { selector, openWidth },
            { timeout: uiTimeoutMs }
        );
        await page.waitForFunction(
            (selector) => {
                const item = document.querySelector<HTMLElement>(selector);
                return item !== null && item.getBoundingClientRect().width < 0.5 && item.getAnimations().length === 0;
            },
            selector,
            { timeout: uiTimeoutMs }
        );
        const collapsed = await item.evaluate((element) => ({
            display: getComputedStyle(element).display,
            margin: getComputedStyle(element).marginInlineStart,
            ariaHidden: element.getAttribute("aria-hidden"),
        }));
        failUnless(
            collapsed.display === "inline-block" && collapsed.margin === "0px" && collapsed.ariaHidden === "true",
            "The animated inactive item lost its collapsed layout or accessibility state."
        );
        await injectReplicationStats(page, replicationStats(0, 0, 0, 202), 0, 0);
        await waitForComparisonCounts(page, 202);
        await page.waitForFunction(
            ({ selector, openWidth }) => {
                const item = document.querySelector<HTMLElement>(selector);
                return item !== null && Math.abs(item.getBoundingClientRect().width - openWidth) < 0.5;
            },
            { selector, openWidth },
            { timeout: uiTimeoutMs }
        );
        failUnless(
            await original.evaluate((element, selector) => element === document.querySelector(selector), selector),
            "Reopening an animated item replaced its retained DOM node."
        );
        await original.dispose();

        await page.emulateMedia({ reducedMotion: "reduce" });
        await injectReplicationStats(page, replicationStats(0, 0, 0), 0, 0);
        await waitForComparisonCounts(page);
        const reduced = await item.evaluate((element) => ({
            width: element.getBoundingClientRect().width,
            transition: getComputedStyle(element).transitionProperty,
            animations: element.getAnimations().length,
        }));
        failUnless(
            reduced.width < 0.5 && reduced.transition === "none" && reduced.animations === 0,
            "The documented snippet did not honour reduced motion."
        );
        console.log(
            "Documented snippet passed: interpolated collapse, retained-node reopening, reduced motion, and disabled-guard fallback."
        );
    } finally {
        await style.evaluate((element) => element.parentNode?.removeChild(element));
        await page.emulateMedia({ reducedMotion: null });
    }
}

async function measureStatusBarNetworkWidth(
    page: Page,
    expectedValue: string
): Promise<{ cssWidth: string; renderedWidth: number }> {
    const selector = ".syncstatusbar .livesync-stat-network:not(.livesync-stat-inactive) .livesync-stat-value";
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

async function assertLegacyStatusPaths(page: Page): Promise<void> {
    await page.evaluate(async (timeout) => {
        const core = (globalThis as TestWindow).app?.plugins?.plugins?.["obsidian-livesync"]?.core;
        const moduleLog = core?.modules?.find((entry): entry is TestLogModule => {
            if (typeof entry !== "object" || entry === null) return false;
            return (entry as TestLogModule).statusBarLabels !== undefined;
        });
        const services = core?.services;
        const settings = services?.setting?.currentSettings?.();
        if (
            !settings ||
            !services?.replication ||
            !services.fileProcessing ||
            !services.conflict ||
            !moduleLog?.activeFileStatus ||
            !moduleLog.p2pLogCollector ||
            !moduleLog.statusBarLabels
        )
            throw new Error("The legacy status sources are unavailable.");
        const counters = [
            { key: "file-processing", mark: "⏳", source: services.fileProcessing.processing, value: 2 },
            { key: "file-pending", mark: "🛫", source: services.fileProcessing.totalQueued, value: 3 },
            { key: "file-batched", mark: "📬", source: services.fileProcessing.batched, value: 4 },
            { key: "queue-replication", mark: "📥", source: services.replication.replicationResultCount, value: 5 },
            { key: "queue-database", mark: "📄", source: services.replication.databaseQueueCount, value: 6 },
            { key: "queue-storage", mark: "💾", source: services.replication.storageApplyingCount, value: 7 },
            { key: "queue-conflicts", mark: "🔩", source: services.conflict.conflictProcessQueueCount, value: 8 },
        ];
        const warning = moduleLog.activeFileStatus;
        const p2p = moduleLog.p2pLogCollector.p2pReplicationLine;
        const labels = moduleLog.statusBarLabels;
        const previous = {
            counters: counters.map(({ source }) => source.value),
            warning: warning.value,
            p2p: p2p.value,
            hideFileWarningNotice: settings.hideFileWarningNotice,
        };
        const peerLine = "⚡ E2E peer ↑ 11/12 ↓ 13/14";
        const wait = {
            async until(condition: () => boolean, message: string) {
                const deadline = Date.now() + timeout;
                while (!condition()) {
                    if (Date.now() >= deadline) throw new Error(message);
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
            },
        };
        try {
            for (const { source, value } of counters) source.value = value;
            p2p.value = peerLine;
            settings.hideFileWarningNotice = false;
            warning.value = "E2E file warning";
            await wait.until(
                () =>
                    [".livesync-status-statusline", ".syncstatusbar"].every((root) =>
                        counters.every(({ key, value }) => {
                            const item = document.querySelector<HTMLElement>(`${root} .livesync-stat-${key}`);
                            return (
                                item !== null &&
                                getComputedStyle(item).display !== "none" &&
                                item.querySelector(".livesync-stat-value")?.textContent?.trim() === String(value)
                            );
                        })
                    ),
                "Queue values did not reach both status displays."
            );
            await wait.until(
                () =>
                    document.querySelector(".livesync-status-statusline .livesync-stat-p2p")?.textContent?.trim() ===
                        peerLine &&
                    document
                        .querySelector(".livesync-status-messagearea")
                        ?.textContent?.includes("⚠️ E2E file warning") === true,
                "The P2P line or file warning was lost from the editor display."
            );
            const plain = labels.value.message.replace(/\u2007/gu, "");
            if (
                !counters.every(({ mark, value }) => plain.includes(` ${mark}${value}`)) ||
                !plain.endsWith("\n" + peerLine)
            ) {
                throw new Error("The plain-text status lost a queue count or its separate P2P line.");
            }
            if (document.querySelector(".syncstatusbar .livesync-stat-p2p:not(.livesync-stat-inactive)")) {
                throw new Error("The status bar unexpectedly included the second-line P2P status.");
            }
            settings.hideFileWarningNotice = true;
            warning.value = "E2E file warning as an icon";
            await wait.until(
                () =>
                    document
                        .querySelector(".livesync-status-statusline .livesync-stat-file-skip")
                        ?.textContent?.trim() === "⛔ SKIP" &&
                    document
                        .querySelector(".livesync-status-messagearea")
                        ?.textContent?.includes("E2E file warning") === false,
                "The file warning did not switch to its existing compact icon."
            );
            p2p.value = "";
            await wait.until(
                () =>
                    document.querySelector(".syncstatusbar .livesync-stat-file-skip")?.textContent?.trim() ===
                        "⛔ SKIP" && labels.value.message.endsWith(" ⛔ SKIP"),
                "The single-line status lost the compact file warning."
            );
        } finally {
            counters.forEach(({ source }, index) => {
                source.value = previous.counters[index];
            });
            settings.hideFileWarningNotice = previous.hideFileWarningNotice;
            p2p.value = previous.p2p;
            warning.value = previous.warning;
        }
    }, uiTimeoutMs);
    console.log("Queue counts, P2P text, file warnings, and plain-text status remain available.");
}

async function runStatusScenario(session: ObsidianLiveSyncSession): Promise<void> {
    await withObsidianPage(session.remoteDebuggingPort, async (page) => {
        let popoutMarker: string | undefined;
        let popoutPage: Page | undefined;
        let mainWindow: MainWindowControl | undefined;
        try {
            console.log(`Replication status runtime: ${await page.evaluate(() => navigator.userAgent)}`);
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
            await waitForPartText(page, "ff-pull", "1000");
            await assertStatusBarItemSpacing(page);
            for (const root of [".livesync-status-statusline", ".syncstatusbar"]) {
                failUnless(
                    (await page.locator(`${root} .livesync-stat-ff-pull + .livesync-stat-sent`).count()) === 1,
                    `The comparison count did not appear immediately before uploads in ${root}.`
                );
            }
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
                    document
                        .querySelector(".livesync-status-statusline .livesync-stat-ff-pull")
                        ?.classList.contains("livesync-stat-inactive") === true,
                undefined,
                { timeout: uiTimeoutMs }
            );
            await assertInactiveItemStyling(page);
            const iconAfterExpiry = await page.locator(".livesync-status-statusline .livesync-stat-sync").textContent();
            failUnless(
                iconAfterExpiry?.includes("⏩"),
                "The fast-forward checking icon disappeared when its count expired."
            );

            await injectReplicationStats(page, replicationStats(1001, 1001, 1001, 1001), 1001, 0);
            const wideWidths = await assertNumericWidths(page, "1001");
            const wideStatusBarWidth = await measureStatusBarNetworkWidth(page, "1001");
            failUnless(wideStatusBarWidth.cssWidth === "4ch", "The status-bar network count did not reserve 4ch.");
            await injectReplicationStats(page, replicationStats(7, 7, 7, 7), 7, 0);
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

            await assertDirectionalComparison(page);

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
            await assertLegacyStatusPaths(page);
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
    for (const mobile of [false, true]) {
        const vault = await createTemporaryVault("obsidian-livesync-replication-status-");
        let session: ObsidianLiveSyncSession | undefined;
        try {
            session = await startObsidianLiveSyncSession({
                binary,
                cliBinary: cli.binary,
                vault,
                lifecycle: {
                    beforePluginStart: async ({ remoteDebuggingPort }) => {
                        if (mobile) {
                            await setObsidianMobileTestModeBeforePluginStart(remoteDebuggingPort, true, uiTimeoutMs);
                        }
                        // Prepare the editor before asynchronous plug-in loading can place the overlay in it.
                        await withObsidianPage(remoteDebuggingPort, installFixtureFile);
                    },
                },
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
            failUnless(
                session.readiness.pluginId === "obsidian-livesync",
                "The LiveSync plug-in did not become ready."
            );
            if (!mobile) await runStatusScenario(session);
            await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                await installFixtureFile(page);
                if (mobile) {
                    await page.evaluate(() => {
                        const modules =
                            (globalThis as TestWindow).app?.plugins?.plugins?.["obsidian-livesync"]?.core?.modules ??
                            [];
                        const moduleLog = modules.find((entry): entry is TestLogModule => {
                            if (typeof entry !== "object" || entry === null) return false;
                            return typeof (entry as TestLogModule).adjustStatusDivPosition === "function";
                        });
                        moduleLog?.adjustStatusDivPosition?.();
                    });
                }
                try {
                    await page.locator(".livesync-status").waitFor({ state: "attached", timeout: uiTimeoutMs });
                    await injectReplicationStats(page, replicationStats(0, 0, 0), 0, 0);
                    await page.locator(".livesync-status").waitFor({ state: "visible", timeout: uiTimeoutMs });
                } catch (error) {
                    throw new Error(
                        `${String(error)}; spacing setup: ${JSON.stringify(await getStatusDiagnostics(page))}`
                    );
                }
                await assertEditorItemSpacing(page, mobile);
                if (mobile) await assertDirectionalComparison(page);
                await assertDocumentedAnimation(page);
            });
        } finally {
            if (session) await session.app.stop();
            await vault.dispose();
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
