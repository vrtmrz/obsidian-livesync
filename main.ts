import { App, debounce, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, addIcon, TFolder } from "obsidian";
import { PouchDB } from "./pouchdb-browser-webpack/dist/pouchdb-browser";
import { DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch } from "diff-match-patch";
import xxhash from "xxhash-wasm";

// docs should be encoded as base64, so 1 char -> 1 bytes
// and cloudant limitation is 1MB , we use 900kb;
// const MAX_DOC_SIZE = 921600;
const MAX_DOC_SIZE = 1000; // for .md file, but if delimiters exists. use that before.
const MAX_DOC_SIZE_BIN = 102400; // 100kb
const VER = 10;

const RECENT_MOFIDIED_DOCS_QTY = 30;
const LEAF_WAIT_TIMEOUT = 30000; // in synchronization, waiting missing leaf time out.
const LOG_LEVEL = {
    VERBOSE: 1,
    INFO: 10,
    NOTICE: 100,
    URGENT: 1000,
} as const;
type LOG_LEVEL = typeof LOG_LEVEL[keyof typeof LOG_LEVEL];

interface ObsidianLiveSyncSettings {
    couchDB_URI: string;
    couchDB_USER: string;
    couchDB_PASSWORD: string;
    liveSync: boolean;
    syncOnSave: boolean;
    syncOnStart: boolean;
    savingDelay: number;
    lessInformationInLog: boolean;
    gcDelay: number;
    versionUpFlash: string;
    minimumChunkSize: number;
    longLineThreshold: number;
    showVerboseLog: boolean;
    suspendFileWatching: boolean;
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
    gcDelay: 300,
    versionUpFlash: "",
    minimumChunkSize: 20,
    longLineThreshold: 250,
    showVerboseLog: false,
    suspendFileWatching: false,
};
interface Entry {
    _id: string;
    data: string;
    _rev?: string;
    ctime: number;
    mtime: number;
    size: number;
    _deleted?: boolean;
    _conflicts?: string[];
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
    _conflicts?: string[];
    NewNote: true;
    type: "newnote";
}
interface PlainEntry {
    _id: string;
    children: string[];
    _rev?: string;
    ctime: number;
    mtime: number;
    size: number;
    _deleted?: boolean;
    NewNote: true;
    _conflicts?: string[];
    type: "plain";
}
type LoadedEntry = Entry & {
    children: string[];
    datatype: "plain" | "newnote";
};

interface EntryLeaf {
    _id: string;
    data: string;
    _deleted?: boolean;
    type: "leaf";
    _rev?: string;
}

type EntryBody = Entry | NewEntry | PlainEntry;
type EntryDoc = EntryBody | LoadedEntry | EntryLeaf;

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

type EntryDocResponse = EntryDoc & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta;

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
        return new Uint16Array(
            [].map.call(base64, function (c: string) {
                return c.charCodeAt(0);
            })
        ).buffer;
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
        return base64;
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
        return false;
    }
};

//<--Functions

class LocalPouchDB {
    app: App;
    plugin: ObsidianLiveSyncPlugin;
    auth: Credential;
    dbname: string;
    addLog: (message: any, levlel?: LOG_LEVEL) => Promise<void>;
    localDatabase: PouchDB.Database<EntryDoc>;

    recentModifiedDocs: string[] = [];
    h32: (input: string, seed?: number) => string;
    h64: (input: string, seedHigh?: number, seedLow?: number) => string;
    hashCache: {
        [key: string]: string;
    } = {};
    hashCacheRev: {
        [key: string]: string;
    } = {};

    corruptedEntries: { [key: string]: EntryDoc } = {};

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
    disposeHashCache() {
        this.hashCache = {};
        this.hashCacheRev = {};
    }

    updateRecentModifiedDocs(id: string, rev: string, deleted: boolean) {
        let idrev = id + rev;
        if (deleted) {
            this.recentModifiedDocs = this.recentModifiedDocs.filter((e) => e != idrev);
        } else {
            this.recentModifiedDocs.push(idrev);
            this.recentModifiedDocs = this.recentModifiedDocs.slice(0 - RECENT_MOFIDIED_DOCS_QTY);
        }
    }
    isSelfModified(id: string, rev: string): boolean {
        let idrev = id + rev;
        return this.recentModifiedDocs.indexOf(idrev) !== -1;
    }
    changeHandler: PouchDB.Core.Changes<{}> = null;
    async initializeDatabase() {
        if (this.localDatabase != null) this.localDatabase.close();
        if (this.changeHandler != null) {
            this.changeHandler.cancel();
        }
        this.localDatabase = null;
        this.localDatabase = new PouchDB<EntryDoc>(this.dbname + "-livesync", {
            auto_compaction: true,
            revs_limit: 100,
            deterministic_revs: true,
        });

        // Traceing the leaf id
        let changes = this.localDatabase
            .changes({
                since: "now",
                live: true,
                filter: (doc) => doc.type == "leaf",
            })
            .on("change", (e) => {
                if (e.deleted) return;
                this.leafArrived(e.id);
            });
        this.changeHandler = changes;
        await this.prepareHashFunctions();
    }

    async prepareHashFunctions() {
        if (this.h32 != null) return;
        const { h32, h64 } = await xxhash();
        this.h32 = h32;
        this.h64 = h64;
    }

    // leaf waiting
    leafArrivedCallbacks: { [key: string]: (() => void)[] } = {};

