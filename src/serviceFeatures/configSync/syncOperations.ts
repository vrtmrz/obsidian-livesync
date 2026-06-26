import { diff_match_patch } from "@/deps.ts";
import type { PluginManifest } from "@/deps.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import {
    LOG_LEVEL_VERBOSE,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_DEBUG,
    CANCELLED,
    LEAVE_TO_SUBSEQUENT,
    MODE_SELECTIVE,
    MODE_SHINY,
} from "@lib/common/types.ts";
import type { FilePath, FilePathWithPrefix, SavingEntry, InternalFileEntry, diff_result } from "@lib/common/types.ts";
import { ICXHeader } from "@/common/types.ts";
import {
    isDocContentSame,
    createBlob,
    createTextBlob,
    getDocData,
    getDocDataAsArray,
    fireAndForget,
    delay,
} from "@lib/common/utils.ts";
import { EVEN, scheduleTask } from "@/common/utils.ts";
import { serialized, shareRunningResult } from "octagonal-wheels/concurrency/lock";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { base64ToArrayBuffer, base64ToString } from "octagonal-wheels/binary/base64";
import { decodeBinary, arrayBufferToBase64 } from "@lib/string_and_binary/convert.ts";
import { stripAllPrefixes } from "@lib/string_and_binary/path.ts";
import { ConflictResolveModal } from "@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts";
import { JsonResolveModal } from "@/features/HiddenFileCommon/JsonResolveModal.ts";
import { LiveSyncError } from "@lib/common/LSError.ts";

import type { ConfigSyncHost, IPluginDataExDisplay, PluginDataEx, LoadedEntryPluginDataExFile } from "./types.ts";
import type { ConfigSyncState } from "./state.ts";
import {
    getFileCategory,
    isTargetPath,
    filenameToUnifiedKey,
    filenameWithUnifiedKey,
    unifiedKeyPrefixOfTerminal,
    deserialize,
    serialize,
    DUMMY_HEAD,
    DUMMY_END,
} from "./utils.ts";

import {
    updatePluginList,
    updatePluginListV2,
    makeEntryFromFile,
    PluginDataExDisplayV2,
    scanInternalFiles,
} from "./pluginScanner.ts";

/**
 * Checks whether the configuration synchronisation module is enabled in settings.
 *
 * @param host - The service feature host.
 * @returns True if enabled, false otherwise.
 */
export function isThisModuleEnabled(host: ConfigSyncHost): boolean {
    return host.services.setting.currentSettings().usePluginSync;
}

/**
 * Compares two plugin data sets by displaying a resolve modal dialog.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param dataA - Left hand configuration item.
 * @param dataB - Right hand configuration item.
 * @param compareEach - Whether to compare file by file.
 * @returns Promise resolving to true if applied successfully, false otherwise.
 */
