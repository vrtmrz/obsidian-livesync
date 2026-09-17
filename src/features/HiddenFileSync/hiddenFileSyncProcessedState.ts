import {
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type LoadedEntry,
    type LOG_LEVEL,
    type MetaEntry,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { KeyValueDatabase } from "@vrtmrz/livesync-commonlib/compat/interfaces/KeyValueDatabase";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { IPathService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { addPrefix } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

import { ICHeader } from "@/common/types.ts";
import { autosaveCache, type MapLike } from "@/common/utils.ts";
import {
    getHiddenFileSyncComparisonMTime,
    toHiddenFileSyncDatabaseStateKey,
    toHiddenFileSyncStorageStateKey,
} from "./hiddenFileSyncState.ts";

type HiddenFileSyncProcessedStateDatabase = Pick<LiveSyncLocalDB, "getDBEntryMeta">;
type HiddenFileSyncProcessedStateStorage = {
    statHidden(path: FilePath): Promise<UXStat | null>;
};

export type HiddenFileSyncProcessedStateDependencies = {
    getKeyValueDatabase(): KeyValueDatabase;
    getLocalDatabase(): HiddenFileSyncProcessedStateDatabase;
    storageAccess: HiddenFileSyncProcessedStateStorage;
    path: Pick<IPathService, "markChangesAreSame" | "unmarkChanges">;
    log: LogFunction;
};

export class HiddenFileSyncProcessedState {
    private fileInfoLastProcessed: MapLike<string, string> = new Map();
    private fileInfoLastKnown: MapLike<string, number> = new Map();
    private databaseInfoLastProcessed: MapLike<string, string> = new Map();

    constructor(private readonly dependencies: HiddenFileSyncProcessedStateDependencies) {}

    private log(message: unknown, level?: LOG_LEVEL, key?: string): void {
        this.dependencies.log(message, level, key);
    }

    async initialise(): Promise<void> {
        // Compatibility question: these reads intentionally remain
        // sequential and in this order.
        // Compatibility question: autosaveCache has no flush or disposal
        // boundary, so a delayed write from an earlier database lifecycle can
        // outlive this state owner. Preserve that timing until database
        // replacement and unload behaviour have focused coverage.
        this.fileInfoLastProcessed = await autosaveCache(
            this.dependencies.getKeyValueDatabase(),
            "hidden-file-lastProcessed"
        );
        this.databaseInfoLastProcessed = await autosaveCache(
            this.dependencies.getKeyValueDatabase(),
            "hidden-file-lastProcessed-database"
        );
        this.fileInfoLastKnown = await autosaveCache(this.dependencies.getKeyValueDatabase(), "hidden-file-lastKnown");
    }

    getLastProcessedFileCount(): number {
        return this.fileInfoLastProcessed.size;
    }

    getLastProcessedFileKeys(): IterableIterator<string> {
        return this.fileInfoLastProcessed.keys();
    }

    hasLastProcessedFile(file: FilePath): boolean {
        return this.fileInfoLastProcessed.has(file);
    }

    hasLastProcessedDatabase(file: FilePath): boolean {
        return this.databaseInfoLastProcessed.has(file);
    }

    async fileToStatKey(file: FilePath, stat: UXStat | null = null): Promise<string> {
        // Compatibility question: `null` means 'stat not supplied' here
        // rather than 'file missing', so a failed earlier stat causes another
        // read. Keep that retry until its event-processing effect is
        // characterised.
        if (!stat) stat = await this.dependencies.storageAccess.statHidden(file);
        return this.storageStateKey(stat);
    }

    storageStateKey(stat: UXStat | null): string {
        return toHiddenFileSyncStorageStateKey(stat);
    }

    databaseStateKey(doc: MetaEntry | LoadedEntry): string {
        return toHiddenFileSyncDatabaseStateKey(doc);
    }

    updateLastProcessedFile(file: FilePath, keySrc: string | UXStat): void {
        const key = typeof keySrc == "string" ? keySrc : this.storageStateKey(keySrc);
        const splitted = key.split("-");
        if (splitted[0] != "0") {
            // Compatibility: a zero storage marker does not replace the last
            // known non-zero mtime. Deletion therefore retains that fallback.
            this.fileInfoLastKnown.set(file, Number(splitted[0]));
        }
        this.fileInfoLastProcessed.set(file, key);
    }

    async updateLastProcessedAsActualFile(file: FilePath, stat?: UXStat | null): Promise<void> {
        if (!stat) stat = await this.dependencies.storageAccess.statHidden(file);
        // Compatibility: adoption updates only the processed marker. It does
        // not update the last-known non-zero mtime cache.
        this.fileInfoLastProcessed.set(file, this.storageStateKey(stat));
    }

    resetLastProcessedFile(targetFiles: FilePath[] | false): void {
        if (targetFiles) {
            for (const key of targetFiles) {
                this.fileInfoLastProcessed.delete(key);
            }
        } else {
            this.log(`Delete all processed mark.`, LOG_LEVEL_VERBOSE);
            // THINKING: Should we...
            // - delete all `Known file` processed mark? (This is current implementation)
            // - delete all `Existing file` processed mark?
            // - delete all files inside the config folder of current device mark?
            this.fileInfoLastProcessed.clear();
        }
    }

    getLastProcessedFileMTime(file: FilePath): number {
        const key = this.fileInfoLastKnown.get(file);
        if (!key) return 0;
        return key;
    }

    getLastProcessedFileKey(file: FilePath): string | undefined {
        return this.fileInfoLastProcessed.get(file);
    }

    getLastProcessedDatabaseKey(file: FilePath): string | undefined {
        return this.databaseInfoLastProcessed.get(file);
    }

    updateLastProcessedDatabase(file: FilePath, keySrc: string | MetaEntry | LoadedEntry): void {
        const key = typeof keySrc == "string" ? keySrc : this.databaseStateKey(keySrc);
        this.databaseInfoLastProcessed.set(file, key);
    }

    updateLastProcessed(path: FilePath, db: MetaEntry | LoadedEntry, stat: UXStat): void {
        this.updateLastProcessedDatabase(path, db);
        this.updateLastProcessedFile(path, this.storageStateKey(stat));
        const dbMTime = getHiddenFileSyncComparisonMTime(db);
        const storageMTime = getHiddenFileSyncComparisonMTime(stat);
        if (dbMTime == 0 || storageMTime == 0) {
            this.dependencies.path.unmarkChanges(path);
        } else {
            this.dependencies.path.markChangesAreSame(
                path,
                getHiddenFileSyncComparisonMTime(db),
                getHiddenFileSyncComparisonMTime(stat)
            );
        }
    }

    updateLastProcessedDeletion(path: FilePath, db: MetaEntry | LoadedEntry | false): void {
        this.dependencies.path.unmarkChanges(path);
        if (db) this.updateLastProcessedDatabase(path, db);
        this.updateLastProcessedFile(path, this.storageStateKey(null));
    }

    async updateLastProcessedAsActualDatabase(
        file: FilePath,
        doc?: MetaEntry | LoadedEntry | null | false
    ): Promise<void> {
        const dbPath = addPrefix(file, ICHeader);
        if (!doc) doc = await this.dependencies.getLocalDatabase().getDBEntryMeta(dbPath);
        if (!doc) return;
        this.databaseInfoLastProcessed.set(file, this.databaseStateKey(doc));
    }

    resetLastProcessedDatabase(targetFiles: FilePath[] | false): void {
        if (targetFiles) {
            for (const key of targetFiles) {
                this.databaseInfoLastProcessed.delete(key);
            }
        } else {
            this.log(`Delete all processed mark.`, LOG_LEVEL_VERBOSE);
            // THINKING: Should we...
            // - delete all `Known file` processed mark? (This is current implementation)
            // - delete all `Existing file` processed mark?
            // - delete all files inside the config folder of current device mark?
            this.databaseInfoLastProcessed.clear();
        }
    }
}

export function createHiddenFileSyncProcessedState(
    dependencies: HiddenFileSyncProcessedStateDependencies
): HiddenFileSyncProcessedState {
    return new HiddenFileSyncProcessedState(dependencies);
}
