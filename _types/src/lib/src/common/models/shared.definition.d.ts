// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
export declare const DatabaseConnectingStatuses: {
    readonly STARTED: "STARTED";
    readonly NOT_CONNECTED: "NOT_CONNECTED";
    readonly PAUSED: "PAUSED";
    readonly CONNECTED: "CONNECTED";
    readonly COMPLETED: "COMPLETED";
    readonly CLOSED: "CLOSED";
    readonly ERRORED: "ERRORED";
    readonly JOURNAL_SEND: "JOURNAL_SEND";
    readonly JOURNAL_RECEIVE: "JOURNAL_RECEIVE";
};
export type DatabaseConnectingStatus = (typeof DatabaseConnectingStatuses)[keyof typeof DatabaseConnectingStatuses];
export type ReplicationStatics = {
    sent: number;
    arrived: number;
    maxPullSeq: number;
    maxPushSeq: number;
    lastSyncPullSeq: number;
    lastSyncPushSeq: number;
    syncStatus: DatabaseConnectingStatus;
};
export declare const DEFAULT_REPLICATION_STATICS: ReplicationStatics;
