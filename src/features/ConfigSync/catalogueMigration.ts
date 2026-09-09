import { createBlob, getDocDataAsArray } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type {
    AnyEntry,
    FilePathWithPrefix,
    LOG_LEVEL,
    SavingEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { IPathService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

import { ICXHeader } from "@/common/types.ts";
import type { SnapshotPersistence } from "./snapshotPersistence.ts";
import type { CustomisationSyncReadCodec } from "./customisationSyncReadOperations.ts";

type CatalogueMigrationDatabase = Pick<LiveSyncLocalDB, "getDBEntry" | "putDBEntry">;

type CatalogueMigrationCodec = Pick<CustomisationSyncReadCodec, "deserialize"> & {
    dummyHead: string;
    dummyEnd: string;
};

export type CatalogueMigrationDependencies = {
    getLocalDatabase(): CatalogueMigrationDatabase;
    path: Pick<IPathService, "path2id">;
    log: LogFunction;
    snapshotPersistence: Pick<SnapshotPersistence, "deleteConfigOnDatabase">;
    refreshV1(showMessage: boolean, path: FilePathWithPrefix): Promise<void>;
    codec: CatalogueMigrationCodec;
};

/** Bridges persisted V1 binders into the V2 per-file document format. */
export class CatalogueMigration {
    constructor(private readonly dependencies: CatalogueMigrationDependencies) {}

    private _log(message: unknown, level?: LOG_LEVEL, key?: string): void {
        this.dependencies.log(message, level, key);
    }

    async migrateV1ToV2(showMessage: boolean, entry: AnyEntry): Promise<void> {
        const v1Path = entry.path;
        this._log(`Migrating ${entry.path} to V2`, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        if (entry.deleted) {
            this._log(`The entry ${v1Path} is already deleted`, LOG_LEVEL_VERBOSE);
            return;
        }
        // Compatibility question: the inherited conjunction admits any `ix:`
        // path or any `.md` path, although the log describes a stricter binder
        // check. Preserve it until malformed migration candidates are covered.
        if (!v1Path.endsWith(".md") && !v1Path.startsWith(ICXHeader)) {
            this._log(`The entry ${v1Path} is not a customisation sync binder`, LOG_LEVEL_VERBOSE);
            return;
        }
        if (v1Path.indexOf("%") !== -1) {
            this._log(`The entry ${v1Path} is already migrated`, LOG_LEVEL_VERBOSE);
            return;
        }
        const loadedEntry = await this.dependencies.getLocalDatabase().getDBEntry(v1Path);
        if (!loadedEntry) {
            this._log(`The entry ${v1Path} is not found`, LOG_LEVEL_VERBOSE);
            return;
        }

        const pluginData = this.dependencies.codec.deserialize(getDocDataAsArray(loadedEntry.data), {}) as {
            category: string;
            files: Array<{ filename: string; data: string[] }>;
        };
        const prefixPath = v1Path.slice(0, -".md".length) + "%";
        const category = pluginData.category;

        for (const f of pluginData.files) {
            const stripTable: Record<string, number> = {
                CONFIG: 0,
                THEME: 2,
                SNIPPET: 1,
                PLUGIN_MAIN: 2,
                PLUGIN_DATA: 2,
                PLUGIN_ETC: 2,
            };
            const deletePrefixCount = stripTable?.[category] ?? 1;
            const relativeFilename = f.filename.split("/").slice(deletePrefixCount).join("/");
            const v2Path = (prefixPath + relativeFilename) as FilePathWithPrefix;
            this._log(`Migrating ${v1Path} / ${relativeFilename} to ${v2Path}`, LOG_LEVEL_VERBOSE);
            const newId = await this.dependencies.path.path2id(v2Path);

            const data = createBlob([
                this.dependencies.codec.dummyHead,
                this.dependencies.codec.dummyEnd,
                ...getDocDataAsArray(f.data),
            ]);
            const saving: SavingEntry = {
                ...loadedEntry,
                _rev: undefined,
                _id: newId,
                path: v2Path,
                data,
                datatype: "plain",
                type: "plain",
                children: [],
                eden: {},
            };
            const result = await this.dependencies.getLocalDatabase().putDBEntry(saving);
            if (result && result.ok) {
                this._log(`Migrated ${v1Path} / ${f.filename} to ${v2Path}`, LOG_LEVEL_INFO);
                const deletion = await this.dependencies.snapshotPersistence.deleteConfigOnDatabase(v1Path);
                const deleted = deletion.value;
                if (deleted) {
                    this._log(`Deleted ${v1Path} successfully`, LOG_LEVEL_INFO);
                } else {
                    this._log(`Failed to delete ${v1Path}`, LOG_LEVEL_NOTICE);
                }
                // Compatibility: the inherited migration called the context
                // deletion wrapper, which awaited its V1 catalogue refresh.
                // Apply that refresh explicitly now that deletion is a host-
                // neutral persistence operation, and only when deletion emitted
                // the same mutation outcome.
                for (const refresh of deletion.refreshes) {
                    if (refresh.mode == "v1" && refresh.timing == "await") {
                        await this.dependencies.refreshV1(false, refresh.path);
                    }
                }
            }
        }
    }
}
