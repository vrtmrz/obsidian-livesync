import type { PluginManifest, ListedFiles } from "@/deps.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import { LOG_LEVEL_VERBOSE, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE } from "@lib/common/types.ts";
import type { FilePath, FilePathWithPrefix, LoadedEntry, AnyEntry, SavingEntry } from "@lib/common/types.ts";
import { ICXHeader } from "@/common/types.ts";
import {
    fireAndForget,
    getDocData,
    getDocDataAsArray,
    isLoadedEntry,
    createSavingEntryFromLoadedEntry,
    createBlob,
} from "@lib/common/utils.ts";

import { base64ToString } from "octagonal-wheels/binary/base64";
import { readString, arrayBufferToBase64 } from "@lib/string_and_binary/convert.ts";
import { digestHash } from "@lib/string_and_binary/hash.ts";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import { pluginScanningCount } from "@lib/mock_and_interop/stores.ts";

import type {
    ConfigSyncHost,
    IPluginDataExDisplay,
    PluginDataExDisplay,
    LoadedEntryPluginDataExFile,
    PluginDataExFile,
    PluginDataEx,
} from "./types.ts";
import type { ConfigSyncState } from "./state.ts";
import { pluginList, pluginV2Progress, pluginIsEnumerating, pluginManifests, setManifest } from "./stores.ts";
import { categoryToFolder, parseUnifiedPath, deserialize, serialize, DUMMY_HEAD, DUMMY_END } from "./utils.ts";

/**
 * Class representing plugin configuration metadata and display structures for V2 synchronisation.
 */
export class PluginDataExDisplayV2 {
    documentPath: FilePathWithPrefix;
    category: string;
    term: string;
    files = [] as LoadedEntryPluginDataExFile[];
    name: string;
    confKey: string;

    constructor(data: IPluginDataExDisplay) {
        this.documentPath = `${data.documentPath}` as FilePathWithPrefix;
        this.category = `${data.category}`;
        this.name = `${data.name}`;
        this.term = `${data.term}`;
        this.files = [...(data.files as LoadedEntryPluginDataExFile[])];
        this.confKey = `${categoryToFolder(this.category, this.term)}${this.name}`;
        this.applyLoadedManifest();
    }

    async setFile(file: LoadedEntryPluginDataExFile) {
        const old = this.files.find((e) => e.filename == file.filename);
        if (old) {
            if (old.mtime == file.mtime && (await isDocContentSame(old.data, file.data))) return;
            this.files = this.files.filter((e) => e.filename != file.filename);
        }
        this.files.push(file);
        if (file.filename == "manifest.json") {
            this.applyLoadedManifest();
        }
    }

    deleteFile(filename: string) {
        this.files = this.files.filter((e) => e.filename != filename);
    }

    _displayName: string | undefined;
    _version: string | undefined;

    applyLoadedManifest() {
        const manifest = pluginManifests.get(this.confKey);
        if (manifest) {
            this._displayName = manifest.name;
            if (this.category == "PLUGIN_MAIN" || this.category == "THEME") {
                this._version = manifest?.version;
            }
        }
    }

    get displayName(): string {
        return this._displayName || this.name;
    }

    get version(): string | undefined {
        return this._version;
    }

    get mtime(): number {
        return ~~this.files.reduce((a, b) => a + b.mtime, 0) / this.files.length;
    }
}

/**
 * Reloads the plugin list by clearing the cache and executing updates.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param showMessage - Whether to display progress messages.
 */
export async function reloadPluginList(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    showMessage: boolean
) {
    state.pluginList = [];
    state.loadedManifest_mTime.clear();
    pluginList.set(state.pluginList);
    await updatePluginList(host, log, state, showMessage);
}

/**
 * Loads plugin configuration data from the database.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param path - The database document path.
 * @returns Deserialised plugin display details, or false if not found.
 */
