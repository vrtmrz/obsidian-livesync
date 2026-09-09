import { diff_match_patch, parseYaml } from "@/deps.ts";
import type {
    diff_result,
    FilePath,
    FilePathWithPrefix,
    LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { delay, getDocData, getDocDataAsArray, isDocContentSame } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { decodeBinary } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/convert";
import { digestHash } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/hash";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { base64ToArrayBuffer, base64ToString } from "octagonal-wheels/binary/base64";

import { LiveSyncError } from "@vrtmrz/livesync-commonlib/compat/common/LSError";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { createCustomisationSyncCodec, type PluginDataEx } from "./customisationSyncCodec.ts";
import type { CatalogueOperations } from "./catalogueOperations.ts";
import type { CustomisationSyncPathOperations } from "./customisationSyncPathOperations.ts";
import type { SnapshotOperations } from "./snapshotOperations.ts";
import { PluginDataExDisplayV2 } from "./customisationSyncModel.ts";
import type { IPluginDataExDisplay, LoadedEntryPluginDataExFile } from "./customisationSyncView.ts";

const { deserialize } = createCustomisationSyncCodec({ digestHash, parseYaml });

type ApplicationDatabase = Pick<LiveSyncLocalDB, "getDBEntry">;
type ApplicationStorage = Pick<
    StorageAccess,
    "ensureDir" | "readHiddenFileBinary" | "readHiddenFileText" | "writeHiddenFileAuto"
>;
type ApplicationPath = Pick<CustomisationSyncPathOperations, "filenameToUnifiedKey">;
type ApplicationSnapshotOperations = Pick<
    SnapshotOperations,
    "isV2Enabled" | "storeCustomisationFileV2" | "storeCustomizationFiles" | "deleteConfigOnDatabase"
>;
type ApplicationCatalogue = Pick<
    CatalogueOperations,
    "findPlugins" | "manifestLookup" | "updatePluginList" | "updatePluginListV2"
>;

export type ApplicationOperationsDependencies = {
    getLocalDatabase(): ApplicationDatabase;
    storageAccess: ApplicationStorage;
    path: ApplicationPath;
    log: LogFunction;
    getConfigDir(): string;
    getDeviceAndVaultName(): string;
    resolveJsonConflict(
        path: FilePath,
        files: [LoadedEntryPluginDataExFile, LoadedEntryPluginDataExFile],
        remoteName: string,
        apply: (content: string) => Promise<boolean>
    ): Promise<boolean>;
    selectTextFile(path: FilePath, diffResult: diff_result, remoteName: string): Promise<"A" | "B" | false>;
    reloadPlugin(configDir: string, pluginName: string): Promise<void>;
    askRestart(): void;
    snapshotOperations: ApplicationSnapshotOperations;
    catalogueOperations: ApplicationCatalogue;
};

/**
 * Owns the Customisation Sync dialogue's compare, apply, duplicate, and
 * delete workflows. It deliberately consumes the shared snapshot capability
 * and catalogue owner, leaving lifecycle, event admission, and scanning in
 * the context.
 */
export class ApplicationOperations {
    constructor(private readonly dependencies: ApplicationOperationsDependencies) {}

    private get configDir() {
        return this.dependencies.getConfigDir();
    }

    private get localDatabase() {
        return this.dependencies.getLocalDatabase();
    }

    private get storageAccess() {
        return this.dependencies.storageAccess;
    }

    private _log(message: unknown, level?: LOG_LEVEL, key?: string) {
        this.dependencies.log(message, level, key);
    }

    async compareFileUsingDisplayData(
        dataA: IPluginDataExDisplay,
        dataB: IPluginDataExDisplay,
        filename: string
    ): Promise<boolean> {
        const dataACopy =
            dataA instanceof PluginDataExDisplayV2
                ? new PluginDataExDisplayV2(dataA, this.dependencies.catalogueOperations.manifestLookup)
                : { ...dataA };
        const dataBCopy =
            dataB instanceof PluginDataExDisplayV2
                ? new PluginDataExDisplayV2(dataB, this.dependencies.catalogueOperations.manifestLookup)
                : { ...dataB };
        dataACopy.files = dataACopy.files.filter((file) => file.filename == filename);
        dataBCopy.files = dataBCopy.files.filter((file) => file.filename == filename);
        return await this.compareUsingDisplayData(dataACopy, dataBCopy, true);
    }

    async compareUsingDisplayData(dataA: IPluginDataExDisplay, dataB: IPluginDataExDisplay, compareEach = false) {
        const loadFile = async (data: IPluginDataExDisplay) => {
            if (data instanceof PluginDataExDisplayV2 || compareEach) {
                return data.files[0] as LoadedEntryPluginDataExFile;
            }
            const loadDoc = await this.localDatabase.getDBEntry(data.documentPath);
            if (!loadDoc) return false;
            const pluginData = deserialize(getDocDataAsArray(loadDoc.data), {}) as PluginDataEx;
            pluginData.documentPath = data.documentPath;
            const file = pluginData.files[0];
            const doc = { ...loadDoc, ...file, datatype: "newnote" } as LoadedEntryPluginDataExFile;
            return doc;
        };
        const fileA = await loadFile(dataA);
        const fileB = await loadFile(dataB);
        this._log(`Comparing: ${dataA.documentPath} <-> ${dataB.documentPath}`, LOG_LEVEL_VERBOSE);
        if (!fileA || !fileB) {
            this._log(
                `Could not load ${dataA.name} for comparison: ${!fileA ? dataA.term : ""}${!fileB ? dataB.term : ""}`,
                LOG_LEVEL_NOTICE
            );
            return false;
        }
        const path = fileA.filename.split("/").pop() as FilePath;
        if (path.endsWith(".json")) {
            return serialized("config:merge-data", async () => {
                this._log("Opening data-merging dialog", LOG_LEVEL_VERBOSE);
                return await this.dependencies.resolveJsonConflict(path, [fileA, fileB], dataB.term, async (result) => {
                    try {
                        return await this.applyData(dataA, result);
                    } catch (ex) {
                        this._log("Could not apply merged file");
                        this._log(ex, LOG_LEVEL_VERBOSE);
                        return false;
                    }
                });
            });
        } else {
            const dmp = new diff_match_patch();
            let docAData = getDocData(fileA.data);
            let docBData = getDocData(fileB.data);
            if (fileA?.datatype != "plain") {
                docAData = base64ToString(docAData);
            }
            if (fileB?.datatype != "plain") {
                docBData = base64ToString(docBData);
            }
            const diffMap = dmp.diff_linesToChars_(docAData, docBData);

            const diff = dmp.diff_main(diffMap.chars1, diffMap.chars2, false);
            dmp.diff_charsToLines_(diff, diffMap.lineArray);
            dmp.diff_cleanupSemantic(diff);
            const diffResult: diff_result = {
                left: { rev: "A", ...fileA, data: docAData },
                right: { rev: "B", ...fileB, data: docBData },
                diff: diff,
            };
            const ret = await this.dependencies.selectTextFile(path, diffResult, dataB.term);
            if (ret === false) return false;
            const resultContent = ret == "A" ? docAData : ret == "B" ? docBData : undefined;
            if (resultContent) {
                return await this.applyData(dataA, resultContent);
            }
            return false;
        }
    }

    async duplicateData(data: IPluginDataExDisplay, deviceName: string): Promise<void> {
        const path = `${this.configDir}/${data.files[0].filename}` as FilePath;
        await this.dependencies.snapshotOperations.storeCustomizationFiles(path, deviceName);
        await this.dependencies.catalogueOperations.updatePluginList(
            false,
            this.dependencies.path.filenameToUnifiedKey(path, deviceName)
        );
    }

    async applyDataV2(data: PluginDataExDisplayV2, content?: string): Promise<boolean> {
        const baseDir = this.configDir;
        try {
            if (content) {
                // Preserve the inherited truthiness check: an explicitly empty
                // replacement is treated as the no-content path.
                const filename = data.files[0].filename;
                this._log(`Applying ${filename} of ${data.displayName || data.name}..`);
                const path = `${baseDir}/${filename}` as FilePath;
                await this.storageAccess.ensureDir(path);
                // If the content has applied, modified time will be updated to the current time.
                await this.storageAccess.writeHiddenFileAuto(path, content);
                await this.dependencies.snapshotOperations.storeCustomisationFileV2(
                    path,
                    this.dependencies.getDeviceAndVaultName()
                );
            } else {
                const files = data.files;
                for (const f of files) {
                    // If files have applied, modified time will be updated to the current time.
                    const stat = { mtime: f.mtime, ctime: f.ctime };
                    const path = `${baseDir}/${f.filename}` as FilePath;
                    this._log(`Applying ${f.filename} of ${data.displayName || data.name}..`);
                    // const contentEach = createBlob(f.data);
                    await this.storageAccess.ensureDir(path);

                    if (f.datatype == "newnote") {
                        let oldData;
                        try {
                            oldData = await this.storageAccess.readHiddenFileBinary(path);
                        } catch (ex) {
                            this._log(`Could not read the file ${f.filename}`, LOG_LEVEL_VERBOSE);
                            this._log(ex, LOG_LEVEL_VERBOSE);
                            oldData = new ArrayBuffer(0);
                        }
                        const content = base64ToArrayBuffer(f.data);
                        if (await isDocContentSame(oldData, content)) {
                            this._log(`The file ${f.filename} is already up-to-date`, LOG_LEVEL_VERBOSE);
                            continue;
                        }
                        await this.storageAccess.writeHiddenFileAuto(path, content, stat);
                    } else {
                        let oldData;
                        try {
                            oldData = await this.storageAccess.readHiddenFileText(path);
                        } catch (ex) {
                            this._log(`Could not read the file ${f.filename}`, LOG_LEVEL_VERBOSE);
                            this._log(ex, LOG_LEVEL_VERBOSE);
                            oldData = "";
                        }
                        const content = getDocData(f.data);
                        if (await isDocContentSame(oldData, content)) {
                            this._log(`The file ${f.filename} is already up-to-date`, LOG_LEVEL_VERBOSE);
                            continue;
                        }
                        await this.storageAccess.writeHiddenFileAuto(path, content, stat);
                    }
                    this._log(`Applied ${f.filename} of ${data.displayName || data.name}..`);
                    await this.dependencies.snapshotOperations.storeCustomisationFileV2(
                        path,
                        this.dependencies.getDeviceAndVaultName()
                    );
                }
            }
        } catch (ex) {
            this._log(`Applying ${data.displayName || data.name}.. Failed`, LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
        return true;
    }

    async applyData(data: IPluginDataExDisplay, content?: string): Promise<boolean> {
        this._log(`Applying ${data.displayName || data.name}..`);

        if (data instanceof PluginDataExDisplayV2) {
            return this.applyDataV2(data, content);
        }
        return this.applyDataV1(data, content);
    }

    private async applyDataV1(data: IPluginDataExDisplay, content?: string): Promise<boolean> {
        const baseDir = this.configDir;
        try {
            if (!data.documentPath) throw new LiveSyncError("InternalError: Document path not exist");
            const dx = await this.localDatabase.getDBEntry(data.documentPath);
            if (dx == false) {
                throw new LiveSyncError("Not found on database");
            }
            const loadedData = deserialize(getDocDataAsArray(dx.data), {}) as PluginDataEx;
            for (const f of loadedData.files) {
                this._log(`Applying ${f.filename} of ${data.displayName || data.name}..`);
                try {
                    // console.dir(f);
                    const path = `${baseDir}/${f.filename}`;
                    await this.storageAccess.ensureDir(path);
                    if (!content) {
                        const dt = decodeBinary(f.data);
                        await this.storageAccess.writeHiddenFileAuto(path, dt);
                    } else {
                        await this.storageAccess.writeHiddenFileAuto(path, content);
                    }
                    this._log(`Applying ${f.filename} of ${data.displayName || data.name}.. Done`);
                } catch (ex) {
                    this._log(`Applying ${f.filename} of ${data.displayName || data.name}.. Failed`);
                    this._log(ex, LOG_LEVEL_VERBOSE);
                }
            }
            const uPath = `${baseDir}/${loadedData.files[0].filename}` as FilePath;
            await this.dependencies.snapshotOperations.storeCustomizationFiles(uPath);
            // The inherited workflow refreshes once through persistence, then
            // explicitly refreshes again with the dialogue's notice flag.
            await this.dependencies.catalogueOperations.updatePluginList(true, uPath);
            await delay(100);
            this._log(`Config ${data.displayName || data.name} has been applied`, LOG_LEVEL_NOTICE);
            if (data.category == "PLUGIN_DATA" || data.category == "PLUGIN_MAIN") {
                await this.dependencies.reloadPlugin(baseDir, data.name);
            } else if (data.category == "CONFIG") {
                this.dependencies.askRestart();
            }
            return true;
        } catch (ex) {
            this._log(`Applying ${data.displayName || data.name}.. Failed`);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    async deleteData(data: PluginDataEx): Promise<boolean> {
        try {
            if (data.documentPath) {
                const delList: FilePathWithPrefix[] = [];
                if (this.dependencies.snapshotOperations.isV2Enabled()) {
                    const deleteList = this.dependencies.catalogueOperations
                        .findPlugins(data.documentPath)
                        .filter((entry) => entry instanceof PluginDataExDisplayV2)
                        .map((entry) => entry.files)
                        .flat();
                    for (const e of deleteList) {
                        delList.push(e.path);
                    }
                }
                delList.push(data.documentPath);
                const p = delList.map(async (e) => {
                    await this.dependencies.snapshotOperations.deleteConfigOnDatabase(e);
                    // Preserve the inherited unconditional refresh after the
                    // persistence wrapper, including when it emitted no refresh.
                    await this.dependencies.catalogueOperations.updatePluginList(false, e);
                });
                await Promise.allSettled(p);
                // Preserve the inherited success result even when individual
                // deletion/refresh promises settle unsuccessfully.
                this._log(
                    `Deleted: ${data.category}/${data.name} of ${data.category} (${delList.length} items)`,
                    LOG_LEVEL_NOTICE
                );
            }
            return true;
        } catch (ex) {
            this._log(`Failed to delete: ${data.documentPath}`, LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
}
