import { parseYaml } from "@/deps.ts";
import type {
    FilePath,
    FilePathWithPrefix,
    InternalFileEntry,
    LOG_LEVEL,
    SavingEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    createBlob,
    createTextBlob,
    getDocData,
    getDocDataAsArray,
    isDocContentSame,
} from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { EVEN } from "@vrtmrz/livesync-commonlib/compat/common/models/shared.const.symbols";
import { digestHash } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/hash";
import { arrayBufferToBase64 } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/convert";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { IPathService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { base64ToArrayBuffer } from "octagonal-wheels/binary/base64";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { LiveSyncError } from "@vrtmrz/livesync-commonlib/compat/common/LSError";

import { createCustomisationSyncCodec, type PluginDataEx } from "./customisationSyncCodec.ts";
import type { CustomisationSyncPathOperations } from "./customisationSyncPathOperations.ts";
import { readCustomisationFile } from "./customisationSyncReadOperations.ts";

const {
    serialize,
    deserialize,
    dummyHead: DUMMY_HEAD,
    dummyEnd: DUMMY_END,
} = createCustomisationSyncCodec({ digestHash, parseYaml });

type SnapshotPersistenceDatabase = Pick<
    LiveSyncLocalDB,
    "getDBEntryFromMeta" | "getDBEntryMeta" | "putDBEntry" | "putRaw"
>;

type SnapshotPersistenceStorage = Pick<StorageAccess, "readHiddenFileBinary" | "statHidden">;

type SnapshotPersistencePath = Pick<
    CustomisationSyncPathOperations,
    "getFileCategory" | "filenameToUnifiedKey" | "filenameWithUnifiedKey"
> &
    Pick<IPathService, "isMarkedAsSameChanges" | "markChangesAreSame" | "path2id">;

export type SnapshotPersistenceDependencies = {
    getLocalDatabase(): SnapshotPersistenceDatabase;
    storageAccess: SnapshotPersistenceStorage;
    path: SnapshotPersistencePath;
    log: LogFunction;
    getConfigDir(): string;
};

export type SnapshotRefresh = {
    mode: "v1" | "v2";
    timing: "await" | "fire-and-forget";
    path: FilePathWithPrefix;
};

export type SnapshotPersistenceStatus = "saved" | "skipped" | "missing" | "deleted" | "already-deleted" | "failed";

export type SnapshotPersistenceResult<Value> = {
    value: Value;
    status: SnapshotPersistenceStatus;
    refreshes: readonly SnapshotRefresh[];
};

type DatabaseSaveResult = Awaited<ReturnType<SnapshotPersistenceDatabase["putDBEntry"]>>;
type StoreResultValue = DatabaseSaveResult | true | undefined;

function result<Value>(
    value: Value,
    status: SnapshotPersistenceStatus,
    refreshes: readonly SnapshotRefresh[] = []
): SnapshotPersistenceResult<Value> {
    return { value, status, refreshes };
}

/**
 * Persists local Customisation Sync snapshots without owning catalogue state,
 * lifecycle, replication, or user-interface behaviour.
 */
export class SnapshotPersistence {
    private readonly dependencies: SnapshotPersistenceDependencies;

    constructor(dependencies: SnapshotPersistenceDependencies) {
        this.dependencies = dependencies;
    }

    private _log(message: unknown, level?: LOG_LEVEL, key?: string) {
        this.dependencies.log(message, level, key);
    }

    private async readFile(path: FilePath) {
        return await readCustomisationFile(
            {
                storageAccess: this.dependencies.storageAccess,
                log: this.dependencies.log,
            },
            path,
            this.dependencies.getConfigDir()
        );
    }

