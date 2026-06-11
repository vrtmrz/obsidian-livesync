import type { SavingEntry, DocumentID, FilePath, FilePathWithPrefix, LoadedEntry, MetaEntry, NoteEntry } from "@lib/common/models/db.type";
import type { EntryDoc } from "@lib/common/models/db.definition";
import type { ObsidianLiveSyncSettings } from "@lib/common/models/setting.type";
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
export declare function isLegacyNote(meta: LoadedEntry | MetaEntry): meta is NoteEntry & import("@lib/common/models/db.type").EntryWithBody & {
    datatype: import("@lib/common/models/db.type").EntryTypeNotes;
};
export declare function canUseOnDemandChunking(settings: ObsidianLiveSyncSettings): boolean;
export declare function getDBEntryFromMeta(host: NecessaryServicesInterfaces<"path" | "setting", never>, { localDatabase, chunkManager }: NecessaryManagers<"localDatabase" | "chunkManager">, meta: LoadedEntry | MetaEntry, dump?: boolean, waitForReady?: boolean): Promise<false | (LoadedEntry & PouchDB.Core.IdMeta)>;
export declare function getDBEntryByPath(host: NecessaryServicesInterfaces<"path" | "setting", never>, managers: NecessaryManagers<"localDatabase" | "chunkManager">, path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions, dump?: boolean, waitForReady?: boolean, includeDeleted?: boolean): Promise<false | (LoadedEntry & PouchDB.Core.IdMeta)>;
export declare function deleteDBEntryByPath(host: NecessaryServicesInterfaces<"path" | "setting", never>, { localDatabase }: NecessaryManagers<"localDatabase">, path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions): Promise<boolean>;
export {};
