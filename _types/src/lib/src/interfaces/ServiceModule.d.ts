// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess";
import type { Rebuilder } from "@lib/interfaces/DatabaseRebuilder";
import type { IFileHandler } from "@lib/interfaces/FileHandler";
import type { StorageAccess } from "@lib/interfaces/StorageAccess";
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { ServiceHub } from "@lib/services/ServiceHub";
import type { IServiceHub } from "@lib/services/base/IService";
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
export type RequiredServices<T extends keyof ServiceHub> = Pick<ServiceHub, T>;
export type RequiredServiceModules<T extends keyof ServiceModules> = Pick<ServiceModules, T>;
export type RequiredServicesInterfaces<T extends keyof IServiceHub> = Pick<IServiceHub, T>;
export type RequiredServiceModulesInterfaces<T extends keyof ServiceModules> = Pick<ServiceModules, T>;
export type NecessaryServices<T extends keyof ServiceHub, U extends keyof ServiceModules> = {
    services: RequiredServices<T>;
    serviceModules: RequiredServiceModules<U>;
};
export type NecessaryServicesInterfaces<T extends keyof IServiceHub, U extends keyof ServiceModules> = {
    services: RequiredServicesInterfaces<T>;
    serviceModules: RequiredServiceModulesInterfaces<U>;
};
export type ServiceFeatureFunction<T extends keyof ServiceHub, U extends keyof ServiceModules, TR> = (host: NecessaryServices<T, U>) => TR;
type ServiceFeatureContext<T> = T & {
    _log: LogFunction;
};
export type ServiceFeatureFunctionWithContext<T extends keyof ServiceHub, U extends keyof ServiceModules, C, TR> = (host: NecessaryServices<T, U>, context: ServiceFeatureContext<C>) => TR;
/**
 * Helper function to create a service feature with proper typing.
 * @param featureFunction The feature function to be wrapped.
 * @returns The same feature function with proper typing.
 * @example
 * const myFeatureDef = createServiceFeature(({ services: { API }, serviceModules: { storageAccess } }) => {
 *   // ...
 * });
 * const myFeature = myFeatureDef.bind(null, this); // <- `this` may `ObsidianLiveSyncPlugin` or a custom context object
 * appLifecycle.onLayoutReady(myFeature);
 */
export declare function createServiceFeature<T extends keyof ServiceHub, U extends keyof ServiceModules, TR>(featureFunction: ServiceFeatureFunction<T, U, TR>): ServiceFeatureFunction<T, U, TR>;
type ContextFactory<T extends keyof ServiceHub, U extends keyof ServiceModules, C> = (host: NecessaryServices<T, U>) => ServiceFeatureContext<C>;
export declare function serviceFeature<T extends keyof ServiceHub, U extends keyof ServiceModules>(): {
    create<TR>(featureFunction: ServiceFeatureFunction<T, U, TR>): ServiceFeatureFunction<T, U, TR>;
    withContext<C extends object = object>(ContextFactory: ContextFactory<T, U, C>): {
        create: <TR>(featureFunction: ServiceFeatureFunctionWithContext<T, U, C, TR>) => (host: NecessaryServices<T, U>, context: ServiceFeatureContext<C>) => TR;
    };
};
export {};
