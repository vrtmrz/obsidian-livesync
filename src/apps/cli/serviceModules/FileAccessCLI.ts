import { FileAccessBase, type FileAccessBaseDependencies } from "@lib/serviceModules/FileAccessBase";
import { NodeFileSystemAdapter } from "../adapters/NodeFileSystemAdapter";

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
