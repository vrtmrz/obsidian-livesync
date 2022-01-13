import { Notice } from "obsidian";
import { PouchDB } from "../pouchdb-browser-webpack/dist/pouchdb-browser.js";
import xxhash from "xxhash-wasm";
import {
    Entry,
    EntryDoc,
    EntryDocResponse,
    EntryLeaf,
    EntryNodeInfo,
    NewEntry,
    PlainEntry,
    LoadedEntry,
    ObsidianLiveSyncSettings,
    Credential,
    EntryMilestoneInfo,
    LOG_LEVEL,
    LEAF_WAIT_TIMEOUT,
    MAX_DOC_SIZE,
    MAX_DOC_SIZE_BIN,
    NODEINFO_DOCID,
    RECENT_MOFIDIED_DOCS_QTY,
    VER,
    MILSTONE_DOCID,
    DatabaseConnectingStatus,
} from "./types";
import { resolveWithIgnoreKnownError, delay, path2id, runWithLock } from "./utils";
import { Logger } from "./logger";
import { checkRemoteVersion, connectRemoteCouchDB, getLastPostFailedBySize } from "./utils_couchdb";
import { decrypt, encrypt } from "./e2ee";

export class LocalPouchDB {
    auth: Credential;
    dbname: string;
    settings: ObsidianLiveSyncSettings;
    localDatabase: PouchDB.Database<EntryDoc>;
    nodeid = "";
    isReady = false;

    recentModifiedDocs: string[] = [];
    h32: (input: string, seed?: number) => string;
    h64: (input: string, seedHigh?: number, seedLow?: number) => string;
    h32Raw: (input: Uint8Array, seed?: number) => number;
    hashCache: {
        [key: string]: string;
    } = {};
    hashCacheRev: {
        [key: string]: string;
    } = {};

    corruptedEntries: { [key: string]: EntryDoc } = {};
    remoteLocked = false;
    remoteLockedAndDeviceNotAccepted = false;

    changeHandler: PouchDB.Core.Changes<EntryDoc> = null;
    syncHandler: PouchDB.Replication.Sync<EntryDoc> = null;

    leafArrivedCallbacks: { [key: string]: (() => void)[] } = {};

    syncStatus: DatabaseConnectingStatus = "NOT_CONNECTED";
    docArrived = 0;
    docSent = 0;
    docSeq = "";

    cancelHandler<T extends PouchDB.Core.Changes<EntryDoc> | PouchDB.Replication.Sync<EntryDoc> | PouchDB.Replication.Replication<EntryDoc>>(handler: T): T {
        if (handler != null) {
            handler.removeAllListeners();
            handler.cancel();
            handler = null;
        }
        return null;
    }
    onunload() {
        this.recentModifiedDocs = [];
        this.leafArrivedCallbacks;
        this.changeHandler = this.cancelHandler(this.changeHandler);
        this.syncHandler = this.cancelHandler(this.syncHandler);
        this.localDatabase.removeAllListeners();
    }

    constructor(settings: ObsidianLiveSyncSettings, dbname: string) {
        this.auth = {
            username: "",
            password: "",
        };
        this.dbname = dbname;
        this.settings = settings;
        this.cancelHandler = this.cancelHandler.bind(this);

        // this.initializeDatabase();
    }
    close() {
        Logger("Database closed (by close)");
        this.isReady = false;
        this.changeHandler = this.cancelHandler(this.changeHandler);
        if (this.localDatabase != null) {
            this.localDatabase.close();
        }
    }
    disposeHashCache() {
        this.hashCache = {};
        this.hashCacheRev = {};
    }

    updateRecentModifiedDocs(id: string, rev: string, deleted: boolean) {
        const idrev = id + rev;
        if (deleted) {
            this.recentModifiedDocs = this.recentModifiedDocs.filter((e) => e != idrev);
        } else {
            this.recentModifiedDocs.push(idrev);
            this.recentModifiedDocs = this.recentModifiedDocs.slice(0 - RECENT_MOFIDIED_DOCS_QTY);
        }
    }
    isSelfModified(id: string, rev: string): boolean {
        const idrev = id + rev;
        return this.recentModifiedDocs.indexOf(idrev) !== -1;
    }

    async initializeDatabase() {
        await this.prepareHashFunctions();
        if (this.localDatabase != null) this.localDatabase.close();
        this.changeHandler = this.cancelHandler(this.changeHandler);
        this.localDatabase = null;
        this.localDatabase = new PouchDB<EntryDoc>(this.dbname + "-livesync", {
            auto_compaction: this.settings.useHistory ? false : true,
            revs_limit: 100,
            deterministic_revs: true,
        });

        Logger("Database Info");
        Logger(await this.localDatabase.info(), LOG_LEVEL.VERBOSE);
        // initialize local node information.
        const nodeinfo: EntryNodeInfo = await resolveWithIgnoreKnownError<EntryNodeInfo>(this.localDatabase.get(NODEINFO_DOCID), {
            _id: NODEINFO_DOCID,
            type: "nodeinfo",
            nodeid: "",
        });
        if (nodeinfo.nodeid == "") {
            nodeinfo.nodeid = Math.random().toString(36).slice(-10);
            await this.localDatabase.put(nodeinfo);
        }
        this.localDatabase.on("close", () => {
            Logger("Database closed.");
            this.isReady = false;
            this.localDatabase.removeAllListeners();
        });
        this.nodeid = nodeinfo.nodeid;

        // Traceing the leaf id
        const changes = this.localDatabase
            .changes({
                since: "now",
                live: true,
                filter: (doc) => doc.type == "leaf",
            })
            .on("change", (e) => {
                if (e.deleted) return;
                this.leafArrived(e.id);
                this.docSeq = `${e.seq}`;
            });
        this.changeHandler = changes;
        this.isReady = true;
        Logger("Database is now ready.");
    }

