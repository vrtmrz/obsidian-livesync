import type { DatabaseFileAccess } from "@/lib/src/interfaces/DatabaseFileAccess";
import type { Rebuilder } from "@/lib/src/interfaces/DatabaseRebuilder";
import type { IFileHandler } from "@/lib/src/interfaces/FileHandler";
import type { StorageAccess } from "@/lib/src/interfaces/StorageAccess";
import type { IServiceHub } from "./lib/src/services/base/IService";

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