export async function loadPluginData(
    host: ConfigSyncHost,
    log: LogFunction,
    path: FilePathWithPrefix
): Promise<PluginDataExDisplay | false> {
    const wx = await host.services.database.localDatabase.getDBEntry(path, undefined, false, false);
    if (wx) {
        const data = deserialize(getDocDataAsArray(wx.data), {}) as PluginDataEx;
        const xFiles = [] as PluginDataExFile[];
        let missingHash = false;
        for (const file of data.files) {
            const work = { ...file, data: [] as string[] };
            if (!file.hash) {
                const tempStr = getDocDataAsArray(work.data);
                const hash = digestHash(tempStr);
                file.hash = hash;
                missingHash = true;
            }
            work.data = [file.hash];
            xFiles.push(work);
        }
        if (missingHash) {
            log(`Digest created for ${path} to improve checking`, LOG_LEVEL_VERBOSE);
            wx.data = serialize(data);
            fireAndForget(() => host.services.database.localDatabase.putDBEntry(createSavingEntryFromLoadedEntry(wx)));
        }
        return {
            ...data,
            documentPath: host.services.path.getPath(wx),
            files: xFiles,
        } satisfies PluginDataExDisplay;
    }
    return false;
}

/**
 * Creates a V2 plugin metadata descriptor from the unified path.
 *
 * @param host - The service feature host.
 * @param unifiedPathV2 - V2 unified path database key.
 * @returns Initialised plugin display descriptor.
 */
export function createPluginDataFromV2(host: ConfigSyncHost, unifiedPathV2: FilePathWithPrefix) {
    const { category, device, key, pathV1 } = parseUnifiedPath(unifiedPathV2);
    if (category == "") return;

    const ret: PluginDataExDisplayV2 = new PluginDataExDisplayV2({
        documentPath: pathV1,
        category: category,
        name: key,
        term: `${device}`,
        files: [],
        mtime: 0,
    });
    return ret;
}

/**
 * Creates a file entry structure from a V2 unified database document.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param unifiedPathV2 - V2 unified path database key.
 * @param loaded - Pre-fetched database document, if available.
 * @returns The V2 file descriptor.
 */
export async function createPluginDataExFileV2(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    unifiedPathV2: FilePathWithPrefix,
    loaded?: LoadedEntry
): Promise<false | LoadedEntryPluginDataExFile> {
    const { category, key, filename, device } = parseUnifiedPath(unifiedPathV2);
    if (!loaded) {
        const d = await host.services.database.localDatabase.getDBEntry(unifiedPathV2);
        if (!d) {
            log(`The file ${unifiedPathV2} is not found`, LOG_LEVEL_VERBOSE);
            return false;
        }
        if (!isLoadedEntry(d)) {
            log(`The file ${unifiedPathV2} is not a note`, LOG_LEVEL_VERBOSE);
            return false;
        }
        loaded = d;
    }
    const confKey = `${categoryToFolder(category, device)}${key}`;
    const relativeFilename =
        `${categoryToFolder(category, "")}${category == "CONFIG" || category == "SNIPPET" ? "" : key + "/"}${filename}`.substring(
            1
        );
    const dataSrc = getDocData(loaded.data);
    const dataStart = dataSrc.indexOf(DUMMY_END);
    const data = dataSrc.substring(dataStart + DUMMY_END.length);
    const file: LoadedEntryPluginDataExFile = {
        ...loaded,
        hash: "",
        data: [base64ToString(data)],
        filename: relativeFilename,
        displayName: filename,
    };
    if (filename == "manifest.json") {
        if (state.loadedManifest_mTime.get(confKey) != file.mtime && pluginManifests.get(confKey) == undefined) {
            try {
                const parsedManifest = JSON.parse(base64ToString(data)) as PluginManifest;
                setManifest(confKey, parsedManifest);
                state.pluginList
                    .filter((e) => e instanceof PluginDataExDisplayV2 && e.confKey == confKey)
                    .forEach((e) => (e as PluginDataExDisplayV2).applyLoadedManifest());
                pluginList.set(state.pluginList);
            } catch (ex) {
                log(`The file ${loaded.path} seems to manifest, but could not be decoded as JSON`, LOG_LEVEL_VERBOSE);
                log(ex, LOG_LEVEL_VERBOSE);
            }
            state.loadedManifest_mTime.set(confKey, file.mtime);
        } else {
            state.pluginList
                .filter((e) => e instanceof PluginDataExDisplayV2 && e.confKey == confKey)
                .forEach((e) => (e as PluginDataExDisplayV2).applyLoadedManifest());
            pluginList.set(state.pluginList);
        }
    }
    return file;
}

