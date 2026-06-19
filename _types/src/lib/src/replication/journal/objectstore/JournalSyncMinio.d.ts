// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 90de158
import { S3 } from "@aws-sdk/client-s3";
import { JournalSyncAbstract } from "@lib/replication/journal/JournalSyncAbstract.ts";
import type { RemoteDBStatus } from "@lib/replication/LiveSyncAbstractReplicator.ts";
export declare class JournalSyncMinio extends JournalSyncAbstract {
    _instance?: S3;
    _getClient(): S3;
    resetBucket(): Promise<boolean>;
    uploadJson<T>(key: string, body: T): Promise<boolean>;
    downloadJson<T>(key: string): Promise<T | false>;
    uploadFile(key: string, blob: Blob, mime: string): Promise<boolean>;
    downloadFile(key: string, ignoreCache?: boolean): Promise<Uint8Array | false>;
    listFiles(from: string, limit?: number): Promise<string[]>;
    isAvailable(): Promise<boolean>;
    getUsage(): Promise<false | RemoteDBStatus>;
}