export async function compareUsingDisplayData(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    dataA: IPluginDataExDisplay,
    dataB: IPluginDataExDisplay,
    compareEach = false
): Promise<boolean> {
    const loadFile = async (data: IPluginDataExDisplay) => {
        if (data instanceof PluginDataExDisplayV2 || compareEach) {
            return data.files[0] as LoadedEntryPluginDataExFile;
        }
        const loadDoc = await host.services.database.localDatabase.getDBEntry(data.documentPath);
        if (!loadDoc) return false;
        const pluginData = deserialize(getDocDataAsArray(loadDoc.data), {}) as PluginDataEx;
        pluginData.documentPath = data.documentPath;
        const file = pluginData.files[0];
        const doc = { ...loadDoc, ...file, datatype: "newnote" } as LoadedEntryPluginDataExFile;
        return doc;
    };
    const fileA = await loadFile(dataA);
    const fileB = await loadFile(dataB);
    log(`Comparing: ${dataA.documentPath} <-> ${dataB.documentPath}`, LOG_LEVEL_VERBOSE);
    if (!fileA || !fileB) {
        log(
            `Could not load ${dataA.name} for comparison: ${!fileA ? dataA.term : ""}${!fileB ? dataB.term : ""}`,
            LOG_LEVEL_NOTICE
        );
        return false;
    }
    let path = stripAllPrefixes(fileA.path.split("/").slice(-1).join("/") as FilePath);
    if (path.indexOf("%") !== -1) {
        path = path.split("%")[1] as FilePath;
    }
    if (fileA.path.endsWith(".json")) {
        return serialized(
            "config:merge-data",
            () =>
                new Promise<boolean>((res) => {
                    log("Opening data-merging dialogue", LOG_LEVEL_VERBOSE);
                    const modal = new JsonResolveModal(
                        host.context.app,
                        path,
                        [fileA, fileB],
                        async (keep, result) => {
                            if (result == null) return res(false);
                            try {
                                res(await applyData(host, log, state, dataA, result));
                            } catch (ex) {
                                log("Could not apply merged file");
                                log(ex, LOG_LEVEL_VERBOSE);
                                res(false);
                            }
                        },
                        "Local",
                        `${dataB.term}`,
                        "B",
                        true,
                        true,
                        "Difference between local and remote"
                    );
                    modal.open();
                })
        );
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
        const d = new ConflictResolveModal(host.context.app, path, diffResult, true, dataB.term);
        d.open();
        const ret = await d.waitForResult();
        if (ret === CANCELLED) return false;
        if (ret === LEAVE_TO_SUBSEQUENT) return false;
        const resultContent = ret == "A" ? docAData : ret == "B" ? docBData : undefined;
        if (resultContent) {
            return await applyData(host, log, state, dataA, resultContent);
        }
        return false;
    }
}

/**
 * Applies customization data for V2 split files.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param data - The plugin V2 display model.
 * @param content - Optional specific file content override.
 * @returns True if applied successfully, false otherwise.
 */
export async function applyDataV2(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    data: PluginDataExDisplayV2,
    content?: string
): Promise<boolean> {
    const baseDir = host.services.API.getSystemConfigDir();
    try {
        if (content) {
            const filename = data.files[0].filename;
            log(`Applying ${filename} of ${data.displayName || data.name}..`);
            const path = `${baseDir}/${filename}` as FilePath;
            await host.serviceModules.storageAccess.ensureDir(path);
            await host.serviceModules.storageAccess.writeHiddenFileAuto(path, content);
            await storeCustomisationFileV2(host, log, state, path, host.services.setting.getDeviceAndVaultName());
        } else {
            const files = data.files;
            for (const f of files) {
                const stat = { mtime: f.mtime, ctime: f.ctime };
                const path = `${baseDir}/${f.filename}` as FilePath;
                log(`Applying ${f.filename} of ${data.displayName || data.name}..`);
                await host.serviceModules.storageAccess.ensureDir(path);

                if (f.datatype == "newnote") {
                    let oldData;
                    try {
                        oldData = await host.serviceModules.storageAccess.readHiddenFileBinary(path);
                    } catch (ex) {
                        log(`Could not read the file ${f.filename}`, LOG_LEVEL_VERBOSE);
                        log(ex, LOG_LEVEL_VERBOSE);
                        oldData = new ArrayBuffer(0);
                    }
                    const contentBytes = base64ToArrayBuffer(f.data);
                    if (await isDocContentSame(oldData, contentBytes)) {
                        log(`The file ${f.filename} is already up-to-date`, LOG_LEVEL_VERBOSE);
                        continue;
                    }
                    await host.serviceModules.storageAccess.writeHiddenFileAuto(path, contentBytes, stat);
                } else {
                    let oldData;
                    try {
                        oldData = await host.serviceModules.storageAccess.readHiddenFileText(path);
                    } catch (ex) {
                        log(`Could not read the file ${f.filename}`, LOG_LEVEL_VERBOSE);
                        log(ex, LOG_LEVEL_VERBOSE);
                        oldData = "";
                    }
                    const contentText = getDocData(f.data);
                    if (await isDocContentSame(oldData, contentText)) {
                        log(`The file ${f.filename} is already up-to-date`, LOG_LEVEL_VERBOSE);
                        continue;
                    }
                    await host.serviceModules.storageAccess.writeHiddenFileAuto(path, contentText, stat);
                }
                log(`Applied ${f.filename} of ${data.displayName || data.name}..`);
                await storeCustomisationFileV2(host, log, state, path, host.services.setting.getDeviceAndVaultName());
            }
        }
    } catch (ex) {
        log(`Applying ${data.displayName || data.name}.. Failed`, LOG_LEVEL_NOTICE);
        log(ex, LOG_LEVEL_VERBOSE);
        return false;
    }
    return true;
}

