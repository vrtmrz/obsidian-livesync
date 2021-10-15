import { App, debounce, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, addIcon, TFolder } from "obsidian";
import { PouchDB } from "./pouchdb-browser-webpack/dist/pouchdb-browser";
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from "diff-match-patch";

// docs should be encoded as base64, so 1 char -> 1 bytes
// and cloudant limitation is 1MB , we use 900kb;
// const MAX_DOC_SIZE = 921600;
const MAX_DOC_SIZE = 921600;

interface ObsidianLiveSyncSettings {
    couchDB_URI: string;
    couchDB_USER: string;
    couchDB_PASSWORD: string;
    liveSync: boolean;
    syncOnSave: boolean;
    syncOnStart: boolean;
    savingDelay: number;
    lessInformationInLog: boolean;
}

const DEFAULT_SETTINGS: ObsidianLiveSyncSettings = {
    couchDB_URI: "",
    couchDB_USER: "",
    couchDB_PASSWORD: "",
    liveSync: false,
    syncOnSave: false,
    syncOnStart: false,
    savingDelay: 200,
    lessInformationInLog: false,
};

interface Entry {
    _id: string;
    data: string;
    _rev?: string;
    ctime: number;
    mtime: number;
    size: number;
    _deleted?: boolean;
    type?: "notes";
}
interface NewEntry {
    _id: string;
    children: string[];
    _rev?: string;
    ctime: number;
    mtime: number;
    size: number;
    _deleted?: boolean;
    NewNote: true;
    type: "newnote";
}
type LoadedEntry = Entry & {
    children: string[];
};

interface EntryLeaf {
    _id: string;
    parent: string;
    seq: number;
    data: string;
    _rev?: string;
    _deleted?: boolean;
    type: "leaf";
}
type EntryDoc = Entry | NewEntry | LoadedEntry | EntryLeaf;
type diff_result_leaf = {
    rev: string;
    data: string;
    ctime: number;
    mtime: number;
};
type dmp_result = Array<[number, string]>;

type diff_result = {
    left: diff_result_leaf;
    right: diff_result_leaf;
    diff: dmp_result;
};
type diff_check_result = boolean | diff_result;

type Credential = {
    username: string;
    password: string;
};

//-->Functions.
function arrayBufferToBase64(buffer: ArrayBuffer) {
    var binary = "";
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    try {
        var binary_string = window.atob(base64);
        var len = binary_string.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    } catch (ex) {
        return null;
    }
}
function base64ToString(base64: string): string {
    try {
        var binary_string = window.atob(base64);
        var len = binary_string.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
    } catch (ex) {
        return null;
    }
}

const escapeStringToHTML = (str: string) => {
    if (!str) return;
    return str.replace(/[<>&"'`]/g, (match) => {
        const escape: any = {
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            '"': "&quot;",
            "'": "&#39;",
            "`": "&#x60;",
        };
        return escape[match];
    });
};
const isValidRemoteCouchDBURI = (uri: string): boolean => {
    if (uri.startsWith("https://")) return true;
    if (uri.startsWith("http://")) return true;
    return false;
};
const connectRemoteCouchDB = async (uri: string, auth: { username: string; password: string }): Promise<false | { db: PouchDB.Database; info: any }> => {
    if (!isValidRemoteCouchDBURI(uri)) false;
    let db = new PouchDB(uri, {
        auth,
    });
    try {
        let info = await db.info();
        return { db: db, info: info };
    } catch (ex) {
        return;
    }
};

//<--Functions

class LocalPouchDB {
    app: App;
    plugin: ObsidianLiveSyncPlugin;
    auth: Credential;
    dbname: string;
    addLog: (message: any, isNotify?: boolean) => Promise<void>;
    localDatabase: PouchDB.Database<EntryDoc>;

    constructor(app: App, plugin: ObsidianLiveSyncPlugin, dbname: string) {
        this.plugin = plugin;
        this.app = app;
        this.auth = {
            username: "",
            password: "",
        };
        this.dbname = dbname;

        this.addLog = this.plugin.addLog;
        this.initializeDatabase();
    }
    close() {
        this.localDatabase.close();
    }
    status() {
        if (this.syncHandler == null) {
            return "connected";
        }
        return "disabled";
    }
    initializeDatabase() {
        if (this.localDatabase != null) this.localDatabase.close();
        this.localDatabase = null;
        this.localDatabase = new PouchDB<EntryDoc>(this.dbname + "-livesync", {
            auto_compaction: true,
            revs_limit: 100,
            deterministic_revs: true,
        });
    }

