import { describe, expect, it, vi } from "vitest";
import { collectPeers, createPeerConnectionStatsPayload, openP2PHost, parseTimeoutSeconds, syncWithPeer } from "./p2p";
import { AutoAccepting } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { CLIP2PHostSettings } from "./types";

function createCore() {
    const settings = { P2P_Enabled: true, P2P_AppID: "app-id", P2P_IsHeadless: false };
    return {
        services: {
            setting: { currentSettings: () => settings },
            replicator: { getNewReplicator: vi.fn(() => Promise.reject(new Error("must not be called"))) },
        },
    } as never;
}

function createP2PService() {
    const connect = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    const pullFromPeer = vi.fn(async () => ({ status: "completed" as const, ok: true as const }));
    const requestPushToPeer = vi.fn(async () => ({ status: "completed" as const, ok: true as const }));
    return {
        service: {
            transportLifecycle: { isConnected: false, connect, disconnect },
            peerDirectory: {
                getPeers: () => [{ peerId: "peer-a", name: "Peer A", platform: "test" }],
            },
            targetedTransfer: {
                pullFromPeer,
                requestPushToPeer,
                synchroniseWithPeer: vi.fn(),
            },
            diagnostics: { requestStatus: vi.fn(), getPeerConnectionMetrics: vi.fn() },
        },
        connect,
        disconnect,
        pullFromPeer,
        requestPushToPeer,
    };
}