    async prepareHashFunctions() {
        if (this.h32 != null) return;
        const { h32, h64, h32Raw } = await xxhash();
        this.h32 = h32;
        this.h64 = h64;
        this.h32Raw = h32Raw;
    }

    // leaf waiting

    leafArrived(id: string) {
        if (typeof this.leafArrivedCallbacks[id] !== "undefined") {
            for (const func of this.leafArrivedCallbacks[id]) {
                func();
            }
            delete this.leafArrivedCallbacks[id];
        }
    }
    // wait
    waitForLeafReady(id: string): Promise<boolean> {
        return new Promise((res, rej) => {
            // Set timeout.
            const timer = setTimeout(() => rej(new Error(`Leaf timed out:${id}`)), LEAF_WAIT_TIMEOUT);
            if (typeof this.leafArrivedCallbacks[id] == "undefined") {
                this.leafArrivedCallbacks[id] = [];
            }
            this.leafArrivedCallbacks[id].push(() => {
                clearTimeout(timer);
                res(true);
            });
        });
    }

    async getDBLeaf(id: string, waitForReady: boolean): Promise<string> {
        await this.waitForGCComplete();
        // when in cache, use that.
        if (this.hashCacheRev[id]) {
            return this.hashCacheRev[id];
        }
        try {
            const w = await this.localDatabase.get(id);
            if (w.type == "leaf") {
                if (id.startsWith("h:+")) {
                    try {
                        w.data = await decrypt(w.data, this.settings.passphrase);
                    } catch (e) {
                        Logger("The element of the document has been encrypted, but decryption failed.", LOG_LEVEL.NOTICE);
                        throw e;
                    }
                }
                this.hashCache[w.data] = id;
                this.hashCacheRev[id] = w.data;
                return w.data;
            }
            throw new Error(`retrive leaf, but it was not leaf.`);
        } catch (ex) {
            if (ex.status && ex.status == 404 && waitForReady) {
                // just leaf is not ready.
                // wait for on
                if ((await this.waitForLeafReady(id)) === false) {
                    throw new Error(`time out (waiting leaf)`);
                }
                try {
                    // retrive again.
                    const w = await this.localDatabase.get(id);
                    if (w.type == "leaf") {
                        if (id.startsWith("h:+")) {
                            try {
                                w.data = await decrypt(w.data, this.settings.passphrase);
                            } catch (e) {
                                Logger("The element of the document has been encrypted, but decryption failed.", LOG_LEVEL.NOTICE);
                                throw e;
                            }
                        }
                        this.hashCache[w.data] = id;
                        this.hashCacheRev[id] = w.data;
                        return w.data;
                    }
                    throw new Error(`retrive leaf, but it was not leaf.`);
                } catch (ex) {
                    if (ex.status && ex.status == 404) {
                        throw new Error("leaf is not found");
                    }
                    Logger(`Something went wrong on retriving leaf`);
                    throw ex;
                }
            } else {
                Logger(`Something went wrong on retriving leaf`);
                throw ex;
            }
        }
    }

