import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { useP2PSettingsPreparation } from "./useP2PSettingsPreparation";

const managed = {
    ...DEFAULT_SETTINGS,
    P2P_managedType: "CF",
    P2P_managedId: "key-123",
    P2P_managedToken: "test-token",
};

describe("host preparation of P2P settings", () => {
    it("puts issued ICE credentials on a connection copy without changing saved inputs", async () => {
        const iceServers = [
            { urls: ["turn:relay.example.test:3478"], username: "issued-user", credential: "issued-password" },
        ];
        const fetch = vi.fn(async () => new Response(JSON.stringify({ iceServers }), { status: 201 }));
        const before = structuredClone(managed);
        const settings = await useP2PSettingsPreparation(fetch)(managed, new AbortController().signal);
        expect(settings.P2P_iceServers).toEqual(iceServers);
        expect(settings.P2P_iceServersExpiresAt).toBeGreaterThan(Date.now());
        expect(managed).toEqual(before);
        expect(settings).not.toBe(managed);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it("keeps manual settings and rejects an unsupported provider without HTTP requests", async () => {
        const fetch = vi.fn();
        const prepare = useP2PSettingsPreparation(fetch);
        await expect(prepare(DEFAULT_SETTINGS, new AbortController().signal)).resolves.toEqual(DEFAULT_SETTINGS);
        await expect(prepare({ ...managed, P2P_managedType: "unknown" }, new AbortController().signal)).rejects.toThrow(
            "not supported"
        );
        await expect(
            prepare({ ...managed, P2P_managedToken: "invalid token" }, new AbortController().signal)
        ).rejects.toThrow("Bearer token syntax");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("propagates a safe acquisition failure without using the manual TURN fields", async () => {
        const fetch = vi.fn(async () => new Response(null, { status: 401 }));
        const prepare = useP2PSettingsPreparation(fetch);
        await expect(
            prepare({ ...managed, P2P_turnServers: "turn:manual.example.test" }, new AbortController().signal)
        ).rejects.toThrow("not authorised");
        expect(fetch).toHaveBeenCalledOnce();
    });
});
