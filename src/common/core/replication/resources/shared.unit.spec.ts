import { describe, expect, it, vi } from "vitest";
import { createReplicatorDisposer } from "./shared";

describe("Replicator disposal", () => {
    it("defers closing, preserves the receiver, and retains one completion promise", async () => {
        let finish!: () => void;
        const closed = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const replicator = {
            closeReplication: vi.fn(function (this: unknown) {
                expect(this).toBe(replicator);
                return closed;
            }),
        };
        const dispose = createReplicatorDisposer(replicator);
        const pending = dispose();
        expect(replicator.closeReplication).not.toHaveBeenCalled();
        expect(dispose()).toBe(pending);
        await Promise.resolve();
        expect(replicator.closeReplication).toHaveBeenCalledOnce();
        finish();
        await pending;
        expect(dispose()).toBe(pending);
        expect(replicator.closeReplication).toHaveBeenCalledOnce();
    });

    it("retains synchronous closing failures as one rejected promise", async () => {
        const error = new Error("close");
        const replicator = {
            closeReplication: vi.fn(() => {
                throw error;
            }),
        };
        const dispose = createReplicatorDisposer(replicator);
        const pending = dispose();
        await expect(pending).rejects.toBe(error);
        expect(dispose()).toBe(pending);
        await expect(dispose()).rejects.toBe(error);
        expect(replicator.closeReplication).toHaveBeenCalledOnce();
    });
});
