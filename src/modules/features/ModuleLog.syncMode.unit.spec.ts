import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/settings";

vi.mock("@/deps.ts", () => ({
    addIcon: vi.fn(),
    debounce: (callback: () => void) => callback,
    normalizePath: (path: string) => path,
    Notice: class {},
    stringifyYaml: vi.fn(),
}));
vi.mock("./Log/LogPaneView.ts", () => ({ LogPaneView: class {}, VIEW_TYPE_LOG: "log" }));
vi.mock("@/modules/features/ModuleLog/diagnostics/reportTool.ts", () => ({ generateReport: vi.fn() }));
vi.mock("@/common/utils.ts", () => ({ isValidPath: () => true }));
vi.mock("@/common/translation", () => ({ $msg: (key: string) => key }));
vi.mock("@/common/events.ts", () => ({
    EVENT_FILE_RENAMED: "renamed",
    EVENT_LAYOUT_READY: "ready",
    EVENT_LEAF_ACTIVE_CHANGED: "active",
    EVENT_ON_UNRESOLVED_ERROR: "error",
    eventHub: { onEvent: vi.fn() },
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/trystero/P2PLogCollector", () => ({
    P2PLogCollector: class {},
}));
vi.mock("@vrtmrz/livesync-commonlib/p2p", () => ({ EVENT_P2P_DIAGNOSTIC: "p2p-diagnostic" }));

const cleanups: (() => void)[] = [];

async function createHarness() {
    const { ModuleLog } = await import("./ModuleLog.ts");
    const { reactiveSource } = await import("octagonal-wheels/dataobject/reactive");
    const { createLiveSyncEventHub } = await import("@vrtmrz/livesync-commonlib/context");
    const { DEFAULT_SETTINGS, REMOTE_COUCHDB } = await import("@vrtmrz/livesync-commonlib/compat/common/types");
    const { EVENT_SETTING_SAVED } = await import("@vrtmrz/livesync-commonlib/compat/events/coreEvents");
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => callbacks.push(callback));
    const stats = reactiveSource({
        sent: 0,
        arrived: 0,
        maxPullSeq: 0,
        maxPushSeq: 0,
        lastSyncPullSeq: 0,
        lastSyncPushSeq: 0,
        syncStatus: "COMPLETED" as const,
    });
    const services = {
        API: {
            requestCount: reactiveSource(0),
            responseCount: reactiveSource(0),
            registerCleanup: (cleanup: () => void) => cleanups.push(cleanup),
        },
        context: { events: createLiveSyncEventHub() },
        appLifecycle: { isReloadingScheduled: () => false },
        replication: {
            replicationResultCount: reactiveSource(0),
            databaseQueueCount: reactiveSource(0),
            storageApplyingCount: reactiveSource(0),
        },
        replicator: { replicationStatics: stats, boundedRemoteActivityCount: reactiveSource(0) },
        conflict: { conflictProcessQueueCount: reactiveSource(0) },
        fileProcessing: { processing: reactiveSource(0), totalQueued: reactiveSource(0), batched: reactiveSource(0) },
    };
    const core: { services: typeof services; settings: ObsidianLiveSyncSettings } = {
        services,
        settings: {
            ...DEFAULT_SETTINGS,
            remoteType: REMOTE_COUCHDB,
            isConfigured: true,
            liveSync: true,
            periodicReplication: false,
            syncOnSave: false,
            syncOnEditorSave: false,
            syncOnStart: false,
            syncOnFileOpen: false,
            syncAfterMerge: false,
            showStatusOnEditor: true,
        },
    };
    const statusBarRenderer = { render: vi.fn(), dispose: vi.fn() };
    const statusLineRenderer = { render: vi.fn(), dispose: vi.fn() };
    const module = Object.assign(Object.create(ModuleLog.prototype), {
        core,
        statusLog: reactiveSource(""),
        activeFileStatus: reactiveSource(""),
        p2pLogCollector: { p2pReplicationStats: reactiveSource([]), dispose: vi.fn() },
        statusBarRenderer,
        statusLineRenderer,
        statusDiv: { setCssStyles: vi.fn() },
        logMessage: { innerText: "" },
    }) as InstanceType<typeof ModuleLog>;
    module.observeForLogs();

    const flushDisplay = async () => {
        await vi.advanceTimersByTimeAsync(50);
        for (const callback of callbacks.splice(0)) {
            callback(0);
        }
    };
    module.applyStatusBarText();
    await flushDisplay();
    return {
        module,
        core,
        services,
        stats,
        statusBarRenderer,
        statusLineRenderer,
        flushDisplay,
        EVENT_SETTING_SAVED,
    } as const;
}

describe("synchronisation mode display", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
    });
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) {
            cleanup();
        }
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("updates both displays after Fetch disables automatic triggers without changing transfer statistics", async () => {
        const host = await createHarness();
        expect(host.statusBarRenderer.render).toHaveBeenCalled();
        expect(host.statusLineRenderer.render).toHaveBeenCalled();
        expect(host.module.statusBarLabels.value.statusBarParts).toContainEqual(
            expect.objectContaining({ key: "sync-mode", text: "🔗" })
        );
        const initialStats = host.stats.value;
        host.statusBarRenderer.render.mockClear();
        host.statusLineRenderer.render.mockClear();
        Object.assign(host.core.settings, {
            liveSync: false,
            periodicReplication: false,
            syncOnSave: false,
            syncOnEditorSave: false,
            syncOnStart: false,
            syncOnFileOpen: false,
            syncAfterMerge: false,
        });

        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        await host.flushDisplay();

        expect(host.stats.value).toBe(initialStats);
        expect(host.module.statusBarLabels.value.statusBarParts).toContainEqual(
            expect.objectContaining({ key: "sync-mode", text: "🛎" })
        );
        expect(host.statusBarRenderer.render).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ key: "sync-mode", text: "🛎" })])
        );
        expect(host.statusLineRenderer.render).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ key: "sync-mode", text: "🛎" })])
        );
    });

    it("shows periodic and event settings together while the transfer stays completed", async () => {
        const host = await createHarness();
        Object.assign(host.core.settings, { liveSync: false, periodicReplication: true, syncOnFileOpen: true });
        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        await host.flushDisplay();

        for (const renderer of [host.statusBarRenderer, host.statusLineRenderer]) {
            expect(renderer.render).toHaveBeenLastCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ key: "sync-mode", text: "⏰ ✨" }),
                    expect.objectContaining({ key: "sync", text: "Sync: ⏹" }),
                ])
            );
        }
    });

    it("removes the ordinary mode badge for a P2P main remote and restores it for Object Storage", async () => {
        const { REMOTE_P2P, REMOTE_MINIO } = await import("@vrtmrz/livesync-commonlib/compat/common/types");
        const host = await createHarness();
        host.core.settings.remoteType = REMOTE_P2P;
        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        await host.flushDisplay();

        expect(host.module.statusBarLabels.value.statusBarParts.some((part) => part.key === "sync-mode")).toBe(false);
        expect(host.module.statusBarLabels.value.message).toContain("Sync: 💤 P2P");

        Object.assign(host.core.settings, { remoteType: REMOTE_MINIO, liveSync: false, periodicReplication: true });
        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        await host.flushDisplay();
        expect(host.module.statusBarLabels.value.statusBarParts).toContainEqual(
            expect.objectContaining({ key: "sync-mode", text: "⏰" })
        );
    });
});
