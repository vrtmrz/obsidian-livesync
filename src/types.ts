import { PluginManifest } from "obsidian";
import { DatabaseEntry } from "./lib/src/types";

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
    path: string;
    mtime: number;
    ctime: number;
    size: number;
    deleted?: boolean;
}
