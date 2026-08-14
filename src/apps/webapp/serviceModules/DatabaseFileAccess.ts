import {
    ServiceDatabaseFileAccessBase,
    type ServiceDatabaseFileAccessDependencies,
} from "@vrtmrz/livesync-commonlib/compat/serviceModules/ServiceDatabaseFileAccessBase.js";
import type { DatabaseFileAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseFileAccess.js";

/**
 * FileSystem API-specific implementation of ServiceDatabaseFileAccess
 * Same as Obsidian version, no platform-specific changes needed
 */
export class ServiceDatabaseFileAccessFSAPI extends ServiceDatabaseFileAccessBase implements DatabaseFileAccess {
    constructor(services: ServiceDatabaseFileAccessDependencies) {
        super(services);
    }
}
