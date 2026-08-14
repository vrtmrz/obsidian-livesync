import type { DatabaseFileAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseFileAccess.js";
import type { Rebuilder } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseRebuilder.js";
import type { IFileHandler } from "@vrtmrz/livesync-commonlib/compat/interfaces/FileHandler.js";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess.js";
import type { IServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/base/IService.js";

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
