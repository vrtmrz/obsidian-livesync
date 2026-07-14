// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 05d4714
/**
 * Adapter interface for type guard operations in StorageEventManager
 *
 * @template TFile - Platform-specific file type
 * @template TFolder - Platform-specific folder type
 */
export interface IStorageEventTypeGuardAdapter<TFile, TFolder> {
    /**
     * Check if the given item is a file
     */
    isFile(file: unknown): file is TFile;
    /**
     * Check if the given item is a folder
     */
    isFolder(item: unknown): item is TFolder;
}
