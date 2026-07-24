import type { DatabaseFileAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseFileAccess";
import type { Rebuilder } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseRebuilder";
import type { IFileHandler } from "@vrtmrz/livesync-commonlib/compat/interfaces/FileHandler";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { IServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";

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
