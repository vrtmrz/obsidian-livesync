import { describe, expect, it, vi } from "vitest";
import { probeP2PSetupConnection } from "./p2pSetupConnectionProbe";

describe("P2P setup connection probe", () => {
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
