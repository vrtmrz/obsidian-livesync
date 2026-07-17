import { FileAccessBase, type FileAccessBaseDependencies } from "@vrtmrz/livesync-commonlib/compat/serviceModules/FileAccessBase";
import { NodeFileSystemAdapter } from "@/apps/cli/adapters/NodeFileSystemAdapter";

/**
 * CLI-specific implementation of FileAccessBase
 * Uses NodeFileSystemAdapter for Node.js file operations
 */
export class FileAccessCLI extends FileAccessBase<NodeFileSystemAdapter> {
    constructor(basePath: string, dependencies: FileAccessBaseDependencies) {
        const adapter = new NodeFileSystemAdapter(basePath);
        super(adapter, dependencies);
    }

    /**
     * Expose the adapter for accessing scanDirectory
     */
    get nodeAdapter(): NodeFileSystemAdapter {
        return this.adapter;
    }
}
