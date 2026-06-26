// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess";
import type { Rebuilder } from "@lib/interfaces/DatabaseRebuilder";
import type { IFileHandler } from "@lib/interfaces/FileHandler";
import type { StorageAccess } from "@lib/interfaces/StorageAccess";
import type { IServiceHub } from "@lib/services/base/IService";
import type { LiveSyncBaseCore } from "./LiveSyncBaseCore.ts";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext.ts";
import type { LiveSyncCommands } from "./features/LiveSyncCommands.ts";
import type { ObsidianServiceHub } from "./modules/services/ObsidianServiceHub.ts";
export interface ServiceModules {
    storageAccess: StorageAccess;
    /**
     * Database File Accessor for handling file operations related to the database, such as exporting the database, importing from a file, etc.
     */
    databaseFileAccess: DatabaseFileAccess;
    /**
     * File Handler for handling file operations related to replication, such as resolving conflicts, applying changes from replication, etc.
     */
    fileHandler: IFileHandler;
    /**
     * Rebuilder for handling database rebuilding operations.
     */
    rebuilder: Rebuilder;
}
export interface LiveSyncHost {
    services: IServiceHub;
    serviceModules: ServiceModules;
}
export type LiveSyncCore = LiveSyncBaseCore<ObsidianServiceContext, LiveSyncCommands>;
/**
 * Extends the standard `{ services, serviceModules }` host shape with a typed
 * `context` slice from `ObsidianServiceContext`.
 *
 * Use this as the host type for features built with `createServiceFeature` that
 * also need type-safe access to Obsidian-specific context properties such as
 * `app` or `plugin`.
 *
 * @typeParam T - Service keys (same constraint as `NecessaryObsidianFeature`).
 * @typeParam U - Service module keys from `ServiceModules`.
 * @typeParam C - Keys of `ObsidianServiceContext` to expose (e.g. `"app" | "plugin"`).
 */
export type NecessaryObsidianFeature<T extends keyof ObsidianServiceHub, U extends keyof ServiceModules = never, C extends keyof ObsidianServiceContext = never> = {
    services: Pick<ObsidianServiceHub, T>;
    serviceModules: Pick<ServiceModules, U>;
    context: Pick<ObsidianServiceContext, C>;
};
/** Alias to keep backward compatibility with defined feature hosts */
export type NecessaryObsidianServices<T extends keyof ObsidianServiceHub, U extends keyof ServiceModules = never, C extends keyof ObsidianServiceContext = never> = NecessaryObsidianFeature<T, U, C>;
export type ObsidianServiceFeatureFunction<T extends keyof ObsidianServiceHub, U extends keyof ServiceModules, C extends keyof ObsidianServiceContext, TR> = (host: NecessaryObsidianFeature<T, U, C>) => TR;
export declare function createObsidianServiceFeature<T extends keyof ObsidianServiceHub, U extends keyof ServiceModules = never, C extends keyof ObsidianServiceContext = never, TR = void>(featureFunction: ObsidianServiceFeatureFunction<T, U, C, TR>): ObsidianServiceFeatureFunction<T, U, C, TR>;
