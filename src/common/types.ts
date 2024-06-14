import { type PluginManifest, TFile } from "../deps.ts";
import { type DatabaseEntry, type EntryBody, type FilePath } from "../lib/src/common/types.ts";

export interface PluginDataEntry extends DatabaseEntry {
    deviceVaultName: string;
    mtime: number;
    manifest: PluginManifest;
    mainJs: string;
    manifestJson: string;
    styleCss?: string;
    // it must be encrypted.
    dataJson?: string;
    _conflicts?: string[];
    type: "plugin";
}

export interface PluginList {
    [key: string]: PluginDataEntry[];
}

export interface DevicePluginList {
    [key: string]: PluginDataEntry;
}
export const PERIODIC_PLUGIN_SWEEP = 60;

export interface InternalFileInfo {
    path: FilePath;
    mtime: number;
    ctime: number;
    size: number;
    deleted?: boolean;
}

export interface FileInfo {
    path: FilePath;
    mtime: number;
    ctime: number;
    size: number;
    deleted?: boolean;
    file: TFile;
}

export type queueItem = {
    entry: EntryBody;
    missingChildren: string[];
    timeout?: number;
    done?: boolean;
    warned?: boolean;
};

export type CacheData = string | ArrayBuffer;
export type FileEventType = "CREATE" | "DELETE" | "CHANGED" | "RENAME" | "INTERNAL";
export type FileEventArgs = {
    file: FileInfo | InternalFileInfo;
    cache?: CacheData;
    oldPath?: string;
    ctx?: any;
}
export type FileEventItem = {
    type: FileEventType,
    args: FileEventArgs,
    key: string,
    skipBatchWait?: boolean,
    cancelled?: boolean,
    batched?: boolean
}

// Hidden items (Now means `chunk`)
export const CHeader = "h:";

// Plug-in Stored Container (Obsolete)
export const PSCHeader = "ps:";
export const PSCHeaderEnd = "ps;";

// Internal data Container
export const ICHeader = "i:";
export const ICHeaderEnd = "i;";
export const ICHeaderLength = ICHeader.length;

// Internal data Container (eXtended)
export const ICXHeader = "ix:";

export const FileWatchEventQueueMax = 10;
export const configURIBase = "obsidian://setuplivesync?settings=";

