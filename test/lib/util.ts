import { delay } from "@/lib/src/common/utils";

export async function waitTaskWithFollowups<T>(
    task: Promise<T>,
    followup: () => Promise<void>,
    timeout: number = 10000,
    interval: number = 1000
): Promise<T> {
    const symbolNotCompleted = Symbol("notCompleted");
    const isCompleted = () => Promise.race([task, Promise.resolve(symbolNotCompleted)]);
    const ttl = Date.now() + timeout;
    do {
        const state = await isCompleted();
        if (state !== symbolNotCompleted) {
            return state;
        }
        await followup();
        await delay(interval);
    } while (Date.now() < ttl);
    throw new Error("Task did not complete in time");
}
