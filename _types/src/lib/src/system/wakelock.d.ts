// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 90de158
/**
 * Run callback with screen wake lock held.
 * @param callback Callback to run with wake lock held
 * @returns Result of callback
 */
export declare function withWakeLock<T>(callback: () => Promise<T>): Promise<T>;
