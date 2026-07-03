// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { RemoteDBStatus } from "@lib/replication/LiveSyncAbstractReplicator.ts";
import type { BucketSyncSetting } from "@lib/common/types.ts";
export interface IJournalStorage {
    upload(key: string, data: Uint8Array, mime: string): Promise<boolean>;
    download(key: string, ignoreCache?: boolean): Promise<Uint8Array | false>;
    listFiles(from: string, limit?: number): Promise<string[]>;
    deleteFiles(keys: string[]): Promise<boolean>;
    isAvailable(): Promise<boolean>;
    getUsage(): Promise<false | RemoteDBStatus>;
    applyNewConfig(settings: BucketSyncSetting): void;
}
import type { LiveSyncJournalReplicatorEnv } from "@lib/replication/journal/LiveSyncJournalReplicatorEnv.ts";
export interface IJournalStorageAdapterClass {
    new (settings: BucketSyncSetting, env: LiveSyncJournalReplicatorEnv): IJournalStorage;
}
