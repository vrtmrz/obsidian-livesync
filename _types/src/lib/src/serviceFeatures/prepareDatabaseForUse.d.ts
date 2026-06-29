// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { UnresolvedErrorManager } from "@lib/services/base/UnresolvedErrorManager";
import { type LogFunction } from "@lib/services/lib/logUtils";
/**
 * Initialise the database and trigger a full vault scan.
 * @param host Services container
 * @param log Logging function
 * @param errorManager Error manager
 * @param showingNotice Whether to show notices during initialisation
 * @param reopenDatabase Whether to reopen the database connection
 * @param ignoreSuspending Whether to ignore suspension settings
 * @returns True if initialisation succeeded
 */
export declare function prepareDatabaseForUse(host: NecessaryServices<"appLifecycle" | "setting" | "vault" | "path" | "database" | "databaseEvents" | "fileProcessing" | "replicator", never>, log: LogFunction, errorManager: UnresolvedErrorManager, showingNotice?: boolean, reopenDatabase?: boolean, ignoreSuspending?: boolean): Promise<boolean>;
/**
 * Associate the initialiser file feature with the app lifecycle events.
 * This function binds initialization handlers to the appropriate lifecycle events.
 * @param host Services container with required dependencies
 */
export declare function usePrepareDatabaseForUse(host: NecessaryServices<"API" | "appLifecycle" | "setting" | "vault" | "path" | "database" | "databaseEvents" | "fileProcessing" | "replicator", never>): void;
