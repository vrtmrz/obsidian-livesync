import type { DatabaseConnectingStatus } from "@vrtmrz/livesync-commonlib/compat/common/types";

/**
 * Status display styles.
 *
 * - `classic`: the original text line ("Sync: 💤 ↑ 8 ↓ 3 ...") is always shown.
 * - `minimal`: nothing is shown while idle; a small pill appears while synchronising and a
 *   dismissible warning appears on error.
 */
export const StatusStyles = {
    CLASSIC: "classic",
    MINIMAL: "minimal",
} as const;
export type StatusStyle = (typeof StatusStyles)[keyof typeof StatusStyles];

/**
 * The settings key. It is stored alongside the other settings in `data.json`.
 * Note: this key is not yet part of the shared settings type in `livesync-commonlib`,
 * therefore it is read and written through the helpers below.
 */
export const STATUS_STYLE_KEY = "statusStyle";

export const DEFAULT_STATUS_STYLE: StatusStyle = StatusStyles.CLASSIC;

/** How long the activity pill remains visible after the last transfer has finished. */
export const MINIMAL_STATUS_LINGER_MS = 1_500;

export function getStatusStyle(settings: object | undefined): StatusStyle {
    if (!settings) return DEFAULT_STATUS_STYLE;
    const value = Reflect.get(settings, STATUS_STYLE_KEY);
    return value === StatusStyles.MINIMAL ? StatusStyles.MINIMAL : StatusStyles.CLASSIC;
}

export function setStatusStyle(settings: object, style: StatusStyle): void {
    Reflect.set(settings, STATUS_STYLE_KEY, style);
}

export type MinimalStatusState = "idle" | "active" | "error";

export type MinimalStatus = {
    state: MinimalStatusState;
    /** Documents pushed since the current activity burst began. */
    sent: number;
    /** Documents pulled since the current activity burst began. */
    arrived: number;
};

const ACTIVE_SYNC_STATUSES: readonly DatabaseConnectingStatus[] = [
    "STARTED",
    "CONNECTED",
    "JOURNAL_SEND",
    "JOURNAL_RECEIVE",
];

/**
 * Derive the minimal display state from the replicator status and the amount of queued work.
 * @param syncStatus current replicator status
 * @param pendingCount total of every queue and in-flight counter (any positive value means "busy")
 */
export function deriveMinimalState(syncStatus: DatabaseConnectingStatus, pendingCount: number): MinimalStatusState {
    if (syncStatus === "ERRORED") return "error";
    if (pendingCount > 0) return "active";
    if (ACTIVE_SYNC_STATUSES.includes(syncStatus)) return "active";
    return "idle";
}

/** Format the transfer counters for the pill and the status bar. */
export function formatMinimalCounters(sent: number, arrived: number): string {
    const parts = [] as string[];
    if (sent > 0) parts.push(`↑${sent}`);
    if (arrived > 0) parts.push(`↓${arrived}`);
    return parts.join(" ");
}
