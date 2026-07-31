import type { P2PServerInfo } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/TrysteroReplicatorP2PServer";

export const P2P_CHECK_OBSERVATION_MILLISECONDS = 60_000;

export type P2PCheckDiagnostics = P2PServerInfo["diag"];
export type P2PCheckOutcome = "idle" | "waiting" | "connecting" | "retrying" | "connected" | "inconclusive" | "error";
export type P2PAdditionalCheckOutcome = "waiting" | "negotiating" | "connected" | "inconclusive";

export interface P2PAdditionalCheckBaseline {
    readonly activeConnectionIds: readonly string[];
    readonly totalClosedConnections: number;
    readonly totalFailedConnections: number;
    readonly totalNewConnections: number;
    readonly totalSuccessfulConnections: number;
}

export interface P2PAdditionalCheckProgress {
    readonly activeConnections: number;
    readonly closedConnections: number;
    readonly failedConnections: number;
    readonly newConnections: number;
    readonly newActiveConnectionIds: readonly string[];
    readonly outcome: P2PAdditionalCheckOutcome;
    readonly successfulConnections: number;
}

export const EMPTY_P2P_CHECK_DIAGNOSTICS: P2PCheckDiagnostics = {
    totalNewConnections: 0,
    totalFailedConnections: 0,
    totalSuccessfulConnections: 0,
    totalClosedConnections: 0,
    details: {},
};

export function deriveP2PCheckOutcome(
    diagnostics: P2PCheckDiagnostics,
    monitorActive: boolean,
    elapsedMilliseconds: number,
    monitorError = false
): P2PCheckOutcome {
    if (monitorError) {
        return "error";
    }
    if (diagnostics.totalSuccessfulConnections > 0) {
        return "connected";
    }
    if (!monitorActive) {
        return "idle";
    }
    if (elapsedMilliseconds >= P2P_CHECK_OBSERVATION_MILLISECONDS) {
        return "inconclusive";
    }
    if (diagnostics.totalFailedConnections > 0) {
        return "retrying";
    }
    if (diagnostics.totalNewConnections > 0 || Object.keys(diagnostics.details).length > 0) {
        return "connecting";
    }
    return "waiting";
}

export function countActiveP2PConnections(diagnostics: P2PCheckDiagnostics): number {
    return Object.values(diagnostics.details).filter(({ connectionState }) => connectionState === "connected").length;
}

function activeConnectionIds(diagnostics: P2PCheckDiagnostics): string[] {
    return Object.entries(diagnostics.details)
        .filter(([, { connectionState }]) => connectionState === "connected")
        .map(([connectionId]) => connectionId);
}

export function captureP2PAdditionalCheckBaseline(diagnostics: P2PCheckDiagnostics): P2PAdditionalCheckBaseline {
    return {
        activeConnectionIds: activeConnectionIds(diagnostics),
        totalClosedConnections: diagnostics.totalClosedConnections,
        totalFailedConnections: diagnostics.totalFailedConnections,
        totalNewConnections: diagnostics.totalNewConnections,
        totalSuccessfulConnections: diagnostics.totalSuccessfulConnections,
    };
}

function counterIncrease(current: number, baseline: number): number {
    return Math.max(0, current - baseline);
}

export function deriveP2PAdditionalCheckProgress(
    diagnostics: P2PCheckDiagnostics,
    baseline: P2PAdditionalCheckBaseline,
    elapsedMilliseconds: number
): P2PAdditionalCheckProgress {
    const baselineConnectionIds = new Set(baseline.activeConnectionIds);
    const currentActiveConnectionIds = activeConnectionIds(diagnostics);
    const newActiveConnectionIds = currentActiveConnectionIds.filter(
        (connectionId) => !baselineConnectionIds.has(connectionId)
    );
    const activeConnections = counterIncrease(currentActiveConnectionIds.length, baseline.activeConnectionIds.length);
    const newConnections = counterIncrease(diagnostics.totalNewConnections, baseline.totalNewConnections);
    const successfulConnections = counterIncrease(
        diagnostics.totalSuccessfulConnections,
        baseline.totalSuccessfulConnections
    );
    const failedConnections = counterIncrease(diagnostics.totalFailedConnections, baseline.totalFailedConnections);
    const closedConnections = counterIncrease(diagnostics.totalClosedConnections, baseline.totalClosedConnections);

    let outcome: P2PAdditionalCheckOutcome = "waiting";
    if (successfulConnections > 0 && activeConnections > 0 && newActiveConnectionIds.length > 0) {
        outcome = "connected";
    } else if (elapsedMilliseconds >= P2P_CHECK_OBSERVATION_MILLISECONDS) {
        outcome = "inconclusive";
    } else if (
        newConnections > 0 ||
        successfulConnections > 0 ||
        failedConnections > 0 ||
        closedConnections > 0 ||
        newActiveConnectionIds.length > 0
    ) {
        outcome = "negotiating";
    }

    return {
        activeConnections,
        closedConnections,
        failedConnections,
        newConnections,
        newActiveConnectionIds,
        outcome,
        successfulConnections,
    };
}
