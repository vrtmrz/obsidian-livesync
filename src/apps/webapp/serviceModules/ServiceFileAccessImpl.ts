import { ServiceFileAccessBase, type StorageAccessBaseDependencies } from "@lib/serviceModules/ServiceFileAccessBase";
import { FSAPIFileSystemAdapter } from "../adapters/FSAPIFileSystemAdapter";

/**
 * FileSystem API-specific implementation of ServiceFileAccess
 * Uses FSAPIFileSystemAdapter for platform-specific operations
 */
export class ServiceFileAccessFSAPI extends ServiceFileAccessBase<FSAPIFileSystemAdapter> {
    constructor(services: StorageAccessBaseDependencies<FSAPIFileSystemAdapter>) {
        super(services);
    }
}
