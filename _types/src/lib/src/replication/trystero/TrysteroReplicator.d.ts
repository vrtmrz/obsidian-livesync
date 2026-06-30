// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type EntryDoc, type ObsidianLiveSyncSettings } from "@lib/common/types";
import { type ProgressInfo } from "@lib/pouchdb/ReplicatorShim";
import type { Confirm } from "@lib/interfaces/Confirm";
import { type Advertisement, type ReplicatorHostEnv } from "./types";
import { EVENT_P2P_REPLICATOR_PROGRESS, EVENT_P2P_REPLICATOR_STATUS, P2PHost } from "./TrysteroReplicatorP2PServer";
export type P2PReplicatorStatus = {
    isBroadcasting: boolean;
    replicatingTo: string[];
    replicatingFrom: string[];
    watchingPeers: string[];
};
export type P2PReplicationProgress = {
    peerId: string;
    peerName: string;
    fetching: {
        max: number;
        current: number;
        isActive: boolean;
    };
    sending: {
        max: number;
        current: number;
        isActive: boolean;
    };
};
export type P2PReplicationReport = {
    peerId: string;
    peerName: string;
} & ({
    fetching: {
        max: number;
        current: number;
        isActive: boolean;
    };
} | {
    sending: {
        max: number;
        current: number;
        isActive: boolean;
    };
});
declare global {
    interface LSEvents {
        [EVENT_P2P_REPLICATOR_STATUS]: P2PReplicatorStatus;
        [EVENT_P2P_REPLICATOR_PROGRESS]: P2PReplicationReport;
    }
}
export type AllReplicationClientStatus = {
    [peerId: string]: {
        isReplicatingTo: boolean;
        isReplicatingFrom: boolean;
        isWatching: boolean;
        stats: P2PReplicationProgress;
    };
};
export declare class TrysteroReplicator {
    _env: ReplicatorHostEnv;
    server?: P2PHost;
    replicationStatus(): {}; // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types -- Empty object type
    get settings(): import("@lib/common/types").P2PSyncSetting;
    get db(): PouchDB.Database<EntryDoc>;
    get deviceName(): string;
    get platform(): string;
    get confirm(): Confirm;
    constructor(env: ReplicatorHostEnv, server?: P2PHost);
    close(): Promise<void>;
    open(): Promise<void>;
    makeSureOpened(): Promise<void>;
    get autoSyncPeers(): RegExp[];
    get autoWatchPeers(): RegExp[];
    onNewPeer(peer: Advertisement): Promise<void>;
    onPeerLeaved(peerId: string): void;
    _onSetup: boolean;
    setOnSetup(): void;
    clearOnSetup(): void;
    getTweakSettings(fromPeerId: string): Promise<Partial<ObsidianLiveSyncSettings>>;
    getCommands(): {
        reqSync: (fromPeerId: string) => Promise<{
            error: unknown;
            ok?: undefined;
        } | {
            ok: boolean;
            error?: undefined;
        }>;
        "!reqAuth": (fromPeerId: string) => Promise<boolean | undefined>;
        getTweakSettings: (fromPeerId: string) => Promise<Partial<ObsidianLiveSyncSettings>>;
        onProgress: (fromPeerId: string) => Promise<{
            error: Error;
        } | undefined>;
        getAllConfig: (fromPeerId: string) => Promise<string | {
            error: Error;
        }>;
        onProgressAcknowledged: (fromPeerId: string, info: ProgressInfo) => Promise<void>;
        getIsBroadcasting: () => Promise<boolean>;
        requestBroadcasting: (peerId: string) => Promise<true | {
            error: Error;
        } | undefined>;
    };
    requestAuthenticate(peerId: string): Promise<boolean | undefined>;
    lastSeq: string | number;
    requestSynchroniseToPeer(peerId: string): Promise<Awaited<ReturnType<ReturnType<typeof this.getCommands>["reqSync"]>>>;
    requestSynchroniseToAllAvailablePeers(): Promise<void>;
    dispatchStatus(): void;
    requestStatus(): void;
    changes?: PouchDB.Core.Changes<EntryDoc>;
    _isBroadcasting: boolean;
    disableBroadcastChanges(): void;
    enableBroadcastChanges(): void;
    get knownAdvertisements(): Advertisement[];
    availableReplicationPairs: Set<string>;
    sync(remotePeer: string, showNotice?: boolean): Promise<{
        error: unknown;
        ok?: undefined;
    } | {
        ok: boolean;
        error?: undefined;
    } | undefined>;
    _replicateToPeers: Set<string>;
    _replicateFromPeers: Set<string>;
    dispatchReplicationProgress(peerId: string, info?: ProgressInfo): void;
    onReplicationProgress(peerId: string, info?: ProgressInfo): boolean;
    onProgressAcknowledged(peerId: string, info?: ProgressInfo): boolean;
    acknowledgeProgress(remotePeerId: string, info?: ProgressInfo): void;
    replicateFrom(remotePeer: string, showNotice?: boolean, fromStart?: boolean): Promise<{
        error: unknown;
        ok?: undefined;
    } | {
        ok: boolean;
        error?: undefined;
    }>;
    notifyProgress(excludePeerId?: string): Promise<void> | undefined;
    requestBroadcastChanges(peerId: string): Promise<unknown>;
    getRemoteIsBroadcasting(peerId: string): Promise<unknown>;
    _watchingPeers: Set<string>;
    watchPeer(peerId: string): void;
    unwatchPeer(peerId: string): void;
    onUpdateDatabase(fromPeerId: string): Promise<false | {
        error: unknown;
        ok?: undefined;
    } | {
        ok: boolean;
        error?: undefined;
    }>;
    getRemoteConfig(peerId: string): Promise<false | ObsidianLiveSyncSettings>;
    checkTweakValues(peerId: string): Promise<boolean>;
    replicateFromCommand(showResult?: boolean): Promise<void>;
    disconnectFromServer(): void;
    pauseServe(): Promise<void>;
    allowReconnection(): void;
}
