// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type UXFileInfoStub } from "@lib/common/types";
import { type LogFunction } from "@lib/services/lib/logUtils";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
/**
 * This is a simple handler that accepts all files.
 */
export declare function isAcceptedAlwaysFactory(host: NecessaryServices<never, never>, log: LogFunction): (file: string | UXFileInfoStub) => Promise<boolean>;
/**
 * Check if a file is accepted based on filename duplication in the vault.
 */
export declare function isAcceptedInFilenameDuplicationFactory(host: NecessaryServices<"vault" | "fileProcessing", "storageAccess">, log: LogFunction): (file: string | UXFileInfoStub) => Promise<boolean>;
/**
 * Check if a file is accepted by the local database (e.g., not rejected by the local DB's target file check).
 * Local database responsible for non-internal files, syncOnlyRegEx, syncIgnoreRegEx
 * This possibly should be separated.
 */
export declare function isAcceptedByLocalDBFactory(host: NecessaryServices<"database" | "databaseEvents", never>, log: LogFunction): (file: string | UXFileInfoStub) => Promise<boolean>;
/**
 * Factory function to create the isAcceptedByIgnoreFiles handler.
 * This handler checks if a file is ignored based on the ignore files specified in the settings.
 * It also caches the ignore file contents for performance and listens to settings changes to invalidate the cache.
 */
export declare function isAcceptedByIgnoreFilesFactory(host: NecessaryServices<"setting" | "appLifecycle", "storageAccess">, log: LogFunction): (file: string | UXFileInfoStub) => Promise<boolean>;
export declare function useTargetFilters(host: NecessaryServices<"API" | "vault" | "fileProcessing" | "setting" | "appLifecycle" | "database" | "databaseEvents", "storageAccess">): void;
