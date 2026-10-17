import {
    FileAccessBase,
    type FileAccessBaseDependencies,
} from "@vrtmrz/livesync-commonlib/compat/serviceModules/FileAccessBase";
import { NodeFileSystemAdapter } from "@/apps/cli/adapters/NodeFileSystemAdapter";
import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { getPathNormalizationVersion } from "@vrtmrz/livesync-commonlib/settings";

/**
 * CLI-specific implementation of FileAccessBase
 * Uses NodeFileSystemAdapter for Node.js file operations
 */
export class FileAccessCLI extends FileAccessBase<NodeFileSystemAdapter> {
    constructor(basePath: string, dependencies: FileAccessBaseDependencies) {
        const pathNormalizationVersion = () =>
            getPathNormalizationVersion(dependencies.settingService.currentSettings());
        const isCaseInsensitive = () => {
            const settings = dependencies.settingService.currentSettings();
            return !settings.handleFilenameCaseSensitive || dependencies.vaultService.isStorageInsensitive();
        };
        const adapter = new NodeFileSystemAdapter(
            basePath,
            (message, detail) => {
                dependencies.APIService.addLog(message, LOG_LEVEL_NOTICE);
                if (detail !== undefined) {
                    dependencies.APIService.addLog(detail, LOG_LEVEL_NOTICE);
                }
            },
            pathNormalizationVersion,
            isCaseInsensitive
        );
        super(adapter, dependencies);
    }

    /**
     * Expose the adapter for accessing scanDirectory
     */
    get nodeAdapter(): NodeFileSystemAdapter {
        return this.adapter;
    }
}
