// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
/**
 * Adapter interface for status update operations
 */
export interface IStorageEventStatusAdapter {
    /**
     * Update the status display
     */
    updateStatus(status: {
        batched: number;
        processing: number;
        totalQueued: number;
    }): void;
}
