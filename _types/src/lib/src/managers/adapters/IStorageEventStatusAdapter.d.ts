// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: bc1806f
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
