import type {
    P2PDiagnostics,
    P2PDiagnosticCode,
    P2PDiagnosticEvent,
    P2PDiagnosticReason,
    P2PDiagnosticSnapshot,
} from "@vrtmrz/livesync-commonlib/p2p";

export const P2P_DIAGNOSTIC_LOG_KEY = "p2p-diagnostic";

const labels = {
    "room-opening": "Room opening",
    "room-opened": "Room opened",
    "room-closed": "Room closed",
    "room-open-failed": "Room could not open",
    "room-close-failed": "Room could not close",
    "room-open-cancelled": "Room opening cancelled",
    "room-join-error": "Peer could not join the room",
    "peer-advertised": "Peer advertised",
    "peer-left": "Peer left",
    "rtc-failed": "RTC connection failed",
    "auth-accepted": "Authentication accepted",
    "auth-refused": "Authentication refused",
    "auth-timeout": "Authentication timed out",
    "auth-cancelled": "Authentication cancelled",
    "auth-error": "Authentication failed",
    "pull-started": "Pull started",
    "pull-completed": "Pull completed",
    "pull-failed": "Pull failed",
    "pull-cancelled": "Pull cancelled",
    "watch-enabled": "Watching peer changes",
    "watch-disabled": "Stopped watching peer changes",
    "watch-skipped": "Automatic watch skipped",
    "broadcast-enabled": "Announcing changes",
    "broadcast-disabled": "Stopped announcing changes",
    "change-notification-received": "Change notification received",
    "change-notification-ignored": "Change notification ignored",
    "change-notification-sent": "Change notification sent",
    "change-notification-timeout": "Change notification timed out",
    "change-notification-cancelled": "Change notification cancelled",
    "change-notification-error": "Change notification failed",
} satisfies Record<P2PDiagnosticCode, string>;

const reasons: Partial<Record<P2PDiagnosticReason, string>> = {
    "relay-details-unobserved": "relay replies not observed",
    "transport-error": "transport error",
    "replication-error": "replication error",
    "replication-not-ready": "replication not ready",
    "already-running": "replication already running",
    "not-watching": "peer is not watched",
    "not-accepted": "peer is not accepted",
    "setup-in-progress": "setup in progress",
    "peer-not-broadcasting": "peer is not announcing changes",
    "peer-broadcast-unobserved": "peer announcement state not observed",
    "authentication-unobserved": "authentication response not observed",
    ICE_GATHERING_NOT_COMPLETED: "ICE gathering did not complete",
    ICE_CONNECTIVITY_FAILED: "ICE connectivity failed",
    STUN_REQUEST_TIMEOUT: "STUN request timed out",
    SIGNALING_NOT_STABLE: "signalling did not stabilise",
    CONNECTION_DROPPED_AFTER_ESTABLISHED: "established connection dropped",
    NETWORK_INTERRUPTED: "network interrupted",
    UNKNOWN: "reason not observed",
};

const categories = ["relay", "peer", "sync"] as const;
const categoryLabels = { relay: "Relay", peer: "Peer", sync: "Sync" } as const;

function describeEvent(event: P2PDiagnosticEvent): string {
    const label = labels[event.code] ?? "Unknown diagnostic event";
    const reason = event.reason ? reasons[event.reason] : undefined;
    const peer = event.peerId ? ` [${event.peerId.replace(/[^A-Za-z0-9_-]/g, "?").slice(0, 12)}]` : "";
    return label + (reason ? `; ${reason}` : "") + peer;
}

function eventDate(event: P2PDiagnosticEvent): Date | undefined {
    const date = new Date(event.timestamp);
    return Number.isFinite(date.getTime()) ? date : undefined;
}

export function formatP2PDiagnosticLog(event: P2PDiagnosticEvent): string {
    const time = eventDate(event)?.toISOString() ?? "unknown time";
    return `[P2P Diag] ${categoryLabels[event.category]}: ${describeEvent(event)} (observed ${time})`;
}

export type P2PDiagnosticRow = {
    category: (typeof categories)[number];
    label: string;
    text: string;
    time: string;
    title: string;
};

export function projectP2PDiagnosticRows(snapshot: P2PDiagnosticSnapshot, available = true): P2PDiagnosticRow[] {
    return categories.map((category) => {
        const event = snapshot[category];
        const date = event ? eventDate(event) : undefined;
        return {
            category,
            label: categoryLabels[category],
            text: event ? describeEvent(event) : available ? "Not observed" : "Unavailable",
            time: date?.toLocaleTimeString() ?? "",
            title: date?.toLocaleString() ?? "",
        };
    });
}

/** Replays the latest three observations, then follows the same accepted events written to the log. */
export function observeP2PDiagnosticRows(
    diagnostics: P2PDiagnostics,
    listener: (rows: readonly P2PDiagnosticRow[]) => void
): () => void {
    const available = !!(diagnostics.getDiagnosticSnapshot || diagnostics.onDiagnosticEvent);
    let snapshot = diagnostics.getDiagnosticSnapshot?.() ?? {};
    let disposed = false;
    const unsubscribe = diagnostics.onDiagnosticEvent?.((event) => {
        if (disposed) return;
        snapshot = { ...snapshot, [event.category]: event };
        listener(projectP2PDiagnosticRows(snapshot, available));
    });
    listener(projectP2PDiagnosticRows(snapshot, available));
    return () => {
        if (disposed) return;
        disposed = true;
        unsubscribe?.();
    };
}