describe("p2p command helpers", () => {
    const passiveHostSettings: CLIP2PHostSettings = {
        P2P_Enabled: true,
        P2P_AutoAccepting: AutoAccepting.NONE,
        P2P_AutoStart: false,
        P2P_AutoBroadcast: false,
        P2P_AutoSyncPeers: "",
        P2P_AutoWatchPeers: "",
    };

    function createHostCore() {
        const settings = {
            ...passiveHostSettings,
            P2P_Enabled: false,
            P2P_IsHeadless: false,
            P2P_AppID: "app-id",
            liveSync: false,
            suspendFileWatching: true,
        };
        const applyPartial = vi.fn(async (partial: CLIP2PHostSettings) => {
            Object.assign(settings, partial);
        });
        const saveSettingData = vi.fn();
        const applySettings = vi.fn();
        return {
            core: {
                services: {
                    setting: { currentSettings: () => settings, applyPartial, saveSettingData },
                    control: { applySettings },
                },
            },
            settings,
            applyPartial,
            saveSettingData,
            applySettings,
        };
    }

    it.each([
        passiveHostSettings,
        { ...passiveHostSettings, P2P_AutoBroadcast: true, P2P_AutoWatchPeers: "Desktop" },
        { ...passiveHostSettings, P2P_AutoAccepting: AutoAccepting.ALL, P2P_AutoSyncPeers: "Desktop,android" },
    ])("connects with the configured host policy without saving or restarting the lifecycle (%j)", async (original) => {
        const host = createHostCore();
        const { service, connect, disconnect } = createP2PService();
        connect.mockImplementation(async () => {
            expect(host.settings).toMatchObject({ ...original, P2P_IsHeadless: true });
        });

        await expect(openP2PHost(host.core as never, service as never, original)).resolves.toBe(service);

        expect(host.applyPartial).toHaveBeenCalledExactlyOnceWith(original);
        expect(connect).toHaveBeenCalledOnce();
        expect(disconnect).not.toHaveBeenCalled();
        expect(host.settings).toMatchObject({ liveSync: false, suspendFileWatching: true });
        expect(host.saveSettingData).not.toHaveBeenCalled();
        expect(host.applySettings).not.toHaveBeenCalled();
    });

    it("keeps P2P disabled when the saved host policy disables it", async () => {
        const host = createHostCore();
        const { service, connect } = createP2PService();

        await expect(
            openP2PHost(host.core as never, service as never, { ...passiveHostSettings, P2P_Enabled: false })
        ).rejects.toThrow("P2P is disabled");

        expect(connect).not.toHaveBeenCalled();
    });

    it("does not connect when restoring the host policy fails", async () => {
        const host = createHostCore();
        const { service, connect } = createP2PService();
        host.applyPartial.mockRejectedValue(new Error("settings failed"));

        await expect(openP2PHost(host.core as never, service as never, passiveHostSettings)).rejects.toThrow(
            "settings failed"
        );

        expect(connect).not.toHaveBeenCalled();
    });

    it("accepts non-negative timeout", () => {
        expect(parseTimeoutSeconds("0", "p2p-peers")).toBe(0);
        expect(parseTimeoutSeconds("2.5", "p2p-sync")).toBe(2.5);
    });

    it("rejects invalid timeout values", () => {
        expect(() => parseTimeoutSeconds("-1", "p2p-peers")).toThrow(
            "p2p-peers requires a non-negative timeout in seconds"
        );
        expect(() => parseTimeoutSeconds("abc", "p2p-sync")).toThrow(
            "p2p-sync requires a non-negative timeout in seconds"
        );
    });

    it("collects peers through service views without acquiring a concrete replicator", async () => {
        const { service, connect, disconnect } = createP2PService();

        await expect(collectPeers(createCore(), service as never, 0)).resolves.toEqual([
            { peerId: "peer-a", name: "Peer A" },
        ]);
        expect(connect).toHaveBeenCalledOnce();
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it("synchronises through the targeted-transfer view", async () => {
        const { service, pullFromPeer, requestPushToPeer } = createP2PService();

        await expect(syncWithPeer(createCore(), service as never, "peer-a", 0)).resolves.toEqual({
            peerId: "peer-a",
            name: "Peer A",
        });
        expect(pullFromPeer).toHaveBeenCalledWith("peer-a", { showNotice: false });
        expect(requestPushToPeer).toHaveBeenCalledWith("peer-a");
    });

    it("rejects a cancelled pull without requesting a peer push", async () => {
        const { service, disconnect, pullFromPeer, requestPushToPeer } = createP2PService();
        pullFromPeer.mockResolvedValue({ status: "cancelled" } as never);

        await expect(syncWithPeer(createCore(), service as never, "peer-a", 0)).rejects.toBeDefined();

        expect(requestPushToPeer).not.toHaveBeenCalled();
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it("preserves the benchmark diagnostics JSONL contract", () => {
        expect(
            createPeerConnectionStatsPayload(
                { peerId: "peer-a", name: "Peer A" },
                {
                    selectedPairPresent: true,
                    selectedPairId: "pair-1",
                    state: "succeeded",
                    currentRoundTripTime: 0.01,
                    totalRoundTripTime: 0.1,
                    requestsSent: 3,
                    responsesReceived: 3,
                    packetsDiscardedOnSend: 0,
                    bytesSent: 100,
                    bytesReceived: 200,
                    localCandidate: {
                        id: "local-1",
                        candidateType: "host",
                        protocol: "udp",
                        relayProtocol: "unknown",
                    },
                    remoteCandidate: {
                        id: "remote-1",
                        candidateType: "relay",
                        protocol: "udp",
                        relayProtocol: "udp",
                    },
                },
                "2026-08-27T00:00:00.000Z"
            )
        ).toEqual({
            generatedAt: "2026-08-27T00:00:00.000Z",
            command: "p2p-sync",
            peerId: "peer-a",
            peerName: "Peer A",
            candidatePathCollected: true,
            selectedPath: "host<->relay",
            selectedPair: {
                id: "pair-1",
                state: "succeeded",
                currentRoundTripTime: 0.01,
                totalRoundTripTime: 0.1,
                requestsSent: 3,
                responsesReceived: 3,
                packetsDiscardedOnSend: 0,
                bytesSent: 100,
                bytesReceived: 200,
            },
            localCandidate: {
                id: "local-1",
                candidateType: "host",
                protocol: "udp",
                relayProtocol: "unknown",
            },
            remoteCandidate: {
                id: "remote-1",
                candidateType: "relay",
                protocol: "udp",
                relayProtocol: "udp",
            },
        });
    });
});
