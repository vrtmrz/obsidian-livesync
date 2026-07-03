// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type App } from "@/deps";
import { FileAccessBase, type FileAccessBaseDependencies } from "@lib/serviceModules/FileAccessBase.ts";
import { ObsidianFileSystemAdapter } from "./FileSystemAdapters/ObsidianFileSystemAdapter";
/**
 * Obsidian-specific implementation of FileAccessBase
 * Uses ObsidianFileSystemAdapter for platform-specific operations
 */
export declare class FileAccessObsidian extends FileAccessBase<ObsidianFileSystemAdapter> {
    constructor(app: App, dependencies: FileAccessBaseDependencies);
}