    async getDatabaseDoc(id: string, opt?: any): Promise<false | LoadedEntry> {
        try {
            let obj: EntryDoc & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta = null;
            if (opt) {
                obj = await this.localDatabase.get(id, opt);
            } else {
                obj = await this.localDatabase.get(id);
            }

            if (obj.type && obj.type == "leaf") {
                //do nothing for leaf;
                return false;
            }

            //Check it out and fix docs to regular case
            if (!obj.type || (obj.type && obj.type == "notes")) {
                let note = obj as Entry;
                let doc: LoadedEntry = {
                    data: note.data,
                    _id: note._id,
                    ctime: note.ctime,
                    mtime: note.mtime,
                    size: note.size,
                    _deleted: obj._deleted,
                    _rev: obj._rev,
                    children: [],
                };
                return doc;
                // simple note
            }
            if (obj.type == "newnote") {
                // search childrens
                try {
                    let childrens = [];
                    // let childPromise = [];
                    for (var v of obj.children) {
                        // childPromise.push(this.localDatabase.get(v));
                        let elem = await this.localDatabase.get(v);
                        if (elem.type && elem.type == "leaf") {
                            childrens.push(elem);
                        } else {
                            throw new Error("linked document is not leaf");
                        }
                    }
                    // let childrens = await Promise.all(childPromise);
                    let data = childrens
                        // .filter((e) => e.type == "leaf")
                        // .map((e) => e as NoteLeaf)
                        .sort((e) => e.seq)
                        .map((e) => e.data)
                        .join("");
                    let doc: LoadedEntry = {
                        data: data,
                        _id: obj._id,
                        ctime: obj.ctime,
                        mtime: obj.mtime,
                        size: obj.size,
                        _deleted: obj._deleted,
                        _rev: obj._rev,
                        children: obj.children,
                    };
                    return doc;
                } catch (ex) {
                    if (ex.status && ex.status == 404) {
                        this.addLog(`Missing document content!, could not read ${obj._id} from database.`, true);
                        // this.addLog(ex);
                    }
                    this.addLog(`Something went wrong on reading ${obj._id} from database.`, true);
                    this.addLog(ex);
                }
            }
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                return false;
            }
            throw ex;
        }
        return false;
    }
    async deleteDBEntry(id: string, opt?: any): Promise<boolean> {
        try {
            let obj: EntryDoc & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta = null;
            if (opt) {
                obj = await this.localDatabase.get(id, opt);
            } else {
                obj = await this.localDatabase.get(id);
            }

            if (obj.type && obj.type == "leaf") {
                //do nothing for leaf;
                return false;
            }
            //Check it out and fix docs to regular case
            if (!obj.type || (obj.type && obj.type == "notes")) {
                // let note = obj as Notes;
                // note._deleted=true;
                obj._deleted = true;
                let r = await this.localDatabase.put(obj);
                return true;
                // simple note
            }
            if (obj.type == "newnote") {
                // search childrens
                for (var v of obj.children) {
                    let d = await this.localDatabase.get(v);
                    if (d.type != "leaf") {
                        this.addLog(`structure went wrong:${id}-${v}`);
                    }
                    d._deleted = true;
                    await this.localDatabase.put(d);
                    this.addLog(`content removed:${(d as EntryLeaf).seq}`);
                }
                obj._deleted = true;
                await this.localDatabase.put(obj);
                this.addLog(`entry removed:${obj._id}`);
                return true;
            }
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                return false;
            }
            throw ex;
        }
    }

    async putDBEntry(note: LoadedEntry) {
        let leftData = note.data;
        let savenNotes = []; // something occured, kill this .
        let seq = 0;
        let now = Date.now();
        do {
            let piece = leftData.substring(0, MAX_DOC_SIZE);
            leftData = leftData.substring(MAX_DOC_SIZE);
            seq++;
            let leafid = note._id + "-" + now + "-" + seq;
            let d: EntryLeaf = {
                _id: leafid,
                parent: note._id,
                data: piece,
                seq: seq,
                type: "leaf",
            };
            let result = await this.localDatabase.put(d);
            savenNotes.push(leafid);
        } while (leftData != "");
        this.addLog(`note content saven, pieces:${seq}`);
        let newDoc: NewEntry = {
            NewNote: true,
            children: savenNotes,
            _id: note._id,
            ctime: note.ctime,
            mtime: note.mtime,
            size: note.size,
            type: "newnote",
        };

        let deldocs: string[] = [];
        // Here for upsert logic,
        try {
            let old = await this.localDatabase.get(newDoc._id);
            if (!old.type || old.type == "notes") {
                // simple use rev for new doc
                newDoc._rev = old._rev;
            }
            if (old.type == "newnote") {
                //when save finished, we have to garbage collect.
                deldocs = old.children;
                newDoc._rev = old._rev;
            }
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                // NO OP/
            } else {
                throw ex;
            }
        }
        await this.localDatabase.put(newDoc);
        this.addLog(`note saven:${newDoc._id}`);
        let items = 0;
        for (var v of deldocs) {
            items++;
            //TODO: Check for missing link
            let d = await this.localDatabase.get(v);
            d._deleted = true;
            await this.localDatabase.put(d);
        }
        this.addLog(`old content deleted, pieces:${items}`);
    }

    syncHandler: PouchDB.Replication.Sync<{}> = null;

    async openReplication(setting: ObsidianLiveSyncSettings, keepAlive: boolean, showResult: boolean, callback: (e: PouchDB.Core.ExistingDocument<{}>[]) => Promise<void>) {
        let uri = setting.couchDB_URI;
        let auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        if (this.syncHandler != null) {
            this.addLog("Another replication running.", true);
            return false;
        }
        let dbret = await connectRemoteCouchDB(uri, auth);
        if (dbret === false) {
            this.addLog(`could not connect to ${uri}`, true);
            return;
        }
        let syncOption = keepAlive ? { live: true, retry: true } : {};
        let db = dbret.db;

        //replicate once
        let replicate = this.localDatabase.replicate.from(db);
        replicate
            .on("change", async (e) => {
                try {
                    callback(e.docs);
                    this.addLog(`pulled ${e.docs.length} doc(s)`);
                } catch (ex) {
                    this.addLog("Replication callback error");
                    this.addLog(ex);
                }
            })
            .on("complete", async (info) => {
                replicate.removeAllListeners();
                replicate.cancel();
                // this.syncHandler = null;
                this.syncHandler = this.localDatabase.sync(db, syncOption);
                this.syncHandler
                    .on("change", async (e) => {
                        try {
                            callback(e.change.docs);
                            this.addLog(`replicated ${e.change.docs.length} doc(s)`);
                        } catch (ex) {
                            this.addLog("Replication callback error");
                            this.addLog(ex);
                        }
                    })
                    .on("active", () => {
                        this.addLog("Replication activated");
                    })
                    .on("complete", (e) => {
                        this.addLog("Replication completed", showResult);
                        // this.addLog(e);
                        console.dir(this.syncHandler);
                        this.syncHandler = null;
                    })
                    .on("denied", (e) => {
                        this.addLog("Replication denied", true);
                        // this.addLog(e);
                    })
                    .on("error", (e) => {
                        this.addLog("Replication error", true);
                        // this.addLog(e);
                    })
                    .on("paused", (e) => {
                        this.addLog("replication paused");
                        // console.dir(this.syncHandler);
                        // this.addLog(e);
                    });
                // console.dir();
            })
            .on("error", () => {
                this.addLog("Pulling Replication error", true);
            });
    }

    closeReplication() {
        if (this.syncHandler == null) {
            return;
        }
        this.syncHandler.cancel();
        this.syncHandler.removeAllListeners();
        this.syncHandler = null;
        this.addLog("Replication closed");
    }

    async resetDatabase() {
        await this.closeReplication();
        await this.localDatabase.destroy();
        this.localDatabase = null;
        await this.initializeDatabase();
        this.addLog("Local Database Reset", true);
    }
    async tryResetRemoteDatabase(setting: ObsidianLiveSyncSettings) {
        await this.closeReplication();
        await this.closeReplication();
        let uri = setting.couchDB_URI;
        let auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        let con = await connectRemoteCouchDB(uri, auth);
        if (con === false) return;
        try {
            await con.db.destroy();
            this.addLog("Remote Database Destroyed", true);
            await this.tryCreateRemoteDatabase(setting);
        } catch (ex) {
            this.addLog("something happend on Remote Database Destory", true);
        }
    }
    async tryCreateRemoteDatabase(setting: ObsidianLiveSyncSettings) {
        await this.closeReplication();
        let uri = setting.couchDB_URI;
        let auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        let con2 = await connectRemoteCouchDB(uri, auth);
        if (con2 === false) return;
        this.addLog("Remote Database Created or Connected", true);
    }
}

