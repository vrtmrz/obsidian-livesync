// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type RemoteDBSettings, type EntryLeaf, type TweakValues, type LOG_LEVEL, type NodeData } from "@lib/common/types";
import { LiveSyncAbstractReplicator, type LiveSyncReplicatorEnv, type RemoteDBStatus } from "@lib/replication/LiveSyncAbstractReplicator";
import { TrysteroReplicator } from "./TrysteroReplicator";
import { P2PHost, type AcceptanceDecision, type RevokeAcceptanceDecision } from "./TrysteroReplicatorP2PServer";
import type { Advertisement } from "./types";
export interface LiveSyncTrysteroReplicatorEnv extends LiveSyncReplicatorEnv {
    /**
     * Injected by the host platform (e.g. Obsidian) to show a UI for peer selection.
     * When not set, openReplication falls back to replicateFromCommand (CLI-safe).
     */
    openReplicationUI?: (showResult: boolean) => Promise<boolean | void>;
    /**
     * Injected by the host platform to show a UI for selecting a peer to rebuild from.
     * When not set, replicateAllFromServer falls back to the headless selectPeer dialog.
     */
    openRebuildUI?: (showResult: boolean) => Promise<boolean | void>;
}
export declare class LiveSyncTrysteroReplicator extends LiveSyncAbstractReplicator {
    private _p2pHost?;
    private _replicator?;
    get openReplicationUI(): ((showResult: boolean) => Promise<boolean | void>) | undefined;
    get rawReplicator(): TrysteroReplicator | undefined;
    get rawHost(): P2PHost | undefined;
    get isChunkSendingSupported(): boolean;
    getReplicationPBKDF2Salt(_setting: RemoteDBSettings, _refresh?: boolean): Promise<Uint8Array>;
    terminateSync(): void;
    private _buildEnv;
    open(): Promise<void>;
    close(): Promise<void>;
    closeReplication(): void;
    get server(): P2PHost | undefined;
    get knownAdvertisements(): Advertisement[];
    enableBroadcastChanges(): void;
    disableBroadcastChanges(): void;
    requestStatus(): void;
    onNewPeer(peer: Advertisement): Promise<void> | undefined;
    onPeerLeaved(peerId: string): void;
    replicateFromCommand(showResult?: boolean): Promise<void>;
    replicateFrom(peerId: string, showNotice?: boolean): Promise<{
        error: unknown;
        ok?: undefined;
    } | {
        ok: boolean;
        error?: undefined;
    }>;
    requestSynchroniseToPeer(peerId: string): Promise<{
        error: unknown;
        ok?: undefined;
    } | {
        ok: boolean;
        error?: undefined;
    }>;
    getRemoteConfig(peerId: string): Promise<false | import("@lib/common/types").ObsidianLiveSyncSettings>;
    watchPeer(peerId: string): void;
    unwatchPeer(peerId: string): void;
    sync(peerId: string, showNotice?: boolean): Promise<{
        error: unknown;
        ok?: undefined;
    } | {
        ok: boolean;
        error?: undefined;
    } | undefined>;
    setOnSetup(): void;
    clearOnSetup(): void;
    makeDecision(decision: AcceptanceDecision): Promise<void>;
    revokeDecision(decision: RevokeAcceptanceDecision): Promise<void>;
    makeSureOpened(): Promise<void>;
    openReplication(_setting: RemoteDBSettings, _keepAlive: boolean, showResult: boolean, _ignoreCleanLock: boolean): Promise<void | boolean>;
    tryConnectRemote(_setting: RemoteDBSettings, _showResult?: boolean): Promise<boolean>;
    replicateAllToServer(_setting: RemoteDBSettings, _showingNotice?: boolean, _sendChunksInBulkDisabled?: boolean): Promise<boolean>;
    selectPeer(settingPeerName: string, r: TrysteroReplicator, logLevel: LOG_LEVEL): Promise<string | false>;
    tryUntilSuccess<T>(func: () => Promise<T | false>, repeat: number, logLevel: LOG_LEVEL): Promise<T | false>;
    replicateAllFromServer(setting: RemoteDBSettings, showingNotice?: boolean): Promise<boolean>;
    tryResetRemoteDatabase(_setting: RemoteDBSettings): Promise<void>;
    tryCreateRemoteDatabase(_setting: RemoteDBSettings): Promise<void>;
    markRemoteLocked(_setting: RemoteDBSettings, _locked: boolean, _lockByClean: boolean): Promise<void>;
    markRemoteResolved(_setting: RemoteDBSettings): Promise<void>;
    resetRemoteTweakSettings(_setting: RemoteDBSettings): Promise<void>;
    setPreferredRemoteTweakSettings(_setting: RemoteDBSettings): Promise<void>;
    fetchRemoteChunks(_missingChunks: string[], _showResult: boolean): Promise<false | EntryLeaf[]>;
    getRemoteStatus(_setting: RemoteDBSettings): Promise<false | RemoteDBStatus>;
    getRemotePreferredTweakValues(_setting: RemoteDBSettings): Promise<false | TweakValues>;
    countCompromisedChunks(): Promise<number>;
    getConnectedDeviceList(_setting?: RemoteDBSettings): Promise<false | {
        node_info: Record<string, NodeData>;
        accepted_nodes: string[];
    }>;
    env: LiveSyncTrysteroReplicatorEnv;
    constructor(env: LiveSyncTrysteroReplicatorEnv);
}
