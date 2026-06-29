// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { DocumentID } from "./db.type";
export declare const VERSIONING_DOCID: DocumentID;
export declare const MILESTONE_DOCID: DocumentID;
export declare const NODEINFO_DOCID: DocumentID;
export declare const SYNCINFO_ID: DocumentID;
export declare const EntryTypes: {
    readonly NOTE_LEGACY: "notes";
    readonly NOTE_BINARY: "newnote";
    readonly NOTE_PLAIN: "plain";
    readonly INTERNAL_FILE: "internalfile";
    readonly CHUNK: "leaf";
    readonly CHUNK_PACK: "chunkpack";
    readonly VERSION_INFO: "versioninfo";
    readonly SYNC_INFO: "syncinfo";
    readonly SYNC_PARAMETERS: "sync-parameters";
    readonly MILESTONE_INFO: "milestoneinfo";
    readonly NODE_INFO: "nodeinfo";
};
export declare const NoteTypes: ("notes" | "newnote" | "plain")[];
export declare const ChunkTypes: ("leaf" | "chunkpack")[];
