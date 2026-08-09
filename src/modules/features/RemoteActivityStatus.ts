/** Status icon for a finite remote operation whose lifetime is known. */
export const REMOTE_OPERATION_ACTIVITY_ICON = "📲";

/** Status icon for approximate physical remote-request activity. */
export const REMOTE_REQUEST_ACTIVITY_ICON = "🌐";

/** Avoids hiding very short remote requests before the status bar can render them. */
export const REMOTE_REQUEST_ACTIVITY_MINIMUM_VISIBLE_MS = 150;

export type RemoteActivityStatus = {
    remoteOperationCount: number;
    trackedRequestCount: number;
};

/** Returns the non-negative difference between tracked request starts and completions. */
export function getTrackedRequestCount(requestCount: number, responseCount: number): number {
    return Math.max(0, requestCount - responseCount);
}

/** Formats the compact prefix shown before the replication status. */
export function formatRemoteActivityStatusLabel(status: RemoteActivityStatus): string {
    const labels = [
        status.remoteOperationCount > 0 ? REMOTE_OPERATION_ACTIVITY_ICON : "",
        status.trackedRequestCount > 0 ? `${REMOTE_REQUEST_ACTIVITY_ICON}${status.trackedRequestCount}` : "",
    ].filter((label) => label !== "");
    return labels.length > 0 ? `${labels.join(" ")} ` : "";
}