/**
 * Applies configuration data to local storage and updates active systems.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param data - The configuration display description.
 * @param content - Optional merged file content.
 * @returns True if successful, false otherwise.
 */
export async function applyData(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    data: IPluginDataExDisplay,
    content?: string
): Promise<boolean> {
    log(`Applying ${data.displayName || data.name}..`);

    if (data instanceof PluginDataExDisplayV2) {
        return applyDataV2(host, log, state, data, content);
    }
    const baseDir = host.services.API.getSystemConfigDir();
    try {
        if (!data.documentPath) throw new LiveSyncError("InternalError: Document path does not exist");
        const dx = await host.services.database.localDatabase.getDBEntry(data.documentPath);
        if (dx == false) {
            throw new LiveSyncError("Not found on database");
        }
        const loadedData = deserialize(getDocDataAsArray(dx.data), {}) as PluginDataEx;
        for (const f of loadedData.files) {
            log(`Applying ${f.filename} of ${data.displayName || data.name}..`);
            try {
                const path = `${baseDir}/${f.filename}`;
                await host.serviceModules.storageAccess.ensureDir(path);
                if (!content) {
                    const dt = decodeBinary(f.data);
                    await host.serviceModules.storageAccess.writeHiddenFileAuto(path, dt);
                } else {
                    await host.serviceModules.storageAccess.writeHiddenFileAuto(path, content);
                }
                log(`Applying ${f.filename} of ${data.displayName || data.name}.. Done`);
            } catch (ex) {
                log(`Applying ${f.filename} of ${data.displayName || data.name}.. Failed`);
                log(ex, LOG_LEVEL_VERBOSE);
            }
        }
        const uPath = `${baseDir}/${loadedData.files[0].filename}` as FilePath;
        await storeCustomizationFiles(host, log, state, uPath);
        await updatePluginList(host, log, state, true, uPath);
        await delay(100);
        log(`Config ${data.displayName || data.name} has been applied`, LOG_LEVEL_NOTICE);
        if (data.category == "PLUGIN_DATA" || data.category == "PLUGIN_MAIN") {
            const appPlugins = (host.context.app as any).plugins;
            const manifests = Object.values(appPlugins.manifests) as unknown as PluginManifest[];
            const enabledPlugins = appPlugins.enabledPlugins as Set<string>;
            const pluginManifest = manifests.find(
                (manifest) => enabledPlugins.has(manifest.id) && manifest.dir == `${baseDir}/plugins/${data.name}`
            );
            if (pluginManifest) {
                log(`Unloading plugin: ${pluginManifest.name}`, LOG_LEVEL_NOTICE, "plugin-reload-" + pluginManifest.id);
                await appPlugins.unloadPlugin(pluginManifest.id);
                await appPlugins.loadPlugin(pluginManifest.id);
                log(`Plugin reloaded: ${pluginManifest.name}`, LOG_LEVEL_NOTICE, "plugin-reload-" + pluginManifest.id);
            }
        } else if (data.category == "CONFIG") {
            host.services.appLifecycle.askRestart();
        }
        return true;
    } catch (ex) {
        log(`Applying ${data.displayName || data.name}.. Failed`);
        log(ex, LOG_LEVEL_VERBOSE);
        return false;
    }
}

