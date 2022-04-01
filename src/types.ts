// docs should be encoded as base64, so 1 char -> 1 bytes
// and cloudant limitation is 1MB , we use 900kb;

import { PluginManifest } from "obsidian";
import * as PouchDB from "pouchdb";

export const MAX_DOC_SIZE = 1000; // for .md file, but if delimiters exists. use that before.
export const MAX_DOC_SIZE_BIN = 102400; // 100kb
export const VER = 10;

export const RECENT_MOFIDIED_DOCS_QTY = 30;
export const LEAF_WAIT_TIMEOUT = 90000; // in synchronization, waiting missing leaf time out.
export const LOG_LEVEL = {
    VERBOSE: 1,
    INFO: 10,
    NOTICE: 100,
    URGENT: 1000,
} as const;
export type LOG_LEVEL = typeof LOG_LEVEL[keyof typeof LOG_LEVEL];
export const VERSIONINFO_DOCID = "obsydian_livesync_version";
export const MILSTONE_DOCID = "_local/obsydian_livesync_milestone";
export const NODEINFO_DOCID = "_local/obsydian_livesync_nodeinfo";

export interface ObsidianLiveSyncSettings {
    couchDB_URI: string;
    couchDB_USER: string;
    couchDB_PASSWORD: string;
    couchDB_DBNAME: string;
    liveSync: boolean;
    syncOnSave: boolean;
    syncOnStart: boolean;
    syncOnFileOpen: boolean;
    savingDelay: number;
    lessInformationInLog: boolean;
    gcDelay: number;
    versionUpFlash: string;
    minimumChunkSize: number;
    longLineThreshold: number;
    showVerboseLog: boolean;
    suspendFileWatching: boolean;
    trashInsteadDelete: boolean;
    periodicReplication: boolean;
    periodicReplicationInterval: number;
    encrypt: boolean;
    passphrase: string;
    workingEncrypt: boolean;
    workingPassphrase: string;
    doNotDeleteFolder: boolean;
    resolveConflictsByNewerFile: boolean;
    batchSave: boolean;
    deviceAndVaultName: string;
    usePluginSettings: boolean;
    showOwnPlugins: boolean;
    showStatusOnEditor: boolean;
    usePluginSync: boolean;
    autoSweepPlugins: boolean;
    autoSweepPluginsPeriodic: boolean;
    notifyPluginOrSettingUpdated: boolean;
    checkIntegrityOnSave: boolean;
    batch_size: number;
    batches_limit: number;
    useHistory: boolean;
    disableRequestURI: boolean;
}

export const DEFAULT_SETTINGS: ObsidianLiveSyncSettings = {
    couchDB_URI: "",
    couchDB_USER: "",
    couchDB_PASSWORD: "",
    couchDB_DBNAME: "",
    liveSync: false,
    syncOnSave: false,
    syncOnStart: false,
    savingDelay: 200,
    lessInformationInLog: false,
    gcDelay: 300,
    versionUpFlash: "",
    minimumChunkSize: 20,
    longLineThreshold: 250,
    showVerboseLog: false,
    suspendFileWatching: false,
    trashInsteadDelete: true,
    periodicReplication: false,
    periodicReplicationInterval: 60,
    syncOnFileOpen: false,
    encrypt: false,
    passphrase: "",
    workingEncrypt: false,
    workingPassphrase: "",
    doNotDeleteFolder: false,
    resolveConflictsByNewerFile: false,
    batchSave: false,
    deviceAndVaultName: "",
    usePluginSettings: false,
    showOwnPlugins: false,
    showStatusOnEditor: false,
    usePluginSync: false,
    autoSweepPlugins: false,
    autoSweepPluginsPeriodic: false,
    notifyPluginOrSettingUpdated: false,
    checkIntegrityOnSave: false,
    batch_size: 250,
    batches_limit: 40,
    useHistory: false,
    disableRequestURI: false,
};

export const PERIODIC_PLUGIN_SWEEP = 60;

export interface Entry {
    _id: string;
    data: string;
    _rev?: string;
    ctime: number;
    mtime: number;
    size: number;
    _deleted?: boolean;
    _conflicts?: string[];
    type?: "notes";
}
export interface NewEntry {
    _id: string;
    children: string[];
    _rev?: string;
    ctime: number;
    mtime: number;
    size: number;
    _deleted?: boolean;
    _conflicts?: string[];
    NewNote: true;
    type: "newnote";
}
export interface PlainEntry {
    _id: string;
    children: string[];
    _rev?: string;
    ctime: number;
    mtime: number;
    size: number;
    _deleted?: boolean;
    NewNote: true;
    _conflicts?: string[];
    type: "plain";
}
export type LoadedEntry = Entry & {
    children: string[];
    datatype: "plain" | "newnote";
};

export interface PluginDataEntry {
    _id: string;
    deviceVaultName: string;
    mtime: number;
    manifest: PluginManifest;
    mainJs: string;
    manifestJson: string;
    styleCss?: string;
    // it must be encrypted.
    dataJson?: string;
    _rev?: string;
    _deleted?: boolean;
    _conflicts?: string[];
    type: "plugin";
}

export interface EntryLeaf {
    _id: string;
    data: string;
    _deleted?: boolean;
    type: "leaf";
    _rev?: string;
}

export interface EntryVersionInfo {
    _id: typeof VERSIONINFO_DOCID;
    _rev?: string;
    type: "versioninfo";
    version: number;
    _deleted?: boolean;
}

export interface EntryMilestoneInfo {
    _id: typeof MILSTONE_DOCID;
    _rev?: string;
    type: "milestoneinfo";
    _deleted?: boolean;
    created: number;
    accepted_nodes: string[];
    locked: boolean;
}

export interface EntryNodeInfo {
    _id: typeof NODEINFO_DOCID;
    _rev?: string;
    _deleted?: boolean;
    type: "nodeinfo";
    nodeid: string;
}

export type EntryBody = Entry | NewEntry | PlainEntry;
export type EntryDoc = EntryBody | LoadedEntry | EntryLeaf | EntryVersionInfo | EntryMilestoneInfo | EntryNodeInfo;

export type diff_result_leaf = {
    rev: string;
    data: string;
    ctime: number;
    mtime: number;
};
export type dmp_result = Array<[number, string]>;

export type diff_result = {
    left: diff_result_leaf;
    right: diff_result_leaf;
    diff: dmp_result;
};
export type diff_check_result = boolean | diff_result;

export type Credential = {
    username: string;
    password: string;
};

export type EntryDocResponse = EntryDoc & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta;

export type DatabaseConnectingStatus = "STARTED" | "NOT_CONNECTED" | "PAUSED" | "CONNECTED" | "COMPLETED" | "CLOSED" | "ERRORED";

export interface PluginList {
    [key: string]: PluginDataEntry[];
}

export interface DevicePluginList {
    [key: string]: PluginDataEntry;
}

export const FLAGMD_REDFLAG = "redflag.md";
