import { describe, expect, it, vi } from "vitest";
import { withOwnedRemoteResource } from "./ownedRemoteResource";

describe("flow-owned remote resources", () => {
    it("disposes a resource after a successful finite operation", async () => {
        const dispose = vi.fn(async () => undefined);
        const resource = { dispose };

        await expect(
            withOwnedRemoteResource(resource, async (owned) => (owned === resource ? "done" : "wrong"))
        ).resolves.toBe("done");

        expect(dispose).toHaveBeenCalledOnce();
    });

    it("disposes a resource when the finite operation rejects", async () => {
        const dispose = vi.fn(async () => undefined);
        const error = new Error("resource operation failed");

        await expect(
            withOwnedRemoteResource({ dispose }, async () => {
                throw error;
            })
        ).rejects.toBe(error);

        expect(dispose).toHaveBeenCalledOnce();
    });
});