export default class ObsidianLiveSyncPlugin extends Plugin {
    settings: ObsidianLiveSyncSettings;
    //localDatabase: PouchDB.Database<EntryDoc>;
    localDatabase: LocalPouchDB;
    logMessage: string[] = [];
    // onLogChanged: () => void;
    statusBar: HTMLElement;
    statusBar2: HTMLElement;

    async onload() {
        this.addLog = this.addLog.bind(this);
        this.addLog("loading plugin");
        await this.openDatabase();
        await this.loadSettings();
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

        let x = this.addRibbonIcon("view-log", "Show log", () => {
            new LogDisplayModal(this.app, this).open();
        });

        this.statusBar = this.addStatusBarItem();

        this.statusBar2 = this.addStatusBarItem();
        let delay = this.settings.savingDelay;
        if (delay < 200) delay = 200;
        if (delay > 5000) delay = 5000;
        this.watchVaultChange = debounce(this.watchVaultChange.bind(this), delay, false);
        this.watchVaultDelete = debounce(this.watchVaultDelete.bind(this), delay, false);
        this.watchVaultRename = debounce(this.watchVaultRename.bind(this), delay, false);
        this.watchWorkspaceOpen = debounce(this.watchWorkspaceOpen.bind(this), delay, false);
        this.registerWatchEvents();
        this.parseReplicationResult = this.parseReplicationResult.bind(this);

        this.addSettingTab(new ObsidianLiveSyncSettingTab(this.app, this));

        setTimeout(async () => {
            await this.initializeDatabase();
            this.realizeSettingSyncMode();
            if (this.settings.syncOnStart) {
                await this.replicate(false);
            }
        }, 100);

        // when in mobile, too long suspended , connection won't back if setting retry:true
        this.registerInterval(
            window.setInterval(async () => {
                if (this.settings.liveSync) {
                    await this.localDatabase.closeReplication();
                    if (this.settings.liveSync) {
                        this.localDatabase.openReplication(this.settings, true, false, this.parseReplicationResult);
                    }
                }
            }, 60 * 1000)
        );
        this.watchWindowVisiblity = this.watchWindowVisiblity.bind(this);
        window.addEventListener("visibilitychange", this.watchWindowVisiblity);
    }

