import { writable } from 'svelte/store';
import { Notice, type PluginManifest, parseYaml, normalizePath, type ListedFiles, diff_match_patch } from "../deps.ts";

import type { EntryDoc, LoadedEntry, InternalFileEntry, FilePathWithPrefix, FilePath, AnyEntry, SavingEntry, diff_result } from "../lib/src/common/types.ts";
import { CANCELLED, LEAVE_TO_SUBSEQUENT, LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, MODE_SELECTIVE, MODE_SHINY } from "../lib/src/common/types.ts";
import { ICXHeader, PERIODIC_PLUGIN_SWEEP, } from "../common/types.ts";
import { createBlob, createSavingEntryFromLoadedEntry, createTextBlob, delay, fireAndForget, getDocData, getDocDataAsArray, isDocContentSame, isLoadedEntry, isObjectDifferent } from "../lib/src/common/utils.ts";
import { Logger } from "../lib/src/common/logger.ts";
import { digestHash } from "../lib/src/string_and_binary/hash.ts";
import { arrayBufferToBase64, decodeBinary, readString } from 'src/lib/src/string_and_binary/convert.ts';
import { serialized, shareRunningResult } from "../lib/src/concurrency/lock.ts";
import { LiveSyncCommands } from "./LiveSyncCommands.ts";
import { stripAllPrefixes } from "../lib/src/string_and_binary/path.ts";
import { EVEN, PeriodicProcessor, disposeMemoObject, isMarkedAsSameChanges, markChangesAreSame, memoIfNotExist, memoObject, retrieveMemoObject, scheduleTask } from "../common/utils.ts";
import { PluginDialogModal } from "../common/dialogs.ts";
import { JsonResolveModal } from "../ui/JsonResolveModal.ts";
import { QueueProcessor } from '../lib/src/concurrency/processor.ts';
import { pluginScanningCount } from '../lib/src/mock_and_interop/stores.ts';
import type ObsidianLiveSyncPlugin from '../main.ts';
import { base64ToArrayBuffer, base64ToString } from 'octagonal-wheels/binary/base64';
import { ConflictResolveModal } from '../ui/ConflictResolveModal.ts';
import { Semaphore } from 'octagonal-wheels/concurrency/semaphore';

const d = "\u200b";
const d2 = "\n";

function serialize(data: PluginDataEx): string {
    // For higher performance, create custom plug-in data strings.
    // Self-hosted LiveSync uses `\n` to split chunks. Therefore, grouping together those with similar entropy would work nicely.
    let ret = "";
    ret += ":";
    ret += data.category + d + data.name + d + data.term + d2;
    ret += (data.version ?? "") + d2;
    ret += data.mtime + d2;
    for (const file of data.files) {
        ret += file.filename + d + (file.displayName ?? "") + d + (file.version ?? "") + d2;
        const hash = digestHash((file.data ?? []));
        ret += file.mtime + d + file.size + d + hash + d2;
        for (const data of file.data ?? []) {
            ret += data + d
        }
        ret += d2;
    }
    return ret;
}
const DUMMY_HEAD = serialize({
    category: "CONFIG",
    name: "migrated",
    files: [],
    mtime: 0,
    term: "-",
    displayName: `MIRAGED`
});
const DUMMY_END = d + d2 + "\u200c";
function splitWithDelimiters(sources: string[]): string[] {
    const result: string[] = [];
    for (const str of sources) {
        let startIndex = 0;
        const maxLen = str.length;
        let i = -1;
        let i1;
        let i2;
        do {
            i1 = str.indexOf(d, startIndex);
            i2 = str.indexOf(d2, startIndex);
            if (i1 == -1 && i2 == -1) {
                break;
            }
            if (i1 == -1) {
                i = i2;
            } else if (i2 == -1) {
                i = i1;
            } else {
                i = i1 < i2 ? i1 : i2;
            }
            result.push(str.slice(startIndex, i + 1));
            startIndex = i + 1;
        } while (i < maxLen);
        if (startIndex < maxLen) {
            result.push(str.slice(startIndex));
        }
    }

    // To keep compatibilities
    if (sources[sources.length - 1] == "") {
        result.push("");
    }

    return result;
}

function getTokenizer(source: string[]) {
    const sources = splitWithDelimiters(source);
    sources[0] = sources[0].substring(1);
    let pos = 0;
    let lineRunOut = false;
    const t = {
        next(): string {
            if (lineRunOut) {
                return "";
            }
            if (pos >= sources.length) {
                return "";
            }
            const item = sources[pos];
            if (!item.endsWith(d2)) {
                pos++;
            } else {
                lineRunOut = true;
            }
            if (item.endsWith(d) || item.endsWith(d2)) {
                return item.substring(0, item.length - 1);
            } else {
                return item + this.next();
            }
        },
        nextLine() {
            if (lineRunOut) {
                pos++;
            } else {
                while (!sources[pos].endsWith(d2)) {
                    pos++;
                    if (pos >= sources.length) break;
                }
                pos++;
            }
            lineRunOut = false;
        }
    }
    return t;
}

function deserialize2(str: string[]): PluginDataEx {
    const tokens = getTokenizer(str);
    const ret = {} as PluginDataEx;
    const category = tokens.next();
    const name = tokens.next();
    const term = tokens.next();
    tokens.nextLine();
    const version = tokens.next();
    tokens.nextLine();
    const mtime = Number(tokens.next());
    tokens.nextLine();
    const result: PluginDataEx = Object.assign(ret,
        { category, name, term, version, mtime, files: [] as PluginDataExFile[] })
    let filename = "";
    do {
        filename = tokens.next();
        if (!filename) break;
        const displayName = tokens.next();
        const version = tokens.next();
        tokens.nextLine();
        const mtime = Number(tokens.next());
        const size = Number(tokens.next());
        const hash = tokens.next();
        tokens.nextLine();
        const data = [] as string[];
        let piece = "";
        do {
            piece = tokens.next();
            if (piece == "") break;
            data.push(piece);
        } while (piece != "");
        result.files.push(
            {
                filename,
                displayName,
                version,
                mtime,
                size,
                data,
                hash
            }
        )
        tokens.nextLine();
    } while (filename);
    return result;
}

function deserialize<T>(str: string[], def: T) {
    try {
        if (str[0][0] == ":") {
            const o = deserialize2(str);
            return o;
        }
        return JSON.parse(str.join("")) as T;
    } catch (ex) {
        try {
            return parseYaml(str.join(""));
        } catch (ex) {
            return def;
        }
    }
}


