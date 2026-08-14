import { type App } from "@/deps.js";
import { FileAccessBase, type FileAccessBaseDependencies } from "@vrtmrz/livesync-commonlib/compat/serviceModules/FileAccessBase.js";
import { ObsidianFileSystemAdapter } from "./FileSystemAdapters/ObsidianFileSystemAdapter.js";

/**
 * Obsidian-specific implementation of FileAccessBase
 * Uses ObsidianFileSystemAdapter for platform-specific operations
 */
export class FileAccessObsidian extends FileAccessBase<ObsidianFileSystemAdapter> {
    constructor(app: App, dependencies: FileAccessBaseDependencies) {
        const adapter = new ObsidianFileSystemAdapter(app);
        super(adapter, dependencies);
    }
}