    onunload() {
        this.localDatabase.closeReplication();
        this.localDatabase.close();
        this.addLog("unloading plugin");
        window.removeEventListener("visibilitychange", this.watchWindowVisiblity);
    }

    async openDatabase() {
        if (this.localDatabase != null) {
            this.localDatabase.close();
        }
        let vaultName = this.app.vault.getName();
        this.localDatabase = new LocalPouchDB(this.app, this, vaultName);
        this.localDatabase.initializeDatabase();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    registerWatchEvents() {
        this.registerEvent(this.app.vault.on("modify", this.watchVaultChange));
        this.registerEvent(this.app.vault.on("delete", this.watchVaultDelete));
        this.registerEvent(this.app.vault.on("rename", this.watchVaultRename));
        this.registerEvent(this.app.vault.on("create", this.watchVaultChange));
        this.registerEvent(this.app.workspace.on("file-open", this.watchWorkspaceOpen));
    }

    watchWindowVisiblity() {
        this.addLog("visiblity changed");
        let isHidden = document.hidden;
        // this.addLog(isHidden);
        if (isHidden) {
            this.localDatabase.closeReplication();
        } else {
            if (this.settings.liveSync) {
                this.localDatabase.openReplication(this.settings, true, false, this.parseReplicationResult);
            }
            if (this.settings.syncOnStart) {
                this.localDatabase.openReplication(this.settings, false, false, this.parseReplicationResult);
            }
        }
    }

    watchWorkspaceOpen(file: TFile) {
        if (file == null) return;
        this.showIfConflicted(file);
    }
    watchVaultChange(file: TFile, ...args: any[]) {
        this.updateIntoDB(file);
    }
    watchVaultDelete(file: TFile & TFolder) {
        if (file.children) {
            //folder
            this.deleteFolderOnDB(file);
            // this.app.vault.delete(file);
        } else {
            this.deleteFromDB(file);
        }
    }
    watchVaultRename(file: TFile & TFolder, oldFile: any) {
        if (file.children) {
            // this.renameFolder(file,oldFile);
            this.addLog(`folder name changed:(this operation is not supported) ${file.path}`);
        } else {
            this.updateIntoDB(file);
            this.deleteFromDBbyPath(oldFile);
        }
    }

    //--> Basic document Functions
    async addLog(message: any, isNotify?: boolean) {
        // debugger;

        if (!isNotify && this.settings && this.settings.lessInformationInLog) {
            return;
        }
        // console.log(this.settings);
        let timestamp = new Date().toLocaleString();
        let messagecontent = typeof message == "string" ? message : JSON.stringify(message, null, 2);
        let newmessage = timestamp + "->" + messagecontent;

        this.logMessage = [].concat(this.logMessage).concat([newmessage]).slice(-100);
        // this.logMessage = [...this.logMessage, timestamp + ":" + newmessage].slice(-100);
        console.log(newmessage);
        if (this.statusBar2 != null) {
            this.statusBar2.setText(newmessage.substring(0, 60));
        }
        // if (this.onLogChanged != null) {
        //     this.onLogChanged();
        // }
        if (isNotify) {
            new Notice(messagecontent);
        }
    }

    async ensureDirectory(fullpath: string) {
        let pathElements = fullpath.split("/");
        pathElements.pop();
        let c = "";
        for (var v of pathElements) {
            c += v;
            try {
                await this.app.vault.createFolder(c);
            } catch (ex) {
                // basically skip exceptions.
                if (ex.message && ex.message == "Folder already exists.") {
                    // especialy this message is.
                } else {
                    this.addLog("Folder Create Error");
                    this.addLog(ex);
                }
            }
            c += "/";
        }
    }

    async doc2storage_create(docEntry: Entry, force?: boolean) {
        let doc = await this.localDatabase.getDatabaseDoc(docEntry._id, { _rev: docEntry._rev });
        if (doc === false) return;
        let bin = base64ToArrayBuffer(doc.data);
        if (bin != null) {
            await this.ensureDirectory(doc._id);
            let newfile = await this.app.vault.createBinary(doc._id, bin, { ctime: doc.ctime, mtime: doc.mtime });
            this.addLog("live : write to local (newfile) " + doc._id);
            await this.app.vault.trigger("create", newfile);
        }
    }

    async deleteVaultItem(file: TFile | TFolder) {
        let dir = file.parent;
        await this.app.vault.delete(file);
        this.addLog(`deleted:${file.path}`);
        this.addLog(`other items:${dir.children.length}`);
        if (dir.children.length == 0) {
            this.addLog(`all files deleted by replication, so delete dir`);
            await this.deleteVaultItem(dir);
        }
    }
    async doc2storate_modify(docEntry: Entry, file: TFile, force?: boolean) {
        if (docEntry._deleted) {
            //basically pass.
            //but if there're no docs left, delete file.
            let lastDocs = await this.localDatabase.getDatabaseDoc(docEntry._id);
            if (lastDocs === false) {
                await this.deleteVaultItem(file);
            } else {
                this.addLog(`delete skipped:${lastDocs._id}`);
            }
            return;
        }

        if (file.stat.mtime < docEntry.mtime || force) {
            let doc = await this.localDatabase.getDatabaseDoc(docEntry._id);
            if (doc === false) return;
            let bin = base64ToArrayBuffer(doc.data);
            if (bin != null) {
                await this.app.vault.modifyBinary(file, bin, { ctime: doc.ctime, mtime: doc.mtime });
                this.addLog("livesync : newer local files so write to local:" + file.path);
                await this.app.vault.trigger("modify", file);
            }
        } else if (file.stat.mtime > docEntry.mtime) {
            // newer local file.
            // ?
        } else {
            //Nothing have to op.
            //eq.case
        }
    }
    async pouchdbChanged(change: Entry) {
        let allfiles = this.app.vault.getFiles();
        let targetFiles = allfiles.filter((e) => e.path == change._id);
        if (targetFiles.length == 0) {
            if (change._deleted) {
                return;
            }
            let doc = change;
            await this.doc2storage_create(doc);
        }
        if (targetFiles.length == 1) {
            let doc = change;
            let file = targetFiles[0];
            await this.doc2storate_modify(doc, file);
            await this.showIfConflicted(file);
        }
    }

    //---> Sync
    async parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<Entry>>): Promise<void> {
        for (var change of docs) {
            this.addLog("replication change arrived");
            await this.pouchdbChanged(change);
        }
    }
    async realizeSettingSyncMode() {
        await this.localDatabase.closeReplication();
        if (this.settings.liveSync) {
            this.localDatabase.openReplication(this.settings, true, false, this.parseReplicationResult);
            this.refreshStatusText();
        }
    }
    refreshStatusText() {
        let statusStr = this.localDatabase.status();
        this.statusBar.setText("Sync:" + statusStr);
    }
    async replicate(showMessage?: boolean) {
        this.localDatabase.openReplication(this.settings, false, showMessage, this.parseReplicationResult);
    }
    //<-- Sync

