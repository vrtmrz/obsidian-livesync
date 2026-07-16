// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 96033e1
/** Status icon for a finite remote operation whose lifetime is known. */
export declare const REMOTE_OPERATION_ACTIVITY_ICON = "\uD83D\uDCF2";
/** Status icon for approximate physical remote-request activity. */
export declare const REMOTE_REQUEST_ACTIVITY_ICON = "\uD83C\uDF10";
/** Avoids hiding very short remote requests before the status bar can render them. */
export declare const REMOTE_REQUEST_ACTIVITY_MINIMUM_VISIBLE_MS = 150;
export type RemoteActivityStatus = {
    remoteOperationCount: number;
    trackedRequestCount: number;
};
/** Returns the non-negative difference between tracked request starts and completions. */
export declare function getTrackedRequestCount(requestCount: number, responseCount: number): number;
/** Formats the compact prefix shown before the replication status. */
export declare function formatRemoteActivityStatusLabel(status: RemoteActivityStatus): string;
