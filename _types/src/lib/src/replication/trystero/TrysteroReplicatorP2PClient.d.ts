// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { PouchDBShim, SomeDocument } from "@lib/pouchdb/ReplicatorShim";
import type { TrysteroReplicatorP2PServer } from "./TrysteroReplicatorP2PServer";
import { type BindableObject, type NonPrivateMethodKeys, type Response } from "./types";
import type { JsonLike } from "@lib/rpc";
export declare class TrysteroReplicatorP2PClient {
    _server: TrysteroReplicatorP2PServer;
    _connectedPeerId: string;
    _remoteDB: PouchDBShim<SomeDocument<object>>;
    get remoteDB(): PouchDBShim<SomeDocument<object>>;
    constructor(server: TrysteroReplicatorP2PServer, connectedPeerId: string);
    _bindRemoteDB(): PouchDBShim<SomeDocument<object>>;
    _sendRPC(type: string, args: JsonLike[], timeout?: number): Promise<JsonLike>;
    __onResponse(_data: Response): void;
    bindRemoteFunction<T extends unknown[], U>(type: string, timeout?: number): (...args: T) => Promise<U>;
    invokeRemoteFunction<T extends unknown[], U>(type: string, args: T, timeout?: number): Promise<U>;
    bindRemoteObjectFunctions<T extends BindableObject<any>, U extends keyof T>(key: U, timeout?: number): (...args: Parameters<T[U]>) => Promise<Awaited<ReturnType<T[U]>>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    invokeRemoteObjectFunction<T extends BindableObject<any>, U extends NonPrivateMethodKeys<T>>(key: U, args: Parameters<T[U]>, timeout?: number): Promise<Awaited<ReturnType<T[U]>>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    close(): void;
}
