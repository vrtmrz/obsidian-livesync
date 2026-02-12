import { type PluginManifest, TFile } from "../deps.ts";
import { type DatabaseEntry, type EntryBody, type FilePath } from "../lib/src/common/types.ts";
export type { CacheData, FileEventItem } from "../lib/src/common/types.ts";

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

export const FileWatchEventQueueMax = 10;

export { configURIBase, configURIBaseQR } from "../lib/src/common/types.ts";

export {
    CHeader,
    PSCHeader,
    PSCHeaderEnd,
    ICHeader,
    ICHeaderEnd,
    ICHeaderLength,
    ICXHeader,
} from "../lib/src/common/models/fileaccess.const.ts";
