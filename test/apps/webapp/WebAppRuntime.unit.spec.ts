import { LOG_LEVEL_INFO, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSyncBrowserServiceHubOptions } from "@/apps/browser/createLiveSyncBrowserServiceHub";

const runtimeMocks = vi.hoisted(() => {
    const addLog = vi.fn();
    const cleanup = vi.fn();
    const currentSettings = vi.fn();
    const getFiles = vi.fn();
    const onLoad = vi.fn();
    const onReady = vi.fn();
    const onUnload = vi.fn();
    const scanVault = vi.fn();
    const scanDirectory = vi.fn();
    const clearCache = vi.fn();
    const collectFilesOnStorage = vi.fn();
    const updateToDatabase = vi.fn();
    const p2p = {
        replicator: {},
    };

    const serviceHub = {
        API: { addLog },
        control: { onLoad, onReady, onUnload },
        setting: { currentSettings },
        vault: { scanVault },
    };
    const platformModules = {
        fileHandler: {},
        storageAccess: {},
        storageEventManager: { cleanup },
        vaultAccess: {
            fsapiAdapter: {
                clearCache,
                getFiles,
                scanDirectory,
            },
        },
    };

    return {
        addLog,
        options: undefined as LiveSyncBrowserServiceHubOptions<never> | undefined,
        clearCache,
        cleanup,
        collectFilesOnStorage,
        currentSettings,
        getFiles,
        onLoad,
        onReady,
        onUnload,
        platformModules,
        p2p,
        scanDirectory,
        scanVault,
        serviceHub,
        updateToDatabase,
    };
});

vi.mock("@/apps/browser/createLiveSyncBrowserServiceHub", () => ({
    createLiveSyncBrowserServiceHub: vi.fn((options: LiveSyncBrowserServiceHubOptions<never>) => {
        runtimeMocks.options = options;
        return runtimeMocks.serviceHub;
    }),
}));

vi.mock("@/apps/webapp/serviceModules/FSAPIServiceModules", () => ({
    initialiseServiceModulesFSAPI: vi.fn(() => runtimeMocks.platformModules),
}));

vi.mock("@/LiveSyncBaseCore", () => ({
    LiveSyncBaseCore: class {
        readonly serviceModules;
        readonly services;

        constructor(
            services: typeof runtimeMocks.serviceHub,
            initialisePlatformModules: (core: unknown, serviceHub: typeof runtimeMocks.serviceHub) => unknown,
            _initialiseCoreModules: () => unknown[],
            _getAddOns: () => unknown[],
            initialiseFeatures: (core: unknown) => void
        ) {
            this.services = services;
            this.serviceModules = initialisePlatformModules(this, services);
            initialiseFeatures(this);
        }
    },
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner.js", () => ({
    collectFilesOnStorage: runtimeMocks.collectFilesOnStorage,
    updateToDatabase: runtimeMocks.updateToDatabase,
    useOfflineScanner: vi.fn(),
}));
vi.mock("@/serviceFeatures/redFlag", () => ({
    useRedFlagFeatures: vi.fn(),
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/serviceFeatures/checkRemoteSize.js", () => ({
    useCheckRemoteSize: vi.fn(),
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/serviceFeatures/remoteConfig.js", () => ({
    useRemoteConfiguration: vi.fn(),
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/trystero/useP2PReplicatorFeature.js", () => ({
    useP2PReplicatorFeature: vi.fn(() => runtimeMocks.p2p),
}));

import { WebAppRuntime } from "@/apps/webapp/WebAppRuntime";

const unconfiguredSettings = {
    couchDB_DBNAME: "",
    isConfigured: false,
} as ObsidianLiveSyncSettings;

function createRootHandle(name = "runtime-vault"): FileSystemDirectoryHandle {
    return { name } as FileSystemDirectoryHandle;
}

