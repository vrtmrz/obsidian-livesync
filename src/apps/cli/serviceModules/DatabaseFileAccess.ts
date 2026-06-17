import {
    ServiceDatabaseFileAccessBase,
    type ServiceDatabaseFileAccessDependencies,
} from "@lib/serviceModules/ServiceDatabaseFileAccessBase";
import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess";

/**
 * CLI-specific implementation of ServiceDatabaseFileAccess
 * Same as Obsidian version, no platform-specific changes needed
 */
export class ServiceDatabaseFileAccessCLI extends ServiceDatabaseFileAccessBase implements DatabaseFileAccess {
    constructor(services: ServiceDatabaseFileAccessDependencies) {
        super(services);
    }
}
