// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { type LogFunction } from "@lib/services/lib/logUtils";
import { type FullScanOptions } from "@lib/serviceFeatures/offlineScanner";
export declare const SIMPLE_FETCH_STAGE1_REMOTE_WINS = "Overwrite all with remote files";
export declare const SIMPLE_FETCH_STAGE1_NEWER_WINS = "Compare time and take newer";
export declare const SIMPLE_FETCH_STAGE1_LEGACY = "Use the detailed flow";
export declare const SIMPLE_FETCH_STAGE1_CANCEL = "Cancel";
export declare const SIMPLE_FETCH_STAGE2_REMOTE_DELETE_NONE = "Keep local files even if not on remote";
export declare const SIMPLE_FETCH_STAGE2_REMOTE_DELETE_ALL = "Delete local files if not on remote";
export declare const SIMPLE_FETCH_STAGE2_NEWER_CLEANUP = "Delete local files if deleted on remote";
export declare const SIMPLE_FETCH_STAGE2_NEWER_SYNC_ALL = "Keep local files even if deleted on remote";
export declare const STAGE2_ABORT = "Cancel all and reboot";
export declare function askSimpleFetchMode(host: NecessaryServices<"UI" | "setting", never>): Promise<{
    mode: string;
    options: Partial<FullScanOptions>;
} | "cancelled" | "aborted">;
export declare function askAndPerformFastSetupOnScheduledFetchAll(host: NecessaryServices<"vault" | "fileProcessing" | "tweakValue" | "UI" | "setting" | "appLifecycle" | "path" | "keyValueDB" | "database", "storageAccess" | "rebuilder" | "fileHandler">, log: LogFunction, cleanupFlag: () => Promise<void>): Promise<boolean | undefined>;