    leafArrived(id: string) {
        if (typeof this.leafArrivedCallbacks[id] !== "undefined") {
            for (let func of this.leafArrivedCallbacks[id]) {
                func();
            }
            delete this.leafArrivedCallbacks[id];
        }
    }
    // wait
    waitForLeafReady(id: string): Promise<boolean> {
        return new Promise((res) => {
            // Set timeout.
            let timer = setTimeout(() => res(false), LEAF_WAIT_TIMEOUT);
            if (typeof this.leafArrivedCallbacks[id] == "undefined") {
                this.leafArrivedCallbacks[id] = [];
            }
            this.leafArrivedCallbacks[id].push(() => {
                clearTimeout(timer);
                res(true);
            });
        });
    }

    async getDBLeaf(id: string): Promise<string> {
        // when in cache, use that.
        if (this.hashCacheRev[id]) {
            return this.hashCacheRev[id];
        }
        try {
            let w = await this.localDatabase.get(id);
            if (w.type == "leaf") {
                this.hashCache[w.data] = id;
                this.hashCacheRev[id] = w.data;
                return w.data;
            }
            throw new Error(`retrive leaf, but it was not leaf.`);
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                // just leaf is not ready.
                // wait for on
                if ((await this.waitForLeafReady(id)) === false) {
                    throw new Error(`time out (waiting leaf)`);
                }
                try {
                    // retrive again.
                    let w = await this.localDatabase.get(id);

                    if (w.type == "leaf") {
                        this.hashCache[w.data] = id;
                        this.hashCacheRev[id] = w.data;
                        return w.data;
                    }
                    throw new Error(`retrive leaf, but it was not leaf.`);
                } catch (ex) {
                    if (ex.status && ex.status == 404) {
                        throw new Error("leaf is not found");
                    }
                    this.addLog(`Something went wrong on retriving leaf`);
                    throw ex;
                }
            } else {
                this.addLog(`Something went wrong on retriving leaf`);
                throw ex;
            }
        }
    }

    async getDBEntry(id: string, opt?: PouchDB.Core.GetOptions, retryCount = 5): Promise<false | LoadedEntry> {
        try {
            let obj: EntryDocResponse = null;
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
                let doc: LoadedEntry & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta = {
                    data: note.data,
                    _id: note._id,
                    ctime: note.ctime,
                    mtime: note.mtime,
                    size: note.size,
                    _deleted: obj._deleted,
                    _rev: obj._rev,
                    _conflicts: obj._conflicts,
                    children: [],
                    datatype: "newnote",
                };
                if (typeof this.corruptedEntries[doc._id] != "undefined") {
                    delete this.corruptedEntries[doc._id];
                }
                return doc;
                // simple note
            }
            if (obj.type == "newnote" || obj.type == "plain") {
                // search childrens
                try {
                    let childrens;
                    try {
                        childrens = await Promise.all(obj.children.map((e) => this.getDBLeaf(e)));
                    } catch (ex) {
                        this.addLog(`Something went wrong on reading elements of ${obj._id} from database.`, LOG_LEVEL.NOTICE);
                        this.corruptedEntries[obj._id] = obj;
                        return false;
                    }

                    let data = childrens.join("");
                    let doc: LoadedEntry & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta = {
                        data: data,
                        _id: obj._id,
                        ctime: obj.ctime,
                        mtime: obj.mtime,
                        size: obj.size,
                        _deleted: obj._deleted,
                        _rev: obj._rev,
                        children: obj.children,
                        datatype: obj.type,
                        _conflicts: obj._conflicts,
                    };
                    if (typeof this.corruptedEntries[doc._id] != "undefined") {
                        delete this.corruptedEntries[doc._id];
                    }
                    return doc;
                } catch (ex) {
                    if (ex.status && ex.status == 404) {
                        this.addLog(`Missing document content!, could not read ${obj._id} from database.`, LOG_LEVEL.NOTICE);
                        return false;
                    }
                    this.addLog(`Something went wrong on reading ${obj._id} from database.`, LOG_LEVEL.NOTICE);
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
    async deleteDBEntry(id: string, opt?: PouchDB.Core.GetOptions): Promise<boolean> {
        try {
            let obj: EntryDocResponse = null;
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
                obj._deleted = true;
                let r = await this.localDatabase.put(obj);
                this.updateRecentModifiedDocs(r.id, r.rev, true);
                if (typeof this.corruptedEntries[obj._id] != "undefined") {
                    delete this.corruptedEntries[obj._id];
                }
                return true;
                // simple note
            }
            if (obj.type == "newnote" || obj.type == "plain") {
                obj._deleted = true;
                let r = await this.localDatabase.put(obj);
                this.addLog(`entry removed:${obj._id}-${r.rev}`);
                this.updateRecentModifiedDocs(r.id, r.rev, true);
                if (typeof this.corruptedEntries[obj._id] != "undefined") {
                    delete this.corruptedEntries[obj._id];
                }
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
        let savenNotes = [];
        let processed = 0;
        let made = 0;
        let skiped = 0;
        let pieceSize = MAX_DOC_SIZE_BIN;
        let plainSplit = false;
        let cacheUsed = 0;
        if (note._id.endsWith(".md")) {
            pieceSize = MAX_DOC_SIZE;
            plainSplit = true;
        }
        do {
            // To keep low bandwith and database size,
            // Dedup pieces on database.
            // from 0.1.10, for best performance. we use markdown delimiters
            // 1. \n[^\n]{longLineThreshold}[^\n]*\n -> long sentence shuld break.
            // 2. \n\n shold break
            // 3. \r\n\r\n should break
            // 4. \n# should break.
            let cPieceSize = pieceSize;
            let minimumChunkSize = this.plugin.settings.minimumChunkSize;
            if (minimumChunkSize < 10) minimumChunkSize = 10;
            let longLineThreshold = this.plugin.settings.longLineThreshold;
            if (longLineThreshold < 100) longLineThreshold = 100;
            if (plainSplit) {
                cPieceSize = 0;
                // lookup for next splittion .
                // we're standing on "\n"
                // debugger
                do {
                    let n1 = leftData.indexOf("\n", cPieceSize + 1);
                    let n2 = leftData.indexOf("\n\n", cPieceSize + 1);
                    let n3 = leftData.indexOf("\r\n\r\n", cPieceSize + 1);
                    let n4 = leftData.indexOf("\n#", cPieceSize + 1);
                    if (n1 == -1 && n2 == -1 && n3 == -1 && n4 == -1) {
                        cPieceSize = MAX_DOC_SIZE;
                        break;
                    }

                    if (n1 > longLineThreshold) {
                        // long sentence is an established piece
                        cPieceSize = n1 + 1;
                    } else {
                        // cPieceSize = Math.min.apply([n2, n3, n4].filter((e) => e > 1));
                        // ^ heavy.
                        if (n2 > 0 && cPieceSize < n2) cPieceSize = n2 + 1;
                        if (n3 > 0 && cPieceSize < n3) cPieceSize = n3 + 3;
                        if (n4 > 0 && cPieceSize < n4) cPieceSize = n4 + 0;
                        cPieceSize++;
                    }
                } while (cPieceSize < minimumChunkSize);
            }

            let piece = leftData.substring(0, cPieceSize);
            leftData = leftData.substring(cPieceSize);
            processed++;
            let leafid = "";
            // Get has of piece.
            let hashedPiece: string = "";
            let hashQ: number = 0; // if hash collided, **IF**, count it up.
            let tryNextHash = false;
            let needMake = true;
            if (typeof this.hashCache[piece] !== "undefined") {
                hashedPiece = "";
                leafid = this.hashCache[piece];
                needMake = false;
                skiped++;
                cacheUsed++;
            } else {
                hashedPiece = this.h32(piece);
                leafid = "h:" + hashedPiece;
                do {
                    let nleafid = leafid;
                    try {
                        nleafid = `${leafid}${hashQ}`;
                        let pieceData = await this.localDatabase.get<EntryLeaf>(nleafid);
                        if (pieceData.type == "leaf" && pieceData.data == piece) {
                            leafid = nleafid;
                            needMake = false;
                            tryNextHash = false;
                            this.hashCache[piece] = leafid;
                            this.hashCacheRev[leafid] = piece;
                        } else if (pieceData.type == "leaf") {
                            this.addLog("hash:collision!!");
                            hashQ++;
                            tryNextHash = true;
                        } else {
                            leafid = nleafid;
                            tryNextHash = false;
                        }
                    } catch (ex) {
                        if (ex.status && ex.status == 404) {
                            //not found, we can use it.
                            leafid = nleafid;
                            needMake = true;
                        } else {
                            needMake = false;
                            throw ex;
                        }
                    }
                } while (tryNextHash);
                if (needMake) {
                    //have to make
                    let d: EntryLeaf = {
                        _id: leafid,
                        data: piece,
                        type: "leaf",
                    };
                    let result = await this.localDatabase.put(d);
                    this.updateRecentModifiedDocs(result.id, result.rev, d._deleted);
                    if (result.ok) {
                        this.addLog(`save ok:id:${result.id} rev:${result.rev}`, LOG_LEVEL.VERBOSE);
                        this.hashCache[piece] = leafid;
                        this.hashCacheRev[leafid] = piece;
                        made++;
                    } else {
                        this.addLog("save faild");
                    }
                } else {
                    skiped++;
                }
            }

            savenNotes.push(leafid);
        } while (leftData != "");
        this.addLog(`note content saven, pieces:${processed} new:${made}, skip:${skiped}, cache:${cacheUsed}`);
        let newDoc: PlainEntry | NewEntry = {
            NewNote: true,
            children: savenNotes,
            _id: note._id,
            ctime: note.ctime,
            mtime: note.mtime,
            size: note.size,
            type: plainSplit ? "plain" : "newnote",
        };
        // Here for upsert logic,
        try {
            let old = await this.localDatabase.get(newDoc._id);
            if (!old.type || old.type == "notes" || old.type == "newnote" || old.type == "plain") {
                // simple use rev for new doc
                newDoc._rev = old._rev;
            }
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                // NO OP/
            } else {
                throw ex;
            }
        }
        let r = await this.localDatabase.put(newDoc);
        this.updateRecentModifiedDocs(r.id, r.rev, newDoc._deleted);
        if (typeof this.corruptedEntries[note._id] != "undefined") {
            delete this.corruptedEntries[note._id];
        }
        this.addLog(`note saven:${newDoc._id}:${r.rev}`);
    }

    syncHandler: PouchDB.Replication.Sync<{}> = null;

    async openReplication(setting: ObsidianLiveSyncSettings, keepAlive: boolean, showResult: boolean, callback: (e: PouchDB.Core.ExistingDocument<{}>[]) => Promise<void>) {
        if (setting.versionUpFlash != "") {
            new Notice("Open settings and check message, please.");
            return;
        }
        let uri = setting.couchDB_URI;
        let auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        if (this.syncHandler != null) {
            this.addLog("Another replication running.");
            return false;
        }
        let dbret = await connectRemoteCouchDB(uri, auth);
        if (dbret === false) {
            this.addLog(`could not connect to ${uri}`, LOG_LEVEL.NOTICE);
            return;
        }
        let syncOptionBase: PouchDB.Replication.SyncOptions = {
            batch_size: 250,
            batches_limit: 40,
        };
        let syncOption: PouchDB.Replication.SyncOptions = keepAlive ? { live: true, retry: true, heartbeat: 30000, ...syncOptionBase } : { ...syncOptionBase };

        let db = dbret.db;
        //replicate once
        let replicate = this.localDatabase.replicate.from(db, syncOptionBase);
        replicate
            .on("change", async (e) => {
                // when in first run, replication will send us tombstone data
                // and in normal cases, all leavs should sent before the entry that contains these item.
                // so skip to completed all, we should treat all changes.
                try {
                    callback(e.docs);
                    this.addLog(`pulled ${e.docs.length} doc(s)`);
                } catch (ex) {
                    this.addLog("Replication callback error");
                    this.addLog(ex);
                }
            })
            .on("complete", async (info) => {
                replicate.cancel();
                replicate.removeAllListeners();
                this.syncHandler = null;
                if (this.syncHandler != null) {
                    this.syncHandler.cancel();
                    this.syncHandler.removeAllListeners();
                }
                this.syncHandler = this.localDatabase.sync(db, syncOption);
                this.syncHandler
                    .on("active", () => {
                        this.addLog("Replication activated");
                    })
                    .on("change", async (e) => {
                        try {
                            callback(e.change.docs);
                            this.addLog(`replicated ${e.change.docs.length} doc(s)`);
                        } catch (ex) {
                            this.addLog("Replication callback error");
                            this.addLog(ex);
                        }
                    })
                    .on("complete", (e) => {
                        this.addLog("Replication completed", showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
                        this.syncHandler = null;
                    })
                    .on("denied", (e) => {
                        this.addLog("Replication denied", LOG_LEVEL.NOTICE);
                        // this.addLog(e);
                    })
                    .on("error", (e) => {
                        this.addLog("Replication error", LOG_LEVEL.NOTICE);
                        // this.addLog(e);
                    })
                    .on("paused", (e) => {
                        this.addLog("replication paused", LOG_LEVEL.VERBOSE);
                        // this.addLog(e);
                    });
            })
            .on("error", (e) => {
                this.addLog("Pulling Replication error", LOG_LEVEL.NOTICE);
                this.addLog(e);
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
        if (this.changeHandler != null) {
            this.changeHandler.cancel();
        }
        await this.closeReplication();
        await this.localDatabase.destroy();
        this.localDatabase = null;
        await this.initializeDatabase();
        this.disposeHashCache();
        this.addLog("Local Database Reset", LOG_LEVEL.NOTICE);
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
            this.addLog("Remote Database Destroyed", LOG_LEVEL.NOTICE);
            await this.tryCreateRemoteDatabase(setting);
        } catch (ex) {
            this.addLog("something happend on Remote Database Destory", LOG_LEVEL.NOTICE);
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
        this.addLog("Remote Database Created or Connected", LOG_LEVEL.NOTICE);
    }

    async garbageCollect() {
        // get all documents of NewEntry2
        // we don't use queries , just use allDocs();
        let c = 0;
        let readCount = 0;
        let hashPieces: string[] = [];
        let usedPieces: string[] = [];
        do {
            let result = await this.localDatabase.allDocs({ include_docs: true, skip: c, limit: 100, conflicts: true });
            readCount = result.rows.length;
            if (readCount > 0) {
                //there are some result
                for (let v of result.rows) {
                    let doc = v.doc;
                    if (doc.type == "newnote" || doc.type == "plain") {
                        // used pieces memo.
                        usedPieces = Array.from(new Set([...usedPieces, ...doc.children]));
                        if (doc._conflicts) {
                            for (let cid of doc._conflicts) {
                                let p = await this.localDatabase.get<EntryDoc>(doc._id, { rev: cid });
                                if (p.type == "newnote" || p.type == "plain") {
                                    usedPieces = Array.from(new Set([...usedPieces, ...p.children]));
                                }
                            }
                        }
                    }
                    if (doc.type == "leaf") {
                        // all pieces.
                        hashPieces = Array.from(new Set([...hashPieces, doc._id]));
                    }
                    // this.addLog(`GC:processed:${v.doc._id}`);
                }
            }
            c += readCount;
        } while (readCount != 0);
        // items collected.
        const garbages = hashPieces.filter((e) => usedPieces.indexOf(e) == -1);
        let deleteCount = 0;
        for (let v of garbages) {
            try {
                let item = await this.localDatabase.get(v);
                item._deleted = true;
                await this.localDatabase.put(item);
                deleteCount++;
            } catch (ex) {
                if (ex.status && ex.status == 404) {
                    // NO OP. It should be timing problem.
                } else {
                    throw ex;
                }
            }
        }
        this.addLog(`GC:deleted ${deleteCount} items.`);
    }
}

export default class ObsidianLiveSyncPlugin extends Plugin {
    settings: ObsidianLiveSyncSettings;
    //localDatabase: PouchDB.Database<EntryDoc>;
    localDatabase: LocalPouchDB;
    logMessage: string[] = [];
    statusBar: HTMLElement;
    statusBar2: HTMLElement;

    async onload() {
        this.addLog = this.addLog.bind(this);
        this.addLog("loading plugin");
        const lsname = "obsidian-live-sync-ver" + this.app.vault.getName();
        const last_version = localStorage.getItem(lsname);
        await this.loadSettings();
        if (!last_version || Number(last_version) < VER) {
            this.settings.liveSync = false;
            this.settings.syncOnSave = false;
            this.settings.syncOnStart = false;
            this.settings.versionUpFlash = "I changed specifications incompatiblly, so when you enable sync again, be sure to made version up all nother devides.";
            this.saveSettings();
        }
        localStorage.setItem(lsname, `${VER}`);
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

        this.app.workspace.onLayoutReady(async () => {
            await this.initializeDatabase();
            this.realizeSettingSyncMode();
            if (this.settings.syncOnStart) {
                await this.replicate(false);
            }
        });

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
        this.addCommand({
            id: "livesync-replicate",
            name: "Replicate now",
            callback: () => {
                this.replicate();
            },
        });
        // this.addCommand({
        //     id: "livesync-test",
        //     name: "test reset db and replicate",
        //     callback: async () => {
        //         await this.resetLocalDatabase();
        //         await this.replicate();
        //     },
        // });
        this.addCommand({
            id: "livesync-gc",
            name: "garbage collect now",
            callback: () => {
                this.garbageCollect();
            },
        });
        this.addCommand({
            id: "livesync-toggle",
            name: "Toggle LiveSync",
            callback: () => {
                if (this.settings.liveSync) {
                    this.settings.liveSync = false;
                    this.addLog("LiveSync Disabled.", LOG_LEVEL.NOTICE);
                } else {
                    this.settings.liveSync = true;
                    this.addLog("LiveSync Enabled.", LOG_LEVEL.NOTICE);
                }
                this.realizeSettingSyncMode();
                this.saveSettings();
            },
        });
        this.watchWindowVisiblity = this.watchWindowVisiblity.bind(this);
        window.addEventListener("visibilitychange", this.watchWindowVisiblity);
    }
    onunload() {
        if (this.gcTimerHandler != null) {
            clearTimeout(this.gcTimerHandler);
            this.gcTimerHandler = null;
        }
        this.localDatabase.closeReplication();
        this.localDatabase.close();
        window.removeEventListener("visibilitychange", this.watchWindowVisiblity);
        this.addLog("unloading plugin");
    }

    async openDatabase() {
        if (this.localDatabase != null) {
            this.localDatabase.close();
        }
        let vaultName = this.app.vault.getName();
        this.localDatabase = new LocalPouchDB(this.app, this, vaultName);
        await this.localDatabase.initializeDatabase();
    }
    async garbageCollect() {
        await this.localDatabase.garbageCollect();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
    gcTimerHandler: any = null;
    gcHook() {
        if (this.settings.gcDelay == 0) return;
        const GC_DELAY = this.settings.gcDelay * 1000; // if leaving opening window, try GC,
        if (this.gcTimerHandler != null) {
            clearTimeout(this.gcTimerHandler);
            this.gcTimerHandler = null;
        }
        this.gcTimerHandler = setTimeout(() => {
            this.gcTimerHandler = null;
            this.garbageCollect();
        }, GC_DELAY);
    }
    registerWatchEvents() {
        this.registerEvent(this.app.vault.on("modify", this.watchVaultChange));
        this.registerEvent(this.app.vault.on("delete", this.watchVaultDelete));
        this.registerEvent(this.app.vault.on("rename", this.watchVaultRename));
        this.registerEvent(this.app.vault.on("create", this.watchVaultChange));
        this.registerEvent(this.app.workspace.on("file-open", this.watchWorkspaceOpen));
    }

    watchWindowVisiblity() {
        if (this.settings.suspendFileWatching) return;
        let isHidden = document.hidden;
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
        this.gcHook();
    }

    watchWorkspaceOpen(file: TFile) {
        if (this.settings.suspendFileWatching) return;
        if (file == null) return;
        this.localDatabase.disposeHashCache();
        this.showIfConflicted(file);
        this.gcHook();
    }
    watchVaultChange(file: TFile, ...args: any[]) {
        if (this.settings.suspendFileWatching) return;
        this.updateIntoDB(file);
        this.gcHook();
    }
    watchVaultDelete(file: TFile & TFolder) {
        if (this.settings.suspendFileWatching) return;
        if (file.children) {
            //folder
            this.deleteFolderOnDB(file);
            // this.app.vault.delete(file);
        } else {
            this.deleteFromDB(file);
        }
        this.gcHook();
    }
    watchVaultRename(file: TFile & TFolder, oldFile: any) {
        if (this.settings.suspendFileWatching) return;
        if (file.children) {
            // this.renameFolder(file,oldFile);
            this.addLog(`folder name changed:(this operation is not supported) ${file.path}`);
        } else {
            this.updateIntoDB(file);
            this.deleteFromDBbyPath(oldFile);
        }
        this.gcHook();
    }

    //--> Basic document Functions
    async addLog(message: any, level: LOG_LEVEL = LOG_LEVEL.INFO) {
        // debugger;

        if (level < LOG_LEVEL.INFO && this.settings && this.settings.lessInformationInLog) {
            return;
        }
        if (this.settings && !this.settings.showVerboseLog && level == LOG_LEVEL.VERBOSE) {
            return;
        }
        let valutName = this.app.vault.getName();
        let timestamp = new Date().toLocaleString();
        let messagecontent = typeof message == "string" ? message : JSON.stringify(message, null, 2);
        let newmessage = timestamp + "->" + messagecontent;

        this.logMessage = [].concat(this.logMessage).concat([newmessage]).slice(-100);
        console.log(valutName + ":" + newmessage);
        if (this.statusBar2 != null) {
            this.statusBar2.setText(newmessage.substring(0, 60));
        }
        if (level >= LOG_LEVEL.NOTICE) {
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

    async doc2storage_create(docEntry: EntryBody, force?: boolean) {
        let doc = await this.localDatabase.getDBEntry(docEntry._id, { rev: docEntry._rev });
        if (doc === false) return;
        if (doc.datatype == "newnote") {
            let bin = base64ToArrayBuffer(doc.data);
            if (bin != null) {
                await this.ensureDirectory(doc._id);
                let newfile = await this.app.vault.createBinary(doc._id, bin, { ctime: doc.ctime, mtime: doc.mtime });
                this.addLog("live : write to local (newfile:b) " + doc._id);
                await this.app.vault.trigger("create", newfile);
            }
        } else if (doc.datatype == "plain") {
            await this.ensureDirectory(doc._id);
            let newfile = await this.app.vault.create(doc._id, doc.data, { ctime: doc.ctime, mtime: doc.mtime });
            this.addLog("live : write to local (newfile:p) " + doc._id);
            await this.app.vault.trigger("create", newfile);
        } else {
            this.addLog("live : New data imcoming, but we cound't parse that." + doc.datatype, LOG_LEVEL.NOTICE);
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
    async doc2storate_modify(docEntry: EntryBody, file: TFile, force?: boolean) {
        if (docEntry._deleted) {
            //basically pass.
            //but if there're no docs left, delete file.
            let lastDocs = await this.localDatabase.getDBEntry(docEntry._id);
            if (lastDocs === false) {
                await this.deleteVaultItem(file);
            } else {
                // it perhaps delete some revisions.
                // may be we have to reload this
                await this.pullFile(docEntry._id, null, true);
                this.addLog(`delete skipped:${lastDocs._id}`);
            }
            return;
        }

        if (file.stat.mtime < docEntry.mtime || force) {
            let doc = await this.localDatabase.getDBEntry(docEntry._id);
            let msg = "livesync : newer local files so write to local:" + file.path;
            if (force) msg = "livesync : force write to local:" + file.path;
            if (doc === false) return;
            if (doc.datatype == "newnote") {
                let bin = base64ToArrayBuffer(doc.data);
                if (bin != null) {
                    await this.ensureDirectory(doc._id);
                    await this.app.vault.modifyBinary(file, bin, { ctime: doc.ctime, mtime: doc.mtime });
                    this.addLog(msg);
                    await this.app.vault.trigger("modify", file);
                }
            }
            if (doc.datatype == "plain") {
                await this.ensureDirectory(doc._id);
                await this.app.vault.modify(file, doc.data, { ctime: doc.ctime, mtime: doc.mtime });
                this.addLog(msg);
                await this.app.vault.trigger("modify", file);
            } else {
                this.addLog("live : New data imcoming, but we cound't parse that.:" + doc.datatype + "-", LOG_LEVEL.NOTICE);
            }
        } else if (file.stat.mtime > docEntry.mtime) {
            // newer local file.
            // ?
        } else {
            //Nothing have to op.
            //eq.case
        }
    }
    async handleDBChanged(change: EntryBody) {
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
    async parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): Promise<void> {
        for (var change of docs) {
            if (this.localDatabase.isSelfModified(change._id, change._rev)) {
                return;
            }
            this.addLog("replication change arrived", LOG_LEVEL.VERBOSE);
            if (change.type != "leaf") {
                await this.handleDBChanged(change);
            }
            this.gcHook();
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
        if (this.settings.versionUpFlash != "") {
            new Notice("Open settings and check message, please.");
            return;
        }
        this.localDatabase.openReplication(this.settings, false, showMessage, this.parseReplicationResult);
    }

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

        const onlyInStorageNames = onlyInStorage.map((e) => e.path);

        const syncFiles = filesStorage.filter((e) => onlyInStorageNames.indexOf(e.path) == -1);

        // just write to DB from storage.
        for (let v of onlyInStorage) {
            await this.updateIntoDB(v);
        }
        // simply realize it
        for (let v of onlyInDatabase) {
            await this.pullFile(v, filesStorage);
        }
        // have to sync below..
        for (let v of syncFiles) {
            await this.syncFileBetweenDBandStorage(v, filesStorage);
        }
    }
    async deleteFolderOnDB(folder: TFolder) {
        this.addLog(`delete folder:${folder.path}`);
        for (var v of folder.children) {
            let entry = v as TFile & TFolder;
            this.addLog(`->entry:${entry.path}`, LOG_LEVEL.VERBOSE);
            if (entry.children) {
                this.addLog(`->is dir`, LOG_LEVEL.VERBOSE);
                await this.deleteFolderOnDB(entry);
                try {
                    await this.app.vault.delete(entry);
                } catch (ex) {
                    if (ex.code && ex.code == "ENOENT") {
                        //NO OP.
                    } else {
                        this.addLog(`error while delete filder:${entry.path}`, LOG_LEVEL.NOTICE);
                        this.addLog(ex);
                    }
                }
            } else {
                this.addLog(`->is file`, LOG_LEVEL.VERBOSE);
                await this.deleteFromDB(entry);
            }
        }
        try {
            await this.app.vault.delete(folder);
        } catch (ex) {
            if (ex.code && ex.code == "ENOENT") {
                //NO OP.
            } else {
                this.addLog(`error while delete filder:${folder.path}`, LOG_LEVEL.NOTICE);
                this.addLog(ex);
            }
        }
    }

    async renameFolder(folder: TFolder, oldFile: any) {
        for (var v of folder.children) {
            let entry = v as TFile & TFolder;
            if (entry.children) {
                await this.deleteFolderOnDB(entry);
                await this.app.vault.delete(entry);
            } else {
                await this.deleteFromDB(entry);
            }
        }
    }

    // --> conflict resolving
    async getConflictedDoc(path: string, rev: string): Promise<false | diff_result_leaf> {
        try {
            let doc = await this.localDatabase.getDBEntry(path, { rev: rev });
            if (doc === false) return false;
            let data = doc.data;
            if (doc.datatype == "newnote") {
                data = base64ToString(doc.data);
            } else if (doc.datatype == "plain") {
                data = doc.data;
            }
            return {
                ctime: doc.ctime,
                mtime: doc.mtime,
                rev: rev,
                data: data,
            };
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                return false;
            }
        }
        return false;
    }
    /**
     * Getting file conflicted status.
     * @param path the file location
     * @returns true -> resolved, false -> nothing to do, or check result.
     */
    async getConflictedStatus(path: string): Promise<diff_check_result> {
        let test = await this.localDatabase.getDBEntry(path, { conflicts: true });
        if (test === false) return false;
        if (test == null) return false;
        if (!test._conflicts) return false;
        if (test._conflicts.length == 0) return false;
        // should be one or more conflicts;
        let leftLeaf = await this.getConflictedDoc(path, test._rev);
        let rightLeaf = await this.getConflictedDoc(path, test._conflicts[0]);
        if (leftLeaf == false) {
            // what's going on..
            this.addLog(`could not get current revisions:${path}`, LOG_LEVEL.NOTICE);
            return false;
        }
        if (rightLeaf == false) {
            // Conflicted item could not load, delete this.
            await this.localDatabase.deleteDBEntry(path, { rev: test._conflicts[0] });
            await this.pullFile(path, null, true);
            this.addLog(`could not get old revisions, automaticaly used newer one:${path}`, LOG_LEVEL.NOTICE);
            return true;
        }
        // first,check for same contents
        if (leftLeaf.data == rightLeaf.data) {
            let leaf = leftLeaf;
            if (leftLeaf.mtime > rightLeaf.mtime) {
                leaf = rightLeaf;
            }
            await this.localDatabase.deleteDBEntry(path, { rev: leaf.rev });
            await this.pullFile(path, null, true);
            this.addLog(`automaticaly merged:${path}`);
            return true;
        }
        // make diff.
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
            }, 500);
            return;
        }
        //there conflicts, and have to resolve ;
        let leaf = this.app.workspace.activeLeaf;
        if (leaf) {
            new ConflictResolveModal(this.app, conflictCheckResult, async (selected) => {
                let testDoc = await this.localDatabase.getDBEntry(file.path, { conflicts: true });
                if (testDoc === false) return;
                if (!testDoc._conflicts) {
                    this.addLog("something went wrong on merging.", LOG_LEVEL.NOTICE);
                    return;
                }
                let toDelete = selected;
                if (toDelete == null) {
                    //concat both,
                    if (conflictCheckResult !== false && conflictCheckResult !== true) {
                        // write data,and delete both old rev.
                        let p = conflictCheckResult.diff.map((e) => e[1]).join("");
                        await this.app.vault.modify(file, p);
                        await this.localDatabase.deleteDBEntry(file.path, { rev: conflictCheckResult.left.rev });
                        await this.localDatabase.deleteDBEntry(file.path, { rev: conflictCheckResult.right.rev });
                    }
                    return;
                }
                if (toDelete == "") {
                    return;
                }
                this.addLog(`resolved conflict:${file.path}`);
                await this.localDatabase.deleteDBEntry(file.path, { rev: toDelete });
                await this.pullFile(file.path, null, true);
                setTimeout(() => {
                    //resolved, check again.
                    this.showIfConflicted(file);
                }, 500);
            }).open();
        }
    }
    async pullFile(filename: string, fileList?: TFile[], force?: boolean, rev?: string) {
        if (!fileList) {
            fileList = this.app.vault.getFiles();
        }
        let targetFiles = fileList.filter((e) => e.path == filename);
        if (targetFiles.length == 0) {
            //have to create;
            let doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : null);
            if (doc === false) return;
            await this.doc2storage_create(doc, force);
        } else if (targetFiles.length == 1) {
            //normal case
            let file = targetFiles[0];
            let doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : null);
            if (doc === false) return;
            await this.doc2storate_modify(doc, file, force);
        } else {
            this.addLog(`target files:${filename} is two or more files in your vault`);
            //something went wrong..
        }
        //when to opened file;
    }
    async syncFileBetweenDBandStorage(file: TFile, fileList?: TFile[]) {
        let doc = await this.localDatabase.getDBEntry(file.path);
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
        let content = "";
        let datatype: "plain" | "newnote" = "newnote";
        if (file.extension != "md") {
            let contentBin = await this.app.vault.readBinary(file);
            content = arrayBufferToBase64(contentBin);
            datatype = "newnote";
        } else {
            content = await this.app.vault.read(file);
            datatype = "plain";
        }
        let fullpath = file.path;
        let d: LoadedEntry = {
            _id: fullpath,
            data: content,
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            size: file.stat.size,
            children: [],
            datatype: datatype,
        };
        //From here
        let old = await this.localDatabase.getDBEntry(fullpath);
        if (old !== false) {
            let oldData = { data: old.data, deleted: old._deleted };
            let newData = { data: d.data, deleted: d._deleted };
            if (JSON.stringify(oldData) == JSON.stringify(newData)) {
                this.addLog("not changed:" + fullpath + (d._deleted ? " (deleted)" : ""), LOG_LEVEL.VERBOSE);
                return;
            }
            // d._rev = old._rev;
        }
        let ret = await this.localDatabase.putDBEntry(d);

        this.addLog("put database:" + fullpath + "(" + datatype + ") ");
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
        contentEl.createEl("button", { text: "Concat both" }, (e) => {
            e.addEventListener("click", async () => {
                await this.callback(null);
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
            this.plugin.addLog(`could not connect to ${this.plugin.settings.couchDB_URI}`, LOG_LEVEL.NOTICE);
            return;
        }
        this.plugin.addLog(`Connected to ${db.info.db_name}`, LOG_LEVEL.NOTICE);
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

        containerEl.createEl("h3", { text: "Database configuration" });

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
            .setName("Auto GC delay")
            .setDesc("(seconds), if you set zero, you have to run manually.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.gcDelay + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v > 5000) {
                            return 0;
                        }
                        this.plugin.settings.gcDelay = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        containerEl.createEl("h3", { text: "Log Setting" });

        new Setting(containerEl)
            .setName("Do not show low-priority Log")
            .setDesc("Reduce log infomations")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.lessInformationInLog).onChange(async (value) => {
                    this.plugin.settings.lessInformationInLog = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName("Verbose Log")
            .setDesc("Show verbose log ")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showVerboseLog).onChange(async (value) => {
                    this.plugin.settings.showVerboseLog = value;
                    await this.plugin.saveSettings();
                })
            );

        containerEl.createEl("h3", { text: "Sync setting" });

        if (this.plugin.settings.versionUpFlash != "") {
            let c = containerEl.createEl("div", { text: this.plugin.settings.versionUpFlash });
            c.createEl("button", { text: "I got it and updated." }, (e) => {
                e.addEventListener("click", async () => {
                    this.plugin.settings.versionUpFlash = "";
                    await this.plugin.saveSettings();
                    c.remove();
                });
            });
            c.addClass("op-warn");
        }

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
            .setDesc("When you save file, sync automatically")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
                    this.plugin.settings.syncOnSave = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(containerEl)
            .setName("Sync on Start")
            .setDesc("Start synchronization on Obsidian started.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.syncOnStart).onChange(async (value) => {
                    this.plugin.settings.syncOnStart = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Minimum chunk size")
            .setDesc("(letters), minimum chunk size.")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.minimumChunkSize + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 10 || v > 1000) {
                            return 10;
                        }
                        this.plugin.settings.minimumChunkSize = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        new Setting(containerEl)
            .setName("LongLine Threshold")
            .setDesc("(letters), If the line is longer than this, make the line to chunk")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.longLineThreshold + "")
                    .onChange(async (value) => {
                        let v = Number(value);
                        if (isNaN(v) || v < 10 || v > 1000) {
                            return 10;
                        }
                        this.plugin.settings.longLineThreshold = v;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "number");
            });

        new Setting(containerEl).setName("Local Database Operations").addButton((button) =>
            button
                .setButtonText("Reset local database")
                .setDisabled(false)
                .onClick(async () => {
                    await this.plugin.resetLocalDatabase();
                })
        );
        new Setting(containerEl).setName("Re-init").addButton((button) =>
            button
                .setButtonText("Init Database again")
                .setDisabled(false)
                .onClick(async () => {
                    await this.plugin.resetLocalDatabase();
                    await this.plugin.initializeDatabase();
                })
        );

        new Setting(containerEl).setName("Garbage Collect").addButton((button) =>
            button
                .setButtonText("Garbage Collection")
                .setDisabled(false)
                .onClick(async () => {
                    await this.plugin.garbageCollect();
                })
        );

        containerEl.createEl("h3", { text: "Hatch" });

        new Setting(containerEl)
            .setName("Suspend file watching")
            .setDesc("if enables it, all file operations are ignored.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.suspendFileWatching).onChange(async (value) => {
                    this.plugin.settings.suspendFileWatching = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl).setName("Remote Database Operations").addButton((button) =>
            button
                .setButtonText("Reset remote database")
                .setDisabled(false)
                .onClick(async () => {
                    await this.plugin.tryResetRemoteDatabase();
                })
        );
        new Setting(containerEl).setName("Remote Database Operations").addButton((button) =>
            button
                .setButtonText("Create remote database")
                .setDisabled(false)
                .onClick(async () => {
                    await this.plugin.tryResetRemoteDatabase();
                })
        );

        containerEl.createEl("h3", { text: "Corrupted data" });

        if (Object.keys(this.plugin.localDatabase.corruptedEntries).length > 0) {
            let cx = containerEl.createEl("div", { text: "If you have copy of these items on any device, simply edit once or twice. Or not, delete this. sorry.." });
            for (let k in this.plugin.localDatabase.corruptedEntries) {
                let xx = cx.createEl("div", { text: `${k}` });

                let ba = xx.createEl("button", { text: `Delete this` }, (e) => {
                    e.addEventListener("click", async () => {
                        await this.plugin.localDatabase.deleteDBEntry(k);
                        xx.remove();
                    });
                });
            }
        }
    }
}