    async getDBEntryMeta(path: string, opt?: PouchDB.Core.GetOptions): Promise<false | LoadedEntry> {
        await this.waitForGCComplete();
        const id = path2id(path);
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

            // retrieve metadata only
            if (!obj.type || (obj.type && obj.type == "notes") || obj.type == "newnote" || obj.type == "plain") {
                const note = obj as Entry;
                let children: string[] = [];
                if (obj.type == "newnote" || obj.type == "plain") {
                    children = obj.children;
                }
                const doc: LoadedEntry & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta = {
                    data: "",
                    _id: note._id,
                    ctime: note.ctime,
                    mtime: note.mtime,
                    size: note.size,
                    _deleted: obj._deleted,
                    _rev: obj._rev,
                    _conflicts: obj._conflicts,
                    children: children,
                    datatype: "newnote",
                };
                return doc;
            }
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                return false;
            }
            throw ex;
        }
        return false;
    }
    async getDBEntry(path: string, opt?: PouchDB.Core.GetOptions, dump = false, waitForReady = true): Promise<false | LoadedEntry> {
        await this.waitForGCComplete();
        const id = path2id(path);
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
                const note = obj as Entry;
                const doc: LoadedEntry & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta = {
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
                if (dump) {
                    Logger(`Simple doc`);
                    Logger(doc);
                }

                return doc;
                // simple note
            }
            if (obj.type == "newnote" || obj.type == "plain") {
                // search childrens
                try {
                    if (dump) {
                        Logger(`Enhanced doc`);
                        Logger(obj);
                    }
                    let childrens: string[];
                    try {
                        childrens = await Promise.all(obj.children.map((e) => this.getDBLeaf(e, waitForReady)));
                        if (dump) {
                            Logger(`childrens:`);
                            Logger(childrens);
                        }
                    } catch (ex) {
                        Logger(`Something went wrong on reading elements of ${obj._id} from database.`, LOG_LEVEL.NOTICE);
                        Logger(ex, LOG_LEVEL.VERBOSE);
                        this.corruptedEntries[obj._id] = obj;
                        return false;
                    }
                    const data = childrens.join("");
                    const doc: LoadedEntry & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta = {
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
                    if (dump) {
                        Logger(`therefore:`);
                        Logger(doc);
                    }
                    if (typeof this.corruptedEntries[doc._id] != "undefined") {
                        delete this.corruptedEntries[doc._id];
                    }
                    return doc;
                } catch (ex) {
                    if (ex.status && ex.status == 404) {
                        Logger(`Missing document content!, could not read ${obj._id} from database.`, LOG_LEVEL.NOTICE);
                        return false;
                    }
                    Logger(`Something went wrong on reading ${obj._id} from database.`, LOG_LEVEL.NOTICE);
                    Logger(ex);
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
    async deleteDBEntry(path: string, opt?: PouchDB.Core.GetOptions): Promise<boolean> {
        await this.waitForGCComplete();
        const id = path2id(path);

        try {
            let obj: EntryDocResponse = null;
            return await runWithLock("file:" + id, false, async () => {
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
                    const r = await this.localDatabase.put(obj);
                    this.updateRecentModifiedDocs(r.id, r.rev, true);
                    if (typeof this.corruptedEntries[obj._id] != "undefined") {
                        delete this.corruptedEntries[obj._id];
                    }
                    return true;
                    // simple note
                }
                if (obj.type == "newnote" || obj.type == "plain") {
                    obj._deleted = true;
                    const r = await this.localDatabase.put(obj);
                    Logger(`entry removed:${obj._id}-${r.rev}`);
                    this.updateRecentModifiedDocs(r.id, r.rev, true);
                    if (typeof this.corruptedEntries[obj._id] != "undefined") {
                        delete this.corruptedEntries[obj._id];
                    }
                    return true;
                } else {
                    return false;
                }
            });
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                return false;
            }
            throw ex;
        }
    }
    async deleteDBEntryPrefix(prefixSrc: string): Promise<boolean> {
        await this.waitForGCComplete();
        // delete database entries by prefix.
        // it called from folder deletion.
        let c = 0;
        let readCount = 0;
        const delDocs: string[] = [];
        const prefix = path2id(prefixSrc);
        do {
            const result = await this.localDatabase.allDocs({ include_docs: false, skip: c, limit: 100, conflicts: true });
            readCount = result.rows.length;
            if (readCount > 0) {
                //there are some result
                for (const v of result.rows) {
                    // let doc = v.doc;
                    if (v.id.startsWith(prefix) || v.id.startsWith("/" + prefix)) {
                        delDocs.push(v.id);
                        // console.log("!" + v.id);
                    } else {
                        if (!v.id.startsWith("h:")) {
                            // console.log("?" + v.id);
                        }
                    }
                }
            }
            c += readCount;
        } while (readCount != 0);
        // items collected.
        //bulk docs to delete?
        let deleteCount = 0;
        let notfound = 0;
        for (const v of delDocs) {
            try {
                await runWithLock("file:" + v, false, async () => {
                    const item = await this.localDatabase.get(v);
                    item._deleted = true;
                    await this.localDatabase.put(item);
                    this.updateRecentModifiedDocs(item._id, item._rev, true);
                });

                deleteCount++;
            } catch (ex) {
                if (ex.status && ex.status == 404) {
                    notfound++;
                    // NO OP. It should be timing problem.
                } else {
                    throw ex;
                }
            }
        }
        Logger(`deleteDBEntryPrefix:deleted ${deleteCount} items, skipped ${notfound}`);
        return true;
    }
    isPlainText(filename: string): boolean {
        if (filename.endsWith(".md")) return true;
        if (filename.endsWith(".txt")) return true;
        if (filename.endsWith(".svg")) return true;
        if (filename.endsWith(".html")) return true;
        if (filename.endsWith(".csv")) return true;
        if (filename.endsWith(".css")) return true;
        if (filename.endsWith(".js")) return true;
        if (filename.endsWith(".xml")) return true;

        return false;
    }
    async putDBEntry(note: LoadedEntry) {
        await this.waitForGCComplete();
        let leftData = note.data;
        const savenNotes = [];
        let processed = 0;
        let made = 0;
        let skiped = 0;
        let pieceSize = MAX_DOC_SIZE_BIN;
        let plainSplit = false;
        let cacheUsed = 0;
        const userpasswordHash = this.h32Raw(new TextEncoder().encode(this.settings.passphrase));
        if (this.isPlainText(note._id)) {
            pieceSize = MAX_DOC_SIZE;
            plainSplit = true;
        }
        const newLeafs: EntryLeaf[] = [];
        do {
            // To keep low bandwith and database size,
            // Dedup pieces on database.
            // from 0.1.10, for best performance. we use markdown delimiters
            // 1. \n[^\n]{longLineThreshold}[^\n]*\n -> long sentence shuld break.
            // 2. \n\n shold break
            // 3. \r\n\r\n should break
            // 4. \n# should break.
            let cPieceSize = pieceSize;
            if (plainSplit) {
                let minimumChunkSize = this.settings.minimumChunkSize;
                if (minimumChunkSize < 10) minimumChunkSize = 10;
                let longLineThreshold = this.settings.longLineThreshold;
                if (longLineThreshold < 100) longLineThreshold = 100;
                cPieceSize = 0;
                // lookup for next splittion .
                // we're standing on "\n"
                do {
                    const n1 = leftData.indexOf("\n", cPieceSize + 1);
                    const n2 = leftData.indexOf("\n\n", cPieceSize + 1);
                    const n3 = leftData.indexOf("\r\n\r\n", cPieceSize + 1);
                    const n4 = leftData.indexOf("\n#", cPieceSize + 1);
                    if (n1 == -1 && n2 == -1 && n3 == -1 && n4 == -1) {
                        cPieceSize = MAX_DOC_SIZE;
                        break;
                    }

                    if (n1 > longLineThreshold) {
                        // long sentence is an established piece
                        cPieceSize = n1;
                    } else {
                        // cPieceSize = Math.min.apply([n2, n3, n4].filter((e) => e > 1));
                        // ^ heavy.
                        if (n1 > 0 && cPieceSize < n1) cPieceSize = n1;
                        if (n2 > 0 && cPieceSize < n2) cPieceSize = n2 + 1;
                        if (n3 > 0 && cPieceSize < n3) cPieceSize = n3 + 3;
                        // Choose shorter, empty line and \n#
                        if (n4 > 0 && cPieceSize > n4) cPieceSize = n4 + 0;
                        cPieceSize++;
                    }
                } while (cPieceSize < minimumChunkSize);
            }

            // piece size determined.
            const piece = leftData.substring(0, cPieceSize);
            leftData = leftData.substring(cPieceSize);
            processed++;
            let leafid = "";
            // Get hash of piece.
            let hashedPiece = "";
            let hashQ = 0; // if hash collided, **IF**, count it up.
            let tryNextHash = false;
            let needMake = true;
            if (typeof this.hashCache[piece] !== "undefined") {
                hashedPiece = "";
                leafid = this.hashCache[piece];
                needMake = false;
                skiped++;
                cacheUsed++;
            } else {
                if (this.settings.encrypt) {
                    // When encryption has been enabled, make hash to be different between each passphrase to avoid inferring password.
                    hashedPiece = "+" + (this.h32Raw(new TextEncoder().encode(piece)) ^ userpasswordHash).toString(16);
                } else {
                    hashedPiece = this.h32(piece);
                }
                leafid = "h:" + hashedPiece;
                do {
                    let nleafid = leafid;
                    try {
                        nleafid = `${leafid}${hashQ}`;
                        const pieceData = await this.localDatabase.get<EntryLeaf>(nleafid);
                        //try decode
                        if (pieceData._id.startsWith("h:+")) {
                            try {
                                pieceData.data = await decrypt(pieceData.data, this.settings.passphrase);
                            } catch (e) {
                                Logger("Decode failed !");
                                throw e;
                            }
                        }
                        if (pieceData.type == "leaf" && pieceData.data == piece) {
                            leafid = nleafid;
                            needMake = false;
                            tryNextHash = false;
                            this.hashCache[piece] = leafid;
                            this.hashCacheRev[leafid] = piece;
                        } else if (pieceData.type == "leaf") {
                            Logger("hash:collision!!");
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
                            tryNextHash = false;
                        } else {
                            needMake = false;
                            tryNextHash = false;
                            throw ex;
                        }
                    }
                } while (tryNextHash);
                if (needMake) {
                    //have to make
                    let savePiece = piece;
                    if (this.settings.encrypt) {
                        const passphrase = this.settings.passphrase;
                        savePiece = await encrypt(piece, passphrase);
                    }
                    const d: EntryLeaf = {
                        _id: leafid,
                        data: savePiece,
                        type: "leaf",
                    };
                    newLeafs.push(d);
                    this.hashCache[piece] = leafid;
                    this.hashCacheRev[leafid] = piece;
                    made++;
                } else {
                    skiped++;
                }
            }
            savenNotes.push(leafid);
        } while (leftData != "");
        let saved = true;
        if (newLeafs.length > 0) {
            try {
                const result = await this.localDatabase.bulkDocs(newLeafs);
                for (const item of result) {
                    if ((item as any).ok) {
                        this.updateRecentModifiedDocs(item.id, item.rev, false);
                        Logger(`save ok:id:${item.id} rev:${item.rev}`, LOG_LEVEL.VERBOSE);
                    } else {
                        if ((item as any).status && (item as any).status == 409) {
                            // conflicted, but it would be ok in childrens.
                        } else {
                            Logger(`save failed:id:${item.id} rev:${item.rev}`, LOG_LEVEL.NOTICE);
                            Logger(item);
                            // this.disposeHashCache();
                            saved = false;
                        }
                    }
                }
            } catch (ex) {
                Logger("ERROR ON SAVING LEAVES ");
                Logger(ex);
                saved = false;
            }
        }
        if (saved) {
            Logger(`note content saven, pieces:${processed} new:${made}, skip:${skiped}, cache:${cacheUsed}`);
            const newDoc: PlainEntry | NewEntry = {
                NewNote: true,
                children: savenNotes,
                _id: note._id,
                ctime: note.ctime,
                mtime: note.mtime,
                size: note.size,
                type: plainSplit ? "plain" : "newnote",
            };
            // Here for upsert logic,
            await runWithLock("file:" + newDoc._id, false, async () => {
                try {
                    const old = await this.localDatabase.get(newDoc._id);
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
                const r = await this.localDatabase.put(newDoc, { force: true });
                this.updateRecentModifiedDocs(r.id, r.rev, newDoc._deleted);
                if (typeof this.corruptedEntries[note._id] != "undefined") {
                    delete this.corruptedEntries[note._id];
                }
                if (this.settings.checkIntegrityOnSave) {
                    if (!this.sanCheck(await this.localDatabase.get(r.id))) {
                        Logger("note save failed!", LOG_LEVEL.NOTICE);
                    } else {
                        Logger(`note has been surely saved:${newDoc._id}:${r.rev}`);
                    }
                } else {
                    Logger(`note saved:${newDoc._id}:${r.rev}`);
                }
            });
        } else {
            Logger(`note coud not saved:${note._id}`);
        }
    }

    updateInfo: () => void = () => {
        console.log("default updinfo");
    };
    // eslint-disable-next-line require-await
    async migrate(from: number, to: number): Promise<boolean> {
        Logger(`Database updated from ${from} to ${to}`, LOG_LEVEL.NOTICE);
        // no op now,
        return true;
    }
    replicateAllToServer(setting: ObsidianLiveSyncSettings, showingNotice?: boolean) {
        return new Promise(async (res, rej) => {
            await this.waitForGCComplete();
            this.closeReplication();
            Logger("send all data to server", LOG_LEVEL.NOTICE);
            let notice: Notice = null;
            if (showingNotice) {
                notice = new Notice("Initializing", 0);
            }
            this.syncStatus = "STARTED";
            this.updateInfo();
            const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
            const auth: Credential = {
                username: setting.couchDB_USER,
                password: setting.couchDB_PASSWORD,
            };
            const dbret = await connectRemoteCouchDB(uri, auth);
            if (typeof dbret === "string") {
                Logger(`could not connect to ${uri}:${dbret}`, LOG_LEVEL.NOTICE);
                if (notice != null) notice.hide();
                return rej(`could not connect to ${uri}:${dbret}`);
            }

            const syncOptionBase: PouchDB.Replication.SyncOptions = {
                pull: {
                    checkpoint: "target",
                },
                push: {
                    checkpoint: "source",
                },
                batches_limit: setting.batches_limit,
                batch_size: setting.batch_size,
            };

            const db = dbret.db;
            const totalCount = (await this.localDatabase.info()).doc_count;
            //replicate once
            const replicate = this.localDatabase.replicate.to(db, { checkpoint: "source", ...syncOptionBase });
            replicate
                .on("active", () => {
                    this.syncStatus = "CONNECTED";
                    this.updateInfo();
                    if (notice) {
                        notice.setMessage("CONNECTED");
                    }
                })
                .on("change", (e) => {
                    // no op.
                    this.docSent += e.docs.length;
                    this.updateInfo();
                    notice.setMessage(`SENDING:${e.docs_written}/${totalCount}`);
                    Logger(`replicateAllToServer: sending..:${e.docs.length}`);
                })
                .on("complete", (info) => {
                    this.syncStatus = "COMPLETED";
                    this.updateInfo();
                    Logger("replicateAllToServer: Completed", LOG_LEVEL.NOTICE);
                    this.cancelHandler(replicate);
                    if (notice != null) notice.hide();
                    res(true);
                })
                .on("error", (e) => {
                    this.syncStatus = "ERRORED";
                    this.updateInfo();
                    Logger("replicateAllToServer: Pulling Replication error", LOG_LEVEL.INFO);
                    Logger(e);
                    this.cancelHandler(replicate);
                    if (notice != null) notice.hide();
                    rej(e);
                });
        });
    }

    async checkReplicationConnectivity(setting: ObsidianLiveSyncSettings, keepAlive: boolean, skipCheck: boolean) {
        if (!this.isReady) {
            Logger("Database is not ready.");
            return false;
        }

        await this.waitForGCComplete();
        if (setting.versionUpFlash != "") {
            new Notice("Open settings and check message, please.");
            return false;
        }
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        if (this.syncHandler != null) {
            Logger("Another replication running.");
            return false;
        }
        const dbret = await connectRemoteCouchDB(uri, auth);
        if (typeof dbret === "string") {
            Logger(`could not connect to ${uri}:${dbret}`, LOG_LEVEL.NOTICE);
            return false;
        }

        if (!skipCheck) {
            if (!(await checkRemoteVersion(dbret.db, this.migrate.bind(this), VER))) {
                Logger("Remote database is newer or corrupted, make sure to latest version of self-hosted-livesync installed", LOG_LEVEL.NOTICE);
                return false;
            }

            const defMilestonePoint: EntryMilestoneInfo = {
                _id: MILSTONE_DOCID,
                type: "milestoneinfo",
                created: (new Date() as any) / 1,
                locked: false,
                accepted_nodes: [this.nodeid],
            };
            // const remoteInfo = dbret.info;
            // const localInfo = await this.localDatabase.info();
            // const remoteDocsCount = remoteInfo.doc_count;
            // const localDocsCount = localInfo.doc_count;
            // const remoteUpdSeq = typeof remoteInfo.update_seq == "string" ? Number(remoteInfo.update_seq.split("-")[0]) : remoteInfo.update_seq;
            // const localUpdSeq = typeof localInfo.update_seq == "string" ? Number(localInfo.update_seq.split("-")[0]) : localInfo.update_seq;

            // Logger(`Database diffences: remote:${remoteDocsCount} docs / last update ${remoteUpdSeq}`);
            // Logger(`Database diffences: local :${localDocsCount} docs / last update ${localUpdSeq}`);

            const remoteMilestone: EntryMilestoneInfo = await resolveWithIgnoreKnownError(dbret.db.get(MILSTONE_DOCID), defMilestonePoint);
            this.remoteLocked = remoteMilestone.locked;
            this.remoteLockedAndDeviceNotAccepted = remoteMilestone.locked && remoteMilestone.accepted_nodes.indexOf(this.nodeid) == -1;

            if (remoteMilestone.locked && remoteMilestone.accepted_nodes.indexOf(this.nodeid) == -1) {
                Logger("Remote database marked as 'Auto Sync Locked'. And this devide does not marked as resolved device. see settings dialog.", LOG_LEVEL.NOTICE);
                return false;
            }
            if (typeof remoteMilestone._rev == "undefined") {
                await dbret.db.put(remoteMilestone);
            }
        }
        const syncOptionBase: PouchDB.Replication.SyncOptions = {
            batches_limit: setting.batches_limit,
            batch_size: setting.batch_size,
        };
        const syncOption: PouchDB.Replication.SyncOptions = keepAlive ? { live: true, retry: true, heartbeat: 30000, ...syncOptionBase } : { ...syncOptionBase };

        return { db: dbret.db, info: dbret.info, syncOptionBase, syncOption };
    }

    async openReplication(setting: ObsidianLiveSyncSettings, keepAlive: boolean, showResult: boolean, callback: (e: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<void>): Promise<boolean> {
        return await runWithLock("replicate", false, () => {
            return this._openReplication(setting, keepAlive, showResult, callback, false);
        });
    }

    originalSetting: ObsidianLiveSyncSettings = null;
    // last_seq: number = 200;
    async _openReplication(setting: ObsidianLiveSyncSettings, keepAlive: boolean, showResult: boolean, callback: (e: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<void>, retrying: boolean): Promise<boolean> {
        const ret = await this.checkReplicationConnectivity(setting, keepAlive, retrying);
        if (ret === false) return false;
        let notice: Notice = null;
        if (showResult) {
            notice = new Notice("Looking for the point last synchronized point.", 0);
        }
        const { db, syncOptionBase, syncOption } = ret;
        //replicate once
        this.syncStatus = "STARTED";
        this.updateInfo();

        let resolved = false;
        const docArrivedOnStart = this.docArrived;
        const docSentOnStart = this.docSent;

        const _openReplicationSync = () => {
            Logger("Sync Main Started");
            if (!retrying) {
                this.originalSetting = setting;
            }
            this.syncHandler = this.cancelHandler(this.syncHandler);
            this.syncHandler = this.localDatabase.sync<EntryDoc>(db, {
                ...syncOption,
                pull: {
                    checkpoint: "target",
                },
                push: {
                    checkpoint: "source",
                },
            });
            this.syncHandler
                .on("active", () => {
                    this.syncStatus = "CONNECTED";
                    this.updateInfo();
                    Logger("Replication activated");
                    if (notice != null) notice.setMessage(`Activated..`);
                })
                .on("change", async (e) => {
                    try {
                        if (e.direction == "pull") {
                            // console.log(`pulled data:${e.change.docs.map((e) => e._id).join(",")}`);
                            await callback(e.change.docs);
                            Logger(`replicated ${e.change.docs_read} doc(s)`);
                            this.docArrived += e.change.docs.length;
                        } else {
                            // console.log(`put data:${e.change.docs.map((e) => e._id).join(",")}`);
                            this.docSent += e.change.docs.length;
                        }
                        if (notice != null) {
                            notice.setMessage(`↑${this.docSent - docSentOnStart} ↓${this.docArrived - docArrivedOnStart}`);
                        }
                        this.updateInfo();
                    } catch (ex) {
                        Logger("Replication callback error");
                        Logger(ex);
                    }
                    // re-connect to retry with original setting
                    if (retrying) {
                        if (this.docSent - docSentOnStart + (this.docArrived - docArrivedOnStart) > this.originalSetting.batch_size * 2) {
                            // restore sync values
                            Logger("Back into original settings once.");
                            if (notice != null) notice.hide();
                            this.syncHandler = this.cancelHandler(this.syncHandler);
                            this._openReplication(this.originalSetting, keepAlive, showResult, callback, false);
                        }
                    }
                })
                .on("complete", (e) => {
                    this.syncStatus = "COMPLETED";
                    this.updateInfo();
                    Logger("Replication completed", showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
                    if (notice != null) notice.hide();
                    if (!keepAlive) {
                        this.syncHandler = this.cancelHandler(this.syncHandler);
                        // if keep alive runnning, resolve here,
                    }
                })
                .on("denied", (e) => {
                    this.syncStatus = "ERRORED";
                    this.updateInfo();
                    this.syncHandler = this.cancelHandler(this.syncHandler);
                    if (notice != null) notice.hide();
                    Logger("Replication denied", LOG_LEVEL.NOTICE);
                    Logger(e);
                })
                .on("error", (e) => {
                    this.syncStatus = "ERRORED";
                    this.syncHandler = this.cancelHandler(this.syncHandler);
                    this.updateInfo();
                    if (notice != null) notice.hide();
                    if (getLastPostFailedBySize()) {
                        if (keepAlive) {
                            Logger("Replication stopped.", LOG_LEVEL.NOTICE);
                        } else {
                            // Duplicate settings for smaller batch.
                            const xsetting: ObsidianLiveSyncSettings = JSON.parse(JSON.stringify(setting));
                            xsetting.batch_size = Math.ceil(xsetting.batch_size / 2);
                            xsetting.batches_limit = Math.ceil(xsetting.batches_limit / 2);
                            if (xsetting.batch_size <= 3 || xsetting.batches_limit <= 3) {
                                Logger("We can't replicate more lower value.", showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
                            } else {
                                Logger(`Retry with lower batch size:${xsetting.batch_size}/${xsetting.batches_limit}`, showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
                                this._openReplication(xsetting, keepAlive, showResult, callback, true);
                            }
                        }
                    } else {
                        Logger("Replication error", LOG_LEVEL.NOTICE);
                        Logger(e);
                    }
                })
                .on("paused", (e) => {
                    this.syncStatus = "PAUSED";
                    this.updateInfo();
                    if (notice != null) notice.hide();
                    Logger("replication paused", LOG_LEVEL.VERBOSE);
                    if (keepAlive && !resolved) {
                        // if keep alive runnning, resolve here,
                        resolved = true;
                    }
                    // Logger(e);
                });
            return this.syncHandler;
        };
        if (!keepAlive) {
            await _openReplicationSync();
            return true;
        }
        this.syncHandler = this.cancelHandler(this.syncHandler);
        Logger("Pull before replicate.");
        Logger(await this.localDatabase.info(), LOG_LEVEL.VERBOSE);
        Logger(await db.info(), LOG_LEVEL.VERBOSE);
        let replicate: PouchDB.Replication.Replication<EntryDoc>;
        try {
            replicate = this.localDatabase.replicate.from(db, { checkpoint: "target", ...syncOptionBase });
            replicate
                .on("active", () => {
                    this.syncStatus = "CONNECTED";
                    this.updateInfo();
                    Logger("Replication pull activated.");
                })
                .on("change", async (e) => {
                    // when in first run, replication will send us tombstone data
                    // and in normal cases, all leavs should sent before the entry that contains these item.
                    // so skip to completed all, we should treat all changes.
                    try {
                        await callback(e.docs);
                        this.docArrived += e.docs.length;
                        this.updateInfo();
                        Logger(`pulled ${e.docs.length} doc(s)`);
                        if (notice != null) {
                            notice.setMessage(`Replication pulled:${e.docs_read}`);
                        }
                    } catch (ex) {
                        Logger("Replication callback error");
                        Logger(ex);
                    }
                });
            this.syncStatus = "COMPLETED";
            this.updateInfo();
            this.cancelHandler(replicate);
            this.syncHandler = this.cancelHandler(this.syncHandler);
            Logger("Replication pull completed.");
            _openReplicationSync();
            return true;
        } catch (ex) {
            this.syncStatus = "ERRORED";
            this.updateInfo();
            Logger("Pulling Replication error", LOG_LEVEL.NOTICE);
            this.cancelHandler(replicate);
            this.syncHandler = this.cancelHandler(this.syncHandler);
            if (notice != null) notice.hide();
            throw ex;
        }
    }

    closeReplication() {
        this.syncStatus = "CLOSED";
        this.updateInfo();
        this.syncHandler = this.cancelHandler(this.syncHandler);
        Logger("Replication closed");
    }

    async resetDatabase() {
        await this.waitForGCComplete();
        this.changeHandler = this.cancelHandler(this.changeHandler);
        await this.closeReplication();
        Logger("Database closed for reset Database.");
        this.isReady = false;
        await this.localDatabase.destroy();
        this.localDatabase = null;
        await this.initializeDatabase();
        this.disposeHashCache();
        Logger("Local Database Reset", LOG_LEVEL.NOTICE);
    }
    async tryResetRemoteDatabase(setting: ObsidianLiveSyncSettings) {
        await this.closeReplication();
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        const con = await connectRemoteCouchDB(uri, auth);
        if (typeof con == "string") return;
        try {
            await con.db.destroy();
            Logger("Remote Database Destroyed", LOG_LEVEL.NOTICE);
            await this.tryCreateRemoteDatabase(setting);
        } catch (ex) {
            Logger("something happend on Remote Database Destory", LOG_LEVEL.NOTICE);
        }
    }
    async tryCreateRemoteDatabase(setting: ObsidianLiveSyncSettings) {
        await this.closeReplication();
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        const con2 = await connectRemoteCouchDB(uri, auth);
        if (typeof con2 === "string") return;
        Logger("Remote Database Created or Connected", LOG_LEVEL.NOTICE);
    }
    async markRemoteLocked(setting: ObsidianLiveSyncSettings, locked: boolean) {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        const dbret = await connectRemoteCouchDB(uri, auth);
        if (typeof dbret === "string") {
            Logger(`could not connect to ${uri}:${dbret}`, LOG_LEVEL.NOTICE);
            return;
        }

        if (!(await checkRemoteVersion(dbret.db, this.migrate.bind(this), VER))) {
            Logger("Remote database is newer or corrupted, make sure to latest version of self-hosted-livesync installed", LOG_LEVEL.NOTICE);
            return;
        }
        const defInitPoint: EntryMilestoneInfo = {
            _id: MILSTONE_DOCID,
            type: "milestoneinfo",
            created: (new Date() as any) / 1,
            locked: locked,
            accepted_nodes: [this.nodeid],
        };

        const remoteMilestone: EntryMilestoneInfo = await resolveWithIgnoreKnownError(dbret.db.get(MILSTONE_DOCID), defInitPoint);
        remoteMilestone.accepted_nodes = [this.nodeid];
        remoteMilestone.locked = locked;
        if (locked) {
            Logger("Lock remote database to prevent data corruption", LOG_LEVEL.NOTICE);
        } else {
            Logger("Unlock remote database to prevent data corruption", LOG_LEVEL.NOTICE);
        }
        await dbret.db.put(remoteMilestone);
    }
    async markRemoteResolved(setting: ObsidianLiveSyncSettings) {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        const dbret = await connectRemoteCouchDB(uri, auth);
        if (typeof dbret === "string") {
            Logger(`could not connect to ${uri}:${dbret}`, LOG_LEVEL.NOTICE);
            return;
        }

        if (!(await checkRemoteVersion(dbret.db, this.migrate.bind(this), VER))) {
            Logger("Remote database is newer or corrupted, make sure to latest version of self-hosted-livesync installed", LOG_LEVEL.NOTICE);
            return;
        }
        const defInitPoint: EntryMilestoneInfo = {
            _id: MILSTONE_DOCID,
            type: "milestoneinfo",
            created: (new Date() as any) / 1,
            locked: false,
            accepted_nodes: [this.nodeid],
        };
        // check local database hash status and remote replicate hash status
        const remoteMilestone: EntryMilestoneInfo = await resolveWithIgnoreKnownError(dbret.db.get(MILSTONE_DOCID), defInitPoint);
        // remoteMilestone.locked = false;
        remoteMilestone.accepted_nodes = Array.from(new Set([...remoteMilestone.accepted_nodes, this.nodeid]));
        // this.remoteLocked = false;
        Logger("Mark this device as 'resolved'.", LOG_LEVEL.NOTICE);
        await dbret.db.put(remoteMilestone);
    }
    gcRunning = false;
    async waitForGCComplete() {
        while (this.gcRunning) {
            Logger("Waiting for Garbage Collection completed.");
            await delay(1000);
        }
    }
    async sanCheck(entry: EntryDoc): Promise<boolean> {
        if (entry.type == "plain" || entry.type == "newnote") {
            const children = entry.children;
            Logger(`sancheck:checking:${entry._id} : ${children.length}`, LOG_LEVEL.VERBOSE);
            try {
                const dc = await this.localDatabase.allDocs({ keys: [...children] });
                if (dc.rows.some((e) => "error" in e)) {
                    this.corruptedEntries[entry._id] = entry;
                    this.disposeHashCache();
                    Logger(`sancheck:corrupted:${entry._id} : ${children.length}`, LOG_LEVEL.VERBOSE);
                    return false;
                }
                return true;
            } catch (ex) {
                Logger(ex);
            }
        }
        return false;
    }

    async garbageCollect() {
        // if (this.settings.useHistory) {
        //     Logger("GC skipped for using history", LOG_LEVEL.VERBOSE);
        //     return;
        // }
        // NOTE:Garbage collection could break old revisions.
        await runWithLock("replicate", true, async () => {
            if (this.gcRunning) return;
            this.gcRunning = true;
            try {
                // get all documents of NewEntry2
                // we don't use queries , just use allDocs();
                this.disposeHashCache();
                let c = 0;
                let readCount = 0;
                let hashPieces: string[] = [];
                let usedPieces: string[] = [];
                Logger("Collecting Garbage");
                do {
                    const result = await this.localDatabase.allDocs({ include_docs: false, skip: c, limit: 2000, conflicts: true });
                    readCount = result.rows.length;
                    Logger("checked:" + readCount);
                    if (readCount > 0) {
                        //there are some result
                        for (const v of result.rows) {
                            if (v.id.startsWith("h:")) {
                                hashPieces = Array.from(new Set([...hashPieces, v.id]));
                            } else {
                                const docT = await this.localDatabase.get(v.id, { revs_info: true });
                                const revs = docT._revs_info;
                                // console.log(`revs:${revs.length}`)
                                for (const rev of revs) {
                                    if (rev.status != "available") continue;
                                    // console.log(`id:${docT._id},rev:${rev.rev}`);
                                    const doc = await this.localDatabase.get(v.id, { rev: rev.rev });
                                    if ("children" in doc) {
                                        // used pieces memo.
                                        usedPieces = Array.from(new Set([...usedPieces, ...doc.children]));
                                        if (doc._conflicts) {
                                            for (const cid of doc._conflicts) {
                                                const p = await this.localDatabase.get<EntryDoc>(doc._id, { rev: cid });
                                                if (p.type == "newnote" || p.type == "plain") {
                                                    usedPieces = Array.from(new Set([...usedPieces, ...p.children]));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    c += readCount;
                } while (readCount != 0);
                // items collected.
                Logger("Finding unused pieces");
                this.disposeHashCache();
                const garbages = hashPieces.filter((e) => usedPieces.indexOf(e) == -1);
                let deleteCount = 0;
                Logger("we have to delete:" + garbages.length);
                let deleteDoc: EntryDoc[] = [];
                for (const v of garbages) {
                    try {
                        const item = await this.localDatabase.get(v);
                        item._deleted = true;
                        deleteDoc.push(item);
                        if (deleteDoc.length > 50) {
                            await this.localDatabase.bulkDocs<EntryDoc>(deleteDoc);
                            deleteDoc = [];
                            Logger("delete:" + deleteCount);
                        }
                        deleteCount++;
                    } catch (ex) {
                        if (ex.status && ex.status == 404) {
                            // NO OP. It should be timing problem.
                        } else {
                            throw ex;
                        }
                    }
                }
                if (deleteDoc.length > 0) {
                    await this.localDatabase.bulkDocs<EntryDoc>(deleteDoc);
                }
                Logger(`GC:deleted ${deleteCount} items.`);
            } finally {
                this.gcRunning = false;
            }
        });
        this.disposeHashCache();
    }
}
