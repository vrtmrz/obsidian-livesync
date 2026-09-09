import type { PluginManifest } from "@/deps.ts";
import type {
    EntryDoc,
    FilePathWithPrefix,
    FilePath,
    LoadedEntry,
    PluginSyncSettingEntry,
    SYNC_MODE,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type PouchDB from "pouchdb-core";
import type { Readable } from "svelte/store";

import type { PluginDataExFile } from "./customisationSyncCodec.ts";
import type { OptionalSyncFeatureMode } from "@/features/optionalSyncFeatures.ts";
import type { PluginDataExDisplayV2 } from "./customisationSyncModel.ts";

export type LoadedEntryPluginDataExFile = LoadedEntry & PluginDataExFile;
export type { CustomisationSyncFileCategory } from "./customisationSyncPaths.ts";

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

/**
 * Semantic callbacks registered by the optional-file composition feature.
 *
 * The context owns the implementations, while the optional-file composition
 * adapts these operations to Commonlib's aggregation contracts. Consumers
 * receive only callable operations, not the context or its private state.
 */
export interface CustomisationSyncServiceHandlers {
    readonly processOptionalFileEvent: (path: FilePath) => Promise<boolean>;
    readonly processVirtualDocument: (docs: PouchDB.Core.ExistingDocument<EntryDoc>) => Promise<boolean>;
    readonly onRealiseSetting: () => Promise<boolean>;
    readonly onResuming: () => Promise<boolean>;
    readonly onBeforeReplicate: (showMessage: boolean) => Promise<boolean>;
    readonly onDatabaseInitialised: (showNotice: boolean) => Promise<boolean>;
    readonly suspendExtraSync: () => Promise<boolean>;
    readonly enableOptionalFeature: (mode: OptionalSyncFeatureMode) => Promise<boolean>;
}

/**
 * Explicit internal operations used by maintained real-Obsidian contract
 * tests. This is deliberately narrower than the concrete context and does
 * not expose reactive stores, queues, or host dependencies.
 */
export interface CustomisationSyncTestingView {
    readonly configDir: string;
    scanInternalFiles(): Promise<FilePath[]>;
    scanAllConfigFiles(showMessage: boolean): Promise<void>;
    storeCustomizationFiles(path: FilePath, termOverride?: string): Promise<unknown>;
    deleteConfigOnDatabase(prefixedFileName: FilePathWithPrefix, forceWrite?: boolean): Promise<boolean>;
    createPluginDataFromV2(unifiedPathV2: FilePathWithPrefix): PluginDataExDisplayV2 | undefined;
    createPluginDataExFileV2(
        unifiedPathV2: FilePathWithPrefix,
        loaded?: LoadedEntry
    ): Promise<false | LoadedEntryPluginDataExFile>;
    applyDataV2(data: PluginDataExDisplayV2, content?: string): Promise<boolean>;
}

/** Stable catalogue and operation surface consumed by the Obsidian dialogue. */
export interface CustomisationSyncDialogView {
    readonly catalogue: Readable<IPluginDataExDisplay[]>;
    readonly enumerationActive: Readable<boolean>;
    readonly migrationProgress: Readable<number>;
    readonly manifests: Readable<Map<string, PluginManifest>>;

    isEnabled(): boolean;
    getDeviceAndVaultName(): string;
    getConfiguredModes(): PluginSyncSettingEntry[];
    isPluginEtcEnabled(): boolean;
    updateConfiguredMode(key: string, mode: SYNC_MODE, files: string[]): void;
    getConfiguredTargetFiles(key: string): string[];

    updatePluginList(showMessage: boolean, updatedDocumentPath?: FilePathWithPrefix): Promise<void>;
    reloadPluginList(showMessage: boolean): Promise<void>;
    scanAllConfigFiles(showMessage: boolean): Promise<void>;
    synchronise(): Promise<void>;
    applyData(data: IPluginDataExDisplay): Promise<boolean>;
    compareUsingDisplayData(
        dataA: IPluginDataExDisplay,
        dataB: IPluginDataExDisplay,
        compareEach?: boolean
    ): Promise<boolean>;
    compareFileUsingDisplayData(
        dataA: IPluginDataExDisplay,
        dataB: IPluginDataExDisplay,
        filename: string
    ): Promise<boolean>;
    deleteData(data: IPluginDataExDisplay): Promise<boolean>;
    duplicateData(data: IPluginDataExDisplay, deviceName: string): Promise<void>;
    askString(title: string, key: string, placeholder: string): Promise<string | false>;
}

/** Narrow control returned by the host-owned dialogue composition feature. */
export interface CustomisationSyncUIControl {
    open(): void;
    close(): void;
    isOpen(): boolean;
}