    async initializeDatabase() {
        await this.openDatabase();
        await this.syncAllFiles();
    }
    async syncAllFiles() {
        // synchronize all files between database and storage.
        const filesStorage = this.app.vault.getFiles();
        const filesStorageName = filesStorage.map((e) => e.path);
        const wf = await this.localDatabase.localDatabase.allDocs();
        const filesDatabase = wf.rows.map((e) => e.id);

        const onlyInStorage = filesStorage.filter((e) => filesDatabase.indexOf(e.path) == -1);
        const onlyInDatabase = filesDatabase.filter((e) => filesStorageName.indexOf(e) == -1);
        //simply realize it
        const onlyInStorageNames = onlyInStorage.map((e) => e.path);

        //have to sync below..
        const syncFiles = filesStorage.filter((e) => onlyInStorageNames.indexOf(e.path) == -1);

        for (let v of onlyInStorage) {
            await this.updateIntoDB(v);
        }
        for (let v of onlyInDatabase) {
            await this.pullFile(v, filesStorage);
        }

        for (let v of syncFiles) {
            await this.syncFileBetweenDBandStorage(v, filesStorage);
        }
    }
    async deleteFolderOnDB(folder: TFolder) {
        this.addLog(`delete folder:${folder.path}`);
        for (var v of folder.children) {
            let entry = v as TFile & TFolder;
            this.addLog(`->entry:${entry.path}`);
            if (entry.children) {
                this.addLog(`->is dir`);
                await this.deleteFolderOnDB(entry);
                try {
                    await this.app.vault.delete(entry);
                } catch (ex) {
                    if (ex.code && ex.code == "ENOENT") {
                        //NO OP.
                    } else {
                        this.addLog(`error while delete filder:${entry.path}`);
                        this.addLog(ex);
                    }
                }
            } else {
                this.addLog(`->is file`);
                await this.deleteFromDB(entry);
            }
        }
        try {
            await this.app.vault.delete(folder);
        } catch (ex) {
            if (ex.code && ex.code == "ENOENT") {
                //NO OP.
            } else {
                this.addLog(`error while delete filder:${folder.path}`);
                this.addLog(ex);
            }
        }
    }

