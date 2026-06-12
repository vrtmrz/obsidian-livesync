import type { P2PSyncSetting } from "@lib/common/models/setting.type";
import type { EntryDoc } from "@lib/common/models/db.definition";
import type { SimpleStore } from "@lib/common/utils";
import type { Confirm } from "@lib/interfaces/Confirm";
export declare const DIRECTION_REQUEST = "request";
export type DIRECTION_REQUEST = typeof DIRECTION_REQUEST;
export declare const DIRECTION_RESPONSE = "response";
export type DIRECTION_RESPONSE = typeof DIRECTION_RESPONSE;
export declare const DEFAULT_RPC_TIMEOUT = 30000;
export declare const BULK_GET_RPC_TIMEOUT = 40000;
export type NonPrivateMethodKeys<T> = {
    [K in keyof T]: K extends `_${string}` ? never : K extends `constructor` ? never : T[K] extends (...args: any[]) => any ? K : never; // eslint-disable-line @typescript-eslint/no-explicit-any
}[keyof T];
export type BindableObject<T> = {
    [k in NonPrivateMethodKeys<T>]: (...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
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
export type Request = {
    type: string;
    direction: DIRECTION_REQUEST;
    seq: number;
    args: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
};
export type Response = {
    type: string;
    direction: DIRECTION_RESPONSE;
    seq: number;
    data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    error?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
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
    simpleStore: SimpleStore<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    processReplicatedDocs(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): void | Promise<void>;
}
export type Advertisement = {
    peerId: string;
    name: string;
    platform: string;
};
export declare const KEY_DEVICE_DECISIONS = "p2p-device-decisions";
