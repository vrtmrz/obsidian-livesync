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
export interface EntryBase {
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
}
export type EdenChunk = {
    data: string;
    epoch: number;
};
export type EntryWithEden = {
    eden: Record<DocumentID, EdenChunk>;
};
/**
 * Represents the common fields for all database entries representing physical files.
 */
export interface FileEntryBase extends DatabaseEntry, EntryBase, EntryWithEden {
    /**
     * The path of the file.
     */
    path: FilePathWithPrefix;
}
/**
 * Represents an entry that contains children (chunk IDs).
 */
export interface EntryWithChildren {
    /**
     * Chunk IDs indicating the contents of the file.
     */
    children: string[];
}
/**
 * Represents an entry that contains content data.
 */
export interface EntryWithData<T = string | string[] | Blob> {
    /**
     * Contents / payload of the entry.
     */
    data: T;
}
/**
 * Represents an entry that contains document body text.
 */
export type EntryWithBody = EntryWithData<string | string[]>;
/**
 * Represents an entry that contains a binary Blob.
 */
export type EntryWithBlob = EntryWithData<Blob>;
/**
 * Represents a legacy note entry where file content is stored directly in the metadata.
 */
export interface NoteEntry extends FileEntryBase, EntryWithBody {
    /**
     * The type of the entry.
     */
    type: EntryTypes["NOTE_LEGACY"];
}
/**
 * Represents a chunk-split binary file entry.
 */
export interface NewEntry extends FileEntryBase, EntryWithChildren {
    /**
     * The type of the entry.
     */
    type: EntryTypes["NOTE_BINARY"];
}
/**
 * Represents a chunk-split plain text file entry.
 */
export interface PlainEntry extends FileEntryBase, EntryWithChildren {
    /**
     * The type of the entry.
     */
    type: EntryTypes["NOTE_PLAIN"];
}
/**
 * Represents a customization / configuration file entry.
 * @deprecated Use NewEntry or PlainEntry directly.
 */
export type InternalFileEntry = NewEntry;
/**
 * Represents any file-related database entry.
 */
export type AnyEntry = NoteEntry | NewEntry | PlainEntry;
/**
 * Represents a file entry after its contents have been loaded and assembled.
 */
export type LoadedEntry = AnyEntry & EntryWithBody & {
    datatype: EntryTypeNotes;
};
/**
 * Represents a file entry prepared for saving.
 */
export type SavingEntry = AnyEntry & EntryWithBlob & {
    datatype: EntryTypeNotes;
};
/**
 * Represents a metadata entry (chunked file entry) without full content.
 */
export type MetaEntry = NewEntry | PlainEntry;
/**
 * Represents a leaf (chunk) document in the database.
 */
export interface EntryLeaf extends DatabaseEntry, EntryWithData<string> {
    type: EntryTypes["CHUNK"];
    isCorrupted?: boolean;
}
/**
 * Represents a chunk pack document.
 */
export interface EntryChunkPack extends DatabaseEntry, EntryWithData<string> {
    type: EntryTypes["CHUNK_PACK"];
}
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
export interface SyncInfo extends DatabaseEntry, EntryWithData<string> {
    _id: typeof SYNCINFO_ID;
    type: EntryTypes["SYNC_INFO"];
}
