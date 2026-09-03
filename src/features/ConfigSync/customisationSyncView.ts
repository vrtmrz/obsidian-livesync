import type { PluginManifest } from "@/deps.ts";
import type {
    FilePathWithPrefix,
    LoadedEntry,
    PluginSyncSettingEntry,
    SYNC_MODE,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { Readable } from "svelte/store";

import type { PluginDataExFile } from "./customisationSyncCodec.ts";

export type LoadedEntryPluginDataExFile = LoadedEntry & PluginDataExFile;

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
