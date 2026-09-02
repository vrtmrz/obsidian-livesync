import { describe, expect, it, vi } from "vitest";
import { ACTIVE_P2P_RELAY_BINDING_CONFLICT, type P2PConnectionProbeAdmission } from "@vrtmrz/livesync-commonlib/p2p";
import {
    coordinateP2PSetupConnectionProbe,
    probeP2PSetupConnection,
    type P2PSetupConnectionProbeResult,
} from "./p2pSetupConnectionProbe";

describe("P2P setup connection probe", () => {
    it("uses a compatible active signalling connection without constructing a trial", async () => {
        const runOwnedTrial = vi.fn(async (): Promise<P2PSetupConnectionProbeResult> => ({ ok: true }));
        const admission: P2PConnectionProbeAdmission = {
            run: vi.fn(async () => ({ status: "observed-active" }) as const),
        };

        await expect(
            coordinateP2PSetupConnectionProbe(admission, { P2P_relays: "wss://relay.example.com" }, runOwnedTrial)
        ).resolves.toEqual({ ok: true });

        expect(admission.run).toHaveBeenCalledOnce();
        expect(runOwnedTrial).not.toHaveBeenCalled();
    });

    it("preserves the typed blocked reason without opening an incompatible trial", async () => {
        const runOwnedTrial = vi.fn(async (): Promise<P2PSetupConnectionProbeResult> => ({ ok: true }));
        const admission: P2PConnectionProbeAdmission = {
            run: vi.fn(
                async () =>
                    ({
                        status: "blocked",
                        reason: ACTIVE_P2P_RELAY_BINDING_CONFLICT,
                    }) as const
            ),
        };

        await expect(
            coordinateP2PSetupConnectionProbe(
                admission,
                { P2P_relays: "wss://another-relay.example.com" },
                runOwnedTrial
            )
        ).resolves.toEqual({
            ok: false,
            kind: "blocked",
            reason: ACTIVE_P2P_RELAY_BINDING_CONFLICT,
        });

        expect(admission.run).toHaveBeenCalledOnce();
        expect(runOwnedTrial).not.toHaveBeenCalled();
    });

    it("runs and returns the complete owned trial continuation when no room is active", async () => {
        const trialResult = { ok: false, reason: "relay unavailable" } as const;
        const runOwnedTrial = vi.fn(async (): Promise<P2PSetupConnectionProbeResult> => trialResult);
        const admission: P2PConnectionProbeAdmission = {
            run: vi.fn(async (_settings, trial) => ({ status: "trial", result: await trial() }) as const),
        };

        await expect(
            coordinateP2PSetupConnectionProbe(admission, { P2P_relays: "wss://relay.example.com" }, runOwnedTrial)
        ).resolves.toEqual(trialResult);

        expect(admission.run).toHaveBeenCalledOnce();
        expect(runOwnedTrial).toHaveBeenCalledOnce();
    });

    it("accepts an empty room after the signalling connection opens", async () => {
        const replicator = {
            knownAdvertisements: [],
            setOnSetup: vi.fn(),
            allowReconnection: vi.fn(),
            open: vi.fn(async () => undefined),
        };

        await expect(probeP2PSetupConnection(replicator)).resolves.toEqual({ ok: true });
        expect(replicator.setOnSetup).toHaveBeenCalledOnce();
        expect(replicator.allowReconnection).toHaveBeenCalledOnce();
        expect(replicator.open).toHaveBeenCalledOnce();
    });

    it("reports a signalling connection failure", async () => {
        const replicator = {
            knownAdvertisements: [],
            setOnSetup: vi.fn(),
            allowReconnection: vi.fn(),
            open: vi.fn(async () => {
                throw new Error("relay unavailable");
            }),
        };

        await expect(probeP2PSetupConnection(replicator)).resolves.toEqual({
            ok: false,
            reason: "relay unavailable",
        });
    });
});
