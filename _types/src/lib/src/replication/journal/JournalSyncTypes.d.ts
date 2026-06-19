// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 9aeab51
export type CheckPointInfo = {
    lastLocalSeq: number | string;
    journalEpoch: string;
    knownIDs: Set<string>;
    sentIDs: Set<string>;
    receivedFiles: Set<string>;
    sentFiles: Set<string>;
};
export declare const CheckPointInfoDefault: CheckPointInfo;
