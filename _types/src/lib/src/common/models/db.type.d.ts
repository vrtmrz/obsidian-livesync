// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { TaggedType } from "octagonal-wheels/common/types";
import type { EntryTypes, SYNCINFO_ID } from "./db.const";
export type FilePath = TaggedType<string, "FilePath">;
export type FilePathWithPrefixLC = TaggedType<string, "FilePathWithPrefixLC">;
export type FilePathWithPrefix = TaggedType<string, "FilePathWithPrefix"> | FilePath | FilePathWithPrefixLC;
export type DocumentID = TaggedType<string, "documentId">;
export type EntryType = (typeof EntryTypes)[keyof typeof EntryTypes];
export type EntryTypes = typeof EntryTypes;
export type EntryTypeNotes = EntryTypes["NOTE_BINARY"] | EntryTypes["NOTE_PLAIN"];
export type EntryTypeNotesWithLegacy = EntryTypeNotes | EntryTypes["NOTE_LEGACY"];
/**
 * Represents an entry in the database.
 */
export interface DatabaseEntry {
    /**
     * The ID of the document.
     */
    _id: DocumentID;
    /**
     * The revision of the document.
     */
    _rev?: string;
    /**
     * Deleted flag.
     */
    _deleted?: boolean;
    /**
     * Conflicts (if exists).
     */
    _conflicts?: string[];
}
/**
 * Represents the base structure for an entry that represents a file.
 */
export type EntryBase = {
    /**
     * The creation time of the file.
     */
    ctime: number;
    /**
     * The modification time of the file.
     */
    mtime: number;
    /**
     * The size of the file.
     */
    size: number;
    /**
     * Deleted flag.
     */
    deleted?: boolean;
};
export type EdenChunk = {
    data: string;
    epoch: number;
};
export type EntryWithEden = {
    eden: Record<DocumentID, EdenChunk>;
};
export type NoteEntry = DatabaseEntry & EntryBase & EntryWithEden & {
    /**
     * The path of the file.
     */
    path: FilePathWithPrefix;
    /**
     * Contents of the file.
     */
    data: string | string[];
    /**
     * The type of the entry.
     */
    type: EntryTypes["NOTE_LEGACY"];
};
export type NewEntry = DatabaseEntry & EntryBase & EntryWithEden & {
    /**
     * The path of the file.
     */
    path: FilePathWithPrefix;
    /**
     * Chunk IDs indicating the contents of the file.
     */
    children: string[];
    /**
     * The type of the entry.
     */
    type: EntryTypes["NOTE_BINARY"];
};
export type PlainEntry = DatabaseEntry & EntryBase & EntryWithEden & {
    /**
     * The path of the file.
     */
    path: FilePathWithPrefix;
    /**
     * Chunk IDs indicating the contents of the file.
     */
    children: string[];
    /**
     * The type of the entry.
     */
    type: EntryTypes["NOTE_PLAIN"];
};
export type InternalFileEntry = DatabaseEntry & NewEntry & EntryBase & {
    deleted?: boolean;
};
export type AnyEntry = NoteEntry | NewEntry | PlainEntry | InternalFileEntry;
export type LoadedEntry = AnyEntry & {
    data: string | string[];
    datatype: EntryTypeNotes;
};
export type SavingEntry = AnyEntry & {
    data: Blob;
    datatype: EntryTypeNotes;
};
export type MetaEntry = AnyEntry & {
    children: string[];
};
export type EntryLeaf = DatabaseEntry & {
    type: EntryTypes["CHUNK"];
    data: string;
    isCorrupted?: boolean;
};
export type EntryChunkPack = DatabaseEntry & {
    type: EntryTypes["CHUNK_PACK"];
    data: string;
};
export interface EntryVersionInfo extends DatabaseEntry {
    type: EntryTypes["VERSION_INFO"];
    version: number;
}
export interface EntryHasPath {
    path: FilePathWithPrefix | FilePath;
}
export interface ChunkVersionRange {
    min: number;
    max: number;
    current: number;
}
export interface SyncInfo extends DatabaseEntry {
    _id: typeof SYNCINFO_ID;
    type: EntryTypes["SYNC_INFO"];
    data: string;
}
