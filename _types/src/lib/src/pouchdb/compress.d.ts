// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import * as fflate from "fflate";
import type { EntryDoc } from "@lib/common/types";
export declare function _compressText(text: string): Promise<string>;
export declare const wrappedInflate: (data: Uint8Array, opts: fflate.AsyncInflateOptions) => Promise<Uint8Array>;
export declare const wrappedDeflate: (data: Uint8Array, opts: fflate.AsyncDeflateOptions) => Promise<Uint8Array>;
export declare function _decompressText(compressed: string, _useUTF16?: boolean): Promise<string>;
export declare function compressDoc(doc: EntryDoc): Promise<import("@lib/common/types").NoteEntry | import("@lib/common/types").NewEntry | import("@lib/common/types").PlainEntry | import("@lib/common/types").EntryLeaf | import("@lib/common/types").EntryChunkPack | import("@lib/common/types").EntryVersionInfo | import("@lib/common/types").EntryMilestoneInfo | import("@lib/common/types").EntryNodeInfo>;
export declare function decompressDoc(doc: EntryDoc): Promise<import("@lib/common/types").NoteEntry | import("@lib/common/types").NewEntry | import("@lib/common/types").PlainEntry | import("@lib/common/types").EntryLeaf | import("@lib/common/types").EntryChunkPack | import("@lib/common/types").EntryVersionInfo | import("@lib/common/types").EntryMilestoneInfo | import("@lib/common/types").EntryNodeInfo>;
export declare function wrapFflateFunc<T, U>(func: (data: T, opts: U, cb: fflate.FlateCallback) => unknown): (data: T, opts: U) => Promise<Uint8Array>;
export declare const replicationFilter: (db: PouchDB.Database<EntryDoc>, compress: boolean) => void;
export declare const MARK_SHIFT_COMPRESSED = "\u000ELZ\u001D";
