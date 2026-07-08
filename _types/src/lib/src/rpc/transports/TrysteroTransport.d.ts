// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type Room } from "@trystero-p2p/nostr";
import { RpcRoom } from "@lib/rpc/RpcRoom";
import { RpcPouchDBProxy } from "@lib/rpc/pouchdb/RpcPouchDBProxy";
import type { RpcRoomOptions, TransportAdapter } from "@lib/rpc/types";
import type { P2PConnectionInfo } from "@lib/common/models/setting.type";
/**
 * Lightweight presence record broadcast by each peer when it joins the room.
 * The `peerId` field MUST match the Trystero sender ID to prevent spoofing.
 */
export type TrysteroAdvertisement = {
    /** The Trystero `selfId` of the sending peer. */
    peerId: string;
    /** Human-readable device / vault name. */
    name: string;
    /** Optional platform tag (e.g. `"desktop"`, `"mobile"`). */
    platform: string;
};
/** The handle returned by {@link attachAdvertisement}. */
export type AdvertisementHandle = {
    /**
     * All currently known peers, keyed by `peerId`.
     * Updated in real-time as advertisements arrive or peers leave.
     */
    readonly peers: ReadonlyMap<string, TrysteroAdvertisement>;
    /**
     * (Re-)broadcast your own advertisement.
     * Pass a `toPeerId` to send only to that peer; omit to broadcast to all.
     */
    sendAdvertisement(toPeerId?: string): Promise<void>;
    /** Stop listening for advertisements and clear the peer map. */
    stop(): void;
};
/**
 * Attach advertisement-based peer discovery to an already-joined Trystero room.
 *
 * - Sends your advertisement to every peer that joins after this call.
 * - Stores incoming advertisements in `handle.peers`.
 * - Removes entries when peers leave.
 *
 * @param room         An active Trystero room.
 * @param localPeerId  Your own Trystero `selfId`.
 * @param name         Human-readable name broadcast to other peers.
 * @param platform     Optional platform string (default `"unknown"`).
 */
export declare function attachAdvertisement(room: Room, localPeerId: string, name: string, platform?: string): AdvertisementHandle;
/**
 * Options forwarded to the `RpcRoom` constructor when creating a room through
 * the high-level helpers (`serveTrysteroDB`, `connectTrysteroDBClient`, or by
 * calling `joinTrysteroRoom` and then constructing `RpcRoom` manually).
 *
 * Trystero internally chunks at ~16 348 bytes (16 KiB minus a 36-byte header).
 * Setting `maxWirePayloadBytes` above that threshold causes double-chunking.
 * The Trystero-appropriate default is therefore **15 360 bytes** (15 KiB),
 * which leaves ~1 KiB of headroom for the JSON wrapper overhead.
 *
 * Trystero uses WebRTC SCTP data channels which guarantee delivery and order,
 * so missing-chunk retransmission virtually never triggers.  `chunkMissingRetryMs`
 * can safely be lowered from the generic default of 350 ms to **150 ms**.
 */
export type TrysteroRoomOptions = Pick<RpcRoomOptions, "canAcceptRequest" | "onProtocolWarning"> & {
    maxWirePayloadBytes?: number;
    chunkMissingRetryMs?: number;
};
/** Trystero-appropriate defaults for `RpcRoom`. */
export declare const TRYSTERO_RPC_DEFAULTS: {
    /** Stay below Trystero's internal ~16 348-byte chunk boundary. */
    readonly maxWirePayloadBytes: number;
    /** SCTP guarantees delivery; retransmission is a last-resort safety net. */
    readonly chunkMissingRetryMs: 150;
};
/**
 * Wrap an already-joined Trystero `Room` as a `TransportAdapter` for `RpcRoom`.
 *
 * A dedicated Trystero action channel named `"rpc2"` is created on the room.
 * Note: Trystero does not expose per-handler unsubscription for `onPeerJoin`
 * / `onPeerLeave`, so the returned cleanup stubs are no-ops.  Close the
 * Trystero room via `leave()` when done.
 *
 * @param room  An active Trystero `Room` returned by `joinRoom()`.
 * @returns     A `TransportAdapter` that can be passed to `new RpcRoom(...)`.
 */
export declare function wrapTrysteroRoom(room: Room): TransportAdapter;
/** The result of joining a Trystero room. */
export type TrysteroRoomHandle = {
    /** `TransportAdapter` ready to pass to `new RpcRoom(...)`. */
    transport: TransportAdapter;
    /** This peer's own ID (Trystero `selfId`). */
    peerId: string;
    /** Leave the Trystero room and release resources. */
    leave: () => Promise<void>;
    /**
     * Attach advertisement-based peer discovery to this room.
     * Call once after joining; returns a handle to read and re-broadcast.
     */
    advertise: (name: string, platform?: string) => AdvertisementHandle;
    /**
     * Returns the current WebRTC peer connections keyed by peer ID.
     * Equivalent to the Trystero `room.getPeers()` call.
     */
    getPeers: () => Record<string, RTCPeerConnection>;
    /**
     * The underlying Trystero `Room` instance.
     * Use when you need raw access to Trystero APIs such as `makeAction`,
     * `onPeerJoin`, or `onPeerLeave` beyond what the helpers expose.
     */
    room: Room;
};
/**
 * Join a Trystero room from a {@link P2PConnectionInfo} and return a
 * `TransportAdapter` together with this peer's own ID.
 *
 * The raw passphrase is hashed with `mixedHash` before being passed to
 * Trystero, matching the convention used by `TrysteroReplicatorP2PServer`.
 */
