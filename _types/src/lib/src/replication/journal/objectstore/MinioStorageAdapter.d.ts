// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { S3 } from "@aws-sdk/client-s3";
import { type BucketSyncSetting } from "@lib/common/types.ts";
import type { RemoteDBStatus } from "@lib/replication/LiveSyncAbstractReplicator.ts";
import type { IJournalStorage } from "./JournalStorageAdapter.ts";
import type { LiveSyncJournalReplicatorEnv } from "@lib/replication/journal/LiveSyncJournalReplicatorEnv.ts";
export declare class MinioStorageAdapter implements IJournalStorage {
    _instance?: S3;
    _settings: BucketSyncSetting;
    _env: LiveSyncJournalReplicatorEnv;
    constructor(settings: BucketSyncSetting, env: LiveSyncJournalReplicatorEnv);
    applyNewConfig(settings: BucketSyncSetting): void;
    get customHeaders(): [string, string][];
    _getClient(): S3;
    upload(key: string, data: Uint8Array, mime: string): Promise<boolean>;
    download(key: string, ignoreCache?: boolean): Promise<Uint8Array | false>;
    listFiles(from: string, limit?: number): Promise<string[]>;
    deleteFiles(keys: string[]): Promise<boolean>;
    isAvailable(): Promise<boolean>;
    getUsage(): Promise<false | RemoteDBStatus>;
}
