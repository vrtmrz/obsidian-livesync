type HeapPerformance = {
    readonly memory?: { readonly usedJSHeapSize: number };
};

function readHeap(clock: HeapPerformance): number | undefined {
    try {
        const bytes = clock.memory?.usedJSHeapSize;
        return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
    } catch {
        return undefined;
    }
}

export function createReviewHarnessHeapSampler(clock: HeapPerformance): {
    sample(): void;
    finish(): string;
} {
    const before = readHeap(clock);
    let highest = before;
    let after = before;
    const sample = () => {
        after = readHeap(clock);
        if (after !== undefined) highest = Math.max(highest ?? after, after);
    };
    const finish = () => {
        sample();
        if (highest === undefined) return "JavaScript heap: unavailable on this device.";
        const mib = (bytes: number | undefined) =>
            bytes === undefined ? "unavailable" : `${(bytes / 1048576).toFixed(2)} MiB`;
        return `JavaScript heap: before=${mib(before)}; highest sampled=${mib(highest)}; after=${mib(after)}.`;
    };

    return { sample, finish };
}