export declare function joinTrysteroRoom(settings: P2PConnectionInfo): TrysteroRoomHandle;
/**
 * Join a Trystero room from a `sls+p2p://` connection string and return a
 * `TransportAdapter` together with this peer's own ID.
 *
 * The URL must be parseable by {@link ConnectionStringParser.parse} as type
 * `"p2p"`, i.e. it must start with `sls+p2p://`.
 *
 * @example
 * ```ts
 * const handle = joinTrysteroRoomFromUrl(
 *     "sls+p2p://my-room?relays=wss://relay.example.com&appId=my-app"
 * );
 * const rpcRoom = new RpcRoom({ transport: handle.transport });
 * ```
 */
export declare function joinTrysteroRoomFromUrl(url: string): TrysteroRoomHandle;
/** The result of starting a DB server over Trystero. */
export type TrysteroDBServerHandle = {
    /** This peer's own ID.  Share it with clients so they can call `session()`. */
    peerId: string;
    /** The `RpcRoom` that hosts the DB methods. */
    rpcRoom: RpcRoom;
    /** Stop serving and leave the room. */
    close: () => Promise<void>;
    /**
     * Attach advertisement-based peer discovery so that clients can find this
     * server without needing the peerId passed out-of-band.
     */
    advertise: (name: string, platform?: string) => AdvertisementHandle;
};
/**
 * **Server side.**  Join a Trystero room and expose `db` as a set of RPC
 * methods.  The caller's `peerId` is returned so that it can be shared with
 * clients (e.g. via a separate signalling channel or advertisement).
 *
 * @param settings  P2P connection settings (from `P2PConnectionInfo` or parsed
 *                  from a `sls+p2p://` URL via {@link ConnectionStringParser}).
 * @param db        The PouchDB database to expose.
 * @param ns        Method namespace (default `"pdb"`).
 *
 * @example
 * ```ts
 * const server = serveTrysteroDB(settings, db);
 * console.log("server peer ID:", server.peerId);
 * // Share server.peerId with the client out-of-band.
 * ```
 */
export declare function serveTrysteroDB(settings: P2PConnectionInfo, db: PouchDB.Database<object>, ns?: string, options?: TrysteroRoomOptions): TrysteroDBServerHandle;
/** The result of connecting to a DB server over Trystero. */
export type TrysteroDBClientHandle = {
    /** Proxy object usable with `PouchDB.replicate()` or `replicateShim()`. */
    proxy: RpcPouchDBProxy;
    /** The `RpcRoom` used to communicate with the server. */
    rpcRoom: RpcRoom;
    /** Disconnect and leave the room. */
    close: () => Promise<void>;
    /**
     * Attach advertisement-based peer discovery so this client can locate the
     * server peer without needing its peerId passed statically.
     */
    advertise: (name: string, platform?: string) => AdvertisementHandle;
};
/**
 * **Client side.**  Join a Trystero room and create an {@link RpcPouchDBProxy}
 * pointing at `serverPeerId`.  The proxy can be passed directly to
 * `PouchDB.replicate()` or `replicateShim()`.
 *
 * @param settings      P2P connection settings.
 * @param serverPeerId  The `peerId` of the server peer (returned by
 *                      {@link serveTrysteroDB}).
 * @param dbName        Logical name for the remote database.
 * @param ns            Method namespace, must match the server's `ns`
 *                      (default `"pdb"`).
 *
 * @example
 * ```ts
 * const client = connectTrysteroDBClient(settings, serverPeerId, "my-db");
 * await PouchDB.replicate(client.proxy, localDb, { live: false });
 * await client.close();
 * ```
 */
export declare function connectTrysteroDBClient(settings: P2PConnectionInfo, serverPeerId: string, dbName: string, ns?: string, options?: TrysteroRoomOptions): TrysteroDBClientHandle;
/**
 * Join a Trystero room, advertise as `name`, wait `timeoutMs`, collect all
 * received peer advertisements, then leave the room and return the results.
 *
 * Useful for CLI-style peer discovery where you need a one-shot list of
 * present peers before deciding how to connect.
 *
 * @param settings   P2P connection settings.
 * @param name       Your local device / vault name advertised to others.
 * @param timeoutMs  How long to listen before returning (milliseconds).
 * @param platform   Optional platform tag (default `"unknown"`).
 *
 * @example
 * ```ts
 * const peers = await collectTrysteroAdvertisements(settings, "my-vault", 5000);
 * console.log(peers.map(p => `${p.name} (${p.peerId})`));
 * ```
 */
export declare function collectTrysteroAdvertisements(settings: P2PConnectionInfo, name: string, timeoutMs: number, platform?: string): Promise<TrysteroAdvertisement[]>;
