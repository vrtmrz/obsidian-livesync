import { describe, expect, it, vi } from "vitest";
import { performBatchWithProgress } from "./performBatchWithProgress.ts";

describe("performBatchWithProgress", () => {
    it("counts resolved false values, continues after item errors, and does not flush partial progress", async () => {
        const error = new Error("Item failed");
        const processItem = vi.fn(async (item: number) => {
            if (item === 2) throw error;
            return false;
        });
        const onProgress = vi.fn();
        const onItemError = vi.fn();
        const onDone = vi.fn();

        const result = await performBatchWithProgress([1, 2, 3, 4, 5, 6, 7], 2, {
            processItem,
            onProgress,
            onItemError,
            onDone,
        });

        expect(result).toBeUndefined();
        expect(processItem).toHaveBeenCalledTimes(7);
        expect(onItemError).toHaveBeenCalledWith(error, 2);
        expect(onProgress.mock.calls).toEqual([[1], [3], [5]]);
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("starts every item eagerly and calls onDone only after all item promises resolve", async () => {
        const items = [1, 2, 3];
        const resolvers: Array<() => void> = [];
        const processItem = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolvers.push(resolve);
                })
        );
        const onProgress = vi.fn();
        const onItemError = vi.fn();
        const onDone = vi.fn();

        const operation = performBatchWithProgress(items, 100, { processItem, onProgress, onItemError, onDone });

        expect(processItem).toHaveBeenCalledTimes(items.length);
        expect(onDone).not.toHaveBeenCalled();
        for (const resolve of resolvers) resolve();
        await operation;

        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("routes a progress callback error through the item error handler", async () => {
        const error = new Error("Progress callback failed");
        const onProgress = vi.fn(() => {
            throw error;
        });
        const onItemError = vi.fn();
        const onDone = vi.fn();

        await performBatchWithProgress(["item"], 100, {
            processItem: async () => false,
            onProgress,
            onItemError,
            onDone,
        });

        expect(onItemError).toHaveBeenCalledWith(error, "item");
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("rejects when the item error handler throws and skips onDone", async () => {
        const itemError = new Error("Item failed");
        const handlerError = new Error("Error handler failed");
        const onItemError = vi.fn(() => {
            throw handlerError;
        });
        const onDone = vi.fn();

        await expect(
            performBatchWithProgress(["item"], 100, {
                processItem: async () => {
                    throw itemError;
                },
                onProgress: vi.fn(),
                onItemError,
                onDone,
            })
        ).rejects.toBe(handlerError);

        expect(onItemError).toHaveBeenCalledWith(itemError, "item");
        expect(onDone).not.toHaveBeenCalled();
    });
});