async function waitForMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("WebAppRuntime lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtimeMocks.options = undefined;
        runtimeMocks.currentSettings.mockReturnValue(unconfiguredSettings);
        runtimeMocks.getFiles.mockResolvedValue([{ path: "one.md" }]);
        runtimeMocks.onLoad.mockResolvedValue(true);
        runtimeMocks.onReady.mockResolvedValue(undefined);
        runtimeMocks.onUnload.mockResolvedValue(undefined);
        runtimeMocks.cleanup.mockResolvedValue(undefined);
        runtimeMocks.clearCache.mockReturnValue(undefined);
        runtimeMocks.collectFilesOnStorage.mockResolvedValue({
            storageFileNameMap: {
                "one.md": {
                    path: "one.md",
                    stat: { ctime: 1, mtime: 1, size: 3, type: "file" },
                },
            },
            storageFileNames: ["one.md"],
            storageFileNameCI2CS: { "one.md": "one.md" },
        });
        runtimeMocks.scanDirectory.mockResolvedValue(undefined);
        runtimeMocks.scanVault.mockResolvedValue(false);
        runtimeMocks.updateToDatabase.mockResolvedValue(undefined);
    });

    it("owns core start, directory scan, status reporting, and shutdown", async () => {
        const reportStatus = vi.fn();
        const runtime = new WebAppRuntime(createRootHandle(), { reportStatus });

        await runtime.start();

        expect(runtimeMocks.onLoad).toHaveBeenCalledOnce();
        expect(runtimeMocks.onReady).toHaveBeenCalledOnce();
        expect(runtimeMocks.scanDirectory).toHaveBeenCalledOnce();
        expect(runtimeMocks.getFiles).toHaveBeenCalledOnce();
        expect(runtimeMocks.addLog).toHaveBeenCalledWith("Found 1 files", expect.anything(), "scan");
        expect(reportStatus).toHaveBeenCalledWith(
            "warning",
            "Warning: Please configure CouchDB connection in settings"
        );
        expect(runtime.p2pPaneHost.services).toBe(runtimeMocks.serviceHub);
        expect(runtime.p2pPaneHost.p2p).toBe(runtimeMocks.p2p);
        expect(runtime.p2pPaneHost.showPeerMenu).toBeUndefined();
        expect("p2pController" in runtime).toBe(false);

        await runtime.shutdown();

        expect(runtimeMocks.cleanup).toHaveBeenCalledOnce();
        expect(runtimeMocks.onUnload).toHaveBeenCalledOnce();
    });

    it("imports local files for optional P2P while the main remote remains unconfigured", async () => {
        const runtime = new WebAppRuntime(createRootHandle());
        await runtime.start();
        vi.clearAllMocks();
        runtimeMocks.currentSettings.mockReturnValue(unconfiguredSettings);
        runtimeMocks.collectFilesOnStorage.mockResolvedValue({
            storageFileNameMap: {
                "one.md": {
                    path: "one.md",
                    stat: { ctime: 1, mtime: 1, size: 3, type: "file" },
                },
            },
            storageFileNames: ["one.md"],
            storageFileNameCI2CS: { "one.md": "one.md" },
        });

        await expect(runtime.scanLocalFiles()).resolves.toBe(true);

        expect(runtimeMocks.clearCache).toHaveBeenCalledOnce();
        expect(runtimeMocks.scanDirectory).toHaveBeenCalledOnce();
        expect(runtimeMocks.collectFilesOnStorage).toHaveBeenCalledWith(
            expect.objectContaining({
                services: runtimeMocks.serviceHub,
                serviceModules: runtimeMocks.platformModules,
            }),
            unconfiguredSettings,
            expect.any(Function)
        );
        expect(runtimeMocks.updateToDatabase).toHaveBeenCalledOnce();
        expect(runtimeMocks.scanVault).not.toHaveBeenCalled();
        expect(runtimeMocks.currentSettings()).toBe(unconfiguredSettings);
        expect(unconfiguredSettings.isConfigured).toBe(false);
    });

    it("rejects a failed core start after cleaning up the partial runtime", async () => {
        runtimeMocks.onLoad.mockResolvedValue(false);
        const reportStatus = vi.fn();
        const runtime = new WebAppRuntime(createRootHandle(), { reportStatus });

        await expect(runtime.start()).rejects.toThrow("Failed to initialise LiveSync");

        expect(runtimeMocks.cleanup).toHaveBeenCalledOnce();
        expect(runtimeMocks.onUnload).toHaveBeenCalledOnce();
        expect(reportStatus).toHaveBeenCalledWith(
            "error",
            "Error: Failed to start: Error: Failed to initialise LiveSync"
        );
    });

    it("shuts down once before scheduling a host reload", async () => {
        const scheduleReload = vi.fn();
        const runtime = new WebAppRuntime(createRootHandle(), { scheduleReload });
        await runtime.start();

        runtimeMocks.options?.restart?.schedule();
        runtimeMocks.options?.restart?.schedule();
        await waitForMicrotasks();

        expect(runtimeMocks.options?.restart?.isScheduled?.()).toBe(true);
        expect(runtimeMocks.cleanup).toHaveBeenCalledOnce();
        expect(runtimeMocks.onUnload).toHaveBeenCalledOnce();
        expect(scheduleReload).toHaveBeenCalledOnce();
        expect(scheduleReload).toHaveBeenCalledWith(1_000);
        expect(runtimeMocks.addLog).toHaveBeenCalledWith("Restart requested", LOG_LEVEL_INFO, "app-lifecycle");
    });
});
