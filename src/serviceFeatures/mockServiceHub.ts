import { vi } from "vitest";

export const createEventMock = () => {
    const fn = vi.fn();
    const handlers: any[] = [];
    (fn as any).handlers = handlers;
    (fn as any).addHandler = vi.fn((h) => handlers.push(h));
    (fn as any).removeHandler = vi.fn((h) => {
        const idx = handlers.indexOf(h);
        if (idx !== -1) handlers.splice(idx, 1);
    });
    (fn as any).setHandler = vi.fn((h) => handlers.push(h));
    (fn as any).invoke = vi.fn(async (...args) => {
        for (const h of handlers) await h(...args);
    });
    return fn;
};

export const createMockServiceHub = () => {
    const settings = {
        periodicReplication: false,
        periodicReplicationInterval: 0,
        checkConflictOnlyOnOpen: false,
    };

    return {
        services: {
            appLifecycle: {
                onUnload: createEventMock(),
                onSuspending: createEventMock(),
                onSuspended: createEventMock(),
                onResumed: createEventMock(),
                onSettingLoaded: createEventMock(),
                getUnresolvedMessages: createEventMock(),
                isSuspended: vi.fn(() => false),
                isReady: vi.fn(() => true),
            },
            database: {
                localDatabase: {
                    localDatabase: {},
                    tryAutoMerge: vi.fn(),
                    onNewLeaf: vi.fn(),
                    getDBEntryFromMeta: vi.fn(),
                    getRaw: vi.fn(),
                    clearCaches: vi.fn(),
                },
            },
            keyValueDB: {
                kvDB: {
                    get: vi.fn(),
                    set: vi.fn(),
                },
            },
            path: {
                getPath: vi.fn((entry) => entry.path ?? entry._id),
            },
            setting: {
                settings,
                currentSettings: vi.fn(() => settings),
                onBeforeRealiseSetting: createEventMock(),
                onSettingRealised: createEventMock(),
            },
            replication: {
                replicate: createEventMock(),
                checkConnectionFailure: createEventMock(),
                parseSynchroniseResult: createEventMock(),
                processSynchroniseResult: createEventMock(),
                processOptionalSynchroniseResult: createEventMock(),
                processVirtualDocument: createEventMock(),
                onBeforeReplicate: createEventMock(),
                onReplicationFailed: createEventMock(),
                replicateByEvent: vi.fn(),
                databaseQueueCount: { value: 0 },
                storageApplyingCount: { value: 0 },
                replicationResultCount: { value: 0 },
            },
            conflict: {
                queueCheckForIfOpen: createEventMock(),
                queueCheckFor: createEventMock(),
                ensureAllProcessed: createEventMock(),
                getOptionalConflictCheckMethod: vi.fn(),
                resolveByNewest: createEventMock(),
                resolveByDeletingRevision: createEventMock(),
                resolveAllConflictedFilesByNewerOnes: createEventMock(),
                resolve: createEventMock(),
                resolveByUserInteraction: vi.fn(),
                conflictProcessQueueCount: 1,
            },
            conflictResolution: {
                checkConflict: createEventMock(),
                resolveConflict: createEventMock(),
            },
            replicator: {
                registerReplicatorFactory: createEventMock(),
                getNewReplicator: createEventMock(),
                onReplicatorInitialised: createEventMock(),
            },
            databaseEvents: {
                onDatabaseInitialised: createEventMock(),
            },
            API: {
                setInterval: vi.fn((fn, interval) => 123),
                clearInterval: vi.fn(),
                addCommand: vi.fn(),
                addLog: vi.fn(),
            },
            vault: {
                getActiveFilePath: vi.fn(),
                isTargetFile: vi.fn().mockResolvedValue(true),
                isFileSizeTooLarge: vi.fn().mockReturnValue(false),
                isValidPath: vi.fn().mockReturnValue(true),
            },
        },
    };
};
