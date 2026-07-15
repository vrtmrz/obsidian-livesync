// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: a58965f
/** Returns whether the status UI should report HTTP traffic or a finite remote operation in progress. */
export declare function hasRemoteActivity(requestCount: number, responseCount: number, boundedRemoteActivityCount: number): boolean;