    async renameFolder(folder: TFolder, oldFile: any) {
        for (var v of folder.children) {
            let entry = v as TFile & TFolder;
            if (entry.children) {
                await this.deleteFolderOnDB(entry);
                this.app.vault.delete(entry);
            } else {
                await this.deleteFromDB(entry);
            }
        }
    }

    // --> conflict resolving
    async getConflictedDoc(path: string, rev: string): Promise<false | diff_result_leaf> {
        try {
            let doc = await this.localDatabase.getDatabaseDoc(path, { rev: rev });
            if (doc === false) return false;
            return {
                ctime: doc.ctime,
                mtime: doc.mtime,
                rev: rev,
                data: base64ToString(doc.data),
            };
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                return false;
            }
        }
        return false;
    }
    async getConflictedStatus(path: string): Promise<diff_check_result> {
        let test: LoadedEntry & PouchDB.Core.GetMeta = null;
        try {
            let testDoc = await this.localDatabase.getDatabaseDoc(path, { conflicts: true });
            if (testDoc === false) return false;
            if ("_rev" in testDoc) {
                test = testDoc as any;
            }
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                this.addLog(`Getting conflicted status, but there was not ${path}`);
                // NO OP.
            } else {
                throw ex;
            }
        }
        if (test == null) return false;
        if (!test._conflicts) return false;
        if (test._conflicts.length == 0) return false;
        // should be two or more conflicts;
        let leftLeaf = await this.getConflictedDoc(path, test._rev);
        let rightLeaf = await this.getConflictedDoc(path, test._conflicts[0]);
        if (leftLeaf === false) return false;
        if (rightLeaf === false) return false;
        // first,check for same contents
        if (leftLeaf.data == rightLeaf.data) {
            let leaf = leftLeaf;
            if (leftLeaf.mtime > rightLeaf.mtime) {
                leaf = rightLeaf;
            }
            await this.localDatabase.deleteDBEntry(path, leaf.rev);
            await this.pullFile(path, null, true);
            this.addLog(`automaticaly merged:${path}`);
            return true;
            // }
        }
        let dmp = new diff_match_patch();
        var diff = dmp.diff_main(leftLeaf.data, rightLeaf.data);
        dmp.diff_cleanupSemantic(diff);
        this.addLog(`conflict(s) found:${path}`);
        return {
            left: leftLeaf,
            right: rightLeaf,
            diff: diff,
        };
    }
    async showIfConflicted(file: TFile) {
        let conflictCheckResult = await this.getConflictedStatus(file.path);
        if (conflictCheckResult === false) return; //nothign to do.
        if (conflictCheckResult === true) {
            //auto resolved, but need check again;
            setTimeout(() => {
                this.showIfConflicted(file);
            }, 50);
            return;
        }
        //there conflicts, and have to resolve ;
        let leaf = this.app.workspace.activeLeaf;
        if (leaf) {
            new ConflictResolveModal(this.app, conflictCheckResult, async (selected) => {
                let toDelete = selected;
                if (toDelete == "") {
                    return;
                }
                this.addLog(`resolved conflict:${file.path}`);
                await this.localDatabase.deleteDBEntry(file.path, toDelete);
                await this.pullFile(file.path, null, true);
                setTimeout(() => {
                    //resolved, check again.
                    this.showIfConflicted(file);
                }, 50);
            }).open();
        }
    }
    async pullFile(filename: string, fileList?: TFile[], force?: boolean) {
        if (!fileList) {
            fileList = this.app.vault.getFiles();
        }
        let targetFiles = fileList.filter((e) => e.path == filename);
        if (targetFiles.length == 0) {
            //have to create;
            let doc = await this.localDatabase.getDatabaseDoc(filename);
            if (doc === false) return;
            await this.doc2storage_create(doc, force);
        } else if (targetFiles.length == 1) {
            //normal case
            let file = targetFiles[0];
            let doc = await this.localDatabase.getDatabaseDoc(filename);
            if (doc === false) return;
            await this.doc2storate_modify(doc, file, force);
        } else {
            this.addLog(`target files:${filename} is two or more files in your vault`);
            //something went wrong..
        }
        //when to opened file;
    }
    async syncFileBetweenDBandStorage(file: TFile, fileList?: TFile[]) {
        let doc = await this.localDatabase.getDatabaseDoc(file.path);
        if (doc === false) return;
        if (file.stat.mtime > doc.mtime) {
            //newer local file.
            await this.updateIntoDB(file);
            this.addLog("sync : older databse files so write to database:" + file.path);
        } else if (file.stat.mtime < doc.mtime) {
            //newer database file.
            this.addLog("sync : older storage files so write from database:" + file.path);
            await this.doc2storate_modify(doc, file);
        } else {
            //eq.case
        }
    }

    async updateIntoDB(file: TFile) {
        let contentBin = await this.app.vault.readBinary(file);
        let content = arrayBufferToBase64(contentBin);
        let fullpath = file.path;
        let d: LoadedEntry = {
            _id: fullpath,
            data: content,
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            size: file.stat.size,
            children: [],
        };
        //From here
        let old = await this.localDatabase.getDatabaseDoc(fullpath);
        if (old !== false) {
            let oldData = { data: old.data, deleted: old._deleted };
            let newData = { data: d.data, deleted: d._deleted };
            if (JSON.stringify(oldData) == JSON.stringify(newData)) {
                this.addLog("no changed" + fullpath + (d._deleted ? " (deleted)" : ""));
                return;
            }
            // d._rev = old._rev;
        }
        let ret = await this.localDatabase.putDBEntry(d);

        this.addLog("put database:" + fullpath);
        if (this.settings.syncOnSave) {
            await this.replicate();
        }
    }
    async deleteFromDB(file: TFile) {
        let fullpath = file.path;
        this.addLog(`deleteDB By path:${fullpath}`);
        await this.deleteFromDBbyPath(fullpath);
        if (this.settings.syncOnSave) {
            await this.replicate();
        }
    }
    async deleteFromDBbyPath(fullpath: string) {
        await this.localDatabase.deleteDBEntry(fullpath);
        if (this.settings.syncOnSave) {
            await this.replicate();
        }
    }

    async resetLocalDatabase() {
        await this.localDatabase.resetDatabase();
    }
    async tryResetRemoteDatabase() {
        await this.localDatabase.tryResetRemoteDatabase(this.settings);
    }
    async tryCreateRemoteDatabase() {
        await this.localDatabase.tryCreateRemoteDatabase(this.settings);
    }
}
class LogDisplayModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    logEl: HTMLDivElement;
    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app);
        this.plugin = plugin;
    }
    updateLog() {
        let msg = "";
        for (var v of this.plugin.logMessage) {
            msg += escapeStringToHTML(v) + "<br>";
        }
        this.logEl.innerHTML = msg;
    }
    onOpen() {
        let { contentEl } = this;

        contentEl.empty();
        contentEl.createEl("h2", { text: "Sync Status" });
        let div = contentEl.createDiv("");
        div.addClass("op-scrollable");
        div.addClass("op-pre");
        this.logEl = div;
        this.updateLog = this.updateLog.bind(this);
        // this.plugin.onLogChanged = this.updateLog;
        this.updateLog();
    }
    onClose() {
        let { contentEl } = this;
        contentEl.empty();
        // this.plugin.onLogChanged = null;
    }
}
class ConflictResolveModal extends Modal {
    // result: Array<[number, string]>;
    result: diff_result;
    callback: (remove_rev: string) => Promise<void>;
    constructor(app: App, diff: diff_result, callback: (remove_rev: string) => Promise<void>) {
        super(app);
        this.result = diff;
        this.callback = callback;
    }