/**
 * Deletes configuration documents from the database and runs status updates.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param data - The target plugin configurations to clean up.
 * @returns True if successful, false otherwise.
 */
export async function deleteData(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    data: PluginDataEx
): Promise<boolean> {
    try {
        if (data.documentPath) {
            const delList = [];
            const useV2 = host.services.setting.currentSettings().usePluginSyncV2;
            if (useV2) {
                const deleteList = state.pluginList
                    .filter((e) => e.documentPath == data.documentPath)
                    .filter((e) => e instanceof PluginDataExDisplayV2)
                    .map((e) => e.files)
                    .flat();
                for (const e of deleteList) {
                    delList.push(e.path);
                }
            }
            delList.push(data.documentPath);
            const p = delList.map(async (e) => {
                await deleteConfigOnDatabase(host, log, state, e);
                await updatePluginList(host, log, state, false, e);
            });
            await Promise.allSettled(p);
            log(
                `Deleted: ${data.category}/${data.name} of ${data.category} (${delList.length} items)`,
                LOG_LEVEL_NOTICE
            );
        }
        return true;
    } catch (ex) {
        log(`Failed to delete: ${data.documentPath}`, LOG_LEVEL_NOTICE);
        log(ex, LOG_LEVEL_VERBOSE);
        return false;
    }
}

/**
 * Stores a customization file in V2 database split format.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param path - Local file path.
 * @param term - Local terminal name.
 * @param force - True to bypass change verification checks.
 * @returns Database operation response structure.
 */
