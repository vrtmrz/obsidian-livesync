const isDebug = false;

import { type Diff, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch, stringifyYaml, parseYaml } from "./deps";
import { Notice, Plugin, TFile, addIcon, TFolder, normalizePath, TAbstractFile, Editor, MarkdownView, type RequestUrlParam, type RequestUrlResponse, requestUrl, type MarkdownFileInfo } from "./deps";
import { type EntryDoc, type LoadedEntry, type ObsidianLiveSyncSettings, type diff_check_result, type diff_result_leaf, type EntryBody, type LOG_LEVEL, VER, DEFAULT_SETTINGS, type diff_result, FLAGMD_REDFLAG, SYNCINFO_ID, SALT_OF_PASSPHRASE, type ConfigPassphraseStore, type CouchDBConnection, FLAGMD_REDFLAG2, FLAGMD_REDFLAG3, PREFIXMD_LOGFILE, type DatabaseConnectingStatus, type EntryHasPath, type DocumentID, type FilePathWithPrefix, type FilePath, type AnyEntry, LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_URGENT, LOG_LEVEL_VERBOSE, type SavingEntry, MISSING_OR_ERROR, NOT_CONFLICTED, AUTO_MERGED, CANCELLED, LEAVE_TO_SUBSEQUENT, FLAGMD_REDFLAG2_HR, FLAGMD_REDFLAG3_HR, REMOTE_MINIO, REMOTE_COUCHDB, type BucketSyncSetting, TweakValuesShouldMatchedTemplate, confName, type TweakValues, } from "./lib/src/common/types.ts";
import { type InternalFileInfo, type CacheData, type FileEventItem } from "./common/types.ts";
import { arrayToChunkedArray, createBlob, delay, determineTypeFromBlob, escapeMarkdownValue, extractObject, fireAndForget, getDocData, isAnyNote, isDocContentSame, isObjectDifferent, readContent, sendValue, sizeToHumanReadable, throttle, type SimpleStore } from "./lib/src/common/utils.ts";
import { Logger, setGlobalLogFunction } from "./lib/src/common/logger.ts";
import { PouchDB } from "./lib/src/pouchdb/pouchdb-browser.js";
import { ConflictResolveModal } from "./ui/ConflictResolveModal.ts";
import { ObsidianLiveSyncSettingTab } from "./ui/ObsidianLiveSyncSettingTab.ts";
import { DocumentHistoryModal } from "./ui/DocumentHistoryModal.ts";
import { applyPatch, cancelAllPeriodicTask, cancelAllTasks, cancelTask, generatePatchObj, id2path, isObjectMargeApplicable, isSensibleMargeApplicable, flattenObject, path2id, scheduleTask, tryParseJSON, isValidPath, isInternalMetadata, isPluginMetadata, stripInternalMetadataPrefix, isChunk, askSelectString, askYesNo, askString, PeriodicProcessor, getPath, getPathWithoutPrefix, getPathFromTFile, performRebuildDB, memoIfNotExist, memoObject, retrieveMemoObject, disposeMemoObject, isCustomisationSyncMetadata, compareFileFreshness, BASE_IS_NEW, TARGET_IS_NEW, EVEN, compareMTime, markChangesAreSame } from "./common/utils.ts";
import { encrypt, tryDecrypt } from "./lib/src/encryption/e2ee_v2.ts";
import { balanceChunkPurgedDBs, enableCompression, enableEncryption, isCloudantURI, isErrorOfMissingDoc, isValidRemoteCouchDBURI, purgeUnreferencedChunks } from "./lib/src/pouchdb/utils_couchdb.ts";
import { logStore, type LogEntry, collectingChunks, pluginScanningCount, hiddenFilesProcessingCount, hiddenFilesEventCount, logMessages } from "./lib/src/mock_and_interop/stores.ts";
import { setNoticeClass } from "./lib/src/mock_and_interop/wrapper.ts";
import { versionNumberString2Number, writeString, decodeBinary, readString } from "./lib/src/string_and_binary/convert.ts";
import { addPrefix, isAcceptedAll, isPlainText, shouldBeIgnored, stripAllPrefixes } from "./lib/src/string_and_binary/path.ts";
import { isLockAcquired, serialized, shareRunningResult, skipIfDuplicated } from "./lib/src/concurrency/lock.ts";
import { StorageEventManager, StorageEventManagerObsidian, type FileEvent } from "./storages/StorageEventManager.ts";
import { LiveSyncLocalDB, type LiveSyncLocalDBEnv } from "./lib/src/pouchdb/LiveSyncLocalDB.ts";
import { LiveSyncAbstractReplicator, type LiveSyncReplicatorEnv } from "./lib/src/replication/LiveSyncAbstractReplicator.js";
import { type KeyValueDatabase, OpenKeyValueDatabase } from "./common/KeyValueDB.ts";
import { LiveSyncCommands } from "./features/LiveSyncCommands.ts";
import { HiddenFileSync } from "./features/CmdHiddenFileSync.ts";
import { SetupLiveSync } from "./features/CmdSetupLiveSync.ts";
import { ConfigSync } from "./features/CmdConfigSync.ts";
import { confirmWithMessage } from "./common/dialogs.ts";
import { GlobalHistoryView, VIEW_TYPE_GLOBAL_HISTORY } from "./ui/GlobalHistoryView.ts";
import { LogPaneView, VIEW_TYPE_LOG } from "./ui/LogPaneView.ts";
import { LRUCache } from "./lib/src/memory/LRUCache.ts";
import { SerializedFileAccess } from "./storages/SerializedFileAccess.js";
import { QueueProcessor, stopAllRunningProcessors } from "./lib/src/concurrency/processor.js";
import { computed, reactive, reactiveSource, type ReactiveValue } from "./lib/src/dataobject/reactive.js";
import { initializeStores } from "./common/stores.js";
import { JournalSyncMinio } from "./lib/src/replication/journal/objectstore/JournalSyncMinio.js";
import { LiveSyncJournalReplicator, type LiveSyncJournalReplicatorEnv } from "./lib/src/replication/journal/LiveSyncJournalReplicator.js";
import { LiveSyncCouchDBReplicator, type LiveSyncCouchDBReplicatorEnv } from "./lib/src/replication/couchdb/LiveSyncReplicator.js";
import type { CheckPointInfo } from "./lib/src/replication/journal/JournalSyncTypes.js";
import { ObsHttpHandler } from "./common/ObsHttpHandler.js";
import { TestPaneView, VIEW_TYPE_TEST } from "./tests/TestPaneView.js"
import { $f, __onMissingTranslation, setLang } from "./lib/src/common/i18n.ts";
import { enableTestFunction } from "./tests/testUtils.ts";
import { terminateWorker } from "./lib/src/worker/splitWorker.ts";


setNoticeClass(Notice);

// DI the log again.
setGlobalLogFunction((message: any, level?: LOG_LEVEL, key?: string) => {
    const entry = { message, level, key } as LogEntry;
    logStore.enqueue(entry);
});
let recentLogs = [] as string[];

// Recent log splicer
const recentLogProcessor = new QueueProcessor((logs: string[]) => {
    recentLogs = [...recentLogs, ...logs].splice(-200);
    logMessages.value = recentLogs;
}, { batchSize: 25, delay: 10, suspended: false, concurrentLimit: 1 }).resumePipeLine();
// logStore.intercept(e => e.slice(Math.min(e.length - 200, 0)));

async function fetchByAPI(request: RequestUrlParam): Promise<RequestUrlResponse> {
    const ret = await requestUrl(request);
    if (ret.status - (ret.status % 100) !== 200) {
        const er: Error & { status?: number } = new Error(`Request Error:${ret.status}`);
        if (ret.json) {
            er.message = ret.json.reason;
            er.name = `${ret.json.error ?? ""}:${ret.json.message ?? ""}`;
        }
        er.status = ret.status;
        throw er;
    }
    return ret;
}

const SETTING_HEADER = "````yaml:livesync-setting\n";
const SETTING_FOOTER = "\n````";

