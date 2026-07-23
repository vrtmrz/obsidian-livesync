import { beforeEach, describe, expect, it, vi } from "vitest";

const modalState = vi.hoisted(() => ({
    instances: [] as Array<{
        callback: {
            onSync: (peerId: string) => Promise<void>;
            onSyncAndClose: (peerId: string) => Promise<void>;
        };
        onClosed?: () => void;
        open: ReturnType<typeof vi.fn>;
    }>,
}));

vi.mock("@/deps.ts", () => ({ App: class {} }));

vi.mock("./P2POpenReplicationModal", () => ({
    P2POpenReplicationModal: class {
        callback;
        onClosed;
        open = vi.fn();

        constructor(
            _app: unknown,
            _replicator: unknown,
            callback: (typeof modalState.instances)[number]["callback"],
            _showResult: boolean,
            _title?: string,
            onClosed?: () => void
        ) {
            this.callback = callback;
            this.onClosed = onClosed;
            modalState.instances.push(this);
        }
    },
}));

import { createOpenRebuildUI, createOpenReplicationUI } from "./P2PReplicationUI";

function createReplicator() {
    return {
        replicateFrom: vi.fn(async () => ({ ok: true })),
        requestSynchroniseToPeer: vi.fn(async () => ({ ok: true })),
        close: vi.fn(async () => undefined),
        setOnSetup: vi.fn(),
        clearOnSetup: vi.fn(),
    } as any;
}

describe("createOpenReplicationUI", () => {
    beforeEach(() => {
        modalState.instances.length = 0;
    });

    it("settles a cancelled peer-selection session when the modal closes", async () => {
        const session = createOpenReplicationUI({} as any)(createReplicator())(true);
        const modal = modalState.instances[0];

        expect(modal.onClosed).toBeTypeOf("function");
        modal.onClosed?.();

        await expect(session).resolves.toBe(false);
    });

    it("keeps repeated synchronisation inside the session boundary until the modal closes", async () => {
        const replicator = createReplicator();
        const session = createOpenReplicationUI({} as any)(replicator)(true);
        const modal = modalState.instances[0];
        let settled = false;
        void session.finally(() => {
            settled = true;
        });

        await modal.callback.onSync("peer-a");
        await Promise.resolve();

        expect(settled).toBe(false);
        await modal.callback.onSync("peer-b");
        expect(replicator.replicateFrom).toHaveBeenCalledTimes(2);
        expect(replicator.requestSynchroniseToPeer).toHaveBeenCalledTimes(2);

        modal.onClosed?.();
        await expect(session).resolves.toBe(true);
    });

    it("waits for an in-flight synchronisation when the modal closes", async () => {
        let finishPull!: (value: { ok: boolean }) => void;
        const replicator = createReplicator();
        replicator.replicateFrom.mockImplementation(
            async () =>
                await new Promise<{ ok: boolean }>((resolve) => {
                    finishPull = resolve;
                })
        );
        const session = createOpenReplicationUI({} as any)(replicator)(true);
        const modal = modalState.instances[0];
        let settled = false;
        void session.finally(() => {
            settled = true;
        });

        const synchronisation = modal.callback.onSync("peer-a");
        modal.onClosed?.();
        await Promise.resolve();

        expect(settled).toBe(false);

        finishPull({ ok: true });
        await synchronisation;
        await expect(session).resolves.toBe(true);
    });

    it("closes the P2P connection after a successful sync-and-close action", async () => {
        const replicator = createReplicator();
        const session = createOpenReplicationUI({} as any)(replicator)(true);
        const modal = modalState.instances[0];

        await modal.callback.onSyncAndClose("peer-a");

        expect(replicator.close).toHaveBeenCalledOnce();
        let settled = false;
        void session.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        modal.onClosed?.();
        await expect(session).resolves.toBe(true);
    });
});

describe("createOpenRebuildUI", () => {
    beforeEach(() => {
        modalState.instances.length = 0;
    });

    it("waits for an in-flight rebuild when the modal closes", async () => {
        let finishPull!: (value: { ok: boolean }) => void;
        const replicator = createReplicator();
        replicator.replicateFrom.mockImplementation(
            async () =>
                await new Promise<{ ok: boolean }>((resolve) => {
                    finishPull = resolve;
                })
        );
        const session = createOpenRebuildUI({} as any)(replicator)(true);
        const modal = modalState.instances[0];
        let settled = false;
        void session.finally(() => {
            settled = true;
        });

        const rebuild = modal.callback.onSyncAndClose("peer-a");
        modal.onClosed?.();
        await Promise.resolve();

        expect(settled).toBe(false);

        finishPull({ ok: true });
        await rebuild;
        await expect(session).resolves.toBe(true);
        expect(replicator.setOnSetup).toHaveBeenCalledOnce();
        expect(replicator.replicateFrom).toHaveBeenCalledWith("peer-a", true, true);
        expect(replicator.clearOnSetup).toHaveBeenCalledOnce();
    });

    it("does not complete Fetch when the rebuild dialogue closes without selecting a peer", async () => {
        const replicator = createReplicator();
        const session = createOpenRebuildUI({} as any)(replicator)(true);
        const modal = modalState.instances[0];

        modal.onClosed?.();

        await expect(session).resolves.toBe(false);
        expect(replicator.replicateFrom).not.toHaveBeenCalled();
        expect(replicator.setOnSetup).not.toHaveBeenCalled();
    });
});
