import { describe, expect, it, vi } from "vitest";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import {
    createDatabaseConnectionRecoveryContext,
    requestDatabaseConnectionRecovery,
    useDatabaseConnectionRecovery,
} from "./databaseConnectionRecovery";

function setup(registerRecovery = true) {
    const callbacks: Record<string, (...args: any[]) => Promise<boolean>> = {};
    const priorities: Record<string, number | undefined> = {};
    const event = (name: string) => ({
        addHandler: (callback: (typeof callbacks)[string], priority?: number) => {
            callbacks[name] = callback;
            priorities[name] = priority;
        },
    });
    const selected = { isReady: true, stopReads: vi.fn() };
    const database = {
        localDatabaseDirect: selected,
        canReadCurrentDatabaseInfo: vi.fn(async () => true),
        reopenDatabase: vi.fn(async () => {
            database.localDatabaseDirect = { isReady: true, stopReads: vi.fn() };
            return true;
        }),
        onLocalDatabaseError: event("error"),
    };
    database.canReadCurrentDatabaseInfo.mockImplementation(async () => database.localDatabaseDirect.isReady);
    const services = {
        API: { addLog: vi.fn() },
        database,
        databaseEvents: {
            onBeforeDatabaseResume: event("foreground"),
            onAfterDatabaseRecovery: vi.fn(async () => true),
        },
        appLifecycle: {
            isReady: vi.fn(() => true),
            isUnloading: vi.fn(() => false),
            isSuspended: vi.fn(() => false),
            onSuspending: vi.fn(async () => true),
            onResuming: vi.fn(async () => true),
            onResumed: vi.fn(async () => true),
            onBeforeUnload: event("unload"),
        },
        fileProcessing: { commitPendingFileEvents: vi.fn(async () => true) },
        replicator: { onCloseActiveReplication: vi.fn(async () => true) },
        setting: { currentSettings: () => ({ isConfigured: true }) },
    };
    const dispatch = { pauseDispatch: vi.fn(async (): Promise<void> => {}), resumeDispatch: vi.fn() };
    const visible = vi.fn(() => true);
    if (registerRecovery) {
        useDatabaseConnectionRecovery({ services } as never, dispatch, visible);
    }
    return { callbacks, priorities, selected, services, database, dispatch, visible };
}

const closing = () => new DOMException("The database connection is closing.", "InvalidStateError");

