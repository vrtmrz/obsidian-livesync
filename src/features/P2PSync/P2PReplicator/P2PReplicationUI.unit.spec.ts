import { beforeEach, describe, expect, it, vi } from "vitest";

const modalState = vi.hoisted(() => ({
    instances: [] as Array<{
        p2p: unknown;
        callback: {
            onSync: (peerId: string) => Promise<boolean>;
            onSyncAndClose: (peerId: string) => Promise<boolean>;
        };
        onClosed?: () => void;
        open: ReturnType<typeof vi.fn>;
    }>,
}));

vi.mock("@/deps.ts", () => ({ App: class {} }));

vi.mock("./P2POpenReplicationModal", () => ({
    P2POpenReplicationModal: class {
        p2p;
        callback;
        onClosed;
        open = vi.fn();

        constructor(
            _app: unknown,
            p2p: unknown,
            callback: (typeof modalState.instances)[number]["callback"],
            _showResult: boolean,
            _title?: string,
            onClosed?: () => void
        ) {
            this.p2p = p2p;
            this.callback = callback;
            this.onClosed = onClosed;
            modalState.instances.push(this);
        }
    },
}));

import { createOpenRebuildUI, createOpenReplicationUI } from "./P2PReplicationUI";

function createReplicator() {
    return {
        replicateFrom: vi.fn(async () => ({ status: "completed" as const, ok: true as const })),
        requestSynchroniseToPeer: vi.fn(async () => ({ status: "completed" as const, ok: true as const })),
        close: vi.fn(async () => undefined),
        setOnSetup: vi.fn(),
        clearOnSetup: vi.fn(),
    } as any;
}

function createP2PServiceViews() {
    return {
        transportLifecycle: {
            disconnect: vi.fn(async () => undefined),
        },
        targetedTransfer: {
            pullFromPeer: vi.fn(async () => ({ status: "completed" as const, ok: true as const })),
            requestPushToPeer: vi.fn(async () => ({ status: "completed" as const, ok: true as const })),
        },
        diagnostics: {},
    } as any;
}

describe("createOpenReplicationUI", () => {
    beforeEach(() => {
        modalState.instances.length = 0;
    });

    it("settles a cancelled peer-selection session when the modal closes", async () => {
        const p2p = createP2PServiceViews();
        const session = createOpenReplicationUI({} as any)(p2p)(true);
        const modal = modalState.instances[0];

        expect(modal.p2p).toBe(p2p);
        expect(modal.onClosed).toBeTypeOf("function");
        modal.onClosed?.();

        await expect(session).resolves.toBe(false);
    });

    it("keeps repeated synchronisation inside the session boundary until the modal closes", async () => {
        const p2p = createP2PServiceViews();
        const session = createOpenReplicationUI({} as any)(p2p)(true);
        const modal = modalState.instances[0];
        let settled = false;
        void session.finally(() => {
            settled = true;
        });

        await expect(modal.callback.onSync("peer-a")).resolves.toBe(true);
        await Promise.resolve();

        expect(settled).toBe(false);
        await modal.callback.onSync("peer-b");
        expect(p2p.targetedTransfer.pullFromPeer).toHaveBeenCalledTimes(2);
        expect(p2p.targetedTransfer.requestPushToPeer).toHaveBeenCalledTimes(2);

        modal.onClosed?.();
        await expect(session).resolves.toBe(true);
    });

    it("routes ordinary peer transfer through the stable targeted-transfer view", async () => {
        const p2p = createP2PServiceViews();
        const session = createOpenReplicationUI({} as any)(p2p)(true);
        const modal = modalState.instances[0];

        await modal.callback.onSync("peer-a");
        modal.onClosed?.();
        await expect(session).resolves.toBe(true);

        expect(p2p.targetedTransfer.pullFromPeer).toHaveBeenCalledWith("peer-a", { showNotice: true });
        expect(p2p.targetedTransfer.requestPushToPeer).toHaveBeenCalledWith("peer-a");
    });

    it("waits for an in-flight synchronisation when the modal closes", async () => {
        let finishPull!: (value: { status: "completed"; ok: true }) => void;
        const p2p = createP2PServiceViews();
        p2p.targetedTransfer.pullFromPeer.mockImplementation(
            async () =>
                await new Promise<{ status: "completed"; ok: true }>((resolve) => {
                    finishPull = resolve;
                })
        );
        const session = createOpenReplicationUI({} as any)(p2p)(true);
        const modal = modalState.instances[0];
        let settled = false;
        void session.finally(() => {
            settled = true;
        });

        const synchronisation = modal.callback.onSync("peer-a");
        modal.onClosed?.();
        await Promise.resolve();

        expect(settled).toBe(false);

        finishPull({ status: "completed", ok: true });
        await synchronisation;
        await expect(session).resolves.toBe(true);
    });

    it("closes the P2P connection after a successful sync-and-close action", async () => {
        const p2p = createP2PServiceViews();
        const session = createOpenReplicationUI({} as any)(p2p)(true);
        const modal = modalState.instances[0];

        await modal.callback.onSyncAndClose("peer-a");

        expect(p2p.transportLifecycle.disconnect).toHaveBeenCalledOnce();
        let settled = false;
        void session.finally(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        modal.onClosed?.();
        await expect(session).resolves.toBe(true);
    });

    it("returns a cancelled peer push as non-success to the presentation boundary", async () => {
        const p2p = createP2PServiceViews();
        p2p.targetedTransfer.requestPushToPeer.mockResolvedValue({ status: "cancelled" } as never);
        const session = createOpenReplicationUI({} as any)(p2p)(true);
        const modal = modalState.instances[0];

        const actionResult = await modal.callback.onSync("peer-a");
        modal.onClosed?.();

        expect(actionResult).toBe(false);
        await expect(session).resolves.toBe(false);
    });
});

describe("createOpenRebuildUI", () => {
    beforeEach(() => {
        modalState.instances.length = 0;
    });

    it("waits for an in-flight rebuild when the modal closes", async () => {
        let finishPull!: (value: { status: "completed"; ok: true }) => void;
        const replicator = createReplicator();
        replicator.replicateFrom.mockImplementation(
            async () =>
                await new Promise<{ status: "completed"; ok: true }>((resolve) => {
                    finishPull = resolve;
                })
        );
        const session = createOpenRebuildUI({} as any)(replicator, createP2PServiceViews())(true);
        const modal = modalState.instances[0];
        let settled = false;
        void session.finally(() => {
            settled = true;
        });

        const rebuild = modal.callback.onSyncAndClose("peer-a");
        modal.onClosed?.();
        await Promise.resolve();

        expect(settled).toBe(false);

        finishPull({ status: "completed", ok: true });
        await expect(rebuild).resolves.toBe(true);
        await expect(session).resolves.toBe(true);
        expect(replicator.setOnSetup).toHaveBeenCalledOnce();
        expect(replicator.replicateFrom).toHaveBeenCalledWith("peer-a", true, true);
        expect(replicator.clearOnSetup).toHaveBeenCalledOnce();
    });

    it("does not complete Fetch when the rebuild dialogue closes without selecting a peer", async () => {
        const replicator = createReplicator();
        const session = createOpenRebuildUI({} as any)(replicator, createP2PServiceViews())(true);
        const modal = modalState.instances[0];

        modal.onClosed?.();

        await expect(session).resolves.toBe(false);
        expect(replicator.replicateFrom).not.toHaveBeenCalled();
        expect(replicator.setOnSetup).not.toHaveBeenCalled();
    });
});
