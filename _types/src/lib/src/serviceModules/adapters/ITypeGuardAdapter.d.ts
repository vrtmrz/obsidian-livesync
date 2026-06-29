// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
/**
 * Type guard adapter interface
 * Provides runtime type checking for native file system objects
 */
export interface ITypeGuardAdapter<TNativeFile = unknown, TNativeFolder = unknown> {
    /**
     * Check if the given object is a file
     */
    isFile(file: unknown): file is TNativeFile;
    /**
     * Check if the given object is a folder
     */
    isFolder(item: unknown): item is TNativeFolder;
}
