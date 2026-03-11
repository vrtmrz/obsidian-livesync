import {
    ServiceDatabaseFileAccessBase,
    type ServiceDatabaseFileAccessDependencies,
} from "../../../lib/src/serviceModules/ServiceDatabaseFileAccessBase";
import type { DatabaseFileAccess } from "../../../lib/src/interfaces/DatabaseFileAccess";

/**
 * FileSystem API-specific implementation of ServiceDatabaseFileAccess
 * Same as Obsidian version, no platform-specific changes needed
 */
export class ServiceDatabaseFileAccessFSAPI extends ServiceDatabaseFileAccessBase implements DatabaseFileAccess {
    constructor(services: ServiceDatabaseFileAccessDependencies) {
        super(services);
    }
}
