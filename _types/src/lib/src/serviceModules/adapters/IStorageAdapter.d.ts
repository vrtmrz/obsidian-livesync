// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { UXDataWriteOptions, UXStat } from "@lib/common/types.ts";
/**
 * Storage adapter interface
 * Low-level file system operations (adapter level)
 */
export interface IStorageAdapter<TStat extends UXStat = UXStat> {
    /**
     * Check if a file or directory exists
     */
    exists(path: string): Promise<boolean>;
    /**
     * Get file statistics, returns null if file doesn't exist
     */
    trystat(path: string): Promise<TStat | null>;
    /**
     * Get file statistics
     */
    stat(path: string): Promise<TStat | null>;
    /**
     * Create a directory
     */
    mkdir(path: string): Promise<void>;
    /**
     * Remove a file or directory
     */
    remove(path: string): Promise<void>;
    /**
     * Read a file as text
     */
    read(path: string): Promise<string>;
    /**
     * Read a file as binary
     */
    readBinary(path: string): Promise<ArrayBuffer>;
    /**
     * Write text to a file
     */
    write(path: string, data: string, options?: UXDataWriteOptions): Promise<void>;
    /**
     * Write binary data to a file
     */
    writeBinary(path: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void>;
    /**
     * Append text to a file
     */
    append(path: string, data: string, options?: UXDataWriteOptions): Promise<void>;
    /**
     * List files and folders in a directory
     */
    list(basePath: string): Promise<{
        files: string[];
        folders: string[];
    }>;
}
