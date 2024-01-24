const isDebug = false;

import { type Diff, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch, stringifyYaml, parseYaml } from "./deps";
import { debounce, Notice, Plugin, TFile, addIcon, TFolder, normalizePath, TAbstractFile, Editor, MarkdownView, type RequestUrlParam, type RequestUrlResponse, requestUrl, type MarkdownFileInfo } from "./deps";
import { type EntryDoc, type LoadedEntry, type ObsidianLiveSyncSettings, type diff_check_result, type diff_result_leaf, type EntryBody, LOG_LEVEL, VER, DEFAULT_SETTINGS, type diff_result, FLAGMD_REDFLAG, SYNCINFO_ID, SALT_OF_PASSPHRASE, type ConfigPassphraseStore, type CouchDBConnection, FLAGMD_REDFLAG2, FLAGMD_REDFLAG3, PREFIXMD_LOGFILE, type DatabaseConnectingStatus, type EntryHasPath, type DocumentID, type FilePathWithPrefix, type FilePath, type AnyEntry, LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_URGENT, LOG_LEVEL_VERBOSE, type SavingEntry, MISSING_OR_ERROR, NOT_CONFLICTED, AUTO_MERGED, CANCELLED, LEAVE_TO_SUBSEQUENT, FLAGMD_REDFLAG2_HR, FLAGMD_REDFLAG3_HR, } from "./lib/src/types";
import { type InternalFileInfo, type CacheData, type FileEventItem, FileWatchEventQueueMax } from "./types";
import { createBinaryBlob, createTextBlob, fireAndForget, getDocData, isDocContentSame, isObjectDifferent, sendValue } from "./lib/src/utils";
import { Logger, setGlobalLogFunction } from "./lib/src/logger";
import { PouchDB } from "./lib/src/pouchdb-browser.js";
import { ConflictResolveModal } from "./ConflictResolveModal";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { DocumentHistoryModal } from "./DocumentHistoryModal";
import { applyPatch, cancelAllPeriodicTask, cancelAllTasks, cancelTask, generatePatchObj, id2path, isObjectMargeApplicable, isSensibleMargeApplicable, flattenObject, path2id, scheduleTask, tryParseJSON, isValidPath, isInternalMetadata, isPluginMetadata, stripInternalMetadataPrefix, isChunk, askSelectString, askYesNo, askString, PeriodicProcessor, getPath, getPathWithoutPrefix, getPathFromTFile, performRebuildDB, memoIfNotExist, memoObject, retrieveMemoObject, disposeMemoObject, isCustomisationSyncMetadata } from "./utils";
import { encrypt, tryDecrypt } from "./lib/src/e2ee_v2";
import { balanceChunkPurgedDBs, enableEncryption, isCloudantURI, isErrorOfMissingDoc, isValidRemoteCouchDBURI, purgeUnreferencedChunks } from "./lib/src/utils_couchdb";
import { logStore, type LogEntry, collectingChunks, pluginScanningCount, hiddenFilesProcessingCount, hiddenFilesEventCount, logMessages } from "./lib/src/stores";
import { setNoticeClass } from "./lib/src/wrapper";
import { versionNumberString2Number, writeString, decodeBinary, readString } from "./lib/src/strbin";
import { addPrefix, isAcceptedAll, isPlainText, shouldBeIgnored, stripAllPrefixes } from "./lib/src/path";
import { isLockAcquired, serialized, shareRunningResult, skipIfDuplicated } from "./lib/src/lock";
import { StorageEventManager, StorageEventManagerObsidian } from "./StorageEventManager";
import { LiveSyncLocalDB, type LiveSyncLocalDBEnv } from "./lib/src/LiveSyncLocalDB";
import { LiveSyncDBReplicator, type LiveSyncReplicatorEnv } from "./lib/src/LiveSyncReplicator";
import { type KeyValueDatabase, OpenKeyValueDatabase } from "./KeyValueDB";
import { LiveSyncCommands } from "./LiveSyncCommands";
import { HiddenFileSync } from "./CmdHiddenFileSync";
import { SetupLiveSync } from "./CmdSetupLiveSync";
import { ConfigSync } from "./CmdConfigSync";
import { confirmWithMessage } from "./dialogs";
import { GlobalHistoryView, VIEW_TYPE_GLOBAL_HISTORY } from "./GlobalHistoryView";
import { LogPaneView, VIEW_TYPE_LOG } from "./LogPaneView";
import { LRUCache } from "./lib/src/LRUCache";
import { SerializedFileAccess } from "./SerializedFileAccess.js";
import { KeyedQueueProcessor, QueueProcessor, type QueueItemWithKey } from "./lib/src/processor.js";
import { reactive, reactiveSource } from "./lib/src/reactive.js";

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
    implements LiveSyncLocalDBEnv, LiveSyncReplicatorEnv {

    settings!: ObsidianLiveSyncSettings;
    localDatabase!: LiveSyncLocalDB;
    replicator!: LiveSyncDBReplicator;

    statusBar?: HTMLElement;
    suspended = false;
    deviceAndVaultName = "";
    isMobile = false;
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

    processReplication = (e: PouchDB.Core.ExistingDocument<EntryDoc>[]) => this.parseReplicationResult(e);
    async connectRemoteCouchDB(uri: string, auth: { username: string; password: string }, disableRequestURI: boolean, passphrase: string | false, useDynamicIterationCount: boolean, performSetup: boolean, skipInfo: boolean): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> {
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
                    }
                }

                // -old implementation

                try {
                    const response: Response = await fetch(url, opts);
                    if (method == "POST" || method == "PUT") {
                        this.last_successful_post = response.ok;
                    } else {
                        this.last_successful_post = true;
                    }
                    Logger(`HTTP:${method}${size} to:${localURL} -> ${response.status}`, LOG_LEVEL_DEBUG);
                    return response;
                } catch (ex) {
                    Logger(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL_VERBOSE);
                    // limit only in bulk_docs.
                    if (url.toString().indexOf("_bulk_docs") !== -1) {
                        this.last_successful_post = false;
                    }
                    Logger(ex);
                    throw ex;
                }
                // return await fetch(url, opts);
            },
        };

        const db: PouchDB.Database<EntryDoc> = new PouchDB<EntryDoc>(uri, conf);
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
    async onInitializeDatabase(db: LiveSyncLocalDB): Promise<void> {
        this.kvDB = await OpenKeyValueDatabase(db.dbname + "-livesync-kv");
        this.replicator = new LiveSyncDBReplicator(this);
    }
    async onResetDatabase(db: LiveSyncLocalDB): Promise<void> {
        const lsKey = "obsidian-livesync-queuefiles-" + this.getVaultName();
        localStorage.removeItem(lsKey);
        await this.kvDB.destroy();
        this.kvDB = await OpenKeyValueDatabase(db.dbname + "-livesync-kv");
        this.replicator = new LiveSyncDBReplicator(this);
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
        return this.app.vault.getName() + (this.settings?.additionalSuffixOfDatabaseName ? ("-" + this.settings.additionalSuffixOfDatabaseName) : "");
    }

    setInterval(handler: () => any, timeout?: number): number {
        const timer = window.setInterval(handler, timeout);
        this.registerInterval(timer);
        return timer;
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
        const target = await askSelectString(this.app, "File to view History", notesList);
        if (target) {
            const targetId = notes.find(e => e.dispPath == target);
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
        const target = await askSelectString(this.app, "File to resolve conflict", notesList);
        if (target) {
            const targetItem = notes.find(e => e.dispPath == target);
            this.resolveConflicted(targetItem.path);
            await this.conflictCheckQueue.waitForPipeline();
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
            if (doc.type == "newnote" || doc.type == "plain") {
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
    async onLayoutReady() {
        this.registerFileWatchEvents();
        if (!this.localDatabase.isReady) {
            Logger(`Something went wrong! The local database is not ready`, LOG_LEVEL_NOTICE);
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
                    if (await askYesNo(this.app, "Do you want to disable Suspend file watching and restart obsidian now?") == "yes") {
                        this.settings.suspendFileWatching = false;
                        await this.saveSettings();
                        // @ts-ignore
                        this.app.commands.executeCommandById("app:reload")
                    }
                } else if (this.isRedFlag3Raised()) {
                    Logger(`${FLAGMD_REDFLAG3} or ${FLAGMD_REDFLAG3_HR} has been detected! Self-hosted LiveSync will discard the local database and fetch everything from the remote once again.`, LOG_LEVEL_NOTICE);
                    await this.addOnSetup.fetchLocal();
                    await this.deleteRedFlag3();
                    if (this.settings.suspendFileWatching) {
                        if (await askYesNo(this.app, "Do you want to disable Suspend file watching and restart obsidian now?") == "yes") {
                            this.settings.suspendFileWatching = false;
                            await this.saveSettings();
                            // @ts-ignore
                            this.app.commands.executeCommandById("app:reload")
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
            if (this.settings.syncOnStart) {
                this.replicator.openReplication(this.settings, false, false);
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
        for await (const doc of this.localDatabase.findAllDocs({ conflicts: true })) {
            if (!("_conflicts" in doc)) continue;
            notes.push({ path: this.getPath(doc), mtime: doc.mtime });
        }
        if (notes.length > 0) {
            this.askInPopup(`conflicting-detected-on-safety`, `Some files have been left conflicted! Press {HERE} to resolve them, or you can do it later by "Pick a file to resolve conflict`, (anchor) => {
                anchor.text = "HERE";
                anchor.addEventListener("click", () => {
                    // @ts-ignore
                    this.app.commands.executeCommandById("obsidian-livesync:livesync-all-conflictcheck");
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
                const file = this.app.workspace.getActiveFile();
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
                const file = this.app.workspace.getActiveFile();
                if (file) this.showHistory(file, null);
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
                this.checkAndApplySettingFromMarkdown(ctx.file.path, false);
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
    }

    async onload() {
        logStore.pipeTo(new QueueProcessor(logs => logs.forEach(e => this.addLog(e.message, e.level, e.key)), { suspended: false, batchSize: 20, concurrentLimit: 1, delay: 0 })).startPipeline();
        Logger("loading plugin");
        this.addSettingTab(new ObsidianLiveSyncSettingTab(this.app, this));
        this.addUIs();
        //@ts-ignore
        const manifestVersion: string = MANIFEST_VERSION || "0.0.0";
        //@ts-ignore
        const packageVersion: string = PACKAGE_VERSION || "0.0.0";

        this.manifestVersion = manifestVersion;
        this.packageVersion = packageVersion;

        Logger(`Self-hosted LiveSync v${manifestVersion} ${packageVersion} `);
        const lsKey = "obsidian-live-sync-ver" + this.getVaultName();
        const last_version = localStorage.getItem(lsKey);
        await this.loadSettings();
        this.observeForLogs();
        this.statusBar = this.addStatusBarItem();
        this.statusBar.addClass("syncstatusbar");
        const lastVersion = ~~(versionNumberString2Number(manifestVersion) / 1000);
        if (lastVersion > this.settings.lastReadUpdates) {
            Logger("Self-hosted LiveSync has undergone a major upgrade. Please open the setting dialog, and check the information pane.", LOG_LEVEL_NOTICE);
        }

        //@ts-ignore
        if (this.app.isMobile) {
            this.isMobile = true;
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
            this.settings.versionUpFlash = "Self-hosted LiveSync has been upgraded and some behaviors have changed incompatibly. All automatic synchronization is now disabled temporary. Ensure that other devices are also upgraded, and enable synchronization again.";
            this.saveSettings();
        }
        localStorage.setItem(lsKey, `${VER}`);
        await this.openDatabase();
        this.watchWorkspaceOpen = debounce(this.watchWorkspaceOpen.bind(this), 1000, false);
        this.watchWindowVisibility = debounce(this.watchWindowVisibility.bind(this), 1000, false);
        this.watchOnline = debounce(this.watchOnline.bind(this), 500, false);
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
        cancelAllPeriodicTask();
        cancelAllTasks();
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
        Logger("unloading plugin");
    }

    async openDatabase() {
        if (this.localDatabase != null) {
            await this.localDatabase.close();
        }
        const vaultName = this.getVaultName();
        Logger("Waiting for ready...");
        //@ts-ignore
        this.isMobile = this.app.isMobile;
        this.localDatabase = new LiveSyncLocalDB(vaultName, this);
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
        const passphrase = await this.getPassphrase(settings);
        if (passphrase === false) {
            Logger("Could not determine passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL_URGENT);
        } else {
            if (settings.encryptedCouchDBConnection) {
                const keys = ["couchDB_URI", "couchDB_USER", "couchDB_PASSWORD", "couchDB_DBNAME"] as (keyof CouchDBConnection)[];
                const decrypted = this.tryDecodeJson(await this.decryptConfigurationItem(settings.encryptedCouchDBConnection, passphrase)) as CouchDBConnection;
                if (decrypted) {
                    for (const key of keys) {
                        if (key in decrypted) {
                            settings[key] = decrypted[key]
                        }
                    }
                } else {
                    Logger("Could not decrypt passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL_URGENT);
                    for (const key of keys) {
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
        this.ignoreFiles = this.settings.ignoreFiles.split(",").map(e => e.trim());
        this.fileEventQueue.delay = this.settings.batchSave ? 5000 : 100;
    }

    async saveSettingData() {
        const lsKey = "obsidian-live-sync-vaultanddevicename-" + this.getVaultName();

        localStorage.setItem(lsKey, this.deviceAndVaultName || "");

        const settings = { ...this.settings };
        if (this.usedPassphrase == "" && !await this.getPassphrase(settings)) {
            Logger("Could not determine passphrase for saving data.json! Our data.json have insecure items!", LOG_LEVEL_NOTICE);
        } else {
            if (settings.couchDB_PASSWORD != "" || settings.couchDB_URI != "" || settings.couchDB_USER != "" || settings.couchDB_DBNAME) {
                const connectionSetting: CouchDBConnection = {
                    couchDB_DBNAME: settings.couchDB_DBNAME,
                    couchDB_PASSWORD: settings.couchDB_PASSWORD,
                    couchDB_URI: settings.couchDB_URI,
                    couchDB_USER: settings.couchDB_USER,
                };
                settings.encryptedCouchDBConnection = await this.encryptConfigurationItem(JSON.stringify(connectionSetting), settings);
                settings.couchDB_PASSWORD = "";
                settings.couchDB_DBNAME = "";
                settings.couchDB_URI = "";
                settings.couchDB_USER = "";
            }
            if (settings.encrypt && settings.passphrase != "") {
                settings.encryptedPassphrase = await this.encryptConfigurationItem(settings.passphrase, settings);
                settings.passphrase = "";
            }
        }
        await this.saveData(settings);
        this.localDatabase.settings = this.settings;
        this.fileEventQueue.delay = this.settings.batchSave ? 5000 : 100;
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
        const file = this.app.vault.getAbstractFileByPath(filename);
        if (!(file instanceof TFile)) return {
            preamble: "",
            body: "",
            postscript: "",
        };
        if (data) {
            return this.extractSettingFromWholeText(data);
        }
        const parseData = data ?? await this.app.vault.read(file);
        return this.extractSettingFromWholeText(parseData);
    }

    async checkAndApplySettingFromMarkdown(filename: string, automated?: boolean) {
        if (automated && !this.settings.notifyAllSettingSyncFile) {
            if (this.settings.settingSyncFile != filename) {
                Logger(`Setting file (${filename}) is not matched to the current configuration. skipped.`, LOG_LEVEL_INFO);
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
                const result = await askSelectString(this.app, "Ready for apply the setting.", [APPLY_AND_RESTART, APPLY_ONLY, APPLY_AND_FETCH, APPLY_AND_REBUILD, CANCEL]);
                if (result == APPLY_ONLY || result == APPLY_AND_RESTART || result == APPLY_AND_REBUILD || result == APPLY_AND_FETCH) {
                    this.settings = settingToApply;
                    await this.saveSettingData();
                    if (result == APPLY_ONLY) {
                        Logger("Loaded settings have been applied!", LOG_LEVEL_NOTICE);
                        return;
                    }
                    if (result == APPLY_AND_REBUILD) {
                        await this.app.vault.create(FLAGMD_REDFLAG2_HR, "");
                    }
                    if (result == APPLY_AND_FETCH) {
                        await this.app.vault.create(FLAGMD_REDFLAG3_HR, "");
                    }
                    // @ts-ignore
                    this.app.commands.executeCommandById("app:reload");
                }
            }
            )
        })
    }
    generateSettingForMarkdown(settings?: ObsidianLiveSyncSettings, keepCredential?: boolean): Partial<ObsidianLiveSyncSettings> {
        const saveData = { ...(settings ? settings : this.settings) };
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
        let file = this.app.vault.getAbstractFileByPath(filename);


        if (!file) {
            await this.ensureDirectoryEx(filename);
            const initialContent = `This file contains Self-hosted LiveSync settings as YAML.
Except for the \`livesync-setting\` code block, we can add a note for free.

If the name of this file matches the value of the "settingSyncFile" setting inside the \`livesync-setting\` block, LiveSync will tell us whenever the settings change. We can decide to accept or decline the remote setting. (In other words, we can back up this file by renaming it to another name).

We can perform a command in this file.
- \`Parse setting file\` : load the setting from the file.

**Note** Please handle it with all of your care if you have configured to write credentials in.


`
            file = await this.app.vault.create(filename, initialContent + SETTING_HEADER + "\n" + SETTING_FOOTER);
        }
        if (!(file instanceof TFile)) {
            Logger(`Markdown Setting: ${filename} already exists as a folder`, LOG_LEVEL_NOTICE);
            return;
        }

        const data = await this.app.vault.read(file);
        const { preamble, body, postscript } = this.extractSettingFromWholeText(data);
        const newBody = stringifyYaml(saveData);

        if (newBody == body) {
            Logger("Markdown setting: Nothing had been changed", LOG_LEVEL_VERBOSE);
        } else {
            await this.app.vault.modify(file, preamble + SETTING_HEADER + newBody + SETTING_FOOTER + postscript);
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
                    } else {
                        Logger("Sync on Editor Save.", LOG_LEVEL_VERBOSE);
                        if (this.settings.syncOnEditorSave) {
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
            //@ts-ignore
            _this.app.commands.executeCommandById('editor:save-file');
        };
    }
    registerWatchEvents() {
        this.registerEvent(this.app.workspace.on("file-open", this.watchWorkspaceOpen));
        this.registerDomEvent(document, "visibilitychange", this.watchWindowVisibility);
        this.registerDomEvent(window, "online", this.watchOnline);
        this.registerDomEvent(window, "offline", this.watchOnline);
    }


    watchOnline() {
        this.watchOnlineAsync();
    }
    async watchOnlineAsync() {
        // If some files were failed to retrieve, scan files again.
        // TODO:FIXME AT V0.17.31, this logic has been disabled.
        if (navigator.onLine && this.localDatabase.needScanning) {
            this.localDatabase.needScanning = false;
            await this.syncAllFiles();
        }
    }
    watchWindowVisibility() {
        this.watchWindowVisibilityAsync();
    }

    async watchWindowVisibilityAsync() {
        if (this.settings.suspendFileWatching) return;
        if (!this.isReady) return;
        // if (this.suspended) return;
        const isHidden = document.hidden;
        await this.applyBatchChange();
        if (isHidden) {
            this.replicator.closeReplication();
            this.periodicSyncProcessor?.disable();
        } else {
            // suspend all temporary.
            if (this.suspended) return;
            await Promise.all(this.addOns.map(e => e.onResume()));
            if (this.settings.liveSync) {
                this.replicator.openReplication(this.settings, true, false);
            }
            if (this.settings.syncOnStart) {
                this.replicator.openReplication(this.settings, false, false);
            }
            this.periodicSyncProcessor.enable(this.settings.periodicReplication ? this.settings.periodicReplicationInterval * 1000 : 0);
        }
    }

    cancelRelativeEvent(item: FileEventItem) {
        this.fileEventQueue.modifyQueue((items) => [...items.filter(e => e.entity.key != item.key)])
    }

    queueNextFileEvent(items: QueueItemWithKey<FileEventItem>[], newItem: QueueItemWithKey<FileEventItem>): QueueItemWithKey<FileEventItem>[] {
        if (this.settings.batchSave && !this.settings.liveSync) {
            const file = newItem.entity.args.file;
            // if the latest event is the same type, omit that
            // a.md MODIFY  <- this should be cancelled when a.md MODIFIED
            // b.md MODIFY    <- this should be cancelled when b.md MODIFIED
            // a.md MODIFY
            // a.md CREATE
            //     : 
            let i = items.length;
            L1:
            while (i >= 0) {
                i--;
                if (i < 0) break L1;
                if (items[i].entity.args.file.path != file.path) {
                    continue L1;
                }
                if (items[i].entity.type != newItem.entity.type) break L1;
                items.remove(items[i]);
            }
        }
        items.push(newItem);
        // When deleting or renaming, the queue must be flushed once before processing subsequent processes to prevent unexpected race condition.
        if (newItem.entity.type == "DELETE" || newItem.entity.type == "RENAME") {
            this.fileEventQueue.requestNextFlush();
        }
        return items;
    }
    async handleFileEvent(queue: FileEventItem): Promise<any> {
        const file = queue.args.file;
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

            const cache = queue.args.cache;
            if (queue.type == "CREATE" || queue.type == "CHANGED") {
                fireAndForget(() => this.checkAndApplySettingFromMarkdown(queue.args.file.path, true));
                const keyD1 = `file-last-proc-DELETED-${file.path}`;
                await this.kvDB.set(keyD1, mtime);
                if (!await this.updateIntoDB(targetFile, false, cache)) {
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
    }

    pendingFileEventCount = reactiveSource(0);
    fileEventQueue =
        new KeyedQueueProcessor(
            (items: FileEventItem[]) => this.handleFileEvent(items[0]),
            { suspended: true, batchSize: 1, concurrentLimit: 5, delay: 100, yieldThreshold: FileWatchEventQueueMax, totalRemainingReactiveSource: this.pendingFileEventCount }
        ).replaceEnqueueProcessor((items, newItem) => this.queueNextFileEvent(items, newItem));


    flushFileEventQueue() {
        return this.fileEventQueue.flush();
    }

    watchWorkspaceOpen(file: TFile | null) {
        if (this.settings.suspendFileWatching) return;
        if (!this.isReady) return;
        if (!file) return;
        this.watchWorkspaceOpenAsync(file);
    }

    async watchWorkspaceOpenAsync(file: TFile) {
        if (this.settings.suspendFileWatching) return;
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
            return this.getFilePath(file.parent) + "/" + file.name;
        }
        if (file instanceof TFile) {
            return this.getFilePath(file.parent) + "/" + file.name;
        }

        return this.getFilePath(file.parent) + "/" + file.name;
    }

    async watchVaultRenameAsync(file: TFile, oldFile: any, cache?: CacheData) {
        Logger(`${oldFile} renamed to ${file.path}`, LOG_LEVEL_VERBOSE);
        if (file instanceof TFile) {
            try {
                // Logger(`RENAMING.. ${file.path} into db`);
                if (await this.updateIntoDB(file, false, cache)) {
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
                this.app.vault.adapter.append(normalizePath(logDate), "```\n");
            }
            this.app.vault.adapter.append(normalizePath(logDate), vaultName + ":" + newMessage + "\n");
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

    async ensureDirectory(fullPath: string) {
        const pathElements = fullPath.split("/");
        pathElements.pop();
        let c = "";
        for (const v of pathElements) {
            c += v;
            try {
                await this.app.vault.createFolder(c);
            } catch (ex) {
                // basically skip exceptions.
                if (ex.message && ex.message == "Folder already exists.") {
                    // especially this message is.
                } else {
                    Logger("Folder Create Error");
                    Logger(ex);
                }
            }
            c += "/";
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
                Logger(`Processing: ${file.path}: Conflicted revision has been deleted, but there were more conflicts. `, LOG_LEVEL_INFO);
                await this.processEntryDoc(docEntry, file, true);
                return;
            } else if (force != true) {
                Logger(`Processing: ${file.path}: Conflicted revision has been deleted, but there were more conflicts...`);
                this.queueConflictCheck(file);
                return;
            }
        }
        // If there are no conflicts, or forced to overwrite.

        if (docEntry._deleted || docEntry.deleted || existDoc === false) {
            if (path != file.path) {
                Logger(`delete skipped: ${file.path} :Not exactly matched`, LOG_LEVEL_VERBOSE);
            }
            if (existDoc === false) {
                await this.deleteVaultItem(file);
            } else {
                // Conflict has been resolved at this time, 
                await this.pullFile(path, null, force);
            }
            return;
        }
        const localMtime = ~~((file?.stat?.mtime || 0) / 1000);
        const docMtime = ~~(docEntry.mtime / 1000);

        // const doc = await this.localDatabase.getDBEntry(path, { rev: docEntry._rev });
        // if (doc === false) return;
        const doc = existDoc;
        // if (doc === false) {
        //     // The latest file 
        //     await this.pullFile(path, null, force);
        //     // Logger(`delete skipped: ${file.path} :Not exactly matched`, LOG_LEVEL_VERBOSE);
        //     return;
        // }

        if (doc.datatype != "newnote" && doc.datatype != "plain") {
            Logger(msg + "ERROR, Invalid datatype: " + path + "(" + doc.datatype + ")", LOG_LEVEL_NOTICE);
            return;
        }
        if (!force && localMtime >= docMtime) return;
        if (!isValidPath(path)) {
            Logger(msg + "ERROR, invalid path: " + path, LOG_LEVEL_NOTICE);
            return;
        }
        const writeData = doc.datatype == "newnote" ? decodeBinary(doc.data) : getDocData(doc.data);
        await this.ensureDirectoryEx(path);
        try {
            let outFile;
            let isChanged = true;
            if (mode == "create") {
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
                this.app.vault.trigger(mode, outFile);
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
        Logger(`files: ${dir.children.length}`);
        if (dir.children.length == 0) {
            if (!this.settings.doNotDeleteFolder) {
                Logger(`All files under the parent directory (${dir.path}) have been deleted, so delete this one.`);
                await this.deleteVaultItem(dir);
            }
        }
    }

    queueConflictCheck(file: FilePathWithPrefix | TFile) {
        const path = file instanceof TFile ? getPathFromTFile(file) : file;
        if (this.settings.checkConflictOnlyOnOpen) {
            const af = this.app.workspace.getActiveFile();
            if (af && af.path != path) {
                Logger(`${file} is conflicted, merging process has been postponed.`, LOG_LEVEL_NOTICE);
                return;
            }
        }
        this.conflictCheckQueue.enqueue(path);
    }

    saveQueuedFiles() {
        const saveData = JSON.stringify(this.replicationResultProcessor._queue.map((e) => e._id));
        const lsKey = "obsidian-livesync-queuefiles-" + this.getVaultName();
        localStorage.setItem(lsKey, saveData);
    }
    async loadQueuedFiles() {
        if (!this.settings.suspendParseReplicationResult) {
            const lsKey = "obsidian-livesync-queuefiles-" + this.getVaultName();
            const ids = [...new Set(JSON.parse(localStorage.getItem(lsKey) || "[]"))] as string[];
            const ret = await this.localDatabase.allDocsRaw<EntryDoc>({ keys: ids, include_docs: true });
            for (const doc of ret.rows) {
                this.replicationResultProcessor.enqueue(doc.doc);
            }
        }
    }

    databaseQueueCount = reactiveSource(0);
    databaseQueuedProcessor = new KeyedQueueProcessor(async (docs: EntryBody[]) => {
        const dbDoc = docs[0];
        const path = this.getPath(dbDoc);
        // If `Read chunks online` is disabled, chunks should be transferred before here.
        // However, in some cases, chunks are after that. So, if missing chunks exist, we have to wait for them.
        const datatype = (!("type" in dbDoc) || dbDoc.type == "notes") ? "newnote" : dbDoc.type;
        const doc = await this.localDatabase.getDBEntryFromMeta({ ...dbDoc, datatype, data: [] }, {}, false, true, true);
        if (!doc) {
            Logger(`Something went wrong while gathering content of ${path} (${dbDoc._id.substring(0, 8)}, ${dbDoc._rev?.substring(0, 10)}) `, LOG_LEVEL_NOTICE)
            return;
        }
        if (isInternalMetadata(doc._id) && this.settings.syncInternalFiles) {
            //system file
            const filename = this.getPathWithoutPrefix(doc);
            this.isTargetFile(filename).then((ret) => ret ? this.addOnHiddenFileSync.procInternalFile(filename) : Logger(`Skipped (Not target:${filename})`, LOG_LEVEL_VERBOSE));
        } else if (isValidPath(this.getPath(doc))) {
            this.storageApplyingProcessor.enqueueWithKey(doc.path, doc);
        } else {
            Logger(`Skipped: ${doc._id.substring(0, 8)}`, LOG_LEVEL_VERBOSE);
        }
        return;
    }, { suspended: true, batchSize: 1, concurrentLimit: 10, yieldThreshold: 1, delay: 0, totalRemainingReactiveSource: this.databaseQueueCount }).startPipeline();

    storageApplyingCount = reactiveSource(0);
    storageApplyingProcessor = new KeyedQueueProcessor(async (docs: LoadedEntry[]) => {
        const entry = docs[0];
        const path = this.getPath(entry);
        Logger(`Processing ${path} (${entry._id.substring(0, 8)}: ${entry._rev?.substring(0, 5)}) change...`, LOG_LEVEL_VERBOSE);
        const targetFile = this.vaultAccess.getAbstractFileByPath(this.getPathWithoutPrefix(entry));
        if (targetFile instanceof TFolder) {
            Logger(`${this.getPath(entry)} is already exist as the folder`);
        } else {
            await this.processEntryDoc(entry, targetFile instanceof TFile ? targetFile : undefined);
            Logger(`Processing ${path} (${entry._id.substring(0, 8)}:${entry._rev?.substring(0, 5)}) `);
        }

        return;
    }, { suspended: true, batchSize: 1, concurrentLimit: 2, yieldThreshold: 1, delay: 0, totalRemainingReactiveSource: this.storageApplyingCount }).startPipeline()


    replicationResultCount = reactiveSource(0);
    replicationResultProcessor = new QueueProcessor(async (docs: PouchDB.Core.ExistingDocument<EntryDoc>[]) => {
        if (this.settings.suspendParseReplicationResult) return;
        const change = docs[0];
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
        if (change.type == "plain" || change.type == "newnote") {
            if (this.databaseQueuedProcessor._isSuspended) {
                Logger(`Processing scheduled: ${change.path}`, LOG_LEVEL_INFO);
            }
            const size = change.size;
            if (this.isFileSizeExceeded(size)) {
                Logger(`Processing ${change.path} has been skipped due to file size exceeding the limit`, LOG_LEVEL_NOTICE);
                return;
            }
            this.databaseQueuedProcessor.enqueueWithKey(change.path, change);
        }
        return;
    }, { batchSize: 1, suspended: true, concurrentLimit: 1, delay: 0, totalRemainingReactiveSource: this.replicationResultCount }).startPipeline().onUpdateProgress(() => {
        this.saveQueuedFiles();
    });
    //---> Sync
    parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>) {
        if (this.settings.suspendParseReplicationResult) {
            this.replicationResultProcessor.suspend()
        } else {
            this.replicationResultProcessor.resume()
        }
        this.replicationResultProcessor.enqueueAll(docs);
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
        if (this.settings.liveSync) {
            this.replicator.openReplication(this.settings, true, false);
        }

        const q = activeDocument.querySelector(`.livesync-ribbon-showcustom`);
        q?.toggleClass("sls-hidden", !this.settings.usePluginSync);

        this.periodicSyncProcessor.enable(this.settings.periodicReplication ? this.settings.periodicReplicationInterval * 1000 : 0);


    }

    lastMessage = "";

    observeForLogs() {
        // const logStore
        const queueCountLabel = reactive(() => {
            const dbCount = this.databaseQueueCount.value;
            const replicationCount = this.replicationResultCount.value;
            const storageApplyingCount = this.storageApplyingCount.value;
            const chunkCount = collectingChunks.value;
            const pluginScanCount = pluginScanningCount.value;
            const hiddenFilesCount = hiddenFilesEventCount.value + hiddenFilesProcessingCount.value;
            const conflictProcessCount = this.conflictProcessQueueCount.value;
            const labelReplication = replicationCount ? `📥 ${replicationCount} ` : "";
            const labelDBCount = dbCount ? `📄 ${dbCount} ` : "";
            const labelStorageCount = storageApplyingCount ? `💾 ${storageApplyingCount}` : "";
            const labelChunkCount = chunkCount ? `🧩${chunkCount} ` : "";
            const labelPluginScanCount = pluginScanCount ? `🔌${pluginScanCount} ` : "";
            const labelHiddenFilesCount = hiddenFilesCount ? `⚙️${hiddenFilesCount} ` : "";
            const labelConflictProcessCount = conflictProcessCount ? `🔩${conflictProcessCount} ` : "";
            return `${labelReplication}${labelDBCount}${labelStorageCount}${labelChunkCount}${labelPluginScanCount}${labelHiddenFilesCount}${labelConflictProcessCount}`;
        })

        const replicationStatLabel = reactive(() => {
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
                    w = "⚡";
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
        const waitingLabel = reactive(() => {
            const e = this.pendingFileEventCount.value;
            const proc = this.fileEventQueue.processingEntities;
            const pend = e - proc;
            const labelProc = proc != 0 ? `⏳${proc} ` : "";
            const labelPend = pend != 0 ? ` 🛫${pend}` : "";
            return `${labelProc}${labelPend}`;
        })
        const statusLineLabel = reactive(() => {
            const { w, sent, pushLast, arrived, pullLast } = replicationStatLabel.value;
            const queued = queueCountLabel.value;
            const waiting = waitingLabel.value;
            return {
                message: `Sync: ${w} ↑${sent}${pushLast} ↓${arrived}${pullLast}${waiting} ${queued}`,
            };
        })
        const statusBarLabels = reactive(() => {

            const { message } = statusLineLabel.value;
            const status = this.statusLog.value;
            return {
                message, status
            }
        })
        let last = 0;
        const applyToDisplay = () => {
            const v = statusBarLabels.value;
            const now = Date.now();
            if (now - last < 10) {
                scheduleTask("applyToDisplay", 20, () => applyToDisplay());
                return;
            }
            this.applyStatusBarText(v.message, v.status);
            last = now;
        }
        statusBarLabels.onChanged(applyToDisplay);
    }

    applyStatusBarText(message: string, log: string) {
        const newMsg = message;
        const newLog = log;
        // scheduleTask("update-display", 50, () => {
        this.statusBar?.setText(newMsg.split("\n")[0]);
        if (this.settings.showStatusOnEditor) {
            const root = activeDocument.documentElement;
            const q = root.querySelectorAll(`.CodeMirror-wrap,.cm-s-obsidian>.cm-editor,.canvas-wrapper`);
            q.forEach(e => e.setAttr("data-log", '' + (newMsg + "\n" + newLog) + ''))
        } else {
            const root = activeDocument.documentElement;
            const q = root.querySelectorAll(`.CodeMirror-wrap,.cm-s-obsidian>.cm-editor,.canvas-wrapper`);
            q.forEach(e => e.setAttr("data-log", ''))
        }
        // }, true);
        scheduleTask("log-hide", 3000, () => { this.statusLog.value = "" });
    }

    async replicate(showMessage?: boolean) {
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
        const ret = await this.replicator.openReplication(this.settings, false, showMessage);
        if (!ret) {
            if (this.replicator.remoteLockedAndDeviceNotAccepted) {
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
                            const remoteDB = await this.getReplicator().connectRemoteCouchDBWithSetting(this.settings, this.getIsMobile(), true);
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

        return ret;
    }

    async initializeDatabase(showingNotice?: boolean, reopenDatabase = true) {
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

    async replicateAllToServer(showingNotice?: boolean) {
        if (!this.isReady) return false;
        await Promise.all(this.addOns.map(e => e.beforeReplicate(showingNotice)));
        return await this.replicator.replicateAllToServer(this.settings, showingNotice);
    }
    async replicateAllFromServer(showingNotice?: boolean) {
        if (!this.isReady) return false;
        return await this.replicator.replicateAllFromServer(this.settings, showingNotice);
    }

    async markRemoteLocked(lockByClean?: boolean) {
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
        let initialScan = false;
        if (showingNotice) {
            Logger("Initializing", LOG_LEVEL_NOTICE, "syncAll");
        }

        Logger("Initialize and checking database files");
        Logger("Checking deleted files");
        await this.collectDeletedFiles();

        Logger("Collecting local files on the storage", LOG_LEVEL_VERBOSE);
        const filesStorageSrc = this.app.vault.getFiles();

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
            if (isValidPath(path) && await this.isTargetFile(path)) {
                filesDatabase.push(path);
            }
        }
        Logger("Opening the key-value database", LOG_LEVEL_VERBOSE);
        const isInitialized = await (this.kvDB.get<boolean>("initialized")) || false;
        // Make chunk bigger if it is the initial scan. There must be non-active docs.
        if (filesDatabase.length == 0 && !isInitialized) {
            initialScan = true;
            Logger("Database looks empty, save files as initial sync data");
        }
        const onlyInStorage = filesStorage.filter((e) => filesDatabase.indexOf(getPathFromTFile(e)) == -1);
        const onlyInDatabase = filesDatabase.filter((e) => filesStorageName.indexOf(e) == -1);

        const onlyInStorageNames = onlyInStorage.map((e) => e.path);

        const syncFiles = filesStorage.filter((e) => onlyInStorageNames.indexOf(e.path) == -1);
        Logger("Updating database by new files");
        // this.setStatusBarText(`UPDATE DATABASE`);

        const initProcess = [];
        const logLevel = showingNotice ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
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
                    Logger(`${procedureName}: DONE:${success}, FAILED:${failed}, LAST:${processor._queue.length}`, logLevel, `log-${procedureName}`);
                }
                return;
            }, { batchSize: 1, concurrentLimit: 10, delay: 0, suspended: true }, objects)
            await processor.waitForPipeline();
            Logger(`${procedureName} All done: DONE:${success}, FAILED:${failed}`, logLevel, `log-${procedureName}`);
        }
        initProcess.push(runAll("UPDATE DATABASE", onlyInStorage, async (e) => {
            if (!this.isFileSizeExceeded(e.stat.size)) {
                await this.updateIntoDB(e, initialScan);
                fireAndForget(() => this.checkAndApplySettingFromMarkdown(e.path, true));
            } else {
                Logger(`UPDATE DATABASE: ${e.path} has been skipped due to file size exceeding the limit`, logLevel);
            }
        }));
        if (!initialScan) {
            initProcess.push(runAll("UPDATE STORAGE", onlyInDatabase, async (e) => {
                const w = await this.localDatabase.getDBEntryMeta(e, {}, true);
                if (w && !(w.deleted || w._deleted)) {
                    if (!this.isFileSizeExceeded(w.size)) {
                        await this.pullFile(e, filesStorage, false, null, false);
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
        }
        if (!initialScan) {
            let caches: { [key: string]: { storageMtime: number; docMtime: number } } = {};
            caches = await this.kvDB.get<{ [key: string]: { storageMtime: number; docMtime: number } }>("diff-caches") || {};
            type FileDocPair = { file: TFile, id: DocumentID };

            const processPrepareSyncFile = new QueueProcessor(
                async (files) => {
                    const file = files[0];
                    const id = await this.path2id(getPathFromTFile(file));
                    const pair: FileDocPair = { file, id };
                    return [pair];
                    // processSyncFile.enqueue(pair);
                }
                , { batchSize: 1, concurrentLimit: 10, delay: 0, suspended: true }, syncFiles);
            processPrepareSyncFile
                .pipeTo(
                    new QueueProcessor(
                        async (pairs) => {
                            const docs = await this.localDatabase.allDocsRaw<EntryDoc>({ keys: pairs.map(e => e.id), include_docs: true });
                            const docsMap = docs.rows.reduce((p, c) => ({ ...p, [c.id]: c.doc }), {} as Record<DocumentID, EntryDoc>);
                            const syncFilesToSync = pairs.map((e) => ({ file: e.file, doc: docsMap[e.id] as LoadedEntry }));
                            return syncFilesToSync;
                        }
                        , { batchSize: 10, concurrentLimit: 5, delay: 10, suspended: false }))
                .pipeTo(
                    new QueueProcessor(
                        async (loadedPairs) => {
                            const e = loadedPairs[0];
                            await this.syncFileBetweenDBandStorage(e.file, e.doc, initialScan, caches);
                            return;
                        }, { batchSize: 1, concurrentLimit: 5, delay: 10, suspended: false }
                    ))

            processPrepareSyncFile.startPipeline();
            initProcess.push(async () => {
                await processPrepareSyncFile.waitForPipeline();
                await this.kvDB.set("diff-caches", caches);
            })
        }
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
            const commonBase = revFrom._revs_info.filter(e => e.status == "available" && Number(e.rev.split("-")[0]) < conflictedRevNo).first()?.rev ?? "";
            let p = undefined;
            if (commonBase) {
                if (isSensibleMargeApplicable(path)) {
                    const result = await this.mergeSensibly(path, commonBase, test._rev, conflictedRev);
                    if (result) {
                        p = result.filter(e => e[0] != DIFF_DELETE).map((e) => e[1]).join("");
                        // can be merged.
                        Logger(`Sensible merge:${path}`, LOG_LEVEL_INFO);
                    } else {
                        Logger(`Sensible merge is not applicable.`, LOG_LEVEL_VERBOSE);
                    }
                } else if (isObjectMargeApplicable(path)) {
                    // can be merged.
                    const result = await this.mergeObject(path, commonBase, test._rev, conflictedRev);
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
        const leftLeaf = await this.getConflictedDoc(path, test._rev);
        const rightLeaf = await this.getConflictedDoc(path, conflicts[0]);
        if (leftLeaf == false) {
            // what's going on..
            Logger(`could not get current revisions:${path}`, LOG_LEVEL_NOTICE);
            return MISSING_OR_ERROR;
        }
        if (rightLeaf == false) {
            // Conflicted item could not load, delete this.
            await this.localDatabase.deleteDBEntry(path, { rev: conflicts[0] });
            await this.pullFile(path, null, true);
            Logger(`could not get old revisions, automatically used newer one:${path}`, LOG_LEVEL_NOTICE);
            return AUTO_MERGED;
        }

        const isSame = leftLeaf.data == rightLeaf.data && leftLeaf.deleted == rightLeaf.deleted;
        const isBinary = !isPlainText(path);
        const alwaysNewer = this.settings.resolveConflictsByNewerFile;
        if (isSame || isBinary || alwaysNewer) {
            const lMtime = ~~(leftLeaf.mtime / 1000);
            const rMtime = ~~(rightLeaf.mtime / 1000);
            let loser = leftLeaf;
            if (lMtime > rMtime) {
                loser = rightLeaf;
            }
            await this.localDatabase.deleteDBEntry(path, { rev: loser.rev });
            await this.pullFile(path, null, true);
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
        new KeyedQueueProcessor(async (entries: { filename: FilePathWithPrefix, file: TFile }[]) => {
            const entry = entries[0];
            const filename = entry.filename;
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
                const af = this.app.workspace.getActiveFile();
                if (af && af.path != filename) {
                    Logger(`${filename} is conflicted. Merging process has been postponed to the file have got opened.`, LOG_LEVEL_NOTICE);
                    return;
                }
            }
            Logger("conflict:Manual merge required!");
            await this.resolveConflictByUI(filename, conflictCheckResult);
        }, { suspended: false, batchSize: 1, concurrentLimit: 1, delay: 10, keepResultUntilDownstreamConnected: false }).replaceEnqueueProcessor(
            (queue, newEntity) => {
                const filename = newEntity.entity.filename;
                sendValue("cancel-resolve-conflict:" + filename, true);
                const newQueue = [...queue].filter(e => e.key != newEntity.key);
                return [...newQueue, newEntity];
            });


    conflictCheckQueue =
        // First process - Check is the file actually need resolve -
        new QueueProcessor((files: FilePathWithPrefix[]) => {
            const filename = files[0];
            const file = this.vaultAccess.getAbstractFileByPath(filename);
            if (!file) return;
            if (!(file instanceof TFile)) return;
            // Check again?

            return [{ key: filename, entity: { filename, file } }];
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
            return;
        }
        const testDoc = await this.localDatabase.getDBEntry(filename, { conflicts: true }, false, false, true);
        if (testDoc === false) {
            Logger(`Merge: Could not read ${filename} from the local database`, LOG_LEVEL_VERBOSE);
            return;
        }
        if (!testDoc._conflicts) {
            Logger(`Merge: Nothing to do ${filename}`, LOG_LEVEL_VERBOSE);
            return;
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
            await this.pullFile(filename, null, true, toKeep);
            Logger(`Conflict resolved:${filename}`);
        } else {
            Logger(`Merge: Something went wrong: ${filename}, (${toDelete})`, LOG_LEVEL_NOTICE);
            return;
        }
        // In here, some merge has been processed.
        // So we have to run replication if configured.
        if (this.settings.syncAfterMerge && !this.suspended) {
            await shareRunningResult(`replication`, () => this.replicate());
        }
        // And, check it again.
        this.conflictCheckQueue.enqueue(filename);
    }

    async pullFile(filename: FilePathWithPrefix, fileList?: TFile[], force?: boolean, rev?: string, waitForReady = true) {
        const targetFile = this.vaultAccess.getAbstractFileByPath(stripAllPrefixes(filename));
        if (!await this.isTargetFile(filename)) return;
        if (targetFile == null) {
            //have to create;
            const doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : null, false, waitForReady);
            if (doc === false) {
                Logger(`${filename} Skipped`);
                return;
            }
            await this.processEntryDoc(doc, undefined, force);
        } else if (targetFile instanceof TFile) {
            //normal case
            const file = targetFile;
            const doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : null, false, waitForReady);
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

    async syncFileBetweenDBandStorage(file: TFile, doc: LoadedEntry, initialScan: boolean, caches: { [key: string]: { storageMtime: number; docMtime: number } }) {
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

        const storageMtime = ~~(file.stat.mtime / 1000);
        const docMtime = ~~(doc.mtime / 1000);
        const dK = `${file.path}-diff`;
        const isLastDiff = dK in caches ? caches[dK] : { storageMtime: 0, docMtime: 0 };
        if (isLastDiff.docMtime == docMtime && isLastDiff.storageMtime == storageMtime) {
            // Logger("STORAGE .. DB :" + file.path, LOG_LEVEL_VERBOSE);
            caches[dK] = { storageMtime, docMtime };
            return caches;
        }
        if (storageMtime > docMtime) {
            //newer local file.
            if (!this.isFileSizeExceeded(file.stat.size)) {
                Logger("STORAGE -> DB :" + file.path);
                Logger(`${storageMtime} > ${docMtime}`);
                await this.updateIntoDB(file, initialScan);
                fireAndForget(() => this.checkAndApplySettingFromMarkdown(file.path, true));
                caches[dK] = { storageMtime, docMtime };
                return caches;
            } else {
                Logger(`STORAGE -> DB : ${file.path} has been skipped due to file size exceeding the limit`, LOG_LEVEL_NOTICE);
            }
        } else if (storageMtime < docMtime) {
            //newer database file.
            if (!this.isFileSizeExceeded(doc.size)) {
                Logger("STORAGE <- DB :" + file.path);
                Logger(`${storageMtime} < ${docMtime}`);
                const docx = await this.localDatabase.getDBEntry(getPathFromTFile(file), null, false, false);
                if (docx != false) {
                    await this.processEntryDoc(docx, file);
                } else {
                    Logger(`STORAGE <- DB : ${file.path} has been skipped due to file size exceeding the limit`, LOG_LEVEL_NOTICE);
                }
                caches[dK] = { storageMtime, docMtime };
                return caches;
            } else {
                Logger("STORAGE <- DB :" + file.path + " Skipped (size)");
            }
        }
        Logger("STORAGE == DB :" + file.path + "", LOG_LEVEL_VERBOSE);
        caches[dK] = { storageMtime, docMtime };
        return caches;

    }

    async updateIntoDB(file: TFile, initialScan?: boolean, cache?: CacheData, force?: boolean) {
        if (!await this.isTargetFile(file)) return true;
        if (shouldBeIgnored(file.path)) {
            return true;
        }
        let content: Blob;
        let datatype: "plain" | "newnote" = "newnote";
        if (!cache) {
            if (!isPlainText(file.name)) {
                Logger(`Reading   : ${file.path}`, LOG_LEVEL_VERBOSE);
                const contentBin = await this.vaultAccess.vaultReadBinary(file);
                Logger(`Processing: ${file.path}`, LOG_LEVEL_VERBOSE);
                try {
                    content = createBinaryBlob(contentBin);
                } catch (ex) {
                    Logger(`The file ${file.path} could not be encoded`);
                    Logger(ex, LOG_LEVEL_VERBOSE);
                    return false;
                }
                datatype = "newnote";
            } else {
                content = createTextBlob(await this.vaultAccess.vaultRead(file));
                datatype = "plain";
            }
        } else {
            if (cache instanceof ArrayBuffer) {
                Logger(`Cache Processing: ${file.path}`, LOG_LEVEL_VERBOSE);
                try {
                    content = createBinaryBlob(cache);
                } catch (ex) {
                    Logger(`The file ${file.path} could not be encoded`);
                    Logger(ex, LOG_LEVEL_VERBOSE);
                    return false;
                }
                datatype = "newnote"
            } else {
                content = createTextBlob(cache);
                datatype = "plain";
            }
        }
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
        };
        //upsert should locked
        const msg = `STORAGE -> DB (${datatype}) `;
        const isNotChanged = await serialized("file-" + fullPath, async () => {
            if (this.vaultAccess.recentlyTouched(file)) {
                return true;
            }
            try {
                const old = await this.localDatabase.getDBEntry(fullPath, null, false, false);
                if (old !== false) {
                    const oldData = { data: old.data, deleted: old._deleted || old.deleted };
                    const newData = { data: d.data, deleted: d._deleted || d.deleted };
                    if (oldData.deleted != newData.deleted) return false;
                    if (!await isDocContentSame(old.data, newData.data)) return false;
                    Logger(msg + "Skipped (not changed) " + fullPath + ((d._deleted || d.deleted) ? " (deleted)" : ""), LOG_LEVEL_VERBOSE);
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
        const ret = await this.localDatabase.putDBEntry(d, initialScan);

        Logger(msg + fullPath);
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
        return ret != false;
    }

    async deleteFromDB(file: TFile) {
        if (!await this.isTargetFile(file)) return;
        const fullPath = getPathFromTFile(file);
        Logger(`deleteDB By path:${fullPath}`);
        await this.deleteFromDBbyPath(fullPath);
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
    }

    async deleteFromDBbyPath(fullPath: FilePath) {
        await this.localDatabase.deleteDBEntry(fullPath);
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
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

    async ensureDirectoryEx(fullPath: string) {
        const pathElements = fullPath.split("/");
        pathElements.pop();
        let c = "";
        for (const v of pathElements) {
            c += v;
            try {
                await this.app.vault.adapter.mkdir(c);
            } catch (ex) {
                // basically skip exceptions.
                if (ex.message && ex.message == "Folder already exists.") {
                    // especially this message is.
                } else {
                    Logger("Folder Create Error");
                    Logger(ex);
                }
            }
            c += "/";
        }
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
        if (!("_conflicts" in doc)) return false;
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
        await this.localDatabase.removeRaw(id, delRev);
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
            return this.ignoreFileCache.get(path);
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
            const remoteDBConn = await this.getReplicator().connectRemoteCouchDBWithSetting(this.settings, this.isMobile)
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
            this.getReplicator().markRemoteLocked(this.settings, true, true);
            const remoteDBConn = await this.getReplicator().connectRemoteCouchDBWithSetting(this.settings, this.isMobile)
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


    askInPopup(key: string, dialogText: string, anchorCallback: (anchor: HTMLAnchorElement) => void) {

        const fragment = createFragment((doc) => {

            const [beforeText, afterText] = dialogText.split("{HERE}", 2);
            doc.createEl("span", null, (a) => {
                a.appendText(beforeText);
                a.appendChild(a.createEl("a", null, (anchor) => {
                    anchorCallback(anchor);
                }));

                a.appendText(afterText);
            });
        });
        const popupKey = "popup-" + key;
        scheduleTask(popupKey, 1000, async () => {
            const popup = await memoIfNotExist(popupKey, () => new Notice(fragment, 0));
            //@ts-ignore
            const isShown = popup?.noticeEl?.isShown();
            if (!isShown) {
                memoObject(popupKey, new Notice(fragment, 0));
            }
            scheduleTask(popupKey + "-close", 20000, () => {
                const popup = retrieveMemoObject<Notice>(popupKey);
                if (!popup)
                    return;
                //@ts-ignore
                if (popup?.noticeEl?.isShown()) {
                    popup.hide();
                }
                disposeMemoObject(popupKey);
            });
        });
    }
}

