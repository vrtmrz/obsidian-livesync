// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type PluginManifest } from "@/deps.ts";
import type { EntryDoc, LoadedEntry, FilePathWithPrefix, FilePath, AnyEntry } from "@lib/common/types.ts";
import { LiveSyncCommands } from "@/features/LiveSyncCommands.ts";
import { PeriodicProcessor } from "@/common/PeriodicProcessor.ts";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import type ObsidianLiveSyncPlugin from "@/main.ts";
import { PluginDialogModal } from "./PluginDialogModal.ts";
import type { InjectableServiceHub } from "@lib/services/InjectableServices.ts";
import type { LiveSyncCore } from "@/main.ts";
declare global {
    interface OPTIONAL_SYNC_FEATURES {
        DISABLE: "DISABLE";
        CUSTOMIZE: "CUSTOMIZE";
        DISABLE_CUSTOM: "DISABLE_CUSTOM";
    }
}
export declare const pluginList: import("svelte/store").Writable<PluginDataExDisplay[]>;
export declare const pluginIsEnumerating: import("svelte/store").Writable<boolean>;
export declare const pluginV2Progress: import("svelte/store").Writable<number>;
export type PluginDataExFile = {
    filename: string;
    data: string[];
    mtime: number;
    size: number;
    version?: string;
    hash?: string;
    displayName?: string;
};
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
    documentPath: FilePathWithPrefix;
    category: string;
    name: string;
    term: string;
    displayName?: string;
    files: PluginDataExFile[];
    version?: string;
    mtime: number;
};
type LoadedEntryPluginDataExFile = LoadedEntry & PluginDataExFile;
export declare const pluginManifests: Map<string, PluginManifest>;
export declare const pluginManifestStore: import("svelte/store").Writable<Map<string, PluginManifest>>;
export declare class PluginDataExDisplayV2 {
    documentPath: FilePathWithPrefix;
    category: string;
    term: string;
    files: LoadedEntryPluginDataExFile[];
    name: string;
    confKey: string;
    constructor(data: IPluginDataExDisplay);
    setFile(file: LoadedEntryPluginDataExFile): Promise<void>;
    deleteFile(filename: string): void;
    _displayName: string | undefined;
    _version: string | undefined;
    applyLoadedManifest(): void;
    get displayName(): string;
    get version(): string | undefined;
    get mtime(): number;
}
export type PluginDataEx = {
    documentPath?: FilePathWithPrefix;
    category: string;
    name: string;
    displayName?: string;
    term: string;
    files: PluginDataExFile[];
    version?: string;
    mtime: number;
};
export declare class ConfigSync extends LiveSyncCommands {
    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore);
    get configDir(): string;
    get kvDB(): import("../../lib/src/interfaces/KeyValueDatabase.ts").KeyValueDatabase;
    get useV2(): boolean;
    get useSyncPluginEtc(): boolean;
    isThisModuleEnabled(): boolean;
    pluginDialog?: PluginDialogModal;
    periodicPluginSweepProcessor: PeriodicProcessor;
    pluginList: IPluginDataExDisplay[];
    showPluginSyncModal(): void;
    hidePluginSyncModal(): void;
    onunload(): void;
    addRibbonIcon: (icon: string, title: string, callback: (evt: MouseEvent) => unknown) => HTMLElement;
    onload(): void;
    getFileCategory(filePath: string): "CONFIG" | "THEME" | "SNIPPET" | "PLUGIN_MAIN" | "PLUGIN_ETC" | "PLUGIN_DATA" | "";
    isTargetPath(filePath: string): boolean;
    private _everyOnDatabaseInitialized;
    _everyBeforeReplicate(showNotice: boolean): Promise<boolean>;
    _everyOnResumeProcess(): Promise<boolean>;
    _everyAfterResumeProcess(): Promise<boolean>;
    reloadPluginList(showMessage: boolean): Promise<void>;
    loadPluginData(path: FilePathWithPrefix): Promise<PluginDataExDisplay | false>;
    pluginScanProcessor: QueueProcessor<AnyEntry, never>;
    pluginScanProcessorV2: QueueProcessor<AnyEntry, never>;
    filenameToUnifiedKey(path: string, termOverRide?: string): FilePathWithPrefix;
    filenameWithUnifiedKey(path: string, termOverRide?: string): FilePathWithPrefix;
    unifiedKeyPrefixOfTerminal(termOverRide?: string): FilePathWithPrefix;
    parseUnifiedPath(unifiedPath: FilePathWithPrefix): {
        category: string;
        device: string;
        key: string;
        filename: string;
        pathV1: FilePathWithPrefix;
    };
    loadedManifest_mTime: Map<string, number>;
    createPluginDataExFileV2(unifiedPathV2: FilePathWithPrefix, loaded?: LoadedEntry): Promise<false | LoadedEntryPluginDataExFile>;
    createPluginDataFromV2(unifiedPathV2: FilePathWithPrefix): PluginDataExDisplayV2 | undefined;
    updatingV2Count: number;
    updatePluginListV2(showMessage: boolean, unifiedFilenameWithKey: FilePathWithPrefix): Promise<void>;
    migrateV1ToV2(showMessage: boolean, entry: AnyEntry): Promise<void>;
    updatePluginList(showMessage: boolean, updatedDocumentPath?: FilePathWithPrefix): Promise<void>;
    compareUsingDisplayData(dataA: IPluginDataExDisplay, dataB: IPluginDataExDisplay, compareEach?: boolean): Promise<boolean>;
    applyDataV2(data: PluginDataExDisplayV2, content?: string): Promise<boolean>;
    applyData(data: IPluginDataExDisplay, content?: string): Promise<boolean>;
    deleteData(data: PluginDataEx): Promise<boolean>;
    _anyModuleParsedReplicationResultItem(docs: PouchDB.Core.ExistingDocument<EntryDoc>): Promise<boolean>;
    _everyRealizeSettingSyncMode(): Promise<boolean>;
    recentProcessedInternalFiles: string[];
    makeEntryFromFile(path: FilePath): Promise<false | PluginDataExFile>;
    storeCustomisationFileV2(path: FilePath, term: string, force?: boolean): Promise<boolean | PouchDB.Core.Response | undefined>;
    storeCustomizationFiles(path: FilePath, termOverRide?: string): Promise<boolean | PouchDB.Core.Response | undefined>;
    _anyProcessOptionalFileEvent(path: FilePath): Promise<boolean>;
    watchVaultRawEventsAsync(path: FilePath): Promise<boolean>;
    scanAllConfigFiles(showMessage: boolean): Promise<void>;
    deleteConfigOnDatabase(prefixedFileName: FilePathWithPrefix, forceWrite?: boolean): Promise<boolean>;
    scanInternalFiles(): Promise<FilePath[]>;
    private _allAskUsingOptionalSyncFeature;
    private __askHiddenFileConfiguration;
    _anyGetOptionalConflictCheckMethod(path: FilePathWithPrefix): Promise<boolean | "newer">;
    private _allSuspendExtraSync;
    private _allConfigureOptionalSyncFeature;
    configureHiddenFileSync(mode: keyof OPTIONAL_SYNC_FEATURES): Promise<void>;
    getFiles(path: string, lastDepth: number): Promise<string[]>;
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void;
}
export {};