describe("local database connection recovery", () => {
    it("ends failed connection read waits before dispatch retirement drains their callers", async () => {
        const { callbacks, selected, database, dispatch } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValueOnce(closing());
        dispatch.pauseDispatch.mockImplementationOnce(async () => {
            expect(selected.stopReads).toHaveBeenCalledOnce();
        });

        await expect(callbacks.foreground()).resolves.toBe(true);
        expect(selected.stopReads).toHaveBeenCalledOnce();
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
    });

    it("releases retained failures after confirming that the current connection is still readable", async () => {
        const { callbacks, selected, database, services, dispatch } = setup();
        await expect(callbacks.error(selected, new Error("Aborted transaction"))).resolves.toBe(true);
        expect(services.databaseEvents.onAfterDatabaseRecovery).toHaveBeenCalledOnce();
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        expect(dispatch.pauseDispatch).not.toHaveBeenCalled();
        expect(services.appLifecycle.onResuming).not.toHaveBeenCalled();
    });

    it("defers a readable connection's retry notification until the host becomes active", async () => {
        const { callbacks, selected, services, database, visible } = setup();
        visible.mockReturnValue(false);
        await expect(callbacks.error(selected, new Error("Aborted transaction"))).resolves.toBe(true);
        expect(services.databaseEvents.onAfterDatabaseRecovery).not.toHaveBeenCalled();
        visible.mockReturnValue(true);
        await expect(callbacks.foreground()).resolves.toBe(true);
        expect(services.databaseEvents.onAfterDatabaseRecovery).toHaveBeenCalledOnce();
        expect(database.reopenDatabase).not.toHaveBeenCalled();
    });

    it("does not treat a failed resumption handler as a failed database connection", async () => {
        const { callbacks, selected, services, database, dispatch } = setup();
        services.databaseEvents.onAfterDatabaseRecovery.mockRejectedValueOnce(new Error("Handler failed"));
        await expect(callbacks.error(selected, new Error("Aborted transaction"))).resolves.toBe(false);
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        expect(dispatch.pauseDispatch).not.toHaveBeenCalled();
    });

    it("shares a direct recovery request and clears it when the operation settles", async () => {
        const { services, database, dispatch, visible } = setup(false);
        const context = createDatabaseConnectionRecoveryContext({ services } as never, dispatch, visible);
        database.canReadCurrentDatabaseInfo.mockRejectedValue(closing());
        let finish!: () => void;
        dispatch.pauseDispatch.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                })
        );

        const first = requestDatabaseConnectionRecovery(context, true);
        expect(requestDatabaseConnectionRecovery(context, false)).toBe(first);
        await vi.waitFor(() => expect(dispatch.pauseDispatch).toHaveBeenCalledOnce());
        finish();

        await expect(first).resolves.toBe(true);
        expect(context.running).toBeUndefined();
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
    });

    it("only checks the existing connection when healthy", async () => {
        const { callbacks, database, dispatch } = setup();
        await expect(callbacks.foreground()).resolves.toBe(true);
        expect(database.canReadCurrentDatabaseInfo).toHaveBeenCalledOnce();
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        expect(dispatch.pauseDispatch).not.toHaveBeenCalled();
    });

    it("does not classify an operation's InvalidStateError as disconnection when info succeeds", async () => {
        const { callbacks, selected, database } = setup();
        await expect(callbacks.error(selected, closing())).resolves.toBe(true);
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        expect(selected.isReady).toBe(true);
    });

    it("probes an owned operation failure without inferring its cause and reopens after info rejects", async () => {
        const { callbacks, selected, database } = setup();
        const failure = new Error("read failed");
        database.canReadCurrentDatabaseInfo.mockRejectedValueOnce(failure);
        await expect(callbacks.error(selected, failure)).resolves.toBe(true);
        expect(database.canReadCurrentDatabaseInfo).toHaveBeenCalledOnce();
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
    });

    it("reopens after a foreground info failure regardless of error name", async () => {
        const { callbacks, database } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValueOnce(new Error("connection unavailable"));
        await expect(callbacks.foreground()).resolves.toBe(true);
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
    });

    it("waits for accepted file work and retires replication before reopening once", async () => {
        const { callbacks, selected, database, dispatch, services } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValue(closing());
        let finish!: () => void;
        dispatch.pauseDispatch.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finish = resolve;
            })
        );
        const first = callbacks.error(selected, closing());
        const duplicate = callbacks.error(selected, closing());
        await vi.waitFor(() => expect(dispatch.pauseDispatch).toHaveBeenCalledOnce());
        expect(selected.isReady).toBe(false);
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        finish();
        await expect(first).resolves.toBe(true);
        await expect(duplicate).resolves.toBe(true);
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
        expect(services.replicator.onCloseActiveReplication).toHaveBeenCalledOnce();
        expect(services.fileProcessing.commitPendingFileEvents).toHaveBeenCalledOnce();
        expect(services.appLifecycle.onResuming).toHaveBeenCalledOnce();
    });

    it("holds a background failure and reopens on the next foreground boundary", async () => {
        const { callbacks, selected, database, dispatch, visible } = setup();
        visible.mockReturnValue(false);
        database.canReadCurrentDatabaseInfo.mockRejectedValue(closing());
        await expect(callbacks.error(selected, closing())).resolves.toBe(false);
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        expect(dispatch.resumeDispatch).not.toHaveBeenCalled();
        visible.mockReturnValue(true);
        await expect(callbacks.foreground()).resolves.toBe(true);
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
    });

    it("ignores retired owners and probes current owned failures without reopening a readable DB", async () => {
        const { callbacks, selected, database } = setup();
        await callbacks.error({ isReady: true }, closing());
        await callbacks.error(selected, { status: 401 });
        await callbacks.error(selected, { name: "UnknownError" });
        expect(database.canReadCurrentDatabaseInfo).toHaveBeenCalledTimes(2);
        expect(database.reopenDatabase).not.toHaveBeenCalled();
    });

    it("does not retry repeatedly within one foreground lifetime", async () => {
        const { callbacks, selected, database } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValue(closing());
        await callbacks.error(selected, closing());
        await expect(callbacks.error(database.localDatabaseDirect, closing())).resolves.toBe(false);
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
    });

    it("releases its hold when an explicit open replaces the failed connection first", async () => {
        const { callbacks, selected, database, dispatch, services } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValueOnce(closing());
        database.reopenDatabase.mockImplementation(async () => {
            database.localDatabaseDirect = { isReady: true, stopReads: vi.fn() };
            return false;
        });
        await expect(callbacks.error(selected, closing())).resolves.toBe(true);
        expect(dispatch.resumeDispatch).toHaveBeenCalledOnce();
        expect(services.fileProcessing.commitPendingFileEvents).toHaveBeenCalledOnce();
        expect(services.databaseEvents.onAfterDatabaseRecovery).toHaveBeenCalledOnce();
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
    });

    it("reconciles a replacement which finishes opening at a later foreground boundary", async () => {
        const { callbacks, selected, database, dispatch } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValueOnce(closing());
        database.reopenDatabase.mockImplementation(async () => {
            database.localDatabaseDirect = { isReady: false, stopReads: vi.fn() };
            return false;
        });
        await expect(callbacks.error(selected, closing())).resolves.toBe(false);
        expect(dispatch.resumeDispatch).not.toHaveBeenCalled();
        database.localDatabaseDirect.isReady = true;
        await expect(callbacks.foreground()).resolves.toBe(true);
        expect(dispatch.resumeDispatch).toHaveBeenCalledOnce();
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
    });

    it("does not resume sync when pending local edits fail to reconcile", async () => {
        const { callbacks, selected, database, services } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValue(closing());
        services.fileProcessing.commitPendingFileEvents.mockResolvedValue(false);
        await expect(callbacks.error(selected, closing())).resolves.toBe(false);
        expect(services.databaseEvents.onAfterDatabaseRecovery).not.toHaveBeenCalled();
        expect(services.appLifecycle.onResuming).not.toHaveBeenCalled();
        await expect(callbacks.foreground()).resolves.toBe(false);
    });

    it("stops paused recovery at unload priority -100 without resuming dispatch", async () => {
        const { callbacks, priorities, selected, database, dispatch, services } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValueOnce(closing());
        let finish!: () => void;
        dispatch.pauseDispatch.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finish = resolve;
            })
        );
        const recovery = callbacks.error(selected, closing());
        await vi.waitFor(() => expect(dispatch.pauseDispatch).toHaveBeenCalledOnce());
        expect(priorities.unload).toBe(-100);
        await expect(callbacks.unload()).resolves.toBe(true);
        expect(dispatch.resumeDispatch).not.toHaveBeenCalled();
        finish();

        await expect(recovery).resolves.toBe(false);
        await expect(callbacks.foreground()).resolves.toBe(false);
        await expect(callbacks.error(selected, closing())).resolves.toBe(true);
        expect(database.canReadCurrentDatabaseInfo).toHaveBeenCalledOnce();
        expect(dispatch.resumeDispatch).not.toHaveBeenCalled();
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        expect(services.fileProcessing.commitPendingFileEvents).not.toHaveBeenCalled();
        expect(services.databaseEvents.onAfterDatabaseRecovery).not.toHaveBeenCalled();
        expect(services.appLifecycle.onResuming).not.toHaveBeenCalled();
        expect(services.appLifecycle.onResumed).not.toHaveBeenCalled();
    });

    it("stops recovery when the host begins unloading during database reopen", async () => {
        const { callbacks, selected, database, dispatch, services } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValueOnce(closing());
        database.reopenDatabase.mockImplementationOnce(async () => {
            services.appLifecycle.isUnloading.mockReturnValue(true);
            return true;
        });

        await expect(callbacks.error(selected, closing())).resolves.toBe(false);
        await expect(callbacks.error(selected, closing())).resolves.toBe(true);
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
        expect(dispatch.resumeDispatch).not.toHaveBeenCalled();
        expect(services.fileProcessing.commitPendingFileEvents).not.toHaveBeenCalled();
        expect(services.databaseEvents.onAfterDatabaseRecovery).not.toHaveBeenCalled();
        expect(services.appLifecycle.onResuming).not.toHaveBeenCalled();
        expect(services.appLifecycle.onResumed).not.toHaveBeenCalled();
    });

    it.each([true, false])("stops after a database probe settles during unload (readable: %s)", async (readable) => {
        const { callbacks, selected, database, dispatch, services } = setup();
        database.canReadCurrentDatabaseInfo.mockImplementationOnce(async () => {
            services.appLifecycle.isUnloading.mockReturnValue(true);
            if (!readable) {
                throw closing();
            }
            return true;
        });

        await expect(callbacks.error(selected, closing())).resolves.toBe(false);
        expect(dispatch.pauseDispatch).not.toHaveBeenCalled();
        expect(services.databaseEvents.onAfterDatabaseRecovery).not.toHaveBeenCalled();
    });

    it("fences recovery immediately when unloading during a replacement connection probe", async () => {
        const { callbacks, selected, database, dispatch, services } = setup();
        const replacement = { isReady: true, stopReads: vi.fn() };
        const probing = promiseWithResolvers<void>();
        const read = promiseWithResolvers<boolean>();
        database.canReadCurrentDatabaseInfo.mockRejectedValueOnce(closing()).mockImplementationOnce(() => {
            expect(database.localDatabaseDirect).toBe(replacement);
            probing.resolve();
            return read.promise;
        });
        database.reopenDatabase.mockImplementationOnce(() => {
            database.localDatabaseDirect = replacement;
            return Promise.resolve(false);
        });

        const recovery = callbacks.error(selected, closing());
        try {
            await probing.promise;
            await expect(callbacks.unload()).resolves.toBe(true);
            await expect(callbacks.foreground()).resolves.toBe(false);
        } finally {
            read.resolve(true);
            await expect(recovery).resolves.toBe(false);
        }
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
        expect(dispatch.pauseDispatch).toHaveBeenCalledOnce();
        expect(dispatch.resumeDispatch).not.toHaveBeenCalled();
        expect(services.fileProcessing.commitPendingFileEvents).not.toHaveBeenCalled();
        expect(services.databaseEvents.onAfterDatabaseRecovery).not.toHaveBeenCalled();
    });

    it("leaves dispatch stopped when a pending file commit fails during unload", async () => {
        const { callbacks, selected, database, dispatch, services } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValueOnce(closing());
        services.fileProcessing.commitPendingFileEvents.mockImplementationOnce(async () => {
            services.appLifecycle.isUnloading.mockReturnValue(true);
            return false;
        });

        await expect(callbacks.error(selected, closing())).resolves.toBe(false);
        expect(dispatch.pauseDispatch).toHaveBeenCalledOnce();
        expect(services.databaseEvents.onAfterDatabaseRecovery).not.toHaveBeenCalled();
        expect(services.appLifecycle.onResuming).not.toHaveBeenCalled();
    });

    it("skips the resumed hook when unload starts during the resuming hook", async () => {
        const { callbacks, selected, database, services } = setup();
        database.canReadCurrentDatabaseInfo.mockRejectedValueOnce(closing());
        services.appLifecycle.onResuming.mockImplementationOnce(async () => {
            services.appLifecycle.isUnloading.mockReturnValue(true);
            return true;
        });

        await expect(callbacks.error(selected, closing())).resolves.toBe(false);
        expect(services.appLifecycle.onResuming).toHaveBeenCalledOnce();
        expect(services.appLifecycle.onResumed).not.toHaveBeenCalled();
    });
});
