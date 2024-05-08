import { writable } from 'svelte/store';
import { Notice, type PluginManifest, parseYaml, normalizePath, type ListedFiles } from "../deps.ts";

import type { EntryDoc, LoadedEntry, InternalFileEntry, FilePathWithPrefix, FilePath, DocumentID, AnyEntry, SavingEntry } from "../lib/src/common/types.ts";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, MODE_SELECTIVE } from "../lib/src/common/types.ts";
import { ICXHeader, PERIODIC_PLUGIN_SWEEP, } from "../common/types.ts";
import { createSavingEntryFromLoadedEntry, createTextBlob, delay, fireAndForget, getDocData, isDocContentSame, throttle } from "../lib/src/common/utils.ts";
import { Logger } from "../lib/src/common/logger.ts";
import { readString, decodeBinary, arrayBufferToBase64, digestHash } from "../lib/src/string_and_binary/strbin.ts";
import { serialized } from "../lib/src/concurrency/lock.ts";
import { LiveSyncCommands } from "./LiveSyncCommands.ts";
import { stripAllPrefixes } from "../lib/src/string_and_binary/path.ts";
import { PeriodicProcessor, askYesNo, disposeMemoObject, memoIfNotExist, memoObject, retrieveMemoObject, scheduleTask } from "../common/utils.ts";
import { PluginDialogModal } from "../common/dialogs.ts";
import { JsonResolveModal } from "../ui/JsonResolveModal.ts";
import { QueueProcessor } from '../lib/src/concurrency/processor.ts';
import { pluginScanningCount } from '../lib/src/mock_and_interop/stores.ts';
import type ObsidianLiveSyncPlugin from '../main.ts';

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
        const hash = digestHash((file.data ?? []).join());
        ret += file.mtime + d + file.size + d + hash + d2;
        for (const data of file.data ?? []) {
            ret += data + d
        }
        ret += d2;
    }
    return ret;
}
function fetchToken(source: string, from: number): [next: number, token: string] {
    const limitIdx = source.indexOf(d2, from);
    const limit = limitIdx == -1 ? source.length : limitIdx;
    const delimiterIdx = source.indexOf(d, from);
    const delimiter = delimiterIdx == -1 ? source.length : delimiterIdx;
    const tokenEnd = Math.min(limit, delimiter);
    let next = tokenEnd;
    if (limit < delimiter) {
        next = tokenEnd;
    } else {
        next = tokenEnd + 1
    }
    return [next, source.substring(from, tokenEnd)];
}
function getTokenizer(source: string) {
    const t = {
        pos: 1,
        next() {
            const [next, token] = fetchToken(source, this.pos);
            this.pos = next;
            return token;
        },
        nextLine() {
            const nextPos = source.indexOf(d2, this.pos);
            if (nextPos == -1) {
                this.pos = source.length;
            } else {
                this.pos = nextPos + 1;
            }
        }
    }
    return t;
}