/**
 * Updates the plugin display list for a V2 unified document path.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param showMessage - Whether to show notifications.
 * @param unifiedFilenameWithKey - Unified database document path.
 */
export async function updatePluginListV2(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    showMessage: boolean,
    unifiedFilenameWithKey: FilePathWithPrefix
): Promise<void> {
    try {
        state.updatingV2Count++;
        pluginV2Progress.set(state.updatingV2Count);
        const { pathV1 } = parseUnifiedPath(unifiedFilenameWithKey);

        const oldEntry = state.pluginList.find((e) => e.documentPath == pathV1);
        let entry: PluginDataExDisplayV2 | undefined = undefined;

        if (!oldEntry || !(oldEntry instanceof PluginDataExDisplayV2)) {
            const newEntry = createPluginDataFromV2(host, unifiedFilenameWithKey);
            if (newEntry) {
                entry = newEntry;
            }
        } else if (oldEntry instanceof PluginDataExDisplayV2) {
            entry = oldEntry;
        }
        if (!entry) return;
        const file = await createPluginDataExFileV2(host, log, state, unifiedFilenameWithKey);
        if (file) {
            await entry.setFile(file);
        } else {
            entry.deleteFile(unifiedFilenameWithKey);
            if (entry.files.length == 0) {
                state.pluginList = state.pluginList.filter((e) => e.documentPath != pathV1);
            }
        }
        const newList = state.pluginList.filter((e) => e.documentPath != entry.documentPath);
        newList.push(entry);
        state.pluginList = newList;

        state.updatePluginListV2Task?.();
    } finally {
        state.updatingV2Count--;
        pluginV2Progress.set(state.updatingV2Count);
    }
}

/**
 * Scans the database and updates the active configuration items list.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param showMessage - Whether to show progress messages.
 * @param updatedDocumentPath - Optional target document path to narrow update.
 */
export async function updatePluginList(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    showMessage: boolean,
    updatedDocumentPath?: FilePathWithPrefix
): Promise<void> {
    const settings = host.services.setting.currentSettings();
    if (!settings.usePluginSync) {
        state.pluginScanProcessor?.clearQueue();
        state.pluginList = [];
        pluginList.set(state.pluginList);
        return;
    }
    try {
        state.updatingV2Count++;
        pluginV2Progress.set(state.updatingV2Count);
        const updatedDocumentId = updatedDocumentPath ? await host.services.path.path2id(updatedDocumentPath) : "";
        const plugins = updatedDocumentPath
            ? host.services.database.localDatabase.findEntries(updatedDocumentId, updatedDocumentId + "\u{10ffff}", {
                  include_docs: true,
                  key: updatedDocumentId,
                  limit: 1,
              })
            : host.services.database.localDatabase.findEntries(ICXHeader + "", `${ICXHeader}\u{10ffff}`, {
                  include_docs: true,
              });
        for await (const v of plugins) {
            if (v.deleted || v._deleted) continue;
            if (v.path.indexOf("%") !== -1) {
                fireAndForget(() => updatePluginListV2(host, log, state, showMessage, v.path));
                continue;
            }

            const path = v.path || host.services.path.getPath(v);
            if (updatedDocumentPath && updatedDocumentPath != path) continue;
            state.pluginScanProcessor?.enqueue(v);
        }
    } finally {
        pluginIsEnumerating.set(false);
        state.updatingV2Count--;
        pluginV2Progress.set(state.updatingV2Count);
    }
    pluginIsEnumerating.set(false);
}

