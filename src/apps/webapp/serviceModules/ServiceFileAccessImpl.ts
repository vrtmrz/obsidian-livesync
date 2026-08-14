import { ServiceFileAccessBase, type StorageAccessBaseDependencies } from "@vrtmrz/livesync-commonlib/compat/serviceModules/ServiceFileAccessBase.js";
import { FSAPIFileSystemAdapter } from "@/apps/webapp/adapters/FSAPIFileSystemAdapter.js";

/**
 * FileSystem API-specific implementation of ServiceFileAccess
 * Uses FSAPIFileSystemAdapter for platform-specific operations
 */
export class ServiceFileAccessFSAPI extends ServiceFileAccessBase<FSAPIFileSystemAdapter> {
    constructor(services: StorageAccessBaseDependencies<FSAPIFileSystemAdapter>) {
        super(services);
    }
}
