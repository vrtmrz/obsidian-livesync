import { debounce, Notice, Plugin, TFile, addIcon, TFolder, normalizePath, TAbstractFile, Editor, MarkdownView, PluginManifest, App } from "obsidian";
import { Diff, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from "diff-match-patch";
import { EntryDoc, LoadedEntry, ObsidianLiveSyncSettings, diff_check_result, diff_result_leaf, EntryBody, LOG_LEVEL, VER, DEFAULT_SETTINGS, diff_result, FLAGMD_REDFLAG, SYNCINFO_ID, InternalFileEntry, SALT_OF_PASSPHRASE, ConfigPassphraseStore, CouchDBConnection, FLAGMD_REDFLAG2 } from "./lib/src/types";
import { PluginDataEntry, PERIODIC_PLUGIN_SWEEP, PluginList, DevicePluginList, InternalFileInfo, queueItem, FileInfo } from "./types";
import { getDocData, isDocContentSame } from "./lib/src/utils";
import { Logger } from "./lib/src/logger";
import { LocalPouchDB } from "./LocalPouchDB";
import { LogDisplayModal } from "./LogDisplayModal";
import { ConflictResolveModal } from "./ConflictResolveModal";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { DocumentHistoryModal } from "./DocumentHistoryModal";
import { applyPatch, clearAllPeriodic, clearAllTriggers, clearTrigger, disposeMemoObject, generatePatchObj, id2path, isObjectMargeApplicable, isSensibleMargeApplicable, memoIfNotExist, memoObject, path2id, retrieveMemoObject, setTrigger, tryParseJSON } from "./utils";
import { decrypt, encrypt, tryDecrypt } from "./lib/src/e2ee_v2";

const isDebug = false;

import { InputStringDialog, PluginDialogModal, PopoverSelectString } from "./dialogs";
import { isCloudantURI } from "./lib/src/utils_couchdb";
import { getGlobalStore, observeStores } from "./lib/src/store";
import { lockStore, logMessageStore, logStore } from "./lib/src/stores";
import { NewNotice, setNoticeClass, WrappedNotice } from "./lib/src/wrapper";
import { base64ToString, versionNumberString2Number, base64ToArrayBuffer, arrayBufferToBase64 } from "./lib/src/strbin";
import { isPlainText, isValidPath, shouldBeIgnored } from "./lib/src/path";
import { runWithLock } from "./lib/src/lock";
import { Semaphore } from "./lib/src/semaphore";

setNoticeClass(Notice);

const ICHeader = "i:";
const ICHeaderEnd = "i;";
const ICHeaderLength = ICHeader.length;
const FileWatchEventQueueMax = 10;

function getAbstractFileByPath(path: string): TAbstractFile | null {
    // Hidden API but so useful.
    // @ts-ignore
    if ("getAbstractFileByPathInsensitive" in app.vault && (app.vault.adapter?.insensitive ?? false)) {
        // @ts-ignore
        return app.vault.getAbstractFileByPathInsensitive(path);
    } else {
        return app.vault.getAbstractFileByPath(path);
    }
}
function trimPrefix(target: string, prefix: string) {
    return target.startsWith(prefix) ? target.substring(prefix.length) : target;
}

/**
 * returns is internal chunk of file
 * @param str ID
 * @returns 
 */
function isInternalMetadata(str: string): boolean {
    return str.startsWith(ICHeader);
}
function id2filenameInternalMetadata(str: string): string {
    return str.substring(ICHeaderLength);
}
function filename2idInternalMetadata(str: string): string {
    return ICHeader + str;
}

const CHeader = "h:";
const CHeaderEnd = "h;";
// const CHeaderLength = CHeader.length;
function isChunk(str: string): boolean {
    return str.startsWith(CHeader);
}

const PSCHeader = "ps:";
const PSCHeaderEnd = "ps;";
function isPluginMetadata(str: string): boolean {
    return str.startsWith(PSCHeader);
}


const askYesNo = (app: App, message: string): Promise<"yes" | "no"> => {
    return new Promise((res) => {
        const popover = new PopoverSelectString(app, message, null, null, (result) => res(result as "yes" | "no"));
        popover.open();
    });
};

const askSelectString = (app: App, message: string, items: string[]): Promise<string> => {
    const getItemsFun = () => items;
    return new Promise((res) => {
        const popover = new PopoverSelectString(app, message, "", getItemsFun, (result) => res(result));
        popover.open();
    });
};


const askString = (app: App, title: string, key: string, placeholder: string): Promise<string | false> => {
    return new Promise((res) => {
        const dialog = new InputStringDialog(app, title, key, placeholder, (result) => res(result));
        dialog.open();
    });
};
let touchedFiles: string[] = [];
function touch(file: TFile | string) {
    const f = file instanceof TFile ? file : getAbstractFileByPath(file) as TFile;
    const key = `${f.path}-${f.stat.mtime}-${f.stat.size}`;
    touchedFiles.unshift(key);
    touchedFiles = touchedFiles.slice(0, 100);
}
function recentlyTouched(file: TFile) {
    const key = `${file.path}-${file.stat.mtime}-${file.stat.size}`;
    if (touchedFiles.indexOf(key) == -1) return false;
    return true;
}
function clearTouched() {
    touchedFiles = [];
}

type CacheData = string | ArrayBuffer;
type FileEventType = "CREATE" | "DELETE" | "CHANGED" | "RENAME" | "INTERNAL";
type FileEventArgs = {
    file: FileInfo | InternalFileInfo;
    cache?: CacheData;
    oldPath?: string;
    ctx?: any;
}
type FileEventItem = {
    type: FileEventType,
    args: FileEventArgs,
    key: string,
}

export default class ObsidianLiveSyncPlugin extends Plugin {
    settings: ObsidianLiveSyncSettings;
    localDatabase: LocalPouchDB;
    statusBar: HTMLElement;
    statusBar2: HTMLElement;
    suspended: boolean;
    deviceAndVaultName: string;
    isMobile = false;
    isReady = false;

    watchedFileEventQueue = [] as FileEventItem[];

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

    showHistory(file: TFile | string) {
        if (!this.settings.useHistory) {
            Logger("You have to enable Use History in misc.", LOG_LEVEL.NOTICE);
        } else {
            new DocumentHistoryModal(this.app, this, file).open();
        }
    }

    async fileHistory() {
        const pageLimit = 1000;
        let nextKey = "";
        const notes: { path: string, mtime: number }[] = [];
        do {
            const docs = await this.localDatabase.localDatabase.allDocs({ limit: pageLimit, startkey: nextKey, include_docs: true });
            nextKey = "";
            for (const row of docs.rows) {
                const doc = row.doc;
                nextKey = `${row.id}\u{10ffff}`;
                if (!("type" in doc)) continue;
                if (doc.type == "newnote" || doc.type == "plain") {
                    notes.push({ path: id2path(doc._id), mtime: doc.mtime });
                }
                if (isChunk(nextKey)) {
                    // skip the chunk zone.
                    nextKey = CHeaderEnd;
                }
            }
        } while (nextKey != "");

        notes.sort((a, b) => b.mtime - a.mtime);
        const notesList = notes.map(e => e.path);
        const target = await askSelectString(this.app, "File to view History", notesList);
        if (target) {
            this.showHistory(target);
        }
    }
    async pickFileForResolve() {
        const pageLimit = 1000;
        let nextKey = "";
        const notes: { path: string, mtime: number }[] = [];
        do {
            const docs = await this.localDatabase.localDatabase.allDocs({ limit: pageLimit, startkey: nextKey, conflicts: true, include_docs: true });
            nextKey = "";
            for (const row of docs.rows) {
                const doc = row.doc;
                nextKey = `${row.id}\u{10ffff}`;
                if (isChunk(nextKey)) {
                    // skip the chunk zone.
                    nextKey = CHeaderEnd;
                }
                if (!("_conflicts" in doc)) continue;
                if (isInternalMetadata(row.id)) continue;
                // We have to check also deleted files.
                // if (doc._deleted) continue;
                // if ("deleted" in doc && doc.deleted) continue;
                if (doc.type == "newnote" || doc.type == "plain") {
                    // const docId = doc._id.startsWith("i:") ? doc._id.substring("i:".length) : doc._id;
                    notes.push({ path: id2path(doc._id), mtime: doc.mtime });
                }

            }
        } while (nextKey != "");
        notes.sort((a, b) => b.mtime - a.mtime);
        const notesList = notes.map(e => e.path);
        if (notesList.length == 0) {
            Logger("There are no conflicted documents", LOG_LEVEL.NOTICE);
            return;
        }
        const target = await askSelectString(this.app, "File to view History", notesList);
        if (target) {
            if (isInternalMetadata(target)) {
                //NOP
            } else {
                await this.showIfConflicted(target);
            }
        }
    }

    async collectDeletedFiles() {
        const pageLimit = 1000;
        let nextKey = "";
        const limitDays = this.settings.automaticallyDeleteMetadataOfDeletedFiles;
        if (limitDays <= 0) return;
        Logger(`Checking expired file history`);
        const limit = Date.now() - (86400 * 1000 * limitDays);
        const notes: { path: string, mtime: number, ttl: number, doc: PouchDB.Core.ExistingDocument<EntryDoc & PouchDB.Core.AllDocsMeta> }[] = [];
        do {
            const docs = await this.localDatabase.localDatabase.allDocs({ limit: pageLimit, startkey: nextKey, conflicts: true, include_docs: true });
            nextKey = "";
            for (const row of docs.rows) {
                const doc = row.doc;
                nextKey = `${row.id}\u{10ffff}`;
                if (doc.type == "newnote" || doc.type == "plain") {
                    if (doc.deleted && (doc.mtime - limit) < 0) {
                        notes.push({ path: id2path(doc._id), mtime: doc.mtime, ttl: (doc.mtime - limit) / 1000 / 86400, doc: doc });
                    }
                }
                if (isChunk(nextKey)) {
                    // skip the chunk zone.
                    nextKey = CHeaderEnd;
                }
            }
        } while (nextKey != "");
        if (notes.length == 0) {
            Logger("There are no old documents");
            Logger(`Checking expired file history done`);

            return;
        }
        for (const v of notes) {
            Logger(`Deletion history expired: ${v.path}`);
            const delDoc = v.doc;
            delDoc._deleted = true;
            // console.dir(delDoc);
            await this.localDatabase.localDatabase.put(delDoc);
        }
        Logger(`Checking expired file history done`);
    }

    async onload() {
        logStore.subscribe(e => this.addLog(e.message, e.level, e.key));
        Logger("loading plugin");
        //@ts-ignore
        const manifestVersion: string = MANIFEST_VERSION || "0.0.0";
        //@ts-ignore
        const packageVersion: string = PACKAGE_VERSION || "0.0.0";


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
        this.addRibbonIcon("replicate", "Replicate", async () => {
            await this.replicate(true);
        });

        this.addRibbonIcon("view-log", "Show log", () => {
            new LogDisplayModal(this.app, this).open();
        });

        this.statusBar = this.addStatusBarItem();
        this.statusBar.addClass("syncstatusbar");

        this.statusBar2 = this.addStatusBarItem();
        this.watchVaultChange = this.watchVaultChange.bind(this);
        this.watchVaultCreate = this.watchVaultCreate.bind(this);
        this.watchVaultDelete = this.watchVaultDelete.bind(this);
        this.watchVaultRename = this.watchVaultRename.bind(this);
        this.watchVaultRawEvents = this.watchVaultRawEvents.bind(this);
        this.watchWorkspaceOpen = debounce(this.watchWorkspaceOpen.bind(this), 1000, false);
        this.watchWindowVisibility = debounce(this.watchWindowVisibility.bind(this), 1000, false);
        this.watchOnline = debounce(this.watchOnline.bind(this), 500, false);

        this.parseReplicationResult = this.parseReplicationResult.bind(this);

        this.setPeriodicSync = this.setPeriodicSync.bind(this);
        this.clearPeriodicSync = this.clearPeriodicSync.bind(this);
        this.periodicSync = this.periodicSync.bind(this);
        this.loadQueuedFiles = this.loadQueuedFiles.bind(this);

        this.getPluginList = this.getPluginList.bind(this);
        // this.registerWatchEvents();
        this.addSettingTab(new ObsidianLiveSyncSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(async () => {
            this.registerFileWatchEvents();
            if (this.localDatabase.isReady)
                try {
                    if (this.isRedFlagRaised() || this.isRedFlag2Raised()) {
                        this.settings.batchSave = false;
                        this.settings.liveSync = false;
                        this.settings.periodicReplication = false;
                        this.settings.syncOnSave = false;
                        this.settings.syncOnStart = false;
                        this.settings.syncOnFileOpen = false;
                        this.settings.syncAfterMerge = false;
                        this.settings.autoSweepPlugins = false;
                        this.settings.usePluginSync = false;
                        this.settings.suspendFileWatching = true;
                        this.settings.syncInternalFiles = false;
                        await this.saveSettings();
                        if (this.isRedFlag2Raised()) {
                            Logger(`${FLAGMD_REDFLAG2} has been detected! Self-hosted LiveSync suspends all sync and rebuild everything.`, LOG_LEVEL.NOTICE);
                            await this.resetLocalDatabase();
                            await this.initializeDatabase(true);
                            await this.markRemoteLocked();
                            await this.tryResetRemoteDatabase();
                            await this.markRemoteLocked();
                            await this.replicateAllToServer(true);
                            await this.deleteRedFlag2();
                        } else {
                            await this.openDatabase();
                            const warningMessage = "The red flag is raised! The whole initialize steps are skipped, and any file changes are not captured.";
                            Logger(warningMessage, LOG_LEVEL.NOTICE);
                            this.setStatusBarText(warningMessage);
                        }
                    } else {
                        if (this.settings.suspendFileWatching) {
                            Logger("'Suspend file watching' turned on. Are you sure this is what you intended? Every modification on the vault will be ignored.", LOG_LEVEL.NOTICE);
                        }
                        const isInitialized = await this.initializeDatabase();
                        if (!isInitialized) {
                            //TODO:stop all sync.
                            return false;
                        }
                    }
                    await this.realizeSettingSyncMode();
                    this.registerWatchEvents();
                    if (this.settings.syncOnStart) {
                        this.localDatabase.openReplication(this.settings, false, false, this.parseReplicationResult);
                    }
                } catch (ex) {
                    Logger("Error while loading Self-hosted LiveSync", LOG_LEVEL.NOTICE);
                    Logger(ex, LOG_LEVEL.VERBOSE);
                }
        });
        const configURIBase = "obsidian://setuplivesync?settings=";
        this.addCommand({
            id: "livesync-copysetupuri",
            name: "Copy the setup URI",
            callback: async () => {
                const encryptingPassphrase = await askString(this.app, "Encrypt your settings", "The passphrase to encrypt the setup URI", "");
                if (encryptingPassphrase === false) return;
                const setting = { ...this.settings, configPassphraseStore: "", encryptedCouchDBConnection: "", encryptedPassphrase: "" };
                const keys = Object.keys(setting) as (keyof ObsidianLiveSyncSettings)[];
                for (const k of keys) {
                    if (JSON.stringify(k in setting ? setting[k] : "") == JSON.stringify(k in DEFAULT_SETTINGS ? DEFAULT_SETTINGS[k] : "*")) {
                        delete setting[k];
                    }
                }
                const encryptedSetting = encodeURIComponent(await encrypt(JSON.stringify(setting), encryptingPassphrase, false));
                const uri = `${configURIBase}${encryptedSetting}`;
                await navigator.clipboard.writeText(uri);
                Logger("Setup URI copied to clipboard", LOG_LEVEL.NOTICE);
            },
        });
        this.addCommand({
            id: "livesync-copysetupurifull",
            name: "Copy the setup URI (Full)",
            callback: async () => {
                const encryptingPassphrase = await askString(this.app, "Encrypt your settings", "The passphrase to encrypt the setup URI", "");
                if (encryptingPassphrase === false) return;
                const setting = { ...this.settings, configPassphraseStore: "", encryptedCouchDBConnection: "", encryptedPassphrase: "" };
                const encryptedSetting = encodeURIComponent(await encrypt(JSON.stringify(setting), encryptingPassphrase, false));
                const uri = `${configURIBase}${encryptedSetting}`;
                await navigator.clipboard.writeText(uri);
                Logger("Setup URI copied to clipboard", LOG_LEVEL.NOTICE);
            },
        });
        this.addCommand({
            id: "livesync-opensetupuri",
            name: "Open the setup URI",
            callback: async () => {
                const setupURI = await askString(this.app, "Easy setup", "Set up URI", `${configURIBase}aaaaa`);
                if (setupURI === false) return;
                if (!setupURI.startsWith(`${configURIBase}`)) {
                    Logger("Set up URI looks wrong.", LOG_LEVEL.NOTICE);
                    return;
                }
                const config = decodeURIComponent(setupURI.substring(configURIBase.length));
                console.dir(config)
                await setupWizard(config);
            },
        });
        const setupWizard = async (confString: string) => {
            try {
                const oldConf = JSON.parse(JSON.stringify(this.settings));
                const encryptingPassphrase = await askString(this.app, "Passphrase", "The passphrase to decrypt your setup URI", "");
                if (encryptingPassphrase === false) return;
                const newConf = await JSON.parse(await decrypt(confString, encryptingPassphrase, false));
                if (newConf) {
                    const result = await askYesNo(this.app, "Importing LiveSync's conf, OK?");
                    if (result == "yes") {
                        const newSettingW = Object.assign({}, DEFAULT_SETTINGS, newConf) as ObsidianLiveSyncSettings;
                        this.localDatabase.closeReplication();
                        this.settings.suspendFileWatching = true;
                        console.dir(newSettingW);
                        // Back into the default method once.
                        newSettingW.configPassphraseStore = "";
                        newSettingW.encryptedPassphrase = "";
                        newSettingW.encryptedCouchDBConnection = "";
                        const setupJustImport = "Just import setting";
                        const setupAsNew = "Set it up as secondary or subsequent device";
                        const setupAgain = "Reconfigure and reconstitute the data";
                        const setupManually = "Leave everything to me";

                        const setupType = await askSelectString(this.app, "How would you like to set it up?", [setupAsNew, setupAgain, setupJustImport, setupManually]);
                        if (setupType == setupJustImport) {
                            this.settings = newSettingW;
                            this.usedPassphrase = "";
                            await this.saveSettings();
                        } else if (setupType == setupAsNew) {
                            this.settings = newSettingW;
                            this.usedPassphrase = "";
                            await this.saveSettings();
                            await this.resetLocalOldDatabase();
                            await this.resetLocalDatabase();
                            await this.localDatabase.initializeDatabase();
                            await this.markRemoteResolved();
                            await this.replicate(true);
                        } else if (setupType == setupAgain) {
                            const confirm = "I know this operation will rebuild all my databases with files on this device, and files that are on the remote database and I didn't synchronize to any other devices will be lost and want to proceed indeed.";
                            if (await askSelectString(this.app, "Do you really want to do this?", ["Cancel", confirm]) != confirm) {
                                return;
                            }
                            this.settings = newSettingW;
                            this.usedPassphrase = "";
                            await this.saveSettings();
                            await this.resetLocalOldDatabase();
                            await this.resetLocalDatabase();
                            await this.localDatabase.initializeDatabase();
                            await this.initializeDatabase(true);
                            await this.tryResetRemoteDatabase();
                            await this.markRemoteLocked();
                            await this.markRemoteResolved();
                            await this.replicate(true);

                        } else if (setupType == setupManually) {
                            const keepLocalDB = await askYesNo(this.app, "Keep local DB?");
                            const keepRemoteDB = await askYesNo(this.app, "Keep remote DB?");
                            if (keepLocalDB == "yes" && keepRemoteDB == "yes") {
                                // nothing to do. so peaceful.
                                this.settings = newSettingW;
                                this.usedPassphrase = "";
                                await this.saveSettings();
                                const replicate = await askYesNo(this.app, "Unlock and replicate?");
                                if (replicate == "yes") {
                                    await this.replicate(true);
                                    await this.markRemoteUnlocked();
                                }
                                Logger("Configuration loaded.", LOG_LEVEL.NOTICE);
                                return;
                            }
                            if (keepLocalDB == "no" && keepRemoteDB == "no") {
                                const reset = await askYesNo(this.app, "Drop everything?");
                                if (reset != "yes") {
                                    Logger("Cancelled", LOG_LEVEL.NOTICE);
                                    this.settings = oldConf;
                                    return;
                                }
                            }
                            let initDB;
                            this.settings = newSettingW;
                            this.usedPassphrase = "";
                            await this.saveSettings();
                            if (keepLocalDB == "no") {
                                this.resetLocalOldDatabase();
                                this.resetLocalDatabase();
                                this.localDatabase.initializeDatabase();
                                const rebuild = await askYesNo(this.app, "Rebuild the database?");
                                if (rebuild == "yes") {
                                    initDB = this.initializeDatabase(true);
                                } else {
                                    this.markRemoteResolved();
                                }
                            }
                            if (keepRemoteDB == "no") {
                                await this.tryResetRemoteDatabase();
                                await this.markRemoteLocked();
                            }
                            if (keepLocalDB == "no" || keepRemoteDB == "no") {
                                const replicate = await askYesNo(this.app, "Replicate once?");
                                if (replicate == "yes") {
                                    if (initDB != null) {
                                        await initDB;
                                    }
                                    await this.replicate(true);
                                }
                            }
                        }
                    }

                    Logger("Configuration loaded.", LOG_LEVEL.NOTICE);
                } else {
                    Logger("Cancelled.", LOG_LEVEL.NOTICE);
                }
            } catch (ex) {
                Logger("Couldn't parse or decrypt configuration uri.", LOG_LEVEL.NOTICE);
            }
        };
        this.registerObsidianProtocolHandler("setuplivesync", async (conf: any) => {
            await setupWizard(conf.settings);
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
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.localDatabase.getDBEntry(view.file.path, {}, true, false);
            },
        });
        this.addCommand({
            id: "livesync-checkdoc-conflicted",
            name: "Resolve if conflicted.",
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                await this.showIfConflicted(view.file.path);
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
                this.showHistory(view.file);
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
        this.triggerCheckPluginUpdate = debounce(this.triggerCheckPluginUpdate.bind(this), 3000);

        this.addCommand({
            id: "livesync-plugin-dialog",
            name: "Show Plugins and their settings",
            callback: () => {
                this.showPluginSyncModal();
            },
        });

        this.addCommand({
            id: "livesync-scaninternal",
            name: "Sync hidden files",
            callback: () => {
                this.syncInternalFilesAndDatabase("safe", true);
            },
        });
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
            id: "livesync-runbatch",
            name: "Run pended batch processes",
            callback: async () => {
                await this.applyBatchChange();
            },
        })

    }

    pluginDialog: PluginDialogModal = null;

    showPluginSyncModal() {
        if (this.pluginDialog != null) {
            this.pluginDialog.open();
        } else {
            this.pluginDialog = new PluginDialogModal(this.app, this);
            this.pluginDialog.open();
        }
    }

    hidePluginSyncModal() {
        if (this.pluginDialog != null) {
            this.pluginDialog.close();
            this.pluginDialog = null;
        }
    }

    onunload() {
        this.hidePluginSyncModal();
        if (this.localDatabase != null) {
            this.localDatabase.onunload();
        }
        if (this.gcTimerHandler != null) {
            clearTimeout(this.gcTimerHandler);
            this.gcTimerHandler = null;
        }
        this.clearPeriodicSync();
        this.clearPluginSweep();
        this.clearInternalFileScan();
        if (this.localDatabase != null) {
            this.localDatabase.closeReplication();
            this.localDatabase.close();
        }
        clearAllPeriodic();
        clearAllTriggers();
        window.removeEventListener("visibilitychange", this.watchWindowVisibility);
        window.removeEventListener("online", this.watchOnline);
        Logger("unloading plugin");
    }

    async openDatabase() {
        if (this.localDatabase != null) {
            await this.localDatabase.close();
        }
        const vaultName = this.getVaultName();
        Logger("Open Database...");
        //@ts-ignore
        const isMobile = this.app.isMobile;
        this.localDatabase = new LocalPouchDB(this.settings, vaultName, isMobile);
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

    gcTimerHandler: any = null;

    registerFileWatchEvents() {
        this.registerEvent(this.app.vault.on("modify", this.watchVaultChange));
        this.registerEvent(this.app.vault.on("delete", this.watchVaultDelete));
        this.registerEvent(this.app.vault.on("rename", this.watchVaultRename));
        this.registerEvent(this.app.vault.on("create", this.watchVaultCreate));
        //@ts-ignore : Internal API
        this.registerEvent(this.app.vault.on("raw", this.watchVaultRawEvents));
    }

    registerWatchEvents() {
        this.registerEvent(this.app.workspace.on("file-open", this.watchWorkspaceOpen));
        window.addEventListener("visibilitychange", this.watchWindowVisibility);
        window.addEventListener("online", this.watchOnline);
    }


    watchOnline() {
        this.watchOnlineAsync();
    }
    async watchOnlineAsync() {
        // If some files were failed to retrieve, scan files again.
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
            this.localDatabase.closeReplication();
            this.clearPeriodicSync();
        } else {
            // suspend all temporary.
            if (this.suspended) return;
            if (this.settings.autoSweepPlugins) {
                await this.sweepPlugin(false);
            }
            if (this.settings.liveSync) {
                this.localDatabase.openReplication(this.settings, true, false, this.parseReplicationResult);
            }
            if (this.settings.syncOnStart) {
                this.localDatabase.openReplication(this.settings, false, false, this.parseReplicationResult);
            }
            if (this.settings.periodicReplication) {
                this.setPeriodicSync();
            }
        }
    }

    // Cache file and waiting to can be proceed.
    async appendWatchEvent(params: { type: FileEventType, file: TAbstractFile | InternalFileInfo, oldPath?: string }[], ctx?: any) {
        let forcePerform = false;
        for (const param of params) {
            const atomicKey = [0, 0, 0, 0, 0, 0].map(e => `${Math.floor(Math.random() * 100000)}`).join("-");
            const type = param.type;
            const file = param.file;
            const oldPath = param.oldPath;
            if (file instanceof TFolder) continue;
            if (!this.isTargetFile(file.path)) continue;
            if (this.settings.suspendFileWatching) continue;

            let cache: null | string | ArrayBuffer;
            // new file or something changed, cache the changes.
            if (file instanceof TFile && (type == "CREATE" || type == "CHANGED")) {
                if (recentlyTouched(file)) {
                    continue;
                }
                if (!isPlainText(file.name)) {
                    cache = await this.app.vault.readBinary(file);
                } else {
                    // cache = await this.app.vault.read(file);
                    cache = await this.app.vault.cachedRead(file);
                    if (!cache) cache = await this.app.vault.read(file);
                }
            }
            if (type == "DELETE" || type == "RENAME") {
                forcePerform = true;
            }


            if (this.settings.batchSave) {
                // if the latest event is the same type, omit that
                // a.md MODIFY  <- this should be cancelled when a.md MODIFIED
                // b.md MODIFY    <- this should be cancelled when b.md MODIFIED
                // a.md MODIFY
                // a.md CREATE
                //     : 
                let i = this.watchedFileEventQueue.length;
                L1:
                while (i >= 0) {
                    i--;
                    if (i < 0) break L1;
                    if (this.watchedFileEventQueue[i].args.file.path != file.path) {
                        continue L1;
                    }
                    if (this.watchedFileEventQueue[i].type != type) break L1;
                    this.watchedFileEventQueue.remove(this.watchedFileEventQueue[i]);
                    this.queuedFilesStore.set({ queuedItems: this.queuedFiles, fileEventItems: this.watchedFileEventQueue });
                }
            }

            const fileInfo = file instanceof TFile ? {
                ctime: file.stat.ctime,
                mtime: file.stat.mtime,
                file: file,
                path: file.path,
                size: file.stat.size
            } as FileInfo : file as InternalFileInfo;
            this.watchedFileEventQueue.push({
                type,
                args: {
                    file: fileInfo,
                    oldPath,
                    cache,
                    ctx
                },
                key: atomicKey
            })
        }
        this.queuedFilesStore.set({ queuedItems: this.queuedFiles, fileEventItems: this.watchedFileEventQueue });
        if (this.isReady) {
            await this.procFileEvent(forcePerform);
        }

    }
    async procFileEvent(applyBatch?: boolean) {
        if (!this.isReady) return;
        if (this.settings.batchSave) {
            if (!applyBatch && this.watchedFileEventQueue.length < FileWatchEventQueueMax) {
                // Defer till applying batch save or queue has been grown enough.
                // or 120 seconds after.
                setTrigger("applyBatchAuto", 30000, () => {
                    this.procFileEvent(true);
                })
                return;
            }
        }
        clearTrigger("applyBatchAuto");
        const ret = await runWithLock("procFiles", true, async () => {
            L2:
            do {
                const procs = [...this.watchedFileEventQueue];
                this.watchedFileEventQueue = [];

                L1:
                do {
                    const queue = procs.shift();
                    if (queue === undefined) break L1;

                    const file = queue.args.file;
                    const key = `file-last-proc-${queue.type}-${file.path}`;
                    const last = Number(await this.localDatabase.kvDB.get(key) || 0);
                    if (queue.type == "DELETE") {
                        await this.deleteFromDBbyPath(file.path);
                    } else if (queue.type == "INTERNAL") {
                        await this.watchVaultRawEventsAsync(file.path);
                    } else {
                        const targetFile = this.app.vault.getAbstractFileByPath(file.path);
                        if (!(targetFile instanceof TFile)) {
                            Logger(`Target file was not found: ${file.path}`, LOG_LEVEL.INFO);
                            continue L1;
                        }
                        //TODO: check from cache time.
                        if (file.mtime == last) {
                            Logger(`File has been already scanned on ${queue.type}, skip: ${file.path}`, LOG_LEVEL.VERBOSE);
                            continue L1;
                        }

                        const cache = queue.args.cache;
                        if (queue.type == "CREATE" || queue.type == "CHANGED") {
                            if (!await this.updateIntoDB(targetFile, false, cache)) {
                                Logger(`DB -> STORAGE: failed, cancel the relative operations: ${targetFile.path}`, LOG_LEVEL.INFO);
                                // cancel running queues and remove one of atomic operation
                                this.watchedFileEventQueue = [...procs, ...this.watchedFileEventQueue].filter(e => e.key != queue.key);
                                continue L2;
                            }
                        }
                        if (queue.type == "RENAME") {
                            // Obsolete
                            await this.watchVaultRenameAsync(targetFile, queue.args.oldPath);
                        }
                    }
                    await this.localDatabase.kvDB.set(key, file.mtime);
                } while (procs.length > 0);
            } while (this.watchedFileEventQueue.length != 0);
            return true;
        })
        return ret;
    }

    watchVaultCreate(file: TAbstractFile, ctx?: any) {
        this.appendWatchEvent([{ type: "CREATE", file }], ctx);
    }

    watchVaultChange(file: TAbstractFile, ctx?: any) {
        this.appendWatchEvent([{ type: "CHANGED", file }], ctx);
    }

    watchVaultDelete(file: TAbstractFile, ctx?: any) {
        this.appendWatchEvent([{ type: "DELETE", file }], ctx);
    }
    watchVaultRename(file: TAbstractFile, oldFile: string, ctx?: any) {
        if (file instanceof TFile) {
            this.appendWatchEvent([
                { type: "CREATE", file },
                { type: "DELETE", file: { path: oldFile, mtime: file.stat.mtime, ctime: file.stat.ctime, size: file.stat.size, deleted: true } }
            ], ctx);
        }
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
        await this.showIfConflicted(file.path);
    }

    async applyBatchChange() {
        if (this.settings.batchSave) {
            return await this.procFileEvent(true);
        }
    }

    // Watch raw events (Internal API)
    watchVaultRawEvents(path: string) {
        if (!this.settings.syncInternalFiles) return;
        if (!this.settings.watchInternalFileChanges) return;
        if (!path.startsWith(this.app.vault.configDir)) return;
        const ignorePatterns = this.settings.syncInternalFilesIgnorePatterns.toLocaleLowerCase()
            .replace(/\n| /g, "")
            .split(",").filter(e => e).map(e => new RegExp(e));
        if (ignorePatterns.some(e => path.match(e))) return;
        this.appendWatchEvent(
            [{
                type: "INTERNAL",
                file: { path, mtime: 0, ctime: 0, size: 0 }
            }], null);
    }
    recentProcessedInternalFiles = [] as string[];
    async watchVaultRawEventsAsync(path: string) {
        const stat = await this.app.vault.adapter.stat(path);
        // sometimes folder is coming.
        if (stat && stat.type != "file") return;
        const storageMTime = ~~((stat && stat.mtime || 0) / 1000);
        const key = `${path}-${storageMTime}`;
        if (this.recentProcessedInternalFiles.contains(key)) {
            //If recently processed, it may caused by self.
            return;
        }
        this.recentProcessedInternalFiles = [key, ...this.recentProcessedInternalFiles].slice(0, 100);
        const id = filename2idInternalMetadata(path);
        const filesOnDB = await this.localDatabase.getDBEntryMeta(id);
        const dbMTime = ~~((filesOnDB && filesOnDB.mtime || 0) / 1000);

        // Skip unchanged file.
        if (dbMTime == storageMTime) {
            // Logger(`STORAGE --> DB:${path}: (hidden) Nothing changed`);
            return;
        }

        // Do not compare timestamp. Always local data should be preferred except this plugin wrote one.
        if (storageMTime == 0) {
            await this.deleteInternalFileOnDatabase(path);
        } else {
            await this.storeInternalFileToDatabase({ path: path, ...stat });
            const pluginDir = this.app.vault.configDir + "/plugins/";
            const pluginFiles = ["manifest.json", "data.json", "style.css", "main.js"];
            if (path.startsWith(pluginDir) && pluginFiles.some(e => path.endsWith(e)) && this.settings.usePluginSync) {
                const pluginName = trimPrefix(path, pluginDir).split("/")[0]
                await this.sweepPlugin(false, pluginName);
            }
        }

    }


    GetAllFilesRecursively(file: TAbstractFile): TFile[] {
        if (file instanceof TFile) {
            return [file];
        } else if (file instanceof TFolder) {
            const result: TFile[] = [];
            for (const v of file.children) {
                result.push(...this.GetAllFilesRecursively(v));
            }
            return result;
        } else {
            Logger(`Filetype error:${file.path}`, LOG_LEVEL.NOTICE);
            throw new Error(`Filetype error:${file.path}`);
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
    notifies: { [key: string]: { notice: Notice; timer: NodeJS.Timeout; count: number } } = {};

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
        const timestamp = new Date().toLocaleString();
        const messageContent = typeof message == "string" ? message : message instanceof Error ? `${message.name}:${message.message}` : JSON.stringify(message, null, 2);
        const newMessage = timestamp + "->" + messageContent;

        console.log(vaultName + ":" + newMessage);
        logMessageStore.apply(e => [...e, newMessage].slice(-100));
        this.setStatusBarText(null, messageContent.substring(0, 30));

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

    async doc2storage_create(docEntry: EntryBody, force?: boolean) {
        const pathSrc = id2path(docEntry._id);
        if (shouldBeIgnored(pathSrc)) {
            return;
        }
        if (!this.isTargetFile(pathSrc)) return;

        const doc = await this.localDatabase.getDBEntry(pathSrc, { rev: docEntry._rev });
        if (doc === false) return;
        const msg = `DB -> STORAGE (create${force ? ",force" : ""},${doc.datatype}) `;
        const path = id2path(doc._id);
        if (doc.datatype == "newnote") {
            const bin = base64ToArrayBuffer(doc.data);
            if (bin != null) {
                if (!isValidPath(path)) {
                    Logger(msg + "ERROR, invalid path: " + path, LOG_LEVEL.NOTICE);
                    return;
                }
                await this.ensureDirectory(path);
                try {
                    const newFile = await this.app.vault.createBinary(normalizePath(path), bin, {
                        ctime: doc.ctime,
                        mtime: doc.mtime,
                    });
                    Logger(msg + path);
                    touch(newFile);
                    this.app.vault.trigger("create", newFile);
                } catch (ex) {
                    Logger(msg + "ERROR, Could not write: " + path, LOG_LEVEL.NOTICE);
                    Logger(ex, LOG_LEVEL.VERBOSE);
                }
            }
        } else if (doc.datatype == "plain") {
            if (!isValidPath(path)) {
                Logger(msg + "ERROR, invalid path: " + path, LOG_LEVEL.NOTICE);
                return;
            }
            await this.ensureDirectory(path);
            try {
                const newFile = await this.app.vault.create(normalizePath(path), getDocData(doc.data), {
                    ctime: doc.ctime,
                    mtime: doc.mtime,
                });
                Logger(msg + path);
                touch(newFile);
                this.app.vault.trigger("create", newFile);
            } catch (ex) {
                Logger(msg + "ERROR, Could not create: " + path + "(" + doc.datatype + ")", LOG_LEVEL.NOTICE);
                Logger(ex, LOG_LEVEL.VERBOSE);
            }
        } else {
            Logger(msg + "ERROR, Could not parse: " + path + "(" + doc.datatype + ")", LOG_LEVEL.NOTICE);
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

    async doc2storage_modify(docEntry: EntryBody, file: TFile, force?: boolean) {
        const pathSrc = id2path(docEntry._id);
        if (shouldBeIgnored(pathSrc)) {
            return;
        }
        if (!this.isTargetFile(pathSrc)) return;
        if (docEntry._deleted || docEntry.deleted) {
            // This occurs not only when files are deleted, but also when conflicts are resolved.
            // We have to check no other revisions are left.
            const lastDocs = await this.localDatabase.getDBEntry(pathSrc);
            if (lastDocs === false) {
                await this.deleteVaultItem(file);
            } else {
                // it perhaps delete some revisions.
                // may be we have to reload this
                await this.pullFile(pathSrc, null, true);
                Logger(`delete skipped:${lastDocs._id}`, LOG_LEVEL.VERBOSE);
            }
            return;
        }
        const localMtime = ~~(file.stat.mtime / 1000);
        const docMtime = ~~(docEntry.mtime / 1000);
        if (localMtime < docMtime || force) {
            const doc = await this.localDatabase.getDBEntry(pathSrc);
            if (doc === false) return;
            const msg = `DB -> STORAGE (modify${force ? ",force" : ""},${doc.datatype}) `;
            const path = id2path(doc._id);
            if (doc.datatype == "newnote") {
                const bin = base64ToArrayBuffer(doc.data);
                if (bin != null) {
                    if (!isValidPath(path)) {
                        Logger(msg + "ERROR, invalid path: " + path, LOG_LEVEL.NOTICE);
                        return;
                    }
                    await this.ensureDirectory(path);
                    try {
                        await this.app.vault.modifyBinary(file, bin, { ctime: doc.ctime, mtime: doc.mtime });
                        // this.batchFileChange = this.batchFileChange.filter((e) => e != file.path);
                        Logger(msg + path);
                        const xf = getAbstractFileByPath(file.path) as TFile;
                        touch(xf);
                        this.app.vault.trigger("modify", xf);
                    } catch (ex) {
                        Logger(msg + "ERROR, Could not write: " + path, LOG_LEVEL.NOTICE);
                    }
                }
            } else if (doc.datatype == "plain") {
                if (!isValidPath(path)) {
                    Logger(msg + "ERROR, invalid path: " + path, LOG_LEVEL.NOTICE);
                    return;
                }
                await this.ensureDirectory(path);
                try {
                    await this.app.vault.modify(file, getDocData(doc.data), { ctime: doc.ctime, mtime: doc.mtime });
                    Logger(msg + path);
                    // this.batchFileChange = this.batchFileChange.filter((e) => e != file.path);
                    const xf = getAbstractFileByPath(file.path) as TFile;
                    touch(xf);
                    this.app.vault.trigger("modify", xf);
                } catch (ex) {
                    Logger(msg + "ERROR, Could not write: " + path, LOG_LEVEL.NOTICE);
                }
            } else {
                Logger(msg + "ERROR, Could not parse: " + path + "(" + doc.datatype + ")", LOG_LEVEL.NOTICE);
            }
        } else if (localMtime > docMtime) {
            // newer local file.
            // ?
        } else {
            //Nothing have to op.
            //eq.case
        }
    }

    queuedEntries: EntryBody[] = [];
    handleDBChanged(change: EntryBody) {
        // If queued same file, cancel previous one.
        this.queuedEntries.remove(this.queuedEntries.find(e => e._id == change._id));
        // If the file is opened, we have to apply immediately
        const af = app.workspace.getActiveFile();
        if (af && af.path == id2path(change._id)) {
            return this.handleDBChangedAsync(change);
        }
        this.queuedEntries.push(change);
        if (this.queuedEntries.length > 50) {
            clearTrigger("dbchanged");
            this.execDBchanged();
        }
        setTrigger("dbchanged", 500, () => this.execDBchanged());
    }
    async execDBchanged() {
        await runWithLock("dbchanged", false, async () => {
            const w = [...this.queuedEntries];
            this.queuedEntries = [];
            Logger(`Applying ${w.length} files`);
            for (const entry of w) {
                Logger(`Applying ${entry._id} (${entry._rev}) change...`, LOG_LEVEL.VERBOSE);
                await this.handleDBChangedAsync(entry);
                Logger(`Applied ${entry._id} (${entry._rev}) change...`);
            }
        }
        );
    }
    async handleDBChangedAsync(change: EntryBody) {

        const targetFile = getAbstractFileByPath(id2path(change._id));
        if (targetFile == null) {
            if (change._deleted || change.deleted) {
                return;
            }
            const doc = change;
            await this.doc2storage_create(doc);
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
                await this.doc2storage_modify(doc, file);
                queueConflictCheck();
            } else {
                const d = await this.localDatabase.getDBEntryMeta(id2path(change._id), { conflicts: true }, true);
                if (d && !d._conflicts) {
                    await this.doc2storage_modify(doc, file);
                } else {
                    if (!queueConflictCheck()) {
                        Logger(`${id2path(change._id)} is conflicted, write to the storage has been pended.`, LOG_LEVEL.NOTICE);
                    }
                }
            }
        } else {
            Logger(`${id2path(change._id)} is already exist as the folder`);
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
        const ret = await this.localDatabase.localDatabase.allDocs({ keys: ids, include_docs: true });
        for (const doc of ret.rows) {
            if (doc.doc && !this.queuedFiles.some((e) => e.entry._id == doc.doc._id)) {
                await this.parseIncomingDoc(doc.doc as PouchDB.Core.ExistingDocument<EntryBody & PouchDB.Core.AllDocsMeta>);
            }
        }
    }
    procInternalFiles: string[] = [];
    async execInternalFile() {
        await runWithLock("execinternal", false, async () => {
            const w = [...this.procInternalFiles];
            this.procInternalFiles = [];
            Logger(`Applying hidden ${w.length} files change...`);
            await this.syncInternalFilesAndDatabase("pull", false, false, w);
            Logger(`Applying hidden ${w.length} files changed`);
        });
    }
    procInternalFile(filename: string) {
        this.procInternalFiles.push(filename);
        setTrigger("procInternal", 500, async () => {
            await this.execInternalFile();
        });
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
                    const filename = id2path(id2filenameInternalMetadata(queue.entry._id));
                    // await this.syncInternalFilesAndDatabase("pull", false, false, [filename])
                    this.procInternalFile(filename);
                }
                if (isValidPath(id2path(queue.entry._id))) {
                    this.handleDBChanged(queue.entry);
                }
            } else if (now > queue.timeout) {
                if (!queue.warned) Logger(`Timed out: ${queue.entry._id} could not collect ${queue.missingChildren.length} chunks. plugin keeps watching, but you have to check the file after the replication.`, LOG_LEVEL.NOTICE);
                queue.warned = true;
                continue;
            }
        }
        this.queuedFiles = this.queuedFiles.filter((e) => !e.done);
        this.queuedFilesStore.set({ queuedItems: this.queuedFiles, fileEventItems: this.watchedFileEventQueue });
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
        if (!this.isTargetFile(id2path(doc._id))) return;
        const skipOldFile = this.settings.skipOlderFilesOnSync && false; //patched temporary.
        if ((!isInternalMetadata(doc._id)) && skipOldFile) {
            const info = getAbstractFileByPath(id2path(doc._id));

            if (info && info instanceof TFile) {
                const localMtime = ~~((info as TFile).stat.mtime / 1000);
                const docMtime = ~~(doc.mtime / 1000);
                //TODO: some margin required.
                if (localMtime >= docMtime) {
                    Logger(`${doc._id} Skipped, older than storage.`, LOG_LEVEL.VERBOSE);
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
        // If `Read chunks online` is enabled, retrieve chunks from the remote CouchDB directly.
        if ((!this.settings.readChunksOnline) && "children" in doc) {
            const c = await this.localDatabase.localDatabase.allDocs({ keys: doc.children, include_docs: false });
            const missing = c.rows.filter((e) => "error" in e).map((e) => e.key);
            // fetch from remote
            if (missing.length > 0) Logger(`${doc._id}(${doc._rev}) Queued (waiting ${missing.length} items)`, LOG_LEVEL.VERBOSE);
            newQueue.missingChildren = missing;
            this.queuedFiles.push(newQueue);
        } else {
            this.queuedFiles.push(newQueue);
        }
        this.saveQueuedFiles();
        this.procQueuedFiles();
    }
    periodicSyncHandler: number = null;

    //---> Sync
    async parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): Promise<void> {
        for (const change of docs) {
            if (isPluginMetadata(change._id)) {
                if (this.settings.notifyPluginOrSettingUpdated) {
                    this.triggerCheckPluginUpdate();
                }
                continue;
            }
            if (isChunk(change._id)) {
                await this.parseIncomingChunk(change);
                continue;
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
                    this.localDatabase.closeReplication();
                    Logger(`Remote database updated to incompatible version. update your self-hosted-livesync plugin.`, LOG_LEVEL.NOTICE);
                }
            }
        }
    }

    triggerCheckPluginUpdate() {
        (async () => await this.checkPluginUpdate())();
    }

    async checkPluginUpdate() {
        if (!this.settings.usePluginSync) return;
        await this.sweepPlugin(false);
        const { allPlugins, thisDevicePlugins } = await this.getPluginList();
        const arrPlugins = Object.values(allPlugins);
        let updateFound = false;
        for (const plugin of arrPlugins) {
            const ownPlugin = thisDevicePlugins[plugin.manifest.id];
            if (ownPlugin) {
                const remoteVersion = versionNumberString2Number(plugin.manifest.version);
                const ownVersion = versionNumberString2Number(ownPlugin.manifest.version);
                if (remoteVersion > ownVersion) {
                    updateFound = true;
                }
                if (((plugin.mtime / 1000) | 0) > ((ownPlugin.mtime / 1000) | 0) && (plugin.dataJson ?? "") != (ownPlugin.dataJson ?? "")) {
                    updateFound = true;
                }
            }
        }
        if (updateFound) {
            const fragment = createFragment((doc) => {
                doc.createEl("a", null, (a) => {
                    a.text = "There're some new plugins or their settings";
                    a.addEventListener("click", () => this.showPluginSyncModal());
                });
            });
            NewNotice(fragment, 10000);
        } else {
            Logger("Everything is up to date.", LOG_LEVEL.NOTICE);
        }
    }

    clearPeriodicSync() {
        if (this.periodicSyncHandler != null) {
            clearInterval(this.periodicSyncHandler);
            this.periodicSyncHandler = null;
        }
    }

    setPeriodicSync() {
        this.clearPeriodicSync();
        if (this.settings.periodicReplication && this.settings.periodicReplicationInterval > 0) {
            this.periodicSyncHandler = this.setInterval(async () => await this.periodicSync(), Math.max(this.settings.periodicReplicationInterval, 30) * 1000);
        }
    }

    async periodicSync() {
        await this.replicate();
    }

    periodicPluginSweepHandler: number = null;

    clearPluginSweep() {
        if (this.periodicPluginSweepHandler != null) {
            clearInterval(this.periodicPluginSweepHandler);
            this.periodicPluginSweepHandler = null;
        }
    }

    setPluginSweep() {
        if (this.settings.autoSweepPluginsPeriodic && !this.settings.watchInternalFileChanges) {
            this.clearPluginSweep();
            this.periodicPluginSweepHandler = this.setInterval(async () => await this.periodicPluginSweep(), PERIODIC_PLUGIN_SWEEP * 1000);
        }
    }

    async periodicPluginSweep() {
        await this.sweepPlugin(false);
    }

    async realizeSettingSyncMode() {
        this.localDatabase.closeReplication();
        this.clearPeriodicSync();
        this.clearPluginSweep();
        this.clearInternalFileScan();
        await this.applyBatchChange();
        // disable all sync temporary.
        if (this.suspended) return;
        if (this.settings.autoSweepPlugins) {
            await this.sweepPlugin(false);
        }
        if (this.settings.liveSync) {
            this.localDatabase.openReplication(this.settings, true, false, this.parseReplicationResult);
        }
        if (this.settings.syncInternalFiles) {
            await this.syncInternalFilesAndDatabase("safe", false);
        }
        this.setPeriodicSync();
        this.setPluginSweep();
        this.setPeriodicInternalFileScan();
    }

    lastMessage = "";

    observeForLogs() {
        const observer__ = observeStores(this.queuedFilesStore, lockStore);
        const observer = observeStores(observer__, this.localDatabase.stat);

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
            if (this.settings.batchSave) {
                waiting = " " + this.watchedFileEventQueue.map((e) => "🛫").join("");
                waiting = waiting.replace(/(🛫){10}/g, "🚀");
            }
            let queued = "";
            const queue = Object.entries(e.queuedItems).filter((e) => !e[1].warned);
            const queuedCount = queue.length;

            if (queuedCount) {
                const pieces = queue.map((e) => e[1].missingChildren).reduce((prev, cur) => prev + cur.length, 0);
                queued = ` 🧩 ${queuedCount} (${pieces})`;
            }
            const processes = e.count;
            const processesDisp = processes == 0 ? "" : ` ⏳${processes}`;
            const message = `Sync: ${w} ↑${sent}${pushLast} ↓${arrived}${pullLast}${waiting}${processesDisp}${queued}`;
            // const locks = getLocks();
            const pendingTask = e.pending.length
                ? "\nPending: " +
                Object.entries(e.pending.reduce((p, c) => ({ ...p, [c]: (p[c] ?? 0) + 1 }), {} as { [key: string]: number }))
                    .map((e) => `${e[0]}${e[1] == 1 ? "" : `(${e[1]})`}`)
                    .join(", ")
                : "";

            const runningTask = e.running.length
                ? "\nRunning: " +
                Object.entries(e.running.reduce((p, c) => ({ ...p, [c]: (p[c] ?? 0) + 1 }), {} as { [key: string]: number }))
                    .map((e) => `${e[0]}${e[1] == 1 ? "" : `(${e[1]})`}`)
                    .join(", ")
                : "";
            this.setStatusBarText(message + pendingTask + runningTask);
        })
    }

    refreshStatusText() {
        return;
    }

    logHideTimer: NodeJS.Timeout = null;
    setStatusBarText(message: string = null, log: string = null) {
        if (!this.statusBar) return;
        const newMsg = typeof message == "string" ? message : this.lastMessage;
        const newLog = typeof log == "string" ? log : this.lastLog;
        if (`${this.lastMessage}-${this.lastLog}` != `${newMsg}-${newLog}`) {
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
            if (this.logHideTimer != null) {
                clearTimeout(this.logHideTimer);
            }
            this.logHideTimer = setTimeout(() => this.setStatusBarText(null, ""), 3000);
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
        if (this.settings.autoSweepPlugins) {
            await this.sweepPlugin(showMessage);
        }
        await this.loadQueuedFiles();
        if (this.settings.syncInternalFiles && this.settings.syncInternalFilesBeforeReplication && !this.settings.watchInternalFileChanges) {
            await this.syncInternalFilesAndDatabase("push", showMessage);
        }
        this.localDatabase.openReplication(this.settings, false, showMessage, this.parseReplicationResult);
    }

    async initializeDatabase(showingNotice?: boolean) {
        this.isReady = false;
        if (await this.openDatabase()) {
            if (this.localDatabase.isReady) {
                await this.syncAllFiles(showingNotice);
            }
            if (this.settings.syncInternalFiles) {
                await this.syncInternalFilesAndDatabase("push", showingNotice);
            }
            if (this.settings.usePluginSync) {
                await this.sweepPlugin(showingNotice);
            }
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
        if (this.settings.autoSweepPlugins) {
            await this.sweepPlugin(showingNotice);
        }
        return await this.localDatabase.replicateAllToServer(this.settings, showingNotice);
    }

    async markRemoteLocked() {
        return await this.localDatabase.markRemoteLocked(this.settings, true);
    }

    async markRemoteUnlocked() {
        return await this.localDatabase.markRemoteLocked(this.settings, false);
    }

    async markRemoteResolved() {
        return await this.localDatabase.markRemoteResolved(this.settings);
    }

    async syncAllFiles(showingNotice?: boolean) {
        // synchronize all files between database and storage.
        let initialScan = false;
        if (showingNotice) {
            Logger("Initializing", LOG_LEVEL.NOTICE, "syncAll");
        }

        await this.collectDeletedFiles();

        const filesStorage = this.app.vault.getFiles().filter(e => this.isTargetFile(e));
        const filesStorageName = filesStorage.map((e) => e.path);
        const wf = await this.localDatabase.localDatabase.allDocs();
        const filesDatabase = wf.rows.filter((e) =>
            !isChunk(e.id) &&
            !isPluginMetadata(e.id) &&
            e.id != "obsydian_livesync_version" &&
            e.id != "_design/replicate"
        )
            .filter(e => isValidPath(e.id)).map((e) => id2path(e.id)).filter(e => this.isTargetFile(e));
        const isInitialized = await (this.localDatabase.kvDB.get<boolean>("initialized")) || false;
        // Make chunk bigger if it is the initial scan. There must be non-active docs.
        if (filesDatabase.length == 0 && !isInitialized) {
            initialScan = true;
            Logger("Database looks empty, save files as initial sync data");
        }
        const onlyInStorage = filesStorage.filter((e) => filesDatabase.indexOf(e.path) == -1);
        const onlyInDatabase = filesDatabase.filter((e) => filesStorageName.indexOf(e) == -1);

        const onlyInStorageNames = onlyInStorage.map((e) => e.path);

        const syncFiles = filesStorage.filter((e) => onlyInStorageNames.indexOf(e.path) == -1);
        Logger("Initialize and checking database files");
        Logger("Updating database by new files");
        this.setStatusBarText(`UPDATE DATABASE`);

        const runAll = async<T>(procedureName: string, objects: T[], callback: (arg: T) => Promise<void>) => {
            // const count = objects.length;
            Logger(procedureName);
            // let i = 0;
            const semaphore = Semaphore(25);

            // Logger(`${procedureName} exec.`);
            if (!this.localDatabase.isReady) throw Error("Database is not ready!");
            const processes = objects.map(e => (async (v) => {
                const releaser = await semaphore.acquire(1, procedureName);

                try {
                    await callback(v);
                    // i++;
                    // if (i % 50 == 0) {
                    //     const notify = `${procedureName} : ${i}/${count}`;
                    //     if (showingNotice) {
                    //         Logger(notify, LOG_LEVEL.NOTICE, "syncAll");
                    //     } else {
                    //         Logger(notify);
                    //     }
                    // this.setStatusBarText(notify);
                    // }
                } catch (ex) {
                    Logger(`Error while ${procedureName}`, LOG_LEVEL.NOTICE);
                    Logger(ex);
                } finally {
                    releaser();
                }
            }
            )(e));
            await Promise.all(processes);

            Logger(`${procedureName} done.`);
        };

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
            caches = await this.localDatabase.kvDB.get<{ [key: string]: { storageMtime: number; docMtime: number } }>("diff-caches") || {};
            const docsCount = syncFiles.length;
            do {
                const syncFilesX = syncFiles.splice(0, 100);
                const docs = await this.localDatabase.localDatabase.allDocs({ keys: syncFilesX.map(e => path2id(e.path)), include_docs: true })
                const syncFilesToSync = syncFilesX.map((e) => ({ file: e, doc: docs.rows.find(ee => ee.id == path2id(e.path)).doc as LoadedEntry }));

                await runAll(`CHECK FILE STATUS:${syncFiles.length}/${docsCount}`, syncFilesToSync, async (e) => {
                    caches = await this.syncFileBetweenDBandStorage(e.file, e.doc, initialScan, caches);
                });
            } while (syncFiles.length > 0);
            await this.localDatabase.kvDB.set("diff-caches", caches);
        }

        this.setStatusBarText(`NOW TRACKING!`);
        Logger("Initialized, NOW TRACKING!");
        if (!isInitialized) {
            await (this.localDatabase.kvDB.set("initialized", true))
        }
        if (showingNotice) {
            Logger("Initialize done!", LOG_LEVEL.NOTICE, "syncAll");
        }
    }

    async deleteFolderOnDB(folder: TFolder) {
        Logger(`delete folder:${folder.path}`);
        await this.localDatabase.deleteDBEntryPrefix(folder.path + "/");
        for (const v of folder.children) {
            const entry = v as TFile & TFolder;
            Logger(`->entry:${entry.path}`, LOG_LEVEL.VERBOSE);
            if (entry.children) {
                Logger(`->is dir`, LOG_LEVEL.VERBOSE);
                await this.deleteFolderOnDB(entry);
                try {
                    if (this.settings.trashInsteadDelete) {
                        await this.app.vault.trash(entry, false);
                    } else {
                        await this.app.vault.delete(entry);
                    }
                } catch (ex) {
                    if (ex.code && ex.code == "ENOENT") {
                        //NO OP.
                    } else {
                        Logger(`error while delete folder:${entry.path}`, LOG_LEVEL.NOTICE);
                        Logger(ex);
                    }
                }
            } else {
                Logger(`->is file`, LOG_LEVEL.VERBOSE);
                await this.deleteFromDB(entry);
            }
        }
        try {
            if (this.settings.trashInsteadDelete) {
                await this.app.vault.trash(folder, false);
            } else {
                await this.app.vault.delete(folder);
            }
        } catch (ex) {
            if (ex.code && ex.code == "ENOENT") {
                //NO OP.
            } else {
                Logger(`error while delete folder:${folder.path}`, LOG_LEVEL.NOTICE);
                Logger(ex);
            }
        }
    }
    // --> conflict resolving
    async getConflictedDoc(path: string, rev: string): Promise<false | diff_result_leaf> {
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
            if (ex.status && ex.status == 404) {
                return false;
            }
        }
        return false;
    }
    //TODO: TIDY UP
    async mergeSensibly(path: string, baseRev: string, currentRev: string, conflictedRev: string): Promise<Diff[] | false> {
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

    async mergeObject(path: string, baseRev: string, currentRev: string, conflictedRev: string): Promise<string | false> {
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
        const patches = [
            { mtime: leftLeaf.mtime, patch: diffLeft },
            { mtime: rightLeaf.mtime, patch: diffRight }
        ].sort((a, b) => a.mtime - b.mtime);
        let newObj = { ...baseObj };
        try {
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
    async getConflictedStatus(path: string): Promise<diff_check_result> {
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
            const revFrom = (await this.localDatabase.localDatabase.get(path2id(path), { revs_info: true })) as unknown as LoadedEntry & PouchDB.Core.GetMeta;
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

                    const file = getAbstractFileByPath(path) as TFile;
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

    showMergeDialog(filename: string, conflictCheckResult: diff_result): Promise<boolean> {
        return new Promise((res, rej) => {
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
                    const file = getAbstractFileByPath(filename) as TFile;
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
        });
    }

    conflictedCheckFiles: string[] = [];

    // queueing the conflicted file check
    conflictedCheckTimer: number;

    queueConflictedCheck(file: TFile) {
        this.conflictedCheckFiles = this.conflictedCheckFiles.filter((e) => e != file.path);
        this.conflictedCheckFiles.push(file.path);
        if (this.conflictedCheckTimer != null) {
            window.clearTimeout(this.conflictedCheckTimer);
        }
        this.conflictedCheckTimer = window.setTimeout(async () => {
            this.conflictedCheckTimer = null;
            const checkFiles = JSON.parse(JSON.stringify(this.conflictedCheckFiles)) as string[];
            for (const filename of checkFiles) {
                try {
                    const file = getAbstractFileByPath(filename);
                    if (file != null && file instanceof TFile) {
                        await this.showIfConflicted(file.path);
                    }
                } catch (ex) {
                    Logger(ex);
                }
            }
        }, 100);
    }

    async showIfConflicted(filename: string) {
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

    async pullFile(filename: string, fileList?: TFile[], force?: boolean, rev?: string, waitForReady = true) {
        const targetFile = getAbstractFileByPath(id2path(filename));
        if (!this.isTargetFile(id2path(filename))) return;
        if (targetFile == null) {
            //have to create;
            const doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : null, false, waitForReady);
            if (doc === false) {
                Logger(`${filename} Skipped`);
                return;
            }
            await this.doc2storage_create(doc, force);
        } else if (targetFile instanceof TFile) {
            //normal case
            const file = targetFile;
            const doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : null, false, waitForReady);
            if (doc === false) {
                Logger(`${filename} Skipped`);
                return;
            }
            await this.doc2storage_modify(doc, file, force);
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
            const docx = await this.localDatabase.getDBEntry(file.path, null, false, false);
            if (docx != false) {
                await this.doc2storage_modify(docx, file);
            } else {
                Logger("STORAGE <- DB :" + file.path + " Skipped");
            }
            caches[dK] = { storageMtime, docMtime };
            return caches;
        } else {
            // Logger("EVEN :" + file.path, LOG_LEVEL.VERBOSE);
            // Logger(`${storageMtime} = ${docMtime}`, LOG_LEVEL.VERBOSE);
            //eq.case
        }
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
                content = await arrayBufferToBase64(contentBin);
                datatype = "newnote";
            } else {
                content = await this.app.vault.read(file);
                datatype = "plain";
            }
        } else {
            if (cache instanceof ArrayBuffer) {
                content = await arrayBufferToBase64(cache);
                datatype = "newnote"
            } else {
                content = cache;
                datatype = "plain";
            }
        }
        const fullPath = path2id(file.path);
        const d: LoadedEntry = {
            _id: fullPath,
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
        const isNotChanged = await runWithLock("file:" + fullPath, false, async () => {
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
        const fullPath = file.path;
        Logger(`deleteDB By path:${fullPath}`);
        await this.deleteFromDBbyPath(fullPath);
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
    }

    async deleteFromDBbyPath(fullPath: string) {
        await this.localDatabase.deleteDBEntry(fullPath);
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
    }

    async resetLocalDatabase() {
        clearTouched();
        await this.localDatabase.resetDatabase();
        await this.localDatabase.resetLocalOldDatabase();
    }
    async resetLocalOldDatabase() {
        clearTouched();
        await this.localDatabase.resetLocalOldDatabase();
    }

    async tryResetRemoteDatabase() {
        await this.localDatabase.tryResetRemoteDatabase(this.settings);
    }

    async tryCreateRemoteDatabase() {
        await this.localDatabase.tryCreateRemoteDatabase(this.settings);
    }

    async getPluginList(): Promise<{ plugins: PluginList; allPlugins: DevicePluginList; thisDevicePlugins: DevicePluginList }> {
        const db = this.localDatabase.localDatabase;
        const docList = await db.allDocs<PluginDataEntry>({ startkey: PSCHeader, endkey: PSCHeaderEnd, include_docs: false });
        const oldDocs: PluginDataEntry[] = ((await Promise.all(docList.rows.map(async (e) => await this.localDatabase.getDBEntry(e.id)))).filter((e) => e !== false) as LoadedEntry[]).map((e) => JSON.parse(getDocData(e.data)));
        const plugins: { [key: string]: PluginDataEntry[] } = {};
        const allPlugins: { [key: string]: PluginDataEntry } = {};
        const thisDevicePlugins: { [key: string]: PluginDataEntry } = {};
        for (const v of oldDocs) {
            if (typeof plugins[v.deviceVaultName] === "undefined") {
                plugins[v.deviceVaultName] = [];
            }
            plugins[v.deviceVaultName].push(v);
            allPlugins[v._id] = v;
            if (v.deviceVaultName == this.deviceAndVaultName) {
                thisDevicePlugins[v.manifest.id] = v;
            }
        }
        return { plugins, allPlugins, thisDevicePlugins };
    }

    async sweepPlugin(showMessage = false, specificPluginPath = "") {
        if (!this.settings.usePluginSync) return;
        if (!this.localDatabase.isReady) return;
        // @ts-ignore
        const pl = this.app.plugins;
        const manifests: PluginManifest[] = Object.values(pl.manifests);
        let specificPlugin = "";
        if (specificPluginPath != "") {
            specificPlugin = manifests.find(e => e.dir.endsWith("/" + specificPluginPath))?.id ?? "";
        }
        await runWithLock("sweepplugin", true, async () => {
            const logLevel = showMessage ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO;
            if (!this.deviceAndVaultName) {
                Logger("You have to set your device and vault name.", LOG_LEVEL.NOTICE);
                return;
            }
            Logger("Scanning plugins", logLevel);
            const db = this.localDatabase.localDatabase;
            const oldDocs = await db.allDocs({
                startkey: `ps:${this.deviceAndVaultName}-${specificPlugin}`,
                endkey: `ps:${this.deviceAndVaultName}-${specificPlugin}\u{10ffff}`,
                include_docs: true,
            });
            // Logger("OLD DOCS.", LOG_LEVEL.VERBOSE);
            // sweep current plugin.

            const procs = manifests.map(async m => {
                const pluginDataEntryID = `ps:${this.deviceAndVaultName}-${m.id}`;
                try {
                    if (specificPlugin && m.id != specificPlugin) {
                        return;
                    }
                    Logger(`Reading plugin:${m.name}(${m.id})`, LOG_LEVEL.VERBOSE);
                    const path = normalizePath(m.dir) + "/";
                    const adapter = this.app.vault.adapter;
                    const files = ["manifest.json", "main.js", "styles.css", "data.json"];
                    const pluginData: { [key: string]: string } = {};
                    for (const file of files) {
                        const thePath = path + file;
                        if (await adapter.exists(thePath)) {
                            pluginData[file] = await adapter.read(thePath);
                        }
                    }
                    let mtime = 0;
                    if (await adapter.exists(path + "/data.json")) {
                        mtime = (await adapter.stat(path + "/data.json")).mtime;
                    }

                    const p: PluginDataEntry = {
                        _id: pluginDataEntryID,
                        dataJson: pluginData["data.json"],
                        deviceVaultName: this.deviceAndVaultName,
                        mainJs: pluginData["main.js"],
                        styleCss: pluginData["styles.css"],
                        manifest: m,
                        manifestJson: pluginData["manifest.json"],
                        mtime: mtime,
                        type: "plugin",
                    };
                    const d: LoadedEntry = {
                        _id: p._id,
                        data: JSON.stringify(p),
                        ctime: mtime,
                        mtime: mtime,
                        size: 0,
                        children: [],
                        datatype: "plain",
                        type: "plain"
                    };
                    Logger(`check diff:${m.name}(${m.id})`, LOG_LEVEL.VERBOSE);
                    await runWithLock("plugin-" + m.id, false, async () => {
                        const old = await this.localDatabase.getDBEntry(p._id, null, false, false);
                        if (old !== false) {
                            const oldData = { data: old.data, deleted: old._deleted };
                            const newData = { data: d.data, deleted: d._deleted };
                            if (isDocContentSame(oldData.data, newData.data) && oldData.deleted == newData.deleted) {
                                Logger(`Nothing changed:${m.name}`);
                                return;
                            }
                        }
                        await this.localDatabase.putDBEntry(d);
                        Logger(`Plugin saved:${m.name}`, logLevel);
                    });
                } catch (ex) {
                    Logger(`Plugin save failed:${m.name}`, LOG_LEVEL.NOTICE)
                } finally {
                    oldDocs.rows = oldDocs.rows.filter((e) => e.id != pluginDataEntryID);
                }
                //remove saved plugin data.
            }
            );

            await Promise.all(procs);

            const delDocs = oldDocs.rows.map((e) => {
                // e.doc._deleted = true;
                if (e.doc.type == "newnote" || e.doc.type == "plain") {
                    e.doc.deleted = true;
                    if (this.settings.deleteMetadataOfDeletedFiles) {
                        e.doc._deleted = true;
                    }
                } else {
                    e.doc._deleted = true;
                }
                return e.doc;
            });
            Logger(`Deleting old plugin:(${delDocs.length})`, LOG_LEVEL.VERBOSE);
            await db.bulkDocs(delDocs);
            Logger(`Scan plugin done.`, logLevel);
        });
    }

    async applyPluginData(plugin: PluginDataEntry) {
        await runWithLock("plugin-" + plugin.manifest.id, false, async () => {
            const pluginTargetFolderPath = normalizePath(plugin.manifest.dir) + "/";
            const adapter = this.app.vault.adapter;
            // @ts-ignore
            const stat = this.app.plugins.enabledPlugins.has(plugin.manifest.id) == true;
            if (stat) {
                // @ts-ignore
                await this.app.plugins.unloadPlugin(plugin.manifest.id);
                Logger(`Unload plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
            }
            if (plugin.dataJson) await adapter.write(pluginTargetFolderPath + "data.json", plugin.dataJson);
            Logger("wrote:" + pluginTargetFolderPath + "data.json", LOG_LEVEL.NOTICE);
            if (stat) {
                // @ts-ignore
                await this.app.plugins.loadPlugin(plugin.manifest.id);
                Logger(`Load plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
            }
        });
    }

    async applyPlugin(plugin: PluginDataEntry) {
        await runWithLock("plugin-" + plugin.manifest.id, false, async () => {
            // @ts-ignore
            const stat = this.app.plugins.enabledPlugins.has(plugin.manifest.id) == true;
            if (stat) {
                // @ts-ignore
                await this.app.plugins.unloadPlugin(plugin.manifest.id);
                Logger(`Unload plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
            }

            const pluginTargetFolderPath = normalizePath(plugin.manifest.dir) + "/";
            const adapter = this.app.vault.adapter;
            if ((await adapter.exists(pluginTargetFolderPath)) === false) {
                await adapter.mkdir(pluginTargetFolderPath);
            }
            await adapter.write(pluginTargetFolderPath + "main.js", plugin.mainJs);
            await adapter.write(pluginTargetFolderPath + "manifest.json", plugin.manifestJson);
            if (plugin.styleCss) await adapter.write(pluginTargetFolderPath + "styles.css", plugin.styleCss);
            if (stat) {
                // @ts-ignore
                await this.app.plugins.loadPlugin(plugin.manifest.id);
                Logger(`Load plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
            }
        });
    }


    periodicInternalFileScanHandler: number = null;

    clearInternalFileScan() {
        if (this.periodicInternalFileScanHandler != null) {
            clearInterval(this.periodicInternalFileScanHandler);
            this.periodicInternalFileScanHandler = null;
        }
    }

    setPeriodicInternalFileScan() {
        if (this.periodicInternalFileScanHandler != null) {
            this.clearInternalFileScan();
        }
        if (this.settings.syncInternalFiles && this.settings.syncInternalFilesInterval > 0 && !this.settings.watchInternalFileChanges) {
            this.periodicPluginSweepHandler = this.setInterval(async () => await this.periodicInternalFileScan(), this.settings.syncInternalFilesInterval * 1000);
        }
    }

    async periodicInternalFileScan() {
        await this.syncInternalFilesAndDatabase("push", false);
    }

    async getFiles(
        path: string,
        ignoreList: string[],
        filter: RegExp[],
        ignoreFilter: RegExp[],
    ) {

        const w = await this.app.vault.adapter.list(path);
        let files = [
            ...w.files
                .filter((e) => !ignoreList.some((ee) => e.endsWith(ee)))
                .filter((e) => !filter || filter.some((ee) => e.match(ee)))
                .filter((e) => !ignoreFilter || ignoreFilter.every((ee) => !e.match(ee))),
        ];

        L1: for (const v of w.folders) {
            for (const ignore of ignoreList) {
                if (v.endsWith(ignore)) {
                    continue L1;
                }
            }
            if (ignoreFilter && ignoreFilter.some(e => v.match(e))) {
                continue L1;
            }
            files = files.concat(await this.getFiles(v, ignoreList, filter, ignoreFilter));
        }
        return files;
    }

    async scanInternalFiles(): Promise<InternalFileInfo[]> {
        const ignoreFilter = this.settings.syncInternalFilesIgnorePatterns.toLocaleLowerCase()
            .replace(/\n| /g, "")
            .split(",").filter(e => e).map(e => new RegExp(e));
        const root = this.app.vault.getRoot();
        const findRoot = root.path;
        const filenames = (await this.getFiles(findRoot, [], null, ignoreFilter)).filter(e => e.startsWith(".")).filter(e => !e.startsWith(".trash"));
        const files = filenames.map(async e => {
            return {
                path: e,
                stat: await this.app.vault.adapter.stat(e)
            }
        });
        const result: InternalFileInfo[] = [];
        for (const f of files) {
            const w = await f;
            result.push({
                ...w,
                ...w.stat
            })
        }
        return result;
    }

    async storeInternalFileToDatabase(file: InternalFileInfo, forceWrite = false) {
        const id = filename2idInternalMetadata(path2id(file.path));
        const contentBin = await this.app.vault.adapter.readBinary(file.path);
        const content = await arrayBufferToBase64(contentBin);
        const mtime = file.mtime;
        return await runWithLock("file-" + id, false, async () => {
            const old = await this.localDatabase.getDBEntry(id, null, false, false);
            let saveData: LoadedEntry;
            if (old === false) {
                saveData = {
                    _id: id,
                    data: content,
                    mtime,
                    ctime: mtime,
                    datatype: "newnote",
                    size: file.size,
                    children: [],
                    deleted: false,
                    type: "newnote",
                }
            } else {
                if (isDocContentSame(old.data, content) && !forceWrite) {
                    // Logger(`internal files STORAGE --> DB:${file.path}: Not changed`);
                    return;
                }
                saveData =
                {
                    ...old,
                    data: content,
                    mtime,
                    size: file.size,
                    datatype: "newnote",
                    children: [],
                    deleted: false,
                    type: "newnote",
                }
            }

            const ret = await this.localDatabase.putDBEntry(saveData, true);
            Logger(`STORAGE --> DB:${file.path}: (hidden) Done`);
            return ret;
        });
    }

    async deleteInternalFileOnDatabase(filename: string, forceWrite = false) {
        const id = filename2idInternalMetadata(path2id(filename));
        const mtime = new Date().getTime();
        await runWithLock("file-" + id, false, async () => {
            const old = await this.localDatabase.getDBEntry(id, null, false, false) as InternalFileEntry | false;
            let saveData: InternalFileEntry;
            if (old === false) {
                saveData = {
                    _id: id,
                    mtime,
                    ctime: mtime,
                    size: 0,
                    children: [],
                    deleted: true,
                    type: "newnote",
                }
            } else {
                if (old.deleted) {
                    Logger(`STORAGE -x> DB:${filename}: (hidden) already deleted`);
                    return;
                }
                saveData =
                {
                    ...old,
                    mtime,
                    size: 0,
                    children: [],
                    deleted: true,
                    type: "newnote",
                }
            }
            await this.localDatabase.localDatabase.put(saveData);
            Logger(`STORAGE -x> DB:${filename}: (hidden) Done`);

        });
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
    async extractInternalFileFromDatabase(filename: string, force = false) {
        const isExists = await this.app.vault.adapter.exists(filename);
        const id = filename2idInternalMetadata(path2id(filename));

        return await runWithLock("file-" + id, false, async () => {
            const fileOnDB = await this.localDatabase.getDBEntry(id, null, false, false) as false | LoadedEntry;
            if (fileOnDB === false) throw new Error(`File not found on database.:${id}`);
            const deleted = "deleted" in fileOnDB ? fileOnDB.deleted : false;
            if (deleted) {
                if (!isExists) {
                    Logger(`STORAGE <x- DB:${filename}: deleted (hidden) Deleted on DB, but the file is  already not found on storage.`);
                } else {
                    Logger(`STORAGE <x- DB:${filename}: deleted (hidden).`);
                    await this.app.vault.adapter.remove(filename);
                }
                return true;
            }
            if (!isExists) {
                await this.ensureDirectoryEx(filename);
                await this.app.vault.adapter.writeBinary(filename, base64ToArrayBuffer(fileOnDB.data), { mtime: fileOnDB.mtime, ctime: fileOnDB.ctime });
                Logger(`STORAGE <-- DB:${filename}: written (hidden,new${force ? ", force" : ""})`);
                return true;
            } else {
                try {
                    // const stat = await this.app.vault.adapter.stat(filename);
                    // const fileMTime = ~~(stat.mtime/1000);
                    // const docMtime = ~~(old.mtime/1000);
                    const contentBin = await this.app.vault.adapter.readBinary(filename);
                    const content = await arrayBufferToBase64(contentBin);
                    if (content == fileOnDB.data && !force) {
                        // Logger(`STORAGE <-- DB:${filename}: skipped (hidden) Not changed`, LOG_LEVEL.VERBOSE);
                        return true;
                    }
                    await this.app.vault.adapter.writeBinary(filename, base64ToArrayBuffer(fileOnDB.data), { mtime: fileOnDB.mtime, ctime: fileOnDB.ctime });
                    Logger(`STORAGE <-- DB:${filename}: written (hidden, overwrite${force ? ", force" : ""})`);
                    return true;
                } catch (ex) {
                    Logger(ex);
                    return false;
                }
            }
        });
    }

    filterTargetFiles(files: InternalFileInfo[], targetFiles: string[] | false = false) {
        const ignorePatterns = this.settings.syncInternalFilesIgnorePatterns.toLocaleLowerCase()
            .replace(/\n| /g, "")
            .split(",").filter(e => e).map(e => new RegExp(e));
        return files.filter(file => !ignorePatterns.some(e => file.path.match(e))).filter(file => !targetFiles || (targetFiles && targetFiles.indexOf(file.path) !== -1))
    }

    async applyMTimeToFile(file: InternalFileInfo) {
        await this.app.vault.adapter.append(file.path, "", { ctime: file.ctime, mtime: file.mtime });
    }
    confirmPopup: WrappedNotice = null;


    async resolveConflictOnInternalFiles() {
        // Scan all conflicted internal files
        const docs = await this.localDatabase.localDatabase.allDocs({ startkey: ICHeader, endkey: ICHeaderEnd, conflicts: true, include_docs: true });
        for (const row of docs.rows) {
            const doc = row.doc;
            if (!("_conflicts" in doc)) continue;
            if (isInternalMetadata(row.id)) {
                await this.resolveConflictOnInternalFile(row.id);
            }
        }
    }

    async resolveConflictOnInternalFile(id: string): Promise<boolean> {
        // Retrieve data
        const doc = await this.localDatabase.localDatabase.get(id, { conflicts: true });
        // If there is no conflict, return with false.
        if (!("_conflicts" in doc)) return false;
        if (doc._conflicts.length == 0) return false;
        Logger(`Hidden file conflicted:${id2filenameInternalMetadata(id)}`);
        const conflicts = doc._conflicts.sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
        const revA = doc._rev;
        const revB = conflicts[0];

        if (doc._id.endsWith(".json")) {
            const conflictedRev = conflicts[0];
            const conflictedRevNo = Number(conflictedRev.split("-")[0]);
            //Search 
            const revFrom = (await this.localDatabase.localDatabase.get(id, { revs_info: true })) as unknown as LoadedEntry & PouchDB.Core.GetMeta;
            const commonBase = revFrom._revs_info.filter(e => e.status == "available" && Number(e.rev.split("-")[0]) < conflictedRevNo).first()?.rev ?? "";
            const result = await this.mergeObject(id, commonBase, doc._rev, conflictedRev);
            if (result) {
                Logger(`Object merge:${id}`, LOG_LEVEL.INFO);
                const filename = id2filenameInternalMetadata(id);
                const isExists = await this.app.vault.adapter.exists(filename);
                if (!isExists) {
                    await this.ensureDirectoryEx(filename);
                }
                await this.app.vault.adapter.write(filename, result);
                const stat = await this.app.vault.adapter.stat(filename);
                await this.storeInternalFileToDatabase({ path: filename, ...stat });
                await this.extractInternalFileFromDatabase(filename);
                await this.localDatabase.localDatabase.remove(id, revB);
                return this.resolveConflictOnInternalFile(id);
            } else {
                Logger(`Object merge is not applicable.`, LOG_LEVEL.VERBOSE);
            }
        }
        const revBDoc = await this.localDatabase.localDatabase.get(id, { rev: revB });
        // determine which revision should been deleted.
        // simply check modified time
        const mtimeA = ("mtime" in doc && doc.mtime) || 0;
        const mtimeB = ("mtime" in revBDoc && revBDoc.mtime) || 0;
        // Logger(`Revisions:${new Date(mtimeA).toLocaleString} and ${new Date(mtimeB).toLocaleString}`);
        // console.log(`mtime:${mtimeA} - ${mtimeB}`);
        const delRev = mtimeA < mtimeB ? revA : revB;
        // delete older one.
        await this.localDatabase.localDatabase.remove(id, delRev);
        Logger(`Older one has been deleted:${id2filenameInternalMetadata(id)}`);
        // check the file again 
        return this.resolveConflictOnInternalFile(id);

    }
    //TODO: Tidy up. Even though it is experimental feature, So dirty...
    async syncInternalFilesAndDatabase(direction: "push" | "pull" | "safe", showMessage: boolean, files: InternalFileInfo[] | false = false, targetFiles: string[] | false = false) {
        await this.resolveConflictOnInternalFiles();
        const logLevel = showMessage ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO;
        Logger("Scanning hidden files.", logLevel, "sync_internal");
        const ignorePatterns = this.settings.syncInternalFilesIgnorePatterns.toLocaleLowerCase()
            .replace(/\n| /g, "")
            .split(",").filter(e => e).map(e => new RegExp(e));
        if (!files) files = await this.scanInternalFiles();
        const filesOnDB = ((await this.localDatabase.localDatabase.allDocs({ startkey: ICHeader, endkey: ICHeaderEnd, include_docs: true })).rows.map(e => e.doc) as InternalFileEntry[]).filter(e => !e.deleted);

        const allFileNamesSrc = [...new Set([...files.map(e => normalizePath(e.path)), ...filesOnDB.map(e => normalizePath(id2path(id2filenameInternalMetadata(e._id))))])];
        const allFileNames = allFileNamesSrc.filter(filename => !targetFiles || (targetFiles && targetFiles.indexOf(filename) !== -1))
        function compareMTime(a: number, b: number) {
            const wa = ~~(a / 1000);
            const wb = ~~(b / 1000);
            const diff = wa - wb;
            return diff;
        }

        const fileCount = allFileNames.length;
        let processed = 0;
        let filesChanged = 0;
        // count updated files up as like this below:
        // .obsidian: 2
        // .obsidian/workspace: 1
        // .obsidian/plugins: 1
        // .obsidian/plugins/recent-files-obsidian: 1
        // .obsidian/plugins/recent-files-obsidian/data.json: 1
        const updatedFolders: { [key: string]: number } = {}
        const countUpdatedFolder = (path: string) => {
            const pieces = path.split("/");
            let c = pieces.shift();
            let pathPieces = "";
            filesChanged++;
            while (c) {
                pathPieces += (pathPieces != "" ? "/" : "") + c;
                pathPieces = normalizePath(pathPieces);
                if (!(pathPieces in updatedFolders)) {
                    updatedFolders[pathPieces] = 0;
                }
                updatedFolders[pathPieces]++;
                c = pieces.shift();
            }
        }
        const p = [] as Promise<void>[];
        const semaphore = Semaphore(15);
        // Cache update time information for files which have already been processed (mainly for files that were skipped due to the same content)
        let caches: { [key: string]: { storageMtime: number; docMtime: number } } = {};
        caches = await this.localDatabase.kvDB.get<{ [key: string]: { storageMtime: number; docMtime: number } }>("diff-caches-internal") || {};
        for (const filename of allFileNames) {
            processed++;
            if (processed % 100 == 0) Logger(`Hidden file: ${processed}/${fileCount}`, logLevel, "sync_internal");
            if (ignorePatterns.some(e => filename.match(e))) continue;

            const fileOnStorage = files.find(e => e.path == filename);
            const fileOnDatabase = filesOnDB.find(e => e._id == filename2idInternalMetadata(id2path(filename)));
            const addProc = async (p: () => Promise<void>): Promise<void> => {
                const releaser = await semaphore.acquire(1);
                try {
                    return p();
                } catch (ex) {
                    Logger("Some process failed", logLevel)
                    Logger(ex);
                } finally {
                    releaser();
                }
            }
            const cache = filename in caches ? caches[filename] : { storageMtime: 0, docMtime: 0 };

            p.push(addProc(async () => {
                if (fileOnStorage && fileOnDatabase) {
                    // Both => Synchronize
                    if (fileOnDatabase.mtime == cache.docMtime && fileOnStorage.mtime == cache.storageMtime) {
                        return;
                    }
                    const nw = compareMTime(fileOnStorage.mtime, fileOnDatabase.mtime);
                    if (nw > 0) {
                        await this.storeInternalFileToDatabase(fileOnStorage);
                    }
                    if (nw < 0) {
                        // skip if not extraction performed.
                        if (!await this.extractInternalFileFromDatabase(filename)) return;
                    }
                    // If process successfully updated or file contents are same, update cache.
                    cache.docMtime = fileOnDatabase.mtime;
                    cache.storageMtime = fileOnStorage.mtime;
                    caches[filename] = cache;
                    countUpdatedFolder(filename);
                } else if (!fileOnStorage && fileOnDatabase) {
                    if (direction == "push") {
                        if (fileOnDatabase.deleted) return;
                        await this.deleteInternalFileOnDatabase(filename, false);
                    } else if (direction == "pull") {
                        if (await this.extractInternalFileFromDatabase(filename)) {
                            countUpdatedFolder(filename);
                        }
                    } else if (direction == "safe") {
                        if (fileOnDatabase.deleted) return
                        if (await this.extractInternalFileFromDatabase(filename)) {
                            countUpdatedFolder(filename);
                        }
                    }
                } else if (fileOnStorage && !fileOnDatabase) {
                    await this.storeInternalFileToDatabase(fileOnStorage);
                } else {
                    throw new Error("Invalid state on hidden file sync");
                    // Something corrupted?
                }
            }));
        }
        await Promise.all(p);
        await this.localDatabase.kvDB.set("diff-caches-internal", caches);

        // When files has been retrieved from the database. they must be reloaded.
        if (direction == "pull" && filesChanged != 0) {
            const configDir = normalizePath(this.app.vault.configDir);
            // Show notification to restart obsidian when something has been changed in configDir.
            if (configDir in updatedFolders) {
                // Numbers of updated files that is below of configDir.
                let updatedCount = updatedFolders[configDir];
                try {
                    //@ts-ignore
                    const manifests = Object.values(this.app.plugins.manifests) as PluginManifest[];
                    //@ts-ignore
                    const enabledPlugins = this.app.plugins.enabledPlugins as Set<string>;
                    const enabledPluginManifests = manifests.filter(e => enabledPlugins.has(e.id));
                    for (const manifest of enabledPluginManifests) {
                        if (manifest.dir in updatedFolders) {
                            // If notified about plug-ins, reloading Obsidian may not be necessary.
                            updatedCount -= updatedFolders[manifest.dir];
                            const updatePluginId = manifest.id;
                            const updatePluginName = manifest.name;
                            const fragment = createFragment((doc) => {
                                doc.createEl("span", null, (a) => {
                                    a.appendText(`Files in ${updatePluginName} has been updated, Press `)
                                    a.appendChild(a.createEl("a", null, (anchor) => {
                                        anchor.text = "HERE";
                                        anchor.addEventListener("click", async () => {
                                            Logger(`Unloading plugin: ${updatePluginName}`, LOG_LEVEL.NOTICE, "plugin-reload-" + updatePluginId);
                                            // @ts-ignore
                                            await this.app.plugins.unloadPlugin(updatePluginId);
                                            // @ts-ignore
                                            await this.app.plugins.loadPlugin(updatePluginId);
                                            Logger(`Plugin reloaded: ${updatePluginName}`, LOG_LEVEL.NOTICE, "plugin-reload-" + updatePluginId);
                                        });
                                    }))

                                    a.appendText(` to reload ${updatePluginName}, or press elsewhere to dismiss this message.`)
                                });
                            });

                            const updatedPluginKey = "popupUpdated-" + updatePluginId;
                            setTrigger(updatedPluginKey, 1000, async () => {
                                const popup = await memoIfNotExist(updatedPluginKey, () => new Notice(fragment, 0));
                                //@ts-ignore
                                const isShown = popup?.noticeEl?.isShown();
                                if (!isShown) {
                                    memoObject(updatedPluginKey, new Notice(fragment, 0))
                                }
                                setTrigger(updatedPluginKey + "-close", 20000, () => {
                                    const popup = retrieveMemoObject<Notice>(updatedPluginKey)
                                    if (!popup) return;
                                    //@ts-ignore
                                    if (popup?.noticeEl?.isShown()) {
                                        popup.hide();
                                    }
                                    disposeMemoObject(updatedPluginKey);
                                })
                            })
                        }
                    }
                } catch (ex) {
                    Logger("Error on checking plugin status.");
                    Logger(ex, LOG_LEVEL.VERBOSE);

                }

                // If something changes left, notify for reloading Obsidian.
                if (updatedCount != 0) {
                    const fragment = createFragment((doc) => {
                        doc.createEl("span", null, (a) => {
                            a.appendText(`Hidden files have been synchronized, Press `)
                            a.appendChild(a.createEl("a", null, (anchor) => {
                                anchor.text = "HERE";
                                anchor.addEventListener("click", () => {
                                    // @ts-ignore
                                    this.app.commands.executeCommandById("app:reload")
                                });
                            }))

                            a.appendText(` to reload obsidian, or press elsewhere to dismiss this message.`)
                        });
                    });

                    setTrigger("popupUpdated-" + configDir, 1000, () => {
                        //@ts-ignore
                        const isShown = this.confirmPopup?.noticeEl?.isShown();
                        if (!isShown) {
                            this.confirmPopup = new Notice(fragment, 0);
                        }
                        setTrigger("popupClose" + configDir, 20000, () => {
                            this.confirmPopup?.hide();
                            this.confirmPopup = null;
                        })
                    })
                }
            }
        }

        Logger(`Hidden files scanned: ${filesChanged} files had been modified`, logLevel, "sync_internal");
    }

    isTargetFile(file: string | TAbstractFile) {
        if (file instanceof TFile) {
            return this.localDatabase.isTargetFile(file.path);
        } else if (typeof file == "string") {
            return this.localDatabase.isTargetFile(file);
        }
    }

}
