import { reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import { P2PLogCollector } from "@lib/replication/trystero/P2PLogCollector.ts";
import { Notice } from "@/deps.ts";
import type { LogEntry } from "@lib/mock_and_interop/stores.ts";

/**
 * Interface representing the internal state of the logging and status display feature.
 */
export interface LogFeatureState {
    statusBar?: HTMLElement;
    statusDiv?: HTMLElement;
    statusLine?: HTMLDivElement;
    logMessage?: HTMLDivElement;
    logHistory?: HTMLDivElement;
    messageArea?: HTMLDivElement;

    statusBarLabels?: ReactiveValue<{ message: string; status: string }>;
    statusLog: ReturnType<typeof reactiveSource<string>>;
    activeFileStatus: ReturnType<typeof reactiveSource<string>>;
    notifies: { [key: string]: { notice: Notice; count: number } };
    p2pLogCollector: P2PLogCollector;

    nextFrameQueue?: number;
    logLines: { ttl: number; message: string }[];
    recentLogEntries: ReturnType<typeof reactiveSource<LogEntry[]>>;
    logForDump: string[];
    logForDisplay: string[];
}

/**
 * Creates the initial state object.
 */
export function createInitialState(): LogFeatureState {
    return {
        statusLog: reactiveSource(""),
        activeFileStatus: reactiveSource(""),
        notifies: {},
        p2pLogCollector: new P2PLogCollector(),
        logLines: [],
        recentLogEntries: reactiveSource<LogEntry[]>([]),
        logForDump: [],
        logForDisplay: [],
    };
}
