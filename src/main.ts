const isDebug = false;

import { type Diff, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from "./deps";
import { debounce, Notice, Plugin, TFile, addIcon, TFolder, normalizePath, TAbstractFile, Editor, MarkdownView, type RequestUrlParam, type RequestUrlResponse, requestUrl } from "./deps";
import { type EntryDoc, type LoadedEntry, type ObsidianLiveSyncSettings, type diff_check_result, type diff_result_leaf, type EntryBody, LOG_LEVEL, VER, DEFAULT_SETTINGS, type diff_result, FLAGMD_REDFLAG, SYNCINFO_ID, SALT_OF_PASSPHRASE, type ConfigPassphraseStore, type CouchDBConnection, FLAGMD_REDFLAG2, FLAGMD_REDFLAG3, PREFIXMD_LOGFILE, type DatabaseConnectingStatus, type EntryHasPath, type DocumentID, type FilePathWithPrefix, type FilePath, type AnyEntry } from "./lib/src/types";
import { type InternalFileInfo, type queueItem, type CacheData, type FileEventItem, FileWatchEventQueueMax } from "./types";
import { arrayToChunkedArray, getDocData, isDocContentSame } from "./lib/src/utils";
import { Logger, setGlobalLogFunction } from "./lib/src/logger";
import { PouchDB } from "./lib/src/pouchdb-browser.js";
import { ConflictResolveModal } from "./ConflictResolveModal";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { DocumentHistoryModal } from "./DocumentHistoryModal";
import { applyPatch, cancelAllPeriodicTask, cancelAllTasks, cancelTask, generatePatchObj, id2path, isObjectMargeApplicable, isSensibleMargeApplicable, flattenObject, path2id, scheduleTask, tryParseJSON, createFile, modifyFile, isValidPath, getAbstractFileByPath, touch, recentlyTouched, isInternalMetadata, isPluginMetadata, stripInternalMetadataPrefix, isChunk, askSelectString, askYesNo, askString, PeriodicProcessor, clearTouched, getPath, getPathWithoutPrefix, getPathFromTFile, localDatabaseCleanUp, balanceChunks, performRebuildDB } from "./utils";
import { encrypt, tryDecrypt } from "./lib/src/e2ee_v2";
import { enableEncryption, isCloudantURI, isErrorOfMissingDoc, isValidRemoteCouchDBURI } from "./lib/src/utils_couchdb";
import { getGlobalStore, ObservableStore, observeStores } from "./lib/src/store";
import { lockStore, logMessageStore, logStore, type LogEntry } from "./lib/src/stores";
import { setNoticeClass } from "./lib/src/wrapper";
import { base64ToString, versionNumberString2Number, base64ToArrayBuffer, arrayBufferToBase64 } from "./lib/src/strbin";
import { addPrefix, isPlainText, shouldBeIgnored, stripAllPrefixes } from "./lib/src/path";
import { runWithLock } from "./lib/src/lock";
import { Semaphore } from "./lib/src/semaphore";
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
import { mapAllTasksWithConcurrencyLimit, processAllTasksWithConcurrencyLimit } from "./lib/src/task";

setNoticeClass(Notice);

// DI the log again.
setGlobalLogFunction((message: any, level?: LOG_LEVEL, key?: string) => {
    const entry = { message, level, key } as LogEntry;
    logStore.push(entry);
});
logStore.intercept(e => e.slice(Math.min(e.length - 200, 0)));

export default class ObsidianLiveSyncPlugin extends Plugin
    implements LiveSyncLocalDBEnv, LiveSyncReplicatorEnv {

    settings: ObsidianLiveSyncSettings;
    localDatabase: LiveSyncLocalDB;
    replicator: LiveSyncDBReplicator;

    statusBar: HTMLElement;
    suspended: boolean;
    deviceAndVaultName: string;
    isMobile = false;
    isReady = false;
    packageVersion = "";
    manifestVersion = "";

    // addOnPluginAndTheirSettings = new PluginAndTheirSettings(this);
    addOnHiddenFileSync = new HiddenFileSync(this);
    addOnSetup = new SetupLiveSync(this);
    addOnConfigSync = new ConfigSync(this);
    addOns = [this.addOnHiddenFileSync, this.addOnSetup, this.addOnConfigSync] as LiveSyncCommands[];

    periodicSyncProcessor = new PeriodicProcessor(this, async () => await this.replicate());

    // implementing interfaces
    kvDB: KeyValueDatabase;
    last_successful_post = false;
    getLastPostFailedBySize() {
        return !this.last_successful_post;
    }

    async fetchByAPI(request: RequestUrlParam): Promise<RequestUrlResponse> {
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
            const utf8str = String.fromCharCode.apply(null, new TextEncoder().encode(`${auth.username}:${auth.password}`));
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
            fetch: async (url: string | Request, opts: RequestInit) => {
                let size = "";
                const localURL = url.toString().substring(uri.length);
                const method = opts.method ?? "GET";
                if (opts.body) {
                    const opts_length = opts.body.toString().length;
                    if (opts_length > 1000 * 1000 * 10) {
                        // over 10MB
                        if (isCloudantURI(uri)) {
                            this.last_successful_post = false;
                            Logger("This request should fail on IBM Cloudant.", LOG_LEVEL.VERBOSE);
                            throw new Error("This request should fail on IBM Cloudant.");
                        }
                    }
                    size = ` (${opts_length})`;
                }

                if (!disableRequestURI && typeof url == "string" && typeof (opts.body ?? "") == "string") {
                    const body = opts.body as string;

                    const transformedHeaders = { ...(opts.headers as Record<string, string>) };
                    if (authHeader != "") transformedHeaders["authorization"] = authHeader;
                    delete transformedHeaders["host"];
                    delete transformedHeaders["Host"];
                    delete transformedHeaders["content-length"];
                    delete transformedHeaders["Content-Length"];
                    const requestParam: RequestUrlParam = {
                        url,
                        method: opts.method,
                        body: body,
                        headers: transformedHeaders,
                        contentType: "application/json",
                        // contentType: opts.headers,
                    };

                    try {
                        const r = await this.fetchByAPI(requestParam);
                        if (method == "POST" || method == "PUT") {
                            this.last_successful_post = r.status - (r.status % 100) == 200;
                        } else {
                            this.last_successful_post = true;
                        }
                        Logger(`HTTP:${method}${size} to:${localURL} -> ${r.status}`, LOG_LEVEL.DEBUG);

                        return new Response(r.arrayBuffer, {
                            headers: r.headers,
                            status: r.status,
                            statusText: `${r.status}`,
                        });
                    } catch (ex) {
                        Logger(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL.VERBOSE);
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
                    Logger(`HTTP:${method}${size} to:${localURL} -> ${response.status}`, LOG_LEVEL.DEBUG);
                    return response;
                } catch (ex) {
                    Logger(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL.VERBOSE);
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
            enableEncryption(db, passphrase, useDynamicIterationCount);
        }
        if (skipInfo) {
            return { db: db, info: { db_name: "", doc_count: 0, update_seq: "" } };
        }
        try {
            const info = await db.info();
            return { db: db, info: info };
        } catch (ex) {
            let msg = `${ex.name}:${ex.message}`;
            if (ex.name == "TypeError" && ex.message == "Failed to fetch") {
                msg += "\n**Note** This error caused by many reasons. The only sure thing is you didn't touch the server.\nTo check details, open inspector.";
            }
            Logger(ex, LOG_LEVEL.VERBOSE);
            return msg;
        }
    }

    id2path(id: DocumentID, entry: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
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
        const destPath = addPrefix(filename, prefix);
        return await path2id(destPath, this.settings.usePathObfuscation ? this.settings.passphrase : "");
    }

    createPouchDBInstance<T>(name?: string, options?: PouchDB.Configuration.DatabaseConfiguration): PouchDB.Database<T> {
        if (this.settings.useIndexedDBAdapter) {
            options.adapter = "indexeddb";
            return new PouchDB(name + "-indexeddb", options);
        }
        return new PouchDB(name, options);
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
        await this.kvDB.destroy();
        this.kvDB = await OpenKeyValueDatabase(db.dbname + "-livesync-kv");
        this.replicator = new LiveSyncDBReplicator(this);
    }
    getReplicator() {
        return this.replicator;
    }
    replicationStat = new ObservableStore({
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

    isRedFlagRaised(): boolean {
        const redflag = getAbstractFileByPath(normalizePath(FLAGMD_REDFLAG));
        if (redflag != null) {
            return true;
        }
        return false;
    }
    isRedFlag2Raised(): boolean {
        const redflag = getAbstractFileByPath(normalizePath(FLAGMD_REDFLAG2));
        if (redflag != null) {
            return true;
        }
        return false;
    }
    async deleteRedFlag2() {
        const redflag = getAbstractFileByPath(normalizePath(FLAGMD_REDFLAG2));
        if (redflag != null) {
            await app.vault.delete(redflag, true);
        }
    }
    isRedFlag3Raised(): boolean {
        const redflag = getAbstractFileByPath(normalizePath(FLAGMD_REDFLAG3));
        if (redflag != null) {
            return true;
        }
        return false;
    }
    async deleteRedFlag3() {
        const redflag = getAbstractFileByPath(normalizePath(FLAGMD_REDFLAG3));
        if (redflag != null) {
            await app.vault.delete(redflag, true);
        }
    }

    showHistory(file: TFile | FilePathWithPrefix, id: DocumentID) {
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
            this.showHistory(targetId.path, undefined);
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
            Logger("There are no conflicted documents", LOG_LEVEL.NOTICE);
            return false;
        }
        const target = await askSelectString(this.app, "File to view History", notesList);
        if (target) {
            const targetItem = notes.find(e => e.dispPath == target);
            await this.resolveConflicted(targetItem.path);
            return true;
        }
        return false;
    }

    async resolveConflicted(target: FilePathWithPrefix) {
        if (isInternalMetadata(target)) {
            await this.addOnHiddenFileSync.resolveConflictOnInternalFile(target);
        } else if (isPluginMetadata(target)) {
            await this.resolveConflictByNewerEntry(target);
        } else {
            await this.showIfConflicted(target);
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
            Logger(`Something went wrong! The local database is not ready`, LOG_LEVEL.NOTICE);
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
                    Logger(`${FLAGMD_REDFLAG2} has been detected! Self-hosted LiveSync suspends all sync and rebuild everything.`, LOG_LEVEL.NOTICE);
                    await this.addOnSetup.rebuildEverything();
                    await this.deleteRedFlag2();
                    if (await askYesNo(this.app, "Do you want to disable Suspend file watching and restart obsidian now?") == "yes") {
                        this.settings.suspendFileWatching = false;
                        await this.saveSettings();
                        // @ts-ignore
                        this.app.commands.executeCommandById("app:reload")
                    }
                } else if (this.isRedFlag3Raised()) {
                    Logger(`${FLAGMD_REDFLAG3} has been detected! Self-hosted LiveSync will discard the local database and fetch everything from the remote once again.`, LOG_LEVEL.NOTICE);
                    await this.addOnSetup.fetchLocal();
                    await this.deleteRedFlag3();
                    if (await askYesNo(this.app, "Do you want to disable Suspend file watching and restart obsidian now?") == "yes") {
                        this.settings.suspendFileWatching = false;
                        await this.saveSettings();
                        // @ts-ignore
                        this.app.commands.executeCommandById("app:reload")
                    }
                } else {
                    this.settings.writeLogToTheFile = true;
                    await this.openDatabase();
                    const warningMessage = "The red flag is raised! The whole initialize steps are skipped, and any file changes are not captured.";
                    Logger(warningMessage, LOG_LEVEL.NOTICE);
                    this.setStatusBarText(warningMessage);
                }
            } else {
                if (this.settings.suspendFileWatching) {
                    Logger("'Suspend file watching' turned on. Are you sure this is what you intended? Every modification on the vault will be ignored.", LOG_LEVEL.NOTICE);
                }
                const isInitialized = await this.initializeDatabase(false, false);
                if (!isInitialized) {
                    //TODO:stop all sync.
                    return false;
                }
            }
            await this.realizeSettingSyncMode();
            this.registerWatchEvents();
            if (this.settings.syncOnStart) {
                this.replicator.openReplication(this.settings, false, false);
            }
            this.scanStat();
        } catch (ex) {
            Logger("Error while loading Self-hosted LiveSync", LOG_LEVEL.NOTICE);
            Logger(ex, LOG_LEVEL.VERBOSE);
        }
    }

    /**
     * Scan status 
     */
    async scanStat() {
        const notes: { path: string, mtime: number }[] = [];
        Logger(`Additional safety scan..`, LOG_LEVEL.VERBOSE);
        for await (const doc of this.localDatabase.findAllDocs({ conflicts: true })) {
            if (!("_conflicts" in doc)) continue;
            notes.push({ path: this.getPath(doc), mtime: doc.mtime });
        }
        if (notes.length > 0) {
            Logger(`Some files have been left conflicted! Please resolve them by "Pick a file to resolve conflict". The list is written in the log.`, LOG_LEVEL.NOTICE);
            for (const note of notes) {
                Logger(`Conflicted: ${note.path}`);
            }
        } else {
            Logger(`There are no conflicted files`, LOG_LEVEL.VERBOSE);
        }
        Logger(`Additional safety scan done`, LOG_LEVEL.VERBOSE);
    }

    async onload() {
        logStore.subscribe(e => this.addLog(e.message, e.level, e.key));
        Logger("loading plugin");
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

        const lastVersion = ~~(versionNumberString2Number(manifestVersion) / 1000);
        if (lastVersion > this.settings.lastReadUpdates) {
            Logger("Self-hosted LiveSync has undergone a major upgrade. Please open the setting dialog, and check the information pane.", LOG_LEVEL.NOTICE);
        }
        //@ts-ignore
        if (this.app.isMobile) {
            this.isMobile = true;
            this.settings.disableRequestURI = true;
        }
        if (last_version && Number(last_version) < VER) {
            this.settings.liveSync = false;
            this.settings.syncOnSave = false;
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

        this.parseReplicationResult = this.parseReplicationResult.bind(this);

        this.loadQueuedFiles = this.loadQueuedFiles.bind(this);

        this.triggerRealizeSettingSyncMode = debounce(this.triggerRealizeSettingSyncMode.bind(this), 1000);

        this.statusBar = this.addStatusBarItem();
        this.statusBar.addClass("syncstatusbar");

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
        await Promise.all(this.addOns.map(e => e.onload()));
        this.addRibbonIcon("replicate", "Replicate", async () => {
            await this.replicate(true);
        });

        this.addRibbonIcon("view-log", "Show log", () => {
            this.showView(VIEW_TYPE_LOG);
        });

        this.addSettingTab(new ObsidianLiveSyncSettingTab(this.app, this));
        this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));

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
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.localDatabase.getDBEntry(getPathFromTFile(view.file), {}, true, false);
            },
        });
        this.addCommand({
            id: "livesync-checkdoc-conflicted",
            name: "Resolve if conflicted.",
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                await this.showIfConflicted(getPathFromTFile(view.file));
            },
        });

        this.addCommand({
            id: "livesync-toggle",
            name: "Toggle LiveSync",
            callback: async () => {
                if (this.settings.liveSync) {
                    this.settings.liveSync = false;
                    Logger("LiveSync Disabled.", LOG_LEVEL.NOTICE);
                } else {
                    this.settings.liveSync = true;
                    Logger("LiveSync Enabled.", LOG_LEVEL.NOTICE);
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
                    Logger("Self-hosted LiveSync resumed", LOG_LEVEL.NOTICE);
                } else {
                    this.suspended = true;
                    Logger("Self-hosted LiveSync suspended", LOG_LEVEL.NOTICE);
                }
                await this.realizeSettingSyncMode();
                this.saveSettings();
            },
        });
        this.addCommand({
            id: "livesync-history",
            name: "Show history",
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.showHistory(view.file, null);
            },
        });
        this.addCommand({
            id: "livesync-scan-files",
            name: "Scan storage and database again",
            callback: async () => {
                await this.syncAllFiles(true)
            }
        })

        this.triggerRealizeSettingSyncMode = debounce(this.triggerRealizeSettingSyncMode.bind(this), 1000);

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

        this.registerView(
            VIEW_TYPE_GLOBAL_HISTORY,
            (leaf) => new GlobalHistoryView(leaf, this)
        );
        this.registerView(
            VIEW_TYPE_LOG,
            (leaf) => new LogPaneView(leaf, this)
        );
        this.addCommand({
            id: "livesync-global-history",
            name: "Show vault history",
            callback: () => {
                this.showGlobalHistory()
            }
        })
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
        cancelAllPeriodicTask();
        cancelAllTasks();
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
        this.observeForLogs();
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
            Logger("Could not determine passphrase to save data.json! You probably make the configuration sure again!", LOG_LEVEL.URGENT);
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
            Logger("Could not determine passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL.URGENT);
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
                    Logger("Could not decrypt passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL.URGENT);
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
                    Logger("Could not decrypt passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL.URGENT);
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
            Logger("Configuration verification founds problems with your configuration. This has been fixed automatically. But you may already have data that cannot be synchronised. If this is the case, please rebuild everything.", LOG_LEVEL.NOTICE)
            this.settings.customChunkSize = 0;
        }
        this.deviceAndVaultName = localStorage.getItem(lsKey) || "";
    }

    triggerRealizeSettingSyncMode() {
        (async () => await this.realizeSettingSyncMode())();
    }

    async saveSettings() {
        const lsKey = "obsidian-live-sync-vaultanddevicename-" + this.getVaultName();

        localStorage.setItem(lsKey, this.deviceAndVaultName || "");
        const settings = { ...this.settings };
        if (this.usedPassphrase == "" && !await this.getPassphrase(settings)) {
            Logger("Could not determine passphrase for saving data.json! Our data.json have insecure items!", LOG_LEVEL.NOTICE);
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
        this.triggerRealizeSettingSyncMode();
    }

    vaultManager: StorageEventManager;
    registerFileWatchEvents() {
        this.vaultManager = new StorageEventManagerObsidian(this)
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

    async procFileEvent(applyBatch?: boolean) {
        if (!this.isReady) return;
        if (this.settings.batchSave && !this.settings.liveSync) {
            if (!applyBatch && this.vaultManager.getQueueLength() < FileWatchEventQueueMax) {
                // Defer till applying batch save or queue has been grown enough.
                // or 30 seconds after.
                scheduleTask("applyBatchAuto", 30000, () => {
                    this.procFileEvent(true);
                })
                return;
            }
        }
        cancelTask("applyBatchAuto");
        const ret = await runWithLock("procFiles", true, async () => {
            do {
                const queue = this.vaultManager.fetchEvent();
                if (queue === false) break;
                if (queue === undefined) break;
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
                    const targetFile = this.app.vault.getAbstractFileByPath(file.path);
                    if (!(targetFile instanceof TFile)) {
                        Logger(`Target file was not found: ${file.path}`, LOG_LEVEL.INFO);
                        continue;
                    }
                    //TODO: check from cache time.
                    if (file.mtime == last) {
                        Logger(`File has been already scanned on ${queue.type}, skip: ${file.path}`, LOG_LEVEL.VERBOSE);
                        continue;
                    }

                    const cache = queue.args.cache;
                    if (queue.type == "CREATE" || queue.type == "CHANGED") {
                        const keyD1 = `file-last-proc-DELETED-${file.path}`;
                        await this.kvDB.set(keyD1, mtime);
                        if (!await this.updateIntoDB(targetFile, false, cache)) {
                            Logger(`DB -> STORAGE: failed, cancel the relative operations: ${targetFile.path}`, LOG_LEVEL.INFO);
                            // cancel running queues and remove one of atomic operation
                            this.vaultManager.cancelRelativeEvent(queue);
                            continue;
                        }
                    }
                    if (queue.type == "RENAME") {
                        // Obsolete
                        await this.watchVaultRenameAsync(targetFile, queue.args.oldPath);
                    }
                }
                await this.kvDB.set(key, mtime);
            } while (this.vaultManager.getQueueLength() > 0);
            return true;
        })
        return ret;
    }


    watchWorkspaceOpen(file: TFile) {
        if (this.settings.suspendFileWatching) return;
        if (!this.isReady) return;
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
        await this.showIfConflicted(getPathFromTFile(file));
    }

    async applyBatchChange() {
        if (this.settings.batchSave && !this.settings.liveSync) {
            return await this.procFileEvent(true);
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
        Logger(`${oldFile} renamed to ${file.path}`, LOG_LEVEL.VERBOSE);
        if (file instanceof TFile) {
            try {
                // Logger(`RENAMING.. ${file.path} into db`);
                if (await this.updateIntoDB(file, false, cache)) {
                    // Logger(`deleted ${oldFile} from db`);
                    await this.deleteFromDBbyPath(oldFile);
                } else {
                    Logger(`Could not save new file: ${file.path} `, LOG_LEVEL.NOTICE);
                }
            } catch (ex) {
                Logger(ex);
            }
        }
    }

    //--> Basic document Functions
    notifies: { [key: string]: { notice: Notice; timer: ReturnType<typeof setTimeout>; count: number } } = {};

    lastLog = "";
    // eslint-disable-next-line require-await
    async addLog(message: any, level: LOG_LEVEL = LOG_LEVEL.INFO, key = "") {
        if (level == LOG_LEVEL.DEBUG && !isDebug) {
            return;
        }
        if (level < LOG_LEVEL.INFO && this.settings && this.settings.lessInformationInLog) {
            return;
        }
        if (this.settings && !this.settings.showVerboseLog && level == LOG_LEVEL.VERBOSE) {
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
        if (this.settings?.writeLogToTheFile) {
            const time = now.toISOString().split("T")[0];
            const logDate = `${PREFIXMD_LOGFILE}${time}.md`;
            const file = this.app.vault.getAbstractFileByPath(normalizePath(logDate));
            if (!file) {
                this.app.vault.adapter.append(normalizePath(logDate), "```\n");
            }
            this.app.vault.adapter.append(normalizePath(logDate), vaultName + ":" + newMessage + "\n");
        }
        logMessageStore.apply(e => [...e, newMessage].slice(-100));
        this.setStatusBarText(null, messageContent);

        if (level >= LOG_LEVEL.NOTICE) {
            if (!key) key = messageContent;
            if (key in this.notifies) {
                // @ts-ignore
                const isShown = this.notifies[key].notice.noticeEl?.isShown()
                if (!isShown) {
                    this.notifies[key].notice = new Notice(messageContent, 0);
                }
                clearTimeout(this.notifies[key].timer);
                if (key == messageContent) {
                    this.notifies[key].count++;
                    this.notifies[key].notice.setMessage(`(${this.notifies[key].count}):${messageContent}`);
                } else {
                    this.notifies[key].notice.setMessage(`${messageContent}`);
                }

                this.notifies[key].timer = setTimeout(() => {
                    const notify = this.notifies[key].notice;
                    delete this.notifies[key];
                    try {
                        notify.hide();
                    } catch (ex) {
                        // NO OP
                    }
                }, 5000);
            } else {
                const notify = new Notice(messageContent, 0);
                this.notifies[key] = {
                    count: 0,
                    notice: notify,
                    timer: setTimeout(() => {
                        delete this.notifies[key];
                        notify.hide();
                    }, 5000),
                };
            }
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

    async doc2storage(docEntry: EntryBody, file?: TFile, force?: boolean) {
        const mode = file == undefined ? "create" : "modify";

        const path = this.getPath(docEntry);
        if (shouldBeIgnored(path)) {
            return;
        }
        if (!this.isTargetFile(path)) return;
        if (docEntry._deleted || docEntry.deleted) {
            // This occurs not only when files are deleted, but also when conflicts are resolved.
            // We have to check no other revisions are left.
            const lastDocs = await this.localDatabase.getDBEntry(path);
            if (path != file.path) {
                Logger(`delete skipped: ${file.path} :Not exactly matched`, LOG_LEVEL.VERBOSE);
            }
            if (lastDocs === false) {
                await this.deleteVaultItem(file);
            } else {
                // it perhaps delete some revisions.
                // may be we have to reload this
                await this.pullFile(path, null, true);
                Logger(`delete skipped:${file.path}`, LOG_LEVEL.VERBOSE);
            }
            return;
        }
        const localMtime = ~~((file?.stat?.mtime || 0) / 1000);
        const docMtime = ~~(docEntry.mtime / 1000);

        const doc = await this.localDatabase.getDBEntry(path, { rev: docEntry._rev });
        if (doc === false) return;
        const msg = `DB -> STORAGE (${mode}${force ? ",force" : ""},${doc.datatype}) `;
        if (doc.datatype != "newnote" && doc.datatype != "plain") {
            Logger(msg + "ERROR, Invalid datatype: " + path + "(" + doc.datatype + ")", LOG_LEVEL.NOTICE);
            return;
        }
        if (!force && localMtime >= docMtime) return;
        if (!isValidPath(path)) {
            Logger(msg + "ERROR, invalid path: " + path, LOG_LEVEL.NOTICE);
            return;
        }
        const writeData = doc.datatype == "newnote" ? base64ToArrayBuffer(doc.data) : getDocData(doc.data);
        await this.ensureDirectoryEx(path);
        try {
            let outFile;
            if (mode == "create") {
                outFile = await createFile(normalizePath(path), writeData, { ctime: doc.ctime, mtime: doc.mtime, });
            } else {
                await modifyFile(file, writeData, { ctime: doc.ctime, mtime: doc.mtime });
                outFile = getAbstractFileByPath(getPathFromTFile(file)) as TFile;
            }
            Logger(msg + path);
            touch(outFile);
            this.app.vault.trigger(mode, outFile);

        } catch (ex) {
            Logger(msg + "ERROR, Could not write: " + path, LOG_LEVEL.NOTICE);
            Logger(ex, LOG_LEVEL.VERBOSE);
        }
    }

    async deleteVaultItem(file: TFile | TFolder) {
        if (file instanceof TFile) {
            if (!this.isTargetFile(file)) return;
        }
        const dir = file.parent;
        if (this.settings.trashInsteadDelete) {
            await this.app.vault.trash(file, false);
        } else {
            await this.app.vault.delete(file);
        }
        Logger(`xxx <- STORAGE (deleted) ${file.path}`);
        Logger(`files: ${dir.children.length}`);
        if (dir.children.length == 0) {
            if (!this.settings.doNotDeleteFolder) {
                Logger(`All files under the parent directory (${dir}) have been deleted, so delete this one.`);
                await this.deleteVaultItem(dir);
            }
        }
    }


    queuedEntries: EntryBody[] = [];
    dbChangeProcRunning = false;
    handleDBChanged(change: EntryBody) {
        // If the file is opened, we have to apply immediately
        const af = app.workspace.getActiveFile();
        if (af && af.path == this.getPath(change)) {
            this.queuedEntries = this.queuedEntries.filter(e => e._id != change._id);
            return this.handleDBChangedAsync(change);
        }
        this.queuedEntries.push(change);
        this.execDBchanged();
    }
    async execDBchanged() {
        if (this.dbChangeProcRunning) return false;
        this.dbChangeProcRunning = true;
        const semaphore = Semaphore(4);
        try {
            do {
                const entry = this.queuedEntries.shift();
                // If the same file is to be manipulated, leave it to the last process.
                if (this.queuedEntries.some(e => e._id == entry._id)) continue;
                const path = getPath(entry);
                try {
                    const releaser = await semaphore.acquire(1);
                    runWithLock(`dbchanged-${path}`, false, async () => {
                        Logger(`Applying ${path} (${entry._id}: ${entry._rev}) change...`, LOG_LEVEL.VERBOSE);
                        await this.handleDBChangedAsync(entry);
                        Logger(`Applied ${path} (${entry._id}:${entry._rev}) change...`);
                    }).finally(() => { releaser(); });
                } catch (ex) {
                    Logger(`Failed to apply the change of ${path} (${entry._id}:${entry._rev})`);
                }
            } while (this.queuedEntries.length > 0);
        } finally {
            this.dbChangeProcRunning = false;
        }
    }
    async handleDBChangedAsync(change: EntryBody) {

        const targetFile = getAbstractFileByPath(this.getPathWithoutPrefix(change));
        if (targetFile == null) {
            if (change._deleted || change.deleted) {
                return;
            }
            const doc = change;
            await this.doc2storage(doc);
        } else if (targetFile instanceof TFile) {
            const doc = change;
            const file = targetFile;
            const queueConflictCheck = () => {
                if (!this.settings.checkConflictOnlyOnOpen) {
                    this.queueConflictedCheck(file);
                    return true;
                } else {
                    const af = app.workspace.getActiveFile();
                    if (af && af.path == file.path) {
                        this.queueConflictedCheck(file);
                        return true;
                    }
                }
                return false;
            }
            if (this.settings.writeDocumentsIfConflicted) {
                await this.doc2storage(doc, file);
                queueConflictCheck();
            } else {
                const d = await this.localDatabase.getDBEntryMeta(this.getPath(change), { conflicts: true }, true);
                if (d && !d._conflicts) {
                    await this.doc2storage(doc, file);
                } else {
                    if (!queueConflictCheck()) {
                        Logger(`${this.getPath(change)} is conflicted, write to the storage has been pended.`, LOG_LEVEL.NOTICE);
                    }
                }
            }
        } else {
            Logger(`${this.getPath(change)} is already exist as the folder`);
        }
    }

    queuedFiles = [] as queueItem[];
    queuedFilesStore = getGlobalStore("queuedFiles", { queuedItems: [] as queueItem[], fileEventItems: [] as FileEventItem[] });
    chunkWaitTimeout = 60000;

    saveQueuedFiles() {
        const saveData = JSON.stringify(this.queuedFiles.filter((e) => !e.done).map((e) => e.entry._id));
        const lsKey = "obsidian-livesync-queuefiles-" + this.getVaultName();
        localStorage.setItem(lsKey, saveData);
    }
    async loadQueuedFiles() {
        const lsKey = "obsidian-livesync-queuefiles-" + this.getVaultName();
        const ids = JSON.parse(localStorage.getItem(lsKey) || "[]") as string[];
        const ret = await this.localDatabase.allDocsRaw<EntryDoc>({ keys: ids, include_docs: true });
        for (const doc of ret.rows) {
            if (doc.doc && !this.queuedFiles.some((e) => e.entry._id == doc.doc._id)) {
                await this.parseIncomingDoc(doc.doc as PouchDB.Core.ExistingDocument<EntryBody & PouchDB.Core.AllDocsMeta>);
            }
        }
    }

    procQueuedFiles() {

        this.saveQueuedFiles();
        for (const queue of this.queuedFiles) {
            if (queue.done) continue;
            const now = new Date().getTime();
            if (queue.missingChildren.length == 0) {
                queue.done = true;
                if (isInternalMetadata(queue.entry._id)) {
                    //system file
                    const filename = this.getPathWithoutPrefix(queue.entry);
                    this.addOnHiddenFileSync.procInternalFile(filename);
                } else if (isValidPath(this.getPath(queue.entry))) {
                    this.handleDBChanged(queue.entry);
                } else {
                    Logger(`Skipped: ${queue.entry._id}`, LOG_LEVEL.VERBOSE);
                }
            } else if (now > queue.timeout) {
                if (!queue.warned) Logger(`Timed out: ${queue.entry._id} could not collect ${queue.missingChildren.length} chunks. plugin keeps watching, but you have to check the file after the replication.`, LOG_LEVEL.NOTICE);
                queue.warned = true;
                continue;
            }
        }
        this.queuedFiles = this.queuedFiles.filter((e) => !e.done);
        this.queuedFilesStore.apply((value) => ({ ...value, queuedItems: this.queuedFiles }));
        this.saveQueuedFiles();
    }
    parseIncomingChunk(chunk: PouchDB.Core.ExistingDocument<EntryDoc>) {
        const now = new Date().getTime();
        let isNewFileCompleted = false;

        for (const queue of this.queuedFiles) {
            if (queue.done) continue;
            if (queue.missingChildren.indexOf(chunk._id) !== -1) {
                queue.missingChildren = queue.missingChildren.filter((e) => e != chunk._id);
                queue.timeout = now + this.chunkWaitTimeout;
            }
            if (queue.missingChildren.length == 0) {
                for (const e of this.queuedFiles) {
                    if (e.entry._id == queue.entry._id && e.entry.mtime < queue.entry.mtime) {
                        e.done = true;
                    }
                }
                isNewFileCompleted = true;
            }
        }
        if (isNewFileCompleted) this.procQueuedFiles();
    }
    async parseIncomingDoc(doc: PouchDB.Core.ExistingDocument<EntryBody>) {
        const path = this.getPath(doc);
        if (!this.isTargetFile(path)) return;
        const skipOldFile = this.settings.skipOlderFilesOnSync && false; //patched temporary.
        // Do not handle internal files if the feature has not been enabled.
        if (isInternalMetadata(doc._id) && !this.settings.syncInternalFiles) return;
        // It is better for your own safety, not to handle the following files
        const ignoreFiles = [
            "_design/replicate",
            FLAGMD_REDFLAG,
            FLAGMD_REDFLAG2,
            FLAGMD_REDFLAG3
        ];
        if (!isInternalMetadata(doc._id) && ignoreFiles.contains(path)) {
            return;

        }
        if ((!isInternalMetadata(doc._id)) && skipOldFile) {
            const info = getAbstractFileByPath(stripAllPrefixes(path));

            if (info && info instanceof TFile) {
                const localMtime = ~~(info.stat.mtime / 1000);
                const docMtime = ~~(doc.mtime / 1000);
                //TODO: some margin required.
                if (localMtime >= docMtime) {
                    Logger(`${path} (${doc._id}, ${doc._rev}) Skipped, older than storage.`, LOG_LEVEL.VERBOSE);
                    return;
                }
            }
        }
        const now = new Date().getTime();
        const newQueue = {
            entry: doc,
            missingChildren: [] as string[],
            timeout: now + this.chunkWaitTimeout,
        };
        // If `Read chunks online` is disabled, chunks should be transferred before here.
        // However, in some cases, chunks are after that. So, if missing chunks exist, we have to wait for them.
        if ((!this.settings.readChunksOnline) && "children" in doc) {
            const c = await this.localDatabase.collectChunksWithCache(doc.children as DocumentID[]);
            const missing = c.filter((e) => e.chunk === false).map((e) => e.id);
            if (missing.length > 0) Logger(`${path} (${doc._id}, ${doc._rev}) Queued (waiting ${missing.length} items)`, LOG_LEVEL.VERBOSE);
            newQueue.missingChildren = missing;
            this.queuedFiles.push(newQueue);
        } else {
            this.queuedFiles.push(newQueue);
        }
        this.saveQueuedFiles();
        this.procQueuedFiles();
    }

    //---> Sync
    async parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): Promise<void> {
        const docsSorted = docs.sort((a: any, b: any) => b?.mtime ?? 0 - a?.mtime ?? 0);
        L1:
        for (const change of docsSorted) {
            if (isChunk(change._id)) {
                await this.parseIncomingChunk(change);
                continue;
            }
            for (const proc of this.addOns) {
                if (await proc.parseReplicationResultItem(change)) {
                    continue L1;
                }
            }
            if (change._id == SYNCINFO_ID) {
                continue;
            }
            if (change.type != "leaf" && change.type != "versioninfo" && change.type != "milestoneinfo" && change.type != "nodeinfo") {
                await this.parseIncomingDoc(change);
                continue;
            }
            if (change.type == "versioninfo") {
                if (change.version > VER) {
                    this.replicator.closeReplication();
                    Logger(`Remote database updated to incompatible version. update your self-hosted-livesync plugin.`, LOG_LEVEL.NOTICE);
                }
            }
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
        if (this.settings.liveSync) {
            this.replicator.openReplication(this.settings, true, false);
        }

        this.periodicSyncProcessor.enable(this.settings.periodicReplication ? this.settings.periodicReplicationInterval * 1000 : 0);


    }

    lastMessage = "";

    observeForLogs() {
        const observer__ = observeStores(this.queuedFilesStore, lockStore);
        const observer = observeStores(observer__, this.replicationStat);

        observer.observe(e => {
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
            this.statusBar.title = e.syncStatus;
            let waiting = "";
            if (this.settings.batchSave && !this.settings.liveSync) {
                const len = this.vaultManager?.getQueueLength();
                if (len != 0) {
                    waiting = ` 🛫${len}`;
                }
            }
            let queued = "";
            const queue = Object.entries(e.queuedItems).filter((e) => !e[1].warned);
            const queuedCount = queue.length;

            if (queuedCount) {
                const pieces = queue.map((e) => e[1].missingChildren).reduce((prev, cur) => prev + cur.length, 0);
                queued = ` 🧩${queuedCount} (${pieces})`;
            }
            const processes = e.count;
            const processesDisp = processes == 0 ? "" : ` ⏳${processes}`;
            const message = `Sync: ${w} ↑${sent}${pushLast} ↓${arrived}${pullLast}${waiting}${processesDisp}${queued}`;
            function getProcKind(proc: string) {
                const p = proc.indexOf("-");
                if (p == -1) {
                    return proc;
                }
                return proc.substring(0, p);
            }

            const pendingTask = e.pending.length
                ? e.pending.length < 10 ? ("\nPending: " +
                    Object.entries(e.pending.reduce((p, c) => ({ ...p, [getProcKind(c)]: (p[getProcKind(c)] ?? 0) + 1 }), {} as { [key: string]: number }))
                        .map((e) => `${e[0]}${e[1] == 1 ? "" : `(${e[1]})`}`)
                        .join(", ")
                ) : `\n Pending: ${e.pending.length}` : "";

            const runningTask = e.running.length
                ? e.running.length < 10 ? ("\nRunning: " +
                    Object.entries(e.running.reduce((p, c) => ({ ...p, [getProcKind(c)]: (p[getProcKind(c)] ?? 0) + 1 }), {} as { [key: string]: number }))
                        .map((e) => `${e[0]}${e[1] == 1 ? "" : `(${e[1]})`}`)
                        .join(", ")
                ) : `\n Running: ${e.running.length}` : "";
            this.setStatusBarText(message + pendingTask + runningTask);
        })
    }

    refreshStatusText() {
        return;
    }

    setStatusBarText(message: string = null, log: string = null) {
        if (!this.statusBar) return;
        const newMsg = typeof message == "string" ? message : this.lastMessage;
        const newLog = typeof log == "string" ? log : this.lastLog;
        if (`${this.lastMessage}-${this.lastLog}` != `${newMsg}-${newLog}`) {
            scheduleTask("update-display", 50, () => {
                this.statusBar.setText(newMsg.split("\n")[0]);

                if (this.settings.showStatusOnEditor) {
                    const root = activeDocument.documentElement;
                    const q = root.querySelectorAll(`.CodeMirror-wrap,.cm-s-obsidian>.cm-editor,.canvas-wrapper`);
                    q.forEach(e => e.setAttr("data-log", '' + (newMsg + "\n" + newLog) + ''))
                } else {
                    const root = activeDocument.documentElement;
                    const q = root.querySelectorAll(`.CodeMirror-wrap,.cm-s-obsidian>.cm-editor,.canvas-wrapper`);
                    q.forEach(e => e.setAttr("data-log", ''))
                }
            }, true);
            scheduleTask("log-hide", 3000, () => this.setStatusBarText(null, ""));
            this.lastMessage = newMsg;
            this.lastLog = newLog;
        }
    }
    updateStatusBarText() { }

    async replicate(showMessage?: boolean) {
        if (!this.isReady) return;
        if (this.settings.versionUpFlash != "") {
            Logger("Open settings and check message, please.", LOG_LEVEL.NOTICE);
            return;
        }
        await this.applyBatchChange();
        await Promise.all(this.addOns.map(e => e.beforeReplicate(showMessage)));
        await this.loadQueuedFiles();
        const ret = await this.replicator.openReplication(this.settings, false, showMessage);
        if (!ret) {
            if (this.replicator.remoteLockedAndDeviceNotAccepted) {
                if (this.replicator.remoteCleaned) {
                    const message = `
The remote database has been cleaned up.
To synchronize, this device must also be cleaned up or fetch everything again once.
Fetching may takes some time. Cleaning up is not stable yet but fast.
`
                    const CHOICE_CLEANUP = "Clean up";
                    const CHOICE_FETCH = "Fetch again";
                    const CHOICE_DISMISS = "Dismiss";
                    const ret = await confirmWithMessage(this, "Locked", message, [CHOICE_CLEANUP, CHOICE_FETCH, CHOICE_DISMISS], CHOICE_DISMISS, 10);
                    if (ret == CHOICE_CLEANUP) {
                        await localDatabaseCleanUp(this, true, false);
                        await balanceChunks(this, false);
                    }
                    if (ret == CHOICE_FETCH) {
                        await performRebuildDB(this, "localOnly");
                    }
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
            await this.procFileEvent(true);
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

    async syncAllFiles(showingNotice?: boolean) {
        // synchronize all files between database and storage.
        let initialScan = false;
        if (showingNotice) {
            Logger("Initializing", LOG_LEVEL.NOTICE, "syncAll");
        }

        Logger("Initialize and checking database files");
        Logger("Checking deleted files");
        await this.collectDeletedFiles();

        Logger("Collecting local files on the storage", LOG_LEVEL.VERBOSE);
        const filesStorage = this.app.vault.getFiles().filter(e => this.isTargetFile(e));
        const filesStorageName = filesStorage.map((e) => e.path);
        Logger("Collecting local files on the DB", LOG_LEVEL.VERBOSE);
        const filesDatabase = [] as FilePathWithPrefix[]
        let count = 0;
        for await (const doc of this.localDatabase.findAllNormalDocs()) {
            count++;
            if (count % 25 == 0) Logger(`Collecting local files on the DB: ${count}`, showingNotice ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO, "syncAll");
            const path = getPath(doc);
            if (isValidPath(path) && this.isTargetFile(path)) {
                filesDatabase.push(path);
            }
        }
        Logger("Opening the key-value database", LOG_LEVEL.VERBOSE);
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
        this.setStatusBarText(`UPDATE DATABASE`);

        const runAll = async<T>(procedureName: string, objects: T[], callback: (arg: T) => Promise<void>) => {
            Logger(procedureName);
            if (!this.localDatabase.isReady) throw Error("Database is not ready!");
            const procs = objects.map(e => async () => {
                try {
                    await callback(e);
                    return true;
                } catch (ex) {
                    Logger(`Error while ${procedureName}`, LOG_LEVEL.NOTICE);
                    Logger(ex, LOG_LEVEL.VERBOSE);
                    return false;
                }

            });
            let success = 0;
            let failed = 0;
            for await (const v of processAllTasksWithConcurrencyLimit(10, procs)) {
                if ("ok" in v && v.ok) {
                    success++;
                } else {
                    failed++;
                }
            }
            Logger(`${procedureName}: PASS:${success}, FAILED:${failed}`);
        }

        await runAll("UPDATE DATABASE", onlyInStorage, async (e) => {
            Logger(`UPDATE DATABASE ${e.path}`);
            await this.updateIntoDB(e, initialScan);
        });
        if (!initialScan) {
            await runAll("UPDATE STORAGE", onlyInDatabase, async (e) => {
                const w = await this.localDatabase.getDBEntryMeta(e, {}, true);
                if (w && !(w.deleted || w._deleted)) {
                    Logger(`Check or pull from db:${e}`);
                    await this.pullFile(e, filesStorage, false, null, false);
                    Logger(`Check or pull from db:${e} OK`);
                } else if (w) {
                    Logger(`Deletion history skipped: ${e}`, LOG_LEVEL.VERBOSE);
                } else {
                    Logger(`entry not found: ${e}`);
                }
            });
        }
        if (!initialScan) {
            let caches: { [key: string]: { storageMtime: number; docMtime: number } } = {};
            caches = await this.kvDB.get<{ [key: string]: { storageMtime: number; docMtime: number } }>("diff-caches") || {};

            const syncFilesBatch = [...arrayToChunkedArray(syncFiles, 100)];
            const processes = syncFilesBatch.map((files, idx, total) => async () => {
                const dbEntries = await mapAllTasksWithConcurrencyLimit(10, files.map(file => async () => ({ file: file, id: await this.path2id(getPathFromTFile(file)) })));
                const dbEntriesOk = dbEntries.map(e => "ok" in e ? e.ok : undefined).filter(e => e);
                const docs = await this.localDatabase.allDocsRaw<EntryDoc>({ keys: dbEntriesOk.map(e => e.id), include_docs: true });
                const docsMap = docs.rows.reduce((p, c) => ({ ...p, [c.id]: c.doc }), {} as Record<DocumentID, EntryDoc>);
                const syncFilesToSync = dbEntriesOk.map((e) => ({ file: e.file, doc: docsMap[e.id] as LoadedEntry }));
                await runAll(`CHECK FILE STATUS:${idx + 1}/${total.length}`, syncFilesToSync, async (e) => {
                    caches = await this.syncFileBetweenDBandStorage(e.file, e.doc, initialScan, caches);
                });
            })
            await mapAllTasksWithConcurrencyLimit(2, processes);
            await this.kvDB.set("diff-caches", caches);
        }

        this.setStatusBarText(`NOW TRACKING!`);
        Logger("Initialized, NOW TRACKING!");
        if (!isInitialized) {
            await (this.kvDB.set("initialized", true))
        }
        if (showingNotice) {
            Logger("Initialize done!", LOG_LEVEL.NOTICE, "syncAll");
        }
    }

    // --> conflict resolving
    async getConflictedDoc(path: FilePathWithPrefix, rev: string): Promise<false | diff_result_leaf> {
        try {
            const doc = await this.localDatabase.getDBEntry(path, { rev: rev }, false, false, true);
            if (doc === false) return false;
            let data = getDocData(doc.data)
            if (doc.datatype == "newnote") {
                data = base64ToString(data);
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
                Logger(`MERGING PANIC:${leftItem[0]},${leftItem[1]} == ${rightItem[0]},${rightItem[1]}`, LOG_LEVEL.VERBOSE);
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
            Logger(`Weird condition:${leftItem[0]},${leftItem[1]} == ${rightItem[0]},${rightItem[1]}`, LOG_LEVEL.VERBOSE);
            // here is the exception
            break LOOP_MERGE;
        } while (leftIdx < diffLeft.length || rightIdx < diffRight.length);
        if (autoMerge) {
            Logger(`Sensibly merge available`, LOG_LEVEL.VERBOSE);
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
            Logger(ex, LOG_LEVEL.VERBOSE)
            return false;
        }
    }

    /**
     * Getting file conflicted status.
     * @param path the file location
     * @returns true -> resolved, false -> nothing to do, or check result.
     */
    async getConflictedStatus(path: FilePathWithPrefix): Promise<diff_check_result> {
        const test = await this.localDatabase.getDBEntry(path, { conflicts: true, revs_info: true }, false, false, true);
        if (test === false) return false;
        if (test == null) return false;
        if (!test._conflicts) return false;
        if (test._conflicts.length == 0) return false;
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
                        Logger(`Sensible merge:${path}`, LOG_LEVEL.INFO);
                    } else {
                        Logger(`Sensible merge is not applicable.`, LOG_LEVEL.VERBOSE);
                    }
                } else if (isObjectMargeApplicable(path)) {
                    // can be merged.
                    const result = await this.mergeObject(path, commonBase, test._rev, conflictedRev);
                    if (result) {
                        Logger(`Object merge:${path}`, LOG_LEVEL.INFO);
                        p = result;
                    } else {
                        Logger(`Object merge is not applicable.`, LOG_LEVEL.VERBOSE);
                    }
                }

                if (p != undefined) {
                    // remove conflicted revision.
                    await this.localDatabase.deleteDBEntry(path, { rev: conflictedRev });

                    const file = getAbstractFileByPath(stripAllPrefixes(path)) as TFile;
                    if (file) {
                        await this.app.vault.modify(file, p);
                        await this.updateIntoDB(file);
                    } else {
                        const newFile = await this.app.vault.create(path, p);
                        await this.updateIntoDB(newFile);
                    }
                    await this.pullFile(path);
                    Logger(`Automatically merged (sensible) :${path}`, LOG_LEVEL.INFO);
                    return true;
                }
            }
        }
        // should be one or more conflicts;
        const leftLeaf = await this.getConflictedDoc(path, test._rev);
        const rightLeaf = await this.getConflictedDoc(path, conflicts[0]);
        if (leftLeaf == false) {
            // what's going on..
            Logger(`could not get current revisions:${path}`, LOG_LEVEL.NOTICE);
            return false;
        }
        if (rightLeaf == false) {
            // Conflicted item could not load, delete this.
            await this.localDatabase.deleteDBEntry(path, { rev: conflicts[0] });
            await this.pullFile(path, null, true);
            Logger(`could not get old revisions, automatically used newer one:${path}`, LOG_LEVEL.NOTICE);
            return true;
        }
        // first, check for same contents and deletion status.
        if (leftLeaf.data == rightLeaf.data && leftLeaf.deleted == rightLeaf.deleted) {
            let leaf = leftLeaf;
            if (leftLeaf.mtime > rightLeaf.mtime) {
                leaf = rightLeaf;
            }
            await this.localDatabase.deleteDBEntry(path, { rev: leaf.rev });
            await this.pullFile(path, null, true);
            Logger(`automatically merged:${path}`);
            return true;
        }
        if (this.settings.resolveConflictsByNewerFile) {
            const lMtime = ~~(leftLeaf.mtime / 1000);
            const rMtime = ~~(rightLeaf.mtime / 1000);
            let loser = leftLeaf;
            if (lMtime > rMtime) {
                loser = rightLeaf;
            }
            await this.localDatabase.deleteDBEntry(path, { rev: loser.rev });
            await this.pullFile(path, null, true);
            Logger(`Automatically merged (newerFileResolve) :${path}`, LOG_LEVEL.NOTICE);
            return true;
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

    showMergeDialog(filename: FilePathWithPrefix, conflictCheckResult: diff_result): Promise<boolean> {
        return runWithLock("resolve-conflict:" + filename, false, () =>
            new Promise((res, rej) => {
                Logger("open conflict dialog", LOG_LEVEL.VERBOSE);
                new ConflictResolveModal(this.app, filename, conflictCheckResult, async (selected) => {
                    const testDoc = await this.localDatabase.getDBEntry(filename, { conflicts: true }, false, false, true);
                    if (testDoc === false) {
                        Logger("Missing file..", LOG_LEVEL.VERBOSE);
                        return res(true);
                    }
                    if (!testDoc._conflicts) {
                        Logger("Nothing have to do with this conflict", LOG_LEVEL.VERBOSE);
                        return res(true);
                    }
                    const toDelete = selected;
                    const toKeep = conflictCheckResult.left.rev != toDelete ? conflictCheckResult.left.rev : conflictCheckResult.right.rev;
                    if (toDelete == "") {
                        // concat both,
                        // delete conflicted revision and write a new file, store it again.
                        const p = conflictCheckResult.diff.map((e) => e[1]).join("");
                        await this.localDatabase.deleteDBEntry(filename, { rev: testDoc._conflicts[0] });
                        const file = getAbstractFileByPath(stripAllPrefixes(filename)) as TFile;
                        if (file) {
                            await this.app.vault.modify(file, p);
                            await this.updateIntoDB(file);
                        } else {
                            const newFile = await this.app.vault.create(filename, p);
                            await this.updateIntoDB(newFile);
                        }
                        await this.pullFile(filename);
                        Logger("concat both file");
                        if (this.settings.syncAfterMerge && !this.suspended) {
                            await this.replicate();
                        }
                        setTimeout(() => {
                            //resolved, check again.
                            this.showIfConflicted(filename);
                        }, 500);
                    } else if (toDelete == null) {
                        Logger("Leave it still conflicted");
                    } else {
                        await this.localDatabase.deleteDBEntry(filename, { rev: toDelete });
                        await this.pullFile(filename, null, true, toKeep);
                        Logger(`Conflict resolved:${filename}`);
                        if (this.settings.syncAfterMerge && !this.suspended) {
                            await this.replicate();
                        }
                        setTimeout(() => {
                            //resolved, check again.
                            this.showIfConflicted(filename);
                        }, 500);
                    }

                    return res(true);
                }).open();
            })
        );
    }
    conflictedCheckFiles: FilePath[] = [];

    // queueing the conflicted file check
    queueConflictedCheck(file: TFile) {
        this.conflictedCheckFiles = this.conflictedCheckFiles.filter((e) => e != file.path);
        this.conflictedCheckFiles.push(getPathFromTFile(file));
        scheduleTask("check-conflict", 100, async () => {
            const checkFiles = JSON.parse(JSON.stringify(this.conflictedCheckFiles)) as FilePath[];
            for (const filename of checkFiles) {
                try {
                    const file = getAbstractFileByPath(filename);
                    if (file != null && file instanceof TFile) {
                        await this.showIfConflicted(getPathFromTFile(file));
                    }
                } catch (ex) {
                    Logger(ex);
                }
            }
        });
    }

    async showIfConflicted(filename: FilePathWithPrefix) {
        await runWithLock("conflicted", false, async () => {
            const conflictCheckResult = await this.getConflictedStatus(filename);
            if (conflictCheckResult === false) {
                //nothing to do.
                return;
            }
            if (conflictCheckResult === true) {
                //auto resolved, but need check again;
                if (this.settings.syncAfterMerge && !this.suspended) {
                    await this.replicate();
                }
                Logger("conflict:Automatically merged, but we have to check it again");
                setTimeout(() => {
                    this.showIfConflicted(filename);
                }, 500);
                return;
            }
            //there conflicts, and have to resolve ;
            await this.showMergeDialog(filename, conflictCheckResult);
        });
    }

    async pullFile(filename: FilePathWithPrefix, fileList?: TFile[], force?: boolean, rev?: string, waitForReady = true) {
        const targetFile = getAbstractFileByPath(stripAllPrefixes(filename));
        if (!this.isTargetFile(filename)) return;
        if (targetFile == null) {
            //have to create;
            const doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : null, false, waitForReady);
            if (doc === false) {
                Logger(`${filename} Skipped`);
                return;
            }
            await this.doc2storage(doc, undefined, force);
        } else if (targetFile instanceof TFile) {
            //normal case
            const file = targetFile;
            const doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : null, false, waitForReady);
            if (doc === false) {
                Logger(`${filename} Skipped`);
                return;
            }
            await this.doc2storage(doc, file, force);
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
            const w = getAbstractFileByPath((file as any).path);
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
            // Logger("STORAGE .. DB :" + file.path, LOG_LEVEL.VERBOSE);
            caches[dK] = { storageMtime, docMtime };
            return caches;
        }
        if (storageMtime > docMtime) {
            //newer local file.
            Logger("STORAGE -> DB :" + file.path);
            Logger(`${storageMtime} > ${docMtime}`);
            await this.updateIntoDB(file, initialScan);
            caches[dK] = { storageMtime, docMtime };
            return caches;
        } else if (storageMtime < docMtime) {
            //newer database file.
            Logger("STORAGE <- DB :" + file.path);
            Logger(`${storageMtime} < ${docMtime}`);
            const docx = await this.localDatabase.getDBEntry(getPathFromTFile(file), null, false, false);
            if (docx != false) {
                await this.doc2storage(docx, file);
            } else {
                Logger("STORAGE <- DB :" + file.path + " Skipped");
            }
            caches[dK] = { storageMtime, docMtime };
            return caches;
        }
        Logger("STORAGE == DB :" + file.path + "", LOG_LEVEL.VERBOSE);
        caches[dK] = { storageMtime, docMtime };
        return caches;

    }

    async updateIntoDB(file: TFile, initialScan?: boolean, cache?: CacheData, force?: boolean) {
        if (!this.isTargetFile(file)) return true;
        if (shouldBeIgnored(file.path)) {
            return true;
        }
        let content: string | string[];
        let datatype: "plain" | "newnote" = "newnote";
        if (!cache) {
            if (!isPlainText(file.name)) {
                Logger(`Reading   : ${file.path}`, LOG_LEVEL.VERBOSE);
                const contentBin = await this.app.vault.readBinary(file);
                Logger(`Processing: ${file.path}`, LOG_LEVEL.VERBOSE);
                try {
                    content = await arrayBufferToBase64(contentBin);
                } catch (ex) {
                    Logger(`The file ${file.path} could not be encoded`);
                    Logger(ex, LOG_LEVEL.VERBOSE);
                    return false;
                }
                datatype = "newnote";
            } else {
                content = await this.app.vault.read(file);
                datatype = "plain";
            }
        } else {
            if (cache instanceof ArrayBuffer) {
                Logger(`Processing: ${file.path}`, LOG_LEVEL.VERBOSE);
                try {
                    content = await arrayBufferToBase64(cache);
                } catch (ex) {
                    Logger(`The file ${file.path} could not be encoded`);
                    Logger(ex, LOG_LEVEL.VERBOSE);
                    return false;
                }
                datatype = "newnote"
            } else {
                content = cache;
                datatype = "plain";
            }
        }
        const fullPath = getPathFromTFile(file);
        const id = await this.path2id(fullPath);
        const d: LoadedEntry = {
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
        const msg = `DB <- STORAGE (${datatype}) `;
        const isNotChanged = await runWithLock("file-" + fullPath, false, async () => {
            if (recentlyTouched(file)) {
                return true;
            }
            try {
                const old = await this.localDatabase.getDBEntry(fullPath, null, false, false);
                if (old !== false) {
                    const oldData = { data: old.data, deleted: old._deleted || old.deleted };
                    const newData = { data: d.data, deleted: d._deleted || d.deleted };
                    if (oldData.deleted != newData.deleted) return false;
                    if (!isDocContentSame(old.data, newData.data)) return false;
                    Logger(msg + "Skipped (not changed) " + fullPath + ((d._deleted || d.deleted) ? " (deleted)" : ""), LOG_LEVEL.VERBOSE);
                    return true;
                    // d._rev = old._rev;
                }
            } catch (ex) {
                if (force) {
                    Logger(msg + "Error, Could not check the diff for the old one." + (force ? "force writing." : "") + fullPath + ((d._deleted || d.deleted) ? " (deleted)" : ""), LOG_LEVEL.VERBOSE);
                } else {
                    Logger(msg + "Error, Could not check the diff for the old one." + fullPath + ((d._deleted || d.deleted) ? " (deleted)" : ""), LOG_LEVEL.VERBOSE);
                }
                return !force;
            }
            return false;
        });
        if (isNotChanged) return true;
        const ret = await this.localDatabase.putDBEntry(d, initialScan);
        this.queuedFiles = this.queuedFiles.map((e) => ({ ...e, ...(e.entry._id == d._id ? { done: true } : {}) }));

        Logger(msg + fullPath);
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
        return ret != false;
    }

    async deleteFromDB(file: TFile) {
        if (!this.isTargetFile(file)) return;
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
        clearTouched();
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

    async applyMTimeToFile(file: InternalFileInfo) {
        await this.app.vault.adapter.append(file.path, "", { ctime: file.ctime, mtime: file.mtime });
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



    isTargetFile(file: string | TAbstractFile) {
        if (file instanceof TFile) {
            return this.localDatabase.isTargetFile(file.path);
        } else if (typeof file == "string") {
            return this.localDatabase.isTargetFile(file);
        }
    }

}

