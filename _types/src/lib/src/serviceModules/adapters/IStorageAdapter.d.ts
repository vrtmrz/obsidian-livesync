// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: ef1bdf0
/**
 * Focused compatibility views of the existing storage adapter.
 *
 * These interfaces allow internal consumers to depend on fewer operations while
 * retaining the existing `UXStat`, `UXDataWriteOptions`, and method semantics.
 * They are not a neutral or extraction-ready storage API. Their names, shared
 * types, and behavioural contracts may change when the cross-platform contract
 * is designed and stabilised.
 *
 * @packageDocumentation
 */
import type { UXDataWriteOptions, UXStat } from "@lib/common/types.ts";
/** File and directory existence and metadata operations. */
export interface IStorageMetadataAccess<TStat extends UXStat = UXStat> {
    exists(path: string): Promise<boolean>;
    trystat(path: string): Promise<TStat | null>;
    stat(path: string): Promise<TStat | null>;
}
/** Text-file read operation. */
export interface IStorageTextReadAccess {
    read(path: string): Promise<string>;
}
/** Binary-file read operation. */
export interface IStorageBinaryReadAccess {
    readBinary(path: string): Promise<ArrayBuffer>;
}
/** Text-file write operation. */
export interface IStorageTextWriteAccess {
    write(path: string, data: string, options?: UXDataWriteOptions): Promise<void>;
}
/** Binary-file write operation. */
export interface IStorageBinaryWriteAccess {
    writeBinary(path: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void>;
}
/** Text-file append operation. */
export interface IStorageTextAppendAccess {
    append(path: string, data: string, options?: UXDataWriteOptions): Promise<void>;
}
/** Directory creation and direct-child listing operations. */
export interface IStorageDirectoryAccess {
    mkdir(path: string): Promise<void>;
    list(basePath: string): Promise<{
        files: string[];
        folders: string[];
    }>;
}
/** File or directory removal operation. */
export interface IStorageRemoveAccess {
    remove(path: string): Promise<void>;
}
/**
 * Storage adapter interface
 * Backwards-compatible aggregate of the focused storage capability views.
 */
export interface IStorageAdapter<TStat extends UXStat = UXStat> extends IStorageMetadataAccess<TStat>, IStorageTextReadAccess, IStorageBinaryReadAccess, IStorageTextWriteAccess, IStorageBinaryWriteAccess, IStorageTextAppendAccess, IStorageDirectoryAccess, IStorageRemoveAccess { // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- Empty interface
}
