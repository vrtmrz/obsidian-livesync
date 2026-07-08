// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ActionSender, type Room } from "@trystero-p2p/nostr";
import { type P2PSyncSetting } from "@lib/common/types";
import { type ReplicatorHostEnv, type FullFilledDeviceInfo, type Request, type Response, type Payload, type Advertisement, type BindableObject, type BindableFunction } from "./types";
import { StoredMapLike } from "@lib/dataobject/StoredMap";
import { TrysteroReplicatorP2PClient } from "./TrysteroReplicatorP2PClient";
import { Computed } from "octagonal-wheels/dataobject/Computed";
import { RpcRoom, type JsonLike } from "@lib/rpc";
import { type DiagRTCStats } from "@lib/rpc/transports/DiagRTCPeerConnections.types";
export type PeerInfo = Advertisement & {
    isAccepted: boolean | undefined;
    isTemporaryAccepted: boolean | undefined;
};
export type AcceptanceDecision = {
    peerId: string;
    name: string;
    decision: boolean;
    isTemporary: boolean;
};
export type RevokeAcceptanceDecision = {
    peerId: string;
    name: string;
};
export type P2PServerInfo = {
    isConnected: boolean;
    knownAdvertisements: PeerInfo[];
    serverPeerId: string;
    roomId: string;
    diag: DiagRTCStats;
};
export declare const EVENT_SERVER_STATUS = "p2p-server-status";
export declare const EVENT_MAKE_DECISION = "make-decision-p2p-peer";
export declare const EVENT_REVOKE_DECISION = "revoke-decision-p2p-peer";
export declare const EVENT_ADVERTISEMENT_RECEIVED = "p2p-advertisement-received";
export declare const EVENT_DEVICE_LEAVED = "p2p-device-leaved";
export declare const EVENT_REQUEST_STATUS = "p2p-request-status";
export declare const EVENT_P2P_REQUEST_FORCE_OPEN = "p2p-request-force-open";
export declare const EVENT_P2P_CONNECTED = "p2p-connected";
export declare const EVENT_P2P_DISCONNECTED = "p2p-disconnected";
export declare const EVENT_P2P_REPLICATOR_STATUS = "p2p-replicator-status";
export declare const EVENT_P2P_REPLICATOR_PROGRESS = "p2p-replicator-progress";
declare global {
    interface LSEvents {
        [EVENT_SERVER_STATUS]: P2PServerInfo;
        [EVENT_MAKE_DECISION]: AcceptanceDecision;
        [EVENT_REVOKE_DECISION]: RevokeAcceptanceDecision;
        [EVENT_ADVERTISEMENT_RECEIVED]: Advertisement;
        [EVENT_DEVICE_LEAVED]: string;
        [EVENT_REQUEST_STATUS]: undefined;
        [EVENT_P2P_REQUEST_FORCE_OPEN]: undefined;
        [EVENT_P2P_CONNECTED]: undefined;
        [EVENT_P2P_DISCONNECTED]: undefined;
    }
}
export declare class TrysteroReplicatorP2PServer {
    _env: ReplicatorHostEnv;
    _room?: Room;
    _serverPeerId: string;
    _activeRoomId: string;
    ___send?: ActionSender<Payload>;
    assignedFunctions: Map<string, BindableFunction>;
    clients: Map<string, TrysteroReplicatorP2PClient>;
    _bindingObjects: BindableObject[];
    _rpcRoom?: RpcRoom;
    protected _peerStatusEventCleanup: (() => void) | undefined;
    protected _peerFailureAnalysisCleanup: (() => void) | undefined;
    protected _peerConnectionEventCleanup(): void;
    _diagStats: DiagRTCStats;
    get isDisposed(): boolean;
    get isServing(): boolean;
    ensureLeaved(): Promise<void>;
    setRoom(room: Room): Promise<void>;
    shutdown(): Promise<void>;
    dispatchConnectionStatus(): Promise<void>;
    constructor(env: ReplicatorHostEnv, _serverPeerId?: string);
    makeDecision(decision: AcceptanceDecision): Promise<void>;
    revokeDecision(decision: RevokeAcceptanceDecision): Promise<void>;
    get room(): Room | undefined;
    get serverPeerId(): string;
    get db(): PouchDB.Database<import("@lib/common/types").EntryDoc>;
    get confirm(): import("../../interfaces/Confirm").Confirm;
    get settings(): P2PSyncSetting;
    get isEnabled(): boolean;
    get deviceInfo(): FullFilledDeviceInfo;
    _sendAdvertisement?: ActionSender<Advertisement>;
    sendAdvertisement(peerId?: string): void;
    _knownAdvertisements: Map<string, Advertisement>;
    get knownAdvertisements(): Advertisement[];
    onAdvertisement(data: Advertisement, peerId: string): void;
    acceptedPeers: StoredMapLike<boolean>;
    temporaryAcceptedPeers: Map<string, boolean>;
    confirmUserToAccept(peerId: string): Promise<boolean>;
    _confirmUserToAccept(peerId: string): Promise<boolean>;
    _acceptablePeers: Computed<[settings: P2PSyncSetting], RegExp[]>;
    _shouldDenyPeers: Computed<[settings: P2PSyncSetting], RegExp[]>;
    isAcceptablePeer(peerId: string): Promise<boolean | undefined>;
    __send(data: Payload, peerId: string): Promise<void[] | undefined>;
    processArrivedRPC(data: Payload, peerId: string): Promise<void>;
    private _onPeerJoin;
    private _onPeerLeave;
    activePeer: Map<string, RTCPeerConnection>;
    onAfterJoinRoom(): void;
    startService(bindings?: BindableObject[]): Promise<void>;
    start(bindings?: BindableObject[]): Promise<void>;
    /**
     * @deprecated Use serveFunction or serveObject instead. This is only for backward compatibility and may be removed in the future.
     * @param type
     * @param func
     */
    serveFunction<T extends JsonLike[], U>(type: string, func: (peerId: string, ...args: T) => U | Promise<U>): void;
    serveObject<T>(obj: BindableObject<T>): void;
    __onResponse(data: Response, peerId: string): void;
    __onRequest(data: Request, peerId: string): Promise<void>;
    close(): Promise<void>;
    getConnection(peerId: string): TrysteroReplicatorP2PClient;
    get rpcRoom(): RpcRoom | undefined;
}
export { TrysteroReplicatorP2PServer as P2PHost };
