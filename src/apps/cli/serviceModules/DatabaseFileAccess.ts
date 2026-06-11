import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess";
import {
    ServiceDatabaseFileAccessBase,
    type ServiceDatabaseFileAccessDependencies,
} from "@lib/serviceModules/ServiceDatabaseFileAccessBase";

/**
 * CLI-specific implementation of ServiceDatabaseFileAccess
 * Same as Obsidian version, no platform-specific changes needed
 */
export class ServiceDatabaseFileAccessCLI extends ServiceDatabaseFileAccessBase implements DatabaseFileAccess {
    constructor(services: ServiceDatabaseFileAccessDependencies) {
        super(services);
    }
}
