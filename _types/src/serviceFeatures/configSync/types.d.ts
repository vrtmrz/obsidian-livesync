// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryObsidianServices } from "@/types.ts";
import type { FilePathWithPrefix, LoadedEntry } from "@lib/common/types.ts";
/**
 * A union of service keys required by the configuration synchronisation feature.
 */
export type ConfigSyncServices = "API" | "appLifecycle" | "setting" | "vault" | "path" | "database" | "databaseEvents" | "fileProcessing" | "keyValueDB" | "replication" | "conflict" | "control";
/**
 * A union of service module keys required by the configuration synchronisation feature.
 */
export type ConfigSyncModules = "storageAccess" | "fileHandler";
/**
 * The host type representing the injected service container with configuration synchronisation capabilities.
 */
export type ConfigSyncHost = NecessaryObsidianServices<ConfigSyncServices, ConfigSyncModules, "app" | "plugin">;
/**
 * Represents metadata and content structure of an individual file within a plug-in.
 */
export type PluginDataExFile = {
    filename: string;
    data: string[];
    mtime: number;
    size: number;
    version?: string;
    hash?: string;
    displayName?: string;
};
/**
 * Defines the display properties and structure for a plug-in sync entry used in UI dialogues.
 */
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
/**
 * Represents the display model of a plug-in, including its category, file list, and modification time.
 */
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
 * Combines a database loaded entry with plug-in specific file metadata.
 */
export type LoadedEntryPluginDataExFile = LoadedEntry & PluginDataExFile;
/**
 * Represents a plug-in's synchronisation schema payload stored in the database.
 */
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