/**
 * Migrates configuration sync structure V1 (single monolithic metadata doc) to V2 (split documents).
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param showMessage - Whether to show progress logs in UI.
 * @param entry - The database entry to migrate.
 */
export async function migrateV1ToV2(
    host: ConfigSyncHost,
    log: LogFunction,
    showMessage: boolean,
    entry: AnyEntry
): Promise<void> {
    const v1Path = entry.path;
    log(`Migrating ${entry.path} to V2`, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
    if (entry.deleted) {
        log(`The entry ${v1Path} is already deleted`, LOG_LEVEL_VERBOSE);
        return;
    }
    if (!v1Path.endsWith(".md") && !v1Path.startsWith(ICXHeader)) {
        log(`The entry ${v1Path} is not a customisation sync binder`, LOG_LEVEL_VERBOSE);
        return;
    }
    if (v1Path.indexOf("%") !== -1) {
        log(`The entry ${v1Path} is already migrated`, LOG_LEVEL_VERBOSE);
        return;
    }
    const loadedEntry = await host.services.database.localDatabase.getDBEntry(v1Path);
    if (!loadedEntry) {
        log(`The entry ${v1Path} is not found`, LOG_LEVEL_VERBOSE);
        return;
    }

    const pluginData = deserialize(getDocDataAsArray(loadedEntry.data), {}) as PluginDataEx;
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
        log(`Migrating ${v1Path} / ${relativeFilename} to ${v2Path}`, LOG_LEVEL_VERBOSE);
        const newId = await host.services.path.path2id(v2Path);

        const data = createBlob([DUMMY_HEAD, DUMMY_END, ...getDocDataAsArray(f.data)]);

        const saving: SavingEntry = {
            ...loadedEntry,
            _rev: undefined,
            _id: newId,
            path: v2Path,
            data: data,
            datatype: "plain",
            type: "plain",
            children: [],
            eden: {},
        };
        const r = await host.services.database.localDatabase.putDBEntry(saving);
        if (r && r.ok) {
            log(`Migrated ${v1Path} / ${f.filename} to ${v2Path}`, LOG_LEVEL_INFO);
            // In typical cases, this is followed by database deletion of the old record
        }
    }
}

/**
 * Helper to recursively list files in Obsidian storage up to a given depth.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param path - The folder path.
 * @param lastDepth - Remaining depth levels to traverse.
 * @returns Array of file paths found.
 */
export async function getFiles(
    host: ConfigSyncHost,
    log: LogFunction,
    path: string,
    lastDepth: number
): Promise<string[]> {
    if (lastDepth == -1) return [];
    let w: ListedFiles;
    try {
        w = await host.context.app.vault.adapter.list(path);
    } catch (ex) {
        log(`Could not traverse(ConfigSync):${path}`, LOG_LEVEL_INFO);
        log(ex, LOG_LEVEL_VERBOSE);
        return [];
    }
    let files = [...w.files];
    for (const v of w.folders) {
        files = files.concat(await getFiles(host, log, v, lastDepth - 1));
    }
    return files;
}

/**
 * Scans internal configuration files in Obsidian storage config folder.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @returns Array of configuration file paths.
 */
export async function scanInternalFiles(host: ConfigSyncHost, log: LogFunction): Promise<FilePath[]> {
    const configDir = host.services.API.getSystemConfigDir();
    const filenames = (await getFiles(host, log, configDir, 2))
        .filter((e) => e.startsWith("."))
        .filter((e) => !e.startsWith(".trash"));
    return filenames as FilePath[];
}

/**
 * Creates a file details entry from a local storage file.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param path - Local file path.
 * @returns File descriptor details, or false if stat fails.
 */
