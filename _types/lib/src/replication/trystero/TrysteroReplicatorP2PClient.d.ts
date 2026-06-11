import type { EntryDoc } from "@lib/common/models/db.definition";
import type { PouchDBShim } from "@lib/pouchdb/ReplicatorShim";
import type { TrysteroReplicatorP2PServer } from "./TrysteroReplicatorP2PServer";
import { type BindableObject, type NonPrivateMethodKeys } from "./types";
export declare class TrysteroReplicatorP2PClient {
    _server: TrysteroReplicatorP2PServer;
    _connectedPeerId: string;
    _remoteDB: PouchDBShim<EntryDoc>;
    get remoteDB(): PouchDBShim<EntryDoc>;
    constructor(server: TrysteroReplicatorP2PServer, connectedPeerId: string);
    _bindRemoteDB(): PouchDBShim<EntryDoc>;
    _sendRPC(type: string, args: any[], timeout?: number): Promise<import("../../rpc").JsonLike>;
    __onResponse(_data: unknown): void;
    bindRemoteFunction<T extends any[], U>(type: string, timeout?: number): (...args: T) => Promise<U>;
    invokeRemoteFunction<T extends any[], U>(type: string, args: T, timeout?: number): Promise<U>;
    bindRemoteObjectFunctions<T extends BindableObject<any>, U extends keyof T>(key: U, timeout?: number): (...args: Parameters<T[U]>) => Promise<Awaited<ReturnType<T[U]>>>;
    invokeRemoteObjectFunction<T extends BindableObject<any>, U extends NonPrivateMethodKeys<T>>(key: U, args: Parameters<T[U]>, timeout?: number): Promise<Awaited<ReturnType<T[U]>>>;
    close(): void;
}
