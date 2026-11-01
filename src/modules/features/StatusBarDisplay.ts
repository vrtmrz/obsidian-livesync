import { reactiveSource, type ReactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import { createDeferredAction, type TimeoutScheduler } from "octagonal-wheels/concurrency/deferredAction";

import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

const scheduleStatusTimeout: TimeoutScheduler = (callback, delayMs) => {
    const handle = compatGlobal.setTimeout(callback, delayMs);
    return () => compatGlobal.clearTimeout(handle);
};

const STATUS_COUNTER_PADDING = "\u2007".repeat(10);

export const STATUS_COUNTER_INACTIVE_LINGER_MS = 3_000;

export type DisposableReactiveValue<T> = ReactiveValue<T> & {
    dispose(): void;
};

export type PaddedCounterLabel = DisposableReactiveValue<string> & {
    readonly count: ReactiveValue<number | undefined>;
};

export type ChunkFetchCounterLabel = DisposableReactiveValue<string> & {
    readonly initialCount: ReactiveValue<number | undefined>;
    readonly retryingCount: ReactiveValue<number | undefined>;
};

function asDisposableReactiveValue<T>(value: ReactiveSource<T>, dispose: () => void): DisposableReactiveValue<T> {
    return {
        get value() {
            return value.value;
        },
        onChanged(handler) {
            value.onChanged(handler);
        },
        offChanged(handler) {
            value.offChanged(handler);
        },
        dispose,
    };
}

/**
 * Mirrors an activity count while keeping each visible period on screen for a
 * minimum total lifetime. The delay applies only when the source becomes zero.
 *
 * @param source - The activity count to observe.
 * @param minimumVisibleMs - The minimum visible lifetime, clamped to zero.
 * @param scheduleTimeout - The scheduler for this display. Defaults to the
 * existing compatible host, preserving its timer method receivers.
 */
export function createMinimumVisibleActivityCount(
    source: ReactiveValue<number>,
    minimumVisibleMs: number,
    scheduleTimeout: TimeoutScheduler = scheduleStatusTimeout
): DisposableReactiveValue<number> {
    const minimumLifetime = Math.max(0, minimumVisibleMs);
    const displayed = reactiveSource(Math.max(0, source.value));
    let visibleSince = displayed.value > 0 ? Date.now() : undefined;
    let disposed = false;

    const hideIfIdle = () => {
        if (disposed || Math.max(0, source.value) > 0) return;
        displayed.value = 0;
        visibleSince = undefined;
    };
    const hideTimeout = createDeferredAction(hideIfIdle, scheduleTimeout);
    const update = () => {
        if (disposed) return;
        const nextCount = Math.max(0, source.value);
        hideTimeout.cancel();
        if (nextCount > 0) {
            if (displayed.value === 0) {
                visibleSince = Date.now();
            }
            displayed.value = nextCount;
            return;
        }
        if (displayed.value === 0) {
            visibleSince = undefined;
            return;
        }

        const elapsed = Date.now() - (visibleSince ?? Date.now());
        const remaining = Math.max(0, minimumLifetime - elapsed);
        if (remaining === 0) {
            hideIfIdle();
        } else {
            hideTimeout.schedule(remaining);
        }
    };

    source.onChanged(update);
    return asDisposableReactiveValue(displayed, () => {
        if (disposed) return;
        disposed = true;
        hideTimeout.dispose();
        source.offChanged(update);
    });
}

/**
 * Formats a counter with a stable width and briefly retains its zero value so
 * that the completion of queued work remains visible.
 *
 * @param source - The counter to observe.
 * @param mark - The label prefix before the padded count.
 * @param inactiveLingerMs - The delay before clearing a zero count, clamped to zero.
 * @param scheduleTimeout - The scheduler for this display. Defaults to the
 * existing compatible host, preserving its timer method receivers.
 */
export function createPaddedCounterLabel(
    source: ReactiveValue<number>,
    mark: string,
    inactiveLingerMs = STATUS_COUNTER_INACTIVE_LINGER_MS,
    scheduleTimeout: TimeoutScheduler = scheduleStatusTimeout
): PaddedCounterLabel {
    const linger = Math.max(0, inactiveLingerMs);
    const formatted = reactiveSource("");
    const displayedCount = reactiveSource<number | undefined>(undefined);
    let maximumLength = 1;
    let disposed = false;

    const clearLabelTimeout = createDeferredAction(() => {
        if (disposed) return;
        formatted.value = "";
        displayedCount.value = undefined;
        maximumLength = 1;
    }, scheduleTimeout);
    const format = (count: number) => {
        const requiredLength = `${Math.abs(count)}`.length + 1;
        maximumLength = Math.max(maximumLength, requiredLength);
        return ` ${mark}${`${STATUS_COUNTER_PADDING}${count}`.slice(-maximumLength)}`;
    };
    const update = () => {
        if (disposed) return;
        clearLabelTimeout.cancel();
        const count = source.value;
        formatted.value = format(count);
        displayedCount.value = count;
        if (count !== 0) return;
        clearLabelTimeout.schedule(linger);
    };

    source.onChanged(update);
    const display = asDisposableReactiveValue(formatted, () => {
        if (disposed) return;
        disposed = true;
        clearLabelTimeout.dispose();
        source.offChanged(update);
    });
    return {
        get value() {
            return display.value;
        },
        onChanged(handler) {
            display.onChanged(handler);
        },
        offChanged(handler) {
            display.offChanged(handler);
        },
        count: displayedCount,
        dispose() {
            display.dispose();
        },
    };
}

/**
 * Displays the disjoint initial and retry chunk-fetch counts with the same
 * padding and inactive linger behaviour as the other status counters.
 *
 * @param source - The initial and retrying chunk-fetch counts.
 * @param scheduleTimeout - The scheduler passed to each independent child display.
 */
export function createChunkFetchCounterLabel(
    source: ReactiveValue<{ initial: number; retrying: number }>,
    scheduleTimeout: TimeoutScheduler = scheduleStatusTimeout
): ChunkFetchCounterLabel {
    const initialCount = reactiveSource(0);
    const retryingCount = reactiveSource(0);
    const initialLabel = createPaddedCounterLabel(
        initialCount,
        "🛄",
        STATUS_COUNTER_INACTIVE_LINGER_MS,
        scheduleTimeout
    );
    const retryingLabel = createPaddedCounterLabel(
        retryingCount,
        "🔁",
        STATUS_COUNTER_INACTIVE_LINGER_MS,
        scheduleTimeout
    );
    const formatted = reactiveSource(`${initialLabel.value}${retryingLabel.value}`);
    let updatingCounts = false;
    let disposed = false;

    const updateLabel = () => {
        if (updatingCounts || disposed) return;
        formatted.value = `${initialLabel.value}${retryingLabel.value}`;
    };
    initialLabel.onChanged(updateLabel);
    retryingLabel.onChanged(updateLabel);

    const updateCounts = () => {
        if (disposed) return;
        updatingCounts = true;
        try {
            initialCount.value = source.value.initial;
            retryingCount.value = source.value.retrying;
        } finally {
            updatingCounts = false;
            updateLabel();
        }
    };
    source.onChanged(updateCounts);
    updateCounts();

    const display = asDisposableReactiveValue(formatted, () => {
        if (disposed) return;
        disposed = true;
        source.offChanged(updateCounts);
        initialLabel.offChanged(updateLabel);
        retryingLabel.offChanged(updateLabel);
        initialLabel.dispose();
        retryingLabel.dispose();
    });
    return {
        get value() {
            return display.value;
        },
        onChanged(handler) {
            display.onChanged(handler);
        },
        offChanged(handler) {
            display.offChanged(handler);
        },
        initialCount: initialLabel.count,
        retryingCount: retryingLabel.count,
        dispose() {
            display.dispose();
        },
    };
}
