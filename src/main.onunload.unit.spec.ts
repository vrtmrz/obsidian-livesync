import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import { createOwnedResource } from "octagonal-wheels/resource";
import { LOG_LEVEL_URGENT } from "octagonal-wheels/common/logger";
import { bindableFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/HandlerUtils";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { EVENT_APPLICATION_READY } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import type { LiveSyncCore } from "./main";
import type { ObsidianServiceHub } from "./modules/services/ObsidianServiceHub";

const unusedStartupDependencies: readonly [string, readonly string[]][] = [
    ["./serviceFeatures/replication/reflectionRecoveryReview", ["useReflectionRecoveryReview"]],
    ["@/serviceFeatures/useP2PSettingsPreparation", ["useP2PSettingsPreparation"]],
    ["./features/LiveSyncCommands.ts", ["LiveSyncCommands"]],
    ["./features/HiddenFileSync/CmdHiddenFileSync.ts", ["HiddenFileSync"]],
    ["./features/ConfigSync/CmdConfigSync.ts", ["ConfigSync"]],
    ["./modules/features/ModuleLog.ts", ["ModuleLog"]],
    ["./modules/essentialObsidian/ModuleObsidianEvents.ts", ["ModuleObsidianEvents"]],
    ["./modules/features/ModuleObsidianSettingTab.ts", ["ModuleObsidianSettingDialogue"]],
    ["./modules/features/ModuleObsidianDocumentHistory.ts", ["ModuleObsidianDocumentHistory"]],
    ["./modules/features/ModuleGlobalHistory.ts", ["ModuleObsidianGlobalHistory"]],
    ["./features/LocalDatabaseMainte/CmdLocalDatabaseMainte.ts", ["LocalDatabaseMaintenance"]],
    ["@vrtmrz/livesync-commonlib/compat/serviceModules/Rebuilder", ["ServiceRebuilder"]],
    ["@/serviceModules/DatabaseFileAccess.ts", ["ServiceDatabaseFileAccess"]],
    ["@/serviceModules/ServiceFileAccessImpl.ts", ["ServiceFileAccessObsidian"]],
    ["@vrtmrz/livesync-commonlib/compat/managers/StorageProcessingManager", ["StorageAccessManager"]],
    ["./serviceModules/FileHandler.ts", ["ServiceFileHandler"]],
    ["./serviceModules/FileAccessObsidian.ts", ["FileAccessObsidian"]],
    ["./managers/StorageEventManagerObsidian.ts", ["StorageEventManagerObsidian"]],
    ["@vrtmrz/livesync-commonlib/compat/mock_and_interop/wrapper", ["setNoticeClass"]],
    ["./modules/features/ModuleObsidianSettingAsMarkdown.ts", ["ModuleObsidianSettingsAsMarkdown"]],
    ["./modules/features/SetupManager.ts", ["SetupManager"]],
    ["./serviceFeatures/onLayoutReady/enablei18n.ts", ["enableI18nFeature"]],
    ["@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner", ["useOfflineScanner"]],
    ["@vrtmrz/livesync-commonlib/compat/serviceFeatures/remoteConfig", ["useRemoteConfiguration"]],
    ["@vrtmrz/livesync-commonlib/compat/serviceFeatures/checkRemoteSize", ["useCheckRemoteSize"]],
    ["./serviceFeatures/redFlag.ts", ["useRedFlagFeatures"]],
    ["./serviceFeatures/setupObsidian/setupProtocol.ts", ["useSetupProtocolFeature"]],
    ["@/serviceFeatures/setupObsidian/qrCode", ["useSetupQRCodeFeature"]],
    ["@/serviceFeatures/setupObsidian/setupUri", ["useSetupURIFeature"]],
    [
        "./serviceFeatures/setupObsidian/setupManagerHandlers.ts",
        ["showOnboardingInvitation", "useSetupManagerHandlersFeature"],
    ],
    ["@vrtmrz/livesync-commonlib/p2p", ["useP2PReplicatorCommands", "useP2PReplicatorFeature"]],
    ["./serviceFeatures/useP2PReplicatorUI.ts", ["useP2PReplicatorUI"]],
    ["./serviceFeatures/useReviewHarness.ts", ["useReviewHarness"]],
    ["./serviceFeatures/databaseConnectionRecovery.ts", ["useDatabaseConnectionRecovery"]],
    ["./features/P2PSync/P2PReplicator/P2PReplicationUI.ts", ["createOpenReplicationUI", "createOpenRebuildUI"]],
    ["./serviceFeatures/compatibilityReview.ts", ["useCompatibilityReview"]],
    ["./serviceFeatures/compatibilityReviewObsidian.ts", ["createObsidianCompatibilityReviewUi"]],
    ["./serviceModules/FileReflectionProvenance.ts", ["createFileReflectionProvenance"]],
    ["./serviceFeatures/interactiveConflictResolution", ["useInteractiveConflictResolutionFeature"]],
    ["./modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", ["ConflictResolveModal"]],
    ["./serviceFeatures/obsidianReplicationRibbon.ts", ["useObsidianReplicationRibbonFeature"]],
    ["./serviceFeatures/syncGuard", ["useSyncGuardFeature"]],
    ["./serviceFeatures/syncGuard/SyncGuardOverlay", ["SyncGuardOverlay"]],
    ["./serviceFeatures/startupLifecycle", ["useStartupLifecycleFeature"]],
    ["./serviceFeatures/useJoinedDevices", ["useJoinedDevicesFeature"]],
    ["./serviceFeatures/useDatabaseDiagnostics", ["useDatabaseDiagnosticsFeature"]],
];

beforeEach(() => {
    vi.resetModules();
    const getLanguage = () => "en";
    vi.doMock("./deps", () => ({
        Plugin: class {
            constructor(readonly app: unknown) {}
        },
        Notice: class {},
        getLanguage,
    }));
    // The translation module reads the language as soon as it is imported.
    vi.doMock("@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions", () => ({
        compatGlobal: global,
        getLanguage,
        setGetLanguage: vi.fn(),
    }));
    vi.doMock("./modules/services/ObsidianServiceHub.ts", () => ({ ObsidianServiceHub: class {} }));
    vi.doMock("./LiveSyncBaseCore.ts", () => ({ LiveSyncBaseCore: class {} }));
    for (const [specifier, names] of unusedStartupDependencies) {
        vi.doMock(specifier, () => Object.fromEntries(names.map((name) => [name, vi.fn()])));
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("Obsidian plug-in unload logging", () => {
    it.each(["complete", "fail"] as const)(
        "retains its log connection through shutdown and retires it afterwards: %s",
        async (outcome) => {
            const { default: LiveSyncPlugin } = await import("./main.ts");
            const { KeyValueDatabaseOwner } = await import("./common/KeyValueDBv2");
            const owner = new KeyValueDatabaseOwner(async () => {});
            const keyValueDB = {
                retire: (teardown: () => Promise<void>) => owner.retire(teardown),
            };
            const events: string[] = [];
            const sink = vi.fn((message: unknown) => events.push(String(message)));
            const addLog = bindableFunction<(message: unknown, level?: number, key?: string) => void>("unload log");
            const unregister = addLog.setHandler(sink);
            const dispose = vi.fn(() => {
                unregister();
                events.push("disposed");
            });
            const logResource = createOwnedResource(sink, dispose);
            let finish!: () => void;
            let fail!: (reason: Error) => void;
            const shutdown = new Promise<void>((resolve, reject) => {
                finish = resolve;
                fail = reject;
            });
            const onUnload = vi.fn(() => shutdown);
            const core = {
                getModule: vi.fn(() => ({ logResource })),
                services: { API: { addLog }, control: { onUnload } },
            };

            expect(
                LiveSyncPlugin.prototype.onunload.call({ app: { vault: {} }, core, keyValueDB } as never)
            ).toBeUndefined();
            expect(onUnload).toHaveBeenCalledTimes(1);
            expect(dispose).not.toHaveBeenCalled();
            addLog("during shutdown");

            const failure = new Error("database close failed");
            if (outcome === "fail") {
                fail(failure);
            } else {
                finish();
            }
            await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));

            if (outcome === "fail") {
                const message = "Failed to unload Self-hosted LiveSync: " + String(failure);
                expect(sink).toHaveBeenCalledWith(message, LOG_LEVEL_URGENT, "shutdown");
                expect(events).toEqual(["during shutdown", message, "disposed"]);
            } else {
                expect(events).toEqual(["during shutdown", "disposed"]);
            }
            expect(() => addLog("after shutdown")).toThrow("not assigned");
        }
    );
});

describe("Obsidian plug-in unload and same-store handoff", () => {
    it.each(["complete", "fail"] as const)(
        "sets both synchronous fences and waits for full control teardown to %s before reopening",
        async (outcome) => {
            const { default: LiveSyncPlugin } = await import("./main.ts");
            const { KeyValueDatabaseOwner } = await import("./common/KeyValueDBv2");
            const key = `unload-handoff-${outcome}`;
            const retiring = new KeyValueDatabaseOwner(async () => {});
            const oldStore = await retiring.open(key);
            const close = vi.spyOn(await oldStore.DB, "close");
            const drain = promiseWithResolvers<void>();
            const shutdown = promiseWithResolvers<void>();
            const dispose = vi.fn();
            const logResource = createOwnedResource(null, dispose);
            const beginStopWatching = vi.fn();
            const stopWatching = vi.fn(() => drain.promise);
            const addLog = vi.fn();
            const onUnload = vi.fn(() => shutdown.promise);
            const plugin = {
                app: { vault: {} },
                keyValueDB: { retire: (teardown: () => Promise<void>) => retiring.retire(teardown) },
                storageEventManager: { beginStopWatching, stopWatching },
                core: { getModule: () => ({ logResource }), services: { API: { addLog }, control: { onUnload } } },
            };

            LiveSyncPlugin.prototype.onunload.call(plugin as never);
            expect(beginStopWatching).toHaveBeenCalledTimes(1);
            // Hot re-enable may evaluate a fresh copy of the plug-in bundle.
            vi.resetModules();
            const { KeyValueDatabaseOwner: NextOwner } = await import("./common/KeyValueDBv2");
            const successor = new NextOwner(async () => {});
            const opened = vi.fn();
            const newStore = successor.open(key).then((store) => {
                opened();
                return store;
            });
            const other = await new NextOwner(async () => {}).open(`${key}-different`);
            try {
                expect(stopWatching).toHaveBeenCalledTimes(1);
                expect(opened).not.toHaveBeenCalled();
                expect(onUnload).not.toHaveBeenCalled();
                drain.resolve();
                await vi.waitFor(() => expect(onUnload).toHaveBeenCalledTimes(1));
                expect(opened).not.toHaveBeenCalled();
                expect(dispose).not.toHaveBeenCalled();
                expect(close).not.toHaveBeenCalled();
                if (outcome === "fail") shutdown.reject(new Error("control teardown failed"));
                else shutdown.resolve();
                const next = await newStore;
                await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
                expect(close).toHaveBeenCalledTimes(1);
                const connection = await next.DB;
                await oldStore.close();
                expect(await next.DB).toBe(connection);
                expect(close).toHaveBeenCalledTimes(1);
                expect(addLog).toHaveBeenCalledTimes(outcome === "fail" ? 1 : 0);
            } finally {
                drain.resolve();
                shutdown.resolve();
                await (await newStore).destroy();
                await other.destroy();
            }
        }
    );
});

it("fences database recovery while an IndexedDB acknowledgement keeps unload open", async () => {
    const { default: LiveSyncPlugin } = await import("./main.ts");
    const { IDBKeyValueDatabase } = await import("./common/KeyValueDBv2");
    const { createDatabaseConnectionRecoveryContext, requestDatabaseConnectionRecovery } = await vi.importActual<
        typeof import("./serviceFeatures/databaseConnectionRecovery")
    >("./serviceFeatures/databaseConnectionRecovery");
    const store = new IDBKeyValueDatabase("recovery-during-unload");
    const reopenStarted = promiseWithResolvers<void>();
    const reopen = promiseWithResolvers<boolean>();
    const acknowledgementStarted = promiseWithResolvers<void>();
    const releaseAcknowledgement = promiseWithResolvers<void>();
    const retired = promiseWithResolvers<void>();
    const logResource = createOwnedResource(null, () => retired.resolve());
    let unloading = false;
    const selected = { isReady: true, stopReads: vi.fn() };
    const onUnload = vi.fn(async () => {});
    const services = {
        API: { addLog: vi.fn() },
        control: { onUnload },
        appLifecycle: {
            isReady: () => true,
            isUnloading: () => unloading,
            markIsUnloading: () => {
                unloading = true;
            },
            onSuspending: async () => true,
        },
        database: {
            localDatabaseDirect: selected,
            canReadCurrentDatabaseInfo: async () => {
                throw new Error("connection lost");
            },
            reopenDatabase: () => {
                reopenStarted.resolve();
                return reopen.promise;
            },
        },
        databaseEvents: { onAfterDatabaseRecovery: vi.fn(async () => true) },
        fileProcessing: { commitPendingFileEvents: vi.fn(async () => true) },
        replicator: { onCloseActiveReplication: async () => true },
        setting: { currentSettings: () => ({ isConfigured: true }) },
    };
    const dispatch = { pauseDispatch: vi.fn(async () => {}), resumeDispatch: vi.fn() };
    const core = { services, getModule: () => ({ logResource }) };
    const context = createDatabaseConnectionRecoveryContext(core as never, dispatch, () => true);
    await store.set("acknowledged-intent", true);
    const nativeBatch = store.applyBatch.bind(store);
    vi.spyOn(store, "applyBatch").mockImplementationOnce(async (...args) => {
        acknowledgementStarted.resolve();
        await releaseAcknowledgement.promise;
        await nativeBatch(...args);
    });
    const acknowledgement = store.del("acknowledged-intent");
    const stopWatching = vi.fn(() => acknowledgement);
    const plugin = {
        core,
        app: { vault: {} },
        storageEventManager: { beginStopWatching: vi.fn(), stopWatching },
        keyValueDB: { retire: (teardown: () => Promise<void>) => teardown() },
    };

    try {
        const recovery = requestDatabaseConnectionRecovery(context, false);
        await reopenStarted.promise;
        expect(dispatch.pauseDispatch).toHaveBeenCalledOnce();
        await acknowledgementStarted.promise;

        LiveSyncPlugin.prototype.onunload.call(plugin as never);
        expect(stopWatching).toHaveBeenCalledOnce();
        expect(onUnload).not.toHaveBeenCalled();
        reopen.resolve(true);
        await expect(recovery).resolves.toBe(false);
        expect(dispatch.resumeDispatch).not.toHaveBeenCalled();
        expect(services.fileProcessing.commitPendingFileEvents).not.toHaveBeenCalled();
        expect(services.databaseEvents.onAfterDatabaseRecovery).not.toHaveBeenCalled();
        expect(onUnload).not.toHaveBeenCalled();
    } finally {
        reopen.resolve(true);
        releaseAcknowledgement.resolve();
        await acknowledgement;
        await retired.promise;
        await store.destroy();
    }
    expect(onUnload).toHaveBeenCalledOnce();
});

it("defers the successor's shared event registrations until the old event hub has finished unloading", async () => {
    const shutdown = promiseWithResolvers<void>();
    const constructCore = vi.fn();
    const onLoad = vi.fn(async () => true);
    const onLayoutReady = vi.fn();
    const app = { vault: {}, workspace: { onLayoutReady } };
    vi.doUnmock("./modules/services/ObsidianServiceHub.ts");
    vi.doUnmock("./LiveSyncBaseCore.ts");
    vi.doMock("./modules/services/ObsidianServiceHub.ts", () => ({
        ObsidianServiceHub: class {
            obsidianKeyValueDB = { retire: (teardown: () => Promise<void>) => teardown() };
        },
    }));
    vi.doMock("./LiveSyncBaseCore.ts", () => ({
        LiveSyncBaseCore: class {
            services = { control: { onLoad, onUnload: () => shutdown.promise }, API: { addLog: vi.fn() } };
            getModule() {
                return { logResource: createOwnedResource(null, vi.fn()) };
            }
            constructor() {
                constructCore();
            }
        },
    }));
    const { default: LiveSyncPlugin } = await import("./main.ts");
    const old = new LiveSyncPlugin(app as never, {} as never);
    old.onunload();
    const next = new LiveSyncPlugin(app as never, {} as never);
    next.onload();
    const disabledAgain = new LiveSyncPlugin(app as never, {} as never);
    disabledAgain.onload();
    disabledAgain.onunload();
    await Promise.resolve();
    expect(constructCore).toHaveBeenCalledTimes(1);
    expect(onLoad).not.toHaveBeenCalled();

    shutdown.resolve();
    await vi.waitFor(() => expect(onLayoutReady).toHaveBeenCalledTimes(1));
    expect(constructCore).toHaveBeenCalledTimes(2);
    expect(onLoad).toHaveBeenCalledTimes(1);
});

it.each(["settings loading", "layout ready"] as const)(
    "retires real services with startup held at %s",
    async (phase) => {
        const early = phase === "settings loading";
        vi.doUnmock("./modules/services/ObsidianServiceHub.ts");
        vi.doUnmock("./managers/StorageEventManagerObsidian.ts");
        vi.doMock("@/serviceModules/ObsidianRebuilder.ts", () => ({ ObsidianRebuilder: class {} }));
        vi.doMock("./serviceModules/FileAccessObsidian.ts", () => ({
            FileAccessObsidian: class {
                dispose() {}
            },
        }));
        vi.doMock("./modules/services/ObsidianUIService", () => ({ ObsidianUIService: class {} }));
        vi.doMock("@vrtmrz/livesync-commonlib/compat/pouchdb/pouchdb-browser", () => ({ PouchDB: class {} }));
        vi.doMock("./modules/services/ObsidianConfirm", () => ({ ObsidianConfirm: class {} }));
        vi.doMock("@vrtmrz/obsidian-plugin-kit/notice", () => {
            class Notices {
                dispose() {}
            }
            return { KeyedNoticeManager: Notices, KeyedNoticeGroupManager: Notices };
        });
        vi.doMock("@/deps", () => ({
            Plugin: class {
                constructor(readonly app: unknown) {}
            },
            Notice: class {},
            TFile: class {},
            TFolder: class {},
            getLanguage: () => "en",
        }));
        vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });

        const shutdown = promiseWithResolvers<void>();
        const teardownStarted = promiseWithResolvers<void>();
        const oldRetired = promiseWithResolvers<void>();
        const nextRetired = promiseWithResolvers<void>();
        const nextLoadStarted = promiseWithResolvers<void>();
        const onLayoutReady = vi.fn<(callback: () => Promise<boolean> | undefined) => void>();
        const heldSettings = promiseWithResolvers<void>();
        const vaultName = `hot-reenable-${phase}`;
        const databaseKey = `${vaultName}-livesync-kv`;
        const app = { vault: { getName: () => vaultName }, workspace: { onLayoutReady } };
        const constructed: ObsidianServiceHub[] = [];

        vi.doMock("./LiveSyncBaseCore.ts", () => ({
            LiveSyncBaseCore: class {
                constructor(
                    readonly services: ObsidianServiceHub,
                    initialiseModules: (core: LiveSyncCore, hub: ObsidianServiceHub) => void
                ) {
                    const isFirst = constructed.length === 0;
                    constructed.push(services);
                    services.API.addLog.setHandler(vi.fn());
                    if (isFirst && early) {
                        vi.spyOn(services.setting, "loadSettings").mockReturnValue(heldSettings.promise);
                    } else {
                        vi.spyOn(services.setting, "currentSettings").mockReturnValue({ ...DEFAULT_SETTINGS });
                    }
                    initialiseModules(this as unknown as LiveSyncCore, services);
                    vi.spyOn(services.control, "onLoad").mockImplementation(async () => {
                        if (isFirst && early) {
                            await services.setting.loadSettings();
                            return false;
                        }
                        if (!isFirst) {
                            nextLoadStarted.resolve();
                        }
                        return services.appLifecycle.onSettingLoaded();
                    });
                    services.appLifecycle.onReady.addHandler(() => {
                        services.appLifecycle.markIsReady();
                        return Promise.resolve(true);
                    });
                    if (isFirst) {
                        services.appLifecycle.onBeforeUnload.addHandler(async () => {
                            teardownStarted.resolve();
                            await shutdown.promise;
                            return true;
                        });
                    }
                }
                getModule() {
                    const retired = constructed[0] === this.services ? oldRetired : nextRetired;
                    return { logResource: createOwnedResource(null, () => retired.resolve()) };
                }
            },
        }));

        const { default: LiveSyncPlugin } = await import("./main.ts");
        const { StorageEventManagerObsidian } = await import("./managers/StorageEventManagerObsidian.ts");
        const stopFence = vi.spyOn(StorageEventManagerObsidian.prototype, "beginStopWatching");
        const drain = vi.spyOn(StorageEventManagerObsidian.prototype, "stopWatching");
        const isStopping = vi.spyOn(StorageEventManagerObsidian.prototype, "isStopping");
        const old = new LiveSyncPlugin(app as never, {} as never);
        let next: InstanceType<typeof LiveSyncPlugin> | undefined;

        try {
            old.onload();
            if (early) {
                const oldServices = constructed[0];
                await vi.waitFor(() => expect(oldServices.setting.loadSettings).toHaveBeenCalledOnce());
                expect(() => oldServices.vault.getVaultName()).toThrow();
                const unload = vi.spyOn(oldServices.control, "onUnload");

                old.onunload();
                await vi.waitFor(() => expect(unload).toHaveBeenCalledOnce());
                shutdown.resolve();
                await oldRetired.promise;
                await expect(unload.mock.results[0].value).resolves.toBeUndefined();

                next = new LiveSyncPlugin(app as never, {} as never);
                next.onload();
                await nextLoadStarted.promise;
                await vi.waitFor(() => expect(onLayoutReady).toHaveBeenCalledOnce());
                await expect(onLayoutReady.mock.calls[0][0]()).resolves.toBe(true);
                expect(constructed[1].appLifecycle.isReady()).toBe(true);
                return;
            }
            await vi.waitFor(() => expect(onLayoutReady).toHaveBeenCalledOnce());
            const oldServices = constructed[0];
            const staleLayoutReady = onLayoutReady.mock.calls[0][0];
            const oldReady = vi.spyOn(oldServices.control, "onReady");
            const publishOldReadiness = vi.spyOn(oldServices.appLifecycle, "markIsReady");
            const oldEvents = vi.spyOn(oldServices.context.events, "emitEvent");
            const oldStore = oldServices.obsidianKeyValueDB.incrementalStore;
            await oldStore.set("retained", "across re-enable");
            const closeOld = vi.spyOn(oldStore, "close");
            const storeRetired = vi.fn();
            const retire = oldServices.obsidianKeyValueDB.retire.bind(oldServices.obsidianKeyValueDB);
            vi.spyOn(oldServices.obsidianKeyValueDB, "retire").mockImplementation((teardown) => {
                const retiring = retire(teardown);
                void retiring.then(storeRetired, (error: unknown) => storeRetired(error));
                return retiring;
            });

            old.onunload();
            expect(stopFence).toHaveBeenCalledBefore(drain);
            expect(oldServices.appLifecycle.isUnloading()).toBe(true);
            await expect(Promise.resolve(staleLayoutReady())).resolves.toBeUndefined();
            expect(isStopping).toHaveLastReturnedWith(true);
            expect(oldReady).not.toHaveBeenCalled();
            expect(publishOldReadiness).not.toHaveBeenCalled();

            // A freshly evaluated bundle has its own vault fence and must still honour KV retirement.
            const successorNativeOpen = vi.spyOn(indexedDB, "open");
            vi.resetModules();
            const { default: ReloadedPlugin } = await import("./main.ts");
            next = new ReloadedPlugin(app as never, {} as never);
            next.onload();
            await nextLoadStarted.promise;
            await teardownStarted.promise;
            const nextServices = constructed[1];
            expect(() => nextServices.obsidianKeyValueDB.incrementalStore).toThrow("KeyValueDB is not initialized yet");
            expect(onLayoutReady).toHaveBeenCalledOnce();
            expect(successorNativeOpen).not.toHaveBeenCalledWith(databaseKey, undefined);
            expect(closeOld).not.toHaveBeenCalled();
            expect(storeRetired).not.toHaveBeenCalled();

            shutdown.resolve();
            await oldRetired.promise;
            await vi.waitFor(() => expect(onLayoutReady).toHaveBeenCalledTimes(2));
            const nextStore = nextServices.obsidianKeyValueDB.incrementalStore;
            expect(nextStore).not.toBe(oldStore);
            expect(closeOld).toHaveBeenCalled();
            expect(successorNativeOpen).toHaveBeenCalledExactlyOnceWith(databaseKey, undefined);
            expect(storeRetired).toHaveBeenCalledExactlyOnceWith(undefined);
            expect(storeRetired).toHaveBeenCalledBefore(successorNativeOpen);
            await expect(nextStore.get("retained")).resolves.toBe("across re-enable");

            await expect(onLayoutReady.mock.calls[1][0]()).resolves.toBe(true);
            expect(nextServices.appLifecycle.isReady()).toBe(true);
            expect(oldServices.appLifecycle.isReady()).toBe(false);
            expect(oldReady).not.toHaveBeenCalled();
            expect(publishOldReadiness).not.toHaveBeenCalled();
            expect(oldEvents).not.toHaveBeenCalledWith(EVENT_APPLICATION_READY);
        } finally {
            heldSettings.resolve();
            shutdown.resolve();
            old.onunload();
            await oldRetired.promise;
            if (next) {
                next.onunload();
                await nextRetired.promise;
            }
            const { IDBKeyValueDatabase } = await import("./common/KeyValueDBv2");
            await new IDBKeyValueDatabase(databaseKey).destroy();
        }
    }
);
