import { describe, expect, it, vi } from "vitest";
import { useDatabaseConnectionRecovery } from "./databaseConnectionRecovery";

function setup() {
    const callbacks: Record<string, (...args: any[]) => Promise<boolean>> = {};
    const event = (name: string) => ({
        addHandler: (callback: (typeof callbacks)[string]) => {
            callbacks[name] = callback;
        },
    });
    const selected = { isReady: true };
    const database = {
        localDatabaseDirect: selected,
        checkDatabaseConnection: vi.fn(async () => true),
        reopenDatabase: vi.fn(async () => {
            database.localDatabaseDirect = { isReady: true };
            return true;
        }),
        onLocalDatabaseError: event("error"),
    };
    database.checkDatabaseConnection.mockImplementation(async () => database.localDatabaseDirect.isReady);
    const services = {
        API: { addLog: vi.fn() },
        database,
        databaseEvents: {
            onBeforeDatabaseResume: event("foreground"),
            onAfterDatabaseRecovery: vi.fn(async () => true),
        },
        appLifecycle: {
            isReady: vi.fn(() => true),
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
    useDatabaseConnectionRecovery({ services } as never, dispatch, visible);
    return { callbacks, selected, services, database, dispatch, visible };
}

const closing = () => new DOMException("The database connection is closing.", "InvalidStateError");

describe("local database connection recovery", () => {
    it("only checks the existing connection when healthy", async () => {
        const { callbacks, database, dispatch } = setup();
        await expect(callbacks.foreground()).resolves.toBe(true);
        expect(database.checkDatabaseConnection).toHaveBeenCalledOnce();
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        expect(dispatch.pauseDispatch).not.toHaveBeenCalled();
    });

    it("does not classify an operation's InvalidStateError as disconnection when info succeeds", async () => {
        const { callbacks, selected, database } = setup();
        await expect(callbacks.error(selected, closing())).resolves.toBe(true);
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        expect(selected.isReady).toBe(true);
    });

    it("waits for accepted file work and retires replication before reopening once", async () => {
        const { callbacks, selected, database, dispatch, services } = setup();
        database.checkDatabaseConnection.mockRejectedValue(closing());
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
        database.checkDatabaseConnection.mockRejectedValue(closing());
        await expect(callbacks.error(selected, closing())).resolves.toBe(false);
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        expect(dispatch.resumeDispatch).not.toHaveBeenCalled();
        visible.mockReturnValue(true);
        await expect(callbacks.foreground()).resolves.toBe(true);
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
    });

    it("does not recover old instances or remote and unrelated failures", async () => {
        const { callbacks, selected, database } = setup();
        await callbacks.error({ isReady: true }, closing());
        await callbacks.error(selected, { status: 401 });
        await callbacks.error(selected, { name: "UnknownError" });
        expect(database.checkDatabaseConnection).not.toHaveBeenCalled();
        expect(database.reopenDatabase).not.toHaveBeenCalled();
    });

    it("does not retry repeatedly within one foreground lifetime", async () => {
        const { callbacks, selected, database } = setup();
        database.checkDatabaseConnection.mockRejectedValue(closing());
        await callbacks.error(selected, closing());
        await expect(callbacks.error(database.localDatabaseDirect, closing())).resolves.toBe(false);
        expect(database.reopenDatabase).toHaveBeenCalledOnce();
    });

    it("releases its hold when an explicit open replaces the failed connection first", async () => {
        const { callbacks, selected, database, dispatch, services } = setup();
        database.checkDatabaseConnection.mockRejectedValueOnce(closing());
        database.reopenDatabase.mockImplementation(async () => {
            database.localDatabaseDirect = { isReady: true };
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
        database.checkDatabaseConnection.mockRejectedValueOnce(closing());
        database.reopenDatabase.mockImplementation(async () => {
            database.localDatabaseDirect = { isReady: false };
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
        database.checkDatabaseConnection.mockRejectedValue(closing());
        services.fileProcessing.commitPendingFileEvents.mockResolvedValue(false);
        await expect(callbacks.error(selected, closing())).resolves.toBe(false);
        expect(services.databaseEvents.onAfterDatabaseRecovery).not.toHaveBeenCalled();
        expect(services.appLifecycle.onResuming).not.toHaveBeenCalled();
        await expect(callbacks.foreground()).resolves.toBe(false);
    });

    it("allows shutdown flushing and rejects a recovery still waiting for file work", async () => {
        const { callbacks, selected, database, dispatch, services } = setup();
        database.checkDatabaseConnection.mockRejectedValue(closing());
        let finish!: () => void;
        dispatch.pauseDispatch.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finish = resolve;
            })
        );
        const recovery = callbacks.error(selected, closing());
        await vi.waitFor(() => expect(dispatch.pauseDispatch).toHaveBeenCalledOnce());
        await callbacks.unload();
        finish();
        await expect(recovery).resolves.toBe(false);
        expect(dispatch.resumeDispatch).toHaveBeenCalledOnce();
        expect(database.reopenDatabase).not.toHaveBeenCalled();
        expect(services.appLifecycle.onResuming).not.toHaveBeenCalled();
    });
});
