// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { TAbstractFile } from "@/deps.ts";
import { type AnyEntry, type CouchDBCredentials, type DocumentID, type EntryHasPath, type FilePath, type FilePathWithPrefix, type UXFileInfo, type UXFileInfoStub } from "@lib/common/types.ts";
export { ICHeader, ICXHeader } from "./types.ts";
import type { KeyValueDatabase } from "@lib/interfaces/KeyValueDatabase.ts";
export { scheduleTask, cancelTask, cancelAllTasks } from "octagonal-wheels/concurrency/task";
export declare function path2id(filename: FilePathWithPrefix | FilePath, obfuscatePassphrase: string | false, caseInsensitive: boolean): Promise<DocumentID>;
export declare function id2path(id: DocumentID, entry?: EntryHasPath): FilePathWithPrefix;
export declare function getPathFromTFile(file: TAbstractFile): FilePath;
import { isInternalFile, getPathFromUXFileInfo, getStoragePathFromUXFileInfo, getDatabasePathFromUXFileInfo } from "@lib/common/typeUtils.ts";
export { isInternalFile, getPathFromUXFileInfo, getStoragePathFromUXFileInfo, getDatabasePathFromUXFileInfo };
export declare function memoObject<T>(key: string, obj: T): T;
export declare function memoIfNotExist<T>(key: string, func: () => T | Promise<T>): Promise<T>;
export declare function retrieveMemoObject<T>(key: string): T | false;
export declare function disposeMemoObject(key: string): void;
export declare function isValidPath(filename: string): boolean;
export declare function trimPrefix(target: string, prefix: string): string;
export { isInternalMetadata, id2InternalMetadataId, isChunk, isCustomisationSyncMetadata, isPluginMetadata, stripInternalMetadataPrefix, } from "@lib/common/typeUtils.ts";
export declare const _requestToCouchDBFetch: (baseUri: string, username: string, password: string, path?: string, body?: unknown, method?: string) => Promise<Response>;
export declare const _requestToCouchDB: (baseUri: string, credentials: CouchDBCredentials, origin: string, path?: string, body?: unknown, method?: string, customHeaders?: Record<string, string>) => Promise<import("obsidian").RequestUrlResponse>;
/**
 * @deprecated Use requestToCouchDBWithCredentials instead.
 */
export declare const requestToCouchDB: (baseUri: string, username: string, password: string, origin?: string, key?: string, body?: string, method?: string, customHeaders?: Record<string, string>) => Promise<import("obsidian").RequestUrlResponse>;
export declare function requestToCouchDBWithCredentials(baseUri: string, credentials: CouchDBCredentials, origin?: string, key?: string, body?: string, method?: string, customHeaders?: Record<string, string>): Promise<import("obsidian").RequestUrlResponse>;
import { BASE_IS_NEW, EVEN, TARGET_IS_NEW } from "@lib/common/models/shared.const.symbols.ts";
export { BASE_IS_NEW, EVEN, TARGET_IS_NEW };
import { compareMTime } from "@lib/common/utils.ts";
export { compareMTime };
export declare function markChangesAreSame(file: AnyEntry | string | UXFileInfoStub, mtime1: number, mtime2: number): true | undefined;
export declare function unmarkChanges(file: AnyEntry | string | UXFileInfoStub): void;
export declare function isMarkedAsSameChanges(file: UXFileInfoStub | AnyEntry | string, mtimes: number[]): typeof EVEN | undefined;
export declare function compareFileFreshness(baseFile: UXFileInfoStub | AnyEntry | undefined, checkTarget: UXFileInfo | AnyEntry | undefined): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN;
export type MemoOption = {
    key: string;
    forceUpdate?: boolean;
    validator?: (context: Map<string, unknown>) => boolean;
};
export declare function useMemo<T>({ key, forceUpdate, validator }: MemoOption, updateFunc: (context: Map<string, unknown>, prev: T) => T): T;
export declare function useStatic<T>(key: string): {
    value: T | undefined;
};
export declare function useStatic<T>(key: string, initial: T): {
    value: T;
};
export declare function disposeMemo(key: string): void;
export declare function disposeAllMemo(): void;
export declare function getLogLevel(showNotice: boolean): 32 | 64;
export type MapLike<K, V> = {
    set(key: K, value: V): Map<K, V>;
    clear(): void;
    delete(key: K): boolean;
    get(key: K): V | undefined;
    has(key: K): boolean;
    keys: () => IterableIterator<K>;
    get size(): number;
};
export declare function autosaveCache<K, V>(db: KeyValueDatabase, mapKey: string): Promise<MapLike<K, V>>;
export declare function onlyInNTimes(n: number, proc: (progress: number) => unknown): () => void;
export { displayRev } from "@lib/common/utils.ts";
