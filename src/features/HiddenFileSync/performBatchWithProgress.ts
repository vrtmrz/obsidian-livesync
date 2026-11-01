import { createCoalescingNotifier } from "octagonal-wheels/concurrency/coalescingNotifier";

interface PerformBatchWithProgressCallbacks<T> {
    /** Runs one item. Its resolved value is ignored. */
    processItem: (item: T) => Promise<unknown>;
    /** Receives the number of successfully completed items. */
    onProgress: (completed: number) => void;
    /** Handles an item or progress callback error. */
    onItemError: (error: unknown, item: T) => void;
    /** Runs once after all per-item promises resolve. */
    onDone: () => void;
}

/**
 * Runs an eager batch and coalesces progress notifications by successful item count.
 * @internal
 *
 * @param items - Items to process concurrently.
 * @param eachCount - Number of completed items between progress notifications.
 * @param callbacks - Item processing, progress, error, and completion callbacks.
 * @returns A promise that resolves with no value after the batch and completion callback finish.
 * @throws When notifier configuration is invalid, an error handler throws, or the completion callback throws.
 * @remarks The first completed item triggers progress immediately. Work and the progress callback share
 * one error boundary; errors are passed to `onItemError`. A rejected item operation does not advance
 * the count. The batch has no concurrency limit or retry, and pending progress is not flushed when
 * processing ends.
 */
export async function performBatchWithProgress<T>(
    items: readonly T[],
    eachCount: number,
    callbacks: PerformBatchWithProgressCallbacks<T>
): Promise<void> {
    const notifier = createCoalescingNotifier<number>({
        everyCount: eachCount,
        leading: true,
        onNotify: callbacks.onProgress,
    });
    let completed = 0;
    const processes = items.map(async (item) => {
        try {
            await callbacks.processItem(item);
            notifier.update(++completed);
        } catch (error) {
            callbacks.onItemError(error, item);
        }
    });
    await Promise.all(processes);
    callbacks.onDone();
}
