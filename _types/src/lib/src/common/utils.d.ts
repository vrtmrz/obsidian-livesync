// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type AnyEntry, type DatabaseEntry, type EntryLeaf, type SyncInfo, type LoadedEntry, type SavingEntry, type NewEntry, type PlainEntry, type CustomRegExpSource, type ParsedCustomRegExp, type CustomRegExpSourceList, type ObsidianLiveSyncSettings, type RemoteDBSettings, type P2PConnectionInfo, type BucketSyncSetting, type CouchDBConnection, type EncryptionSettings } from "./types.ts";
import { replaceAll, replaceAllPairs } from "octagonal-wheels/string";
export { replaceAll, replaceAllPairs };
import { concatUInt8Array } from "octagonal-wheels/binary";
export { concatUInt8Array };
import { delay, fireAndForget } from "octagonal-wheels/promises";
export { delay, fireAndForget };
import { arrayToChunkedArray, unique } from "octagonal-wheels/collection";
export { arrayToChunkedArray, unique };
import { extractObject, isObjectDifferent } from "octagonal-wheels/object";
export { extractObject, isObjectDifferent };
import { sendValue, sendSignal, waitForSignal, waitForValue } from "octagonal-wheels/messagepassing/signal";
export { sendValue, sendSignal, waitForSignal, waitForValue };
import { throttle } from "octagonal-wheels/function";
export { throttle };
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import { BASE_IS_NEW, EVEN, TARGET_IS_NEW } from "./models/shared.const.symbols.ts";
export type { SimpleStore };
export { sizeToHumanReadable } from "octagonal-wheels/number";
export declare function resolveWithIgnoreKnownError<T>(p: Promise<T>, def: T): Promise<T>;
export declare const Parallels: (ps?: Set<Promise<unknown>>) => {
    add: (p: Promise<unknown>) => Set<Promise<unknown>>;
    wait: (limit: number) => false | Promise<unknown>;
    all: () => Promise<unknown[]>;
};
export declare function allSettledWithConcurrencyLimit<T>(processes: Promise<T>[], limit: number): Promise<void>;
export declare function getDocData(doc: string | string[]): string;
export declare function getDocDataAsArray(doc: string | string[]): string[];
export declare function getDocDataAsArrayBuffer(doc: string | string[] | ArrayBuffer): Uint8Array;
export declare function isTextBlob(blob: Blob): boolean;
export declare function createTextBlob(data: string | string[]): Blob;
export declare function createBinaryBlob(data: Uint8Array | ArrayBuffer): Blob;
export declare function createBlob(data: string | string[] | Uint8Array | ArrayBuffer | Blob): Blob;
export declare function isTextDocument(doc: LoadedEntry): boolean;
export declare function readAsBlob(doc: LoadedEntry): Blob;
export declare function readContent(doc: LoadedEntry): string | ArrayBuffer;
export declare function isDocContentSame(docA: string | string[] | Blob | ArrayBuffer, docB: string | string[] | Blob | ArrayBuffer): Promise<boolean>;
export declare function isObfuscatedEntry(doc: DatabaseEntry): doc is AnyEntry;
export declare function isEncryptedChunkEntry(doc: DatabaseEntry): doc is EntryLeaf;
export declare function isSyncInfoEntry(doc: DatabaseEntry): doc is SyncInfo;
export declare function memorizeFuncWithLRUCache<T, U>(func: (key: T) => U): (key: T) => U | undefined;
export declare function memorizeFuncWithLRUCacheMulti<T extends unknown[], U>(func: (...keys: T) => U): (keys: T) => U | undefined;
/**
 *
 * @param exclusion return only not exclusion
 * @returns
 *
 * ["something",false,"aaaaa"].filter(onlyNot(false)) => yields ["something","aaaaaa"]. but, as string[].
 */
export declare function onlyNot<A, B>(exclusion: B): (item: A | B) => item is Exclude<A, B>;
/**
 * Run task with keeping minimum interval
 * @param key waiting key
 * @param interval interval (ms)
 * @param task task to perform.
 * @returns result of task
 * @remarks This function is not designed to be concurrent.
 */
export declare function runWithInterval<T>(key: string, interval: number, task: () => Promise<T>): Promise<T>;
/**
 * Run task with keeping minimum interval on start
 * @param key waiting key
 * @param interval interval (ms)
 * @param task task to perform.
 * @returns result of task
 * @remarks This function is not designed to be concurrent.
 */
