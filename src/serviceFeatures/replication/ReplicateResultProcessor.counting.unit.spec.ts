import { reactiveSource } from "octagonal-wheels/dataobject/reactive";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import { describe, expect, it } from "vitest";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";

describe("ReplicateResultProcessor.withCounting", () => {
    it("counts overlapping callbacks until each settles and preserves results and errors", async () => {
        const originalCount = 7;
        const count = reactiveSource(originalCount);
        const processor = new ReplicateResultProcessor({} as never);
        const firstResult = { task: "first" };
        const firstResultGate = promiseWithResolvers<typeof firstResult>();
        const secondResultGate = promiseWithResolvers<string>();
        const firstStarted = promiseWithResolvers<undefined>();
        const secondStarted = promiseWithResolvers<undefined>();
        const failure = new Error("second callback failed");
        let firstCountAtStart = 0;
        let secondCountAtStart = 0;

        const first = processor.withCounting(async () => {
            firstCountAtStart = count.value;
            firstStarted.resolve(undefined);
            return firstResultGate.promise;
        }, count);
        await firstStarted.promise;
        expect(firstCountAtStart).toBe(originalCount + 1);
        expect(count.value).toBe(originalCount + 1);

        const second = processor.withCounting(async () => {
            secondCountAtStart = count.value;
            secondStarted.resolve(undefined);
            return secondResultGate.promise;
        }, count);
        await secondStarted.promise;
        expect(secondCountAtStart).toBe(originalCount + 2);
        expect(count.value).toBe(originalCount + 2);

        firstResultGate.resolve(firstResult);
        await expect(first).resolves.toBe(firstResult);
        expect(count.value).toBe(originalCount + 1);

        secondResultGate.reject(failure);
        await expect(second).rejects.toBe(failure);
        expect(count.value).toBe(originalCount);
    });
});