export async function makeEntryFromFile(
    host: ConfigSyncHost,
    log: LogFunction,
    path: FilePath
): Promise<false | PluginDataExFile> {
    const stat = await host.serviceModules.storageAccess.statHidden(path);
    const configDir = host.services.API.getSystemConfigDir();
    let version: string | undefined;
    let displayName: string | undefined;
    if (!stat) {
        return false;
    }
    const contentBin = await host.serviceModules.storageAccess.readHiddenFileBinary(path);
    let content: string[];
    try {
        content = await arrayBufferToBase64(contentBin);
        if (path.toLowerCase().endsWith("/manifest.json")) {
            const v = readString(new Uint8Array(contentBin));
            try {
                const json = JSON.parse(v);
                if ("version" in json) {
                    version = `${json.version}`;
                }
                if ("name" in json) {
                    displayName = `${json.name}`;
                }
            } catch (ex) {
                log(
                    `Configuration sync data: ${path} looks like manifest, but could not read the version`,
                    LOG_LEVEL_INFO
                );
                log(ex, LOG_LEVEL_VERBOSE);
            }
        }
    } catch (ex) {
        log(`The file ${path} could not be encoded`);
        log(ex, LOG_LEVEL_VERBOSE);
        return false;
    }
    const mtime = stat.mtime;
    return {
        filename: path.substring(configDir.length + 1),
        data: content,
        mtime,
        size: stat.size,
        version,
        displayName: displayName,
    };
}

/**
 * Creates a QueueProcessor for scanning V1 plugins.
 */
export function createPluginScanProcessor(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState) {
    const settings = host.services.setting.currentSettings();
    return new QueueProcessor(
        async (v: AnyEntry[]) => {
            const plugin = v[0];
            const useV2 = settings.usePluginSyncV2;
            if (useV2) {
                await migrateV1ToV2(host, log, false, plugin);
                return [];
            }
            const path = plugin.path || host.services.path.getPath(plugin);
            const oldEntry = state.pluginList.find((e) => e.documentPath == path);
            if (oldEntry && oldEntry.mtime == plugin.mtime) return [];
            try {
                const pluginData = await loadPluginData(host, log, path);
                if (pluginData) {
                    let newList = [...state.pluginList];
                    newList = newList.filter((x) => x.documentPath != pluginData.documentPath);
                    newList.push(pluginData);
                    state.pluginList = newList;
                    pluginList.set(newList);
                }
                return [];
            } catch (ex) {
                log(`Something happened at enumerating customization :${path}`, LOG_LEVEL_NOTICE);
                log(ex, LOG_LEVEL_VERBOSE);
            }
            return [];
        },
        {
            suspended: false,
            batchSize: 1,
            concurrentLimit: 10,
            delay: 100,
            yieldThreshold: 10,
            maintainDelay: false,
            totalRemainingReactiveSource: pluginScanningCount,
        }
    ).startPipeline();
}

/**
 * Creates a QueueProcessor for scanning V2 plugins.
 */
export function createPluginScanProcessorV2(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState) {
    return new QueueProcessor(
        async (v: AnyEntry[]) => {
            const plugin = v[0];
            const path = plugin.path || host.services.path.getPath(plugin);
            const oldEntry = state.pluginList.find((e) => e.documentPath == path);
            if (oldEntry && oldEntry.mtime == plugin.mtime) return [];
            try {
                const pluginData = await loadPluginData(host, log, path);
                if (pluginData) {
                    let newList = [...state.pluginList];
                    newList = newList.filter((x) => x.documentPath != pluginData.documentPath);
                    newList.push(pluginData);
                    state.pluginList = newList;
                    pluginList.set(newList);
                }
                return [];
            } catch (ex) {
                log(`Something happened at enumerating customization :${path}`, LOG_LEVEL_NOTICE);
                log(ex, LOG_LEVEL_VERBOSE);
            }
            return [];
        },
        {
            suspended: false,
            batchSize: 1,
            concurrentLimit: 10,
            delay: 100,
            yieldThreshold: 10,
            maintainDelay: false,
            totalRemainingReactiveSource: pluginScanningCount,
        }
    ).startPipeline();
}

/**
 * Internal helper to check document content identity.
 */
async function isDocContentSame(oldData: any, newData: any): Promise<boolean> {
    try {
        const oldBlob = createBlob(oldData);
        const newBlob = createBlob(newData);
        return await isDocContentSame(oldBlob, newBlob);
    } catch {
        return false;
    }
}