export const pluginList = writable([] as PluginDataExDisplay[]);
export const pluginIsEnumerating = writable(false);
export const pluginV2Progress = writable(0);

export type PluginDataExFile = {
    filename: string,
    data: string[],
    mtime: number,
    size: number,
    version?: string,
    hash?: string,
    displayName?: string,
}
export interface IPluginDataExDisplay {
    documentPath: FilePathWithPrefix;
    category: string;
    name: string;
    term: string;
    displayName?: string;
    files: (LoadedEntryPluginDataExFile | PluginDataExFile)[];
    version?: string;
    mtime: number;
}
export type PluginDataExDisplay = {
    documentPath: FilePathWithPrefix,
    category: string,
    name: string,
    term: string,
    displayName?: string,
    files: PluginDataExFile[],
    version?: string,
    mtime: number,
}
type LoadedEntryPluginDataExFile = LoadedEntry & PluginDataExFile;

function categoryToFolder(category: string, configDir: string = ""): string {
    switch (category) {
        case "CONFIG": return `${configDir}/`;
        case "THEME": return `${configDir}/themes/`;
        case "SNIPPET": return `${configDir}/snippets/`;
        case "PLUGIN_MAIN": return `${configDir}/plugins/`;
        case "PLUGIN_DATA": return `${configDir}/plugins/`;
        case "PLUGIN_ETC": return `${configDir}/plugins/`;
        default: return "";
    }
}

export const pluginManifests = new Map<string, PluginManifest>();
export const pluginManifestStore = writable(pluginManifests);

function setManifest(key: string, manifest: PluginManifest) {
    const old = pluginManifests.get(key);
    if (old && !isObjectDifferent(manifest, old)) {
        return;
    }
    pluginManifests.set(key, manifest);
    pluginManifestStore.set(pluginManifests);
}

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
        this.files = [...data.files as LoadedEntryPluginDataExFile[]];
        this.confKey = `${categoryToFolder(this.category, this.term)}${this.name}`;
        this.applyLoadedManifest();
    }
    async setFile(file: LoadedEntryPluginDataExFile) {
        const old = this.files.find(e => e.filename == file.filename);
        if (old) {
            if (old.mtime == file.mtime && await isDocContentSame(old.data, file.data)) return;
            this.files = this.files.filter(e => e.filename != file.filename);
        }
        this.files.push(file);
        if (file.filename == "manifest.json") {
            this.applyLoadedManifest();
        }
    }
    deleteFile(filename: string) {
        this.files = this.files.filter(e => e.filename != filename);
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
        // if (this._displayNameBuffer !== symbolUnInitialised) return this._displayNameBuffer;
        // return this._bufferManifest().displayName;
        return this._displayName || this.name;
    }
    get version(): string | undefined {
        return this._version;
    }
    get mtime(): number {
        return ~~this.files.reduce((a, b) => a + b.mtime, 0) / this.files.length;
    }
}
export type PluginDataEx = {
    documentPath?: FilePathWithPrefix,
    category: string,
    name: string,
    displayName?: string,
    term: string,
    files: PluginDataExFile[],
    version?: string,
    mtime: number,
};

export class ConfigSync extends LiveSyncCommands {
    constructor(plugin: ObsidianLiveSyncPlugin) {
        super(plugin);
        pluginScanningCount.onChanged((e) => {
            const total = e.value;
            pluginIsEnumerating.set(total != 0);
        })
    }
    get kvDB() {
        return this.plugin.kvDB;
    }

    get useV2() {
        return this.plugin.settings.usePluginSyncV2;
    }
    get useSyncPluginEtc() {
        return this.plugin.settings.usePluginEtc;
    }

    pluginDialog?: PluginDialogModal = undefined;
    periodicPluginSweepProcessor = new PeriodicProcessor(this.plugin, async () => await this.scanAllConfigFiles(false));

    pluginList: IPluginDataExDisplay[] = [];
    showPluginSyncModal() {
        if (!this.settings.usePluginSync) {
            return;
        }
        if (this.pluginDialog) {
            this.pluginDialog.open();
        } else {
            this.pluginDialog = new PluginDialogModal(this.app, this.plugin);
            this.pluginDialog.open();
        }
    }

    hidePluginSyncModal() {
        if (this.pluginDialog != null) {
            this.pluginDialog.close();
            this.pluginDialog = undefined;
        }
    }
    onunload() {
        this.hidePluginSyncModal();
        this.periodicPluginSweepProcessor?.disable();
    }
    onload() {
        this.plugin.addCommand({
            id: "livesync-plugin-dialog-ex",
            name: "Show customization sync dialog",
            callback: () => {
                this.showPluginSyncModal();
            },
        });
    }