export declare function runWithStartInterval<T>(key: string, interval: number, task: () => Promise<T>): Promise<T>;
export declare const globalConcurrencyController: import("octagonal-wheels/concurrency/semaphore_v2").SemaphoreObject;
export declare function determineTypeFromBlob(data: Blob): "newnote" | "plain";
export declare function determineType(path: string, data: string | string[] | Uint8Array | ArrayBuffer | Blob): "newnote" | "plain";
export declare function isAnyNote(doc: DatabaseEntry): doc is NewEntry | PlainEntry;
export declare function isLoadedEntry(doc: DatabaseEntry): doc is LoadedEntry;
export declare function isDeletedEntry(doc: LoadedEntry): boolean;
export declare function createSavingEntryFromLoadedEntry(doc: LoadedEntry): SavingEntry;
export declare function setAllItems<T>(set: Set<T>, items: T[]): Set<T>;
export declare function escapeNewLineFromString(str: string): string;
export declare function unescapeNewLineFromString(str: string): string;
export declare function escapeMarkdownValue<T>(value: T): T;
export declare function timeDeltaToHumanReadable(delta: number): string;
export declare function wrapException<T>(func: () => Promise<Awaited<T>>): Promise<Awaited<T> | Error>;
export declare function toRanges(sorted: number[]): string;
export declare function isDirty(key: string, value: unknown): boolean;
export declare function tryParseJSON<T extends object>(str: string, fallbackValue?: T): T | undefined;
export { mergeObject, applyPatch, generatePatchObj, flattenObject, isObjectMargeApplicable, isSensibleMargeApplicable, } from "./utils.patch.ts";
export declare function parseHeaderValues(strHeader: string): Record<string, string>;
/***
 * Parse custom regular expression
 * @param regexp
 * @returns [negate: boolean, regexp: string]
 * @example `!!foo` => [true, "foo"]
 * @example `foo` => [false, "foo"]
 */
export declare function parseCustomRegExp(regexp: CustomRegExpSource): ParsedCustomRegExp;
export declare function matchRegExp(regexp: CustomRegExpSource, target: string): boolean;
export declare function isValidRegExp(regexp: CustomRegExpSource): boolean;
export declare function isInvertedRegExp(regexp: CustomRegExpSource): boolean;
export declare function constructCustomRegExpList<D extends string>(items: CustomRegExpSource[], delimiter: D): CustomRegExpSourceList<D>;
export declare function splitCustomRegExpList<D extends string>(list: CustomRegExpSourceList<D>, delimiter: D): CustomRegExpSource[];
export declare class CustomRegExp {
    regexp: RegExp;
    negate: boolean;
    pattern: string;
    constructor(regexp: CustomRegExpSource, flags?: string);
    test(str: string): boolean;
}
type RegExpSettingKey = "syncOnlyRegEx" | "syncIgnoreRegEx" | "syncInternalFilesIgnorePatterns" | "syncInternalFilesTargetPatterns" | "syncInternalFileOverwritePatterns";
export declare function getFileRegExp(settings: ObsidianLiveSyncSettings | RemoteDBSettings, key: RegExpSettingKey): CustomRegExp[];
/**
 * Copies properties from the source object to the target object only if they exist in the target.
 * @param source The object to copy properties from.
 * @param target The object to copy properties to.
 */
export declare function copyTo<T extends object, U extends T>(source: U, target: T): void;
export declare function pickBucketSyncSettings(setting: ObsidianLiveSyncSettings): BucketSyncSetting;
export declare function pickCouchDBSyncSettings(setting: ObsidianLiveSyncSettings): CouchDBConnection;
export declare function pickEncryptionSettings(setting: ObsidianLiveSyncSettings | EncryptionSettings): EncryptionSettings;
export declare function pickP2PSyncSettings(setting: Partial<ObsidianLiveSyncSettings> & P2PConnectionInfo): P2PConnectionInfo;
export declare function wrapByDefault<T, U>(func: () => T, onError: (err: Error) => U): T | U;
export declare function compareMTime(baseMTime: number, targetMTime: number): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN;
export declare function displayRev(rev: string): string;
/**
 * Generate a random P2P Room ID in the format `123-456-789-abc`.
 */
export declare function generateP2PRoomId(): string;
/**
 * Extract the stable suffix (last segment) from a Room ID.
 */
export declare function extractP2PRoomSuffix(roomId: string): string;
