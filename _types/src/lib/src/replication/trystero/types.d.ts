// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { JsonLike } from "@lib/rpc";
import type { P2PSyncSetting, EntryDoc } from "@lib/common/types";
import type { SimpleStore } from "@lib/common/utils";
import type { Confirm } from "@lib/interfaces/Confirm";
export declare const DIRECTION_REQUEST = "request";
export type DIRECTION_REQUEST = typeof DIRECTION_REQUEST;
export declare const DIRECTION_RESPONSE = "response";
export type DIRECTION_RESPONSE = typeof DIRECTION_RESPONSE;
export declare const DEFAULT_RPC_TIMEOUT = 30000;
export declare const BULK_GET_RPC_TIMEOUT = 40000;
export type BindableFunction = (...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export type NonPrivateMethodKeys<T> = {
    [K in keyof T]: K extends `_${string}` ? never : K extends `constructor` ? never : T[K] extends BindableFunction ? K : never;
}[keyof T];
export type BindableObject<T = any> = { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    [k in NonPrivateMethodKeys<T>]: T[k] extends BindableFunction ? T[k] : never;
};
export type ConnectionInfo = {
    relayURIs: string[];
    roomId: string;
    password: string;
    appId: string;
};
export declare class ResponsePreventedError extends Error {
    constructor(message: string);
}
export type Request<T = JsonLike[]> = {
    type: string;
    direction: DIRECTION_REQUEST;
    seq: number;
    args: T;
};
export type Response<T = JsonLike> = {
    type: string;
    direction: DIRECTION_RESPONSE;
    seq: number;
    data?: T;
    error?: JsonLike;
};
export type DeviceInfo = {
    currentPeerId: string;
    name?: string;
    version?: string;
    platform?: string;
    decision?: DeviceDecisions;
};
export type DeviceInfoForRequest = {
    currentPeerId: string;
    name: string;
};
export type FullFilledDeviceInfo = {
    currentPeerId: string;
    name: string;
    version: string;
    platform: string;
    decision?: DeviceDecisions;
};
export declare enum DeviceDecisions {
    ACCEPT = "accepted",
    REJECT = "rejected",
    IGNORE = "ignore"
}
export declare const ID_P2PKnownDevices = "_local/P2PKnownDevices";
export type KnownDevices = {
    _id: typeof ID_P2PKnownDevices;
    devices: {
        [deviceName: string]: DeviceDecisions;
    };
};
export type Payload = Request | Response;
export interface ReplicatorHost {
    deviceName: string;
    platform: string;
    confirm: Confirm;
}
export interface ReplicatorHostEnv extends ReplicatorHost {
    settings: P2PSyncSetting;
    db: PouchDB.Database<EntryDoc>;
    simpleStore: SimpleStore<unknown>;
    processReplicatedDocs(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): void | Promise<void>;
}
export type Advertisement = {
    peerId: string;
    name: string;
    platform: string;
};
export declare const KEY_DEVICE_DECISIONS = "p2p-device-decisions";
