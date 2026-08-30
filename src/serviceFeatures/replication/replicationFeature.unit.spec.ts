import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { VER, type EntryDoc } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import { useReplicationFeature } from "./index";

type BooleanHandler = (showMessage: boolean) => Promise<boolean>;
type ParseHandler = (documents: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<boolean>;
type KeyValueDBFixture = {
    readonly kvDB: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<unknown>;
    };
};
type SetupOptions = {
    readonly getLocalDatabase?: () => object;
    readonly keyValueDB?: KeyValueDBFixture;
    readonly onCloseActiveReplication?: () => Promise<boolean>;
};

function setup(options: SetupOptions = {}) {
    const {
        getLocalDatabase = () => ({}),
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
    let parseHandler: ParseHandler | undefined;
    const services = {
        API: { isMobile: vi.fn(() => false), isOnline: true },
        appLifecycle: {
            getUnresolvedMessages: { addHandler: vi.fn() },
            isReady: true,
            isSuspended: vi.fn(() => false),
            onSettingLoaded: { addHandler: vi.fn() },
        },
        context: createServiceContext(),
        databaseEvents: { onDatabaseInitialised: { addHandler: vi.fn() } },
        keyValueDB,
        path: { getPath: vi.fn((entry: { path: string }) => entry.path) },
        replication: {
            onBeforeReplicate: {
                addHandler: vi.fn((handler: BooleanHandler, priority = 0) => {
                    beforeReplicateHandlers.set(priority, handler);
                }),
            },
            onPrepareCentralRemoteReplication: {
                addHandler: vi.fn((handler: BooleanHandler) => centralRemoteHandlers.push(handler)),
            },
            onReplicationFailed: { addHandler: vi.fn() },
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
        vault: {},
    };
    const core = {
        confirm: {},
        get localDatabase() {
            return getLocalDatabase();
        },
        rebuilder: {},
        services,
    };

    useReplicationFeature(core as never);

    return {
        beforeReplicateHandlers,
        centralRemoteHandlers,
        createRemoteResource,
        dispose,
        get parseHandler() {
            return parseHandler;
        },
        onCloseActiveReplication,
        read,
    };
}

describe("replication serviceFeature composition", () => {
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

    it("requests owner retirement without awaiting the transition from result application", async () => {
        const retirement = promiseWithResolvers<boolean>();
        const onCloseActiveReplication = vi.fn(() => retirement.promise);
        const harness = setup({ onCloseActiveReplication });
        const versionInfo = {
            _id: "versioninfo",
            _rev: "1-test",
            type: "versioninfo",
            version: VER + 1,
        } as unknown as PouchDB.Core.ExistingDocument<EntryDoc>;

        expect(harness.parseHandler).toBeDefined();
        await expect(harness.parseHandler!([versionInfo])).resolves.toBe(true);
        expect(onCloseActiveReplication).toHaveBeenCalledOnce();

        retirement.resolve(true);
    });
});