    // Compatibility question: the inherited force parameter is not read.
    // Preserve it until its intended write-bypass semantics are decided.
    async storeCustomisationFileV2(
        path: FilePath,
        term: string,
        force = false
    ): Promise<SnapshotPersistenceResult<StoreResultValue>> {
        void force;
        const vf = this.dependencies.path.filenameWithUnifiedKey(path, term);
        return await serialized(`plugin-${vf}`, async () => {
            const prefixedFileName = vf;

            const id = await this.dependencies.path.path2id(prefixedFileName);
            const stat = await this.dependencies.storageAccess.statHidden(path);
            if (!stat) {
                return result(false, "missing");
            }
            const mtime = stat.mtime;
            const content = await this.dependencies.storageAccess.readHiddenFileBinary(path);
            const contentBlob = createBlob([DUMMY_HEAD, DUMMY_END, ...(await arrayBufferToBase64(content))]);
            // const contentBlob = createBlob(content);
            try {
                const old = await this.dependencies
                    .getLocalDatabase()
                    .getDBEntryMeta(prefixedFileName, undefined, false);
                let saveData: SavingEntry;
                if (old === false) {
                    saveData = {
                        _id: id,
                        path: prefixedFileName,
                        data: contentBlob,
                        mtime,
                        ctime: mtime,
                        datatype: "plain",
                        size: contentBlob.size,
                        children: [],
                        deleted: false,
                        type: "plain",
                        eden: {},
                    };
                } else {
                    // Compatibility question: this inherited marker check
                    // precedes loading the old document and can suppress a
                    // content comparison. Preserve that event-suppression
                    // ordering until its scan contract is reviewed.
                    if (
                        this.dependencies.path.isMarkedAsSameChanges(prefixedFileName, [old.mtime, mtime + 1]) == EVEN
                    ) {
                        this._log(
                            `STORAGE --> DB:${prefixedFileName}: (config) Skipped (Already checked the same)`,
                            LOG_LEVEL_DEBUG
                        );
                        return result(undefined, "skipped");
                    }
                    const docXDoc = await this.dependencies.getLocalDatabase().getDBEntryFromMeta(old, false, false);
                    if (docXDoc == false) {
                        throw new LiveSyncError("Could not load the document");
                    }
                    const dataSrc = getDocData(docXDoc.data);
                    const dataStart = dataSrc.indexOf(DUMMY_END);
                    const oldContent = dataSrc.substring(dataStart + DUMMY_END.length);
                    const oldContentArray = base64ToArrayBuffer(oldContent);
                    if (await isDocContentSame(oldContentArray, content)) {
                        this._log(
                            `STORAGE --> DB:${prefixedFileName}: (config) Skipped (the same content)`,
                            LOG_LEVEL_VERBOSE
                        );
                        this.dependencies.path.markChangesAreSame(prefixedFileName, old.mtime, mtime + 1);
                        return result(true, "skipped");
                    }
                    saveData = {
                        ...old,
                        data: contentBlob,
                        mtime,
                        size: contentBlob.size,
                        datatype: "plain",
                        children: [],
                        deleted: false,
                        type: "plain",
                    };
                }
                const ret = await this.dependencies.getLocalDatabase().putDBEntry(saveData);
                this._log(`STORAGE --> DB:${prefixedFileName}: (config) Done`);
                // Compatibility question: the inherited refresh path omits the
                // explicit term override and therefore uses the current term.
                // Preserve that path until its cross-device semantics are reviewed.
                return result(ret, "saved", [
                    {
                        mode: "v2",
                        timing: "fire-and-forget",
                        path: this.dependencies.path.filenameWithUnifiedKey(path),
                    },
                ]);
            } catch (ex) {
                this._log(`STORAGE --> DB:${prefixedFileName}: (config) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return result(false, "failed");
            }
        });
    }

    async storeCustomizationFiles(path: FilePath, term: string): Promise<SnapshotPersistenceResult<StoreResultValue>> {
        const vf = this.dependencies.path.filenameToUnifiedKey(path, term);
        // console.warn(`Storing ${path} to ${bareVF} :--> ${keyedVF}`);

        return await serialized(`plugin-${vf}`, async () => {
            const category = this.dependencies.path.getFileCategory(path);
            let mtime = 0;
            let fileTargets = [] as FilePath[];
            // let savePath = "";
            const name =
                category == "CONFIG" || category == "SNIPPET"
                    ? path.split("/").reverse()[0]
                    : path.split("/").reverse()[1];
            const parentPath = path.split("/").slice(0, -1).join("/");
            const prefixedFileName = this.dependencies.path.filenameToUnifiedKey(path, term);
            const id = await this.dependencies.path.path2id(prefixedFileName);
            const dt: PluginDataEx = {
                category: category,
                files: [],
                name: name,
                mtime: 0,
                term: term,
            };
            // let scheduleKey = "";
            if (
                category == "CONFIG" ||
                category == "SNIPPET" ||
                category == "PLUGIN_ETC" ||
                category == "PLUGIN_DATA"
            ) {
                fileTargets = [path];
                if (category == "PLUGIN_ETC") {
                    dt.displayName = path.split("/").slice(-1).join("/");
                }
            } else if (category == "PLUGIN_MAIN") {
                fileTargets = ["manifest.json", "main.js", "styles.css"].map((e) => `${parentPath}/${e}` as FilePath);
            } else if (category == "THEME") {
                fileTargets = ["manifest.json", "theme.css"].map((e) => `${parentPath}/${e}` as FilePath);
            }
            for (const target of fileTargets) {
                const data = await this.readFile(target);
                if (data == false) {
                    this._log(`Config: skipped (Possibly is not exist): ${target} `, LOG_LEVEL_VERBOSE);
                    continue;
                }
                if (data.version) {
                    dt.version = data.version;
                }
                if (data.displayName) {
                    dt.displayName = data.displayName;
                }
                // Compatibility question: the inherited aggregation uses an
                // average rather than the newest member mtime. Preserve that
                // scan behaviour until its timestamp policy is reviewed.
                mtime = mtime == 0 ? data.mtime : (data.mtime + mtime) / 2;
                dt.files.push(data);
            }
            dt.mtime = mtime;

            // Compatibility question: the inherited empty-file path performs a
            // deletion refresh and then an unconditional explicit refresh. Keep
            // both outcomes, including the extra refresh when deletion succeeds.
            if (dt.files.length == 0) {
                this._log(`Nothing left: deleting.. ${path}`);
                const deletion = await this.deleteConfigOnDatabase(prefixedFileName);
                return result(undefined, deletion.status, [
                    ...deletion.refreshes,
                    { mode: "v1", timing: "await", path: prefixedFileName },
                ]);
            }

            const content = createTextBlob(serialize(dt));
            try {
                const old = await this.dependencies
                    .getLocalDatabase()
                    .getDBEntryMeta(prefixedFileName, undefined, false);
                let saveData: SavingEntry;
                if (old === false) {
                    saveData = {
                        _id: id,
                        path: prefixedFileName,
                        data: content,
                        mtime,
                        ctime: mtime,
                        datatype: "newnote",
                        size: content.size,
                        children: [],
                        deleted: false,
                        type: "newnote",
                        eden: {},
                    };
                } else {
                    if (old.mtime == mtime) {
                        // this._log(`STORAGE --> DB:${prefixedFileName}: (config) Skipped (Same time)`, LOG_LEVEL_VERBOSE);
                        return result(true, "skipped");
                    }
                    const oldC = await this.dependencies.getLocalDatabase().getDBEntryFromMeta(old, false, false);
                    if (oldC) {
                        const d = deserialize(getDocDataAsArray(oldC.data), {}) as PluginDataEx;
                        if (d.files.length == dt.files.length) {
                            // Compatibility question: the inherited comparison
                            // looks up each current file by the previous filename
                            // and compares a missing lookup as empty content.
                            // Preserve this rename/empty-file behaviour for now.
                            const diffs = d.files
                                .map((previous) => ({
                                    prev: previous,
                                    curr: dt.files.find((e) => e.filename == previous.filename),
                                }))
                                .map(async (e) => {
                                    try {
                                        return await isDocContentSame(e.curr?.data ?? [], e.prev.data);
                                    } catch {
                                        return false;
                                    }
                                });
                            const isSame = (await Promise.all(diffs)).every((e) => e == true);
                            if (isSame) {
                                this._log(
                                    `STORAGE --> DB:${prefixedFileName}: (config) Skipped (Same content)`,
                                    LOG_LEVEL_VERBOSE
                                );
                                return result(true, "skipped");
                            }
                        }
                    }
                    saveData = {
                        ...old,
                        data: content,
                        mtime,
                        size: content.size,
                        datatype: "newnote",
                        children: [],
                        deleted: false,
                        type: "newnote",
                    };
                }
                const ret = await this.dependencies.getLocalDatabase().putDBEntry(saveData);
                this._log(`STORAGE --> DB:${prefixedFileName}: (config) Done`);
                return result(ret, "saved", [{ mode: "v1", timing: "await", path: saveData.path }]);
            } catch (ex) {
                this._log(`STORAGE --> DB:${prefixedFileName}: (config) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return result(false, "failed");
            }
        });
    }

    // Compatibility question: the inherited forceWrite parameter is not read.
    // Preserve it until callers define whether deletion should bypass a marker.
    async deleteConfigOnDatabase(
        prefixedFileName: FilePathWithPrefix,
        forceWrite = false
    ): Promise<SnapshotPersistenceResult<boolean>> {
        void forceWrite;
        // const id = await this.path2id(prefixedFileName);
        const mtime = new Date().getTime();
        return await serialized("file-x-" + prefixedFileName, async () => {
            try {
                const old = (await this.dependencies
                    .getLocalDatabase()
                    .getDBEntryMeta(prefixedFileName, undefined, false)) as InternalFileEntry | false;
                let saveData: InternalFileEntry;
                if (old === false) {
                    this._log(`STORAGE -x> DB:${prefixedFileName}: (config) already deleted (Not found on database)`);
                    return result(true, "missing");
                } else {
                    if (old.deleted) {
                        this._log(`STORAGE -x> DB:${prefixedFileName}: (config) already deleted`);
                        return result(true, "already-deleted");
                    }
                    saveData = {
                        ...old,
                        mtime,
                        size: 0,
                        children: [],
                        deleted: true,
                        type: "newnote",
                    };
                }
                await this.dependencies.getLocalDatabase().putRaw(saveData);
                this._log(`STORAGE -x> DB:${prefixedFileName}: (config) Done`);
                return result(true, "deleted", [{ mode: "v1", timing: "await", path: prefixedFileName }]);
            } catch (ex) {
                this._log(`STORAGE -x> DB:${prefixedFileName}: (config) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return result(false, "failed");
            }
        });
    }
}
