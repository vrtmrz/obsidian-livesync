// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type EntryDoc, type RemoteDBSettings, type EntryLeaf, type TweakValues, type SyncParameters, type DatabaseEntry, type NodeData } from "@lib/common/types.ts";
import { LiveSyncAbstractReplicator, type LiveSyncReplicatorEnv, type RemoteDBStatus } from "@lib/replication/LiveSyncAbstractReplicator.ts";
import type { ServiceHub } from "@lib/services/ServiceHub.ts";
export interface LiveSyncCouchDBReplicatorEnv extends LiveSyncReplicatorEnv {
    services: ServiceHub;
}
export declare class LiveSyncCouchDBReplicator extends LiveSyncAbstractReplicator {
    get isChunkSendingSupported(): boolean;
    isMobile(): boolean;
    constructor(env: LiveSyncCouchDBReplicatorEnv);
    getInitialSyncParameters(setting: RemoteDBSettings): Promise<SyncParameters>;
    getSyncParameters(setting: RemoteDBSettings): Promise<SyncParameters>;
    putSyncParameters(setting: RemoteDBSettings, params: SyncParameters): Promise<boolean>;
    getReplicationPBKDF2Salt(setting: RemoteDBSettings, refresh?: boolean): Promise<Uint8Array>;
    migrate(from: number, to: number): Promise<boolean>;
    terminateSync(): void;
    openReplication(setting: RemoteDBSettings, keepAlive: boolean, showResult: boolean, ignoreCleanLock: boolean): Promise<boolean | undefined>;
    replicationActivated(showResult: boolean): void;
    replicationChangeDetected(e: PouchDB.Replication.SyncResult<EntryDoc>, showResult: boolean, docSentOnStart: number, docArrivedOnStart: number): Promise<void>;
    replicationCompleted(showResult: boolean): void;
    replicationDenied(e: unknown): void;
    replicationErrored(e: unknown): void;
    replicationPaused(): void;
    processSync(syncHandler: PouchDB.Replication.Sync<EntryDoc> | PouchDB.Replication.Replication<EntryDoc>, showResult: boolean, docSentOnStart: number, docArrivedOnStart: number, syncMode: "sync" | "pullOnly" | "pushOnly", retrying: boolean, reportCancelledAsDone?: boolean): Promise<"DONE" | "NEED_RETRY" | "NEED_RESURRECT" | "FAILED" | "CANCELLED">;
    getEmptyMaxEntry(remoteID: number): {
        _id: string;
        maxSeq: number | string;
        remoteID: number;
        seqStatusMap: Record<number, boolean>;
        _rev: string | undefined;
    };
    getLastTransferredSeqOfChunks(localDB: PouchDB.Database, remoteID: number): Promise<ReturnType<typeof this.getEmptyMaxEntry>>;
    updateMaxTransferredSeqOnChunks(localDB: PouchDB.Database, remoteID: number, seqStatusMap: Record<number, boolean>): Promise<ReturnType<typeof this.getEmptyMaxEntry>>;
    sendChunks(setting: RemoteDBSettings, remoteDB: PouchDB.Database<EntryDoc> | undefined, showResult: boolean, fromSeq?: number | string): Promise<boolean>;
    openOneShotReplication(setting: RemoteDBSettings, showResult: boolean, retrying: boolean, syncMode: "sync" | "pullOnly" | "pushOnly", ignoreCleanLock?: boolean): Promise<boolean>;
    replicateAllToServer(setting: RemoteDBSettings, showingNotice?: boolean): Promise<boolean>;
    replicateAllFromServer(setting: RemoteDBSettings, showingNotice?: boolean): Promise<boolean>;
    checkReplicationConnectivity(setting: RemoteDBSettings, keepAlive: boolean, skipCheck: boolean, showResult: boolean, ignoreCleanLock?: boolean): Promise<false | {
        db: PouchDB.Database<EntryDoc>;
        info: PouchDB.Core.DatabaseInfo;
        syncOptionBase: PouchDB.Replication.SyncOptions;
        syncOption: PouchDB.Replication.SyncOptions;
    }>;
    openContinuousReplication(setting: RemoteDBSettings, showResult: boolean, retrying: boolean): Promise<boolean>;
    closeReplication(): void;
    tryResetRemoteDatabase(setting: RemoteDBSettings): Promise<void>;
    tryCreateRemoteDatabase(setting: RemoteDBSettings): Promise<void>;
    markRemoteLocked(setting: RemoteDBSettings, locked: boolean, lockByClean: boolean): Promise<void>;
    markRemoteResolved(setting: RemoteDBSettings): Promise<void>;
    connectRemoteCouchDBWithSetting(settings: RemoteDBSettings, isMobile: boolean, performSetup?: boolean, skipInfo?: boolean): Promise<string | {
        db: PouchDB.Database<EntryDoc>;
        info: PouchDB.Core.DatabaseInfo;
    }> | "Empty passphrases cannot be used without explicit permission";
    _ensureConnection<T extends DatabaseEntry>(settings: RemoteDBSettings, performSetup?: boolean): Promise<PouchDB.Database<T>>;
    /**
     * Fetch a document from the remote database directly.
     * @param settings RemoteDBSettings for the connection.
     * @param id Document ID to fetch.
     * @param db Optional PouchDB instance to use. If provided, it will use this instance instead of creating a new connection (then settings will be ignored).
     * @returns The fetched document or false if the document does not exist.
     * @throws {Error} Other errors that may occur during the fetch operation.
     */
    fetchRemoteDocument<T extends DatabaseEntry>(settings: RemoteDBSettings, id: string, db?: PouchDB.Database<T>): Promise<T | false>;
    /**
     * Puts a document to the remote database directly
     * @param settings RemoteDBSettings for the connection.
     * @param doc Document to put.
     * @param db Optional PouchDB instance to use. If provided, it will use this instance instead of creating a new connection (then settings will be ignored).
     * @returns Response from the remote database or false if an error occurred.
     * @throws {Error} If the document could not be put.
     */
    putRemoteDocument<T extends DatabaseEntry>(settings: RemoteDBSettings, doc: T, db?: PouchDB.Database<T>): Promise<PouchDB.Core.Response>;
    fetchRemoteChunks(missingChunks: string[], showResult: boolean): Promise<false | EntryLeaf[]>;
    tryConnectRemote(setting: RemoteDBSettings, showResult?: boolean): Promise<boolean>;
    resetRemoteTweakSettings(setting: RemoteDBSettings): Promise<void>;
    setPreferredRemoteTweakSettings(setting: RemoteDBSettings): Promise<void>;
    getRemotePreferredTweakValues(setting: RemoteDBSettings): Promise<TweakValues | false>;
    compactRemote(setting: RemoteDBSettings): Promise<boolean>;
    getRemoteStatus(setting: RemoteDBSettings): Promise<RemoteDBStatus | false>;
    countCompromisedChunks(setting?: RemoteDBSettings): Promise<number | boolean>;
    getConnectedDeviceList(setting?: RemoteDBSettings): Promise<false | {
        node_info: Record<string, NodeData>;
        accepted_nodes: string[];
    }>;
}
