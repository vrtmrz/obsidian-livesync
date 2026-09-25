export type Issue1189Variant = "normal" | "serial";
export type Issue1189Phase = "boot" | "fetch" | "reflect" | "finalise" | "complete" | "paused";

type DiagnosticEvent = { at: number; phase: Issue1189Phase; note?: string };
type DiagnosticRun = {
    id: string;
    variant: Issue1189Variant;
    startedAt: number;
    updatedAt: number;
    phase: Issue1189Phase;
    status: "active" | "complete" | "paused";
    restartRequested: boolean;
    activeFiles: number;
    peakActiveFiles: number;
    activeBytes: number;
    peakActiveBytes: number;
    processedFiles: number;
    largestFile: number;
    peakTimerDelayMs: number;
    events: DiagnosticEvent[];
};

type DiagnosticRecord = {
    schema: 1;
    current: DiagnosticRun;
    previous?: DiagnosticRun;
    resumeAllowed: boolean;
};

export interface Issue1189DiagnosticStorage {
    getDeviceLocalConfig(key: string): string | null;
    setDeviceLocalConfig(key: string, value: string): void;
}

const INTERVAL_MS = 1000;
const HISTORY_LIMIT = 24;

function parseRecord(raw: string | null): DiagnosticRecord | undefined {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw) as DiagnosticRecord;
        if (parsed?.schema === 1 && parsed.current?.events instanceof Array) return parsed;
    } catch {
        // A damaged optional diagnostic record must never prevent plug-in startup.
    }
    return undefined;
}

export function createIssue1189Diagnostics(
    storage: Issue1189DiagnosticStorage,
    vaultName: string,
    variant: Issue1189Variant,
    now: () => number = Date.now
) {
    const key = `issue-1189-diagnostics-${vaultName}`;
    let raw: string | null = null;
    try {
        raw = storage.getDeviceLocalConfig(key);
    } catch {
        // Diagnosis is optional when the browser's local store is unavailable.
    }
    const saved = parseRecord(raw);
    const previous =
        (saved?.current.phase === "boot" || saved?.current.phase === "paused") && saved.previous
            ? saved.previous
            : saved?.current;
    const resumeAllowed = saved?.resumeAllowed === true;
    const startedAt = now();
    const current: DiagnosticRun = {
        id: `${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
        variant,
        startedAt,
        updatedAt: startedAt,
        phase: "boot",
        status: "active",
        restartRequested: false,
        activeFiles: 0,
        peakActiveFiles: 0,
        activeBytes: 0,
        peakActiveBytes: 0,
        processedFiles: 0,
        largestFile: 0,
        peakTimerDelayMs: 0,
        events: [{ at: startedAt, phase: "boot" }],
    };
    const record: DiagnosticRecord = { schema: 1, current, previous, resumeAllowed: false };
    let lastPersistedAt = 0;
    let lastStorageError = "";
    const persist = () => {
        current.updatedAt = now();
        try {
            storage.setDeviceLocalConfig(key, JSON.stringify(record));
            lastPersistedAt = current.updatedAt;
            lastStorageError = "";
        } catch (error) {
            lastStorageError = error instanceof Error ? error.name : String(error);
        }
    };
    const event = (phase: Issue1189Phase, note?: string) => {
        current.phase = phase;
        current.events.push({ at: now(), phase, note });
        if (current.events.length > HISTORY_LIMIT) current.events.shift();
        persist();
    };
    persist();

    return {
        variant,
        shouldPauseFetch: () =>
            !resumeAllowed &&
            previous?.status === "active" &&
            !previous.restartRequested &&
            (previous.phase === "fetch" || previous.phase === "reflect" || previous.phase === "finalise"),
        pause() {
            current.status = "paused";
            event("paused", "An earlier Fast Setup attempt did not finish.");
        },
        allowResume() {
            record.resumeAllowed = true;
            persist();
        },
        markPhase: event,
        markRestartRequested() {
            current.restartRequested = true;
            persist();
        },
        markComplete() {
            current.status = "complete";
            event("complete");
        },
        onFileActivity({ phase, size }: { phase: "start" | "finish"; size: number }) {
            const firstFile = current.activeFiles === 0 && current.processedFiles === 0;
            const previousPeakFiles = current.peakActiveFiles;
            const previousLargestFile = current.largestFile;
            if (phase === "start") {
                current.activeFiles++;
                current.activeBytes += size;
                current.peakActiveFiles = Math.max(current.peakActiveFiles, current.activeFiles);
                current.peakActiveBytes = Math.max(current.peakActiveBytes, current.activeBytes);
                current.largestFile = Math.max(current.largestFile, size);
            } else {
                current.activeFiles = Math.max(0, current.activeFiles - 1);
                current.activeBytes = Math.max(0, current.activeBytes - size);
                current.processedFiles++;
            }
            if (
                (phase === "start" &&
                    (firstFile || current.peakActiveFiles > previousPeakFiles || (size >= 4_000_000 && size > previousLargestFile))) ||
                now() - lastPersistedAt >= INTERVAL_MS
            ) {
                persist();
            }
        },
        startTimer(setTimer: (callback: () => void, delay: number) => number, clearTimer: (id: number) => void) {
            let expected = now() + INTERVAL_MS;
            let stopped = false;
            let timerId = 0;
            const tick = () => {
                if (stopped) return;
                const actual = now();
                current.peakTimerDelayMs = Math.max(current.peakTimerDelayMs, Math.max(0, actual - expected));
                if (actual - lastPersistedAt >= INTERVAL_MS) persist();
                expected = actual + INTERVAL_MS;
                timerId = setTimer(tick, INTERVAL_MS);
            };
            timerId = setTimer(tick, INTERVAL_MS);
            return () => {
                stopped = true;
                clearTimer(timerId);
            };
        },
        report() {
            return JSON.stringify({ ...record, storageError: lastStorageError || undefined }, null, 2);
        },
    };
}

export type Issue1189Diagnostics = ReturnType<typeof createIssue1189Diagnostics>;
