import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { P2PReplicationProgress } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/TrysteroReplicator";
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

async function createHarness(publishCompleted = true) {
    const { ModuleLog } = await import("./ModuleLog.ts");
    const { reactiveSource } = await import("octagonal-wheels/dataobject/reactive");
    const { createServiceContext } = await import("@vrtmrz/livesync-commonlib/context");
    const { DEFAULT_SETTINGS, REMOTE_COUCHDB } = await import("@vrtmrz/livesync-commonlib/compat/common/types");
    const { EVENT_SETTING_SAVED } = await import("@vrtmrz/livesync-commonlib/compat/events/coreEvents");
    const { HeadlessAPIService } =
        await import("@vrtmrz/livesync-commonlib/compat/services/implements/headless/HeadlessAPIService");
    const { InjectableAppLifecycleService } =
        await import("@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableAppLifecycleService");
    const { InjectableDatabaseEventService } =
        await import("@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableDatabaseEventService");
    const { InjectableReplicatorService } =
        await import("@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableReplicatorService");
    const { InjectableSettingService } =
        await import("@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableSettingService");
    const { MemoryValueStore } = await import("@vrtmrz/value-store");
    const callbacks: FrameRequestCallback[] = [];
    const activeFile = { path: "folder/file?.md", name: "file?.md", stat: { size: 1 } };
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => callbacks.push(callback));

    const context = createServiceContext();
    const settingService = new InjectableSettingService(context, {
        APIService: new HeadlessAPIService(context),
        deviceValues: new MemoryValueStore(),
    });
    class TestAppLifecycleService extends InjectableAppLifecycleService {}
    const appLifecycle = new TestAppLifecycleService(context, { settingService });
    appLifecycle.isReloadingScheduled.setHandler(() => false);
    const replicator = new InjectableReplicatorService(context, {
        settingService,
        appLifecycleService: appLifecycle,
        databaseEventService: new InjectableDatabaseEventService(context),
    });
    const stats = replicator.replicationStatics;
    if (publishCompleted) stats.value = { ...stats.value, syncStatus: "COMPLETED" };

    const services = {
        API: {
            requestCount: reactiveSource(0),
            responseCount: reactiveSource(0),
            registerCleanup: (cleanup: () => void) => cleanups.push(cleanup),
        },
        context,
        appLifecycle,
        vault: {
            shouldCheckCaseInsensitively: () => false,
            isTargetFile: async () => true,
            isFileSizeTooLarge: () => false,
        },
        replication: {
            replicationResultCount: reactiveSource(0),
            databaseQueueCount: reactiveSource(0),
            storageApplyingCount: reactiveSource(0),
        },
        replicator,
        conflict: { conflictProcessQueueCount: reactiveSource(0) },
        fileProcessing: { processing: reactiveSource(0), totalQueued: reactiveSource(0), batched: reactiveSource(0) },
    };
    const storageAccess = { getFiles: async () => [] };
    const core: {
        services: typeof services;
        settings: ObsidianLiveSyncSettings;
        storageAccess: typeof storageAccess;
    } = {
        services,
        storageAccess,
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
    const p2pReplicationStats = reactiveSource<P2PReplicationProgress[]>([]);
    const module = Object.assign(Object.create(ModuleLog.prototype), {
        plugin: { app: { workspace: { getActiveFile: () => activeFile } } },
        core,
        statusLog: reactiveSource(""),
        activeFileStatus: reactiveSource<
            { kind: "none"; message: "" } | { kind: "excluded" | "warning"; message: string }
        >({ kind: "none", message: "" }),
        hideFileWarningNoticeSetting: reactiveSource(false),
        p2pLogCollector: { p2pReplicationStats, dispose: vi.fn() },
        statusBarRenderer,
        statusLineRenderer,
        statusDiv: { setCssStyles: vi.fn() },
        messageArea: { innerText: "" },
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
        p2pReplicationStats,
        statusBarRenderer,
        statusLineRenderer,
        flushDisplay,
        EVENT_SETTING_SAVED,
    } as const;
}

describe("ModuleLog status displays", () => {
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
                    expect.objectContaining({ key: "sync", text: "✅" }),
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
        expect(host.module.statusBarLabels.value.message).toContain("💤");
        expect(host.module.statusBarLabels.value.message).not.toContain("Sync:");

        Object.assign(host.core.settings, { remoteType: REMOTE_MINIO, liveSync: false, periodicReplication: true });
        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        await host.flushDisplay();
        expect(host.module.statusBarLabels.value.statusBarParts).toContainEqual(
            expect.objectContaining({ key: "sync-mode", text: "⏰" })
        );
    });

    it("keeps the compact file marker and reason together in the status item", async () => {
        const host = await createHarness();
        const messageArea = host.module.messageArea;
        host.core.settings.hideFileWarningNotice = true;
        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        host.services.vault.isTargetFile = async () => false;
        const excludedWithWarning = await host.module.getActiveFileStatus();
        expect(excludedWithWarning).toMatchObject({
            kind: "excluded",
            message: expect.stringContaining("Not synchronised:"),
        });
        expect(excludedWithWarning.message).toContain("Warning:");
        host.module.activeFileStatus.value = excludedWithWarning;
        await host.flushDisplay();

        for (const renderer of [host.statusBarRenderer, host.statusLineRenderer]) {
            expect(renderer.render).toHaveBeenLastCalledWith(
                expect.arrayContaining([expect.objectContaining({ key: "file-skip", text: "📄⛔" })])
            );
        }
        await host.module.updateMessageArea();
        expect(messageArea?.innerText).toBe("");

        host.statusBarRenderer.render.mockClear();
        host.statusLineRenderer.render.mockClear();
        host.services.vault.isTargetFile = async () => true;
        const warning = await host.module.getActiveFileStatus();
        expect(warning).toMatchObject({ kind: "warning", message: expect.stringContaining("Warning:") });
        host.module.activeFileStatus.value = warning;
        await host.flushDisplay();

        for (const renderer of [host.statusBarRenderer, host.statusLineRenderer]) {
            expect(renderer.render).toHaveBeenLastCalledWith(
                expect.arrayContaining([expect.objectContaining({ key: "file-skip", text: "📄⚠️" })])
            );
        }

        host.core.settings.hideFileWarningNotice = false;
        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        host.module.activeFileStatus.value = excludedWithWarning;
        await host.module.updateMessageArea();
        expect(messageArea?.innerText).toContain("Not synchronised:");
        expect(messageArea?.innerText).toContain("Warning:");
    });

    it("updates the file marker and detail area when its setting changes without changing the active file", async () => {
        const { REMOTE_P2P } = await import("@vrtmrz/livesync-commonlib/compat/common/types");
        const host = await createHarness();
        host.core.settings.remoteType = REMOTE_P2P;
        host.core.settings.hideFileWarningNotice = false;
        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        await host.flushDisplay();

        const warning = await host.module.getActiveFileStatus();
        expect(warning.kind).toBe("warning");
        host.module.activeFileStatus.value = warning;
        await host.flushDisplay();
        await Promise.resolve();
        expect(host.module.messageArea?.innerText).toContain("Warning:");
        expect(host.module.statusBarLabels.value.statusBarParts.some((part) => part.key === "file-skip")).toBe(false);

        host.core.settings.hideFileWarningNotice = true;
        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        await host.flushDisplay();
        await Promise.resolve();

        expect(host.module.statusBarLabels.value.statusBarParts).toContainEqual(
            expect.objectContaining({ key: "file-skip", text: "📄⚠️" })
        );
        expect(host.module.messageArea?.innerText).not.toContain("Warning:");

        host.core.settings.hideFileWarningNotice = false;
        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        await host.flushDisplay();
        await Promise.resolve();

        expect(host.module.statusBarLabels.value.statusBarParts.some((part) => part.key === "file-skip")).toBe(false);
        expect(host.module.messageArea?.innerText).toContain("Warning:");
    });

    it("keeps the compact warning in the status bar when an auxiliary P2P peer is active", async () => {
        const host = await createHarness();
        host.core.settings.hideFileWarningNotice = true;
        host.services.context.events.emitEvent(host.EVENT_SETTING_SAVED, host.core.settings);
        host.module.activeFileStatus.value = { kind: "warning", message: "File compatibility warning" };
        const progress = { current: 1, max: 2, isActive: true };
        host.p2pReplicationStats.value = [
            { peerId: "peer", peerName: "Auxiliary peer", sending: progress, fetching: progress },
        ];
        await host.flushDisplay();

        const { parts, statusBarParts } = host.module.statusBarLabels.value;
        expect(parts).toContainEqual(expect.objectContaining({ key: "p2p-peer" }));
        expect(statusBarParts).toContainEqual(expect.objectContaining({ key: "file-skip", text: "📄⚠️" }));
        expect(host.statusBarRenderer.render).toHaveBeenLastCalledWith(statusBarParts);
    });

    it("updates both displays when Commonlib publishes new replication statistics", async () => {
        const { stats, statusBarRenderer, statusLineRenderer, flushDisplay } = await createHarness(false);
        const renderers = [statusBarRenderer, statusLineRenderer];
        expect(stats.value.statsUpdatedAt).toBeNull();
        for (const renderer of renderers) {
            expect(renderer.render).toHaveBeenLastCalledWith(expect.arrayContaining([{ key: "sync", text: "⚓" }]));
            renderer.render.mockClear();
        }

        for (const [syncStatus, icon] of [
            ["COMPLETED", "✅"],
            ["CONNECTED", "⚡"],
        ] as const) {
            stats.value = { ...stats.value, syncStatus };
            expect(stats.value.statsUpdatedAt).toEqual(expect.any(Number));
            expect(stats.value.syncStatus).toBe(syncStatus);
            await flushDisplay();

            for (const renderer of renderers) {
                expect(renderer.render).toHaveBeenLastCalledWith(expect.arrayContaining([{ key: "sync", text: icon }]));
                renderer.render.mockClear();
            }
        }
    });
});