    getFileCategory(filePath: string): "CONFIG" | "THEME" | "SNIPPET" | "PLUGIN_MAIN" | "PLUGIN_ETC" | "PLUGIN_DATA" | "" {
        if (filePath.split("/").length == 2 && filePath.endsWith(".json")) return "CONFIG";
        if (filePath.split("/").length == 4 && filePath.startsWith(`${this.app.vault.configDir}/themes/`)) return "THEME";
        if (filePath.startsWith(`${this.app.vault.configDir}/snippets/`) && filePath.endsWith(".css")) return "SNIPPET";
        if (filePath.startsWith(`${this.app.vault.configDir}/plugins/`)) {
            if (filePath.endsWith("/styles.css") || filePath.endsWith("/manifest.json") || filePath.endsWith("/main.js")) {
                return "PLUGIN_MAIN";
            } else if (filePath.endsWith("/data.json")) {
                return "PLUGIN_DATA";
            } else {
                // Planned at v0.19.0, realised v0.23.18!
                return (this.useV2 && this.useSyncPluginEtc) ? "PLUGIN_ETC" : "";
            }
            // return "PLUGIN";
        }
        return "";
    }
    isTargetPath(filePath: string): boolean {
        if (!filePath.startsWith(this.app.vault.configDir)) return false;
        // Idea non-filter option?
        return this.getFileCategory(filePath) != "";
    }
    async onInitializeDatabase(showNotice: boolean) {
        if (this.settings.usePluginSync) {
            try {
                Logger("Scanning customizations...");
                await this.scanAllConfigFiles(showNotice);
                Logger("Scanning customizations : done");
            } catch (ex) {
                Logger("Scanning customizations : failed");
                Logger(ex, LOG_LEVEL_VERBOSE);
            }

        }
    }
    async beforeReplicate(showNotice: boolean) {
        if (this.settings.autoSweepPlugins && this.settings.usePluginSync) {
            await this.scanAllConfigFiles(showNotice);
        }
    }
    async onResume() {
        if (this.plugin.suspended) {
            return;
        }
        if (this.settings.autoSweepPlugins && this.settings.usePluginSync) {
            await this.scanAllConfigFiles(false);
        }
        this.periodicPluginSweepProcessor.enable(this.settings.autoSweepPluginsPeriodic && !this.settings.watchInternalFileChanges ? (PERIODIC_PLUGIN_SWEEP * 1000) : 0);

    }
    async reloadPluginList(showMessage: boolean) {
        this.pluginList = [];
        this.loadedManifest_mTime.clear();
        pluginList.set(this.pluginList)
        await this.updatePluginList(showMessage);
    }
    async loadPluginData(path: FilePathWithPrefix): Promise<PluginDataExDisplay | false> {
        const wx = await this.localDatabase.getDBEntry(path, undefined, false, false);
        if (wx) {
            const data = deserialize(getDocDataAsArray(wx.data), {}) as PluginDataEx;
            const xFiles = [] as PluginDataExFile[];
            let missingHash = false;
            for (const file of data.files) {
                const work = { ...file, data: [] as string[] };
                if (!file.hash) {
                    // debugger;
                    const tempStr = getDocDataAsArray(work.data);
                    const hash = digestHash(tempStr);
                    file.hash = hash;
                    missingHash = true;
                }
                work.data = [file.hash];
                xFiles.push(work);
            }
            if (missingHash) {
                Logger(`Digest created for ${path} to improve checking`, LOG_LEVEL_VERBOSE);
                wx.data = serialize(data);
                fireAndForget(() => this.localDatabase.putDBEntry(createSavingEntryFromLoadedEntry(wx)));
            }
            return ({
                ...data,
                documentPath: this.getPath(wx),
                files: xFiles
            }) as PluginDataExDisplay;
        }
        return false;
    }

