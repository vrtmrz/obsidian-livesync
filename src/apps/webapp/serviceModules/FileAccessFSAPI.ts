import { FileAccessBase, type FileAccessBaseDependencies } from "@vrtmrz/livesync-commonlib/compat/serviceModules/FileAccessBase";
import { FSAPIFileSystemAdapter } from "@/apps/webapp/adapters/FSAPIFileSystemAdapter";

/**
 * FileSystem API-specific implementation of FileAccessBase
 * Uses FSAPIFileSystemAdapter for browser file operations
 */
export class FileAccessFSAPI extends FileAccessBase<FSAPIFileSystemAdapter> {
    constructor(rootHandle: FileSystemDirectoryHandle, dependencies: FileAccessBaseDependencies) {
        const adapter = new FSAPIFileSystemAdapter(rootHandle, (message, level, key) =>
            dependencies.APIService.addLog(message, level, key)
        );
        super(adapter, dependencies);
    }

    /**
     * Expose the adapter for accessing scanDirectory and other methods
     */
    get fsapiAdapter(): FSAPIFileSystemAdapter {
        return this.adapter;
    }
}