export async function storeCustomisationFileV2(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    path: FilePath,
    term: string,
    force = false
): Promise<any> {
    const useSyncPluginEtc = host.services.setting.currentSettings().usePluginEtc;
    const configDir = host.services.API.getSystemConfigDir();
    const vf = filenameWithUnifiedKey(path, term, configDir, true, useSyncPluginEtc);
    return await serialized(`plugin-${vf}`, async () => {
        const prefixedFileName = vf;

        const id = await host.services.path.path2id(prefixedFileName);
        const stat = await host.serviceModules.storageAccess.statHidden(path);
        if (!stat) {
            return false;
        }
        const mtime = stat.mtime;
        const content = await host.serviceModules.storageAccess.readHiddenFileBinary(path);
        const contentBlob = createBlob([DUMMY_HEAD, DUMMY_END, ...(await arrayBufferToBase64(content))]);
        try {
            const old = await host.services.database.localDatabase.getDBEntryMeta(prefixedFileName, undefined, false);
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
                if (
                    !force &&
                    host.services.path.isMarkedAsSameChanges(prefixedFileName, [old.mtime, mtime + 1]) == EVEN
                ) {
                    log(
                        `STORAGE --> DB:${prefixedFileName}: (config) Skipped (Already checked the same)`,
                        LOG_LEVEL_DEBUG
                    );
                    return;
                }
                const docXDoc = await host.services.database.localDatabase.getDBEntryFromMeta(old, false, false);
                if (docXDoc == false) {
                    throw new LiveSyncError("Could not load the document");
                }
                const dataSrc = getDocData(docXDoc.data);
                const dataStart = dataSrc.indexOf(DUMMY_END);
                const oldContent = dataSrc.substring(dataStart + DUMMY_END.length);
                const oldContentArray = base64ToArrayBuffer(oldContent);
                if (await isDocContentSame(oldContentArray, content)) {
                    log(`STORAGE --> DB:${prefixedFileName}: (config) Skipped (the same content)`, LOG_LEVEL_VERBOSE);
                    host.services.path.markChangesAreSame(prefixedFileName, old.mtime, mtime + 1);
                    return true;
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
            const ret = await host.services.database.localDatabase.putDBEntry(saveData);
            log(`STORAGE --> DB:${prefixedFileName}: (config) Done`);
            fireAndForget(() =>
                updatePluginListV2(
                    host,
                    log,
                    state,
                    false,
                    filenameWithUnifiedKey(path, term, configDir, true, useSyncPluginEtc)
                )
            );
            return ret;
        } catch (ex) {
            log(`STORAGE --> DB:${prefixedFileName}: (config) Failed`);
            log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    });
}

/**
 * Stores local customization files to database records.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param path - Local file path.
 * @param termOverRide - Device identifier override.
 * @returns DB operation response.
 */
export async function storeCustomizationFiles(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    path: FilePath,
    termOverRide?: string
): Promise<any> {
    const term = termOverRide || host.services.setting.getDeviceAndVaultName();
    if (term == "") {
        log("We have to configure the device name", LOG_LEVEL_NOTICE);
        return;
    }
    const settings = host.services.setting.currentSettings();
    const configDir = host.services.API.getSystemConfigDir();
    if (settings.usePluginSyncV2) {
        return await storeCustomisationFileV2(host, log, state, path, term);
    }
    const vf = filenameToUnifiedKey(path, term, configDir, false, settings.usePluginEtc);

    return await serialized(`plugin-${vf}`, async () => {
        const category = getFileCategory(path, configDir, false, settings.usePluginEtc);
        let mtime = 0;
        let fileTargets = [] as FilePath[];
        const name =
            category == "CONFIG" || category == "SNIPPET" ? path.split("/").reverse()[0] : path.split("/").reverse()[1];
        const parentPath = path.split("/").slice(0, -1).join("/");
        const prefixedFileName = filenameToUnifiedKey(path, term, configDir, false, settings.usePluginEtc);
        const id = await host.services.path.path2id(prefixedFileName);
        const dt: PluginDataEx = {
            category: category,
            files: [],
            name: name,
            mtime: 0,
            term: term,
        };
        if (category == "CONFIG" || category == "SNIPPET" || category == "PLUGIN_ETC" || category == "PLUGIN_DATA") {
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
            const data = await makeEntryFromFile(host, log, target);
            if (data == false) {
                log(`Config: skipped (Possibly is not exist): ${target} `, LOG_LEVEL_VERBOSE);
                continue;
            }
            if (data.version) {
                dt.version = data.version;
            }
            if (data.displayName) {
                dt.displayName = data.displayName;
            }
            mtime = mtime == 0 ? data.mtime : (data.mtime + mtime) / 2;
            dt.files.push(data);
        }
        dt.mtime = mtime;

        if (dt.files.length == 0) {
            log(`Nothing left: deleting.. ${path}`);
            await deleteConfigOnDatabase(host, log, state, prefixedFileName);
            await updatePluginList(host, log, state, false, prefixedFileName);
            return;
        }

        const content = createTextBlob(serialize(dt));
        try {
            const old = await host.services.database.localDatabase.getDBEntryMeta(prefixedFileName, undefined, false);
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
                    return true;
                }
                const oldC = await host.services.database.localDatabase.getDBEntryFromMeta(old, false, false);
                if (oldC) {
                    const d = (await deserialize(getDocDataAsArray(oldC.data), {})) as PluginDataEx;
                    if (d.files.length == dt.files.length) {
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
                            log(
                                `STORAGE --> DB:${prefixedFileName}: (config) Skipped (Same content)`,
                                LOG_LEVEL_VERBOSE
                            );
                            return true;
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
            const ret = await host.services.database.localDatabase.putDBEntry(saveData);
            await updatePluginList(host, log, state, false, saveData.path);
            log(`STORAGE --> DB:${prefixedFileName}: (config) Done`);
            return ret;
        } catch (ex) {
            log(`STORAGE --> DB:${prefixedFileName}: (config) Failed`);
            log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    });
}

/**
 * Marks config file deleted in the database.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param prefixedFileName - Unified db file path.
 * @param forceWrite - Force deletion write operation.
 * @returns True if successfully marked deleted, false otherwise.
 */
export async function deleteConfigOnDatabase(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    prefixedFileName: FilePathWithPrefix,
    forceWrite = false
): Promise<boolean> {
    const mtime = new Date().getTime();
    return await serialized("file-x-" + prefixedFileName, async () => {
        try {
            const old = (await host.services.database.localDatabase.getDBEntryMeta(
                prefixedFileName,
                undefined,
                false
            )) as InternalFileEntry | false;
            let saveData: InternalFileEntry;
            if (old === false) {
                log(`STORAGE -x> DB:${prefixedFileName}: (config) already deleted (Not found on database)`);
                return true;
            } else {
                if (old.deleted) {
                    log(`STORAGE -x> DB:${prefixedFileName}: (config) already deleted`);
                    return true;
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
            await host.services.database.localDatabase.putRaw(saveData);
            await updatePluginList(host, log, state, false, prefixedFileName);
            log(`STORAGE -x> DB:${prefixedFileName}: (config) Done`);
            return true;
        } catch (ex) {
            log(`STORAGE -x> DB:${prefixedFileName}: (config) Failed`);
            log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    });
}

/**
 * Scans all customization config files, comparing local and DB databases.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param showMessage - True to print progress messages.
 */
export async function scanAllConfigFiles(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    showMessage: boolean
): Promise<void> {
    await shareRunningResult("scanAllConfigFiles", async () => {
        const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
        log("Scanning customising files.", logLevel, "scan-all-config");
        const term = host.services.setting.getDeviceAndVaultName();
        if (term == "") {
            log("We have to configure the device name", LOG_LEVEL_NOTICE);
            return;
        }
        const filesAll = await scanInternalFiles(host, log);
        const settings = host.services.setting.currentSettings();
        const configDir = host.services.API.getSystemConfigDir();
        if (settings.usePluginSyncV2) {
            const filesAllUnified = filesAll
                .filter((e) => isTargetPath(e, configDir, true, settings.usePluginEtc))
                .map(
                    (e) =>
                        [filenameWithUnifiedKey(e, term, configDir, true, settings.usePluginEtc), e] as [
                            FilePathWithPrefix,
                            FilePath,
                        ]
                );
            const localFileMap = new Map(filesAllUnified.map((e) => [e[0], e[1]]));
            const prefix = unifiedKeyPrefixOfTerminal(term);
            const entries = host.services.database.localDatabase.findEntries(prefix + "", `${prefix}\u{10ffff}`, {
                include_docs: true,
            });
            const tasks = [] as (() => Promise<void>)[];
            const concurrency = 10;
            const semaphore = Semaphore(concurrency);
            for await (const item of entries) {
                if (item.path.indexOf("%") !== -1) {
                    continue;
                }
                tasks.push(async () => {
                    const releaser = await semaphore.acquire();
                    try {
                        const unifiedFilenameWithKey = `${item._id}` as FilePathWithPrefix;
                        const localPath = localFileMap.get(unifiedFilenameWithKey);
                        if (localPath) {
                            await storeCustomisationFileV2(host, log, state, localPath, term);
                            localFileMap.delete(unifiedFilenameWithKey);
                        } else {
                            await deleteConfigOnDatabase(host, log, state, unifiedFilenameWithKey);
                        }
                    } catch (ex) {
                        log(`scanAllConfigFiles - Error: ${item._id}`, LOG_LEVEL_VERBOSE);
                        log(ex, LOG_LEVEL_VERBOSE);
                    } finally {
                        releaser();
                    }
                });
            }
            await Promise.all(tasks.map((e) => e()));

            const taskExtra = [] as (() => Promise<void>)[];
            for (const [, filePath] of localFileMap) {
                taskExtra.push(async () => {
                    const releaser = await semaphore.acquire();
                    try {
                        await storeCustomisationFileV2(host, log, state, filePath, term);
                    } catch (ex) {
                        log(`scanAllConfigFiles - Error: ${filePath}`, LOG_LEVEL_VERBOSE);
                        log(ex, LOG_LEVEL_VERBOSE);
                    } finally {
                        releaser();
                    }
                });
            }
            await Promise.all(taskExtra.map((e) => e()));
            fireAndForget(() => updatePluginList(host, log, state, false));
        } else {
            const files = filesAll
                .filter((e) => isTargetPath(e, configDir, false, settings.usePluginEtc))
                .map((e) => ({ key: filenameToUnifiedKey(e, term, configDir, false, settings.usePluginEtc), file: e }));
            const virtualPathsOfLocalFiles = [...new Set(files.map((e) => e.key))];
            const filesOnDB = (
                (
                    await host.services.database.localDatabase.allDocsRaw({
                        startkey: ICXHeader + "",
                        endkey: `${ICXHeader}\u{10ffff}`,
                        include_docs: true,
                    })
                ).rows.map((e) => e.doc) as InternalFileEntry[]
            ).filter((e) => !e.deleted);
            let deleteCandidate = filesOnDB
                .map((e) => (e.path ? e.path : host.services.path.getPath(e)))
                .filter((e) => e.startsWith(`${ICXHeader}${term}/`));
            for (const vp of virtualPathsOfLocalFiles) {
                const p = files.find((e) => e.key == vp)?.file;
                if (!p) {
                    log(`scanAllConfigFiles - File not found: ${vp}`, LOG_LEVEL_VERBOSE);
                    continue;
                }
                await storeCustomizationFiles(host, log, state, p);
                deleteCandidate = deleteCandidate.filter((e) => e != vp);
            }
            for (const vp of deleteCandidate) {
                await deleteConfigOnDatabase(host, log, state, vp);
            }
            fireAndForget(() => updatePluginList(host, log, state, false));
        }
    });
}

/**
 * Monitors and processes Obsidian storage raw file events for synchronisation.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param path - The modified file path.
 * @returns True if processed, false otherwise.
 */
export async function watchVaultRawEventsAsync(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    path: FilePath
): Promise<boolean> {
    if (!host.services.appLifecycle.isReady()) return false;
    if (host.services.appLifecycle.isSuspended()) return false;
    if (!isThisModuleEnabled(host)) return false;

    const stat = await host.serviceModules.storageAccess.statHidden(path);
    if (stat && stat.type != "file") return false;

    const configDir = host.services.API.getSystemConfigDir();
    const settings = host.services.setting.currentSettings();
    const synchronisedInConfigSync = Object.values(settings.pluginSyncExtendedSetting)
        .filter((e) => e.mode != MODE_SELECTIVE && e.mode != MODE_SHINY)
        .map((e) => e.files)
        .flat()
        .map((e) => `${configDir}/${e}`.toLowerCase());

    if (synchronisedInConfigSync.some((e) => e.startsWith(path.toLowerCase()))) {
        log(`Customisation file skipped: ${path}`, LOG_LEVEL_VERBOSE);
        return false;
    }

    const storageMTime = ~~(((stat && stat.mtime) || 0) / 1000);
    const key = `${path}-${storageMTime}`;
    if (state.recentProcessedInternalFiles.includes(key)) {
        return true;
    }
    state.recentProcessedInternalFiles = [key, ...state.recentProcessedInternalFiles].slice(0, 100);

    const term = host.services.setting.getDeviceAndVaultName();
    const useV2 = settings.usePluginSyncV2;
    const useSyncPluginEtc = settings.usePluginEtc;
    const keySchedule = useV2
        ? filenameWithUnifiedKey(path, term, configDir, useV2, useSyncPluginEtc)
        : filenameToUnifiedKey(path, term, configDir, useV2, useSyncPluginEtc);

    scheduleTask(keySchedule, 100, async () => {
        if (useV2) {
            await storeCustomisationFileV2(host, log, state, path, term);
        } else {
            await storeCustomizationFiles(host, log, state, path);
        }
    });
    return true;
}
