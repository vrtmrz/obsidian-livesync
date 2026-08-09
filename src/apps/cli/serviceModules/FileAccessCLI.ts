import { FileAccessBase, type FileAccessBaseDependencies } from "@vrtmrz/livesync-commonlib/compat/serviceModules/FileAccessBase";
import { NodeFileSystemAdapter } from "@/apps/cli/adapters/NodeFileSystemAdapter";
import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";

/**
 * CLI-specific implementation of FileAccessBase
 * Uses NodeFileSystemAdapter for Node.js file operations
 */
export class FileAccessCLI extends FileAccessBase<NodeFileSystemAdapter> {
    constructor(basePath: string, dependencies: FileAccessBaseDependencies) {
        const adapter = new NodeFileSystemAdapter(basePath, (message, detail) => {
            dependencies.APIService.addLog(message, LOG_LEVEL_NOTICE);
            if (detail !== undefined) {
                dependencies.APIService.addLog(detail, LOG_LEVEL_NOTICE);
            }
        });
        super(adapter, dependencies);
    }

    /**
     * Expose the adapter for accessing scanDirectory
     */
    get nodeAdapter(): NodeFileSystemAdapter {
        return this.adapter;
    }
}
