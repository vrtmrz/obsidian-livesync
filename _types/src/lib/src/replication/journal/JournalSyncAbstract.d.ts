// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 6de1db1
import { type EntryDoc, type SyncParameters, type BucketSyncSetting, type RemoteDBSettings } from "@lib/common/types.ts";
import type { ReplicationCallback, ReplicationStat } from "@lib/replication/LiveSyncAbstractReplicator.ts";
import { type SimpleStore } from "@lib/common/utils.ts";
import { type CheckPointInfo } from "./JournalSyncTypes.ts";
import type { LiveSyncJournalReplicatorEnv } from "./LiveSyncJournalReplicatorEnv.ts";
import { Trench } from "octagonal-wheels/memory/memutil";
import { Notifier } from "octagonal-wheels/concurrency/processor";
type ProcessingEntry = PouchDB.Core.PutDocument<EntryDoc> & PouchDB.Core.GetMeta;
export declare abstract class JournalSyncAbstract {
    _settings: BucketSyncSetting;
    get id(): string;
    get key(): string;
    get bucket(): string;
    get endpoint(): string;
    get prefix(): string;
    get region(): string;
    get forcePathStyle(): boolean;
    get db(): PouchDB.Database<EntryDoc>;
    /**
     * Return current (environmental) settings, not the instance settings.
     */
    get currentSettings(): import("@lib/common/types.ts").ObsidianLiveSyncSettings;
    hash: string;
    processReplication: ReplicationCallback;
    batchSize: number;
    env: LiveSyncJournalReplicatorEnv;
    store: SimpleStore<CheckPointInfo>;
    get useCustomRequestHandler(): boolean;
    get customHeaders(): [string, string][];
    requestedStop: boolean;
    trench: Trench;
    notifier: Notifier;
    getInitialSyncParameters(): Promise<SyncParameters>;
    getSyncParameters(): Promise<SyncParameters>;
    putSyncParameters(params: SyncParameters): Promise<boolean>;
    getHash(settings: BucketSyncSetting): string;
    constructor(settings: BucketSyncSetting, store: SimpleStore<CheckPointInfo>, env: LiveSyncJournalReplicatorEnv);
    applyNewConfig(settings: BucketSyncSetting, store: SimpleStore<CheckPointInfo>, env: LiveSyncJournalReplicatorEnv): void;
    updateInfo(info: Partial<ReplicationStat>): void;
    updateCheckPointInfo(func: (infoFrom: CheckPointInfo) => CheckPointInfo): Promise<CheckPointInfo>;
    _currentCheckPointInfo: {
        lastLocalSeq: number | string;
        journalEpoch: string;
        knownIDs: Set<string>;
        sentIDs: Set<string>;
        receivedFiles: Set<string>;
        sentFiles: Set<string>;
    };
    getCheckpointInfo(): Promise<CheckPointInfo>;
    resetAllCaches(): Promise<void>;
    resetCheckpointInfo(): Promise<void>;
    private getJournalEpochFromSyncParams;
    ensureCheckpointCachesAreFresh(): Promise<void>;
    abstract resetBucket(): Promise<boolean>;
    abstract uploadJson<T>(key: string, body: T): Promise<boolean>;
    abstract downloadJson<T>(key: string): Promise<T | false>;
    abstract uploadFile(key: string, blob: Blob, mime: string): Promise<boolean>;
    abstract downloadFile(key: string): Promise<Uint8Array | false>;
    abstract listFiles(from: string, limit?: number): Promise<string[]>;
    abstract isAvailable(): Promise<boolean>;
    getRemoteKey(): string;
    getReplicationPBKDF2Salt(refresh?: boolean): Promise<Uint8Array<ArrayBuffer>>;
    isEncryptionPrevented(fileName: string): boolean;
    private decryptDataV2;
    private decryptDataV1;
    decryptDownloaded(key: string, encrypted: Uint8Array<ArrayBuffer>, set: RemoteDBSettings): Promise<Uint8Array<ArrayBuffer>>;
    encryptForUpload(key: string, data: Uint8Array<ArrayBuffer>, set: RemoteDBSettings): Promise<Uint8Array<ArrayBuffer>>;
    _createJournalPack(override?: number | string): Promise<{
        changes: (EntryDoc & PouchDB.Core.GetMeta)[];
        hasNext: boolean;
        packLastSeq: string | number;
    }>;
    getDocKey(doc: EntryDoc): string;
    uploadQueued(showMessage?: boolean, wrapUp?: boolean): Promise<boolean | undefined>;
    isPacking: boolean;
    packAndCompress(showMessage?: boolean): Promise<boolean>;
    sendLocalJournal(showMessage?: boolean): Promise<boolean>;
    _getRemoteJournals(): Promise<string[]>;
    processDocuments(allDocs: ProcessingEntry[]): Promise<boolean>;
    processDownloadedJournals(showMessage?: boolean, wrapUp?: boolean): Promise<boolean>;
    isDownloading: boolean;
    downloadRemoteJournals(showMessage?: boolean): Promise<boolean>;
    receiveRemoteJournal(showMessage?: boolean): Promise<boolean>;
    sync(showResult?: boolean): Promise<boolean>;
    requestStop(): void;
}
export {};