    onOpen() {
        let { contentEl } = this;

        contentEl.empty();

        contentEl.createEl("h2", { text: "This document has conflicted changes." });
        let div = contentEl.createDiv("");
        div.addClass("op-scrollable");
        let diff = "";
        // const showContents = this.result.map((e) => (e[0] == 1 ? "<span class='added'>" + htmlEscape(e[1]) + "</span>" : e[0] == -1 ? "<span class='deleted'>" + htmlEscape(e[1]) + "</span>" : "<span class='normal'>" + htmlEscape(e[1]) + "</span>"));
        for (let v of this.result.diff) {
            let x1 = v[0];
            let x2 = v[1];
            if (x1 == DIFF_DELETE) {
                diff += "<span class='deleted'>" + escapeStringToHTML(x2) + "</span>";
            } else if (x1 == DIFF_EQUAL) {
                diff += "<span class='normal'>" + escapeStringToHTML(x2) + "</span>";
            } else if (x1 == DIFF_INSERT) {
                diff += "<span class='added'>" + escapeStringToHTML(x2) + "</span>";
            }
        }

        diff = diff.replace(/\n/g, "<br>");
        div.innerHTML = diff;
        let div2 = contentEl.createDiv("");
        let date1 = new Date(this.result.left.mtime).toLocaleString();
        let date2 = new Date(this.result.right.mtime).toLocaleString();
        div2.innerHTML = `
<span class='deleted'>A:${date1}</span><br /><span class='added'>B:${date2}</span><br> 
        `;
        contentEl.createEl("button", { text: "Keep A" }, (e) => {
            e.addEventListener("click", async () => {
                await this.callback(this.result.right.rev);
                this.close();
            });
        });
        contentEl.createEl("button", { text: "Keep B" }, (e) => {
            e.addEventListener("click", async () => {
                await this.callback(this.result.left.rev);
                this.close();
            });
        });
        contentEl.createEl("button", { text: "Not now" }, (e) => {
            e.addEventListener("click", async () => {
                this.close();
            });
        });
    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}

class ObsidianLiveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianLiveSyncPlugin;

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    async testConnection(): Promise<void> {
        let db = await connectRemoteCouchDB(this.plugin.settings.couchDB_URI, {
            username: this.plugin.settings.couchDB_USER,
            password: this.plugin.settings.couchDB_PASSWORD,
        });
        if (db === false) {
            this.plugin.addLog(`could not connect to ${this.plugin.settings.couchDB_URI}`, true);
            return;
        }
        this.plugin.addLog(`Connected to ${db.info.db_name}`, true);
    }
    display(): void {
        let { containerEl } = this;

        containerEl.empty();

        containerEl.createEl("h2", { text: "Settings for obsidian-livesync." });

        new Setting(containerEl).setName("CouchDB Remote URI").addText((text) =>
            text
                .setPlaceholder("https://........")
                .setValue(this.plugin.settings.couchDB_URI)
                .onChange(async (value) => {
                    this.plugin.settings.couchDB_URI = value;
                    await this.plugin.saveSettings();
                })
        );
        new Setting(containerEl)
            .setName("CouchDB Username")
            .setDesc("username")
            .addText((text) =>
                text
                    .setPlaceholder("")
                    .setValue(this.plugin.settings.couchDB_USER)
                    .onChange(async (value) => {
                        this.plugin.settings.couchDB_USER = value;
                        await this.plugin.saveSettings();
                    })
            );
        new Setting(containerEl)
            .setName("CouchDB Password")
            .setDesc("password")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.couchDB_PASSWORD)
                    .onChange(async (value) => {
                        this.plugin.settings.couchDB_PASSWORD = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "password");
            });
        new Setting(containerEl).setName("Test DB").addButton((button) =>
            button
                .setButtonText("Test Database Connection")
                .setDisabled(false)
                .onClick(async () => {
                    await this.testConnection();
                })
        );

        new Setting(containerEl)
            .setName("File to Database saving delay")
            .setDesc("ms, between 200 and 5000, restart required.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.savingDelay + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 200 || v > 5000) {
                            return 200;
                            //text.inputEl.va;
                        }
                        this.plugin.settings.savingDelay = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });
        new Setting(containerEl)
            .setName("Log")
            .setDesc("Reduce log infomations")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.lessInformationInLog).onChange(async (value) => {
                    this.plugin.settings.lessInformationInLog = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName("LiveSync")
            .setDesc("Sync realtime")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.liveSync).onChange(async (value) => {
                    this.plugin.settings.liveSync = value;
                    await this.plugin.saveSettings();
                    this.plugin.realizeSettingSyncMode();
                })
            );
        new Setting(containerEl)
            .setName("Sync on Save")
            .setDesc("Sync on Save")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
                    this.plugin.settings.syncOnSave = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName("Sync on Start")
            .setDesc("Sync on Start")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.syncOnStart).onChange(async (value) => {
                    this.plugin.settings.syncOnStart = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName("Local Database Operations")
            .addButton((button) =>
                button
                    .setButtonText("Reset local database")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.resetLocalDatabase();
                        //await this.test();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Reset local files")
                    .setDisabled(false)
                    .onClick(async () => {
                        //await this.test();
                    })
            );
        new Setting(containerEl).setName("Remote Database Operations").addButton((button) =>
            button
                .setButtonText("Reset remote database")
                .setDisabled(false)
                .onClick(async () => {
                    await this.plugin.tryResetRemoteDatabase();
                    //await this.test();
                })
        );
        new Setting(containerEl).setName("Remote Database Operations").addButton((button) =>
            button
                .setButtonText("Create remote database")
                .setDisabled(false)
                .onClick(async () => {
                    await this.plugin.tryResetRemoteDatabase();
                    //await this.test();
                })
        );
    }
}
