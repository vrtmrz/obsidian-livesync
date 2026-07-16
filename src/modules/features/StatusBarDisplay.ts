import { reactiveSource, type ReactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";

import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";

const STATUS_COUNTER_PADDING = "\u2007".repeat(10);

export const STATUS_COUNTER_INACTIVE_LINGER_MS = 3_000;

export type DisposableReactiveValue<T> = ReactiveValue<T> & {
    dispose(): void;
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
 */
export function createMinimumVisibleActivityCount(
    source: ReactiveValue<number>,
    minimumVisibleMs: number
): DisposableReactiveValue<number> {
    const minimumLifetime = Math.max(0, minimumVisibleMs);
    const displayed = reactiveSource(Math.max(0, source.value));
    let visibleSince = displayed.value > 0 ? Date.now() : undefined;
    let hideTimer: number | undefined;
    let disposed = false;

    const cancelHide = () => {
        if (hideTimer === undefined) return;
        compatGlobal.clearTimeout(hideTimer);
        hideTimer = undefined;
    };
    const hideIfIdle = () => {
        hideTimer = undefined;
        if (disposed || Math.max(0, source.value) > 0) return;
        displayed.value = 0;
        visibleSince = undefined;
    };
    const update = () => {
        if (disposed) return;
        const nextCount = Math.max(0, source.value);
        cancelHide();
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
            hideTimer = compatGlobal.setTimeout(hideIfIdle, remaining);
        }
    };

    source.onChanged(update);
    return asDisposableReactiveValue(displayed, () => {
        if (disposed) return;
        disposed = true;
        cancelHide();
        source.offChanged(update);
    });
}

/**
 * Formats a counter with a stable width and briefly retains its zero value so
 * that the completion of queued work remains visible.
 */
export function createPaddedCounterLabel(
    source: ReactiveValue<number>,
    mark: string,
    inactiveLingerMs = STATUS_COUNTER_INACTIVE_LINGER_MS
): DisposableReactiveValue<string> {
    const linger = Math.max(0, inactiveLingerMs);
    const formatted = reactiveSource("");
    let maximumLength = 1;
    let clearTimer: number | undefined;
    let disposed = false;

    const cancelClear = () => {
        if (clearTimer === undefined) return;
        compatGlobal.clearTimeout(clearTimer);
        clearTimer = undefined;
    };
    const format = (count: number) => {
        const requiredLength = `${Math.abs(count)}`.length + 1;
        maximumLength = Math.max(maximumLength, requiredLength);
        return ` ${mark}${`${STATUS_COUNTER_PADDING}${count}`.slice(-maximumLength)}`;
    };
    const update = () => {
        if (disposed) return;
        cancelClear();
        const count = source.value;
        formatted.value = format(count);
        if (count !== 0) return;
        clearTimer = compatGlobal.setTimeout(() => {
            clearTimer = undefined;
            if (disposed) return;
            formatted.value = "";
            maximumLength = 1;
        }, linger);
    };

    source.onChanged(update);
    return asDisposableReactiveValue(formatted, () => {
        if (disposed) return;
        disposed = true;
        cancelClear();
        source.offChanged(update);
    });
}
