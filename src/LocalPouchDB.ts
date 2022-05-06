import { PouchDB } from "./pouchdb-browser";
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
} from "./lib/src/types";
import { decrypt, encrypt } from "./lib/src/e2ee";
import { RemoteDBSettings } from "./lib/src/types";
import { resolveWithIgnoreKnownError, delay, runWithLock, isPlainText, splitPieces, NewNotice, WrappedNotice } from "./lib/src/utils";
import { path2id } from "./utils";
import { Logger } from "./lib/src/logger";
import { checkRemoteVersion, connectRemoteCouchDB, getLastPostFailedBySize } from "./utils_couchdb";

type ReplicationCallback = (e: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<void>;

export class LocalPouchDB {
    auth: Credential;
    dbname: string;
    settings: RemoteDBSettings;
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
    syncHandler: PouchDB.Replication.Sync<EntryDoc> | PouchDB.Replication.Replication<EntryDoc> = null;

    leafArrivedCallbacks: { [key: string]: (() => void)[] } = {};

    syncStatus: DatabaseConnectingStatus = "NOT_CONNECTED";
    docArrived = 0;
    docSent = 0;
    docSeq = "";

    isMobile = false;

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

    constructor(settings: RemoteDBSettings, dbname: string, isMobile: boolean) {
        this.auth = {
            username: "",
            password: "",
        };
        this.dbname = dbname;
        this.settings = settings;
        this.cancelHandler = this.cancelHandler.bind(this);
        this.isMobile = isMobile;

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
                        Logger(`Something went wrong on reading elements of ${obj._id} from database:`, LOG_LEVEL.NOTICE);
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
                    Logger(`Something went wrong on reading ${obj._id} from database:`, LOG_LEVEL.NOTICE);
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
    async putDBEntry(note: LoadedEntry) {
        await this.waitForGCComplete();
        // let leftData = note.data;
        const savenNotes = [];
        let processed = 0;
        let made = 0;
        let skiped = 0;
        let pieceSize = MAX_DOC_SIZE_BIN;
        let plainSplit = false;
        let cacheUsed = 0;
        const userpasswordHash = this.h32Raw(new TextEncoder().encode(this.settings.passphrase));
        if (isPlainText(note._id)) {
            pieceSize = MAX_DOC_SIZE;
            plainSplit = true;
        }

        const newLeafs: EntryLeaf[] = [];
        // To keep low bandwith and database size,
        // Dedup pieces on database.
        // from 0.1.10, for best performance. we use markdown delimiters
        // 1. \n[^\n]{longLineThreshold}[^\n]*\n -> long sentence shuld break.
        // 2. \n\n shold break
        // 3. \r\n\r\n should break
        // 4. \n# should break.
        let minimumChunkSize = this.settings.minimumChunkSize;
        if (minimumChunkSize < 10) minimumChunkSize = 10;
        let longLineThreshold = this.settings.longLineThreshold;
        if (longLineThreshold < 100) longLineThreshold = 100;

        const pieces = splitPieces(note.data, pieceSize, plainSplit, minimumChunkSize, longLineThreshold);
        for (const piece of pieces()) {
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
                                Logger("Decode failed!");
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
        }
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
                Logger("ERROR ON SAVING LEAVES:", LOG_LEVEL.NOTICE);
                Logger(ex, LOG_LEVEL.NOTICE);
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
    replicateAllToServer(setting: RemoteDBSettings, showingNotice?: boolean) {
        return new Promise(async (res, rej) => {
            await this.waitForGCComplete();
            this.openOneshotReplication(
                setting,
                showingNotice,
                async (e) => {},
                false,
                (e) => {
                    if (e === true) res(e);
                    rej(e);
                },
                true,
                false
            );
        });
    }

    async checkReplicationConnectivity(setting: RemoteDBSettings, keepAlive: boolean, skipCheck: boolean) {
        if (!this.isReady) {
            Logger("Database is not ready.");
            return false;
        }

        await this.waitForGCComplete();
        if (setting.versionUpFlash != "") {
            NewNotice("Open settings and check message, please.");
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

        const dbret = await connectRemoteCouchDB(uri, auth, setting.disableRequestURI || this.isMobile);
        if (typeof dbret === "string") {
            Logger(`could not connect to ${uri}: ${dbret}`, LOG_LEVEL.NOTICE);
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

    openReplication(setting: RemoteDBSettings, keepAlive: boolean, showResult: boolean, callback: (e: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<void>) {
        if (keepAlive) {
            this.openContinuousReplication(setting, showResult, callback, false);
        } else {
            this.openOneshotReplication(setting, showResult, callback, false, null, false, false);
        }
    }
    replicationActivated(notice: WrappedNotice) {
        this.syncStatus = "CONNECTED";
        this.updateInfo();
        Logger("Replication activated");
        if (notice != null) notice.setMessage(`Activated..`);
    }
    async replicationChangeDetected(e: PouchDB.Replication.SyncResult<EntryDoc>, notice: WrappedNotice, docSentOnStart: number, docArrivedOnStart: number, callback: ReplicationCallback) {
        try {
            if (e.direction == "pull") {
                await callback(e.change.docs);
                Logger(`replicated ${e.change.docs_read} doc(s)`);
                this.docArrived += e.change.docs.length;
            } else {
                this.docSent += e.change.docs.length;
            }
            if (notice != null) {
                notice.setMessage(`↑${this.docSent - docSentOnStart} ↓${this.docArrived - docArrivedOnStart}`);
            }
            this.updateInfo();
        } catch (ex) {
            Logger("Replication callback error", LOG_LEVEL.NOTICE);
            Logger(ex, LOG_LEVEL.NOTICE);
            //
        }
    }
    replicationCompleted(notice: WrappedNotice, showResult: boolean) {
        this.syncStatus = "COMPLETED";
        this.updateInfo();
        Logger("Replication completed", showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
        if (notice != null) notice.hide();
        this.syncHandler = this.cancelHandler(this.syncHandler);
    }
    replicationDeniend(notice: WrappedNotice, e: any) {
        this.syncStatus = "ERRORED";
        this.updateInfo();
        this.syncHandler = this.cancelHandler(this.syncHandler);
        if (notice != null) notice.hide();
        Logger("Replication denied", LOG_LEVEL.NOTICE);
        Logger(e);
    }
    replicationErrored(notice: WrappedNotice, e: any) {
        this.syncStatus = "ERRORED";
        this.syncHandler = this.cancelHandler(this.syncHandler);
        this.updateInfo();
    }
    replicationPaused(notice: WrappedNotice) {
        this.syncStatus = "PAUSED";
        this.updateInfo();
        if (notice != null) notice.hide();
        Logger("replication paused", LOG_LEVEL.VERBOSE);
    }

    async openOneshotReplication(
        setting: RemoteDBSettings,
        showResult: boolean,
        callback: (e: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<void>,
        retrying: boolean,
        callbackDone: (e: boolean | any) => void,
        pushOnly: boolean,
        pullOnly: boolean
    ): Promise<boolean> {
        if (this.syncHandler != null) {
            Logger("Replication is already in progress.", showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
            return;
        }
        Logger("Oneshot Sync begin...");
        let thisCallback = callbackDone;
        const ret = await this.checkReplicationConnectivity(setting, true, retrying);
        let notice: WrappedNotice = null;
        if (ret === false) {
            Logger("Could not connect to server.", LOG_LEVEL.NOTICE);
            return;
        }
        if (showResult) {
            notice = NewNotice("Looking for the point last synchronized point.", 0);
        }
        const { db, syncOptionBase } = ret;
        this.syncStatus = "STARTED";
        this.updateInfo();
        const docArrivedOnStart = this.docArrived;
        const docSentOnStart = this.docSent;
        if (!retrying) {
            // If initial replication, save setting to rollback
            this.originalSetting = setting;
        }
        this.syncHandler = this.cancelHandler(this.syncHandler);
        if (!pushOnly && !pullOnly) {
            this.syncHandler = this.localDatabase.sync(db, { checkpoint: "target", ...syncOptionBase });
            this.syncHandler
                .on("change", async (e) => {
                    await this.replicationChangeDetected(e, notice, docSentOnStart, docArrivedOnStart, callback);
                    if (retrying) {
                        if (this.docSent - docSentOnStart + (this.docArrived - docArrivedOnStart) > this.originalSetting.batch_size * 2) {
                            // restore configration.
                            Logger("Back into original settings once.");
                            if (notice != null) notice.hide();
                            this.syncHandler = this.cancelHandler(this.syncHandler);
                            this.openOneshotReplication(this.originalSetting, showResult, callback, false, callbackDone, pushOnly, pullOnly);
                        }
                    }
                })
                .on("complete", (e) => {
                    this.replicationCompleted(notice, showResult);
                    if (thisCallback != null) {
                        thisCallback(true);
                    }
                });
        } else if (pullOnly) {
            this.syncHandler = this.localDatabase.replicate.to(db, { checkpoint: "target", ...syncOptionBase });
            this.syncHandler
                .on("change", async (e) => {
                    await this.replicationChangeDetected({ direction: "pull", change: e }, notice, docSentOnStart, docArrivedOnStart, callback);
                    if (retrying) {
                        if (this.docSent - docSentOnStart + (this.docArrived - docArrivedOnStart) > this.originalSetting.batch_size * 2) {
                            // restore configration.
                            Logger("Back into original settings once.");
                            if (notice != null) notice.hide();
                            this.syncHandler = this.cancelHandler(this.syncHandler);
                            this.openOneshotReplication(this.originalSetting, showResult, callback, false, callbackDone, pushOnly, pullOnly);
                        }
                    }
                })
                .on("complete", (e) => {
                    this.replicationCompleted(notice, showResult);
                    if (thisCallback != null) {
                        thisCallback(true);
                    }
                });
        } else if (pushOnly) {
            this.syncHandler = this.localDatabase.replicate.to(db, { checkpoint: "target", ...syncOptionBase });
            this.syncHandler.on("complete", (e) => {
                this.replicationCompleted(notice, showResult);
                if (thisCallback != null) {
                    thisCallback(true);
                }
            });
        }

        this.syncHandler
            .on("active", () => this.replicationActivated(notice))
            .on("denied", (e) => {
                this.replicationDeniend(notice, e);
                if (thisCallback != null) {
                    thisCallback(e);
                }
            })
            .on("error", (e) => {
                this.replicationErrored(notice, e);
                Logger("Replication stopped.", showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
                if (notice != null) notice.hide();
                if (getLastPostFailedBySize()) {
                    // Duplicate settings for smaller batch.
                    const xsetting: RemoteDBSettings = JSON.parse(JSON.stringify(setting));
                    xsetting.batch_size = Math.ceil(xsetting.batch_size / 2) + 2;
                    xsetting.batches_limit = Math.ceil(xsetting.batches_limit / 2) + 2;
                    if (xsetting.batch_size <= 5 && xsetting.batches_limit <= 5) {
                        Logger("We can't replicate more lower value.", showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
                    } else {
                        Logger(`Retry with lower batch size:${xsetting.batch_size}/${xsetting.batches_limit}`, showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
                        thisCallback = null;
                        this.openOneshotReplication(xsetting, showResult, callback, true, callbackDone, pushOnly, pullOnly);
                    }
                } else {
                    Logger("Replication error", LOG_LEVEL.NOTICE);
                    Logger(e);
                }
                if (thisCallback != null) {
                    thisCallback(e);
                }
            })
            .on("paused", (e) => this.replicationPaused(notice));
    }

    openContinuousReplication(setting: RemoteDBSettings, showResult: boolean, callback: (e: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<void>, retrying: boolean) {
        if (this.syncHandler != null) {
            Logger("Replication is already in progress.", showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
            return;
        }
        Logger("Before LiveSync, start OneShot once...");
        this.openOneshotReplication(
            setting,
            showResult,
            callback,
            false,
            async () => {
                Logger("LiveSync begin...");
                const ret = await this.checkReplicationConnectivity(setting, true, true);
                let notice: WrappedNotice = null;
                if (ret === false) {
                    Logger("Could not connect to server.", showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
                    return;
                }
                if (showResult) {
                    notice = NewNotice("Looking for the point last synchronized point.", 0);
                }
                const { db, syncOption } = ret;
                this.syncStatus = "STARTED";
                this.updateInfo();
                const docArrivedOnStart = this.docArrived;
                const docSentOnStart = this.docSent;
                if (!retrying) {
                    //TODO if successfly saven, roll back org setting.
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
                    .on("active", () => this.replicationActivated(notice))
                    .on("change", async (e) => {
                        await this.replicationChangeDetected(e, notice, docSentOnStart, docArrivedOnStart, callback);
                        if (retrying) {
                            if (this.docSent - docSentOnStart + (this.docArrived - docArrivedOnStart) > this.originalSetting.batch_size * 2) {
                                // restore sync values
                                Logger("Back into original settings once.");
                                if (notice != null) notice.hide();
                                this.syncHandler = this.cancelHandler(this.syncHandler);
                                this.openContinuousReplication(this.originalSetting, showResult, callback, false);
                            }
                        }
                    })
                    .on("complete", (e) => this.replicationCompleted(notice, showResult))
                    .on("denied", (e) => this.replicationDeniend(notice, e))
                    .on("error", (e) => {
                        this.replicationErrored(notice, e);
                        Logger("Replication stopped.", LOG_LEVEL.NOTICE);
                    })
                    .on("paused", (e) => this.replicationPaused(notice));
            },
            false,
            true
        );
    }

    originalSetting: RemoteDBSettings = null;

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
    async tryResetRemoteDatabase(setting: RemoteDBSettings) {
        await this.closeReplication();
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        const con = await connectRemoteCouchDB(uri, auth, setting.disableRequestURI || this.isMobile);
        if (typeof con == "string") return;
        try {
            await con.db.destroy();
            Logger("Remote Database Destroyed", LOG_LEVEL.NOTICE);
            await this.tryCreateRemoteDatabase(setting);
        } catch (ex) {
            Logger("Something happened on Remote Database Destory:", LOG_LEVEL.NOTICE);
            Logger(ex, LOG_LEVEL.NOTICE);
        }
    }
    async tryCreateRemoteDatabase(setting: RemoteDBSettings) {
        await this.closeReplication();
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        const con2 = await connectRemoteCouchDB(uri, auth, setting.disableRequestURI || this.isMobile);
        if (typeof con2 === "string") return;
        Logger("Remote Database Created or Connected", LOG_LEVEL.NOTICE);
    }
    async markRemoteLocked(setting: RemoteDBSettings, locked: boolean) {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        const dbret = await connectRemoteCouchDB(uri, auth, setting.disableRequestURI || this.isMobile);
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
    async markRemoteResolved(setting: RemoteDBSettings) {
        const uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        const auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        const dbret = await connectRemoteCouchDB(uri, auth, setting.disableRequestURI || this.isMobile);
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
