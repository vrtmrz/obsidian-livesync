import type { IServiceHub } from "@lib/services/base/IService";
import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess";
import type { Rebuilder } from "@lib/interfaces/DatabaseRebuilder";
import type { IFileHandler } from "@lib/interfaces/FileHandler";
import type { StorageAccess } from "@lib/interfaces/StorageAccess";

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
export type RequiredServices<T extends keyof IServiceHub> = Pick<IServiceHub, T>;
export type RequiredServiceModules<T extends keyof ServiceModules> = Pick<ServiceModules, T>;

export type NecessaryServices<T extends keyof IServiceHub, U extends keyof ServiceModules> = {
    services: RequiredServices<T>;
    serviceModules: RequiredServiceModules<U>;
};

export type ServiceFeatureFunction<T extends keyof IServiceHub, U extends keyof ServiceModules, TR> = (
    host: NecessaryServices<T, U>
) => TR;

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
export function createServiceFeature<T extends keyof IServiceHub, U extends keyof ServiceModules, TR>(
    featureFunction: ServiceFeatureFunction<T, U, TR>
): ServiceFeatureFunction<T, U, TR> {
    return featureFunction;
}
