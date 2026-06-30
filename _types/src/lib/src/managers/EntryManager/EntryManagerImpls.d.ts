// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type SavingEntry, type DocumentID, type EntryDoc, type EntryBase, type FilePath, type FilePathWithPrefix, type LoadedEntry, type ObsidianLiveSyncSettings, type MetaEntry } from "@lib/common/types";
import type { ContentSplitter } from "@lib/ContentSplitter/ContentSplitters";
import type { HashManager } from "@lib/managers/HashManager/HashManager";
import type { LayeredChunkManager as ChunkManager } from "@lib/managers/LayeredChunkManager";
import type { NecessaryServicesInterfaces } from "@lib/interfaces/ServiceModule";
import type { GeneratedChunk } from "@lib/pouchdb/LiveSyncLocalDB";
type Managers = {
    hashManager: HashManager;
    chunkManager: ChunkManager;
    splitter: ContentSplitter;
    localDatabase: PouchDB.Database<EntryDoc>;
};
type NecessaryManagers<T extends keyof Managers> = Pick<Managers, T>;
export declare function createChunks(managers: NecessaryManagers<"chunkManager" | "hashManager" | "splitter">, dispFilename: string, note: SavingEntry): Promise<false | DocumentID[]>;
export declare function putDBEntry(host: NecessaryServicesInterfaces<"path" | "setting", never>, managers: NecessaryManagers<"localDatabase" | "chunkManager" | "hashManager" | "splitter">, note: SavingEntry, onlyChunks?: boolean, conflictBaseRev?: string): Promise<false | PouchDB.Core.Response>;
export declare function isTargetFile(host: NecessaryServicesInterfaces<"setting", never>, filenameSrc: string): boolean;
export declare function prepareChunk({ chunkManager, hashManager }: NecessaryManagers<"chunkManager" | "hashManager">, piece: string): Promise<GeneratedChunk>;
export declare function getDBEntryMetaByPath(host: NecessaryServicesInterfaces<"path" | "setting", never>, { localDatabase }: NecessaryManagers<"localDatabase">, path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions, includeDeleted?: boolean): Promise<false | LoadedEntry>;
export declare function isLegacyNote(meta: LoadedEntry | MetaEntry): meta is (import("@lib/common/types").DatabaseEntry & EntryBase & import("@lib/common/types").EntryWithEden & {
    path: FilePathWithPrefix;
    data: string | string[];
    type: import("../../common/models/db.type").EntryTypes["NOTE_LEGACY"];
} & {
    data: string | string[];
    datatype: import("@lib/common/types").EntryTypeNotes;
}) | (import("@lib/common/types").DatabaseEntry & EntryBase & import("@lib/common/types").EntryWithEden & {
    path: FilePathWithPrefix;
    data: string | string[];
    type: import("../../common/models/db.type").EntryTypes["NOTE_LEGACY"];
} & {
    children: string[];
});
export declare function canUseOnDemandChunking(settings: ObsidianLiveSyncSettings): boolean;
export declare function getDBEntryFromMeta(host: NecessaryServicesInterfaces<"path" | "setting", never>, { localDatabase, chunkManager }: NecessaryManagers<"localDatabase" | "chunkManager">, meta: LoadedEntry | MetaEntry, dump?: boolean, waitForReady?: boolean): Promise<false | (import("@lib/common/types").DatabaseEntry & EntryBase & import("@lib/common/types").EntryWithEden & {
    path: FilePathWithPrefix;
    data: string | string[];
    type: import("../../common/models/db.type").EntryTypes["NOTE_LEGACY"];
} & {
    data: string | string[];
    datatype: import("@lib/common/types").EntryTypeNotes;
} & PouchDB.Core.IdMeta) | (import("@lib/common/types").DatabaseEntry & EntryBase & import("@lib/common/types").EntryWithEden & {
    path: FilePathWithPrefix;
    children: string[];
    type: import("../../common/models/db.type").EntryTypes["NOTE_BINARY"];
} & {
    data: string | string[];
    datatype: import("@lib/common/types").EntryTypeNotes;
} & PouchDB.Core.IdMeta) | (import("@lib/common/types").DatabaseEntry & EntryBase & import("@lib/common/types").EntryWithEden & {
    path: FilePathWithPrefix;
    children: string[];
    type: import("../../common/models/db.type").EntryTypes["NOTE_PLAIN"];
} & {
    data: string | string[];
    datatype: import("@lib/common/types").EntryTypeNotes;
} & PouchDB.Core.IdMeta)>;
export declare function getDBEntryByPath(host: NecessaryServicesInterfaces<"path" | "setting", never>, managers: NecessaryManagers<"localDatabase" | "chunkManager">, path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions, dump?: boolean, waitForReady?: boolean, includeDeleted?: boolean): Promise<false | (import("@lib/common/types").DatabaseEntry & EntryBase & import("@lib/common/types").EntryWithEden & {
    path: FilePathWithPrefix;
    data: string | string[];
    type: import("../../common/models/db.type").EntryTypes["NOTE_LEGACY"];
} & {
    data: string | string[];
    datatype: import("@lib/common/types").EntryTypeNotes;
} & PouchDB.Core.IdMeta) | (import("@lib/common/types").DatabaseEntry & EntryBase & import("@lib/common/types").EntryWithEden & {
    path: FilePathWithPrefix;
    children: string[];
    type: import("../../common/models/db.type").EntryTypes["NOTE_BINARY"];
} & {
    data: string | string[];
    datatype: import("@lib/common/types").EntryTypeNotes;
} & PouchDB.Core.IdMeta) | (import("@lib/common/types").DatabaseEntry & EntryBase & import("@lib/common/types").EntryWithEden & {
    path: FilePathWithPrefix;
    children: string[];
    type: import("../../common/models/db.type").EntryTypes["NOTE_PLAIN"];
} & {
    data: string | string[];
    datatype: import("@lib/common/types").EntryTypeNotes;
} & PouchDB.Core.IdMeta)>;
export declare function deleteDBEntryByPath(host: NecessaryServicesInterfaces<"path" | "setting", never>, { localDatabase }: NecessaryManagers<"localDatabase">, path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions): Promise<boolean>;
export {};
