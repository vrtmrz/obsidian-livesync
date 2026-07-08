// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { createInstanceLogFunction, type LogFunction } from "@lib/services/lib/logUtils";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
/**
 * Notify when checking remote storage size is not configured.
 * @returns true if the check is passed or user has configured the notification, false to block subsequent processes. (always true).
 */
export declare function onNotifyRemoteSizeNotConfiguredFactory(host: NecessaryServices<"appLifecycle" | "API" | "setting", never>, log: ReturnType<typeof createInstanceLogFunction>): () => Promise<boolean>;
/**
 * Notify when the remote storage size exceed the threshold.
 * @returns true if the check is passed or user has chosen to ignore the warning, false to block subsequent processes.
 * @param host
 * @param log
 * @returns
 */
export declare function onNotifyRemoteSizeExceedFactory(host: NecessaryServices<"API" | "setting" | "replicator", "rebuilder">, log: ReturnType<typeof createInstanceLogFunction>): () => Promise<boolean>;
/**
 * Scan the remote storage size and notify if it is not configured or exceed the threshold.
 * @param host The necessary services required for the operation.
 * @param log The logging function to use for logging messages.
 * @param resetThreshold Whether to reset the notification threshold before scanning. This is useful when you want to force the notification to show up again.
 * @returns A promise that resolves to true if all checks pass or user has configured the notification.
 */
export declare function scanAllStat(host: NecessaryServices<"API" | "setting" | "replicator" | "appLifecycle", "rebuilder">, log: LogFunction, resetThreshold?: boolean): Promise<boolean>;
/**
 * Associate the remote storage size check feature with the app lifecycle events.
 * @param host
 */
export declare function useCheckRemoteSize(host: NecessaryServices<"API" | "setting" | "replicator" | "appLifecycle", "rebuilder">): void;
