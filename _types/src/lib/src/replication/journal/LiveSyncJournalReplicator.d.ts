// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type RemoteDBSettings, type EntryLeaf, type ChunkVersionRange, type TweakValues, type NodeData } from "@lib/common/types.ts";
import { JournalSyncCore } from "./JournalSyncCore.ts";
import { LiveSyncAbstractReplicator, type RemoteDBStatus } from "@lib/replication/LiveSyncAbstractReplicator.ts";
import { type ENSURE_DB_RESULT } from "@lib/pouchdb/LiveSyncDBFunctions.ts";
import type { CheckPointInfo } from "./JournalSyncTypes.ts";
import { type SimpleStore } from "@lib/common/utils.ts";
import type { LiveSyncJournalReplicatorEnv } from "./LiveSyncJournalReplicatorEnv.ts";
export declare class LiveSyncJournalReplicator extends LiveSyncAbstractReplicator {
    env: LiveSyncJournalReplicatorEnv;
    get isChunkSendingSupported(): boolean;
    get client(): JournalSyncCore;
    get simpleStore(): SimpleStore<CheckPointInfo>;
    _client: JournalSyncCore;
    getReplicationPBKDF2Salt(setting: RemoteDBSettings, refresh?: boolean): Promise<Uint8Array>;
    setupJournalSyncClient(): JournalSyncCore;
    ensureBucketIsCompatible(deviceNodeID: string, currentVersionRange: ChunkVersionRange): Promise<ENSURE_DB_RESULT>;
    constructor(env: LiveSyncJournalReplicatorEnv);
    migrate(from: number, to: number): Promise<boolean>;
    terminateSync(): void;
    openReplication(setting: RemoteDBSettings, _: boolean, showResult: boolean, ignoreCleanLock?: boolean): Promise<boolean>;
    replicateAllToServer(setting: RemoteDBSettings, showingNotice?: boolean): Promise<boolean>;
    replicateAllFromServer(setting: RemoteDBSettings, showingNotice?: boolean): Promise<boolean>;
    checkReplicationConnectivity(skipCheck: boolean, ignoreCleanLock?: boolean, showMessage?: boolean): Promise<boolean>;
    fetchRemoteChunks(missingChunks: string[], showResult: boolean): Promise<false | EntryLeaf[]>;
    closeReplication(): void;
    tryResetRemoteDatabase(setting: RemoteDBSettings): Promise<void>;
    tryCreateRemoteDatabase(setting: RemoteDBSettings): Promise<void>;
    markRemoteLocked(setting: RemoteDBSettings, locked: boolean, lockByClean: boolean): Promise<void>;
    markRemoteResolved(setting: RemoteDBSettings): Promise<void>;
    tryConnectRemote(setting: RemoteDBSettings, showResult?: boolean): Promise<boolean>;
    resetRemoteTweakSettings(setting: RemoteDBSettings): Promise<void>;
    setPreferredRemoteTweakSettings(setting: RemoteDBSettings): Promise<void>;
    getRemotePreferredTweakValues(setting: RemoteDBSettings): Promise<false | TweakValues>;
    getRemoteStatus(setting: RemoteDBSettings): Promise<false | RemoteDBStatus>;
    countCompromisedChunks(): Promise<number>;
    getConnectedDeviceList(setting?: RemoteDBSettings): Promise<false | {
        node_info: Record<string, NodeData>;
        accepted_nodes: string[];
    }>;
}
