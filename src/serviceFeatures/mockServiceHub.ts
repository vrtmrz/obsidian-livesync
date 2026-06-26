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
                },
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
                onBeforeReplicate: createEventMock(),
                onReplicationFailed: createEventMock(),
                replicateByEvent: vi.fn(),
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
            },
            vault: {
                getActiveFilePath: vi.fn(),
            },
        },
    };
};
