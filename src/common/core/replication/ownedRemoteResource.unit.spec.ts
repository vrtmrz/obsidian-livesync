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

describe("owned remote resource completion", () => {
    it("waits for cleanup and preserves its receiver", async () => {
        let finish!: () => void;
        let started!: () => void;
        const disposing = new Promise<void>((resolve) => {
            started = resolve;
        });
        const cleanup = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const resource = {
            dispose: vi.fn(function (this: unknown) {
                expect(this).toBe(resource);
                started();
                return cleanup;
            }),
        };
        let settled = false;
        const result = withOwnedRemoteResource(resource, async () => "done");
        void result.then(() => {
            settled = true;
        });
        await disposing;
        expect(settled).toBe(false);
        finish();
        await expect(result).resolves.toBe("done");
        expect(resource.dispose).toHaveBeenCalledOnce();
    });

    it("keeps finally precedence when both the operation and cleanup fail", async () => {
        const operationError = new Error("operation");
        const disposalError = new Error("cleanup");
        const dispose = vi.fn(async () => {
            throw disposalError;
        });
        await expect(
            withOwnedRemoteResource({ dispose }, async () => {
                throw operationError;
            })
        ).rejects.toBe(disposalError);
        expect(dispose).toHaveBeenCalledOnce();
    });
});
