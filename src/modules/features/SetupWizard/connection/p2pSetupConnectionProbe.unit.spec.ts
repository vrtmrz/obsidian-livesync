import { describe, expect, it, vi } from "vitest";
import { ACTIVE_P2P_RELAY_BINDING_CONFLICT, type P2PConnectionProbeAdmission } from "@vrtmrz/livesync-commonlib/p2p";
import { DEFAULT_SETTINGS, P2PConnectionPaths } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    coordinateP2PSetupConnectionProbe,
    probeP2PSetupConnection,
    type P2PSetupConnectionProbeResult,
} from "./p2pSetupConnectionProbe";

describe("P2P setup connection probe", () => {
    it("constructs a signalling-only trial when the draft selects managed TURN", async () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            P2P_managedType: "CF",
            P2P_managedId: "test-key",
            P2P_managedToken: "test-token",
            P2P_iceServers: [
                { urls: "turn:temporary.example.test", username: "issued-user", credential: "issued-password" },
            ],
            P2P_iceServersExpiresAt: 123456789,
            P2P_turnServers: "turn:unused.example.test:3478",
            P2P_turnUsername: "unused-user",
            P2P_turnCredential: "unused-password",
            P2P_connectionPath: P2PConnectionPaths.Relay,
        };
        const admission: P2PConnectionProbeAdmission = {
            run: async (_settings, trial) => ({ status: "trial", result: await trial() }),
        };
        const result = await coordinateP2PSetupConnectionProbe(admission, settings, async (trial = settings) => {
            expect(trial.P2P_managedType).toBeUndefined();
            expect(trial.P2P_managedToken).toBeUndefined();
            expect(trial.P2P_iceServers).toBeUndefined();
            expect(trial.P2P_iceServersExpiresAt).toBeUndefined();
            expect(trial.P2P_turnServers).toBe("");
            expect(trial.P2P_turnUsername).toBe("");
            expect(trial.P2P_turnCredential).toBe("");
            expect(trial.P2P_connectionPath).toBe(P2PConnectionPaths.Automatic);
            return { ok: true };
        });
        expect(result).toEqual({ ok: true });
        expect(settings.P2P_managedToken).toBe("test-token");
        expect(settings.P2P_connectionPath).toBe(P2PConnectionPaths.Relay);
    });

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