export default class ObsidianLiveSyncPlugin extends Plugin
    implements LiveSyncLocalDBEnv, LiveSyncReplicatorEnv, LiveSyncJournalReplicatorEnv, LiveSyncCouchDBReplicatorEnv {
    _customHandler!: ObsHttpHandler;
    customFetchHandler() {
        if (!this._customHandler) this._customHandler = new ObsHttpHandler(undefined, undefined);
        return this._customHandler;
    }

    settings!: ObsidianLiveSyncSettings;
    localDatabase!: LiveSyncLocalDB;
    replicator!: LiveSyncAbstractReplicator;
    settingTab!: ObsidianLiveSyncSettingTab;

    statusBar?: HTMLElement;
    _suspended = false;
    get suspended() {
        return this._suspended || !this.settings?.isConfigured;
    }
    set suspended(value: boolean) {
        this._suspended = value;
    }
    get shouldBatchSave() {
        return this.settings?.batchSave && this.settings?.liveSync != true;
    }
    get batchSaveMinimumDelay(): number {
        return this.settings?.batchSaveMinimumDelay ?? DEFAULT_SETTINGS.batchSaveMinimumDelay
    }
    get batchSaveMaximumDelay(): number {
        return this.settings?.batchSaveMaximumDelay ?? DEFAULT_SETTINGS.batchSaveMaximumDelay
    }
    deviceAndVaultName = "";
    isReady = false;
    packageVersion = "";
    manifestVersion = "";

    addOnHiddenFileSync = new HiddenFileSync(this);
    addOnSetup = new SetupLiveSync(this);
    addOnConfigSync = new ConfigSync(this);
    addOns = [this.addOnHiddenFileSync, this.addOnSetup, this.addOnConfigSync] as LiveSyncCommands[];

    periodicSyncProcessor = new PeriodicProcessor(this, async () => await this.replicate());

    // implementing interfaces
    kvDB!: KeyValueDatabase;
    last_successful_post = false;
    getLastPostFailedBySize() {
        return !this.last_successful_post;
    }

    vaultAccess: SerializedFileAccess = new SerializedFileAccess(this.app);

    _unloaded = false;

    getDatabase(): PouchDB.Database<EntryDoc> {
        return this.localDatabase.localDatabase;
    }
    getSettings(): ObsidianLiveSyncSettings {
        return this.settings;
    }
    getIsMobile(): boolean {
        return this.isMobile;
    }

    requestCount = reactiveSource(0);
    responseCount = reactiveSource(0);
    processReplication = (e: PouchDB.Core.ExistingDocument<EntryDoc>[]) => this.parseReplicationResult(e);
    async connectRemoteCouchDB(uri: string, auth: { username: string; password: string }, disableRequestURI: boolean, passphrase: string | false, useDynamicIterationCount: boolean, performSetup: boolean, skipInfo: boolean, compression: boolean): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> {
        if (!isValidRemoteCouchDBURI(uri)) return "Remote URI is not valid";
        if (uri.toLowerCase() != uri) return "Remote URI and database name could not contain capital letters.";
        if (uri.indexOf(" ") !== -1) return "Remote URI and database name could not contain spaces.";
        let authHeader = "";
        if (auth.username && auth.password) {
            const utf8str = String.fromCharCode.apply(null, [...writeString(`${auth.username}:${auth.password}`)]);
            const encoded = window.btoa(utf8str);
            authHeader = "Basic " + encoded;
        } else {
            authHeader = "";
        }
        // const _this = this;

        const conf: PouchDB.HttpAdapter.HttpAdapterConfiguration = {
            adapter: "http",
            auth,
            skip_setup: !performSetup,
            fetch: async (url: string | Request, opts?: RequestInit) => {
                let size = "";
                const localURL = url.toString().substring(uri.length);
                const method = opts?.method ?? "GET";
                if (opts?.body) {
                    const opts_length = opts.body.toString().length;
                    if (opts_length > 1000 * 1000 * 10) {
                        // over 10MB
                        if (isCloudantURI(uri)) {
                            this.last_successful_post = false;
                            Logger("This request should fail on IBM Cloudant.", LOG_LEVEL_VERBOSE);
                            throw new Error("This request should fail on IBM Cloudant.");
                        }
                    }
                    size = ` (${opts_length})`;
                }

                if (!disableRequestURI && typeof url == "string" && typeof (opts?.body ?? "") == "string") {
                    const body = opts?.body as string;

                    const transformedHeaders = { ...(opts?.headers as Record<string, string>) };
                    if (authHeader != "") transformedHeaders["authorization"] = authHeader;
                    delete transformedHeaders["host"];
                    delete transformedHeaders["Host"];
                    delete transformedHeaders["content-length"];
                    delete transformedHeaders["Content-Length"];
                    const requestParam: RequestUrlParam = {
                        url,
                        method: opts?.method,
                        body: body,
                        headers: transformedHeaders,
                        contentType: "application/json",
                        // contentType: opts.headers,
                    };

                    try {
                        this.requestCount.value = this.requestCount.value + 1;
                        const r = await fetchByAPI(requestParam);
                        if (method == "POST" || method == "PUT") {
                            this.last_successful_post = r.status - (r.status % 100) == 200;
                        } else {
                            this.last_successful_post = true;
                        }
                        Logger(`HTTP:${method}${size} to:${localURL} -> ${r.status}`, LOG_LEVEL_DEBUG);

                        return new Response(r.arrayBuffer, {
                            headers: r.headers,
                            status: r.status,
                            statusText: `${r.status}`,
                        });
                    } catch (ex) {
                        Logger(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL_VERBOSE);
                        // limit only in bulk_docs.
                        if (url.toString().indexOf("_bulk_docs") !== -1) {
                            this.last_successful_post = false;
                        }
                        Logger(ex);
                        throw ex;
                    } finally {
                        this.responseCount.value = this.responseCount.value + 1;
                    }
                }

                // -old implementation

                try {
                    this.requestCount.value = this.requestCount.value + 1;
                    const response: Response = await fetch(url, opts);
                    if (method == "POST" || method == "PUT") {
                        this.last_successful_post = response.ok;
                    } else {
                        this.last_successful_post = true;
                    }
                    Logger(`HTTP:${method}${size} to:${localURL} -> ${response.status}`, LOG_LEVEL_DEBUG);
                    if (Math.floor(response.status / 100) !== 2) {
                        if (method != "GET" && localURL.indexOf("/_local/") === -1 && !localURL.endsWith("/")) {
                            const r = response.clone();
                            Logger(`The request may have failed. The reason sent by the server: ${r.status}: ${r.statusText}`);

                            try {
                                Logger(await (await r.blob()).text(), LOG_LEVEL_VERBOSE);
                            } catch (_) {
                                Logger("Cloud not parse response", LOG_LEVEL_VERBOSE);
                            }
                        } else {
                            Logger(`Just checkpoint or some server information has been missing. The 404 error shown above is not an error.`, LOG_LEVEL_VERBOSE)
                        }
                    }
                    return response;
                } catch (ex) {
                    Logger(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL_VERBOSE);
                    // limit only in bulk_docs.
                    if (url.toString().indexOf("_bulk_docs") !== -1) {
                        this.last_successful_post = false;
                    }
                    Logger(ex);
                    throw ex;
                } finally {
                    this.responseCount.value = this.responseCount.value + 1;
                }
                // return await fetch(url, opts);
            },
        };

        const db: PouchDB.Database<EntryDoc> = new PouchDB<EntryDoc>(uri, conf);
        enableCompression(db, compression);
        if (passphrase !== "false" && typeof passphrase === "string") {
            enableEncryption(db, passphrase, useDynamicIterationCount, false);
        }
        if (skipInfo) {
            return { db: db, info: { db_name: "", doc_count: 0, update_seq: "" } };
        }
        try {
            const info = await db.info();
            return { db: db, info: info };
        } catch (ex: any) {
            let msg = `${ex?.name}:${ex?.message}`;
            if (ex?.name == "TypeError" && ex?.message == "Failed to fetch") {
                msg += "\n**Note** This error caused by many reasons. The only sure thing is you didn't touch the server.\nTo check details, open inspector.";
            }
            Logger(ex, LOG_LEVEL_VERBOSE);
            return msg;
        }
    }

    get isMobile() {
        // @ts-ignore: internal API
        return this.app.isMobile
    }

    get vaultName() {
        return this.app.vault.getName()
    }
    getActiveFile() {
        return this.app.workspace.getActiveFile();
    }

    get appId() {
        return `${("appId" in this.app ? this.app.appId : "")}`;
    }

    id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
        const tempId = id2path(id, entry);
        if (stripPrefix && isInternalMetadata(tempId)) {
            const out = stripInternalMetadataPrefix(tempId);
            return out;
        }
        return tempId;
    }
    getPath(entry: AnyEntry) {
        return getPath(entry);
    }
    getPathWithoutPrefix(entry: AnyEntry) {
        return getPathWithoutPrefix(entry);
    }
    async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        const destPath = addPrefix(filename, prefix ?? "");
        return await path2id(destPath, this.settings.usePathObfuscation ? this.settings.passphrase : "");
    }

    createPouchDBInstance<T extends object>(name?: string, options?: PouchDB.Configuration.DatabaseConfiguration): PouchDB.Database<T> {
        const optionPass = options ?? {};
        if (this.settings.useIndexedDBAdapter) {
            optionPass.adapter = "indexeddb";
            //@ts-ignore :missing def
            optionPass.purged_infos_limit = 1;
            return new PouchDB(name + "-indexeddb", optionPass);
        }
        return new PouchDB(name, optionPass);
    }
    beforeOnUnload(db: LiveSyncLocalDB): void {
        this.kvDB.close();
    }
    onClose(db: LiveSyncLocalDB): void {
        this.kvDB.close();
    }
    getNewReplicator(settingOverride: Partial<ObsidianLiveSyncSettings> = {}): LiveSyncAbstractReplicator {
        const settings = { ...this.settings, ...settingOverride };
        if (settings.remoteType == REMOTE_MINIO) {
            return new LiveSyncJournalReplicator(this);
        }
        return new LiveSyncCouchDBReplicator(this);
    }
    async onInitializeDatabase(db: LiveSyncLocalDB): Promise<void> {
        this.kvDB = await OpenKeyValueDatabase(db.dbname + "-livesync-kv");
        // this.trench = new Trench(this.simpleStore);
        this.replicator = this.getNewReplicator();
    }
    async onResetDatabase(db: LiveSyncLocalDB): Promise<void> {
        const kvDBKey = "queued-files"
        this.kvDB.del(kvDBKey);
        // localStorage.removeItem(lsKey);
        await this.kvDB.destroy();
        this.kvDB = await OpenKeyValueDatabase(db.dbname + "-livesync-kv");
        // this.trench = new Trench(this.simpleStore);
        this.replicator = this.getNewReplicator()
    }
    getReplicator() {
        return this.replicator;
    }
    replicationStat = reactiveSource({
        sent: 0,
        arrived: 0,
        maxPullSeq: 0,
        maxPushSeq: 0,
        lastSyncPullSeq: 0,
        lastSyncPushSeq: 0,
        syncStatus: "CLOSED" as DatabaseConnectingStatus
    });
    // end interfaces

    getVaultName(): string {
        return this.vaultName + (this.settings?.additionalSuffixOfDatabaseName ? ("-" + this.settings.additionalSuffixOfDatabaseName) : "");
    }

    isFlagFileExist(path: string) {
        const redflag = this.vaultAccess.getAbstractFileByPath(normalizePath(path));
        if (redflag != null && redflag instanceof TFile) {
            return true;
        }
        return false;
    }
    async deleteFlagFile(path: string) {
        try {
            const redflag = this.vaultAccess.getAbstractFileByPath(normalizePath(path));
            if (redflag != null && redflag instanceof TFile) {
                await this.vaultAccess.delete(redflag, true);
            }
        } catch (ex) {
            Logger(`Could not delete ${path}`);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
    }
    isRedFlagRaised = () => this.isFlagFileExist(FLAGMD_REDFLAG)
    isRedFlag2Raised = () => this.isFlagFileExist(FLAGMD_REDFLAG2) || this.isFlagFileExist(FLAGMD_REDFLAG2_HR)
    isRedFlag3Raised = () => this.isFlagFileExist(FLAGMD_REDFLAG3) || this.isFlagFileExist(FLAGMD_REDFLAG3_HR)

    async deleteRedFlag2() {
        await this.deleteFlagFile(FLAGMD_REDFLAG2);
        await this.deleteFlagFile(FLAGMD_REDFLAG2_HR);
    }

    async deleteRedFlag3() {
        await this.deleteFlagFile(FLAGMD_REDFLAG3);
        await this.deleteFlagFile(FLAGMD_REDFLAG3_HR);
    }

    showHistory(file: TFile | FilePathWithPrefix, id?: DocumentID) {
        new DocumentHistoryModal(this.app, this, file, id).open();
    }

    async fileHistory() {
        const notes: { id: DocumentID, path: FilePathWithPrefix, dispPath: string, mtime: number }[] = [];
        for await (const doc of this.localDatabase.findAllDocs()) {
            notes.push({ id: doc._id, path: this.getPath(doc), dispPath: this.getPathWithoutPrefix(doc), mtime: doc.mtime });
        }
        notes.sort((a, b) => b.mtime - a.mtime);
        const notesList = notes.map(e => e.dispPath);
        const target = await this.askSelectString("File to view History", notesList);
        if (target) {
            const targetId = notes.find(e => e.dispPath == target)!;
            this.showHistory(targetId.path, targetId.id);
        }
    }
    async pickFileForResolve() {
        const notes: { id: DocumentID, path: FilePathWithPrefix, dispPath: string, mtime: number }[] = [];
        for await (const doc of this.localDatabase.findAllDocs({ conflicts: true })) {
            if (!("_conflicts" in doc)) continue;
            notes.push({ id: doc._id, path: this.getPath(doc), dispPath: this.getPathWithoutPrefix(doc), mtime: doc.mtime });
        }
        notes.sort((a, b) => b.mtime - a.mtime);
        const notesList = notes.map(e => e.dispPath);
        if (notesList.length == 0) {
            Logger("There are no conflicted documents", LOG_LEVEL_NOTICE);
            return false;
        }
        const target = await this.askSelectString("File to resolve conflict", notesList);
        if (target) {
            const targetItem = notes.find(e => e.dispPath == target)!;
            this.resolveConflicted(targetItem.path);
            await this.conflictCheckQueue.waitForAllProcessed();
            return true;
        }
        return false;
    }

    async resolveConflicted(target: FilePathWithPrefix) {
        if (isInternalMetadata(target)) {
            this.addOnHiddenFileSync.queueConflictCheck(target);
        } else if (isPluginMetadata(target)) {
            await this.resolveConflictByNewerEntry(target);
        } else if (isCustomisationSyncMetadata(target)) {
            await this.resolveConflictByNewerEntry(target);
        } else {
            this.queueConflictCheck(target);
        }
    }

    async collectDeletedFiles() {
        const limitDays = this.settings.automaticallyDeleteMetadataOfDeletedFiles;
        if (limitDays <= 0) return;
        Logger(`Checking expired file history`);
        const limit = Date.now() - (86400 * 1000 * limitDays);
        const notes: { path: string, mtime: number, ttl: number, doc: PouchDB.Core.ExistingDocument<EntryDoc & PouchDB.Core.AllDocsMeta> }[] = [];
        for await (const doc of this.localDatabase.findAllDocs({ conflicts: true })) {
            if (isAnyNote(doc)) {
                if (doc.deleted && (doc.mtime - limit) < 0) {
                    notes.push({ path: this.getPath(doc), mtime: doc.mtime, ttl: (doc.mtime - limit) / 1000 / 86400, doc: doc });
                }
            }
        }
        if (notes.length == 0) {
            Logger("There are no old documents");
            Logger(`Checking expired file history done`);
            return;
        }
        for (const v of notes) {
            Logger(`Deletion history expired: ${v.path}`);
            const delDoc = v.doc;
            delDoc._deleted = true;
            await this.localDatabase.putRaw(delDoc);
        }
        Logger(`Checking expired file history done`);
    }

    simpleStore: SimpleStore<CheckPointInfo> = {
        get: async (key: string) => {
            return await this.kvDB.get(`os-${key}`);
        },
        set: async (key: string, value: any) => {
            await this.kvDB.set(`os-${key}`, value);
        },
        delete: async (key) => {
            await this.kvDB.del(`os-${key}`);
        },
        keys: async (from: string | undefined, to: string | undefined, count?: number | undefined): Promise<string[]> => {
            const ret = this.kvDB.keys(IDBKeyRange.bound(`os-${from || ""}`, `os-${to || ""}`), count);
            return (await ret).map(e => e.toString()).filter(e => e.startsWith("os-")).map(e => e.substring(3));
        }
    }
    // trench!: Trench;

    getMinioJournalSyncClient() {
        const id = this.settings.accessKey
        const key = this.settings.secretKey
        const bucket = this.settings.bucket
        const region = this.settings.region
        const endpoint = this.settings.endpoint
        const useCustomRequestHandler = this.settings.useCustomRequestHandler;
        return new JournalSyncMinio(id, key, endpoint, bucket, this.simpleStore, this, useCustomRequestHandler, region);
    }
    async resetRemoteBucket() {
        const minioJournal = this.getMinioJournalSyncClient();
        await minioJournal.resetBucket();
    }
    async resetJournalSync() {
        const minioJournal = this.getMinioJournalSyncClient();
        await minioJournal.resetCheckpointInfo();
    }
    async journalSendTest() {
        const minioJournal = this.getMinioJournalSyncClient();
        await minioJournal.sendLocalJournal();
    }
    async journalFetchTest() {
        const minioJournal = this.getMinioJournalSyncClient();
        await minioJournal.receiveRemoteJournal();
    }

    async journalSyncTest() {
        const minioJournal = this.getMinioJournalSyncClient();
        await minioJournal.sync();
    }
    async onLayoutReady() {
        this.registerFileWatchEvents();
        if (!this.localDatabase.isReady) {
            Logger(`Something went wrong! The local database is not ready`, LOG_LEVEL_NOTICE);
            return;
        }
        if (!this.settings.isConfigured) {
            const message = `Hello and welcome to Self-hosted LiveSync.

Your device seems to **not be configured yet**. Please finish the setup and synchronise your vaults!

Click anywhere to stop counting down.

## At the first device
- With Setup URI -> Use \`Use the copied setup URI\`.  
  If you have configured it automatically, you should have one.
- Without Setup URI -> Use \`Setup wizard\` in setting dialogue. **\`Minimal setup\` is recommended**.
- What is the Setup URI? -> Do not worry! We have [some docs](https://github.com/vrtmrz/obsidian-livesync/blob/main/README.md#how-to-use) now. Please refer to them once.

## At the subsequent device
- With Setup URI -> Use \`Use the copied setup URI\`.  
  If you do not have it yet, you can copy it on the first device.
- Without Setup URI -> Use \`Setup wizard\` in setting dialogue, but **strongly recommends using setup URI**.
`
            const OPEN_SETUP = "Open setting dialog";
            const USE_SETUP = "Use the copied setup URI";
            const DISMISS = "Dismiss";

            const ret = await confirmWithMessage(this, "Welcome to Self-hosted LiveSync", message, [USE_SETUP, OPEN_SETUP, DISMISS], DISMISS, 40);
            if (ret === OPEN_SETUP) {
                try {
                    this.openSetting();
                } catch (ex) {
                    Logger("Something went wrong on opening setting dialog, please open it manually", LOG_LEVEL_NOTICE);
                }
            } else if (ret == USE_SETUP) {
                fireAndForget(this.addOnSetup.command_openSetupURI());
            }
            return;
        }

        try {
            if (this.isRedFlagRaised() || this.isRedFlag2Raised() || this.isRedFlag3Raised()) {
                this.settings.batchSave = false;
                this.addOnSetup.suspendAllSync();
                this.addOnSetup.suspendExtraSync();
                this.settings.suspendFileWatching = true;
                await this.saveSettings();
                if (this.isRedFlag2Raised()) {
                    Logger(`${FLAGMD_REDFLAG2} or ${FLAGMD_REDFLAG2_HR} has been detected! Self-hosted LiveSync suspends all sync and rebuild everything.`, LOG_LEVEL_NOTICE);
                    await this.addOnSetup.rebuildEverything();
                    await this.deleteRedFlag2();
                    if (await this.askYesNo("Do you want to disable Suspend file watching and restart obsidian now?") == "yes") {
                        this.settings.suspendFileWatching = false;
                        await this.saveSettings();
                        this.performAppReload();
                    }
                } else if (this.isRedFlag3Raised()) {
                    Logger(`${FLAGMD_REDFLAG3} or ${FLAGMD_REDFLAG3_HR} has been detected! Self-hosted LiveSync will discard the local database and fetch everything from the remote once again.`, LOG_LEVEL_NOTICE);
                    await this.addOnSetup.fetchLocal();
                    await this.deleteRedFlag3();
                    if (this.settings.suspendFileWatching) {
                        if (await this.askYesNo("Do you want to disable Suspend file watching and restart obsidian now?") == "yes") {
                            this.settings.suspendFileWatching = false;
                            await this.saveSettings();
                            this.performAppReload();
                        }
                    }
                } else {
                    this.settings.writeLogToTheFile = true;
                    await this.openDatabase();
                    const warningMessage = "The red flag is raised! The whole initialize steps are skipped, and any file changes are not captured.";
                    Logger(warningMessage, LOG_LEVEL_NOTICE);
                }
            } else {
                if (this.settings.suspendFileWatching) {
                    Logger("'Suspend file watching' turned on. Are you sure this is what you intended? Every modification on the vault will be ignored.", LOG_LEVEL_NOTICE);
                }
                if (this.settings.suspendParseReplicationResult) {
                    Logger("'Suspend database reflecting' turned on. Are you sure this is what you intended? Every replicated change will be postponed until disabling this option.", LOG_LEVEL_NOTICE);
                }
                const isInitialized = await this.initializeDatabase(false, false);
                if (!isInitialized) {
                    //TODO:stop all sync.
                    return false;
                }
            }
            this.registerWatchEvents();
            await this.realizeSettingSyncMode();
            this.swapSaveCommand();
            if (!this.settings.liveSync && this.settings.syncOnStart) {
                this.replicator.openReplication(this.settings, false, false, false);
            }
            this.scanStat();
        } catch (ex) {
            Logger("Error while loading Self-hosted LiveSync", LOG_LEVEL_NOTICE);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
    }

    /**
     * Scan status 
     */
    async scanStat() {
        const notes: { path: string, mtime: number }[] = [];
        Logger(`Additional safety scan..`, LOG_LEVEL_VERBOSE);
        Logger(`Checking storage sizes`, LOG_LEVEL_VERBOSE);
        if (this.settings.notifyThresholdOfRemoteStorageSize < 0) {
            const message = `Now, Self-hosted LiveSync is able to check the remote storage size on the start-up.

You can configure the threshold size for your remote storage. This will be different for your server.

Please choose the threshold size as you like.

- 0: Do not warn about storage size.
  This is recommended if you have enough space on the remote storage especially you have self-hosted. And you can check the storage size and rebuild manually.
- 800: Warn if the remote storage size exceeds 800MB.
  This is recommended if you are using fly.io with 1GB limit or IBM Cloudant.
- 2000: Warn if the remote storage size exceeds 2GB.

And if your actual storage size exceeds the threshold after the setup, you may warned again. But do not worry, you can enlarge the threshold (or rebuild everything to reduce the size).
`
            const ANSWER_0 = "Do not warn";
            const ANSWER_800 = "800MB";
            const ANSWER_2000 = "2GB";

            const ret = await confirmWithMessage(this, "Remote storage size threshold", message, [ANSWER_0, ANSWER_800, ANSWER_2000], ANSWER_800, 40);
            if (ret == ANSWER_0) {
                this.settings.notifyThresholdOfRemoteStorageSize = 0;
            } else if (ret == ANSWER_800) {
                this.settings.notifyThresholdOfRemoteStorageSize = 800;
            } else {
                this.settings.notifyThresholdOfRemoteStorageSize = 2000;
            }
        }
        if (this.settings.notifyThresholdOfRemoteStorageSize > 0) {
            const remoteStat = await this.replicator?.getRemoteStatus(this.settings);
            if (remoteStat) {
                const estimatedSize = remoteStat.estimatedSize;
                if (estimatedSize) {
                    const maxSize = this.settings.notifyThresholdOfRemoteStorageSize * 1024 * 1024;
                    if (estimatedSize > maxSize) {
                        const message = `Remote storage size: ${sizeToHumanReadable(estimatedSize)}. It exceeds the configured value ${sizeToHumanReadable(maxSize)}.
This may cause the storage to be full. You should enlarge the remote storage, or rebuild everything to reduce the size. \n
**Note:** If you are new to Self-hosted LiveSync, you should enlarge the threshold. \n

Self-hosted LiveSync will not release the storage automatically even if the file is deleted. This is why they need regular maintenance.\n

If you have enough space on the remote storage, you can enlarge the threshold. Otherwise, you should rebuild everything.\n

However, **Please make sure that all devices have been synchronised**. \n
\n`;
                        const ANSWER_ENLARGE_LIMIT = "Enlarge the limit";
                        const ANSWER_REBUILD = "Rebuild now";
                        const ANSWER_IGNORE = "Dismiss";
                        const ret = await confirmWithMessage(this, "Remote storage size exceeded", message, [ANSWER_ENLARGE_LIMIT, ANSWER_REBUILD, ANSWER_IGNORE,], ANSWER_IGNORE, 20);
                        if (ret == ANSWER_REBUILD) {
                            const ret = await this.askYesNo("This may take a bit of a long time. Do you really want to rebuild everything now?");
                            if (ret == "yes") {
                                Logger(`Receiving all from the server before rebuilding`, LOG_LEVEL_NOTICE);
                                await this.replicateAllFromServer(true);
                                await delay(3000);
                                Logger(`Obsidian will be reloaded to rebuild everything.`, LOG_LEVEL_NOTICE);
                                await this.vaultAccess.vaultCreate(FLAGMD_REDFLAG2_HR, "");
                                this.performAppReload();
                            }
                        } else if (ret == ANSWER_ENLARGE_LIMIT) {
                            this.settings.notifyThresholdOfRemoteStorageSize = ~~(estimatedSize / 1024 / 1024) + 100;
                            Logger(`Threshold has been enlarged to ${this.settings.notifyThresholdOfRemoteStorageSize}MB`, LOG_LEVEL_NOTICE);
                            await this.saveSettings();
                        } else {
                            // Dismiss or Close the dialog
                        }

                        Logger(`Remote storage size: ${sizeToHumanReadable(estimatedSize)} exceeded ${sizeToHumanReadable(this.settings.notifyThresholdOfRemoteStorageSize)} `, LOG_LEVEL_INFO);
                    } else {
                        Logger(`Remote storage size: ${sizeToHumanReadable(estimatedSize)}`, LOG_LEVEL_INFO);
                    }
                }
            }
        }

        for await (const doc of this.localDatabase.findAllDocs({ conflicts: true })) {
            if (!("_conflicts" in doc)) continue;
            notes.push({ path: this.getPath(doc), mtime: doc.mtime });
        }
        if (notes.length > 0) {
            this.askInPopup(`conflicting-detected-on-safety`, `Some files have been left conflicted! Press {HERE} to resolve them, or you can do it later by "Pick a file to resolve conflict`, (anchor) => {
                anchor.text = "HERE";
                anchor.addEventListener("click", () => {
                    this.performCommand("obsidian-livesync:livesync-all-conflictcheck");
                });
            }
            );
            Logger(`Some files have been left conflicted! Please resolve them by "Pick a file to resolve conflict". The list is written in the log.`, LOG_LEVEL_VERBOSE);
            for (const note of notes) {
                Logger(`Conflicted: ${note.path}`);
            }
        } else {
            Logger(`There are no conflicted files`, LOG_LEVEL_VERBOSE);
        }
        Logger(`Additional safety scan done`, LOG_LEVEL_VERBOSE);
    }
    async askEnableV2() {
        const message = `Since v0.20.0, Self-hosted LiveSync uses a new format for binary files and encrypted things. In the new format, files are split at meaningful delimitations, increasing the effectiveness of deduplication.
However, the new format lacks compatibility with LiveSync before v0.20.0 and related projects. Basically enabling V2 is recommended. but If you are using some related products, stay in a while, please!
Note: We can always able to read V1 format. It will be progressively converted. And, we can change this toggle later.`
        const CHOICE_V2 = "Enable v2";
        const CHOICE_V1 = "Keep v1";

        const ret = await confirmWithMessage(this, "binary and encryption", message, [CHOICE_V2, CHOICE_V1], CHOICE_V1, 40);
        return ret == CHOICE_V1;
    }

    addUIs() {
        addIcon(
            "replicate",
            `<g transform="matrix(1.15 0 0 1.15 -8.31 -9.52)" fill="currentColor" fill-rule="evenodd">
            <path d="m85 22.2c-0.799-4.74-4.99-8.37-9.88-8.37-0.499 0-1.1 0.101-1.6 0.101-2.4-3.03-6.09-4.94-10.3-4.94-6.09 0-11.2 4.14-12.8 9.79-5.59 1.11-9.78 6.05-9.78 12 0 6.76 5.39 12.2 12 12.2h29.9c5.79 0 10.1-4.74 10.1-10.6 0-4.84-3.29-8.88-7.68-10.2zm-2.99 14.7h-29.5c-2.3-0.202-4.29-1.51-5.29-3.53-0.899-2.12-0.699-4.54 0.698-6.46 1.2-1.61 2.99-2.52 4.89-2.52 0.299 0 0.698 0 0.998 0.101l1.8 0.303v-2.02c0-3.63 2.4-6.76 5.89-7.57 0.599-0.101 1.2-0.202 1.8-0.202 2.89 0 5.49 1.62 6.79 4.24l0.598 1.21 1.3-0.504c0.599-0.202 1.3-0.303 2-0.303 1.3 0 2.5 0.404 3.59 1.11 1.6 1.21 2.6 3.13 2.6 5.15v1.61h2c2.6 0 4.69 2.12 4.69 4.74-0.099 2.52-2.2 4.64-4.79 4.64z"/>
            <path d="m53.2 49.2h-41.6c-1.8 0-3.2 1.4-3.2 3.2v28.6c0 1.8 1.4 3.2 3.2 3.2h15.8v4h-7v6h24v-6h-7v-4h15.8c1.8 0 3.2-1.4 3.2-3.2v-28.6c0-1.8-1.4-3.2-3.2-3.2zm-2.8 29h-36v-23h36z"/>
            <path d="m73 49.2c1.02 1.29 1.53 2.97 1.53 4.56 0 2.97-1.74 5.65-4.39 7.04v-4.06l-7.46 7.33 7.46 7.14v-4.06c7.66-1.98 12.2-9.61 10-17-0.102-0.297-0.205-0.595-0.307-0.892z"/>
            <path d="m24.1 43c-0.817-0.991-1.53-2.97-1.53-4.56 0-2.97 1.74-5.65 4.39-7.04v4.06l7.46-7.33-7.46-7.14v4.06c-7.66 1.98-12.2 9.61-10 17 0.102 0.297 0.205 0.595 0.307 0.892z"/>
           </g>`
        );
        addIcon(
            "view-log",
            `<g transform="matrix(1.28 0 0 1.28 -131 -411)" fill="currentColor" fill-rule="evenodd">
        <path d="m103 330h76v12h-76z"/>
        <path d="m106 346v44h70v-44zm45 16h-20v-8h20z"/>
       </g>`
        );
        addIcon(
            "custom-sync",
            `<g transform="rotate(-90 75 218)"  fill="currentColor" fill-rule="evenodd">
            <path d="m272 166-9.38 9.38 9.38 9.38 9.38-9.38c1.96-1.93 5.11-1.9 7.03 0.058 1.91 1.94 1.91 5.04 0 6.98l-9.38 9.38 5.86 5.86-11.7 11.7c-8.34 8.35-21.4 9.68-31.3 3.19l-3.84 3.98c-8.45 8.7-20.1 13.6-32.2 13.6h-5.55v-9.95h5.55c9.43-0.0182 18.5-3.84 25-10.6l3.95-4.09c-6.54-9.86-5.23-23 3.14-31.3l11.7-11.7 5.86 5.86 9.38-9.38c1.96-1.93 5.11-1.9 7.03 0.0564 1.91 1.93 1.91 5.04 2e-3 6.98z"/>
        </g>`
        );
        this.addRibbonIcon("replicate", "Replicate", async () => {
            await this.replicate(true);
        }).addClass("livesync-ribbon-replicate");

        this.addRibbonIcon("view-log", "Show log", () => {
            this.showView(VIEW_TYPE_LOG);
        }).addClass("livesync-ribbon-showlog");
        this.addRibbonIcon("custom-sync", "Show Customization sync", () => {
            this.addOnConfigSync.showPluginSyncModal();
        }).addClass("livesync-ribbon-showcustom");

        this.addCommand({
            id: "view-log",
            name: "Show log",
            callback: () => {
                this.showView(VIEW_TYPE_LOG);
            }
        });

        this.addCommand({
            id: "livesync-replicate",
            name: "Replicate now",
            callback: async () => {
                await this.replicate();
            },
        });
        this.addCommand({
            id: "livesync-dump",
            name: "Dump information of this doc ",
            // editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
            //     const file = view.file;
            //     if (!file) return;
            //     this.localDatabase.getDBEntry(getPathFromTFile(file), {}, true, false);
            // },
            callback: () => {
                const file = this.getActiveFile();
                if (!file) return;
                this.localDatabase.getDBEntry(getPathFromTFile(file), {}, true, false);
            },
        });
        this.addCommand({
            id: "livesync-checkdoc-conflicted",
            name: "Resolve if conflicted.",
            editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
                const file = view.file;
                if (!file) return;
                this.queueConflictCheck(file);
            },
        });

        this.addCommand({
            id: "livesync-toggle",
            name: "Toggle LiveSync",
            callback: async () => {
                if (this.settings.liveSync) {
                    this.settings.liveSync = false;
                    Logger("LiveSync Disabled.", LOG_LEVEL_NOTICE);
                } else {
                    this.settings.liveSync = true;
                    Logger("LiveSync Enabled.", LOG_LEVEL_NOTICE);
                }
                await this.realizeSettingSyncMode();
                this.saveSettings();
            },
        });
        this.addCommand({
            id: "livesync-suspendall",
            name: "Toggle All Sync.",
            callback: async () => {
                if (this.suspended) {
                    this.suspended = false;
                    Logger("Self-hosted LiveSync resumed", LOG_LEVEL_NOTICE);
                } else {
                    this.suspended = true;
                    Logger("Self-hosted LiveSync suspended", LOG_LEVEL_NOTICE);
                }
                await this.realizeSettingSyncMode();
                this.saveSettings();
            },
        });
        this.addCommand({
            id: "livesync-history",
            name: "Show history",
            callback: () => {
                const file = this.getActiveFile();
                if (file) this.showHistory(file, undefined);
            }
        });
        this.addCommand({
            id: "livesync-scan-files",
            name: "Scan storage and database again",
            callback: async () => {
                await this.syncAllFiles(true)
            }
        })

        this.addCommand({
            id: "livesync-filehistory",
            name: "Pick a file to show history",
            callback: () => {
                this.fileHistory();
            },
        });
        this.addCommand({
            id: "livesync-conflictcheck",
            name: "Pick a file to resolve conflict",
            callback: () => {
                this.pickFileForResolve();
            },
        })
        this.addCommand({
            id: "livesync-all-conflictcheck",
            name: "Resolve all conflicted files",
            callback: async () => {
                while (await this.pickFileForResolve());
            },
        })
        this.addCommand({
            id: "livesync-runbatch",
            name: "Run pended batch processes",
            callback: async () => {
                await this.applyBatchChange();
            },
        })
        this.addCommand({
            id: "livesync-abortsync",
            name: "Abort synchronization immediately",
            callback: () => {
                this.replicator.terminateSync();
            },
        })
        this.addCommand({
            id: "livesync-global-history",
            name: "Show vault history",
            callback: () => {
                this.showGlobalHistory()
            }
        })
        this.addCommand({
            id: "livesync-export-config",
            name: "Write setting markdown manually",
            checkCallback: (checking) => {
                if (checking) {
                    return this.settings.settingSyncFile != "";
                }
                this.saveSettingData();
            }
        })
        this.addCommand({
            id: "livesync-import-config",
            name: "Parse setting file",
            editorCheckCallback: (checking, editor, ctx) => {
                if (checking) {
                    const doc = editor.getValue();
                    const ret = this.extractSettingFromWholeText(doc);
                    return ret.body != "";
                }
                if (ctx.file) this.checkAndApplySettingFromMarkdown(ctx.file.path, false);
            },
        })

        this.registerView(
            VIEW_TYPE_GLOBAL_HISTORY,
            (leaf) => new GlobalHistoryView(leaf, this)
        );
        this.registerView(
            VIEW_TYPE_LOG,
            (leaf) => new LogPaneView(leaf, this)
        );
        // eslint-disable-next-line no-unused-labels
        TEST: {
            enableTestFunction(this);
            this.registerView(
                VIEW_TYPE_TEST,
                (leaf) => new TestPaneView(leaf, this)
            );
            (async () => {
                if (await this.vaultAccess.adapterExists("_SHOWDIALOGAUTO.md"))
                    this.showView(VIEW_TYPE_TEST);
            })()
            this.addCommand({
                id: "view-test",
                name: "Open Test dialogue",
                callback: () => {
                    this.showView(VIEW_TYPE_TEST);
                }
            });
        }
    }

    async onload() {
        logStore.pipeTo(new QueueProcessor(logs => logs.forEach(e => this.addLog(e.message, e.level, e.key)), { suspended: false, batchSize: 20, concurrentLimit: 1, delay: 0 })).startPipeline();
        Logger("loading plugin");
        __onMissingTranslation(() => { });
        // eslint-disable-next-line no-unused-labels
        DEV: {
            __onMissingTranslation((key) => {
                const now = new Date();
                const filename = `missing-translation-`
                const time = now.toISOString().split("T")[0];
                const outFile = `${filename}${time}.jsonl`;
                const piece = JSON.stringify(
                    {
                        [key]: {}
                    }
                )
                const writePiece = piece.substring(1, piece.length - 1) + ",";
                fireAndForget(async () => {
                    try {
                        await this.vaultAccess.ensureDirectory(this.app.vault.configDir + "/ls-debug/");
                        await this.vaultAccess.adapterAppend(this.app.vault.configDir + "/ls-debug/" + outFile, writePiece + "\n")
                    } catch (ex) {
                        Logger(`Could not write ${outFile}`, LOG_LEVEL_VERBOSE);
                        Logger(`Missing translation: ${writePiece}`, LOG_LEVEL_VERBOSE);
                    }
                });
            })
        }
        this.settingTab = new ObsidianLiveSyncSettingTab(this.app, this);
        this.addSettingTab(this.settingTab);
        this.addUIs();
        //@ts-ignore
        const manifestVersion: string = MANIFEST_VERSION || "0.0.0";
        //@ts-ignore
        const packageVersion: string = PACKAGE_VERSION || "0.0.0";

        this.manifestVersion = manifestVersion;
        this.packageVersion = packageVersion;

        Logger($f`Self-hosted LiveSync${" v"}${manifestVersion} ${packageVersion}`);
        await this.loadSettings();
        const lsKey = "obsidian-live-sync-ver" + this.getVaultName();
        const last_version = localStorage.getItem(lsKey);
        this.observeForLogs();
        if (this.settings.showStatusOnStatusbar) {
            this.statusBar = this.addStatusBarItem();
            this.statusBar.addClass("syncstatusbar");
        }
        const lastVersion = ~~(versionNumberString2Number(manifestVersion) / 1000);
        if (lastVersion > this.settings.lastReadUpdates && this.settings.isConfigured) {
            Logger($f`Self-hosted LiveSync has undergone a major upgrade. Please open the setting dialog, and check the information pane.`, LOG_LEVEL_NOTICE);
        }

        //@ts-ignore
        if (this.isMobile) {
            this.settings.disableRequestURI = true;
        }
        if (last_version && Number(last_version) < VER) {
            this.settings.liveSync = false;
            this.settings.syncOnSave = false;
            this.settings.syncOnEditorSave = false;
            this.settings.syncOnStart = false;
            this.settings.syncOnFileOpen = false;
            this.settings.syncAfterMerge = false;
            this.settings.periodicReplication = false;
            this.settings.versionUpFlash = $f`Self-hosted LiveSync has been upgraded and some behaviors have changed incompatibly. All automatic synchronization is now disabled temporary. Ensure that other devices are also upgraded, and enable synchronization again.`;
            this.saveSettings();
        }
        localStorage.setItem(lsKey, `${VER}`);
        await this.openDatabase();
        this.watchWorkspaceOpen = this.watchWorkspaceOpen.bind(this);
        this.watchEditorChange = this.watchEditorChange.bind(this);
        this.watchWindowVisibility = this.watchWindowVisibility.bind(this)
        this.watchOnline = this.watchOnline.bind(this);
        this.realizeSettingSyncMode = this.realizeSettingSyncMode.bind(this);
        this.parseReplicationResult = this.parseReplicationResult.bind(this);

        this.loadQueuedFiles = this.loadQueuedFiles.bind(this);

        await Promise.all(this.addOns.map(e => e.onload()));

        this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));


    }
    async showView(viewType: string) {
        const leaves = this.app.workspace.getLeavesOfType(viewType);
        if (leaves.length == 0) {
            await this.app.workspace.getLeaf(true).setViewState({
                type: viewType,
                active: true,
            });
        } else {
            leaves[0].setViewState({
                type: viewType,
                active: true,
            })
        }
        if (leaves.length > 0) {
            this.app.workspace.revealLeaf(
                leaves[0]
            );
        }
    }
    showGlobalHistory() {
        this.showView(VIEW_TYPE_GLOBAL_HISTORY);
    }

    onunload() {
        terminateWorker();
        cancelAllPeriodicTask();
        cancelAllTasks();
        stopAllRunningProcessors();
        this._unloaded = true;
        for (const addOn of this.addOns) {
            addOn.onunload();
        }
        if (this.localDatabase != null) {
            this.localDatabase.onunload();
        }
        this.periodicSyncProcessor?.disable();
        if (this.localDatabase != null) {
            this.replicator.closeReplication();
            this.localDatabase.close();
        }
        Logger($f`unloading plugin`);
    }

    async openDatabase() {
        if (this.localDatabase != null) {
            await this.localDatabase.close();
        }
        const vaultName = this.getVaultName();
        Logger($f`Waiting for ready...`);
        this.localDatabase = new LiveSyncLocalDB(vaultName, this);
        initializeStores(vaultName);
        return await this.localDatabase.initializeDatabase();
    }

    usedPassphrase = "";

    getPassphrase(settings: ObsidianLiveSyncSettings) {
        const methods: Record<ConfigPassphraseStore, (() => Promise<string | false>)> = {
            "": () => Promise.resolve("*"),
            "LOCALSTORAGE": () => Promise.resolve(localStorage.getItem("ls-setting-passphrase") ?? false),
            "ASK_AT_LAUNCH": () => askString(this.app, "Passphrase", "passphrase", "")
        }
        const method = settings.configPassphraseStore;
        const methodFunc = method in methods ? methods[method] : methods[""];
        return methodFunc();
    }

    async decryptConfigurationItem(encrypted: string, passphrase: string) {
        const dec = await tryDecrypt(encrypted, passphrase + SALT_OF_PASSPHRASE, false);
        if (dec) {
            this.usedPassphrase = passphrase;
            return dec;
        }
        return false;
    }
    tryDecodeJson(encoded: string | false): object | false {
        try {
            if (!encoded) return false;
            return JSON.parse(encoded);
        } catch (ex) {
            return false;
        }
    }

    async encryptConfigurationItem(src: string, settings: ObsidianLiveSyncSettings) {
        if (this.usedPassphrase != "") {
            return await encrypt(src, this.usedPassphrase + SALT_OF_PASSPHRASE, false);
        }

        const passphrase = await this.getPassphrase(settings);
        if (passphrase === false) {
            Logger("Could not determine passphrase to save data.json! You probably make the configuration sure again!", LOG_LEVEL_URGENT);
            return "";
        }
        const dec = await encrypt(src, passphrase + SALT_OF_PASSPHRASE, false);
        if (dec) {
            this.usedPassphrase = passphrase;
            return dec;
        }

        return "";
    }

    async loadSettings() {
        const settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as ObsidianLiveSyncSettings;

        if (typeof settings.isConfigured == "undefined") {
            // If migrated, mark true
            if (JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS)) {
                settings.isConfigured = true;
            } else {
                settings.additionalSuffixOfDatabaseName = this.appId;
                settings.isConfigured = false;
            }
        }
        const passphrase = await this.getPassphrase(settings);
        if (passphrase === false) {
            Logger("Could not determine passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL_URGENT);
        } else {
            if (settings.encryptedCouchDBConnection) {
                const keys = ["couchDB_URI", "couchDB_USER", "couchDB_PASSWORD", "couchDB_DBNAME", "accessKey", "bucket", "endpoint", "region", "secretKey"] as (keyof CouchDBConnection | keyof BucketSyncSetting)[];
                const decrypted = this.tryDecodeJson(await this.decryptConfigurationItem(settings.encryptedCouchDBConnection, passphrase)) as (CouchDBConnection & BucketSyncSetting);
                if (decrypted) {
                    for (const key of keys) {
                        if (key in decrypted) {
                            //@ts-ignore
                            settings[key] = decrypted[key]
                        }
                    }
                } else {
                    Logger("Could not decrypt passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL_URGENT);
                    for (const key of keys) {
                        //@ts-ignore
                        settings[key] = "";
                    }
                }
            }
            if (settings.encrypt && settings.encryptedPassphrase) {
                const encrypted = settings.encryptedPassphrase;
                const decrypted = await this.decryptConfigurationItem(encrypted, passphrase);
                if (decrypted) {
                    settings.passphrase = decrypted;
                } else {
                    Logger("Could not decrypt passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL_URGENT);
                    settings.passphrase = "";
                }
            }

        }
        this.settings = settings;
        setLang(this.settings.displayLanguage);

        if ("workingEncrypt" in this.settings) delete this.settings.workingEncrypt;
        if ("workingPassphrase" in this.settings) delete this.settings.workingPassphrase;

        // Delete this feature to avoid problems on mobile.
        this.settings.disableRequestURI = true;

        // GC is disabled.
        this.settings.gcDelay = 0;
        // So, use history is always enabled.
        this.settings.useHistory = true;

        const lsKey = "obsidian-live-sync-vaultanddevicename-" + this.getVaultName();
        if (this.settings.deviceAndVaultName != "") {
            if (!localStorage.getItem(lsKey)) {
                this.deviceAndVaultName = this.settings.deviceAndVaultName;
                localStorage.setItem(lsKey, this.deviceAndVaultName);
                this.settings.deviceAndVaultName = "";
            }
        }
        if (isCloudantURI(this.settings.couchDB_URI) && this.settings.customChunkSize != 0) {
            Logger("Configuration verification founds problems with your configuration. This has been fixed automatically. But you may already have data that cannot be synchronised. If this is the case, please rebuild everything.", LOG_LEVEL_NOTICE)
            this.settings.customChunkSize = 0;
        }
        this.deviceAndVaultName = localStorage.getItem(lsKey) || "";
        if (this.deviceAndVaultName == "") {
            if (this.settings.usePluginSync) {
                Logger("Device name is not set. Plug-in sync has been disabled.", LOG_LEVEL_NOTICE);
                this.settings.usePluginSync = false;
            }
        }
        this.ignoreFiles = this.settings.ignoreFiles.split(",").map(e => e.trim());
        this.settingTab.requestReload()
    }

    saveDeviceAndVaultName() {
        const lsKey = "obsidian-live-sync-vaultanddevicename-" + this.getVaultName();
        localStorage.setItem(lsKey, this.deviceAndVaultName || "");
    }
    async saveSettingData() {
        this.saveDeviceAndVaultName();
        const settings = { ...this.settings };
        settings.deviceAndVaultName = "";
        if (this.usedPassphrase == "" && !await this.getPassphrase(settings)) {
            Logger("Could not determine passphrase for saving data.json! Our data.json have insecure items!", LOG_LEVEL_NOTICE);
        } else {
            if (settings.couchDB_PASSWORD != "" || settings.couchDB_URI != "" || settings.couchDB_USER != "" || settings.couchDB_DBNAME) {
                const connectionSetting: CouchDBConnection & BucketSyncSetting = {
                    couchDB_DBNAME: settings.couchDB_DBNAME,
                    couchDB_PASSWORD: settings.couchDB_PASSWORD,
                    couchDB_URI: settings.couchDB_URI,
                    couchDB_USER: settings.couchDB_USER,
                    accessKey: settings.accessKey,
                    bucket: settings.bucket,
                    endpoint: settings.endpoint,
                    region: settings.region,
                    secretKey: settings.secretKey,
                    useCustomRequestHandler: settings.useCustomRequestHandler
                };
                settings.encryptedCouchDBConnection = await this.encryptConfigurationItem(JSON.stringify(connectionSetting), settings);
                settings.couchDB_PASSWORD = "";
                settings.couchDB_DBNAME = "";
                settings.couchDB_URI = "";
                settings.couchDB_USER = "";
                settings.accessKey = "";
                settings.bucket = "";
                settings.region = "";
                settings.secretKey = "";
                settings.endpoint = "";
            }
            if (settings.encrypt && settings.passphrase != "") {
                settings.encryptedPassphrase = await this.encryptConfigurationItem(settings.passphrase, settings);
                settings.passphrase = "";
            }

        }
        await this.saveData(settings);
        this.localDatabase.settings = this.settings;
        setLang(this.settings.displayLanguage);
        this.settingTab.requestReload();
        this.ignoreFiles = this.settings.ignoreFiles.split(",").map(e => e.trim());
        if (this.settings.settingSyncFile != "") {
            fireAndForget(() => this.saveSettingToMarkdown(this.settings.settingSyncFile));
        }
    }

    extractSettingFromWholeText(data: string): { preamble: string, body: string, postscript: string } {
        if (data.indexOf(SETTING_HEADER) === -1) {
            return {
                preamble: data,
                body: "",
                postscript: ""
            }
        }
        const startMarkerPos = data.indexOf(SETTING_HEADER);
        const dataStartPos = startMarkerPos == -1 ? data.length : startMarkerPos;
        const endMarkerPos = startMarkerPos == -1 ? data.length : data.indexOf(SETTING_FOOTER, dataStartPos);
        const dataEndPos = endMarkerPos == -1 ? data.length : endMarkerPos;
        const body = data.substring(dataStartPos + SETTING_HEADER.length, dataEndPos);
        const ret = {
            preamble: data.substring(0, dataStartPos),
            body,
            postscript: data.substring(dataEndPos + SETTING_FOOTER.length + 1)
        }
        return ret;
    }

    async parseSettingFromMarkdown(filename: string, data?: string) {
        const file = this.vaultAccess.getAbstractFileByPath(filename);
        if (!(file instanceof TFile)) return {
            preamble: "",
            body: "",
            postscript: "",
        };
        if (data) {
            return this.extractSettingFromWholeText(data);
        }
        const parseData = data ?? await this.vaultAccess.vaultRead(file);
        return this.extractSettingFromWholeText(parseData);
    }

    async checkAndApplySettingFromMarkdown(filename: string, automated?: boolean) {
        if (automated && !this.settings.notifyAllSettingSyncFile) {
            if (!this.settings.settingSyncFile || this.settings.settingSyncFile != filename) {
                Logger(`Setting file (${filename}) is not matched to the current configuration. skipped.`, LOG_LEVEL_DEBUG);
                return;
            }
        }
        const { body } = await this.parseSettingFromMarkdown(filename);
        let newSetting = {} as Partial<ObsidianLiveSyncSettings>;
        try {
            newSetting = parseYaml(body);
        } catch (ex) {
            Logger("Could not parse YAML", LOG_LEVEL_NOTICE);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return;
        }

        if ("settingSyncFile" in newSetting && newSetting.settingSyncFile != filename) {
            Logger("This setting file seems to backed up one. Please fix the filename or settingSyncFile value.", automated ? LOG_LEVEL_INFO : LOG_LEVEL_NOTICE);
            return;
        }


        let settingToApply = { ...DEFAULT_SETTINGS } as ObsidianLiveSyncSettings;
        settingToApply = { ...settingToApply, ...newSetting }
        if (!(settingToApply?.writeCredentialsForSettingSync)) {
            //New setting does not contains credentials. 
            settingToApply.couchDB_USER = this.settings.couchDB_USER;
            settingToApply.couchDB_PASSWORD = this.settings.couchDB_PASSWORD;
            settingToApply.passphrase = this.settings.passphrase;
        }
        const oldSetting = this.generateSettingForMarkdown(this.settings, settingToApply.writeCredentialsForSettingSync);
        if (!isObjectDifferent(oldSetting, this.generateSettingForMarkdown(settingToApply))) {
            Logger("Setting markdown has been detected, but not changed.", automated ? LOG_LEVEL_INFO : LOG_LEVEL_NOTICE);
            return
        }
        const addMsg = this.settings.settingSyncFile != filename ? " (This is not-active file)" : "";
        this.askInPopup("apply-setting-from-md", `Setting markdown ${filename}${addMsg} has been detected. Apply this from {HERE}.`, (anchor) => {
            anchor.text = "HERE";
            anchor.addEventListener("click", async () => {
                const APPLY_ONLY = "Apply settings";
                const APPLY_AND_RESTART = "Apply settings and restart obsidian";
                const APPLY_AND_REBUILD = "Apply settings and restart obsidian with red_flag_rebuild.md";
                const APPLY_AND_FETCH = "Apply settings and restart obsidian with red_flag_fetch.md";
                const CANCEL = "Cancel";
                const result = await this.askSelectString("Ready for apply the setting.", [APPLY_AND_RESTART, APPLY_ONLY, APPLY_AND_FETCH, APPLY_AND_REBUILD, CANCEL]);
                if (result == APPLY_ONLY || result == APPLY_AND_RESTART || result == APPLY_AND_REBUILD || result == APPLY_AND_FETCH) {
                    this.settings = settingToApply;
                    await this.saveSettingData();
                    if (result == APPLY_ONLY) {
                        Logger("Loaded settings have been applied!", LOG_LEVEL_NOTICE);
                        return;
                    }
                    if (result == APPLY_AND_REBUILD) {
                        await this.vaultAccess.vaultCreate(FLAGMD_REDFLAG2_HR, "");
                    }
                    if (result == APPLY_AND_FETCH) {
                        await this.vaultAccess.vaultCreate(FLAGMD_REDFLAG3_HR, "");
                    }
                    this.performAppReload();
                }
            }
            )
        })
    }
    generateSettingForMarkdown(settings?: ObsidianLiveSyncSettings, keepCredential?: boolean): Partial<ObsidianLiveSyncSettings> {
        const saveData = { ...(settings ? settings : this.settings) } as Partial<ObsidianLiveSyncSettings>;
        delete saveData.encryptedCouchDBConnection;
        delete saveData.encryptedPassphrase;
        if (!saveData.writeCredentialsForSettingSync && !keepCredential) {
            delete saveData.couchDB_USER;
            delete saveData.couchDB_PASSWORD;
            delete saveData.passphrase;
        }
        return saveData;
    }

    async saveSettingToMarkdown(filename: string) {
        const saveData = this.generateSettingForMarkdown();
        let file = this.vaultAccess.getAbstractFileByPath(filename);


        if (!file) {
            await this.vaultAccess.ensureDirectory(filename);
            const initialContent = `This file contains Self-hosted LiveSync settings as YAML.
Except for the \`livesync-setting\` code block, we can add a note for free.

If the name of this file matches the value of the "settingSyncFile" setting inside the \`livesync-setting\` block, LiveSync will tell us whenever the settings change. We can decide to accept or decline the remote setting. (In other words, we can back up this file by renaming it to another name).

We can perform a command in this file.
- \`Parse setting file\` : load the setting from the file.

**Note** Please handle it with all of your care if you have configured to write credentials in.


`
            file = await this.vaultAccess.vaultCreate(filename, initialContent + SETTING_HEADER + "\n" + SETTING_FOOTER);
        }
        if (!(file instanceof TFile)) {
            Logger(`Markdown Setting: ${filename} already exists as a folder`, LOG_LEVEL_NOTICE);
            return;
        }

        const data = await this.vaultAccess.vaultRead(file);
        const { preamble, body, postscript } = this.extractSettingFromWholeText(data);
        const newBody = stringifyYaml(saveData);

        if (newBody == body) {
            Logger("Markdown setting: Nothing had been changed", LOG_LEVEL_VERBOSE);
        } else {
            await this.vaultAccess.vaultModify(file, preamble + SETTING_HEADER + newBody + SETTING_FOOTER + postscript);
            Logger(`Markdown setting: ${filename} has been updated!`, LOG_LEVEL_VERBOSE);
        }
    }


    async saveSettings() {
        await this.saveSettingData();
        fireAndForget(() => this.realizeSettingSyncMode());
    }

    vaultManager: StorageEventManager = new StorageEventManagerObsidian(this);
    registerFileWatchEvents() {
        this.vaultManager.beginWatch();
        this.registerEvent(this.app.workspace.on("editor-change", this.watchEditorChange));
    }
    _initialCallback: any;
    swapSaveCommand() {
        Logger("Modifying callback of the save command", LOG_LEVEL_VERBOSE);
        const saveCommandDefinition = (this.app as any).commands?.commands?.[
            "editor:save-file"
        ];
        const save = saveCommandDefinition?.callback;
        if (typeof save === "function") {
            this._initialCallback = save;
            saveCommandDefinition.callback = () => {
                scheduleTask("syncOnEditorSave", 250, () => {
                    if (this._unloaded) {
                        Logger("Unload and remove the handler.", LOG_LEVEL_VERBOSE);
                        saveCommandDefinition.callback = this._initialCallback;
                        this._initialCallback = undefined;
                    } else {
                        if (this.settings.syncOnEditorSave) {
                            Logger("Sync on Editor Save.", LOG_LEVEL_VERBOSE);
                            this.replicate();
                        }
                    }
                });
                save();
            };
        }
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const _this = this;
        //@ts-ignore
        window.CodeMirrorAdapter.commands.save = () => {
            _this.performCommand('editor:save-file');
        };
    }
    hasFocus = true;
    isLastHidden = false;
    registerWatchEvents() {
        this.registerEvent(this.app.workspace.on("file-open", this.watchWorkspaceOpen));
        this.registerDomEvent(document, "visibilitychange", this.watchWindowVisibility);
        this.registerDomEvent(window, "focus", () => this.setHasFocus(true));
        this.registerDomEvent(window, "blur", () => this.setHasFocus(false));
        this.registerDomEvent(window, "online", this.watchOnline);
        this.registerDomEvent(window, "offline", this.watchOnline);
    }

    watchOnline() {
        scheduleTask("watch-online", 500, () => fireAndForget(() => this.watchOnlineAsync()));
    }
    async watchOnlineAsync() {
        // If some files were failed to retrieve, scan files again.
        // TODO:FIXME AT V0.17.31, this logic has been disabled.
        if (navigator.onLine && this.localDatabase.needScanning) {
            this.localDatabase.needScanning = false;
            await this.syncAllFiles();
        }
    }
    setHasFocus(hasFocus: boolean) {
        this.hasFocus = hasFocus;
        this.watchWindowVisibility();
    }
    watchWindowVisibility() {
        scheduleTask("watch-window-visibility", 100, () => fireAndForget(() => this.watchWindowVisibilityAsync()));
    }

    async watchWindowVisibilityAsync() {
        if (this.settings.suspendFileWatching) return;
        if (!this.settings.isConfigured) return;
        if (!this.isReady) return;

        if (this.isLastHidden && !this.hasFocus) {
            // NO OP while non-focused after made hidden;
            return;
        }

        const isHidden = document.hidden;
        if (this.isLastHidden === isHidden) {
            return;
        }
        this.isLastHidden = isHidden;

        await this.applyBatchChange();
        if (isHidden) {
            this.replicator.closeReplication();
            this.periodicSyncProcessor?.disable();
        } else {
            // suspend all temporary.
            if (this.suspended) return;
            if (!this.hasFocus) return;
            await Promise.all(this.addOns.map(e => e.onResume()));
            if (this.settings.remoteType == REMOTE_COUCHDB) {
                if (this.settings.liveSync) {
                    this.replicator.openReplication(this.settings, true, false, false);
                }
            }
            if (!this.settings.liveSync && this.settings.syncOnStart) {
                this.replicator.openReplication(this.settings, false, false, false);
            }
            this.periodicSyncProcessor.enable(this.settings.periodicReplication ? this.settings.periodicReplicationInterval * 1000 : 0);
        }
    }

    cancelRelativeEvent(item: FileEventItem) {
        this.vaultManager.cancelQueue(item.key);
    }


    async handleFileEvent(queue: FileEventItem): Promise<any> {
        const file = queue.args.file;
        const lockKey = `handleFile:${file.path}`;
        return await serialized(lockKey, async () => {
            // TODO CHECK
            // console.warn(lockKey);
            const key = `file-last-proc-${queue.type}-${file.path}`;
            const last = Number(await this.kvDB.get(key) || 0);
            let mtime = file.mtime;
            if (queue.type == "DELETE") {
                await this.deleteFromDBbyPath(file.path);
                mtime = file.mtime - 1;
                const keyD1 = `file-last-proc-CREATE-${file.path}`;
                const keyD2 = `file-last-proc-CHANGED-${file.path}`;
                await this.kvDB.set(keyD1, mtime);
                await this.kvDB.set(keyD2, mtime);
            } else if (queue.type == "INTERNAL") {
                await this.addOnHiddenFileSync.watchVaultRawEventsAsync(file.path);
                await this.addOnConfigSync.watchVaultRawEventsAsync(file.path);
            } else {
                const targetFile = this.vaultAccess.getAbstractFileByPath(file.path);
                if (!(targetFile instanceof TFile)) {
                    Logger(`Target file was not found: ${file.path}`, LOG_LEVEL_INFO);
                    return;
                }
                if (file.mtime == last) {
                    Logger(`File has been already scanned on ${queue.type}, skip: ${file.path}`, LOG_LEVEL_VERBOSE);
                    return;
                }

                // const cache = queue.args.cache;
                if (queue.type == "CREATE" || queue.type == "CHANGED") {
                    fireAndForget(() => this.checkAndApplySettingFromMarkdown(queue.args.file.path, true));
                    const keyD1 = `file-last-proc-DELETED-${file.path}`;
                    await this.kvDB.set(keyD1, mtime);
                    if (!await this.updateIntoDB(targetFile, undefined)) {
                        Logger(`STORAGE -> DB: failed, cancel the relative operations: ${targetFile.path}`, LOG_LEVEL_INFO);
                        // cancel running queues and remove one of atomic operation
                        this.cancelRelativeEvent(queue);
                        return;
                    }
                }
                if (queue.type == "RENAME") {
                    // Obsolete
                    await this.watchVaultRenameAsync(targetFile, queue.args.oldPath);
                }
            }
            await this.kvDB.set(key, mtime);
        });
    }

    pendingFileEventCount = reactiveSource(0);
    processingFileEventCount = reactiveSource(0);


    watchWorkspaceOpen(file: TFile | null) {
        if (this.settings.suspendFileWatching) return;
        if (!this.settings.isConfigured) return;
        if (!this.isReady) return;
        if (!file) return;
        scheduleTask("watch-workspace-open", 500, () => fireAndForget(() => this.watchWorkspaceOpenAsync(file)));
    }


    flushFileEventQueue() {
        return this.vaultManager.flushQueue();
    }

    watchEditorChange(editor: Editor, info: any) {
        if (!("path" in info)) {
            return;
        }
        if (!this.shouldBatchSave) {
            return;
        }
        const file = info?.file as TFile;
        if (!file) return;
        if (!this.vaultManager.isWaiting(file.path as FilePath)) {
            return;
        }
        const data = info?.data as string;
        const fi: FileEvent = {
            type: "CHANGED",
            file: file,
            cachedData: data,
        }
        this.vaultManager.appendQueue([
            fi
        ])
    }

    async watchWorkspaceOpenAsync(file: TFile) {
        if (this.settings.suspendFileWatching) return;
        if (!this.settings.isConfigured) return;
        if (!this.isReady) return;
        await this.applyBatchChange();
        if (file == null) {
            return;
        }
        if (this.settings.syncOnFileOpen && !this.suspended) {
            await this.replicate();
        }
        this.queueConflictCheck(file);
    }

    async applyBatchChange() {
        if (this.settings.batchSave && !this.settings.liveSync) {
            return await this.flushFileEventQueue();
        }
    }

    getFilePath(file: TAbstractFile): string {
        if (file instanceof TFolder) {
            if (file.isRoot()) return "";
            return this.getFilePath(file.parent!) + "/" + file.name;
        }
        if (file instanceof TFile) {
            return this.getFilePath(file.parent!) + "/" + file.name;
        }
        return this.getFilePath(file.parent!) + "/" + file.name;
    }

    async watchVaultRenameAsync(file: TFile, oldFile: any, cache?: CacheData) {
        Logger(`${oldFile} renamed to ${file.path}`, LOG_LEVEL_VERBOSE);
        if (file instanceof TFile) {
            try {
                // Logger(`RENAMING.. ${file.path} into db`);
                if (await this.updateIntoDB(file, cache)) {
                    // Logger(`deleted ${oldFile} from db`);
                    await this.deleteFromDBbyPath(oldFile);
                } else {
                    Logger(`Could not save new file: ${file.path} `, LOG_LEVEL_NOTICE);
                }
            } catch (ex) {
                Logger(ex);
            }
        }
    }

    //--> Basic document Functions
    notifies: { [key: string]: { notice: Notice; count: number } } = {};

    statusLog = reactiveSource("");
    // eslint-disable-next-line require-await
    async addLog(message: any, level: LOG_LEVEL = LOG_LEVEL_INFO, key = "") {
        if (level == LOG_LEVEL_DEBUG && !isDebug) {
            return;
        }
        if (level < LOG_LEVEL_INFO && this.settings && this.settings.lessInformationInLog) {
            return;
        }
        if (this.settings && !this.settings.showVerboseLog && level == LOG_LEVEL_VERBOSE) {
            return;
        }
        const vaultName = this.getVaultName();
        const now = new Date();
        const timestamp = now.toLocaleString();
        const messageContent = typeof message == "string" ? message : message instanceof Error ? `${message.name}:${message.message}` : JSON.stringify(message, null, 2);
        if (message instanceof Error) {
            // debugger;
            console.dir(message.stack);
        }
        const newMessage = timestamp + "->" + messageContent;

        console.log(vaultName + ":" + newMessage);
        if (!this.settings?.showOnlyIconsOnEditor) {
            this.statusLog.value = messageContent;
        }
        if (this.settings?.writeLogToTheFile) {
            const time = now.toISOString().split("T")[0];
            const logDate = `${PREFIXMD_LOGFILE}${time}.md`;
            const file = this.vaultAccess.getAbstractFileByPath(normalizePath(logDate));
            if (!file) {
                this.vaultAccess.adapterAppend(normalizePath(logDate), "```\n");
            }
            this.vaultAccess.adapterAppend(normalizePath(logDate), vaultName + ":" + newMessage + "\n");
        }
        recentLogProcessor.enqueue(newMessage);

        if (level >= LOG_LEVEL_NOTICE) {
            if (!key) key = messageContent;
            if (key in this.notifies) {
                // @ts-ignore
                const isShown = this.notifies[key].notice.noticeEl?.isShown()
                if (!isShown) {
                    this.notifies[key].notice = new Notice(messageContent, 0);
                }
                cancelTask(`notify-${key}`);
                if (key == messageContent) {
                    this.notifies[key].count++;
                    this.notifies[key].notice.setMessage(`(${this.notifies[key].count}):${messageContent}`);
                } else {
                    this.notifies[key].notice.setMessage(`${messageContent}`);
                }
            } else {
                const notify = new Notice(messageContent, 0);
                this.notifies[key] = {
                    count: 0,
                    notice: notify,
                };
            }
            const timeout = 5000;
            scheduleTask(`notify-${key}`, timeout, () => {
                const notify = this.notifies[key].notice;
                delete this.notifies[key];
                try {
                    notify.hide();
                } catch (ex) {
                    // NO OP
                }
            })
        }
    }
    async processEntryDoc(docEntry: EntryBody, file: TFile | undefined, force?: boolean) {
        const mode = file == undefined ? "create" : "modify";

        const path = this.getPath(docEntry);
        if (shouldBeIgnored(path)) {
            return;
        }
        if (!await this.isTargetFile(path)) return;

        // Conflict resolution check
        const existDoc = await this.localDatabase.getDBEntry(path, { conflicts: true });
        const msg = `STORAGE <- DB (${mode}${force ? ",force" : ""},${existDoc ? existDoc?.datatype : "--"}) `;
        // let performPullFileAgain = false;
        if (existDoc && existDoc._conflicts) {
            if (this.settings.writeDocumentsIfConflicted) {
                Logger(`Processing: ${path}: Conflicted revision has been deleted, but there were more conflicts. `, LOG_LEVEL_INFO);
                await this.processEntryDoc(docEntry, file, true);
                return;
            } else if (force != true) {
                Logger(`Processing: ${path}: Conflicted revision has been deleted, but there were more conflicts...`);
                this.queueConflictCheck(path);
                return;
            }
        }
        // If there are no conflicts, or forced to overwrite.

        if (docEntry._deleted || docEntry.deleted || existDoc === false) {
            if (!file) {
                Logger(`delete skipped: ${path} :Already not exist on storage`, LOG_LEVEL_VERBOSE);
                return;
            }
            if (file.path != path) {
                Logger(`delete skipped: ${path} :Not exactly matched`, LOG_LEVEL_VERBOSE);
                return;
            }
            if (existDoc === false) {
                await this.deleteVaultItem(file);
            } else {
                // Conflict has been resolved at this time, 
                await this.pullFile(path, undefined, true);
            }
            return;
        }

        const compareResult = compareFileFreshness(file, docEntry);

        const doc = existDoc;

        if (!isAnyNote(doc)) {
            Logger(msg + "ERROR, Invalid type: " + path + "(" + (doc as any)?.type || "type missing" + ")", LOG_LEVEL_NOTICE);
            return;
        }
        // if (!force && localMtime >= docMtime) return;
        if (!force && (compareResult == BASE_IS_NEW || compareResult == EVEN)) return;
        if (!isValidPath(path)) {
            Logger(msg + "ERROR, invalid path: " + path, LOG_LEVEL_NOTICE);
            return;
        }
        const writeData = readContent(doc);
        await this.vaultAccess.ensureDirectory(path);
        try {
            let outFile;
            let isChanged = true;
            if (!file) {
                const normalizedPath = normalizePath(path);
                await this.vaultAccess.vaultCreate(normalizedPath, writeData, { ctime: doc.ctime, mtime: doc.mtime, });
                outFile = this.vaultAccess.getAbstractFileByPath(normalizedPath) as TFile;
            } else {
                isChanged = await this.vaultAccess.vaultModify(file, writeData, { ctime: doc.ctime, mtime: doc.mtime });
                outFile = this.vaultAccess.getAbstractFileByPath(getPathFromTFile(file)) as TFile;
            }
            if (isChanged) {
                Logger(msg + path);
                this.vaultAccess.touch(outFile);
                this.vaultAccess.trigger(mode, outFile);
            } else {
                Logger(msg + "Skipped, the file is the same: " + path, LOG_LEVEL_VERBOSE);
            }

        } catch (ex) {
            Logger(msg + "ERROR, Could not write: " + path, LOG_LEVEL_NOTICE);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }
    }

    async deleteVaultItem(file: TFile | TFolder) {
        if (file instanceof TFile) {
            if (!await this.isTargetFile(file)) return;
        }
        const dir = file.parent;
        if (this.settings.trashInsteadDelete) {
            await this.vaultAccess.trash(file, false);
        } else {
            await this.vaultAccess.delete(file, true);
        }
        Logger(`xxx <- STORAGE (deleted) ${file.path}`);
        if (dir) {
            Logger(`files: ${dir.children.length}`);
            if (dir.children.length == 0) {
                if (!this.settings.doNotDeleteFolder) {
                    Logger(`All files under the parent directory (${dir.path}) have been deleted, so delete this one.`);
                    await this.deleteVaultItem(dir);
                }
            }
        }
    }

    queueConflictCheck(file: FilePathWithPrefix | TFile) {
        const path = file instanceof TFile ? getPathFromTFile(file) : file;
        if (this.settings.checkConflictOnlyOnOpen) {
            const af = this.getActiveFile();
            if (af && af.path != path) {
                Logger(`${file} is conflicted, merging process has been postponed.`, LOG_LEVEL_NOTICE);
                return;
            }
        }
        this.conflictCheckQueue.enqueue(path);
    }

    _saveQueuedFiles = throttle(() => {
        const saveData = this.replicationResultProcessor._queue.filter(e => e !== undefined && e !== null).map((e) => e?._id ?? "" as string) as string[];
        const kvDBKey = "queued-files"
        // localStorage.setItem(lsKey, saveData);
        fireAndForget(() => this.kvDB.set(kvDBKey, saveData));
    }, 100);
    saveQueuedFiles() {
        this._saveQueuedFiles();
    }
    async loadQueuedFiles() {
        if (this.settings.suspendParseReplicationResult) return;
        if (!this.settings.isConfigured) return;
        const kvDBKey = "queued-files"
        // const ids = [...new Set(JSON.parse(localStorage.getItem(lsKey) || "[]"))] as string[];
        const ids = [...new Set(await this.kvDB.get<string[]>(kvDBKey) ?? [])];
        const batchSize = 100;
        const chunkedIds = arrayToChunkedArray(ids, batchSize);
        for await (const idsBatch of chunkedIds) {
            const ret = await this.localDatabase.allDocsRaw<EntryDoc>({ keys: idsBatch, include_docs: true, limit: 100 });
            const docs = ret.rows.filter(e => e.doc).map(e => e.doc) as PouchDB.Core.ExistingDocument<EntryDoc>[];
            const errors = ret.rows.filter(e => !e.doc && !e.value.deleted);
            if (errors.length > 0) {
                Logger("Some queued processes were not resurrected");
                Logger(JSON.stringify(errors), LOG_LEVEL_VERBOSE);
            }
            this.replicationResultProcessor.enqueueAll(docs);
            await this.replicationResultProcessor.waitForAllProcessed();
        }

    }

    databaseQueueCount = reactiveSource(0);
    databaseQueuedProcessor = new QueueProcessor(async (docs: EntryBody[]) => {
        const dbDoc = docs[0] as LoadedEntry; // It has no `data`
        const path = this.getPath(dbDoc);
        // If `Read chunks online` is disabled, chunks should be transferred before here.
        // However, in some cases, chunks are after that. So, if missing chunks exist, we have to wait for them.
        const doc = await this.localDatabase.getDBEntryFromMeta({ ...dbDoc }, {}, false, true, true);
        if (!doc) {
            Logger(`Something went wrong while gathering content of ${path} (${dbDoc._id.substring(0, 8)}, ${dbDoc._rev?.substring(0, 10)}) `, LOG_LEVEL_NOTICE)
            return;
        }
        if (isInternalMetadata(doc._id) && this.settings.syncInternalFiles) {
            //system file
            const filename = this.getPathWithoutPrefix(doc);
            this.isTargetFile(filename).then((ret) => ret ? this.addOnHiddenFileSync.procInternalFile(filename) : Logger(`Skipped (Not target:${filename})`, LOG_LEVEL_VERBOSE));
        } else if (isValidPath(this.getPath(doc))) {
            this.storageApplyingProcessor.enqueue(doc);
        } else {
            Logger(`Skipped: ${doc._id.substring(0, 8)}`, LOG_LEVEL_VERBOSE);
        }
        return;
    }, { suspended: true, batchSize: 1, concurrentLimit: 10, yieldThreshold: 1, delay: 0, totalRemainingReactiveSource: this.databaseQueueCount }).replaceEnqueueProcessor((queue, newItem) => {
        const q = queue.filter(e => e._id != newItem._id);
        return [...q, newItem];
    }).startPipeline();

    storageApplyingCount = reactiveSource(0);
    storageApplyingProcessor = new QueueProcessor(async (docs: LoadedEntry[]) => {
        const entry = docs[0];
        await serialized(entry.path, async () => {
            const path = this.getPath(entry);
            Logger(`Processing ${path} (${entry._id.substring(0, 8)}: ${entry._rev?.substring(0, 5)}) :Started...`, LOG_LEVEL_VERBOSE);
            const targetFile = this.vaultAccess.getAbstractFileByPath(this.getPathWithoutPrefix(entry));
            if (targetFile instanceof TFolder) {
                Logger(`${this.getPath(entry)} is already exist as the folder`);
            } else {
                await this.processEntryDoc(entry, targetFile instanceof TFile ? targetFile : undefined);
                Logger(`Processing ${path} (${entry._id.substring(0, 8)} :${entry._rev?.substring(0, 5)}) : Done`);
            }
        });

        return;
    }, { suspended: true, batchSize: 1, concurrentLimit: 6, yieldThreshold: 1, delay: 0, totalRemainingReactiveSource: this.storageApplyingCount }).replaceEnqueueProcessor((queue, newItem) => {
        const q = queue.filter(e => e._id != newItem._id);
        return [...q, newItem];
    }).startPipeline()


    replicationResultCount = reactiveSource(0);
    replicationResultProcessor = new QueueProcessor(async (docs: PouchDB.Core.ExistingDocument<EntryDoc>[]) => {
        if (this.settings.suspendParseReplicationResult) return;
        const change = docs[0];
        if (!change) return;
        if (isChunk(change._id)) {
            // SendSignal?
            // this.parseIncomingChunk(change);
            sendValue(`leaf-${change._id}`, change);
            return;
        }
        // any addon needs this item?
        for (const proc of this.addOns) {
            if (await proc.parseReplicationResultItem(change)) {
                return;
            }
        }
        if (change.type == "versioninfo") {
            if (change.version > VER) {
                this.replicator.closeReplication();
                Logger(`Remote database updated to incompatible version. update your Self-hosted LiveSync plugin.`, LOG_LEVEL_NOTICE);
            }
            return;
        }
        if (change._id == SYNCINFO_ID || // Synchronisation information data
            change._id.startsWith("_design") //design document
        ) {
            return;
        }
        if (isAnyNote(change)) {
            if (this.databaseQueuedProcessor._isSuspended) {
                Logger(`Processing scheduled: ${change.path}`, LOG_LEVEL_INFO);
            }
            const size = change.size;
            if (this.isFileSizeExceeded(size)) {
                Logger(`Processing ${change.path} has been skipped due to file size exceeding the limit`, LOG_LEVEL_NOTICE);
                return;
            }
            this.databaseQueuedProcessor.enqueue(change);
        }
        return;
    }, { batchSize: 1, suspended: true, concurrentLimit: 100, delay: 0, totalRemainingReactiveSource: this.replicationResultCount }).replaceEnqueueProcessor((queue, newItem) => {
        const q = queue.filter(e => e._id != newItem._id);
        return [...q, newItem];
    }).startPipeline().onUpdateProgress(() => {
        this.saveQueuedFiles();
    });
    //---> Sync
    parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>) {
        if (this.settings.suspendParseReplicationResult && !this.replicationResultProcessor.isSuspended) {
            this.replicationResultProcessor.suspend()
        }
        this.replicationResultProcessor.enqueueAll(docs);
        if (!this.settings.suspendParseReplicationResult && this.replicationResultProcessor.isSuspended) {
            this.replicationResultProcessor.resume()
        }
    }


    async realizeSettingSyncMode() {
        this.replicator.closeReplication();
        this.periodicSyncProcessor?.disable();
        this.localDatabase.refreshSettings();
        await this.applyBatchChange();
        await Promise.all(this.addOns.map(e => e.realizeSettingSyncMode()));
        // disable all sync temporary.
        if (this.suspended) return;
        await Promise.all(this.addOns.map(e => e.onResume()));
        if (this.settings.remoteType == REMOTE_COUCHDB) {
            if (this.settings.liveSync) {
                this.replicator.openReplication(this.settings, true, false, false);
            }
        }

        const q = activeDocument.querySelector(`.livesync-ribbon-showcustom`);
        q?.toggleClass("sls-hidden", !this.settings.usePluginSync);

        this.periodicSyncProcessor.enable(this.settings.periodicReplication ? this.settings.periodicReplicationInterval * 1000 : 0);


    }

    lastMessage = "";

    observeForLogs() {
        const padSpaces = `\u{2007}`.repeat(10);
        // const emptyMark = `\u{2003}`;
        function padLeftSpComputed(numI: ReactiveValue<number>, mark: string) {
            const formatted = reactiveSource("");
            let timer: ReturnType<typeof setTimeout> | undefined = undefined;
            let maxLen = 1;
            numI.onChanged(numX => {
                const num = numX.value;
                const numLen = `${Math.abs(num)}`.length + 1;
                maxLen = maxLen < numLen ? numLen : maxLen;
                if (timer) clearTimeout(timer);
                if (num == 0) {
                    timer = setTimeout(() => {
                        formatted.value = "";
                        maxLen = 1;
                    }, 3000);
                }
                formatted.value = ` ${mark}${`${padSpaces}${num}`.slice(-(maxLen))}`;
            })
            return computed(() => formatted.value);
        }
        const labelReplication = padLeftSpComputed(this.replicationResultCount, `📥`);
        const labelDBCount = padLeftSpComputed(this.databaseQueueCount, `📄`);
        const labelStorageCount = padLeftSpComputed(this.storageApplyingCount, `💾`);
        const labelChunkCount = padLeftSpComputed(collectingChunks, `🧩`);
        const labelPluginScanCount = padLeftSpComputed(pluginScanningCount, `🔌`);
        const labelConflictProcessCount = padLeftSpComputed(this.conflictProcessQueueCount, `🔩`);
        const hiddenFilesCount = reactive(() => hiddenFilesEventCount.value + hiddenFilesProcessingCount.value);
        const labelHiddenFilesCount = padLeftSpComputed(hiddenFilesCount, `⚙️`)
        const queueCountLabelX = reactive(() => {
            return `${labelReplication()}${labelDBCount()}${labelStorageCount()}${labelChunkCount()}${labelPluginScanCount()}${labelHiddenFilesCount()}${labelConflictProcessCount()}`;
        })
        const queueCountLabel = () => queueCountLabelX.value;

        const requestingStatLabel = computed(() => {
            const diff = this.requestCount.value - this.responseCount.value;
            return diff != 0 ? "📲 " : "";
        })

        const replicationStatLabel = computed(() => {
            const e = this.replicationStat.value;
            const sent = e.sent;
            const arrived = e.arrived;
            const maxPullSeq = e.maxPullSeq;
            const maxPushSeq = e.maxPushSeq;
            const lastSyncPullSeq = e.lastSyncPullSeq;
            const lastSyncPushSeq = e.lastSyncPushSeq;
            let pushLast = "";
            let pullLast = "";
            let w = "";
            const labels: Partial<Record<DatabaseConnectingStatus, string>> = {
                "CONNECTED": "⚡",
                "JOURNAL_SEND": "📦↑",
                "JOURNAL_RECEIVE": "📦↓",
            }
            switch (e.syncStatus) {
                case "CLOSED":
                case "COMPLETED":
                case "NOT_CONNECTED":
                    w = "⏹";
                    break;
                case "STARTED":
                    w = "🌀";
                    break;
                case "PAUSED":
                    w = "💤";
                    break;
                case "CONNECTED":
                case "JOURNAL_SEND":
                case "JOURNAL_RECEIVE":
                    w = labels[e.syncStatus] || "⚡";
                    pushLast = ((lastSyncPushSeq == 0) ? "" : (lastSyncPushSeq >= maxPushSeq ? " (LIVE)" : ` (${maxPushSeq - lastSyncPushSeq})`));
                    pullLast = ((lastSyncPullSeq == 0) ? "" : (lastSyncPullSeq >= maxPullSeq ? " (LIVE)" : ` (${maxPullSeq - lastSyncPullSeq})`));
                    break;
                case "ERRORED":
                    w = "⚠";
                    break;
                default:
                    w = "?";
            }
            return { w, sent, pushLast, arrived, pullLast };
        })
        const labelProc = padLeftSpComputed(this.vaultManager.processing, `⏳`);
        const labelPend = padLeftSpComputed(this.vaultManager.totalQueued, `🛫`);
        const labelInBatchDelay = padLeftSpComputed(this.vaultManager.batched, `📬`);
        const waitingLabel = computed(() => {
            return `${labelProc()}${labelPend()}${labelInBatchDelay()}`;
        })
        const statusLineLabel = computed(() => {
            const { w, sent, pushLast, arrived, pullLast } = replicationStatLabel();
            const queued = queueCountLabel();
            const waiting = waitingLabel();
            const networkActivity = requestingStatLabel();
            return {
                message: `${networkActivity}Sync: ${w} ↑ ${sent}${pushLast} ↓ ${arrived}${pullLast}${waiting}${queued}`,
            };
        })
        const statusBarLabels = reactive(() => {
            const scheduleMessage = this.isReloadingScheduled ? `WARNING! RESTARTING OBSIDIAN IS SCHEDULED!\n` : "";
            const { message } = statusLineLabel();
            const status = scheduleMessage + this.statusLog.value;
            return {
                message, status
            }
        })

        const applyToDisplay = throttle((label: typeof statusBarLabels.value) => {
            const v = label;
            this.applyStatusBarText(v.message, v.status);

        }, 20);
        statusBarLabels.onChanged(label => applyToDisplay(label.value))
    }

    applyStatusBarText(message: string, log: string) {
        const newMsg = message.replace(/\n/g, "\\A ");
        const newLog = log.replace(/\n/g, "\\A ");

        this.statusBar?.setText(newMsg.split("\n")[0]);
        if (this.settings.showStatusOnEditor) {
            const root = activeDocument.documentElement;
            root.style.setProperty("--sls-log-text", "'" + (newMsg + "\\A " + newLog) + "'");
        } else {
            // const root = activeDocument.documentElement;
            // root.style.setProperty("--log-text", "'" + (newMsg + "\\A " + newLog) + "'");
        }

        scheduleTask("log-hide", 3000, () => { this.statusLog.value = "" });
    }
    async askResolvingMismatchedTweaks(): Promise<"OK" | "CHECKAGAIN" | "IGNORE"> {
        if (!this.replicator.tweakSettingsMismatched) {
            return "OK";
        }
        const preferred = extractObject(TweakValuesShouldMatchedTemplate, this.replicator.preferredTweakValue!);
        const mine = extractObject(TweakValuesShouldMatchedTemplate, this.settings);
        const items = Object.entries(TweakValuesShouldMatchedTemplate);
        // Making tables:
        let table = `| Value name | This device | Configured | \n` +
            `|: --- |: --- :|: ---- :| \n`;

        // const items = [mine,preferred]
        for (const v of items) {
            const key = v[0] as keyof typeof TweakValuesShouldMatchedTemplate;
            const valueMine = escapeMarkdownValue(mine[key]);
            const valuePreferred = escapeMarkdownValue(preferred[key]);
            if (valueMine == valuePreferred) continue;
            table += `| ${confName(key)} | ${valueMine} | ${valuePreferred} | \n`;
        }

        const message = `
Your configuration has not been matched with the one on the remote server.
(Which you had decided once before, or set by initially synchronised device).

Configured values:

${table}

Please select which one you want to use.

- Use configured: Update settings of this device by configured one on the remote server.
  You should select this if you have changed the settings on **another device**.
- Update with mine: Update settings on the remote server by the settings of this device.
  You should select this if you have changed the settings on **this device**.
- Dismiss: Ignore this message and keep the current settings.
  You cannot synchronise until you resolve this issue without enabling \`Do not check configuration mismatch before replication\`.`;

        const CHOICE_USE_REMOTE = "Use configured";
        const CHOICE_USR_MINE = "Update with mine";
        const CHOICE_DISMISS = "Dismiss";
        const CHOICE_AND_VALUES = [
            [CHOICE_USE_REMOTE, preferred],
            [CHOICE_USR_MINE, true],
            [CHOICE_DISMISS, false]
        ]
        const CHOICES = Object.fromEntries(CHOICE_AND_VALUES) as Record<string, TweakValues | boolean>;
        const retKey = await confirmWithMessage(this, "Tweaks Mismatched or Changed", message, Object.keys(CHOICES), CHOICE_DISMISS, 60);
        if (!retKey) return "IGNORE";
        const conf = CHOICES[retKey];

        if (conf === true) {
            await this.replicator.setPreferredRemoteTweakSettings(this.settings);
            Logger(`Tweak values on the remote server have been updated. Your other device will see this message.`, LOG_LEVEL_NOTICE);
            return "CHECKAGAIN";
        }
        if (conf) {
            this.settings = { ...this.settings, ...conf };
            await this.replicator.setPreferredRemoteTweakSettings(this.settings);
            await this.saveSettingData();
            Logger(`Configuration has been updated as configured by the other device.`, LOG_LEVEL_NOTICE);
            return "CHECKAGAIN";
        }
        return "IGNORE";

    }
    async replicate(showMessage: boolean = false) {
        if (!this.isReady) return;
        if (isLockAcquired("cleanup")) {
            Logger("Database cleaning up is in process. replication has been cancelled", LOG_LEVEL_NOTICE);
            return;
        }
        if (this.settings.versionUpFlash != "") {
            Logger("Open settings and check message, please. replication has been cancelled.", LOG_LEVEL_NOTICE);
            return;
        }
        await this.applyBatchChange();
        await Promise.all(this.addOns.map(e => e.beforeReplicate(showMessage)));
        await this.loadQueuedFiles();
        const ret = await this.replicator.openReplication(this.settings, false, showMessage, false);
        if (!ret) {
            if (this.replicator.tweakSettingsMismatched) {
                await this.askResolvingMismatchedTweaks();

            } else {
                if (this.replicator?.remoteLockedAndDeviceNotAccepted) {
                    if (this.replicator.remoteCleaned && this.settings.useIndexedDBAdapter) {
                        Logger(`The remote database has been cleaned.`, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
                        await skipIfDuplicated("cleanup", async () => {
                            const count = await purgeUnreferencedChunks(this.localDatabase.localDatabase, true);
                            const message = `The remote database has been cleaned up.
To synchronize, this device must be also cleaned up. ${count} chunk(s) will be erased from this device.
However, If there are many chunks to be deleted, maybe fetching again is faster.
We will lose the history of this device if we fetch the remote database again.
Even if you choose to clean up, you will see this option again if you exit Obsidian and then synchronise again.`
                            const CHOICE_FETCH = "Fetch again";
                            const CHOICE_CLEAN = "Cleanup";
                            const CHOICE_DISMISS = "Dismiss";
                            const ret = await confirmWithMessage(this, "Cleaned", message, [CHOICE_FETCH, CHOICE_CLEAN, CHOICE_DISMISS], CHOICE_DISMISS, 30);
                            if (ret == CHOICE_FETCH) {
                                await performRebuildDB(this, "localOnly");
                            }
                            if (ret == CHOICE_CLEAN) {
                                const replicator = this.getReplicator();
                                if (!(replicator instanceof LiveSyncCouchDBReplicator)) return;
                                const remoteDB = await replicator.connectRemoteCouchDBWithSetting(this.settings, this.getIsMobile(), true);
                                if (typeof remoteDB == "string") {
                                    Logger(remoteDB, LOG_LEVEL_NOTICE);
                                    return false;
                                }

                                await purgeUnreferencedChunks(this.localDatabase.localDatabase, false);
                                this.localDatabase.hashCaches.clear();
                                // Perform the synchronisation once.
                                if (await this.replicator.openReplication(this.settings, false, showMessage, true)) {
                                    await balanceChunkPurgedDBs(this.localDatabase.localDatabase, remoteDB.db);
                                    await purgeUnreferencedChunks(this.localDatabase.localDatabase, false);
                                    this.localDatabase.hashCaches.clear();
                                    await this.getReplicator().markRemoteResolved(this.settings);
                                    Logger("The local database has been cleaned up.", showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO)
                                } else {
                                    Logger("Replication has been cancelled. Please try it again.", showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO)
                                }

                            }
                        });
                    } else {
                        const message = `
The remote database has been rebuilt.
To synchronize, this device must fetch everything again once.
Or if you are sure know what had been happened, we can unlock the database from the setting dialog.
                    `
                        const CHOICE_FETCH = "Fetch again";
                        const CHOICE_DISMISS = "Dismiss";
                        const ret = await confirmWithMessage(this, "Locked", message, [CHOICE_FETCH, CHOICE_DISMISS], CHOICE_DISMISS, 10);
                        if (ret == CHOICE_FETCH) {
                            await performRebuildDB(this, "localOnly");
                        }
                    }
                }
            }
        }

        return ret;
    }

    async initializeDatabase(showingNotice: boolean = false, reopenDatabase = true) {
        this.isReady = false;
        if ((!reopenDatabase) || await this.openDatabase()) {
            if (this.localDatabase.isReady) {
                await this.syncAllFiles(showingNotice);
            }

            await Promise.all(this.addOns.map(e => e.onInitializeDatabase(showingNotice)));
            this.isReady = true;
            // run queued event once.
            await this.flushFileEventQueue();
            return true;
        } else {
            this.isReady = false;
            return false;
        }
    }

    async replicateAllToServer(showingNotice: boolean = false): Promise<boolean> {
        if (!this.isReady) return false;
        await Promise.all(this.addOns.map(e => e.beforeReplicate(showingNotice)));
        const ret = await this.replicator.replicateAllToServer(this.settings, showingNotice);
        if (ret) return true;
        if (this.replicator.tweakSettingsMismatched) {
            const ret = await this.askResolvingMismatchedTweaks();
            if (ret == "OK") return true;
            if (ret == "CHECKAGAIN") return await this.replicateAllToServer(showingNotice);
            if (ret == "IGNORE") return false;
        }
        return ret;
    }
    async replicateAllFromServer(showingNotice: boolean = false): Promise<boolean> {
        if (!this.isReady) return false;
        const ret = await this.replicator.replicateAllFromServer(this.settings, showingNotice);
        if (ret) return true;
        if (this.replicator.tweakSettingsMismatched) {
            const ret = await this.askResolvingMismatchedTweaks();
            if (ret == "OK") return true;
            if (ret == "CHECKAGAIN") return await this.replicateAllFromServer(showingNotice);
            if (ret == "IGNORE") return false;
        }
        return ret;
    }

    async markRemoteLocked(lockByClean: boolean = false) {
        return await this.replicator.markRemoteLocked(this.settings, true, lockByClean);
    }

    async markRemoteUnlocked() {
        return await this.replicator.markRemoteLocked(this.settings, false, false);
    }

    async markRemoteResolved() {
        return await this.replicator.markRemoteResolved(this.settings);
    }

    isFileSizeExceeded(size: number) {
        if (this.settings.syncMaxSizeInMB > 0 && size > 0) {
            if (this.settings.syncMaxSizeInMB * 1024 * 1024 < size) {
                return true;
            }
        }
        return false;
    }

    async syncAllFiles(showingNotice?: boolean) {
        // synchronize all files between database and storage.
        if (!this.settings.isConfigured) {
            if (showingNotice) {
                Logger("LiveSync is not configured yet. Synchronising between the storage and the local database is now prevented.", LOG_LEVEL_NOTICE, "syncAll");
            }
            return;
        }
        if (showingNotice) {
            Logger("Initializing", LOG_LEVEL_NOTICE, "syncAll");
        }

        Logger("Initialize and checking database files");
        Logger("Checking deleted files");
        await this.collectDeletedFiles();

        Logger("Collecting local files on the storage", LOG_LEVEL_VERBOSE);
        const filesStorageSrc = this.vaultAccess.getFiles();

        const filesStorage = [] as typeof filesStorageSrc;
        for (const f of filesStorageSrc) {
            if (await this.isTargetFile(f.path)) {
                filesStorage.push(f);
            }
        }

        const filesStorageName = filesStorage.map((e) => e.path);
        Logger("Collecting local files on the DB", LOG_LEVEL_VERBOSE);
        const filesDatabase = [] as FilePathWithPrefix[]
        let count = 0;
        for await (const doc of this.localDatabase.findAllNormalDocs()) {
            count++;
            if (count % 25 == 0) Logger(`Collecting local files on the DB: ${count}`, showingNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO, "syncAll");
            const path = getPath(doc);
            // const docPath = doc.path;
            // if (path != docPath) {
            //     debugger;
            // }
            if (isValidPath(path) && await this.isTargetFile(path)) {
                filesDatabase.push(path);
            }
        }
        Logger("Opening the key-value database", LOG_LEVEL_VERBOSE);
        const isInitialized = await (this.kvDB.get<boolean>("initialized")) || false;

        const onlyInStorage = filesStorage.filter((e) => filesDatabase.indexOf(getPathFromTFile(e)) == -1);
        const onlyInDatabase = filesDatabase.filter((e) => filesStorageName.indexOf(e) == -1);

        const onlyInStorageNames = onlyInStorage.map((e) => e.path);

        const syncFiles = filesStorage.filter((e) => onlyInStorageNames.indexOf(e.path) == -1);
        Logger("Updating database by new files");
        const processStatus = {} as Record<string, string>;
        const logLevel = showingNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
        const updateLog = throttle((key: string, msg: string) => {
            processStatus[key] = msg;
            const log = Object.values(processStatus).join("\n");
            Logger(log, logLevel, "syncAll");
        }, 25);

        const initProcess = [];
        const runAll = async<T>(procedureName: string, objects: T[], callback: (arg: T) => Promise<void>) => {
            if (objects.length == 0) {
                Logger(`${procedureName}: Nothing to do`);
                return;
            }
            Logger(procedureName);
            if (!this.localDatabase.isReady) throw Error("Database is not ready!");
            let success = 0;
            let failed = 0;
            const step = 10;
            const processor = new QueueProcessor(async (e) => {
                try {
                    await callback(e[0]);
                    success++;
                    // return 
                } catch (ex) {
                    Logger(`Error while ${procedureName}`, LOG_LEVEL_NOTICE);
                    Logger(ex, LOG_LEVEL_VERBOSE);
                    failed++;
                }
                if ((success + failed) % step == 0) {
                    const msg = `${procedureName}: DONE:${success}, FAILED:${failed}, LAST:${processor._queue.length}`;
                    updateLog(procedureName, msg);
                }
                return;
            }, { batchSize: 1, concurrentLimit: 10, delay: 0, suspended: true }, objects)
            await processor.waitForAllDoneAndTerminate();
            const msg = `${procedureName} All done: DONE:${success}, FAILED:${failed}`;
            updateLog(procedureName, msg)
        }
        initProcess.push(runAll("UPDATE DATABASE", onlyInStorage, async (e) => {
            if (!this.isFileSizeExceeded(e.stat.size)) {
                await this.updateIntoDB(e);
                fireAndForget(() => this.checkAndApplySettingFromMarkdown(e.path, true));
            } else {
                Logger(`UPDATE DATABASE: ${e.path} has been skipped due to file size exceeding the limit`, logLevel);
            }
        }));
        initProcess.push(runAll("UPDATE STORAGE", onlyInDatabase, async (e) => {
            const w = await this.localDatabase.getDBEntryMeta(e, {}, true);
            if (w && !(w.deleted || w._deleted)) {
                if (!this.isFileSizeExceeded(w.size)) {
                    await this.pullFile(e, filesStorage, false, undefined, false);
                    fireAndForget(() => this.checkAndApplySettingFromMarkdown(e, true));
                    Logger(`Check or pull from db:${e} OK`);
                } else {
                    Logger(`UPDATE STORAGE: ${e} has been skipped due to file size exceeding the limit`, logLevel);
                }
            } else if (w) {
                Logger(`Deletion history skipped: ${e}`, LOG_LEVEL_VERBOSE);
            } else {
                Logger(`entry not found: ${e}`);
            }
        }));
        type FileDocPair = { file: TFile, id: DocumentID };

        const processPrepareSyncFile = new QueueProcessor(
            async (files) => {
                const file = files[0];
                const id = await this.path2id(getPathFromTFile(file));
                const pair: FileDocPair = { file, id };
                return [pair];
            }
            , { batchSize: 1, concurrentLimit: 10, delay: 0, suspended: true }, syncFiles);
        processPrepareSyncFile
            .pipeTo(
                new QueueProcessor(
                    async (pairs) => {
                        const docs = await this.localDatabase.allDocsRaw<EntryDoc>({ keys: pairs.map(e => e.id), include_docs: true });
                        const docsMap = Object.fromEntries(docs.rows.map(e => [e.id, e.doc]));
                        const syncFilesToSync = pairs.map((e) => ({ file: e.file, doc: docsMap[e.id] as LoadedEntry }));
                        return syncFilesToSync;
                    }
                    , { batchSize: 100, concurrentLimit: 1, delay: 10, suspended: false, maintainDelay: true, yieldThreshold: 100 }))
            .pipeTo(
                new QueueProcessor(
                    async (loadedPairs) => {
                        for (const pair of loadedPairs)
                            try {
                                const e = pair;
                                await this.syncFileBetweenDBandStorage(e.file, e.doc);
                            } catch (ex) {
                                Logger("Error while syncFileBetweenDBandStorage", LOG_LEVEL_NOTICE);
                                Logger(ex, LOG_LEVEL_VERBOSE);
                            }
                        return;
                    }, { batchSize: 5, concurrentLimit: 10, delay: 10, suspended: false, yieldThreshold: 10, maintainDelay: true }
                ))

        const allSyncFiles = syncFiles.length;
        let lastRemain = allSyncFiles;
        const step = 25;
        const remainLog = (remain: number) => {
            if (lastRemain - remain > step) {
                const msg = ` CHECK AND SYNC: ${allSyncFiles - remain} / ${allSyncFiles}`;
                updateLog("sync", msg);
                lastRemain = remain;
            }
        }
        processPrepareSyncFile.startPipeline().onUpdateProgress(() => remainLog(processPrepareSyncFile.totalRemaining + processPrepareSyncFile.nowProcessing))
        initProcess.push(processPrepareSyncFile.waitForAllDoneAndTerminate());
        await Promise.all(initProcess);

        // this.setStatusBarText(`NOW TRACKING!`);
        Logger("Initialized, NOW TRACKING!");
        if (!isInitialized) {
            await (this.kvDB.set("initialized", true))
        }
        if (showingNotice) {
            Logger("Initialize done!", LOG_LEVEL_NOTICE, "syncAll");
        }
    }

    // --> conflict resolving
    async getConflictedDoc(path: FilePathWithPrefix, rev: string): Promise<false | diff_result_leaf> {
        try {
            const doc = await this.localDatabase.getDBEntry(path, { rev: rev }, false, false, true);
            if (doc === false) return false;
            let data = getDocData(doc.data)
            if (doc.datatype == "newnote") {
                data = readString(new Uint8Array(decodeBinary(doc.data)));
            } else if (doc.datatype == "plain") {
                // NO OP.
            }
            return {
                deleted: doc.deleted || doc._deleted,
                ctime: doc.ctime,
                mtime: doc.mtime,
                rev: rev,
                data: data
            };
        } catch (ex) {
            if (isErrorOfMissingDoc(ex)) {
                return false;
            }
        }
        return false;
    }
    //TODO: TIDY UP
    async mergeSensibly(path: FilePathWithPrefix, baseRev: string, currentRev: string, conflictedRev: string): Promise<Diff[] | false> {
        const baseLeaf = await this.getConflictedDoc(path, baseRev);
        const leftLeaf = await this.getConflictedDoc(path, currentRev);
        const rightLeaf = await this.getConflictedDoc(path, conflictedRev);
        let autoMerge = false;
        if (baseLeaf == false || leftLeaf == false || rightLeaf == false) {
            return false;
        }
        if (leftLeaf.deleted && rightLeaf.deleted) {
            // Both are deleted
            return false;
        }
        // diff between base and each revision
        const dmp = new diff_match_patch();
        const mapLeft = dmp.diff_linesToChars_(baseLeaf.data, leftLeaf.data);
        const diffLeftSrc = dmp.diff_main(mapLeft.chars1, mapLeft.chars2, false);
        dmp.diff_charsToLines_(diffLeftSrc, mapLeft.lineArray);
        const mapRight = dmp.diff_linesToChars_(baseLeaf.data, rightLeaf.data);
        const diffRightSrc = dmp.diff_main(mapRight.chars1, mapRight.chars2, false);
        dmp.diff_charsToLines_(diffRightSrc, mapRight.lineArray);
        function splitDiffPiece(src: Diff[]): Diff[] {
            const ret = [] as Diff[];
            do {
                const d = src.shift();
                if (d === undefined) {
                    return ret;
                }
                const pieces = d[1].split(/([^\n]*\n)/).filter(f => f != "");
                if (typeof (d) == "undefined") {
                    break;
                }
                if (d[0] != DIFF_DELETE) {
                    ret.push(...(pieces.map(e => [d[0], e] as Diff)));
                }
                if (d[0] == DIFF_DELETE) {
                    const nd = src.shift();

                    if (typeof (nd) != "undefined") {
                        const piecesPair = nd[1].split(/([^\n]*\n)/).filter(f => f != "");
                        if (nd[0] == DIFF_INSERT) {
                            // it might be pair
                            for (const pt of pieces) {
                                ret.push([d[0], pt]);
                                const pairP = piecesPair.shift();
                                if (typeof (pairP) != "undefined") ret.push([DIFF_INSERT, pairP]);
                            }
                            ret.push(...(piecesPair.map(e => [nd[0], e] as Diff)));
                        } else {
                            ret.push(...(pieces.map(e => [d[0], e] as Diff)));
                            ret.push(...(piecesPair.map(e => [nd[0], e] as Diff)));

                        }
                    } else {
                        ret.push(...(pieces.map(e => [0, e] as Diff)));
                    }
                }
            } while (src.length > 0);
            return ret;
        }

        const diffLeft = splitDiffPiece(diffLeftSrc);
        const diffRight = splitDiffPiece(diffRightSrc);

        let rightIdx = 0;
        let leftIdx = 0;
        const merged = [] as Diff[];
        autoMerge = true;
        LOOP_MERGE:
        do {
            if (leftIdx >= diffLeft.length && rightIdx >= diffRight.length) {
                break LOOP_MERGE;
            }
            const leftItem = diffLeft[leftIdx] ?? [0, ""];
            const rightItem = diffRight[rightIdx] ?? [0, ""];
            leftIdx++;
            rightIdx++;
            // when completely same, leave it .
            if (leftItem[0] == DIFF_EQUAL && rightItem[0] == DIFF_EQUAL && leftItem[1] == rightItem[1]) {
                merged.push(leftItem);
                continue;
            }
            if (leftItem[0] == DIFF_DELETE && rightItem[0] == DIFF_DELETE && leftItem[1] == rightItem[1]) {
                // when deleted evenly,
                const nextLeftIdx = leftIdx;
                const nextRightIdx = rightIdx;
                const [nextLeftItem, nextRightItem] = [diffLeft[nextLeftIdx] ?? [0, ""], diffRight[nextRightIdx] ?? [0, ""]];
                if ((nextLeftItem[0] == DIFF_INSERT && nextRightItem[0] == DIFF_INSERT) && nextLeftItem[1] != nextRightItem[1]) {
                    //but next line looks like different
                    autoMerge = false;
                    break;
                } else {
                    merged.push(leftItem);
                    continue;
                }
            }
            // when inserted evenly
            if (leftItem[0] == DIFF_INSERT && rightItem[0] == DIFF_INSERT) {
                if (leftItem[1] == rightItem[1]) {
                    merged.push(leftItem);
                    continue;
                } else {
                    // sort by file date.
                    if (leftLeaf.mtime <= rightLeaf.mtime) {
                        merged.push(leftItem);
                        merged.push(rightItem);
                        continue;
                    } else {
                        merged.push(rightItem);
                        merged.push(leftItem);
                        continue;
                    }
                }

            }
            // when on inserting, index should be fixed again.
            if (leftItem[0] == DIFF_INSERT) {
                rightIdx--;
                merged.push(leftItem);
                continue;
            }
            if (rightItem[0] == DIFF_INSERT) {
                leftIdx--;
                merged.push(rightItem);
                continue;
            }
            // except insertion, the line should not be different.
            if (rightItem[1] != leftItem[1]) {
                //TODO: SHOULD BE PANIC.
                Logger(`MERGING PANIC:${leftItem[0]},${leftItem[1]} == ${rightItem[0]},${rightItem[1]}`, LOG_LEVEL_VERBOSE);
                autoMerge = false;
                break LOOP_MERGE;
            }
            if (leftItem[0] == DIFF_DELETE) {
                if (rightItem[0] == DIFF_EQUAL) {
                    merged.push(leftItem);
                    continue;
                } else {
                    //we cannot perform auto merge.
                    autoMerge = false;
                    break LOOP_MERGE;
                }
            }
            if (rightItem[0] == DIFF_DELETE) {
                if (leftItem[0] == DIFF_EQUAL) {
                    merged.push(rightItem);
                    continue;
                } else {
                    //we cannot perform auto merge.
                    autoMerge = false;
                    break LOOP_MERGE;
                }
            }
            Logger(`Weird condition:${leftItem[0]},${leftItem[1]} == ${rightItem[0]},${rightItem[1]}`, LOG_LEVEL_VERBOSE);
            // here is the exception
            break LOOP_MERGE;
        } while (leftIdx < diffLeft.length || rightIdx < diffRight.length);
        if (autoMerge) {
            Logger(`Sensibly merge available`, LOG_LEVEL_VERBOSE);
            return merged;
        } else {
            return false;
        }
    }

    async mergeObject(path: FilePathWithPrefix, baseRev: string, currentRev: string, conflictedRev: string): Promise<string | false> {
        try {
            const baseLeaf = await this.getConflictedDoc(path, baseRev);
            const leftLeaf = await this.getConflictedDoc(path, currentRev);
            const rightLeaf = await this.getConflictedDoc(path, conflictedRev);
            if (baseLeaf == false || leftLeaf == false || rightLeaf == false) {
                return false;
            }
            if (leftLeaf.deleted && rightLeaf.deleted) {
                return false;
            }
            const baseObj = { data: tryParseJSON(baseLeaf.data, {}) } as Record<string | number | symbol, any>;
            const leftObj = { data: tryParseJSON(leftLeaf.data, {}) } as Record<string | number | symbol, any>;
            const rightObj = { data: tryParseJSON(rightLeaf.data, {}) } as Record<string | number | symbol, any>;

            const diffLeft = generatePatchObj(baseObj, leftObj);
            const diffRight = generatePatchObj(baseObj, rightObj);

            // If each value of the same key has been modified, the automatic merge should be prevented.
            //TODO Does it have to be a configurable item?
            const diffSetLeft = new Map(flattenObject(diffLeft));
            const diffSetRight = new Map(flattenObject(diffRight));
            for (const [key, value] of diffSetLeft) {
                if (diffSetRight.has(key)) {
                    if (diffSetRight.get(key) == value) {
                        // No matter, if changed to the same value.
                        diffSetRight.delete(key);
                    }
                }
            }
            for (const [key, value] of diffSetRight) {
                if (diffSetLeft.has(key) && diffSetLeft.get(key) != value) {
                    // Some changes are conflicted
                    return false;
                }
            }

            const patches = [
                { mtime: leftLeaf.mtime, patch: diffLeft },
                { mtime: rightLeaf.mtime, patch: diffRight }
            ].sort((a, b) => a.mtime - b.mtime);
            let newObj = { ...baseObj };
            for (const patch of patches) {
                newObj = applyPatch(newObj, patch.patch);
            }
            return JSON.stringify(newObj.data);
        } catch (ex) {
            Logger("Could not merge object");
            Logger(ex, LOG_LEVEL_VERBOSE)
            return false;
        }
    }

    /**
     * Getting file conflicted status.
     * @param path the file location
     * @returns true -> resolved, false -> nothing to do, or check result.
     */
    async checkConflictAndPerformAutoMerge(path: FilePathWithPrefix): Promise<diff_check_result> {
        const test = await this.localDatabase.getDBEntry(path, { conflicts: true, revs_info: true }, false, false, true);
        if (test === false) return MISSING_OR_ERROR;
        if (test == null) return MISSING_OR_ERROR;
        if (!test._conflicts) return NOT_CONFLICTED;
        if (test._conflicts.length == 0) return NOT_CONFLICTED;
        const conflicts = test._conflicts.sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
        if ((isSensibleMargeApplicable(path) || isObjectMargeApplicable(path)) && !this.settings.disableMarkdownAutoMerge) {
            const conflictedRev = conflicts[0];
            const conflictedRevNo = Number(conflictedRev.split("-")[0]);
            //Search 
            const revFrom = (await this.localDatabase.getRaw<EntryDoc>(await this.path2id(path), { revs_info: true }));
            const commonBase = (revFrom._revs_info || []).filter(e => e.status == "available" && Number(e.rev.split("-")[0]) < conflictedRevNo).first()?.rev ?? "";
            let p = undefined;
            if (commonBase) {
                if (isSensibleMargeApplicable(path)) {
                    const result = await this.mergeSensibly(path, commonBase, test._rev!, conflictedRev);
                    if (result) {
                        p = result.filter(e => e[0] != DIFF_DELETE).map((e) => e[1]).join("");
                        // can be merged.
                        Logger(`Sensible merge:${path}`, LOG_LEVEL_INFO);
                    } else {
                        Logger(`Sensible merge is not applicable.`, LOG_LEVEL_VERBOSE);
                    }
                } else if (isObjectMargeApplicable(path)) {
                    // can be merged.
                    const result = await this.mergeObject(path, commonBase, test._rev!, conflictedRev);
                    if (result) {
                        Logger(`Object merge:${path}`, LOG_LEVEL_INFO);
                        p = result;
                    } else {
                        Logger(`Object merge is not applicable.`, LOG_LEVEL_VERBOSE);
                    }
                }

                if (p != undefined) {
                    // remove conflicted revision.
                    await this.localDatabase.deleteDBEntry(path, { rev: conflictedRev });
                    const file = this.vaultAccess.getAbstractFileByPath(stripAllPrefixes(path)) as TFile;
                    if (file) {
                        if (await this.vaultAccess.vaultModify(file, p)) {
                            await this.updateIntoDB(file);
                        }
                    } else {
                        const newFile = await this.vaultAccess.vaultCreate(path, p);
                        await this.updateIntoDB(newFile);
                    }
                    // ?
                    await this.pullFile(path);
                    Logger(`Automatically merged (sensible) :${path}`, LOG_LEVEL_INFO);
                    return AUTO_MERGED;
                }
            }
        }
        // should be one or more conflicts;
        const leftLeaf = await this.getConflictedDoc(path, test._rev!);
        const rightLeaf = await this.getConflictedDoc(path, conflicts[0]);
        if (leftLeaf == false) {
            // what's going on..
            Logger(`could not get current revisions:${path}`, LOG_LEVEL_NOTICE);
            return MISSING_OR_ERROR;
        }
        if (rightLeaf == false) {
            // Conflicted item could not load, delete this.
            await this.localDatabase.deleteDBEntry(path, { rev: conflicts[0] });
            await this.pullFile(path, undefined, true);
            Logger(`could not get old revisions, automatically used newer one:${path}`, LOG_LEVEL_NOTICE);
            return AUTO_MERGED;
        }

        const isSame = leftLeaf.data == rightLeaf.data && leftLeaf.deleted == rightLeaf.deleted;
        const isBinary = !isPlainText(path);
        const alwaysNewer = this.settings.resolveConflictsByNewerFile;
        if (isSame || isBinary || alwaysNewer) {
            const result = compareMTime(leftLeaf.mtime, rightLeaf.mtime)
            let loser = leftLeaf;
            // if (lMtime > rMtime) {
            if (result != TARGET_IS_NEW) {
                loser = rightLeaf;
            }
            await this.localDatabase.deleteDBEntry(path, { rev: loser.rev });
            await this.pullFile(path, undefined, true);
            Logger(`Automatically merged (${isSame ? "same," : ""}${isBinary ? "binary," : ""}${alwaysNewer ? "alwaysNewer" : ""}) :${path}`, LOG_LEVEL_NOTICE);
            return AUTO_MERGED;
        }
        // make diff.
        const dmp = new diff_match_patch();
        const diff = dmp.diff_main(leftLeaf.data, rightLeaf.data);
        dmp.diff_cleanupSemantic(diff);
        Logger(`conflict(s) found:${path}`);
        return {
            left: leftLeaf,
            right: rightLeaf,
            diff: diff,
        };
    }

    conflictProcessQueueCount = reactiveSource(0);
    conflictResolveQueue =
        new QueueProcessor(async (filenames: FilePathWithPrefix[]) => {
            const filename = filenames[0];
            await serialized(`conflict-resolve:${filename}`, async () => {
                const conflictCheckResult = await this.checkConflictAndPerformAutoMerge(filename);
                if (conflictCheckResult === MISSING_OR_ERROR || conflictCheckResult === NOT_CONFLICTED || conflictCheckResult === CANCELLED) {
                    // nothing to do.
                    return;
                }
                if (conflictCheckResult === AUTO_MERGED) {
                    //auto resolved, but need check again;
                    if (this.settings.syncAfterMerge && !this.suspended) {
                        //Wait for the running replication, if not running replication, run it once.
                        await shareRunningResult(`replication`, () => this.replicate());
                    }
                    Logger("conflict:Automatically merged, but we have to check it again");
                    this.conflictCheckQueue.enqueue(filename);
                    return;
                }
                if (this.settings.showMergeDialogOnlyOnActive) {
                    const af = this.getActiveFile();
                    if (af && af.path != filename) {
                        Logger(`${filename} is conflicted. Merging process has been postponed to the file have got opened.`, LOG_LEVEL_NOTICE);
                        return;
                    }
                }
                Logger("conflict:Manual merge required!");
                await this.resolveConflictByUI(filename, conflictCheckResult);
            });
        }, { suspended: false, batchSize: 1, concurrentLimit: 1, delay: 10, keepResultUntilDownstreamConnected: false }).replaceEnqueueProcessor(
            (queue, newEntity) => {
                const filename = newEntity;
                sendValue("cancel-resolve-conflict:" + filename, true);
                const newQueue = [...queue].filter(e => e != newEntity);
                return [...newQueue, newEntity];
            });


    conflictCheckQueue =
        // First process - Check is the file actually need resolve -
        new QueueProcessor((files: FilePathWithPrefix[]) => {
            const filename = files[0];
            const file = this.vaultAccess.getAbstractFileByPath(filename);
            // if (!file) return;
            // if (!(file instanceof TFile)) return;
            if ((file instanceof TFolder)) return [];
            // Check again?
            return [filename];
            // this.conflictResolveQueue.enqueueWithKey(filename, { filename, file });
        }, {
            suspended: false, batchSize: 1, concurrentLimit: 5, delay: 10, keepResultUntilDownstreamConnected: true, pipeTo: this.conflictResolveQueue, totalRemainingReactiveSource: this.conflictProcessQueueCount
        });

    async resolveConflictByUI(filename: FilePathWithPrefix, conflictCheckResult: diff_result): Promise<boolean> {
        Logger("Merge:open conflict dialog", LOG_LEVEL_VERBOSE);
        const dialog = new ConflictResolveModal(this.app, filename, conflictCheckResult);
        dialog.open();
        const selected = await dialog.waitForResult();
        if (selected === CANCELLED) {
            // Cancelled by UI, or another conflict.
            Logger(`Merge: Cancelled ${filename}`, LOG_LEVEL_INFO);
            return false;
        }
        const testDoc = await this.localDatabase.getDBEntry(filename, { conflicts: true }, false, false, true);
        if (testDoc === false) {
            Logger(`Merge: Could not read ${filename} from the local database`, LOG_LEVEL_VERBOSE);
            return false;
        }
        if (!testDoc._conflicts) {
            Logger(`Merge: Nothing to do ${filename}`, LOG_LEVEL_VERBOSE);
            return false;
        }
        const toDelete = selected;
        const toKeep = conflictCheckResult.left.rev != toDelete ? conflictCheckResult.left.rev : conflictCheckResult.right.rev;
        if (toDelete === LEAVE_TO_SUBSEQUENT) {
            // concat both,
            // delete conflicted revision and write a new file, store it again.
            const p = conflictCheckResult.diff.map((e) => e[1]).join("");
            await this.localDatabase.deleteDBEntry(filename, { rev: testDoc._conflicts[0] });
            const file = this.vaultAccess.getAbstractFileByPath(stripAllPrefixes(filename)) as TFile;
            if (file) {
                if (await this.vaultAccess.vaultModify(file, p)) {
                    await this.updateIntoDB(file);
                }
            } else {
                const newFile = await this.vaultAccess.vaultCreate(filename, p);
                await this.updateIntoDB(newFile);
            }
            await this.pullFile(filename);
            Logger(`Merge: Changes has been concatenated: ${filename}`);
        } else if (typeof toDelete === "string") {
            await this.localDatabase.deleteDBEntry(filename, { rev: toDelete });
            await this.pullFile(filename, undefined, true, toKeep);
            Logger(`Conflict resolved:${filename}`);
        } else {
            Logger(`Merge: Something went wrong: ${filename}, (${toDelete})`, LOG_LEVEL_NOTICE);
            return false;
        }
        // In here, some merge has been processed.
        // So we have to run replication if configured.
        if (this.settings.syncAfterMerge && !this.suspended) {
            await shareRunningResult(`replication`, () => this.replicate());
        }
        // And, check it again.
        this.conflictCheckQueue.enqueue(filename);
        return false;
    }

    async pullFile(filename: FilePathWithPrefix, fileList?: TFile[], force?: boolean, rev?: string, waitForReady = true) {
        const targetFile = this.vaultAccess.getAbstractFileByPath(stripAllPrefixes(filename));
        if (!await this.isTargetFile(filename)) return;
        if (targetFile == null) {
            //have to create;
            const doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : undefined, false, waitForReady);
            if (doc === false) {
                Logger(`${filename} Skipped`);
                return;
            }
            await this.processEntryDoc(doc, undefined, force);
        } else if (targetFile instanceof TFile) {
            //normal case
            const file = targetFile;
            const doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : undefined, false, waitForReady);
            if (doc === false) {
                Logger(`${filename} Skipped`);
                return;
            }
            await this.processEntryDoc(doc, file, force);
        } else {
            Logger(`target files:${filename} is exists as the folder`);
            //something went wrong..
        }
        //when to opened file;
    }

    async syncFileBetweenDBandStorage(file: TFile, doc: LoadedEntry) {
        if (!doc) {
            throw new Error(`Missing doc:${(file as any).path}`)
        }
        if (!(file instanceof TFile) && "path" in file) {
            const w = this.vaultAccess.getAbstractFileByPath((file as any).path);
            if (w instanceof TFile) {
                file = w;
            } else {
                throw new Error(`Missing file:${(file as any).path}`)
            }
        }

        const compareResult = compareFileFreshness(file, doc);
        switch (compareResult) {
            case BASE_IS_NEW:
                if (!this.isFileSizeExceeded(file.stat.size)) {
                    Logger("STORAGE -> DB :" + file.path);
                    await this.updateIntoDB(file);
                    fireAndForget(() => this.checkAndApplySettingFromMarkdown(file.path, true));
                } else {
                    Logger(`STORAGE -> DB : ${file.path} has been skipped due to file size exceeding the limit`, LOG_LEVEL_NOTICE);
                }
                break;
            case TARGET_IS_NEW:
                if (!this.isFileSizeExceeded(doc.size)) {
                    Logger("STORAGE <- DB :" + file.path);
                    const docx = await this.localDatabase.getDBEntry(getPathFromTFile(file), undefined, false, false, true);
                    if (docx != false) {
                        await this.processEntryDoc(docx, file);
                    } else {
                        Logger(`STORAGE <- DB : Cloud not read ${file.path}, possibly deleted`, LOG_LEVEL_NOTICE);
                    }
                    return caches;
                } else {
                    Logger(`STORAGE <- DB : ${file.path} has been skipped due to file size exceeding the limit`, LOG_LEVEL_NOTICE);
                }
                break;
            case EVEN:
                Logger("STORAGE == DB :" + file.path + "", LOG_LEVEL_DEBUG);
                break;
            default:
                Logger("STORAGE ?? DB :" + file.path + " Something got weird");
        }

    }

    async updateIntoDB(file: TFile, cache?: CacheData, force?: boolean) {
        if (!await this.isTargetFile(file)) return true;
        if (shouldBeIgnored(file.path)) {
            return true;
        }
        // let content: Blob;
        const isPlain = isPlainText(file.name);
        const possiblyLarge = !isPlain;
        // if (!cache) {
        if (possiblyLarge) Logger(`Reading   : ${file.path}`, LOG_LEVEL_VERBOSE);
        const content = createBlob(await this.vaultAccess.vaultReadAuto(file));
        const datatype = determineTypeFromBlob(content);
        if (possiblyLarge) Logger(`Processing: ${file.path}`, LOG_LEVEL_VERBOSE);
        const fullPath = getPathFromTFile(file);
        const id = await this.path2id(fullPath);
        const d: SavingEntry = {
            _id: id,
            path: getPathFromTFile(file),
            data: content,
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            size: file.stat.size,
            children: [],
            datatype: datatype,
            type: datatype,
            eden: {},
        };
        //upsert should locked
        const msg = `STORAGE -> DB (${datatype}) `;
        const isNotChanged = await serialized("file-" + fullPath, async () => {
            if (this.vaultAccess.recentlyTouched(file)) {
                return true;
            }
            try {
                const old = await this.localDatabase.getDBEntry(fullPath, undefined, false, false);
                if (old !== false) {
                    const oldData = { data: old.data, deleted: old._deleted || old.deleted };
                    const newData = { data: d.data, deleted: d._deleted || d.deleted };
                    if (oldData.deleted != newData.deleted) return false;
                    if (!await isDocContentSame(old.data, newData.data)) return false;
                    Logger(msg + "Skipped (not changed) " + fullPath + ((d._deleted || d.deleted) ? " (deleted)" : ""), LOG_LEVEL_VERBOSE);
                    markChangesAreSame(old, d.mtime, old.mtime);
                    return true;
                    // d._rev = old._rev;
                }
            } catch (ex) {
                if (force) {
                    Logger(msg + "Error, Could not check the diff for the old one." + (force ? "force writing." : "") + fullPath + ((d._deleted || d.deleted) ? " (deleted)" : ""), LOG_LEVEL_VERBOSE);
                } else {
                    Logger(msg + "Error, Could not check the diff for the old one." + fullPath + ((d._deleted || d.deleted) ? " (deleted)" : ""), LOG_LEVEL_VERBOSE);
                }
                return !force;
            }
            return false;
        });
        if (isNotChanged) {
            Logger(msg + " Skip " + fullPath, LOG_LEVEL_VERBOSE);
            return true;
        }
        const ret = await this.localDatabase.putDBEntry(d);
        if (ret !== false) {
            Logger(msg + fullPath);
            this.scheduleReplicateIfSyncOnSave();
        }
        return ret != false;
    }

    scheduleReplicateIfSyncOnSave() {
        if (this.settings.syncOnSave && !this.suspended) {
            scheduleTask("perform-replicate-after-save", 250, () => this.replicate());
        }
    }

    async deleteFromDB(file: TFile) {
        if (!await this.isTargetFile(file)) return;
        const fullPath = getPathFromTFile(file);
        Logger(`deleteDB By path:${fullPath}`);
        await this.deleteFromDBbyPath(fullPath);
        this.scheduleReplicateIfSyncOnSave();
    }

    async deleteFromDBbyPath(fullPath: FilePath) {
        await this.localDatabase.deleteDBEntry(fullPath);
        this.scheduleReplicateIfSyncOnSave();
    }

    async resetLocalDatabase() {
        this.vaultAccess.clearTouched();
        await this.localDatabase.resetDatabase();
    }

    async tryResetRemoteDatabase() {
        await this.replicator.tryResetRemoteDatabase(this.settings);
    }

    async tryCreateRemoteDatabase() {
        await this.replicator.tryCreateRemoteDatabase(this.settings);
    }

    filterTargetFiles(files: InternalFileInfo[], targetFiles: string[] | false = false) {
        const ignorePatterns = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",").filter(e => e).map(e => new RegExp(e, "i"));
        return files.filter(file => !ignorePatterns.some(e => file.path.match(e))).filter(file => !targetFiles || (targetFiles && targetFiles.indexOf(file.path) !== -1))
    }

    async resolveConflictByNewerEntry(path: FilePathWithPrefix) {
        const id = await this.path2id(path);
        const doc = await this.localDatabase.getRaw<AnyEntry>(id, { conflicts: true });
        // If there is no conflict, return with false.
        if (!("_conflicts" in doc) || doc._conflicts === undefined) return false;
        if (doc._conflicts.length == 0) return false;
        Logger(`Hidden file conflicted:${this.getPath(doc)}`);
        const conflicts = doc._conflicts.sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
        const revA = doc._rev;
        const revB = conflicts[0];
        const revBDoc = await this.localDatabase.getRaw<EntryDoc>(id, { rev: revB });
        // determine which revision should been deleted.
        // simply check modified time
        const mtimeA = ("mtime" in doc && doc.mtime) || 0;
        const mtimeB = ("mtime" in revBDoc && revBDoc.mtime) || 0;
        const delRev = mtimeA < mtimeB ? revA : revB;
        // delete older one.
        await this.localDatabase.removeRevision(id, delRev);
        Logger(`Older one has been deleted:${this.getPath(doc)}`);
        return true;
    }

    ignoreFileCache = new LRUCache<string, string[] | false>(300, 250000, true);
    ignoreFiles = [] as string[]
    async readIgnoreFile(path: string) {
        try {
            const file = await this.vaultAccess.adapterRead(path);
            const gitignore = file.split(/\r?\n/g);
            this.ignoreFileCache.set(path, gitignore);
            return gitignore;
        } catch (ex) {
            this.ignoreFileCache.set(path, false);
            return false;
        }
    }
    async getIgnoreFile(path: string) {
        if (this.ignoreFileCache.has(path)) {
            return this.ignoreFileCache.get(path) ?? false;
        } else {
            return await this.readIgnoreFile(path);
        }
    }

    /**
     * Check the file is ignored by the ignore files.
     * @param file 
     * @returns true if the file should be ignored, false if the file should be processed.
     */
    async isIgnoredByIgnoreFiles(file: string | TAbstractFile) {
        if (!this.settings.useIgnoreFiles) {
            return false;
        }
        const filepath = file instanceof TFile ? file.path : file as string;
        if (this.ignoreFileCache.has(filepath)) {
            // Renew
            await this.readIgnoreFile(filepath);
        }
        if (!await isAcceptedAll(stripAllPrefixes(filepath as FilePathWithPrefix), this.ignoreFiles, (filename) => this.getIgnoreFile(filename))) {
            return true;
        }
        return false;
    }

    async isTargetFile(file: string | TAbstractFile) {
        const filepath = file instanceof TFile ? file.path : file as string;
        if (this.settings.useIgnoreFiles && await this.isIgnoredByIgnoreFiles(file)) {
            return false;
        }
        return this.localDatabase.isTargetFile(filepath);
    }
    async dryRunGC() {
        await skipIfDuplicated("cleanup", async () => {
            const replicator = this.getReplicator();
            if (!(replicator instanceof LiveSyncCouchDBReplicator)) return;
            const remoteDBConn = await replicator.connectRemoteCouchDBWithSetting(this.settings, this.isMobile)
            if (typeof (remoteDBConn) == "string") {
                Logger(remoteDBConn);
                return;
            }
            await purgeUnreferencedChunks(remoteDBConn.db, true, this.settings, false);
            await purgeUnreferencedChunks(this.localDatabase.localDatabase, true);
            this.localDatabase.hashCaches.clear();
        });
    }

    async dbGC() {
        // Lock the remote completely once.
        await skipIfDuplicated("cleanup", async () => {
            const replicator = this.getReplicator();
            if (!(replicator instanceof LiveSyncCouchDBReplicator)) return;
            this.getReplicator().markRemoteLocked(this.settings, true, true);
            const remoteDBConn = await replicator.connectRemoteCouchDBWithSetting(this.settings, this.isMobile)
            if (typeof (remoteDBConn) == "string") {
                Logger(remoteDBConn);
                return;
            }
            await purgeUnreferencedChunks(remoteDBConn.db, false, this.settings, true);
            await purgeUnreferencedChunks(this.localDatabase.localDatabase, false);
            this.localDatabase.hashCaches.clear();
            await balanceChunkPurgedDBs(this.localDatabase.localDatabase, remoteDBConn.db);
            this.localDatabase.refreshSettings();
            Logger("The remote database has been cleaned up! Other devices will be cleaned up on the next synchronisation.")
        });
    }

    askYesNo(message: string): Promise<"yes" | "no"> {
        return askYesNo(this.app, message);
    }
    askSelectString(message: string, items: string[]): Promise<string> {
        return askSelectString(this.app, message, items);
    }

    askInPopup(key: string, dialogText: string, anchorCallback: (anchor: HTMLAnchorElement) => void) {

        const fragment = createFragment((doc) => {

            const [beforeText, afterText] = dialogText.split("{HERE}", 2);
            doc.createEl("span", undefined, (a) => {
                a.appendText(beforeText);
                a.appendChild(a.createEl("a", undefined, (anchor) => {
                    anchorCallback(anchor);
                }));

                a.appendText(afterText);
            });
        });
        const popupKey = "popup-" + key;
        scheduleTask(popupKey, 1000, async () => {
            const popup = await memoIfNotExist(popupKey, () => new Notice(fragment, 0));
            const isShown = popup?.noticeEl?.isShown();
            if (!isShown) {
                memoObject(popupKey, new Notice(fragment, 0));
            }
            scheduleTask(popupKey + "-close", 20000, () => {
                const popup = retrieveMemoObject<Notice>(popupKey);
                if (!popup)
                    return;
                if (popup?.noticeEl?.isShown()) {
                    popup.hide();
                }
                disposeMemoObject(popupKey);
            });
        });
    }
    openSetting() {
        //@ts-ignore: undocumented api
        this.app.setting.open();
        //@ts-ignore: undocumented api
        this.app.setting.openTabById("obsidian-livesync");
    }

    performAppReload() {
        this.performCommand("app:reload");
    }
    performCommand(id: string) {
        // @ts-ignore
        this.app.commands.executeCommandById(id)
    }

    _totalProcessingCount?: ReactiveValue<number>;
    get isReloadingScheduled() {
        return this._totalProcessingCount !== undefined;
    }
    askReload(message?: string) {
        if (this.isReloadingScheduled) {
            Logger(`Reloading is already scheduled`, LOG_LEVEL_VERBOSE);
            return;
        }
        scheduleTask("configReload", 250, async () => {
            const RESTART_NOW = "Yes, restart immediately";
            const RESTART_AFTER_STABLE = "Yes, schedule a restart after stabilisation";
            const RETRY_LATER = "No, Leave it to me";
            const ret = await askSelectString(this.app, message || "Do you want to restart and reload Obsidian now?", [RESTART_AFTER_STABLE, RESTART_NOW, RETRY_LATER]);
            if (ret == RESTART_NOW) {
                this.performAppReload();
            } else if (ret == RESTART_AFTER_STABLE) {
                this.scheduleAppReload();
            }
        })
    }
    scheduleAppReload() {
        if (!this._totalProcessingCount) {
            const __tick = reactiveSource(0);
            this._totalProcessingCount = reactive(() => {
                const dbCount = this.databaseQueueCount.value;
                const replicationCount = this.replicationResultCount.value;
                const storageApplyingCount = this.storageApplyingCount.value;
                const chunkCount = collectingChunks.value;
                const pluginScanCount = pluginScanningCount.value;
                const hiddenFilesCount = hiddenFilesEventCount.value + hiddenFilesProcessingCount.value;
                const conflictProcessCount = this.conflictProcessQueueCount.value;
                const e = this.pendingFileEventCount.value;
                const proc = this.processingFileEventCount.value;
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const __ = __tick.value;
                return dbCount + replicationCount + storageApplyingCount + chunkCount + pluginScanCount + hiddenFilesCount + conflictProcessCount + e + proc;
            })
            this.registerInterval(setInterval(() => {
                __tick.value++;
            }, 1000) as unknown as number);

            let stableCheck = 3;
            this._totalProcessingCount.onChanged(e => {
                if (e.value == 0) {
                    if (stableCheck-- <= 0) {
                        this.performAppReload();
                    }
                    Logger(`Obsidian will be restarted soon! (Within ${stableCheck} seconds)`, LOG_LEVEL_NOTICE, "restart-notice");
                } else {
                    stableCheck = 3;
                }
            })
        }
    }
}

