import { describe, expect, it, vi } from "vitest";
import type { PathIdentityInspection, RemoteConnectionProbe } from "@vrtmrz/livesync-commonlib/replication";
import { resolveInitialPathIdentity } from "./initialPathIdentity";

function makeProbe(result: PathIdentityInspection) {
    return {
        check: vi.fn(),
        getStatus: vi.fn(),
        inspectPathIdentity: vi.fn(async () => result),
        dispose: vi.fn(async () => undefined),
    } satisfies RemoteConnectionProbe;
}

describe("resolveInitialPathIdentity", () => {
    it.each([0, 1] as const)("adopts existing version %s instead of the new-environment default", async (version) => {
        const probe = makeProbe({ status: "configured", pathNormalizationVersion: version });
        await expect(resolveInitialPathIdentity(probe, 1 - version)).resolves.toBe(version);
        expect(probe.dispose).toHaveBeenCalledOnce();
    });
    it.each([0, 1] as const)("retains version %s only for a confirmed empty remote", async (version) => {
        const probe = makeProbe({ status: "empty" });
        await expect(resolveInitialPathIdentity(probe, version)).resolves.toBe(version);
        expect(probe.dispose).toHaveBeenCalledOnce();
    });
    it("preserves inspection failures and disposes the probe", async () => {
        const probe = makeProbe({ status: "empty" });
        const error = new Error("remote unavailable");
        probe.inspectPathIdentity.mockRejectedValue(error);
        await expect(resolveInitialPathIdentity(probe, 1)).rejects.toBe(error);
        expect(probe.dispose).toHaveBeenCalledOnce();
    });
    it("refuses an unavailable inspection capability without guessing", async () => {
        const probe = makeProbe({ status: "empty" });
        const { inspectPathIdentity: _inspect, ...unsupported } = probe;
        await expect(resolveInitialPathIdentity(unsupported, 1)).rejects.toThrow("cannot be inspected");
        expect(probe.dispose).toHaveBeenCalledOnce();
        await expect(resolveInitialPathIdentity(undefined, 1)).rejects.toThrow("cannot be inspected");
    });
});
