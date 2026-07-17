import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";

vi.mock("@/features/P2PSync/P2PReplicator/P2PReplicatorPaneView", () => ({
    P2PReplicatorPaneView: class {},
    VIEW_TYPE_P2P: "p2p",
}));
vi.mock("@/features/P2PSync/P2PReplicator/P2PServerStatusPaneView", () => ({
    P2PServerStatusPaneView: class {},
    VIEW_TYPE_P2P_SERVER_STATUS: "p2p-status",
}));

import { useP2PReplicatorUI } from "./useP2PReplicatorUI";

describe("useP2PReplicatorUI commands", () => {
    it("exposes a direct modal P2P replication command as finite replication activity", async () => {
        const commands: Array<{ id: string; checkCallback?: (isChecking: boolean) => unknown }> = [];
        let initialise: (() => Promise<unknown>) | undefined;
        const openReplication = vi.fn(async () => true);
        const runFiniteReplicationActivity = vi.fn(async (task: () => unknown) => await task());
        const host = {
            services: {
                context: createServiceContext(),
                API: {
                    showWindow: vi.fn(async () => undefined),
                    registerWindow: vi.fn(),
                    addCommand: vi.fn((command) => commands.push(command)),
                    addRibbonIcon: vi.fn(),
                    getPlatform: vi.fn(() => "obsidian"),
                },
                appLifecycle: {
                    onInitialise: {
                        addHandler: vi.fn((handler) => {
                            initialise = handler;
                        }),
                    },
                    onLayoutReady: { addHandler: vi.fn() },
                },
                setting: { currentSettings: vi.fn(() => ({ remoteType: "COUCHDB" })) },
                replicator: { runFiniteReplicationActivity },
            },
        } as any;
        const p2p = {
            replicator: {
                server: { isServing: true },
                openReplication,
                replicateFromCommand: vi.fn(),
            },
        } as any;

        useP2PReplicatorUI(host, {} as any, p2p);
        await initialise?.();
        commands.find((command) => command.id === "replicate-now-by-p2p")?.checkCallback?.(false);

        await vi.waitFor(() => expect(openReplication).toHaveBeenCalledOnce());
        expect(runFiniteReplicationActivity).toHaveBeenCalledWith(expect.any(Function), {
            label: "replication",
        });
    });
});
