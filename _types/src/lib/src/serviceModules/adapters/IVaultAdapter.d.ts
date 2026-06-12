import type { UXDataWriteOptions } from "@lib/common/models/fileaccess.type";
/**
 * Vault adapter interface
 * High-level file operations that interact with the vault layer
 */
export interface IVaultAdapter<TNativeFile = unknown> {
    /**
     * Read a file as text
     */
    read(file: TNativeFile): Promise<string>;
    /**
     * Read a file using cached content if available
     */
    cachedRead(file: TNativeFile): Promise<string>;
    /**
     * Read a file as binary
     */
    readBinary(file: TNativeFile): Promise<ArrayBuffer>;
    /**
     * Modify an existing file with text content
     */
    modify(file: TNativeFile, data: string, options?: UXDataWriteOptions): Promise<void>;
    /**
     * Modify an existing file with binary content
     */
    modifyBinary(file: TNativeFile, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void>;
    /**
     * Create a new file with text content
     */
    create(path: string, data: string, options?: UXDataWriteOptions): Promise<TNativeFile>;
    /**
     * Create a new file with binary content
     */
    createBinary(path: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<TNativeFile>;
    /**
     * Delete a file or folder
     */
    delete(file: unknown, force?: boolean): Promise<void>;
    /**
     * Move a file or folder to trash
     */
    trash(file: unknown, force?: boolean): Promise<void>;
    /**
     * Trigger an event in the vault
     */
    trigger(name: string, ...data: any[]): any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
