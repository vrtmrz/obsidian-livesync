// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type EntryDoc, type DatabaseConnectingStatus, type RemoteDBSettings, type EntryLeaf, type TweakValues, type NodeData } from "@lib/common/types.ts";
import type { RequiredServices } from "@lib/interfaces/ServiceModule";
export type ReplicationCallback = (e: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<boolean> | boolean;
export type ReplicationStat = {
    sent: number;
    arrived: number;
    maxPullSeq: number;
    maxPushSeq: number;
    lastSyncPullSeq: number;
    lastSyncPushSeq: number;
    syncStatus: DatabaseConnectingStatus;
};
export interface LiveSyncReplicatorEnv {
    services: RequiredServices<"API" | "appLifecycle" | "setting" | "vault" | "database" | "databaseEvents" | "keyValueDB" | "replication" | "config" | "UI" | "replicator" | "remote">;
}
export type RemoteDBStatus = {
    [key: string]: unknown;
    estimatedSize?: number;
};
export declare abstract class LiveSyncAbstractReplicator {
    syncStatus: DatabaseConnectingStatus;
    docArrived: number;
    docSent: number;
    lastSyncPullSeq: number;
    maxPullSeq: number;
    lastSyncPushSeq: number;
    maxPushSeq: number;
    controller?: AbortController;
    originalSetting: RemoteDBSettings;
    nodeid: string;
    remoteLocked: boolean;
    remoteCleaned: boolean;
    remoteLockedAndDeviceNotAccepted: boolean;
    tweakSettingsMismatched: boolean;
    preferredTweakValue?: TweakValues;
    abstract get isChunkSendingSupported(): boolean;
    get database(): import("../pouchdb/LiveSyncLocalDB").LiveSyncLocalDB;
    get rawDatabase(): PouchDB.Database<EntryDoc>;
    get currentSettings(): import("@lib/common/types.ts").ObsidianLiveSyncSettings;
    sendChunks(setting: RemoteDBSettings, remoteDB: PouchDB.Database<EntryDoc> | undefined, showResult: boolean, fromSeq?: number | string): Promise<boolean>;
    abstract getReplicationPBKDF2Salt(setting: RemoteDBSettings, refresh?: boolean): Promise<Uint8Array>;
    ensurePBKDF2Salt(setting: RemoteDBSettings, showMessage?: boolean, useCache?: boolean): Promise<boolean>;
    env: LiveSyncReplicatorEnv;
    initializeDatabaseForReplication(): Promise<boolean>;
    constructor(env: LiveSyncReplicatorEnv);
    abstract terminateSync(): void;
    abstract openReplication(setting: RemoteDBSettings, keepAlive: boolean, showResult: boolean, ignoreCleanLock: boolean): Promise<void | boolean>;
    updateInfo: () => void;
    abstract tryConnectRemote(setting: RemoteDBSettings, showResult?: boolean): Promise<boolean>;
    abstract replicateAllToServer(setting: RemoteDBSettings, showingNotice?: boolean, sendChunksInBulkDisabled?: boolean): Promise<boolean>;
    abstract replicateAllFromServer(setting: RemoteDBSettings, showingNotice?: boolean): Promise<boolean>;
    abstract closeReplication(): void;
    abstract tryResetRemoteDatabase(setting: RemoteDBSettings): Promise<void>;
    abstract tryCreateRemoteDatabase(setting: RemoteDBSettings): Promise<void>;
    abstract markRemoteLocked(setting: RemoteDBSettings, locked: boolean, lockByClean: boolean): Promise<void>;
    abstract markRemoteResolved(setting: RemoteDBSettings): Promise<void>;
    abstract resetRemoteTweakSettings(setting: RemoteDBSettings): Promise<void>;
    abstract setPreferredRemoteTweakSettings(setting: RemoteDBSettings): Promise<void>;
    abstract fetchRemoteChunks(missingChunks: string[], showResult: boolean): Promise<false | EntryLeaf[]>;
    abstract getRemoteStatus(setting: RemoteDBSettings): Promise<false | RemoteDBStatus>;
    abstract getRemotePreferredTweakValues(setting: RemoteDBSettings): Promise<false | TweakValues>;
    abstract countCompromisedChunks(setting?: RemoteDBSettings): Promise<number | boolean>;
    abstract getConnectedDeviceList(setting?: RemoteDBSettings): Promise<false | {
        node_info: Record<string, NodeData>;
        accepted_nodes: string[];
    }>;
}
