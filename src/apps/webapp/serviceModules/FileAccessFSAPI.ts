import { FileAccessBase, type FileAccessBaseDependencies } from "@lib/serviceModules/FileAccessBase";
import { FSAPIFileSystemAdapter } from "../adapters/FSAPIFileSystemAdapter";

/**
 * FileSystem API-specific implementation of FileAccessBase
 * Uses FSAPIFileSystemAdapter for browser file operations
 */
export class FileAccessFSAPI extends FileAccessBase<FSAPIFileSystemAdapter> {
    constructor(rootHandle: FileSystemDirectoryHandle, dependencies: FileAccessBaseDependencies) {
        const adapter = new FSAPIFileSystemAdapter(rootHandle);
        super(adapter, dependencies);
    }

    /**
     * Expose the adapter for accessing scanDirectory and other methods
     */
    get fsapiAdapter(): FSAPIFileSystemAdapter {
        return this.adapter;
    }
}
