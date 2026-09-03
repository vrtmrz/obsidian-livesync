import { writable } from "svelte/store";
import type PouchDB from "pouchdb-core";
import { type PluginManifest, parseYaml, normalizePath, type ListedFiles, diff_match_patch } from "@/deps.ts";

import type {
    EntryDoc,
    LoadedEntry,
    InternalFileEntry,
    FilePathWithPrefix,
    FilePath,
    AnyEntry,
    SavingEntry,
    diff_result,
    SYNC_MODE,
    ObsidianLiveSyncSettings,
    LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    MODE_SELECTIVE,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ICXHeader, PERIODIC_PLUGIN_SWEEP } from "@/common/types.ts";
import {
    createBlob,
    createSavingEntryFromLoadedEntry,
    createTextBlob,
    delay,
    fireAndForget,
    getDocData,
    getDocDataAsArray,
    isDocContentSame,
    isLoadedEntry,
    isObjectDifferent,
} from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { digestHash } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/hash";
import {
    arrayBufferToBase64,
    decodeBinary,
    readString,
} from "@vrtmrz/livesync-commonlib/compat/string_and_binary/convert";
import { serialized, shareRunningResult } from "octagonal-wheels/concurrency/lock";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { cancelTask, EVEN, isCustomisationSyncMetadata, isPluginMetadata, scheduleTask } from "@/common/utils.ts";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import { reactiveSource, type ReactiveSource } from "octagonal-wheels/dataobject/reactive";
import { base64ToArrayBuffer, base64ToString } from "octagonal-wheels/binary/base64";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { $msg } from "@/common/translation";
import { LiveSyncError } from "@vrtmrz/livesync-commonlib/compat/common/LSError";
import type { OptionalSyncFeatureMode } from "@/features/optionalSyncFeatures.ts";
import {
    createCustomisationSyncDevicePrefix,
    createCustomisationSyncV1DocumentPath,
    createCustomisationSyncV2DocumentPath,
    getCustomisationSyncFileCategory,
    isCustomisationSyncTargetPath,
    parseCustomisationSyncV2DocumentPath,
} from "./customisationSyncPaths.ts";
import { createCustomisationSyncCodec, type PluginDataEx, type PluginDataExFile } from "./customisationSyncCodec.ts";
import type {
    CustomisationSyncDialogView,
    CustomisationSyncUIControl,
    IPluginDataExDisplay,
    LoadedEntryPluginDataExFile,
    PluginDataExDisplay,
} from "./customisationSyncView.ts";
import {
    REPLICATION_PROGRESS_PRESENTATIONS,
    USER_INITIATED_REPLICATION_AUTHORITY,
} from "@vrtmrz/livesync-commonlib/replication";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { IPathService, IReplicationService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

export type { PluginDataEx, PluginDataExFile } from "./customisationSyncCodec.ts";
export type { IPluginDataExDisplay, PluginDataExDisplay } from "./customisationSyncView.ts";

const UPDATED_CONFIGURATION_NOTICE_KEY = "config-sync:updated-configuration";

const {
    serialize,
    deserialize,
    dummyHead: DUMMY_HEAD,
    dummyEnd: DUMMY_END,
} = createCustomisationSyncCodec({ digestHash, parseYaml });

function categoryToFolder(category: string, configDir: string = ""): string {
    switch (category) {
        case "CONFIG":
            return `${configDir}/`;
        case "THEME":
            return `${configDir}/themes/`;
        case "SNIPPET":
            return `${configDir}/snippets/`;
        case "PLUGIN_MAIN":
            return `${configDir}/plugins/`;
        case "PLUGIN_DATA":
            return `${configDir}/plugins/`;
        case "PLUGIN_ETC":
            return `${configDir}/plugins/`;
        default:
            return "";
    }
}

export class PluginDataExDisplayV2 {
    documentPath: FilePathWithPrefix;
    category: string;

    term: string;

    files = [] as LoadedEntryPluginDataExFile[];

    name: string;
    confKey: string;
    constructor(
        data: IPluginDataExDisplay,
        private readonly manifestLookup: ReadonlyMap<string, PluginManifest>
    ) {
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
        const manifest = this.manifestLookup.get(this.confKey);
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
type CustomisationSyncSettings = Pick<
    ObsidianLiveSyncSettings,
    | "usePluginSync"
    | "usePluginSyncV2"
    | "usePluginEtc"
    | "pluginSyncExtendedSetting"
    | "autoSweepPlugins"
    | "autoSweepPluginsPeriodic"
    | "watchInternalFileChanges"
    | "notifyPluginOrSettingUpdated"
>;

type CustomisationSyncDatabase = Pick<
    LiveSyncLocalDB,
    "allDocsRaw" | "findEntries" | "getDBEntry" | "getDBEntryFromMeta" | "getDBEntryMeta" | "putDBEntry" | "putRaw"
>;

type CustomisationSyncStorage = Pick<
    StorageAccess,
    "ensureDir" | "readHiddenFileBinary" | "readHiddenFileText" | "statHidden" | "writeHiddenFileAuto"
>;

export type CustomisationSyncPeriodicProcessor = {
    enable(interval: number): void;
    disable(): void;
};

export type CustomisationSyncContextDependencies = {
    getSettings(): CustomisationSyncSettings;
    getLocalDatabase(): CustomisationSyncDatabase;
    storageAccess: CustomisationSyncStorage;
    path: Pick<IPathService, "getPath" | "isMarkedAsSameChanges" | "markChangesAreSame" | "path2id">;
    log: LogFunction;
    getConfigDir(): string;
    getDeviceAndVaultName(): string;
    setDeviceAndVaultName(name: string): void;
    saveSettingData(): Promise<void>;
    applySettings(partial: Partial<ObsidianLiveSyncSettings>, saveImmediately?: boolean): Promise<void>;
    replicateUserInitiated: IReplicationService["replicateUserInitiated"];
    askString(title: string, key: string, placeholder: string): Promise<string | false>;
    isReady(): boolean;
    isSuspended(): boolean;
    askRestart(): void;
    createPeriodicProcessor(process: () => Promise<unknown>): CustomisationSyncPeriodicProcessor;
    listFiles(path: string): Promise<ListedFiles>;
    resolveJsonConflict(
        path: FilePath,
        files: [LoadedEntryPluginDataExFile, LoadedEntryPluginDataExFile],
        remoteName: string,
        apply: (content: string) => Promise<boolean>
    ): Promise<boolean>;
    selectTextFile(path: FilePath, diffResult: diff_result, remoteName: string): Promise<"A" | "B" | false>;
    reloadPlugin(configDir: string, pluginName: string): Promise<void>;
    getFallbackDeviceName(): string;
    showConfigurationNotice(openDialog: () => void): void;
    hideConfigurationNotice(): void;
    getUIControl(): CustomisationSyncUIControl | undefined;
    ownsLocalFile(path: FilePath): boolean;
    ownsLocalDocument(path: FilePathWithPrefix): boolean;
    publishScanCount(count: number): void;
};

export class CustomisationSyncContext implements CustomisationSyncDialogView {
    private readonly dependencies: CustomisationSyncContextDependencies;
    private readonly scanProgress = reactiveSource(0);
    private readonly pluginScanningChanged: Parameters<ReactiveSource<number>["onChanged"]>[0] = (event) => {
        this.enumerationActive.set(event.value != 0);
        this.dependencies.publishScanCount(event.value);
    };

    readonly catalogue = writable<IPluginDataExDisplay[]>([]);
    readonly enumerationActive = writable(false);
    readonly migrationProgress = writable(0);
    private readonly pluginManifests = new Map<string, PluginManifest>();
    readonly manifests = writable(this.pluginManifests);

    readonly periodicPluginSweepProcessor: CustomisationSyncPeriodicProcessor;

    constructor(dependencies: CustomisationSyncContextDependencies) {
        this.dependencies = dependencies;
        this.periodicPluginSweepProcessor = dependencies.createPeriodicProcessor(
            async () => await this.scanAllConfigFiles(false)
        );
        this.scanProgress.onChanged(this.pluginScanningChanged);
    }
    get configDir() {
        return this.dependencies.getConfigDir();
    }

    private get settings() {
        return this.dependencies.getSettings();
    }

    private get localDatabase() {
        return this.dependencies.getLocalDatabase();
    }

    private get storageAccess() {
        return this.dependencies.storageAccess;
    }

    private async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string) {
        return await this.dependencies.path.path2id(filename, prefix);
    }

    private getPath(entry: AnyEntry): FilePathWithPrefix {
        return this.dependencies.path.getPath(entry);
    }

    _isMainReady() {
        return this.dependencies.isReady();
    }

    _isMainSuspended() {
        return this.dependencies.isSuspended();
    }

    private _log(message: unknown, level?: LOG_LEVEL, key?: string) {
        this.dependencies.log(message, level, key);
    }

    get useV2() {
        return this.settings.usePluginSyncV2;
    }
    get useSyncPluginEtc() {
        return this.settings.usePluginEtc;
    }
    isThisModuleEnabled() {
        return this.settings.usePluginSync;
    }

    isEnabled(): boolean {
        return this.isThisModuleEnabled();
    }

    getDeviceAndVaultName(): string {
        return this.dependencies.getDeviceAndVaultName();
    }

    getConfiguredModes() {
        return Object.values(this.settings.pluginSyncExtendedSetting).map((entry) => ({
            ...entry,
            files: [...entry.files],
        }));
    }

    isPluginEtcEnabled(): boolean {
        return this.useSyncPluginEtc;
    }

    updateConfiguredMode(key: string, mode: SYNC_MODE, files: string[]): void {
        if (mode == MODE_SELECTIVE) {
            delete this.settings.pluginSyncExtendedSetting[key];
        } else {
            this.settings.pluginSyncExtendedSetting[key] = {
                key,
                mode,
                files: [...files],
            };
        }
        void this.dependencies.saveSettingData();
    }

    getConfiguredTargetFiles(key: string): string[] {
        const configDir = normalizePath(this.configDir);
        return (this.settings.pluginSyncExtendedSetting[key]?.files ?? []).map((path) => `${configDir}/${path}`);
    }

    async synchronise(): Promise<void> {
        await this.dependencies.replicateUserInitiated({
            trigger: "manual",
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });
    }

    askString(title: string, key: string, placeholder: string): Promise<string | false> {
        return this.dependencies.askString(title, key, placeholder);
    }

    async compareFileUsingDisplayData(
        dataA: IPluginDataExDisplay,
        dataB: IPluginDataExDisplay,
        filename: string
    ): Promise<boolean> {
        const dataACopy =
            dataA instanceof PluginDataExDisplayV2
                ? new PluginDataExDisplayV2(dataA, this.pluginManifests)
                : { ...dataA };
        const dataBCopy =
            dataB instanceof PluginDataExDisplayV2
                ? new PluginDataExDisplayV2(dataB, this.pluginManifests)
                : { ...dataB };
        dataACopy.files = dataACopy.files.filter((file) => file.filename == filename);
        dataBCopy.files = dataBCopy.files.filter((file) => file.filename == filename);
        return await this.compareUsingDisplayData(dataACopy, dataBCopy, true);
    }

    async duplicateData(data: IPluginDataExDisplay, deviceName: string): Promise<void> {
        const path = `${this.configDir}/${data.files[0].filename}` as FilePath;
        await this.storeCustomizationFiles(path, deviceName);
        await this.updatePluginList(false, this.filenameToUnifiedKey(path, deviceName));
    }

    pluginList: IPluginDataExDisplay[] = [];
    showPluginSyncModal() {
        this.dependencies.getUIControl()?.open();
    }

    hidePluginSyncModal() {
        this.dependencies.getUIControl()?.close();
    }
    dispose() {
        cancelTask(UPDATED_CONFIGURATION_NOTICE_KEY);
        this.periodicPluginSweepProcessor?.disable();
        this.pluginScanProcessor?.terminate();
        this.pluginScanProcessorV2?.terminate();
        this.scanProgress.offChanged(this.pluginScanningChanged);
        this.enumerationActive.set(false);
        this.dependencies.publishScanCount(0);
        this.dependencies.hideConfigurationNotice();
    }

    private setManifest(key: string, manifest: PluginManifest) {
        const old = this.pluginManifests.get(key);
        if (old && !isObjectDifferent(manifest, old)) return;
        this.pluginManifests.set(key, manifest);
        this.manifests.set(this.pluginManifests);
    }

    getFileCategory(
        filePath: string
    ): "CONFIG" | "THEME" | "SNIPPET" | "PLUGIN_MAIN" | "PLUGIN_ETC" | "PLUGIN_DATA" | "" {
        return getCustomisationSyncFileCategory(filePath, {
            configDir: this.configDir,
            useV2: this.useV2,
            usePluginEtc: this.useSyncPluginEtc,
        });
    }
    isTargetPath(filePath: string): boolean {
        return isCustomisationSyncTargetPath(filePath, {
            configDir: this.configDir,
            useV2: this.useV2,
            usePluginEtc: this.useSyncPluginEtc,
        });
    }
    async _everyOnDatabaseInitialized(showNotice: boolean) {
        if (!this.isThisModuleEnabled()) return true;
        try {
            this._log("Scanning customizations...");
            await this.scanAllConfigFiles(showNotice);
            this._log("Scanning customizations : done");
        } catch (ex) {
            this._log("Scanning customizations : failed");
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        return true;
    }
    async _everyBeforeReplicate(showNotice: boolean) {
        if (!this.isThisModuleEnabled()) return true;
        if (this.settings.autoSweepPlugins) {
            await this.scanAllConfigFiles(showNotice);
            return true;
        }
        return true;
    }
    async _everyOnResumeProcess(): Promise<boolean> {
        if (!this.isThisModuleEnabled()) return true;
        if (this._isMainSuspended()) {
            return true;
        }
        if (this.settings.autoSweepPlugins) {
            await this.scanAllConfigFiles(false);
        }
        this.periodicPluginSweepProcessor.enable(
            this.settings.autoSweepPluginsPeriodic && !this.settings.watchInternalFileChanges
                ? PERIODIC_PLUGIN_SWEEP * 1000
                : 0
        );
        return true;
    }
    async reloadPluginList(showMessage: boolean) {
        this.pluginList = [];
        this.loadedManifest_mTime.clear();
        this.catalogue.set(this.pluginList);
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
                this._log(`Digest created for ${path} to improve checking`, LOG_LEVEL_VERBOSE);
                wx.data = serialize(data);
                fireAndForget(() => this.localDatabase.putDBEntry(createSavingEntryFromLoadedEntry(wx)));
            }
            return {
                ...data,
                documentPath: this.getPath(wx),
                files: xFiles,
            } satisfies PluginDataExDisplay;
        }
        return false;
    }

    pluginScanProcessor = new QueueProcessor(
        async (v: AnyEntry[]) => {
            const plugin = v[0];
            if (this.useV2) {
                await this.migrateV1ToV2(false, plugin);
                return [];
            }
            const path = plugin.path || this.getPath(plugin);
            const oldEntry = this.pluginList.find((e) => e.documentPath == path);
            if (oldEntry && oldEntry.mtime == plugin.mtime) return [];
            try {
                const pluginData = await this.loadPluginData(path);
                if (pluginData) {
                    let newList = [...this.pluginList];
                    newList = newList.filter((x) => x.documentPath != pluginData.documentPath);
                    newList.push(pluginData);
                    this.pluginList = newList;
                    this.catalogue.set(newList);
                }
                // Failed to load
                return [];
            } catch (ex) {
                this._log(`Something happened at enumerating customization :${path}`, LOG_LEVEL_NOTICE);
                this._log(ex, LOG_LEVEL_VERBOSE);
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
            totalRemainingReactiveSource: this.scanProgress,
        }
    ).startPipeline();

    pluginScanProcessorV2 = new QueueProcessor(
        async (v: AnyEntry[]) => {
            const plugin = v[0];
            const path = plugin.path || this.getPath(plugin);
            const oldEntry = this.pluginList.find((e) => e.documentPath == path);
            if (oldEntry && oldEntry.mtime == plugin.mtime) return [];
            try {
                const pluginData = await this.loadPluginData(path);
                if (pluginData) {
                    let newList = [...this.pluginList];
                    newList = newList.filter((x) => x.documentPath != pluginData.documentPath);
                    newList.push(pluginData);
                    this.pluginList = newList;
                    this.catalogue.set(newList);
                }
                // Failed to load
                return [];
            } catch (ex) {
                this._log(`Something happened at enumerating customization :${path}`, LOG_LEVEL_NOTICE);
                this._log(ex, LOG_LEVEL_VERBOSE);
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
            totalRemainingReactiveSource: this.scanProgress,
        }
    ).startPipeline();

    filenameToUnifiedKey(path: string, termOverRide?: string) {
        const term = termOverRide || this.dependencies.getDeviceAndVaultName();
        return createCustomisationSyncV1DocumentPath(path, term, {
            configDir: this.configDir,
            useV2: this.useV2,
            usePluginEtc: this.useSyncPluginEtc,
        });
    }

    filenameWithUnifiedKey(path: string, termOverRide?: string) {
        const term = termOverRide || this.dependencies.getDeviceAndVaultName();
        return createCustomisationSyncV2DocumentPath(path, term, {
            configDir: this.configDir,
            useV2: this.useV2,
            usePluginEtc: this.useSyncPluginEtc,
        });
    }

    unifiedKeyPrefixOfTerminal(termOverRide?: string) {
        const term = termOverRide || this.dependencies.getDeviceAndVaultName();
        return createCustomisationSyncDevicePrefix(term);
    }

    parseUnifiedPath(unifiedPath: FilePathWithPrefix): {
        category: string;
        device: string;
        key: string;
        filename: string;
        pathV1: FilePathWithPrefix;
    } {
        return parseCustomisationSyncV2DocumentPath(unifiedPath);
    }

    loadedManifest_mTime = new Map<string, number>();

    async createPluginDataExFileV2(
        unifiedPathV2: FilePathWithPrefix,
        loaded?: LoadedEntry
    ): Promise<false | LoadedEntryPluginDataExFile> {
        const { category, key, filename, device } = this.parseUnifiedPath(unifiedPathV2);
        if (!loaded) {
            const d = await this.localDatabase.getDBEntry(unifiedPathV2);
            if (!d) {
                this._log(`The file ${unifiedPathV2} is not found`, LOG_LEVEL_VERBOSE);
                return false;
            }
            if (!isLoadedEntry(d)) {
                this._log(`The file ${unifiedPathV2} is not a note`, LOG_LEVEL_VERBOSE);
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
            // Same as previously loaded
            if (
                this.loadedManifest_mTime.get(confKey) != file.mtime &&
                this.pluginManifests.get(confKey) == undefined
            ) {
                try {
                    const parsedManifest = JSON.parse(base64ToString(data)) as PluginManifest;
                    this.setManifest(confKey, parsedManifest);
                    this.pluginList
                        .filter((e) => e instanceof PluginDataExDisplayV2 && e.confKey == confKey)
                        .forEach((e) => (e as PluginDataExDisplayV2).applyLoadedManifest());
                    this.catalogue.set(this.pluginList);
                } catch (ex) {
                    this._log(
                        `The file ${loaded.path} seems to manifest, but could not be decoded as JSON`,
                        LOG_LEVEL_VERBOSE
                    );
                    this._log(ex, LOG_LEVEL_VERBOSE);
                }
                this.loadedManifest_mTime.set(confKey, file.mtime);
            } else {
                this.pluginList
                    .filter((e) => e instanceof PluginDataExDisplayV2 && e.confKey == confKey)
                    .forEach((e) => (e as PluginDataExDisplayV2).applyLoadedManifest());
                this.catalogue.set(this.pluginList);
            }
            // }
        }
        return file;
    }
    createPluginDataFromV2(unifiedPathV2: FilePathWithPrefix) {
        const { category, device, key, pathV1 } = this.parseUnifiedPath(unifiedPathV2);
        if (category == "") return;

        const ret: PluginDataExDisplayV2 = new PluginDataExDisplayV2(
            {
                documentPath: pathV1,
                category: category,
                name: key,
                term: `${device}`,
                files: [],
                mtime: 0,
            },
            this.pluginManifests
        );
        return ret;
    }

    updatingV2Count = 0;

    async updatePluginListV2(showMessage: boolean, unifiedFilenameWithKey: FilePathWithPrefix): Promise<void> {
        try {
            this.updatingV2Count++;
            this.migrationProgress.set(this.updatingV2Count);
            // const unifiedFilenameWithKey = this.filenameWithUnifiedKey(updatedDocumentPath);
            const { pathV1 } = this.parseUnifiedPath(unifiedFilenameWithKey);

            const oldEntry = this.pluginList.find((e) => e.documentPath == pathV1);
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
                    this.pluginList = this.pluginList.filter((e) => e.documentPath != pathV1);
                }
            }
            const newList = this.pluginList.filter((e) => e.documentPath != entry.documentPath);
            newList.push(entry);
            this.pluginList = newList;

            scheduleTask("updatePluginListV2", 100, () => {
                this.catalogue.set(this.pluginList);
            });
        } finally {
            this.updatingV2Count--;
            this.migrationProgress.set(this.updatingV2Count);
        }
    }

    async migrateV1ToV2(showMessage: boolean, entry: AnyEntry): Promise<void> {
        const v1Path = entry.path;
        this._log(`Migrating ${entry.path} to V2`, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        if (entry.deleted) {
            this._log(`The entry ${v1Path} is already deleted`, LOG_LEVEL_VERBOSE);
            return;
        }
        if (!v1Path.endsWith(".md") && !v1Path.startsWith(ICXHeader)) {
            this._log(`The entry ${v1Path} is not a customisation sync binder`, LOG_LEVEL_VERBOSE);
            return;
        }
        if (v1Path.indexOf("%") !== -1) {
            this._log(`The entry ${v1Path} is already migrated`, LOG_LEVEL_VERBOSE);
            return;
        }
        const loadedEntry = await this.localDatabase.getDBEntry(v1Path);
        if (!loadedEntry) {
            this._log(`The entry ${v1Path} is not found`, LOG_LEVEL_VERBOSE);
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
            // console.warn(`Migrating ${v1Path} / ${relativeFilename} to ${v2Path}`);
            this._log(`Migrating ${v1Path} / ${relativeFilename} to ${v2Path}`, LOG_LEVEL_VERBOSE);
            const newId = await this.path2id(v2Path);
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
                eden: {},
            };
            const r = await this.localDatabase.putDBEntry(saving);
            if (r && r.ok) {
                this._log(`Migrated ${v1Path} / ${f.filename} to ${v2Path}`, LOG_LEVEL_INFO);
                const delR = await this.deleteConfigOnDatabase(v1Path);
                if (delR) {
                    this._log(`Deleted ${v1Path} successfully`, LOG_LEVEL_INFO);
                } else {
                    this._log(`Failed to delete ${v1Path}`, LOG_LEVEL_NOTICE);
                }
            }
        }
    }

    async updatePluginList(showMessage: boolean, updatedDocumentPath?: FilePathWithPrefix): Promise<void> {
        if (!this.isThisModuleEnabled()) {
            this.pluginScanProcessor.clearQueue();
            this.pluginList = [];
            this.catalogue.set(this.pluginList);
            return;
        }
        try {
            this.updatingV2Count++;
            this.migrationProgress.set(this.updatingV2Count);
            const updatedDocumentId = updatedDocumentPath ? await this.path2id(updatedDocumentPath) : "";
            const plugins = updatedDocumentPath
                ? this.localDatabase.findEntries(updatedDocumentId, updatedDocumentId + "\u{10ffff}", {
                      include_docs: true,
                      key: updatedDocumentId,
                      limit: 1,
                  })
                : this.localDatabase.findEntries(ICXHeader + "", `${ICXHeader}\u{10ffff}`, { include_docs: true });
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
            this.enumerationActive.set(false);
            this.updatingV2Count--;
            this.migrationProgress.set(this.updatingV2Count);
        }
        this.enumerationActive.set(false);
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
        let path = stripAllPrefixes(fileA.path.split("/").slice(-1).join("/") as FilePath); // TODO:adjust
        if (path.indexOf("%") !== -1) {
            path = path.split("%")[1] as FilePath;
        }
        if (fileA.path.endsWith(".json")) {
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
    async applyDataV2(data: PluginDataExDisplayV2, content?: string): Promise<boolean> {
        const baseDir = this.configDir;
        try {
            if (content) {
                // const dt = createBlob(content);
                const filename = data.files[0].filename;
                this._log(`Applying ${filename} of ${data.displayName || data.name}..`);
                const path = `${baseDir}/${filename}` as FilePath;
                await this.storageAccess.ensureDir(path);
                // If the content has applied, modified time will be updated to the current time.
                await this.storageAccess.writeHiddenFileAuto(path, content);
                await this.storeCustomisationFileV2(path, this.dependencies.getDeviceAndVaultName());
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
                    await this.storeCustomisationFileV2(path, this.dependencies.getDeviceAndVaultName());
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
            await this.storeCustomizationFiles(uPath);
            await this.updatePluginList(true, uPath);
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
                const delList = [];
                if (this.useV2) {
                    const deleteList = this.pluginList
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
                    await this.deleteConfigOnDatabase(e);
                    await this.updatePluginList(false, e);
                });
                await Promise.allSettled(p);
                // await this.deleteConfigOnDatabase(data.documentPath);
                // await this.updatePluginList(false, data.documentPath);
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
    async _anyModuleParsedReplicationResultItem(docs: PouchDB.Core.ExistingDocument<EntryDoc>) {
        if (!docs._id.startsWith(ICXHeader)) return false;
        if (this.isThisModuleEnabled()) {
            await this.updatePluginList(
                false,
                (docs as AnyEntry).path ? (docs as AnyEntry).path : this.getPath(docs as AnyEntry)
            );
        }
        if (this.isThisModuleEnabled() && this.settings.notifyPluginOrSettingUpdated) {
            if (!this.dependencies.getUIControl()?.isOpen()) {
                scheduleTask(UPDATED_CONFIGURATION_NOTICE_KEY, 1000, () => {
                    this.dependencies.showConfigurationNotice(() => this.showPluginSyncModal());
                });
            }
        }
        return true;
    }
    async _everyRealizeSettingSyncMode(): Promise<boolean> {
        this.periodicPluginSweepProcessor?.disable();
        if (!this._isMainReady) return true;
        if (!this._isMainSuspended()) return true;
        if (!this.isThisModuleEnabled()) return true;
        if (this.settings.autoSweepPlugins) {
            await this.scanAllConfigFiles(false);
        }
        this.periodicPluginSweepProcessor.enable(
            this.settings.autoSweepPluginsPeriodic && !this.settings.watchInternalFileChanges
                ? PERIODIC_PLUGIN_SWEEP * 1000
                : 0
        );
        return true;
    }

    recentProcessedInternalFiles = [] as string[];
    async makeEntryFromFile(path: FilePath): Promise<false | PluginDataExFile> {
        const stat = await this.storageAccess.statHidden(path);
        let version: string | undefined;
        let displayName: string | undefined;
        if (!stat) {
            return false;
        }
        const contentBin = await this.storageAccess.readHiddenFileBinary(path);
        let content: string[];
        try {
            content = await arrayBufferToBase64(contentBin);
            if (path.toLowerCase().endsWith("/manifest.json")) {
                const v = readString(new Uint8Array(contentBin));
                try {
                    const json: unknown = JSON.parse(v);
                    if (typeof json === "object" && json !== null) {
                        if ("version" in json) {
                            version = String(json.version);
                        }
                        if ("name" in json) {
                            displayName = String(json.name);
                        }
                    }
                } catch (ex) {
                    this._log(
                        `Configuration sync data: ${path} looks like manifest, but could not read the version`,
                        LOG_LEVEL_INFO
                    );
                    this._log(ex, LOG_LEVEL_VERBOSE);
                }
            }
        } catch (ex) {
            this._log(`The file ${path} could not be encoded`);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
        const mtime = stat.mtime;
        return {
            filename: path.substring(this.configDir.length + 1),
            data: content,
            mtime,
            size: stat.size,
            version,
            displayName: displayName,
        };
    }

    async storeCustomisationFileV2(path: FilePath, term: string, force = false) {
        const vf = this.filenameWithUnifiedKey(path, term);
        return await serialized(`plugin-${vf}`, async () => {
            const prefixedFileName = vf;

            const id = await this.path2id(prefixedFileName);
            const stat = await this.storageAccess.statHidden(path);
            if (!stat) {
                return false;
            }
            const mtime = stat.mtime;
            const content = await this.storageAccess.readHiddenFileBinary(path);
            const contentBlob = createBlob([DUMMY_HEAD, DUMMY_END, ...(await arrayBufferToBase64(content))]);
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
                        eden: {},
                    };
                } else {
                    if (
                        this.dependencies.path.isMarkedAsSameChanges(prefixedFileName, [old.mtime, mtime + 1]) == EVEN
                    ) {
                        this._log(
                            `STORAGE --> DB:${prefixedFileName}: (config) Skipped (Already checked the same)`,
                            LOG_LEVEL_DEBUG
                        );
                        return;
                    }
                    const docXDoc = await this.localDatabase.getDBEntryFromMeta(old, false, false);
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
                const ret = await this.localDatabase.putDBEntry(saveData);
                this._log(`STORAGE --> DB:${prefixedFileName}: (config) Done`);
                fireAndForget(() => this.updatePluginListV2(false, this.filenameWithUnifiedKey(path)));
                return ret;
            } catch (ex) {
                this._log(`STORAGE --> DB:${prefixedFileName}: (config) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }
    async storeCustomizationFiles(path: FilePath, termOverRide?: string) {
        const term = termOverRide || this.dependencies.getDeviceAndVaultName();
        if (term == "") {
            this._log($msg("We have to configure the device name"), LOG_LEVEL_NOTICE);
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
            const name =
                category == "CONFIG" || category == "SNIPPET"
                    ? path.split("/").reverse()[0]
                    : path.split("/").reverse()[1];
            const parentPath = path.split("/").slice(0, -1).join("/");
            const prefixedFileName = this.filenameToUnifiedKey(path, term);
            const id = await this.path2id(prefixedFileName);
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
                const data = await this.makeEntryFromFile(target);
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
                // Use average for total modified time.
                mtime = mtime == 0 ? data.mtime : (data.mtime + mtime) / 2;
                dt.files.push(data);
            }
            dt.mtime = mtime;

            // this._log(`Configuration saving: ${prefixedFileName}`);
            if (dt.files.length == 0) {
                this._log(`Nothing left: deleting.. ${path}`);
                await this.deleteConfigOnDatabase(prefixedFileName);
                await this.updatePluginList(false, prefixedFileName);
                return;
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
                        eden: {},
                    };
                } else {
                    if (old.mtime == mtime) {
                        // this._log(`STORAGE --> DB:${prefixedFileName}: (config) Skipped (Same time)`, LOG_LEVEL_VERBOSE);
                        return true;
                    }
                    const oldC = await this.localDatabase.getDBEntryFromMeta(old, false, false);
                    if (oldC) {
                        const d = deserialize(getDocDataAsArray(oldC.data), {}) as PluginDataEx;
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
                                this._log(
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
                const ret = await this.localDatabase.putDBEntry(saveData);
                await this.updatePluginList(false, saveData.path);
                this._log(`STORAGE --> DB:${prefixedFileName}: (config) Done`);
                return ret;
            } catch (ex) {
                this._log(`STORAGE --> DB:${prefixedFileName}: (config) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }
    async _anyProcessOptionalFileEvent(path: FilePath): Promise<boolean> {
        return await this.watchVaultRawEventsAsync(path);
    }

    async watchVaultRawEventsAsync(path: FilePath) {
        if (!this._isMainReady()) return false;
        if (this._isMainSuspended()) return false;
        if (!this.isThisModuleEnabled()) return false;
        if (!this.isTargetPath(path)) return false;
        if (!this.dependencies.ownsLocalFile(path)) return false;
        const stat = await this.storageAccess.statHidden(path);
        // Make sure that target is a file.
        if (stat && stat.type != "file") return false;

        // this._log(`Customization file detected: ${path}`, LOG_LEVEL_VERBOSE);
        const storageMTime = ~~(((stat && stat.mtime) || 0) / 1000);
        const key = `${path}-${storageMTime}`;
        if (this.recentProcessedInternalFiles.contains(key)) {
            // If recently processed, it may caused by self.
            // return true to prevent pass the event to the next.
            return true;
        }
        this.recentProcessedInternalFiles = [key, ...this.recentProcessedInternalFiles].slice(0, 100);
        // To prevent saving half-collected file sets.
        const keySchedule = this.filenameToUnifiedKey(path);
        scheduleTask(keySchedule, 100, async () => {
            await this.storeCustomizationFiles(path);
        });
        // Okay, it may handled after 100ms.
        // This was my own job.
        return true;
    }

    async scanAllConfigFiles(showMessage: boolean) {
        await shareRunningResult("scanAllConfigFiles", async () => {
            const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
            this._log("Scanning customizing files.", logLevel, "scan-all-config");
            const term = this.dependencies.getDeviceAndVaultName();
            if (term == "") {
                this._log($msg("We have to configure the device name"), LOG_LEVEL_NOTICE);
                return;
            }
            const filesAll = await this.scanInternalFiles();
            if (this.useV2) {
                const filesAllUnified = filesAll
                    .filter((e) => this.isTargetPath(e))
                    .map((e) => [this.filenameWithUnifiedKey(e, term), e] as [FilePathWithPrefix, FilePath]);
                const localFileMap = new Map(filesAllUnified.map((e) => [e[0], e[1]]));
                const prefix = this.unifiedKeyPrefixOfTerminal(term);
                const entries = this.localDatabase.findEntries(prefix + "", `${prefix}\u{10ffff}`, {
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
                                if (this.dependencies.ownsLocalFile(localPath)) {
                                    await this.storeCustomisationFileV2(localPath, term);
                                }
                                localFileMap.delete(unifiedFilenameWithKey);
                            } else if (this.dependencies.ownsLocalDocument(this.getPath(item))) {
                                await this.deleteConfigOnDatabase(unifiedFilenameWithKey);
                            }
                        } catch (ex) {
                            this._log(`scanAllConfigFiles - Error: ${item._id}`, LOG_LEVEL_VERBOSE);
                            this._log(ex, LOG_LEVEL_VERBOSE);
                        } finally {
                            releaser();
                        }
                    });
                }
                await Promise.all(tasks.map((e) => e()));
                // Extra files
                const taskExtra = [] as (() => Promise<void>)[];
                for (const [, filePath] of localFileMap) {
                    if (!this.dependencies.ownsLocalFile(filePath)) continue;
                    taskExtra.push(async () => {
                        const releaser = await semaphore.acquire();
                        try {
                            await this.storeCustomisationFileV2(filePath, term);
                        } catch (ex) {
                            this._log(`scanAllConfigFiles - Error: ${filePath}`, LOG_LEVEL_VERBOSE);
                            this._log(ex, LOG_LEVEL_VERBOSE);
                        } finally {
                            releaser();
                        }
                    });
                }
                await Promise.all(taskExtra.map((e) => e()));
                fireAndForget(() => this.updatePluginList(false));
            } else {
                const files = filesAll
                    .filter((e) => this.isTargetPath(e))
                    .map((e) => ({ key: this.filenameToUnifiedKey(e), file: e }));
                const virtualPathsOfLocalFiles = [...new Set(files.map((e) => e.key))];
                const filesOnDB = (
                    (
                        await this.localDatabase.allDocsRaw({
                            startkey: ICXHeader + "",
                            endkey: `${ICXHeader}\u{10ffff}`,
                            include_docs: true,
                        })
                    ).rows.map((e) => e.doc) as InternalFileEntry[]
                ).filter((e) => !e.deleted);
                let deleteCandidate = filesOnDB
                    .map((e) => this.getPath(e))
                    .filter((e) => e.startsWith(`${ICXHeader}${term}/`));
                for (const vp of virtualPathsOfLocalFiles) {
                    const p = files.find((e) => e.key == vp)?.file;
                    if (!p) {
                        this._log(`scanAllConfigFiles - File not found: ${vp}`, LOG_LEVEL_VERBOSE);
                        continue;
                    }
                    if (this.dependencies.ownsLocalFile(p)) {
                        await this.storeCustomizationFiles(p);
                    }
                    deleteCandidate = deleteCandidate.filter((e) => e != vp);
                }
                for (const vp of deleteCandidate) {
                    if (this.dependencies.ownsLocalDocument(vp)) {
                        await this.deleteConfigOnDatabase(vp);
                    }
                }
                fireAndForget(() => this.updatePluginList(false));
            }
        });
    }

    async deleteConfigOnDatabase(prefixedFileName: FilePathWithPrefix, forceWrite = false) {
        // const id = await this.path2id(prefixedFileName);
        const mtime = new Date().getTime();
        return await serialized("file-x-" + prefixedFileName, async () => {
            try {
                const old = (await this.localDatabase.getDBEntryMeta(prefixedFileName, undefined, false)) as
                    | InternalFileEntry
                    | false;
                let saveData: InternalFileEntry;
                if (old === false) {
                    this._log(`STORAGE -x> DB:${prefixedFileName}: (config) already deleted (Not found on database)`);
                    return true;
                } else {
                    if (old.deleted) {
                        this._log(`STORAGE -x> DB:${prefixedFileName}: (config) already deleted`);
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
                await this.localDatabase.putRaw(saveData);
                await this.updatePluginList(false, prefixedFileName);
                this._log(`STORAGE -x> DB:${prefixedFileName}: (config) Done`);
                return true;
            } catch (ex) {
                this._log(`STORAGE -x> DB:${prefixedFileName}: (config) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    async scanInternalFiles(): Promise<FilePath[]> {
        const filenames = (await this.getFiles(this.configDir, 2))
            .filter((e) => e.startsWith("."))
            .filter((e) => !e.startsWith(".trash"));
        return filenames as FilePath[];
    }

    _anyGetOptionalConflictCheckMethod(path: FilePathWithPrefix): Promise<boolean | "newer"> {
        if (isPluginMetadata(path)) {
            return Promise.resolve("newer");
        }
        if (isCustomisationSyncMetadata(path)) {
            return Promise.resolve("newer");
        }
        return Promise.resolve(false);
    }

    _allSuspendExtraSync(): Promise<boolean> {
        if (this.settings.usePluginSync || this.settings.autoSweepPlugins) {
            this._log(
                "Customisation sync have been temporarily disabled. Please enable them after the fetching, if you need them.",
                LOG_LEVEL_NOTICE
            );
            this.settings.usePluginSync = false;
            this.settings.autoSweepPlugins = false;
        }
        return Promise.resolve(true);
    }

    async _allConfigureOptionalSyncFeature(mode: OptionalSyncFeatureMode) {
        await this.configureHiddenFileSync(mode);
        return true;
    }
    async configureHiddenFileSync(mode: OptionalSyncFeatureMode) {
        if (mode == "DISABLE") {
            await this.dependencies.applySettings(
                {
                    usePluginSync: false,
                },
                true
            );
            return;
        }

        if (mode == "CUSTOMIZE") {
            if (!this.dependencies.getDeviceAndVaultName()) {
                let name = await this.dependencies.askString(
                    $msg("Device name"),
                    $msg("Please set this device name"),
                    `desktop`
                );
                if (!name) {
                    name = this.dependencies.getFallbackDeviceName();
                }
                this.dependencies.setDeviceAndVaultName(name);
            }
            await this.dependencies.applySettings(
                {
                    usePluginSync: true,
                    useAdvancedMode: true,
                },
                true
            );
            await this.scanAllConfigFiles(true);
        }
    }

    async getFiles(path: string, lastDepth: number) {
        if (lastDepth == -1) return [];
        let w: ListedFiles;
        try {
            w = await this.dependencies.listFiles(path);
        } catch (ex) {
            this._log(`Could not traverse(CustomisationSync):${path}`, LOG_LEVEL_INFO);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return [];
        }
        let files = [...w.files];
        for (const v of w.folders) {
            files = files.concat(await this.getFiles(v, lastDepth - 1));
        }
        return files;
    }
}