function deserialize2(str: string): PluginDataEx {
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

function deserialize<T>(str: string, def: T) {
    try {
        if (str[0] == ":") return deserialize2(str);
        return JSON.parse(str) as T;
    } catch (ex) {
        try {
            return parseYaml(str);
        } catch (ex) {
            return def;
        }
    }
}


export const pluginList = writable([] as PluginDataExDisplay[]);
export const pluginIsEnumerating = writable(false);

export type PluginDataExFile = {
    filename: string,
    data: string[],
    mtime: number,
    size: number,
    version?: string,
    hash?: string,
    displayName?: string,
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
            // if (total == 0) {
            //     Logger(`Processing configurations done`, LOG_LEVEL_INFO, "get-plugins");
            // }
        })
    }
    get kvDB() {
        return this.plugin.kvDB;
    }

    pluginDialog?: PluginDialogModal = undefined;
    periodicPluginSweepProcessor = new PeriodicProcessor(this.plugin, async () => await this.scanAllConfigFiles(false));

    pluginList: PluginDataExDisplay[] = [];
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
                //TODO: to be configurable.
                // With algorithm which implemented at v0.19.0, is too heavy.
                return "";
                // return "PLUGIN_ETC";
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
        pluginList.set(this.pluginList)
        await this.updatePluginList(showMessage);
    }
    async loadPluginData(path: FilePathWithPrefix): Promise<PluginDataExDisplay | false> {
        const wx = await this.localDatabase.getDBEntry(path, undefined, false, false);
        if (wx) {
            const data = deserialize(getDocData(wx.data), {}) as PluginDataEx;
            const xFiles = [] as PluginDataExFile[];
            let missingHash = false;
            for (const file of data.files) {
                const work = { ...file, data: [] as string[] };
                if (!file.hash) {
                    // debugger;
                    const tempStr = getDocData(work.data);
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
    createMissingConfigurationEntry = throttle(() => this._createMissingConfigurationEntry(), 1000);
    _createMissingConfigurationEntry() {
        let saveRequired = false;
        for (const v of this.pluginList) {
            const key = `${v.category}/${v.name}`;
            if (!(key in this.plugin.settings.pluginSyncExtendedSetting)) {
                this.plugin.settings.pluginSyncExtendedSetting[key] = {
                    key,
                    mode: MODE_SELECTIVE,
                    files: []
                }
            }
            if (this.plugin.settings.pluginSyncExtendedSetting[key].files.sort().join(",").toLowerCase() !=
                v.files.map(e => e.filename).sort().join(",").toLowerCase()) {
                this.plugin.settings.pluginSyncExtendedSetting[key].files = v.files.map(e => e.filename).sort();
                saveRequired = true;
            }
        }
        if (saveRequired) {
            this.plugin.saveSettingData();
        }
    }

    pluginScanProcessor = new QueueProcessor(async (v: AnyEntry[]) => {
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
    }, { suspended: false, batchSize: 1, concurrentLimit: 10, delay: 100, yieldThreshold: 10, maintainDelay: false, totalRemainingReactiveSource: pluginScanningCount }).startPipeline().root.onUpdateProgress(() => {
        this.createMissingConfigurationEntry();
    });


    async updatePluginList(showMessage: boolean, updatedDocumentPath?: FilePathWithPrefix): Promise<void> {
        // pluginList.set([]);
        if (!this.settings.usePluginSync) {
            this.pluginScanProcessor.clearQueue();
            this.pluginList = [];
            pluginList.set(this.pluginList)
            return;
        }
        try {
            const updatedDocumentId = updatedDocumentPath ? await this.path2id(updatedDocumentPath) : "";
            const plugins = updatedDocumentPath ?
                this.localDatabase.findEntries(updatedDocumentId, updatedDocumentId + "\u{10ffff}", { include_docs: true, key: updatedDocumentId, limit: 1 }) :
                this.localDatabase.findEntries(ICXHeader + "", `${ICXHeader}\u{10ffff}`, { include_docs: true });
            for await (const v of plugins) {
                const path = v.path || this.getPath(v);
                if (updatedDocumentPath && updatedDocumentPath != path) continue;
                this.pluginScanProcessor.enqueue(v);
            }
        } finally {
            pluginIsEnumerating.set(false);
        }
        pluginIsEnumerating.set(false);
        // return entries;
    }
    async compareUsingDisplayData(dataA: PluginDataExDisplay, dataB: PluginDataExDisplay) {
        const docA = await this.localDatabase.getDBEntry(dataA.documentPath);
        const docB = await this.localDatabase.getDBEntry(dataB.documentPath);

        if (docA && docB) {
            const pluginDataA = deserialize(getDocData(docA.data), {}) as PluginDataEx;
            pluginDataA.documentPath = dataA.documentPath;
            const pluginDataB = deserialize(getDocData(docB.data), {}) as PluginDataEx;
            pluginDataB.documentPath = dataB.documentPath;

            // Use outer structure to wrap each data.
            return await this.showJSONMergeDialogAndMerge(docA, docB, pluginDataA, pluginDataB);

        }
        return false;
    }
    showJSONMergeDialogAndMerge(docA: LoadedEntry, docB: LoadedEntry, pluginDataA: PluginDataEx, pluginDataB: PluginDataEx): Promise<boolean> {
        const fileA = { ...pluginDataA.files[0], ctime: pluginDataA.files[0].mtime, _id: `${pluginDataA.documentPath}` as DocumentID };
        const fileB = pluginDataB.files[0];
        const docAx = { ...docA, ...fileA, datatype: "newnote" } as LoadedEntry, docBx = { ...docB, ...fileB, datatype: "newnote" } as LoadedEntry
        return serialized("config:merge-data", () => new Promise((res) => {
            Logger("Opening data-merging dialog", LOG_LEVEL_VERBOSE);
            // const docs = [docA, docB];
            const path = stripAllPrefixes(docAx.path.split("/").slice(-1).join("/") as FilePath);
            const modal = new JsonResolveModal(this.app, path, [docAx, docBx], async (keep, result) => {
                if (result == null) return res(false);
                try {
                    res(await this.applyData(pluginDataA, result));
                } catch (ex) {
                    Logger("Could not apply merged file");
                    Logger(ex, LOG_LEVEL_VERBOSE);
                    res(false);
                }
            }, "📡", "🛰️", "B");
            modal.open();
        }));
    }
    async applyData(data: PluginDataEx, content?: string): Promise<boolean> {
        Logger(`Applying ${data.displayName || data.name}..`);
        const baseDir = this.app.vault.configDir;
        try {
            if (!data.documentPath) throw "InternalError: Document path not exist";
            const dx = await this.localDatabase.getDBEntry(data.documentPath);
            if (dx == false) {
                throw "Not found on database"
            }
            const loadedData = deserialize(getDocData(dx.data), {}) as PluginDataEx;
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
                scheduleTask("configReload", 250, async () => {
                    if (await askYesNo(this.app, "Do you want to restart and reload Obsidian now?") == "yes") {
                        // @ts-ignore
                        this.app.commands.executeCommandById("app:reload")
                    }
                })
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
                await this.deleteConfigOnDatabase(data.documentPath);
                await this.updatePluginList(false, data.documentPath);
                Logger(`Delete: ${data.documentPath}`, LOG_LEVEL_NOTICE);
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
    async storeCustomizationFiles(path: FilePath, termOverRide?: string) {
        const term = termOverRide || this.plugin.deviceAndVaultName;
        if (term == "") {
            Logger("We have to configure the device name", LOG_LEVEL_NOTICE);
            return;
        }
        const vf = this.filenameToUnifiedKey(path, term);
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
                    // Logger(`Config: skipped: ${target} `, LOG_LEVEL_VERBOSE);
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
                        const d = await deserialize(getDocData(oldC.data), {}) as PluginDataEx;
                        const diffs = (d.files.map(previous => ({ prev: previous, curr: dt.files.find(e => e.filename == previous.filename) })).map(async e => {
                            try { return await isDocContentSame(e.curr?.data ?? [], e.prev.data) } catch (_) { return false }
                        }))
                        const isSame = (await Promise.all(diffs)).every(e => e == true);
                        if (isSame) {
                            Logger(`STORAGE --> DB:${prefixedFileName}: (config) Skipped (Same content)`, LOG_LEVEL_VERBOSE);
                            return true;
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
        const synchronisedInConfigSync = Object.values(this.settings.pluginSyncExtendedSetting).filter(e => e.mode != MODE_SELECTIVE).map(e => e.files).flat().map(e => `${configDir}/${e}`.toLowerCase());
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

        this.storeCustomizationFiles(path).then(() => {/* Fire and forget */ });

    }


    async scanAllConfigFiles(showMessage: boolean) {
        const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
        Logger("Scanning customizing files.", logLevel, "scan-all-config");
        const term = this.plugin.deviceAndVaultName;
        if (term == "") {
            Logger("We have to configure the device name", LOG_LEVEL_NOTICE);
            return;
        }
        const filesAll = await this.scanInternalFiles();
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
    async deleteConfigOnDatabase(prefixedFileName: FilePathWithPrefix, forceWrite = false) {

        // const id = await this.path2id(prefixedFileName);
        const mtime = new Date().getTime();
        await serialized("file-x-" + prefixedFileName, async () => {
            try {
                const old = await this.localDatabase.getDBEntryMeta(prefixedFileName, undefined, false) as InternalFileEntry | false;
                let saveData: InternalFileEntry;
                if (old === false) {
                    Logger(`STORAGE -x> DB:${prefixedFileName}: (config) already deleted (Not found on database)`);
                    return;
                } else {
                    if (old.deleted) {
                        Logger(`STORAGE -x> DB:${prefixedFileName}: (config) already deleted`);
                        return;
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
