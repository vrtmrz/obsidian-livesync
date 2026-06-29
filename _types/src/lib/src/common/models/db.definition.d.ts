// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { MILESTONE_DOCID, NODEINFO_DOCID } from "./db.const";
import type { AnyEntry, ChunkVersionRange, DatabaseEntry, EntryChunkPack, EntryLeaf, EntryTypes, EntryVersionInfo, InternalFileEntry, LoadedEntry, MetaEntry, NewEntry, NoteEntry, PlainEntry } from "./db.type";
import type { TweakValues } from "./tweak.definition";
export type NodeKey = string;
export interface DeviceInfo {
    /**
     * Name of the device (Initially from deviceAndVaultName setting, configurable).
     */
    device_name: string;
    /**
     * Vault name (From vaultName setting).
     */
    vault_name: string;
    /**
     * Obsidian App version of the device.
     */
    app_version: string;
    /**
     * Plugin version of the device.
     */
    plugin_version: string;
    progress: string;
}
export interface NodeData extends DeviceInfo {
    /**
     * Epoch time in milliseconds when the device last connected.
     */
    last_connected: number;
}
export interface EntryMilestoneInfo extends DatabaseEntry {
    _id: typeof MILESTONE_DOCID;
    type: EntryTypes["MILESTONE_INFO"];
    created: number;
    accepted_nodes: string[];
    node_info: {
        [key: NodeKey]: NodeData;
    };
    locked: boolean;
    cleaned?: boolean;
    node_chunk_info: {
        [key: NodeKey]: ChunkVersionRange;
    };
    tweak_values: {
        [key: NodeKey]: TweakValues;
    };
}
export interface EntryNodeInfo extends DatabaseEntry {
    _id: typeof NODEINFO_DOCID;
    type: EntryTypes["NODE_INFO"];
    nodeid: string;
    v20220607?: boolean;
}
export type EntryBody = NoteEntry | NewEntry | PlainEntry | InternalFileEntry;
export type EntryDoc = EntryBody | LoadedEntry | EntryLeaf | EntryVersionInfo | EntryMilestoneInfo | EntryNodeInfo | EntryChunkPack;
export type EntryDocResponse = EntryDoc & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta;
export declare function isMetaEntry(entry: AnyEntry): entry is MetaEntry;