    pluginScanProcessor = new QueueProcessor(async (v: AnyEntry[]) => {
        const plugin = v[0];
        if (this.useV2) {
            await this.migrateV1ToV2(false, plugin);
            return [];
        }
        const path = plugin.path || this.getPath(plugin);
        const oldEntry = (this.pluginList.find(e => e.documentPath == path));
        if (oldEntry && oldEntry.mtime == plugin.mtime) return [];
        try {
            const pluginData = await this.loadPluginData(path);
            if (pluginData) {
                let newList = [...this.pluginList];
                newList = newList.filter(x => x.documentPath != pluginData.documentPath);
                newList.push(pluginData);
                this.pluginList = newList;
                pluginList.set(newList);
            }
            // Failed to load
            return [];

        } catch (ex) {
            Logger(`Something happened at enumerating customization :${path}`, LOG_LEVEL_NOTICE);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
        return [];
    }, { suspended: false, batchSize: 1, concurrentLimit: 10, delay: 100, yieldThreshold: 10, maintainDelay: false, totalRemainingReactiveSource: pluginScanningCount }).startPipeline();

    pluginScanProcessorV2 = new QueueProcessor(async (v: AnyEntry[]) => {
        const plugin = v[0];
        const path = plugin.path || this.getPath(plugin);
        const oldEntry = (this.pluginList.find(e => e.documentPath == path));
        if (oldEntry && oldEntry.mtime == plugin.mtime) return [];
        try {
            const pluginData = await this.loadPluginData(path);
            if (pluginData) {
                let newList = [...this.pluginList];
                newList = newList.filter(x => x.documentPath != pluginData.documentPath);
                newList.push(pluginData);
                this.pluginList = newList;
                pluginList.set(newList);
            }
            // Failed to load
            return [];

        } catch (ex) {
            Logger(`Something happened at enumerating customization :${path}`, LOG_LEVEL_NOTICE);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
        return [];
    }, { suspended: false, batchSize: 1, concurrentLimit: 10, delay: 100, yieldThreshold: 10, maintainDelay: false, totalRemainingReactiveSource: pluginScanningCount }).startPipeline();


    filenameToUnifiedKey(path: string, termOverRide?: string) {
        const term = termOverRide || this.plugin.deviceAndVaultName;
        const category = this.getFileCategory(path);
        const name = (category == "CONFIG" || category == "SNIPPET") ?
            (path.split("/").slice(-1)[0]) :
            (category == "PLUGIN_ETC" ?
                path.split("/").slice(-2).join("/") :
                path.split("/").slice(-2)[0]);
        return `${ICXHeader}${term}/${category}/${name}.md` as FilePathWithPrefix
    }

    filenameWithUnifiedKey(path: string, termOverRide?: string) {
        const term = termOverRide || this.plugin.deviceAndVaultName;
        const category = this.getFileCategory(path);
        const name = (category == "CONFIG" || category == "SNIPPET") ?
            (path.split("/").slice(-1)[0]) : path.split("/").slice(-2)[0];
        const baseName = category == "CONFIG" || category == "SNIPPET" ? name : path.split("/").slice(3).join("/");
        return `${ICXHeader}${term}/${category}/${name}%${baseName}` as FilePathWithPrefix;
    }

    unifiedKeyPrefixOfTerminal(termOverRide?: string) {
        const term = termOverRide || this.plugin.deviceAndVaultName;
        return `${ICXHeader}${term}/` as FilePathWithPrefix;
    }

    parseUnifiedPath(unifiedPath: FilePathWithPrefix): { category: string, device: string, key: string, filename: string, pathV1: FilePathWithPrefix } {
        const [device, category, ...rest] = stripAllPrefixes(unifiedPath).split("/");
        const relativePath = rest.join("/");
        const [key, filename] = relativePath.split("%");
        const pathV1 = (unifiedPath.split("%")[0] + ".md") as FilePathWithPrefix;
        return { device, category, key, filename, pathV1 };
    }

    loadedManifest_mTime = new Map<string, number>();

    async createPluginDataExFileV2(unifiedPathV2: FilePathWithPrefix, loaded?: LoadedEntry): Promise<false | LoadedEntryPluginDataExFile> {
        const { category, key, filename, device } = this.parseUnifiedPath(unifiedPathV2);
        if (!loaded) {
            const d = await this.localDatabase.getDBEntry(unifiedPathV2);
            if (!d) {
                Logger(`The file ${unifiedPathV2} is not found`, LOG_LEVEL_VERBOSE);
                return false;
            }
            if (!isLoadedEntry(d)) {
                Logger(`The file ${unifiedPathV2} is not a note`, LOG_LEVEL_VERBOSE);
                return false;
            }
            loaded = d;
        }
        const confKey = `${categoryToFolder(category, device)}${key}`;
        const relativeFilename = `${categoryToFolder(category, "")}${(category == "CONFIG" || category == "SNIPPET") ? "" : (key + "/")}${filename}`.substring(1);
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
            // Same as previously loaded
            if (this.loadedManifest_mTime.get(confKey) != file.mtime && pluginManifests.get(confKey) == undefined) {
                try {
                    const parsedManifest = JSON.parse(base64ToString(data)) as PluginManifest;
                    setManifest(confKey, parsedManifest);
                    this.pluginList.filter(e => e instanceof PluginDataExDisplayV2 && e.confKey == confKey).forEach(e => (e as PluginDataExDisplayV2).applyLoadedManifest());
                    pluginList.set(this.pluginList);
                } catch (ex) {
                    Logger(`The file ${loaded.path} seems to manifest, but could not be decoded as JSON`, LOG_LEVEL_VERBOSE);
                    Logger(ex, LOG_LEVEL_VERBOSE);
                }
                this.loadedManifest_mTime.set(confKey, file.mtime);
            } else {
                this.pluginList.filter(e => e instanceof PluginDataExDisplayV2 && e.confKey == confKey).forEach(e => (e as PluginDataExDisplayV2).applyLoadedManifest());
                pluginList.set(this.pluginList);
            }
            // }
        }
        return file;

    }
    createPluginDataFromV2(unifiedPathV2: FilePathWithPrefix) {
        const { category, device, key, pathV1 } = this.parseUnifiedPath(unifiedPathV2);
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


    updatingV2Count = 0;

    async updatePluginListV2(showMessage: boolean, unifiedFilenameWithKey: FilePathWithPrefix): Promise<void> {
        try {
            this.updatingV2Count++;
            pluginV2Progress.set(this.updatingV2Count);
            // const unifiedFilenameWithKey = this.filenameWithUnifiedKey(updatedDocumentPath);
            const { pathV1 } = this.parseUnifiedPath(unifiedFilenameWithKey);

            const oldEntry = this.pluginList.find(e => e.documentPath == pathV1);
            let entry: PluginDataExDisplayV2 | undefined = undefined;

            if (!oldEntry || !(oldEntry instanceof PluginDataExDisplayV2)) {
                const newEntry = this.createPluginDataFromV2(unifiedFilenameWithKey);
                if (newEntry) {
                    entry = newEntry;
                }
            } else if (oldEntry instanceof PluginDataExDisplayV2) {
                entry = oldEntry;
            }
            if (!entry) return;
            const file = await this.createPluginDataExFileV2(unifiedFilenameWithKey);
            if (file) {
                await entry.setFile(file);
            } else {
                entry.deleteFile(unifiedFilenameWithKey);
                if (entry.files.length == 0) {
                    this.pluginList = this.pluginList.filter(e => e.documentPath != pathV1);
                }
            }
            const newList = this.pluginList.filter(e => e.documentPath != entry.documentPath);
            newList.push(entry);
            this.pluginList = newList;

            scheduleTask("updatePluginListV2", 100, () => {
                pluginList.set(this.pluginList);
            });
        } finally {
            this.updatingV2Count--;
            pluginV2Progress.set(this.updatingV2Count);
        }
    }

    async migrateV1ToV2(showMessage: boolean, entry: AnyEntry): Promise<void> {
        const v1Path = entry.path;
        Logger(`Migrating ${entry.path} to V2`, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        if (entry.deleted) {
            Logger(`The entry ${v1Path} is already deleted`, LOG_LEVEL_VERBOSE);
            return;
        }
        if (!v1Path.endsWith(".md") && !v1Path.startsWith(ICXHeader)) {
            Logger(`The entry ${v1Path} is not a customisation sync binder`, LOG_LEVEL_VERBOSE);
            return
        }
        if (v1Path.indexOf("%") !== -1) {
            Logger(`The entry ${v1Path} is already migrated`, LOG_LEVEL_VERBOSE);
            return;
        }
        const loadedEntry = await this.localDatabase.getDBEntry(v1Path);
        if (!loadedEntry) {
            Logger(`The entry ${v1Path} is not found`, LOG_LEVEL_VERBOSE);
            return;
        }

        const pluginData = deserialize(getDocDataAsArray(loadedEntry.data), {}) as PluginDataEx;
        const prefixPath = v1Path.slice(0, -(".md".length)) + "%";
        const category = pluginData.category;

        for (const f of pluginData.files) {
            const stripTable: Record<string, number> = {
                "CONFIG": 0,
                "THEME": 2,
                "SNIPPET": 1,
                "PLUGIN_MAIN": 2,
                "PLUGIN_DATA": 2,
                "PLUGIN_ETC": 2,
            }
            const deletePrefixCount = stripTable?.[category] ?? 1;
            const relativeFilename = f.filename.split("/").slice(deletePrefixCount).join("/");
            const v2Path = (prefixPath + relativeFilename) as FilePathWithPrefix;
            // console.warn(`Migrating ${v1Path} / ${relativeFilename} to ${v2Path}`);
            Logger(`Migrating ${v1Path} / ${relativeFilename} to ${v2Path}`, LOG_LEVEL_VERBOSE);
            const newId = await this.plugin.path2id(v2Path);
            // const buf = 

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
                eden: {}
            }
            const r = await this.plugin.localDatabase.putDBEntry(saving);
            if (r && r.ok) {
                Logger(`Migrated ${v1Path} / ${f.filename} to ${v2Path}`, LOG_LEVEL_INFO);
                const delR = await this.deleteConfigOnDatabase(v1Path);
                if (delR) {
                    Logger(`Deleted ${v1Path} successfully`, LOG_LEVEL_INFO);
                } else {
                    Logger(`Failed to delete ${v1Path}`, LOG_LEVEL_NOTICE);
                }
            }
        }
    }

    async updatePluginList(showMessage: boolean, updatedDocumentPath?: FilePathWithPrefix): Promise<void> {
        if (!this.settings.usePluginSync) {
            this.pluginScanProcessor.clearQueue();
            this.pluginList = [];
            pluginList.set(this.pluginList)
            return;
        }
        try {
            this.updatingV2Count++;
            pluginV2Progress.set(this.updatingV2Count);
            const updatedDocumentId = updatedDocumentPath ? await this.path2id(updatedDocumentPath) : "";
            const plugins = updatedDocumentPath ?
                this.localDatabase.findEntries(updatedDocumentId, updatedDocumentId + "\u{10ffff}", { include_docs: true, key: updatedDocumentId, limit: 1 }) :
                this.localDatabase.findEntries(ICXHeader + "", `${ICXHeader}\u{10ffff}`, { include_docs: true });
            for await (const v of plugins) {
                if (v.deleted || v._deleted) continue;
                if (v.path.indexOf("%") !== -1) {
                    fireAndForget(() => this.updatePluginListV2(showMessage, v.path));
                    continue;
                }

                const path = v.path || this.getPath(v);
                if (updatedDocumentPath && updatedDocumentPath != path) continue;
                this.pluginScanProcessor.enqueue(v);

            }
        } finally {
            pluginIsEnumerating.set(false);
            this.updatingV2Count--;
            pluginV2Progress.set(this.updatingV2Count);
        }
        pluginIsEnumerating.set(false);
        // return entries;
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
        }
        const fileA = await loadFile(dataA);
        const fileB = await loadFile(dataB);
        Logger(`Comparing: ${dataA.documentPath} <-> ${dataB.documentPath}`, LOG_LEVEL_VERBOSE);
        if (!fileA || !fileB) {
            Logger(`Could not load ${dataA.name} for comparison: ${!fileA ? dataA.term : ""}${!fileB ? dataB.term : ""}`, LOG_LEVEL_NOTICE);
            return false;
        }
        let path = stripAllPrefixes(fileA.path.split("/").slice(-1).join("/") as FilePath); // TODO:adjust
        if (path.indexOf("%") !== -1) {
            path = path.split("%")[1] as FilePath;
        }
        if (fileA.path.endsWith(".json")) {
            return serialized("config:merge-data", () => new Promise<boolean>((res) => {
                Logger("Opening data-merging dialog", LOG_LEVEL_VERBOSE);
                // const docs = [docA, docB];
                const modal = new JsonResolveModal(this.app, path, [fileA, fileB], async (keep, result) => {
                    if (result == null) return res(false);
                    try {
                        res(await this.applyData(dataA, result));
                    } catch (ex) {
                        Logger("Could not apply merged file");
                        Logger(ex, LOG_LEVEL_VERBOSE);
                        res(false);
                    }
                }, "Local", `${dataB.term}`, "B", true, true, "Difference between local and remote");
                modal.open();
            }));
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
                diff: diff
            }
            console.dir(diffResult);
            const d = new ConflictResolveModal(this.app, path, diffResult, true, dataB.term);
            d.open();
            const ret = await d.waitForResult();
            if (ret === CANCELLED) return false;
            if (ret === LEAVE_TO_SUBSEQUENT) return false;
            const resultContent = ret == "A" ? docAData : ret == "B" ? docBData : undefined;
            if (resultContent) {
                return await this.applyData(dataA, resultContent);
            }
            return false;
        }
    }
    async applyDataV2(data: PluginDataExDisplayV2, content?: string): Promise<boolean> {
        const baseDir = this.app.vault.configDir;
        try {
            if (content) {
                // const dt = createBlob(content);
                const filename = data.files[0].filename;
                Logger(`Applying ${filename} of ${data.displayName || data.name}..`);
                const path = `${baseDir}/${filename}` as FilePath;
                await this.vaultAccess.ensureDirectory(path);
                // If the content has applied, modified time will be updated to the current time.
                await this.vaultAccess.adapterWrite(path, content);
                await this.storeCustomisationFileV2(path, this.plugin.deviceAndVaultName);

            } else {
                const files = data.files;
                for (const f of files) {
                    // If files have applied, modified time will be updated to the current time.
                    const stat = { mtime: f.mtime, ctime: f.ctime };
                    const path = `${baseDir}/${f.filename}` as FilePath;
                    Logger(`Applying ${f.filename} of ${data.displayName || data.name}..`);
                    // const contentEach = createBlob(f.data);
                    this.vaultAccess.ensureDirectory(path);

                    if (f.datatype == "newnote") {
                        let oldData;
                        try {
                            oldData = await this.vaultAccess.adapterReadBinary(path);
                        } catch (ex) {
                            oldData = new ArrayBuffer(0);
                        }
                        const content = base64ToArrayBuffer(f.data);
                        if (await isDocContentSame(oldData, content)) {
                            Logger(`The file ${f.filename} is already up-to-date`, LOG_LEVEL_VERBOSE);
                            continue;
                        }
                        await this.vaultAccess.adapterWrite(path, content, stat);
                    } else {
                        let oldData;
                        try {
                            oldData = await this.vaultAccess.adapterRead(path);
                        } catch (ex) {
                            oldData = "";
                        }
                        const content = getDocData(f.data);
                        if (await isDocContentSame(oldData, content)) {
                            Logger(`The file ${f.filename} is already up-to-date`, LOG_LEVEL_VERBOSE);
                            continue;
                        }
                        await this.vaultAccess.adapterWrite(path, content, stat);
                    }
                    Logger(`Applied ${f.filename} of ${data.displayName || data.name}..`);
                    await this.storeCustomisationFileV2(path, this.plugin.deviceAndVaultName);
                }
            }
        } catch (ex) {
            Logger(`Applying ${data.displayName || data.name}.. Failed`, LOG_LEVEL_NOTICE);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
        return true;
    }
    async applyData(data: IPluginDataExDisplay, content?: string): Promise<boolean> {
        Logger(`Applying ${data.displayName || data.name
            }..`);

        if (data instanceof PluginDataExDisplayV2) {
            return this.applyDataV2(data, content);
        }
        const baseDir = this.app.vault.configDir;
        try {
            if (!data.documentPath) throw "InternalError: Document path not exist";
            const dx = await this.localDatabase.getDBEntry(data.documentPath);
            if (dx == false) {
                throw "Not found on database"
            }
            const loadedData = deserialize(getDocDataAsArray(dx.data), {}) as PluginDataEx;
            for (const f of loadedData.files) {
                Logger(`Applying ${f.filename} of ${data.displayName || data.name}..`);
                try {
                    // console.dir(f);
                    const path = `${baseDir}/${f.filename}`;
                    await this.vaultAccess.ensureDirectory(path);
                    if (!content) {
                        const dt = decodeBinary(f.data);
                        await this.vaultAccess.adapterWrite(path, dt);
                    } else {
                        await this.vaultAccess.adapterWrite(path, content);
                    }
                    Logger(`Applying ${f.filename} of ${data.displayName || data.name}.. Done`);

                } catch (ex) {
                    Logger(`Applying ${f.filename} of ${data.displayName || data.name}.. Failed`);
                    Logger(ex, LOG_LEVEL_VERBOSE);
                }

            }
            const uPath = `${baseDir}/${loadedData.files[0].filename}` as FilePath;
            await this.storeCustomizationFiles(uPath);
            await this.updatePluginList(true, uPath);
            await delay(100);
            Logger(`Config ${data.displayName || data.name} has been applied`, LOG_LEVEL_NOTICE);
            if (data.category == "PLUGIN_DATA" || data.category == "PLUGIN_MAIN") {
                //@ts-ignore
                const manifests = Object.values(this.app.plugins.manifests) as any as PluginManifest[];
                //@ts-ignore
                const enabledPlugins = this.app.plugins.enabledPlugins as Set<string>;
                const pluginManifest = manifests.find((manifest) => enabledPlugins.has(manifest.id) && manifest.dir == `${baseDir}/plugins/${data.name}`);
                if (pluginManifest) {
                    Logger(`Unloading plugin: ${pluginManifest.name}`, LOG_LEVEL_NOTICE, "plugin-reload-" + pluginManifest.id);
                    // @ts-ignore
                    await this.app.plugins.unloadPlugin(pluginManifest.id);
                    // @ts-ignore
                    await this.app.plugins.loadPlugin(pluginManifest.id);
                    Logger(`Plugin reloaded: ${pluginManifest.name}`, LOG_LEVEL_NOTICE, "plugin-reload-" + pluginManifest.id);
                }
            } else if (data.category == "CONFIG") {
                this.plugin.askReload();
            }
            return true;
        } catch (ex) {
            Logger(`Applying ${data.displayName || data.name}.. Failed`);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    async deleteData(data: PluginDataEx): Promise<boolean> {
        try {
            if (data.documentPath) {
                const delList = [];
                if (this.useV2) {
                    const deleteList = this.pluginList.filter(e => e.documentPath == data.documentPath).filter(e => e instanceof PluginDataExDisplayV2).map(e => e.files).flat();
                    for (const e of deleteList) {
                        delList.push(e.path);
                    }
                }
                delList.push(data.documentPath);
                const p = delList.map(async e => {
                    await this.deleteConfigOnDatabase(e);
                    await this.updatePluginList(false, e)
                });
                await Promise.allSettled(p);
                // await this.deleteConfigOnDatabase(data.documentPath);
                // await this.updatePluginList(false, data.documentPath);
                Logger(`Deleted: ${data.category}/${data.name} of ${data.category} (${delList.length} items)`, LOG_LEVEL_NOTICE);
            }
            return true;
        } catch (ex) {
            Logger(`Failed to delete: ${data.documentPath}`, LOG_LEVEL_NOTICE);
            return false;

        }
    }
    async parseReplicationResultItem(docs: PouchDB.Core.ExistingDocument<EntryDoc>) {
        if (docs._id.startsWith(ICXHeader)) {
            if (this.plugin.settings.usePluginSync) {
                await this.updatePluginList(false, (docs as AnyEntry).path ? (docs as AnyEntry).path : this.getPath((docs as AnyEntry)));
            }
            if (this.plugin.settings.usePluginSync && this.plugin.settings.notifyPluginOrSettingUpdated) {
                if (!this.pluginDialog || (this.pluginDialog && !this.pluginDialog.isOpened())) {
                    const fragment = createFragment((doc) => {
                        doc.createEl("span", undefined, (a) => {
                            a.appendText(`Some configuration has been arrived, Press `);
                            a.appendChild(a.createEl("a", undefined, (anchor) => {
                                anchor.text = "HERE";
                                anchor.addEventListener("click", () => {
                                    this.showPluginSyncModal();
                                });
                            }));

                            a.appendText(` to open the config sync dialog , or press elsewhere to dismiss this message.`);
                        });
                    });

                    const updatedPluginKey = "popupUpdated-plugins";
                    scheduleTask(updatedPluginKey, 1000, async () => {
                        const popup = await memoIfNotExist(updatedPluginKey, () => new Notice(fragment, 0));
                        //@ts-ignore
                        const isShown = popup?.noticeEl?.isShown();
                        if (!isShown) {
                            memoObject(updatedPluginKey, new Notice(fragment, 0));
                        }
                        scheduleTask(updatedPluginKey + "-close", 20000, () => {
                            const popup = retrieveMemoObject<Notice>(updatedPluginKey);
                            if (!popup)
                                return;
                            //@ts-ignore
                            if (popup?.noticeEl?.isShown()) {
                                popup.hide();
                            }
                            disposeMemoObject(updatedPluginKey);
                        });
                    });
                }
            }
            return true;
        }
        return false;
    }
    async realizeSettingSyncMode(): Promise<void> {
        this.periodicPluginSweepProcessor?.disable();
        if (this.plugin.suspended)
            return;
        if (!this.settings.usePluginSync) {
            return;
        }
        if (this.settings.autoSweepPlugins) {
            await this.scanAllConfigFiles(false);
        }
        this.periodicPluginSweepProcessor.enable(this.settings.autoSweepPluginsPeriodic && !this.settings.watchInternalFileChanges ? (PERIODIC_PLUGIN_SWEEP * 1000) : 0);
        return;
    }

    recentProcessedInternalFiles = [] as string[];
    async makeEntryFromFile(path: FilePath): Promise<false | PluginDataExFile> {
        const stat = await this.vaultAccess.adapterStat(path);
        let version: string | undefined;
        let displayName: string | undefined;
        if (!stat) {
            return false;
        }
        const contentBin = await this.vaultAccess.adapterReadBinary(path);
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
                    Logger(`Configuration sync data: ${path} looks like manifest, but could not read the version`, LOG_LEVEL_INFO);
                }
            }
        } catch (ex) {
            Logger(`The file ${path} could not be encoded`);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
        const mtime = stat.mtime;
        return {
            filename: path.substring(this.app.vault.configDir.length + 1),
            data: content,
            mtime,
            size: stat.size,
            version,
            displayName: displayName,
        }
    }


    async storeCustomisationFileV2(path: FilePath, term: string, force = false) {
        const vf = this.filenameWithUnifiedKey(path, term);
        return await serialized(`plugin-${vf}`, async () => {
            const prefixedFileName = vf;

            const id = await this.path2id(prefixedFileName);
            const stat = await this.vaultAccess.adapterStat(path);
            if (!stat) {
                return false;
            }
            const mtime = stat.mtime;
            const content = await this.vaultAccess.adapterReadBinary(path);
            const contentBlob = createBlob([DUMMY_HEAD, DUMMY_END, ...await arrayBufferToBase64(content)]);
            // const contentBlob = createBlob(content);
            try {
                const old = await this.localDatabase.getDBEntryMeta(prefixedFileName, undefined, false);
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
                        eden: {}
                    };
                } else {
                    if (isMarkedAsSameChanges(prefixedFileName, [old.mtime, mtime + 1]) == EVEN) {
                        Logger(`STORAGE --> DB:${prefixedFileName}: (config) Skipped (Already checked the same)`, LOG_LEVEL_DEBUG);
                        return;
                    }
                    const docXDoc = await this.localDatabase.getDBEntryFromMeta(old, {}, false, false);
                    if (docXDoc == false) {
                        throw "Could not load the document";
                    }
                    const dataSrc = getDocData(docXDoc.data);
                    const dataStart = dataSrc.indexOf(DUMMY_END);
                    const oldContent = dataSrc.substring(dataStart + DUMMY_END.length);
                    const oldContentArray = base64ToArrayBuffer(oldContent);
                    if (await isDocContentSame(oldContentArray, content)) {
                        Logger(`STORAGE --> DB:${prefixedFileName}: (config) Skipped (the same content)`, LOG_LEVEL_VERBOSE);
                        markChangesAreSame(prefixedFileName, old.mtime, mtime + 1);
                        return true;
                    }
                    saveData =
                    {
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
                const ret = await this.localDatabase.putDBEntry(saveData);
                Logger(`STORAGE --> DB:${prefixedFileName}: (config) Done`);
                fireAndForget(() => this.updatePluginListV2(false, this.filenameWithUnifiedKey(path)));
                return ret;
            } catch (ex) {
                Logger(`STORAGE --> DB:${prefixedFileName}: (config) Failed`);
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        })
    }
    async storeCustomizationFiles(path: FilePath, termOverRide?: string) {
        const term = termOverRide || this.plugin.deviceAndVaultName;
        if (term == "") {
            Logger("We have to configure the device name", LOG_LEVEL_NOTICE);
            return;
        }
        if (this.useV2) {
            return await this.storeCustomisationFileV2(path, term);
        }
        const vf = this.filenameToUnifiedKey(path, term);
        // console.warn(`Storing ${path} to ${bareVF} :--> ${keyedVF}`);


        return await serialized(`plugin-${vf}`, async () => {
            const category = this.getFileCategory(path);
            let mtime = 0;
            let fileTargets = [] as FilePath[];
            // let savePath = "";
            const name = (category == "CONFIG" || category == "SNIPPET") ?
                (path.split("/").reverse()[0]) :
                (path.split("/").reverse()[1]);
            const parentPath = path.split("/").slice(0, -1).join("/");
            const prefixedFileName = this.filenameToUnifiedKey(path, term);
            const id = await this.path2id(prefixedFileName);
            const dt: PluginDataEx = {
                category: category,
                files: [],
                name: name,
                mtime: 0,
                term: term
            }
            // let scheduleKey = "";
            if (category == "CONFIG" || category == "SNIPPET" || category == "PLUGIN_ETC" || category == "PLUGIN_DATA") {
                fileTargets = [path];
                if (category == "PLUGIN_ETC") {
                    dt.displayName = path.split("/").slice(-1).join("/");
                }
            } else if (category == "PLUGIN_MAIN") {
                fileTargets = ["manifest.json", "main.js", "styles.css"].map(e => `${parentPath}/${e}` as FilePath);
            } else if (category == "THEME") {
                fileTargets = ["manifest.json", "theme.css"].map(e => `${parentPath}/${e}` as FilePath);
            }
            for (const target of fileTargets) {
                const data = await this.makeEntryFromFile(target);
                if (data == false) {
                    Logger(`Config: skipped (Possibly is not exist): ${target} `, LOG_LEVEL_VERBOSE);
                    continue;
                }
                if (data.version) {
                    dt.version = data.version;
                }
                if (data.displayName) {
                    dt.displayName = data.displayName;
                }
                // Use average for total modified time.
                mtime = mtime == 0 ? data.mtime : ((data.mtime + mtime) / 2);
                dt.files.push(data);
            }
            dt.mtime = mtime;

            // Logger(`Configuration saving: ${prefixedFileName}`);
            if (dt.files.length == 0) {
                Logger(`Nothing left: deleting.. ${path}`);
                await this.deleteConfigOnDatabase(prefixedFileName);
                await this.updatePluginList(false, prefixedFileName);
                return
            }

            const content = createTextBlob(serialize(dt));
            try {
                const old = await this.localDatabase.getDBEntryMeta(prefixedFileName, undefined, false);
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
                        eden: {}
                    };
                } else {
                    if (old.mtime == mtime) {
                        // Logger(`STORAGE --> DB:${prefixedFileName}: (config) Skipped (Same time)`, LOG_LEVEL_VERBOSE);
                        return true;
                    }
                    const oldC = await this.localDatabase.getDBEntryFromMeta(old, {}, false, false);
                    if (oldC) {
                        const d = await deserialize(getDocDataAsArray(oldC.data), {}) as PluginDataEx;
                        if (d.files.length == dt.files.length) {
                            const diffs = (d.files.map(previous => ({ prev: previous, curr: dt.files.find(e => e.filename == previous.filename) })).map(async e => {
                                try { return await isDocContentSame(e.curr?.data ?? [], e.prev.data) } catch (_) { return false }
                            }))
                            const isSame = (await Promise.all(diffs)).every(e => e == true);
                            if (isSame) {
                                Logger(`STORAGE --> DB:${prefixedFileName}: (config) Skipped (Same content)`, LOG_LEVEL_VERBOSE);
                                return true;
                            }
                        }
                    }
                    saveData =
                    {
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
                const ret = await this.localDatabase.putDBEntry(saveData);
                await this.updatePluginList(false, saveData.path);
                Logger(`STORAGE --> DB:${prefixedFileName}: (config) Done`);
                return ret;
            } catch (ex) {
                Logger(`STORAGE --> DB:${prefixedFileName}: (config) Failed`);
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        })

    }
    async watchVaultRawEventsAsync(path: FilePath) {
        if (!this.settings.usePluginSync) return false;
        if (!this.isTargetPath(path)) return false;
        const stat = await this.vaultAccess.adapterStat(path);
        // Make sure that target is a file.
        if (stat && stat.type != "file")
            return false;

        const configDir = normalizePath(this.app.vault.configDir);
        const synchronisedInConfigSync = Object.values(this.settings.pluginSyncExtendedSetting).filter(e =>
            e.mode != MODE_SELECTIVE && e.mode != MODE_SHINY
        ).map(e => e.files).flat().map(e => `${configDir}/${e}`.toLowerCase());
        if (synchronisedInConfigSync.some(e => e.startsWith(path.toLowerCase()))) {
            Logger(`Customization file skipped: ${path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        const storageMTime = ~~((stat && stat.mtime || 0) / 1000);
        const key = `${path}-${storageMTime}`;
        if (this.recentProcessedInternalFiles.contains(key)) {
            // If recently processed, it may caused by self.
            return true;
        }
        this.recentProcessedInternalFiles = [key, ...this.recentProcessedInternalFiles].slice(0, 100);
        // To prevent saving half-collected file sets.
        const keySchedule = this.filenameToUnifiedKey(path);
        scheduleTask(keySchedule, 100, async () => {
            await this.storeCustomizationFiles(path);
        })
    }




    async scanAllConfigFiles(showMessage: boolean) {
        await shareRunningResult("scanAllConfigFiles", async () => {
            const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
            Logger("Scanning customizing files.", logLevel, "scan-all-config");
            const term = this.plugin.deviceAndVaultName;
            if (term == "") {
                Logger("We have to configure the device name", LOG_LEVEL_NOTICE);
                return;
            }
            const filesAll = await this.scanInternalFiles();
            if (this.useV2) {
                const filesAllUnified = filesAll.filter(e => this.isTargetPath(e)).map(e => [this.filenameWithUnifiedKey(e, term), e] as [FilePathWithPrefix, FilePath]);
                const localFileMap = new Map(filesAllUnified.map(e => [e[0], e[1]]));
                const prefix = this.unifiedKeyPrefixOfTerminal(term);
                const entries = this.localDatabase.findEntries(prefix + "", `${prefix}\u{10ffff}`, { include_docs: true });
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
                                await this.storeCustomisationFileV2(localPath, term);
                                localFileMap.delete(unifiedFilenameWithKey);
                            } else {
                                await this.deleteConfigOnDatabase(unifiedFilenameWithKey);
                            }
                        } catch (ex) {
                            Logger(`scanAllConfigFiles - Error: ${item._id}`, LOG_LEVEL_VERBOSE);
                            Logger(ex, LOG_LEVEL_VERBOSE);
                        } finally {
                            releaser();
                        }
                    })
                }
                await Promise.all(tasks.map(e => e()));
                // Extra files
                const taskExtra = [] as (() => Promise<void>)[];
                for (const [, filePath] of localFileMap) {
                    taskExtra.push(async () => {
                        const releaser = await semaphore.acquire();
                        try {
                            await this.storeCustomisationFileV2(filePath, term);
                        } catch (ex) {
                            Logger(`scanAllConfigFiles - Error: ${filePath}`, LOG_LEVEL_VERBOSE);
                            Logger(ex, LOG_LEVEL_VERBOSE);
                        }
                        finally {
                            releaser();
                        }
                    })
                }
                await Promise.all(taskExtra.map(e => e()));

                this.updatePluginList(false).then(/* fire and forget */);
            } else {
                const files = filesAll.filter(e => this.isTargetPath(e)).map(e => ({ key: this.filenameToUnifiedKey(e), file: e }));
                const virtualPathsOfLocalFiles = [...new Set(files.map(e => e.key))];
                const filesOnDB = ((await this.localDatabase.allDocsRaw({ startkey: ICXHeader + "", endkey: `${ICXHeader}\u{10ffff}`, include_docs: true })).rows.map(e => e.doc) as InternalFileEntry[]).filter(e => !e.deleted);
                let deleteCandidate = filesOnDB.map(e => this.getPath(e)).filter(e => e.startsWith(`${ICXHeader}${term}/`));
                for (const vp of virtualPathsOfLocalFiles) {
                    const p = files.find(e => e.key == vp)?.file;
                    if (!p) {
                        Logger(`scanAllConfigFiles - File not found: ${vp}`, LOG_LEVEL_VERBOSE);
                        continue;
                    }
                    await this.storeCustomizationFiles(p);
                    deleteCandidate = deleteCandidate.filter(e => e != vp);
                }
                for (const vp of deleteCandidate) {
                    await this.deleteConfigOnDatabase(vp);
                }
                this.updatePluginList(false).then(/* fire and forget */);
            }
        });
    }

    async deleteConfigOnDatabase(prefixedFileName: FilePathWithPrefix, forceWrite = false) {

        // const id = await this.path2id(prefixedFileName);
        const mtime = new Date().getTime();
        return await serialized("file-x-" + prefixedFileName, async () => {
            try {
                const old = await this.localDatabase.getDBEntryMeta(prefixedFileName, undefined, false) as InternalFileEntry | false;
                let saveData: InternalFileEntry;
                if (old === false) {
                    Logger(`STORAGE -x> DB:${prefixedFileName}: (config) already deleted (Not found on database)`);
                    return true;
                } else {
                    if (old.deleted) {
                        Logger(`STORAGE -x> DB:${prefixedFileName}: (config) already deleted`);
                        return true;
                    }
                    saveData =
                    {
                        ...old,
                        mtime,
                        size: 0,
                        children: [],
                        deleted: true,
                        type: "newnote",
                    };
                }
                await this.localDatabase.putRaw(saveData);
                await this.updatePluginList(false, prefixedFileName);
                Logger(`STORAGE -x> DB:${prefixedFileName}: (config) Done`);
                return true;
            } catch (ex) {
                Logger(`STORAGE -x> DB:${prefixedFileName}: (config) Failed`);
                Logger(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    async scanInternalFiles(): Promise<FilePath[]> {
        const filenames = (await this.getFiles(this.app.vault.configDir, 2)).filter(e => e.startsWith(".")).filter(e => !e.startsWith(".trash"));
        return filenames as FilePath[];
    }



    async getFiles(
        path: string,
        lastDepth: number
    ) {
        if (lastDepth == -1) return [];
        let w: ListedFiles;
        try {
            w = await this.app.vault.adapter.list(path);
        } catch (ex) {
            Logger(`Could not traverse(ConfigSync):${path}`, LOG_LEVEL_INFO);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return [];
        }
        let files = [
            ...w.files
        ];
        for (const v of w.folders) {
            files = files.concat(await this.getFiles(v, lastDepth - 1));
        }
        return files;
    }
}
