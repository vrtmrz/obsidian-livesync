import { ContentReadError } from "@vrtmrz/livesync-commonlib/replication";
import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import {
    REMOTE_COUCHDB,
    VERSIONING_DOCID,
    type EntryDoc,
    type DocumentID,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { REMOTE_FEATURE_GENERATION } from "@vrtmrz/livesync-commonlib/replication";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import { EVENT_APPLICATION_READY } from "@/common/events";
import { createReplicationFeature, useReplicationFeature } from "./index";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";

type BooleanHandler = (showMessage: boolean) => Promise<boolean>;
type ParseHandler = (documents: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<boolean>;
type KeyValueDBFixture = {
    readonly kvDB: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<unknown>;
    };
};
type SetupOptions = {
    readonly recoveryEnabled?: boolean;
    readonly deferComposition?: boolean;
    readonly getLocalDatabase?: () => object;
    readonly keyValueDB?: KeyValueDBFixture;
    readonly onCloseActiveReplication?: () => Promise<boolean>;
};

function setup(options: SetupOptions = {}) {
    const defaultLocalDatabase = {
        localDatabase: {},
        getRaw: vi.fn(async () => {
            throw { status: 404 };
        }),
    };
    const {
        getLocalDatabase = () => defaultLocalDatabase,
        keyValueDB = {
            kvDB: {
                get: vi.fn(async () => undefined),
                set: vi.fn(async () => undefined),
            },
        },
        onCloseActiveReplication = vi.fn(async () => true),
    } = options;
    const read = vi.fn(async () => new Uint8Array([1]));
    const dispose = vi.fn(async () => undefined);
    const createRemoteResource = vi.fn(async () => ({ read, dispose }));
    const beforeReplicateHandlers = new Map<number, BooleanHandler>();
    const centralRemoteHandlers: BooleanHandler[] = [];
    const failureHandlers: ((target: unknown, error: unknown) => Promise<boolean>)[] = [];
    const finiteSuccessHandlers: (() => Promise<boolean>)[] = [];
    let parseHandler: ParseHandler | undefined;
    const services = {
        API: { isMobile: vi.fn(() => false), isOnline: true },
        appLifecycle: {
            getUnresolvedMessages: { addHandler: vi.fn() },
            isReady: vi.fn(() => true),
            isSuspended: vi.fn(() => false),
            onSettingLoaded: { addHandler: vi.fn() },
            onBeforeUnload: { addHandler: vi.fn() },
        },
        database: { isDatabaseReady: vi.fn(() => true), onDatabaseReset: { addHandler: vi.fn() } },
        conflict: { queueCheckForIfOpen: vi.fn(async () => undefined) },
        context: createServiceContext(),
        databaseEvents: {
            onDatabaseInitialised: { addHandler: vi.fn() },
            onBeforeDatabaseRecovery: { addHandler: vi.fn((handler: () => Promise<boolean>) => handler) },
            onAfterDatabaseRecovery: { addHandler: vi.fn((handler: () => Promise<boolean>) => handler) },
        },
        keyValueDB,
        path: { getPath: vi.fn((entry: { path: string }) => entry.path) },
        replication: {
            replicationResultCount: { value: 0 },
            onBeforeReplicate: {
                addHandler: vi.fn((handler: BooleanHandler, priority = 0) => {
                    beforeReplicateHandlers.set(priority, handler);
                }),
            },
            onPrepareCentralRemoteReplication: {
                addHandler: vi.fn((handler: BooleanHandler) => centralRemoteHandlers.push(handler)),
            },
            onReplicationFailed: { addHandler: vi.fn() },
            onFileReflectionFailed: {
                addHandler: vi.fn((handler: (target: unknown, error: unknown) => Promise<boolean>) =>
                    failureHandlers.push(handler)
                ),
            },
            onFiniteReplicationCompleted: {
                addHandler: vi.fn((handler: () => Promise<boolean>) => finiteSuccessHandlers.push(handler)),
            },
            parseSynchroniseResult: {
                addHandler: vi.fn((handler: ParseHandler) => {
                    parseHandler = handler;
                }),
            },
            replicateUnattendedByEvent: vi.fn(async () => ({ status: "completed" as const })),
        },
        replicator: {
            createRemoteResource,
            onBeforeReplicatorPublication: { addHandler: vi.fn() },
            onCloseActiveReplication,
        },
        setting: { currentSettings: vi.fn(() => ({})) },
        tweakValue: {},
        vault: {
            isTargetFile: vi.fn(async () => true),
            isFileSizeTooLarge: vi.fn(() => false),
        },
    };
    const core = {
        startupDatabaseOptions: { recoverFileReflectionFailures: options.recoveryEnabled === true },
        confirm: {},
        get localDatabase() {
            return getLocalDatabase();
        },
        rebuilder: {},
        services,
        serviceModules: {
            fileHandler: { inspectCurrentFileProvenance: vi.fn(async () => false) },
            storageAccess: { isExists: vi.fn(async () => false) },
        },
    };

    if (!options.deferComposition) {
        useReplicationFeature(core as never);
    }

    return {
        core,
        services,
        failureHandlers,
        finiteSuccessHandlers,
        beforeReplicateHandlers,
        centralRemoteHandlers,
        context: services.context,
        createRemoteResource,
        dispose,
        get parseHandler() {
            return parseHandler;
        },
        onCloseActiveReplication,
        read,
    };
}

function deletionRecoveryHarness(source: "received" | "scan" = "received") {
    const entry = {
        _id: "deleted-target",
        _rev: "1-deletion",
        path: "deleted-target.md",
        type: "plain",
        deleted: true,
    };
    let current = entry;
    const context = setup({
        recoveryEnabled: true,
        deferComposition: true,
        getLocalDatabase: () => ({ getRaw: async () => current }),
        keyValueDB: {
            kvDB: {
                get: async () => ({
                    queued: [],
                    processing: [],
                    pendingReflections: [
                        {
                            documentId: entry._id as DocumentID,
                            revision: entry._rev,
                            source,
                            state: "waiting",
                            automaticAttempted: false,
                            reason: "local-database",
                        },
                    ],
                }),
                set: async () => undefined,
            },
        },
    });
    const feature = createReplicationFeature(context.core as never);
    feature.register();
    return {
        context,
        feature,
        entry,
        setCurrent(value: typeof entry) {
            current = value;
        },
    };
}

describe("reflection service resolution", () => {
    it("does not resolve reflection-only service modules during composition", () => {
        const { core } = setup({ deferComposition: true });
        Object.defineProperty(core, "serviceModules", {
            get() {
                throw new Error("Unexpected eager service-module lookup");
            },
        });
        expect(() => createReplicationFeature(core as never)).not.toThrow();
    });

    it("uses the current storage module when inspecting retained work", async () => {
        const { context, feature } = deletionRecoveryHarness();
        const previous = context.core.serviceModules.storageAccess;
        const current = { isExists: vi.fn(async () => true) };
        context.core.serviceModules = { ...context.core.serviceModules, storageAccess: current };

        await feature.recovery.reconcile();

        expect(current.isExists).toHaveBeenCalledExactlyOnceWith("deleted-target.md");
        expect(previous.isExists).not.toHaveBeenCalled();
        expect(feature.recovery.list()).toHaveLength(1);
    });
});

describe("replication serviceFeature composition", () => {
    it("confirms a matching logical deletion only after observing storage absence", async () => {
        const { context, feature } = deletionRecoveryHarness();
        await feature.recovery.reconcile();
        expect(feature.recovery.list()).toEqual([]);
        expect(context.core.serviceModules.storageAccess.isExists).toHaveBeenCalledExactlyOnceWith("deleted-target.md");
        expect(context.core.serviceModules.fileHandler.inspectCurrentFileProvenance).not.toHaveBeenCalled();
    });

    it.each(["file", "folder"])("keeps a deletion pending while its path contains a %s", async () => {
        const { context, feature } = deletionRecoveryHarness();
        context.core.serviceModules.storageAccess.isExists.mockResolvedValue(true);
        await feature.recovery.reconcile();
        expect(feature.recovery.list()).toHaveLength(1);
    });

    it("does not confirm deletion if the current Metadata changes during the absence check", async () => {
        const { context, feature, entry, setCurrent } = deletionRecoveryHarness();
        context.core.serviceModules.storageAccess.isExists.mockImplementation(async () => {
            setCurrent({ ...entry, _rev: "2-restored", deleted: false });
            return false;
        });
        await feature.recovery.reconcile();
        expect(feature.recovery.list()).toHaveLength(1);
    });

    it("keeps an inconclusive deletion absence check pending", async () => {
        const { context, feature } = deletionRecoveryHarness();
        context.core.serviceModules.storageAccess.isExists.mockRejectedValue(new Error("Storage is unavailable"));
        await feature.recovery.reconcile();
        expect(feature.recovery.list()).toHaveLength(1);
    });

    it("retains the scanner's existing deletion-completion policy", async () => {
        const { context, feature } = deletionRecoveryHarness("scan");
        await feature.recovery.reconcile();
        expect(feature.recovery.list()).toHaveLength(1);
        expect(context.core.serviceModules.storageAccess.isExists).not.toHaveBeenCalled();
        expect(context.core.serviceModules.fileHandler.inspectCurrentFileProvenance).toHaveBeenCalledOnce();
    });

    it("resumes held application before detached local recovery admission and acknowledges without waiting", async () => {
        const released = promiseWithResolvers<void>();
        const order: string[] = [];
        const resume = vi
            .spyOn(ReplicateResultProcessor.prototype, "resumeAfterDatabaseRecovery")
            .mockImplementation(() => {
                order.push("resume");
            });
        const retry = vi
            .spyOn(ReplicateResultProcessor.prototype, "retryWaitingReflections")
            .mockImplementation(async () => {
                order.push("retry");
                await released.promise;
            });
        try {
            const context = setup({ recoveryEnabled: true });
            const handler = context.services.databaseEvents.onAfterDatabaseRecovery.addHandler.mock.calls[0][0];
            await expect(handler()).resolves.toBe(true);
            await vi.waitFor(() => expect(retry).toHaveBeenCalledExactlyOnceWith("local-database"));
            expect(order).toEqual(["resume", "retry"]);
        } finally {
            released.resolve();
            resume.mockRestore();
            retry.mockRestore();
        }
    });

    it("keeps local database failure retention independent of remote Chunk settings", async () => {
        const entry = { _id: "local-only", _rev: "1-test", path: "local-only.md", type: "plain" };
        const context = setup({ recoveryEnabled: true, deferComposition: true });
        context.services.setting.currentSettings.mockReturnValue({
            remoteType: "other",
            readChunksOnline: false,
            maxMTimeForReflectEvents: 0,
        });
        context.services.database.isDatabaseReady.mockReturnValue(false);
        const feature = createReplicationFeature(context.core as never);
        feature.register();
        await context.failureHandlers[0](
            { documentId: entry._id as DocumentID, revision: entry._rev },
            new ContentReadError({
                documentId: entry._id as DocumentID,
                revision: entry._rev,
                resources: ["local-database"],
                cause: undefined,
            })
        );
        expect(feature.recovery.list()).toEqual([
            expect.objectContaining({
                documentId: entry._id as DocumentID,
                reason: "local-database",
                automaticAttempted: false,
            }),
        ]);
    });

    it("exposes an inert recovery view while retaining late handler registration", () => {
        const context = setup({ recoveryEnabled: true, deferComposition: true });
        const feature = createReplicationFeature(context.core as never);
        expect(feature.recovery.list()).toEqual([]);
        expect(context.beforeReplicateHandlers.size).toBe(0);
        expect(context.failureHandlers).toEqual([]);
        expect(context.services.databaseEvents.onBeforeDatabaseRecovery.addHandler).not.toHaveBeenCalled();
        expect(context.services.databaseEvents.onAfterDatabaseRecovery.addHandler).not.toHaveBeenCalled();
        feature.register();
        expect(context.beforeReplicateHandlers.size).toBe(2);
        expect(context.failureHandlers).toHaveLength(1);
        expect(context.finiteSuccessHandlers).toHaveLength(1);
    });

    it("awaits startup failure retention and schedules recovery only through the finite success port", async () => {
        const register = vi
            .spyOn(ReplicateResultProcessor.prototype, "registerReflectionFailure")
            .mockResolvedValue(undefined);
        const retry = vi
            .spyOn(ReplicateResultProcessor.prototype, "retryWaitingReflections")
            .mockResolvedValue(undefined);
        try {
            const context = setup({ recoveryEnabled: true });
            const target = { documentId: "pending", revision: "1-test" };
            const failure = new Error("Content unavailable");
            await expect(context.failureHandlers[0](target, failure)).resolves.toBe(true);
            expect(register).toHaveBeenCalledExactlyOnceWith(target, failure, "scan");
            expect(retry).not.toHaveBeenCalled();
            await expect(context.finiteSuccessHandlers[0]()).resolves.toBe(true);
            expect(retry).toHaveBeenCalledOnce();
        } finally {
            register.mockRestore();
            retry.mockRestore();
        }
    });

    it("acknowledges finite success while a recovery inspection still awaits the producer's release", async () => {
        const producerReleased = promiseWithResolvers<void>();
        const inspectionStarted = promiseWithResolvers<void>();
        const retry = vi
            .spyOn(ReplicateResultProcessor.prototype, "retryWaitingReflections")
            .mockImplementation(async () => {
                inspectionStarted.resolve();
                await producerReleased.promise;
            });
        let acknowledged = false;
        let completion: Promise<void> | undefined;
        try {
            const context = setup({ recoveryEnabled: true });
            completion = context.finiteSuccessHandlers[0]().then(() => {
                acknowledged = true;
                producerReleased.resolve();
            });
            await inspectionStarted.promise;
            await vi.waitFor(() => expect(acknowledged).toBe(true));
        } finally {
            producerReleased.resolve();
            await completion;
            retry.mockRestore();
        }
    });

    it("retires a conflicted target only after the existing conflict owner accepts it", async () => {
        const entry = {
            _id: "conflicted",
            _rev: "2-current",
            path: "conflicted.md",
            type: "plain",
            _conflicts: ["1-other"],
        };
        const context = setup({
            recoveryEnabled: true,
            deferComposition: true,
            getLocalDatabase: () => ({ getRaw: async () => entry }),
        });
        context.services.setting.currentSettings.mockReturnValue({
            remoteType: REMOTE_COUCHDB,
            readChunksOnline: true,
            maxMTimeForReflectEvents: 0,
        });
        const feature = createReplicationFeature(context.core as never);
        feature.register();
        await context.failureHandlers[0](
            { documentId: entry._id as DocumentID, revision: entry._rev },
            new ContentReadError({
                documentId: entry._id as DocumentID,
                revision: entry._rev,
                resources: ["remote"],
                cause: undefined,
            })
        );
        expect(feature.recovery.list()).toHaveLength(1);
        const accepted = promiseWithResolvers<undefined>();
        context.services.conflict.queueCheckForIfOpen.mockImplementation(() => accepted.promise);
        const reconciliation = feature.recovery.reconcile();
        try {
            await vi.waitFor(() =>
                expect(context.services.conflict.queueCheckForIfOpen).toHaveBeenCalledExactlyOnceWith(entry.path)
            );
            expect(feature.recovery.list()).toHaveLength(1);
            accepted.resolve(undefined);
            await reconciliation;
            expect(feature.recovery.list()).toEqual([]);
        } finally {
            accepted.resolve(undefined);
            await reconciliation;
        }
    });

    it("does not acquire the local database while composing result handlers", () => {
        const acquireLocalDatabase = vi.fn(() => {
            throw new Error("Local database is not ready yet");
        });

        expect(() => setup({ getLocalDatabase: acquireLocalDatabase })).not.toThrow();
        expect(acquireLocalDatabase).not.toHaveBeenCalled();
    });

    it("acquires the current key-value database only when snapshot recovery starts", async () => {
        const backingDatabase = {
            get: vi.fn(async () => undefined),
            set: vi.fn(async () => undefined),
        };
        let isReady = false;
        const acquireKeyValueDB = vi.fn(() => {
            if (!isReady) throw new Error("KeyValueDB is not initialized yet");
            return backingDatabase;
        });
        const keyValueDB = {
            get kvDB() {
                return acquireKeyValueDB();
            },
        };

        const { beforeReplicateHandlers } = setup({ keyValueDB });

        expect(acquireKeyValueDB).not.toHaveBeenCalled();
        isReady = true;
        const restoreSnapshot = beforeReplicateHandlers.get(100);
        expect(restoreSnapshot).toBeDefined();
        await expect(restoreSnapshot!(false)).resolves.toBe(true);
        expect(acquireKeyValueDB).toHaveBeenCalledOnce();
        expect(backingDatabase.get).toHaveBeenCalledOnce();
    });

    it("refreshes and disposes the remote Security Seed before central replication", async () => {
        const { centralRemoteHandlers, createRemoteResource, dispose, read } = setup();

        await expect(centralRemoteHandlers[0](false)).resolves.toBe(true);

        expect(createRemoteResource).toHaveBeenCalledWith("security-seed", {});
        expect(read).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("keeps generic preflight separate from central-remote preparation", async () => {
        const { beforeReplicateHandlers, centralRemoteHandlers, createRemoteResource } = setup();
        const online = beforeReplicateHandlers.get(10);
        const general = beforeReplicateHandlers.get(100);

        expect(online).toBeDefined();
        expect(general).toBeDefined();
        expect(centralRemoteHandlers).toHaveLength(1);
        await expect(online!(false)).resolves.toBe(true);
        await expect(general!(false)).resolves.toBe(true);
        expect(createRemoteResource).not.toHaveBeenCalled();

        await expect(centralRemoteHandlers[0](false)).resolves.toBe(true);
        expect(createRemoteResource).toHaveBeenCalledOnce();
    });

    it("continues held results when Commonlib establishes application readiness", () => {
        const continueHeldDocuments = vi
            .spyOn(ReplicateResultProcessor.prototype, "continueHeldDocuments")
            .mockImplementation(() => undefined);
        try {
            const { context } = setup();
            expect(continueHeldDocuments).not.toHaveBeenCalled();

            context.events.emitEvent(EVENT_APPLICATION_READY);

            expect(continueHeldDocuments).toHaveBeenCalledOnce();
        } finally {
            continueHeldDocuments.mockRestore();
        }
    });

    it("requests owner retirement without awaiting the transition from result application", async () => {
        const retirement = promiseWithResolvers<boolean>();
        const onCloseActiveReplication = vi.fn(() => retirement.promise);
        const harness = setup({ onCloseActiveReplication });
        const versionInfo = {
            _id: VERSIONING_DOCID,
            _rev: "1-test",
            type: "versioninfo",
            version: REMOTE_FEATURE_GENERATION + 1,
        } as unknown as PouchDB.Core.ExistingDocument<EntryDoc>;

        expect(harness.parseHandler).toBeDefined();
        await expect(harness.parseHandler!([versionInfo])).resolves.toBe(true);
        expect(onCloseActiveReplication).toHaveBeenCalledOnce();

        retirement.resolve(true);
    });
});
