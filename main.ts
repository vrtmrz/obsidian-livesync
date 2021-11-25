import { App, debounce, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, addIcon, TFolder, normalizePath, TAbstractFile, Editor, MarkdownView, PluginManifest } from "obsidian";
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
const LEAF_WAIT_TIMEOUT = 90000; // in synchronization, waiting missing leaf time out.
const LOG_LEVEL = {
    VERBOSE: 1,
    INFO: 10,
    NOTICE: 100,
    URGENT: 1000,
} as const;
type LOG_LEVEL = typeof LOG_LEVEL[keyof typeof LOG_LEVEL];

const VERSIONINFO_DOCID = "obsydian_livesync_version";
const MILSTONE_DOCID = "_local/obsydian_livesync_milestone";
const NODEINFO_DOCID = "_local/obsydian_livesync_nodeinfo";

interface ObsidianLiveSyncSettings {
    couchDB_URI: string;
    couchDB_USER: string;
    couchDB_PASSWORD: string;
    couchDB_DBNAME: string;
    liveSync: boolean;
    syncOnSave: boolean;
    syncOnStart: boolean;
    syncOnFileOpen: boolean;
    savingDelay: number;
    lessInformationInLog: boolean;
    gcDelay: number;
    versionUpFlash: string;
    minimumChunkSize: number;
    longLineThreshold: number;
    showVerboseLog: boolean;
    suspendFileWatching: boolean;
    trashInsteadDelete: boolean;
    periodicReplication: boolean;
    periodicReplicationInterval: number;
    encrypt: boolean;
    passphrase: string;
    workingEncrypt: boolean;
    workingPassphrase: string;
    doNotDeleteFolder: boolean;
    resolveConflictsByNewerFile: boolean;
    batchSave: boolean;
    deviceAndVaultName: string;
    usePluginSettings: boolean;
}

const DEFAULT_SETTINGS: ObsidianLiveSyncSettings = {
    couchDB_URI: "",
    couchDB_USER: "",
    couchDB_PASSWORD: "",
    couchDB_DBNAME: "",
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
    trashInsteadDelete: false,
    periodicReplication: false,
    periodicReplicationInterval: 60,
    syncOnFileOpen: false,
    encrypt: false,
    passphrase: "",
    workingEncrypt: false,
    workingPassphrase: "",
    doNotDeleteFolder: false,
    resolveConflictsByNewerFile: false,
    batchSave: false,
    deviceAndVaultName: "",
    usePluginSettings: false,
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

interface PluginDataEntry {
    _id: string;
    deviceVaultName: string;
    mtime: number;
    manifest: PluginManifest;
    mainJs: string;
    manifestJson: string;
    styleCss?: string;
    // it must be encrypted.
    dataJson?: string;
    _rev?: string;
    _deleted?: boolean;
    _conflicts?: string[];
    type: "plugin";
}

interface EntryLeaf {
    _id: string;
    data: string;
    _deleted?: boolean;
    type: "leaf";
    _rev?: string;
}

interface EntryVersionInfo {
    _id: typeof VERSIONINFO_DOCID;
    _rev?: string;
    type: "versioninfo";
    version: number;
    _deleted?: boolean;
}

interface EntryMilestoneInfo {
    _id: typeof MILSTONE_DOCID;
    _rev?: string;
    type: "milestoneinfo";
    _deleted?: boolean;
    created: number;
    accepted_nodes: string[];
    locked: boolean;
}

interface EntryNodeInfo {
    _id: typeof NODEINFO_DOCID;
    _rev?: string;
    _deleted?: boolean;
    type: "nodeinfo";
    nodeid: string;
}

type EntryBody = Entry | NewEntry | PlainEntry;
type EntryDoc = EntryBody | LoadedEntry | EntryLeaf | EntryVersionInfo | EntryMilestoneInfo | EntryNodeInfo | PluginDataEntry;

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
function arrayBufferToBase64Old(buffer: ArrayBuffer) {
    var binary = "";
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}
// Ten times faster.
function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
    return new Promise((res) => {
        var blob = new Blob([buffer], { type: "application/octet-binary" });
        var reader = new FileReader();
        reader.onload = function (evt) {
            var dataurl = evt.target.result.toString();
            res(dataurl.substr(dataurl.indexOf(",") + 1));
        };
        reader.readAsDataURL(blob);
    });
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
        try {
            return new Uint16Array(
                [].map.call(base64, function (c: string) {
                    return c.charCodeAt(0);
                })
            ).buffer;
        } catch (ex2) {
            return null;
        }
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

function resolveWithIgnoreKnownError<T>(p: Promise<T>, def: T): Promise<T> {
    return new Promise((res, rej) => {
        p.then(res).catch((ex) => (ex.status && ex.status == 404 ? res(def) : rej(ex)));
    });
}

const isValidRemoteCouchDBURI = (uri: string): boolean => {
    if (uri.startsWith("https://")) return true;
    if (uri.startsWith("http://")) return true;
    return false;
};
const connectRemoteCouchDB = async (uri: string, auth: { username: string; password: string }): Promise<string | { db: PouchDB.Database; info: any }> => {
    if (!isValidRemoteCouchDBURI(uri)) return "Remote URI is not valid";
    let db = new PouchDB(uri, {
        auth,
    });
    try {
        let info = await db.info();
        return { db: db, info: info };
    } catch (ex) {
        let msg = `${ex.name}:${ex.message}`;
        if (ex.name == "TypeError" && ex.message == "Failed to fetch") {
            msg += "\n**Note** This error caused by many reasons. The only sure thing is you didn't touch the server.\nTo check details, open inspector.";
        }
        Logger(ex, LOG_LEVEL.VERBOSE);
        return msg;
    }
};
// check the version of remote.
// if remote is higher than current(or specified) version, return false.
const checkRemoteVersion = async (db: PouchDB.Database, migrate: (from: number, to: number) => Promise<boolean>, barrier: number = VER): Promise<boolean> => {
    try {
        let versionInfo = (await db.get(VERSIONINFO_DOCID)) as EntryVersionInfo;
        if (versionInfo.type != "versioninfo") {
            return false;
        }

        let version = versionInfo.version;
        if (version < barrier) {
            try {
                let versionUpResult = await migrate(version, barrier);
                if (versionUpResult) {
                    await bumpRemoteVersion(db);
                    return true;
                }
            } catch (ex) {
                throw ex;
            }
        }
        if (version == barrier) return true;
        return false;
    } catch (ex) {
        if (ex.status && ex.status == 404) {
            if (await bumpRemoteVersion(db)) {
                return true;
            }
            return false;
        }
        throw ex;
    }
};
const bumpRemoteVersion = async (db: PouchDB.Database, barrier: number = VER): Promise<boolean> => {
    let vi: EntryVersionInfo = {
        _id: VERSIONINFO_DOCID,
        version: barrier,
        type: "versioninfo",
    };
    let versionInfo = (await resolveWithIgnoreKnownError(db.get(VERSIONINFO_DOCID), vi)) as EntryVersionInfo;
    if (versionInfo.type != "versioninfo") {
        return false;
    }
    vi._rev = versionInfo._rev;
    await db.put(vi);
    return true;
};

function isValidPath(filename: string): boolean {
    let regex = /[\u0000-\u001f]|[\\"':?<>|*$]/g;
    let x = filename.replace(regex, "_");
    let win = /(\\|\/)(COM\d|LPT\d|CON|PRN|AUX|NUL|CLOCK$)($|\.)/gi;
    let sx = (x = x.replace(win, "/_"));
    return sx == filename;
}

// For backward compatibility, using the path for determining id.
// Only CouchDB nonacceptable ID (that starts with an underscore) has been prefixed with "/".
// The first slash will be deleted when the path is normalized.
function path2id(filename: string): string {
    let x = normalizePath(filename);
    if (x.startsWith("_")) x = "/" + x;
    return x;
}
function id2path(filename: string): string {
    return normalizePath(filename);
}

// Default Logger.
let Logger: (message: any, levlel?: LOG_LEVEL) => Promise<void> = async (message, _) => {
    let timestamp = new Date().toLocaleString();
    let messagecontent = typeof message == "string" ? message : message instanceof Error ? `${message.name}:${message.message}` : JSON.stringify(message, null, 2);
    let newmessage = timestamp + "->" + messagecontent;
    console.log(newmessage);
};

type DatabaseConnectingStatus = "NOT_CONNECTED" | "PAUSED" | "CONNECTED" | "COMPLETED" | "CLOSED" | "ERRORED";

// --> Encryption.
//NOTE: I have to split source.
type encodedData = [encryptedData: string, iv: string, salt: string];
type KeyBuffer = {
    index: string;
    key: CryptoKey;
    salt: Uint8Array;
};

let KeyBuffs: KeyBuffer[] = [];

const KEY_RECYCLE_COUNT = 100;
let recycleCount = KEY_RECYCLE_COUNT;

async function getKeyForEncrypt(passphrase: string): Promise<[CryptoKey, Uint8Array]> {
    // For performance, the plugin reuses the key KEY_RECYCLE_COUNT times.
    let f = KeyBuffs.find((e) => e.index == passphrase);
    if (f) {
        recycleCount--;
        if (recycleCount > 0) {
            return [f.key, f.salt];
        }
        KeyBuffs.remove(f);
        recycleCount = KEY_RECYCLE_COUNT;
    }
    let xpassphrase = new TextEncoder().encode(passphrase);
    let digest = await crypto.subtle.digest({ name: "SHA-256" }, xpassphrase);
    let keyMaterial = await crypto.subtle.importKey("raw", digest, { name: "PBKDF2" }, false, ["deriveKey"]);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    let key = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"]
    );
    KeyBuffs.push({
        index: passphrase,
        key,
        salt,
    });
    while (KeyBuffs.length > 50) {
        KeyBuffs.shift();
    }
    return [key, salt];
}

let decKeyBuffs: KeyBuffer[] = [];

async function getKeyForDecryption(passphrase: string, salt: Uint8Array): Promise<[CryptoKey, Uint8Array]> {
    let bufKey = passphrase + uint8ArrayToHexString(salt);
    let f = decKeyBuffs.find((e) => e.index == bufKey);
    if (f) {
        return [f.key, f.salt];
    }
    let xpassphrase = new TextEncoder().encode(passphrase);
    let digest = await crypto.subtle.digest({ name: "SHA-256" }, xpassphrase);
    let keyMaterial = await crypto.subtle.importKey("raw", digest, { name: "PBKDF2" }, false, ["deriveKey"]);
    let key = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
    );
    decKeyBuffs.push({
        index: bufKey,
        key,
        salt,
    });
    while (decKeyBuffs.length > 50) {
        decKeyBuffs.shift();
    }
    return [key, salt];
}
let semiStaticFieldBuffer: Uint8Array = null;
function getSemiStaticField(reset?: boolean) {
    // return fixed field of iv.
    if (semiStaticFieldBuffer != null && !reset) {
        return semiStaticFieldBuffer;
    }
    semiStaticFieldBuffer = crypto.getRandomValues(new Uint8Array(12));
    return semiStaticFieldBuffer;
}

let nonceBuffer: Uint32Array = new Uint32Array(1);
function getNonce() {
    // This is nonce, so do not send same thing.
    nonceBuffer[0]++;
    if (nonceBuffer[0] > 10000) {
        // reset semi-static field.
        getSemiStaticField(true);
    }
    return nonceBuffer;
}

function uint8ArrayToHexString(src: Uint8Array): string {
    return Array.from(src)
        .map((e: number): string => `00${e.toString(16)}`.slice(-2))
        .join("");
}
function hexStringToUint8Array(src: string): Uint8Array {
    const srcArr = [...src];
    const arr = srcArr.reduce((acc, _, i) => (i % 2 ? acc : [...acc, srcArr.slice(i, i + 2).join("")]), []).map((e) => parseInt(e, 16));
    return Uint8Array.from(arr);
}
async function encrypt(input: string, passphrase: string) {
    let key: CryptoKey;
    let salt: Uint8Array;
    [key, salt] = await getKeyForEncrypt(passphrase);
    // Create initial vector with semifixed part and incremental part
    // I think it's not good against related-key attacks.
    const fixedPart = getSemiStaticField();
    const invocationPart = getNonce();
    const iv = Uint8Array.from([...fixedPart, ...new Uint8Array(invocationPart.buffer)]);
    const plainStringified: string = JSON.stringify(input);
    const plainStringBuffer: Uint8Array = new TextEncoder().encode(plainStringified);
    const encryptedDataArrayBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainStringBuffer);

    const encryptedData = window.btoa(Array.from(new Uint8Array(encryptedDataArrayBuffer), (char) => String.fromCharCode(char)).join(""));

    //return data with iv and salt.
    const response: encodedData = [encryptedData, uint8ArrayToHexString(iv), uint8ArrayToHexString(salt)];
    const ret = JSON.stringify(response);
    return ret;
}

async function decrypt(encryptedResult: string, passphrase: string): Promise<string> {
    try {
        let [encryptedData, ivString, salt]: encodedData = JSON.parse(encryptedResult);
        let [key, _] = await getKeyForDecryption(passphrase, hexStringToUint8Array(salt));
        let iv = hexStringToUint8Array(ivString);
        // decode base 64, it should increase speed and i should with in MAX_DOC_SIZE_BIN, so it won't OOM.
        let encryptedDataBin = window.atob(encryptedData);
        let encryptedDataArrayBuffer = Uint8Array.from(encryptedDataBin.split(""), (char) => char.charCodeAt(0));
        let plainStringBuffer: ArrayBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encryptedDataArrayBuffer);
        let plainStringified = new TextDecoder().decode(plainStringBuffer);
        let plain = JSON.parse(plainStringified);
        return plain;
    } catch (ex) {
        Logger("Couldn't decode! You should wrong the passphrases", LOG_LEVEL.VERBOSE);
        Logger(ex, LOG_LEVEL.VERBOSE);
        throw ex;
    }
}

async function testCrypt() {
    let src = "supercalifragilisticexpialidocious";
    let encoded = await encrypt(src, "passwordTest");
    let decrypted = await decrypt(encoded, "passwordTest");
    if (src != decrypted) {
        Logger("WARNING! Your device would not support encryption.", LOG_LEVEL.VERBOSE);
        return false;
    } else {
        Logger("CRYPT LOGIC OK", LOG_LEVEL.VERBOSE);
        return true;
    }
}
// <-- Encryption
//<--Functions
class LocalPouchDB {
    auth: Credential;
    dbname: string;
    settings: ObsidianLiveSyncSettings;
    localDatabase: PouchDB.Database<EntryDoc>;
    nodeid: string = "";
    isReady: boolean = false;

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

    constructor(settings: ObsidianLiveSyncSettings, dbname: string) {
        this.auth = {
            username: "",
            password: "",
        };
        this.dbname = dbname;
        this.settings = settings;

        // this.initializeDatabase();
    }
    close() {
        this.isReady = false;
        if (this.changeHandler != null) {
            this.changeHandler.cancel();
            this.changeHandler.removeAllListeners();
        }
        if (this.localDatabase != null) {
            this.localDatabase.close();
        }
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
        await this.prepareHashFunctions();
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

        Logger("Database Info");
        Logger(await this.localDatabase.info(), LOG_LEVEL.VERBOSE);
        // initialize local node information.
        let nodeinfo: EntryNodeInfo = await resolveWithIgnoreKnownError<EntryNodeInfo>(this.localDatabase.get(NODEINFO_DOCID), {
            _id: NODEINFO_DOCID,
            type: "nodeinfo",
            nodeid: "",
        });
        if (nodeinfo.nodeid == "") {
            nodeinfo.nodeid = Math.random().toString(36).slice(-10);
            await this.localDatabase.put(nodeinfo);
        }
        this.localDatabase.on("close", () => {
            this.isReady = false;
        });
        this.nodeid = nodeinfo.nodeid;

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
                this.docSeq = `${e.seq}`;
            });
        this.changeHandler = changes;
        this.isReady = true;
    }

    async prepareHashFunctions() {
        if (this.h32 != null) return;
        const { h32, h64, h32Raw } = await xxhash();
        this.h32 = h32;
        this.h64 = h64;
        this.h32Raw = h32Raw;
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
        return new Promise((res, rej) => {
            // Set timeout.
            let timer = setTimeout(() => rej(false), LEAF_WAIT_TIMEOUT);
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
                // just leaf is not ready.
                // wait for on
                if ((await this.waitForLeafReady(id)) === false) {
                    throw new Error(`time out (waiting leaf)`);
                }
                try {
                    // retrive again.
                    let w = await this.localDatabase.get(id);
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
        let id = path2id(path);
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
                let note = obj as Entry;
                let doc: LoadedEntry & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta = {
                    data: "",
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
    async getDBEntry(path: string, opt?: PouchDB.Core.GetOptions, dump = false): Promise<false | LoadedEntry> {
        let id = path2id(path);
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
                        childrens = await Promise.all(obj.children.map((e) => this.getDBLeaf(e)));
                        if (dump) {
                            Logger(`childrens:`);
                            Logger(childrens);
                        }
                    } catch (ex) {
                        Logger(`Something went wrong on reading elements of ${obj._id} from database.`, LOG_LEVEL.NOTICE);
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
        let id = path2id(path);
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
                Logger(`entry removed:${obj._id}-${r.rev}`);
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
    async deleteDBEntryPrefix(prefixSrc: string): Promise<boolean> {
        // delete database entries by prefix.
        // it called from folder deletion.
        let c = 0;
        let readCount = 0;
        let delDocs: string[] = [];
        let prefix = path2id(prefixSrc);
        do {
            let result = await this.localDatabase.allDocs({ include_docs: false, skip: c, limit: 100, conflicts: true });
            readCount = result.rows.length;
            if (readCount > 0) {
                //there are some result
                for (let v of result.rows) {
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
        for (let v of delDocs) {
            try {
                let item = await this.localDatabase.get(v);
                item._deleted = true;
                await this.localDatabase.put(item);
                this.updateRecentModifiedDocs(item._id, item._rev, true);
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
        let leftData = note.data;
        let savenNotes = [];
        let processed = 0;
        let made = 0;
        let skiped = 0;
        let pieceSize = MAX_DOC_SIZE_BIN;
        let plainSplit = false;
        let cacheUsed = 0;
        let userpasswordHash = this.h32Raw(new TextEncoder().encode(this.settings.passphrase));
        if (this.isPlainText(note._id)) {
            pieceSize = MAX_DOC_SIZE;
            plainSplit = true;
        }
        let newLeafs: EntryLeaf[] = [];
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

            let piece = leftData.substring(0, cPieceSize);
            leftData = leftData.substring(cPieceSize);
            processed++;
            let leafid = "";
            // Get hash of piece.
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
                        let pieceData = await this.localDatabase.get<EntryLeaf>(nleafid);
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
                        let passphrase = this.settings.passphrase;
                        savePiece = await encrypt(piece, passphrase);
                    }
                    let d: EntryLeaf = {
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
                let result = await this.localDatabase.bulkDocs(newLeafs);
                for (let item of result) {
                    if ((item as any).ok) {
                        this.updateRecentModifiedDocs(item.id, item.rev, false);

                        Logger(`save ok:id:${item.id} rev:${item.rev}`, LOG_LEVEL.VERBOSE);
                    } else {
                        if ((item as any).status && (item as any).status == 409) {
                            // conflicted, but it would be ok in childrens.
                        } else {
                            Logger(`save failed:id:${item.id} rev:${item.rev}`, LOG_LEVEL.NOTICE);
                            Logger(item);
                            this.disposeHashCache();
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
            Logger(`note saven:${newDoc._id}:${r.rev}`);
        } else {
            Logger(`note coud not saved:${note._id}`);
        }
    }

    syncHandler: PouchDB.Replication.Sync<{}> = null;
    syncStatus: DatabaseConnectingStatus = "NOT_CONNECTED";
    docArrived: number = 0;
    docSent: number = 0;
    docSeq: string = "";
    updateInfo: () => void = () => {
        console.log("default updinfo");
    };
    async migrate(from: number, to: number): Promise<boolean> {
        Logger(`Database updated from ${from} to ${to}`, LOG_LEVEL.NOTICE);
        // no op now,
        return true;
    }
    replicateAllToServer(setting: ObsidianLiveSyncSettings, showingNotice?: boolean) {
        return new Promise(async (res, rej) => {
            this.closeReplication();
            Logger("send all data to server", LOG_LEVEL.NOTICE);
            let notice: Notice = null;
            if (showingNotice) {
                notice = new Notice("Initializing", 0);
            }
            this.syncStatus = "CLOSED";
            this.updateInfo();
            let uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
            let auth: Credential = {
                username: setting.couchDB_USER,
                password: setting.couchDB_PASSWORD,
            };
            let dbret = await connectRemoteCouchDB(uri, auth);
            if (typeof dbret === "string") {
                Logger(`could not connect to ${uri}:${dbret}`, LOG_LEVEL.NOTICE);
                if (notice != null) notice.hide();
                return rej(`could not connect to ${uri}:${dbret}`);
            }

            let syncOptionBase: PouchDB.Replication.SyncOptions = {
                batch_size: 250,
                batches_limit: 40,
            };

            let db = dbret.db;
            let totalCount = (await this.localDatabase.info()).doc_count;
            //replicate once
            let replicate = this.localDatabase.replicate.to(db, syncOptionBase);
            replicate
                .on("active", () => {
                    this.syncStatus = "CONNECTED";
                    this.updateInfo();
                    if (notice) {
                        notice.setMessage("CONNECTED");
                    }
                })
                .on("change", async (e) => {
                    // no op.
                    this.docSent += e.docs.length;
                    this.updateInfo();
                    notice.setMessage(`SENDING:${e.docs_written}/${totalCount}`);
                    Logger(`replicateAllToServer: sending..:${e.docs.length}`);
                })
                .on("complete", async (info) => {
                    this.syncStatus = "COMPLETED";
                    this.updateInfo();
                    Logger("replicateAllToServer: Completed", LOG_LEVEL.NOTICE);
                    replicate.cancel();
                    replicate.removeAllListeners();
                    if (notice != null) notice.hide();
                    res(true);
                })
                .on("error", (e) => {
                    this.syncStatus = "ERRORED";
                    this.updateInfo();
                    Logger("replicateAllToServer: Pulling Replication error", LOG_LEVEL.INFO);
                    Logger(e);
                    replicate.cancel();
                    replicate.removeAllListeners();
                    if (notice != null) notice.hide();
                    rej(e);
                });
        });
    }

    async openReplication(setting: ObsidianLiveSyncSettings, keepAlive: boolean, showResult: boolean, callback: (e: PouchDB.Core.ExistingDocument<{}>[]) => Promise<void>) {
        if (!this.isReady) {
            Logger("Database is not ready.");
            return false;
        }

        if (setting.versionUpFlash != "") {
            new Notice("Open settings and check message, please.");
            return;
        }
        let uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        let auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        if (this.syncHandler != null) {
            Logger("Another replication running.");
            return false;
        }
        let dbret = await connectRemoteCouchDB(uri, auth);
        if (typeof dbret === "string") {
            Logger(`could not connect to ${uri}:${dbret}`, LOG_LEVEL.NOTICE);
            return;
        }

        if (!(await checkRemoteVersion(dbret.db, this.migrate.bind(this), VER))) {
            Logger("Remote database is newer or corrupted, make sure to latest version of self-hosted-livesync installed", LOG_LEVEL.NOTICE);
            return;
        }

        let defMilestonePoint: EntryMilestoneInfo = {
            _id: MILSTONE_DOCID,
            type: "milestoneinfo",
            created: (new Date() as any) / 1,
            locked: false,
            accepted_nodes: [this.nodeid],
        };

        let remoteMilestone: EntryMilestoneInfo = await resolveWithIgnoreKnownError(dbret.db.get(MILSTONE_DOCID), defMilestonePoint);
        this.remoteLocked = remoteMilestone.locked;
        this.remoteLockedAndDeviceNotAccepted = remoteMilestone.locked && remoteMilestone.accepted_nodes.indexOf(this.nodeid) == -1;

        if (remoteMilestone.locked && remoteMilestone.accepted_nodes.indexOf(this.nodeid) == -1) {
            Logger("Remote database marked as 'Auto Sync Locked'. And this devide does not marked as resolved device. see settings dialog.", LOG_LEVEL.NOTICE);
            return;
        }
        if (typeof remoteMilestone._rev == "undefined") {
            await dbret.db.put(remoteMilestone);
        }

        let syncOptionBase: PouchDB.Replication.SyncOptions = {
            batch_size: 250,
            batches_limit: 40,
        };
        let syncOption: PouchDB.Replication.SyncOptions = keepAlive ? { live: true, retry: true, heartbeat: 30000, ...syncOptionBase } : { ...syncOptionBase };
        let notice: Notice = null;
        if (showResult) {
            notice = new Notice("Replicating", 0);
        }
        let db = dbret.db;
        //replicate once
        this.syncStatus = "CONNECTED";
        Logger("Pull before replicate.");
        Logger(await this.localDatabase.info(), LOG_LEVEL.VERBOSE);
        Logger(await db.info(), LOG_LEVEL.VERBOSE);
        let replicate = this.localDatabase.replicate.from(db, syncOptionBase);
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
                    callback(e.docs);
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
            })
            .on("complete", async (info) => {
                this.syncStatus = "COMPLETED";
                this.updateInfo();
                replicate.cancel();
                replicate.removeAllListeners();
                this.syncHandler = null;
                if (this.syncHandler != null) {
                    this.syncHandler.cancel();
                    this.syncHandler.removeAllListeners();
                }
                Logger("Replication pull completed.");
                this.syncHandler = this.localDatabase.sync(db, syncOption);
                this.syncHandler
                    .on("active", () => {
                        this.syncStatus = "CONNECTED";
                        this.updateInfo();
                        Logger("Replication activated");
                    })
                    .on("change", async (e) => {
                        try {
                            if (e.direction == "pull") {
                                callback(e.change.docs);
                                Logger(`replicated ${e.change.docs_read} doc(s)`);
                                this.docArrived += e.change.docs.length;
                            } else {
                                this.docSent += e.change.docs.length;
                            }
                            if (notice != null) {
                                notice.setMessage(`↑${e.change.docs_written} ↓${e.change.docs_read}`);
                            }
                            this.updateInfo();
                        } catch (ex) {
                            Logger("Replication callback error");
                            Logger(ex);
                        }
                    })
                    .on("complete", (e) => {
                        this.syncStatus = "COMPLETED";
                        this.updateInfo();
                        Logger("Replication completed", showResult ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO);
                        this.syncHandler = null;
                        if (notice != null) notice.hide();
                    })
                    .on("denied", (e) => {
                        this.syncStatus = "ERRORED";
                        this.updateInfo();
                        if (notice != null) notice.hide();
                        Logger("Replication denied", LOG_LEVEL.NOTICE);
                        // Logger(e);
                    })
                    .on("error", (e) => {
                        this.syncStatus = "ERRORED";
                        this.updateInfo();
                        if (notice != null) notice.hide();
                        Logger("Replication error", LOG_LEVEL.NOTICE);
                        // Logger(e);
                    })
                    .on("paused", (e) => {
                        this.syncStatus = "PAUSED";
                        this.updateInfo();
                        if (notice != null) notice.hide();
                        Logger("replication paused", LOG_LEVEL.VERBOSE);
                        // Logger(e);
                    });
            })
            .on("error", (e) => {
                this.syncStatus = "ERRORED";
                this.updateInfo();
                Logger("Pulling Replication error", LOG_LEVEL.INFO);
                replicate.cancel();
                replicate.removeAllListeners();
                this.syncHandler.cancel();
                this.syncHandler.removeAllListeners();
                this.syncHandler = null;
                if (notice != null) notice.hide();
                // debugger;
                Logger(e);
            });
    }

    closeReplication() {
        if (this.syncHandler == null) {
            return;
        }
        this.syncStatus = "CLOSED";
        this.updateInfo();
        this.syncHandler.cancel();
        this.syncHandler.removeAllListeners();
        this.syncHandler = null;
        Logger("Replication closed");
    }

    async resetDatabase() {
        if (this.changeHandler != null) {
            this.changeHandler.removeAllListeners();
            this.changeHandler.cancel();
        }
        await this.closeReplication();
        this.isReady = false;
        await this.localDatabase.destroy();
        this.localDatabase = null;
        await this.initializeDatabase();
        this.disposeHashCache();
        Logger("Local Database Reset", LOG_LEVEL.NOTICE);
    }
    async tryResetRemoteDatabase(setting: ObsidianLiveSyncSettings) {
        await this.closeReplication();
        let uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        let auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        let con = await connectRemoteCouchDB(uri, auth);
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
        let uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        let auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        let con2 = await connectRemoteCouchDB(uri, auth);
        if (typeof con2 === "string") return;
        Logger("Remote Database Created or Connected", LOG_LEVEL.NOTICE);
    }
    async markRemoteLocked(setting: ObsidianLiveSyncSettings, locked: boolean) {
        let uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        let auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        let dbret = await connectRemoteCouchDB(uri, auth);
        if (typeof dbret === "string") {
            Logger(`could not connect to ${uri}:${dbret}`, LOG_LEVEL.NOTICE);
            return;
        }

        if (!(await checkRemoteVersion(dbret.db, this.migrate.bind(this), VER))) {
            Logger("Remote database is newer or corrupted, make sure to latest version of self-hosted-livesync installed", LOG_LEVEL.NOTICE);
            return;
        }
        let defInitPoint: EntryMilestoneInfo = {
            _id: MILSTONE_DOCID,
            type: "milestoneinfo",
            created: (new Date() as any) / 1,
            locked: locked,
            accepted_nodes: [this.nodeid],
        };

        let remoteMilestone: EntryMilestoneInfo = await resolveWithIgnoreKnownError(dbret.db.get(MILSTONE_DOCID), defInitPoint);
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
        let uri = setting.couchDB_URI + (setting.couchDB_DBNAME == "" ? "" : "/" + setting.couchDB_DBNAME);
        let auth: Credential = {
            username: setting.couchDB_USER,
            password: setting.couchDB_PASSWORD,
        };
        let dbret = await connectRemoteCouchDB(uri, auth);
        if (typeof dbret === "string") {
            Logger(`could not connect to ${uri}:${dbret}`, LOG_LEVEL.NOTICE);
            return;
        }

        if (!(await checkRemoteVersion(dbret.db, this.migrate.bind(this), VER))) {
            Logger("Remote database is newer or corrupted, make sure to latest version of self-hosted-livesync installed", LOG_LEVEL.NOTICE);
            return;
        }
        let defInitPoint: EntryMilestoneInfo = {
            _id: MILSTONE_DOCID,
            type: "milestoneinfo",
            created: (new Date() as any) / 1,
            locked: false,
            accepted_nodes: [this.nodeid],
        };
        // check local database hash status and remote replicate hash status
        let remoteMilestone: EntryMilestoneInfo = await resolveWithIgnoreKnownError(dbret.db.get(MILSTONE_DOCID), defInitPoint);
        // remoteMilestone.locked = false;
        remoteMilestone.accepted_nodes = Array.from(new Set([...remoteMilestone.accepted_nodes, this.nodeid]));
        // this.remoteLocked = false;
        Logger("Mark this device as 'resolved'.", LOG_LEVEL.NOTICE);
        await dbret.db.put(remoteMilestone);
    }

    async garbageCollect() {
        // get all documents of NewEntry2
        // we don't use queries , just use allDocs();
        let c = 0;
        let readCount = 0;
        let hashPieces: string[] = [];
        let usedPieces: string[] = [];
        Logger("Collecting Garbage");
        do {
            let result = await this.localDatabase.allDocs({ include_docs: true, skip: c, limit: 500, conflicts: true });
            readCount = result.rows.length;
            Logger("checked:" + readCount);
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
                }
            }
            c += readCount;
        } while (readCount != 0);
        // items collected.
        Logger("Finding unused pieces");
        const garbages = hashPieces.filter((e) => usedPieces.indexOf(e) == -1);
        let deleteCount = 0;
        Logger("we have to delete:" + garbages.length);
        let deleteDoc: EntryDoc[] = [];
        for (let v of garbages) {
            try {
                let item = await this.localDatabase.get(v);
                item._deleted = true;
                deleteDoc.push(item);
                if (deleteDoc.length > 50) {
                    await this.localDatabase.bulkDocs(deleteDoc);
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
            await this.localDatabase.bulkDocs(deleteDoc);
        }
        Logger(`GC:deleted ${deleteCount} items.`);
    }
}

export default class ObsidianLiveSyncPlugin extends Plugin {
    settings: ObsidianLiveSyncSettings;
    localDatabase: LocalPouchDB;
    logMessage: string[] = [];
    statusBar: HTMLElement;
    statusBar2: HTMLElement;
    suspended: boolean;

    async onload() {
        Logger = this.addLog.bind(this); // Logger moved to global.
        Logger("loading plugin");
        const lsname = "obsidian-live-sync-ver" + this.app.vault.getName();
        const last_version = localStorage.getItem(lsname);
        await this.loadSettings();
        if (!last_version || Number(last_version) < VER) {
            this.settings.liveSync = false;
            this.settings.syncOnSave = false;
            this.settings.syncOnStart = false;
            this.settings.syncOnFileOpen = false;
            this.settings.periodicReplication = false;
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
        this.statusBar.addClass("syncstatusbar");
        this.refreshStatusText = this.refreshStatusText.bind(this);

        this.statusBar2 = this.addStatusBarItem();
        // this.watchVaultChange = debounce(this.watchVaultChange.bind(this), delay, false);
        // this.watchVaultDelete = debounce(this.watchVaultDelete.bind(this), delay, false);
        // this.watchVaultRename = debounce(this.watchVaultRename.bind(this), delay, false);

        this.watchVaultChange = this.watchVaultChange.bind(this);
        this.watchVaultCreate = this.watchVaultCreate.bind(this);
        this.watchVaultDelete = this.watchVaultDelete.bind(this);
        this.watchVaultRename = this.watchVaultRename.bind(this);
        this.watchWorkspaceOpen = debounce(this.watchWorkspaceOpen.bind(this), 1000, false);
        this.watchWindowVisiblity = debounce(this.watchWindowVisiblity.bind(this), 1000, false);

        this.parseReplicationResult = this.parseReplicationResult.bind(this);

        this.periodicSync = this.periodicSync.bind(this);
        this.setPeriodicSync = this.setPeriodicSync.bind(this);

        // this.registerWatchEvents();
        this.addSettingTab(new ObsidianLiveSyncSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(async () => {
            try {
                await this.initializeDatabase();
                await this.realizeSettingSyncMode();
                this.registerWatchEvents();
            } catch (ex) {
                Logger("Error while loading Self-hosted LiveSync", LOG_LEVEL.NOTICE);
                Logger(ex, LOG_LEVEL.VERBOSE);
            }
        });
        this.addCommand({
            id: "livesync-replicate",
            name: "Replicate now",
            callback: () => {
                this.replicate();
            },
        });
        this.addCommand({
            id: "livesync-dump",
            name: "Dump informations of this doc ",
            editorCallback: (editor: Editor, view: MarkdownView) => {
                //this.replicate();
                this.localDatabase.getDBEntry(view.file.path, {}, true);
            },
        });
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
    }
    onunload() {
        if (this.gcTimerHandler != null) {
            clearTimeout(this.gcTimerHandler);
            this.gcTimerHandler = null;
        }
        this.clearPeriodicSync();
        this.localDatabase.closeReplication();
        this.localDatabase.close();
        window.removeEventListener("visibilitychange", this.watchWindowVisiblity);
        Logger("unloading plugin");
    }

    async openDatabase() {
        if (this.localDatabase != null) {
            this.localDatabase.close();
        }
        let vaultName = this.app.vault.getName();
        Logger("Open Database...");
        this.localDatabase = new LocalPouchDB(this.settings, vaultName);
        this.localDatabase.updateInfo = () => {
            this.refreshStatusText();
        };
        await this.localDatabase.initializeDatabase();
    }
    async garbageCollect() {
        await this.localDatabase.garbageCollect();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.settings.workingEncrypt = this.settings.encrypt;
        this.settings.workingPassphrase = this.settings.passphrase;
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.localDatabase.settings = this.settings;
        await this.realizeSettingSyncMode();
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
        window.addEventListener("visibilitychange", this.watchWindowVisiblity);
    }

    watchWindowVisiblity() {
        this.watchWindowVisiblityAsync();
    }
    async watchWindowVisiblityAsync() {
        if (this.settings.suspendFileWatching) return;
        // if (this.suspended) return;
        let isHidden = document.hidden;
        await this.applyBatchChange();
        if (isHidden) {
            this.localDatabase.closeReplication();
            this.clearPeriodicSync();
        } else {
            // suspend all temporary.
            if (this.suspended) return;
            if (this.settings.liveSync) {
                await this.localDatabase.openReplication(this.settings, true, false, this.parseReplicationResult);
            }
            if (this.settings.syncOnStart) {
                await this.localDatabase.openReplication(this.settings, false, false, this.parseReplicationResult);
            }
            if (this.settings.periodicReplication) {
                this.setPeriodicSync();
            }
        }
        this.gcHook();
    }

    watchWorkspaceOpen(file: TFile) {
        if (this.settings.suspendFileWatching) return;
        this.watchWorkspaceOpenAsync(file);
    }
    async watchWorkspaceOpenAsync(file: TFile) {
        await this.applyBatchChange();
        if (file == null) return;
        if (this.settings.syncOnFileOpen && !this.suspended) {
            await this.replicate();
        }
        this.localDatabase.disposeHashCache();
        await this.showIfConflicted(file);
        this.gcHook();
    }
    watchVaultCreate(file: TFile, ...args: any[]) {
        if (this.settings.suspendFileWatching) return;
        this.watchVaultChangeAsync(file, ...args);
    }
    watchVaultChange(file: TFile, ...args: any[]) {
        if (this.settings.suspendFileWatching) return;
        // If batchsave is enabled, queue all changes and do nothing.
        if (this.settings.batchSave) {
            this.batchFileChange = Array.from(new Set([...this.batchFileChange, file.path]));
            this.refreshStatusText();
            return;
        }
        this.watchVaultChangeAsync(file, ...args);
    }
    applyBatchChange() {
        let batchItems = JSON.parse(JSON.stringify(this.batchFileChange)) as string[];
        this.batchFileChange = [];
        let files = this.app.vault.getFiles();
        let promises = batchItems.map(async (e) => {
            try {
                if (await this.app.vault.adapter.exists(normalizePath(e))) {
                    let f = files.find((f) => f.path == e);
                    if (f) {
                        await this.updateIntoDB(f);
                        Logger(`Batch save:${e}`);
                    }
                }
            } catch (ex) {
                Logger(`Batch save error:${e}`, LOG_LEVEL.NOTICE);
                Logger(ex, LOG_LEVEL.VERBOSE);
            }
        });
        this.refreshStatusText();
        return Promise.all(promises);
    }
    batchFileChange: string[] = [];
    async watchVaultChangeAsync(file: TFile, ...args: any[]) {
        if (file instanceof TFile) {
            await this.updateIntoDB(file);
            this.gcHook();
        }
    }
    watchVaultDelete(file: TFile | TFolder) {
        // When save is delayed, it should be cancelled.
        this.batchFileChange = this.batchFileChange.filter((e) => e == file.path);
        if (this.settings.suspendFileWatching) return;
        this.watchVaultDeleteAsync(file);
    }
    async watchVaultDeleteAsync(file: TFile | TFolder) {
        if (file instanceof TFile) {
            await this.deleteFromDB(file);
        } else if (file instanceof TFolder) {
            await this.deleteFolderOnDB(file);
        }
        this.gcHook();
    }
    GetAllFilesRecursively(file: TAbstractFile): TFile[] {
        if (file instanceof TFile) {
            return [file];
        } else if (file instanceof TFolder) {
            let result: TFile[] = [];
            for (var v of file.children) {
                result.push(...this.GetAllFilesRecursively(v));
            }
            return result;
        } else {
            Logger(`Filetype error:${file.path}`, LOG_LEVEL.NOTICE);
            throw new Error(`Filetype error:${file.path}`);
        }
    }
    watchVaultRename(file: TFile | TFolder, oldFile: any) {
        if (this.settings.suspendFileWatching) return;
        this.watchVaultRenameAsync(file, oldFile);
    }
    getFilePath(file: TAbstractFile): string {
        if (file instanceof TFolder) {
            if (file.isRoot()) return "";
            return this.getFilePath(file.parent) + "/" + file.name;
        }
        if (file instanceof TFile) {
            return this.getFilePath(file.parent) + "/" + file.name;
        }
    }
    async watchVaultRenameAsync(file: TFile | TFolder, oldFile: any) {
        Logger(`${oldFile} renamed to ${file.path}`, LOG_LEVEL.VERBOSE);
        await this.applyBatchChange();
        if (file instanceof TFolder) {
            const newFiles = this.GetAllFilesRecursively(file);
            // for guard edge cases. this won't happen and each file's event will be raise.
            for (const i of newFiles) {
                let newFilePath = normalizePath(this.getFilePath(i));
                let newFile = this.app.vault.getAbstractFileByPath(newFilePath);
                if (newFile instanceof TFile) {
                    Logger(`save ${newFile.path} into db`);
                    await this.updateIntoDB(newFile);
                }
            }
            Logger(`delete below ${oldFile} from db`);
            await this.deleteFromDBbyPath(oldFile);
        } else if (file instanceof TFile) {
            Logger(`file save ${file.path} into db`);
            await this.updateIntoDB(file);
            Logger(`deleted ${oldFile} into db`);
            await this.deleteFromDBbyPath(oldFile);
        }
        this.gcHook();
    }
    addLogHook: () => void = null;
    //--> Basic document Functions
    async addLog(message: any, level: LOG_LEVEL = LOG_LEVEL.INFO) {
        if (level < LOG_LEVEL.INFO && this.settings && this.settings.lessInformationInLog) {
            return;
        }
        if (this.settings && !this.settings.showVerboseLog && level == LOG_LEVEL.VERBOSE) {
            return;
        }
        let valutName = this.app.vault.getName();
        let timestamp = new Date().toLocaleString();
        let messagecontent = typeof message == "string" ? message : message instanceof Error ? `${message.name}:${message.message}` : JSON.stringify(message, null, 2);
        let newmessage = timestamp + "->" + messagecontent;

        this.logMessage = [].concat(this.logMessage).concat([newmessage]).slice(-100);
        console.log(valutName + ":" + newmessage);
        // if (this.statusBar2 != null) {
        //     this.statusBar2.setText(newmessage.substring(0, 60));
        // }
        if (level >= LOG_LEVEL.NOTICE) {
            new Notice(messagecontent);
        }
        if (this.addLogHook != null) this.addLogHook();
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
                    Logger("Folder Create Error");
                    Logger(ex);
                }
            }
            c += "/";
        }
    }

    async doc2storage_create(docEntry: EntryBody, force?: boolean) {
        let pathSrc = id2path(docEntry._id);
        let doc = await this.localDatabase.getDBEntry(pathSrc, { rev: docEntry._rev });
        if (doc === false) return;
        let path = id2path(doc._id);
        if (doc.datatype == "newnote") {
            let bin = base64ToArrayBuffer(doc.data);
            if (bin != null) {
                if (!isValidPath(path)) {
                    Logger(`The file that having platform dependent name has been arrived. This file has skipped: ${path}`, LOG_LEVEL.NOTICE);
                    return;
                }
                await this.ensureDirectory(path);
                try {
                    let newfile = await this.app.vault.createBinary(normalizePath(path), bin, { ctime: doc.ctime, mtime: doc.mtime });
                    Logger("live : write to local (newfile:b) " + path);
                    await this.app.vault.trigger("create", newfile);
                } catch (ex) {
                    Logger("could not write to local (newfile:bin) " + path, LOG_LEVEL.NOTICE);
                    Logger(ex, LOG_LEVEL.VERBOSE);
                }
            }
        } else if (doc.datatype == "plain") {
            if (!isValidPath(path)) {
                Logger(`The file that having platform dependent name has been arrived. This file has skipped: ${path}`, LOG_LEVEL.NOTICE);
                return;
            }
            await this.ensureDirectory(path);
            try {
                let newfile = await this.app.vault.create(normalizePath(path), doc.data, { ctime: doc.ctime, mtime: doc.mtime });
                Logger("live : write to local (newfile:p) " + path);
                await this.app.vault.trigger("create", newfile);
            } catch (ex) {
                Logger("could not write to local (newfile:plain) " + path, LOG_LEVEL.NOTICE);
                Logger(ex, LOG_LEVEL.VERBOSE);
            }
        } else {
            Logger("live : New data imcoming, but we cound't parse that." + doc.datatype, LOG_LEVEL.NOTICE);
        }
    }

    async deleteVaultItem(file: TFile | TFolder) {
        let dir = file.parent;
        if (this.settings.trashInsteadDelete) {
            await this.app.vault.trash(file, false);
        } else {
            await this.app.vault.delete(file);
        }
        Logger(`deleted:${file.path}`);
        Logger(`other items:${dir.children.length}`);
        if (dir.children.length == 0) {
            if (!this.settings.doNotDeleteFolder) {
                Logger(`all files deleted by replication, so delete dir`);
                await this.deleteVaultItem(dir);
            }
        }
    }
    async doc2storate_modify(docEntry: EntryBody, file: TFile, force?: boolean) {
        let pathSrc = id2path(docEntry._id);
        if (docEntry._deleted) {
            //basically pass.
            //but if there're no docs left, delete file.
            let lastDocs = await this.localDatabase.getDBEntry(pathSrc);
            if (lastDocs === false) {
                await this.deleteVaultItem(file);
            } else {
                // it perhaps delete some revisions.
                // may be we have to reload this
                await this.pullFile(pathSrc, null, true);
                Logger(`delete skipped:${lastDocs._id}`);
            }
            return;
        }
        let localMtime = ~~(file.stat.mtime / 1000);
        let docMtime = ~~(docEntry.mtime / 1000);
        if (localMtime < docMtime || force) {
            let doc = await this.localDatabase.getDBEntry(pathSrc);
            let msg = "livesync : newer local files so write to local:" + file.path;
            if (force) msg = "livesync : force write to local:" + file.path;
            if (doc === false) return;
            let path = id2path(doc._id);
            if (doc.datatype == "newnote") {
                let bin = base64ToArrayBuffer(doc.data);
                if (bin != null) {
                    if (!isValidPath(path)) {
                        Logger(`The file that having platform dependent name has been arrived. This file has skipped: ${path}`, LOG_LEVEL.NOTICE);
                        return;
                    }
                    await this.ensureDirectory(path);
                    try {
                        await this.app.vault.modifyBinary(file, bin, { ctime: doc.ctime, mtime: doc.mtime });
                        Logger(msg);
                        await this.app.vault.trigger("modify", file);
                    } catch (ex) {
                        Logger("could not write to local (modify:bin) " + path, LOG_LEVEL.NOTICE);
                    }
                }
            } else if (doc.datatype == "plain") {
                if (!isValidPath(path)) {
                    Logger(`The file that having platform dependent name has been arrived. This file has skipped: ${path}`, LOG_LEVEL.NOTICE);
                    return;
                }
                await this.ensureDirectory(path);
                try {
                    await this.app.vault.modify(file, doc.data, { ctime: doc.ctime, mtime: doc.mtime });
                    Logger(msg);
                    await this.app.vault.trigger("modify", file);
                } catch (ex) {
                    Logger("could not write to local (modify:plain) " + path, LOG_LEVEL.NOTICE);
                }
            } else {
                Logger("live : New data imcoming, but we cound't parse that.:" + doc.datatype + "-", LOG_LEVEL.NOTICE);
            }
        } else if (localMtime > docMtime) {
            // newer local file.
            // ?
        } else {
            //Nothing have to op.
            //eq.case
        }
    }
    async handleDBChanged(change: EntryBody) {
        let allfiles = this.app.vault.getFiles();
        let targetFiles = allfiles.filter((e) => e.path == id2path(change._id));
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

    periodicSyncHandler: NodeJS.Timer = null;
    //---> Sync
    async parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): Promise<void> {
        this.refreshStatusText();
        for (var change of docs) {
            if (this.localDatabase.isSelfModified(change._id, change._rev)) {
                return;
            }
            Logger("replication change arrived", LOG_LEVEL.VERBOSE);
            if (change.type != "leaf" && change.type != "versioninfo" && change.type != "milestoneinfo" && change.type != "nodeinfo" && change.type != "plugin") {
                await this.handleDBChanged(change);
            }
            if (change.type == "versioninfo") {
                if (change.version > VER) {
                    this.localDatabase.closeReplication();
                    Logger(`Remote database updated to incompatible version. update your self-hosted-livesync plugin.`, LOG_LEVEL.NOTICE);
                }
            }
            this.gcHook();
        }
    }
    clearPeriodicSync() {
        if (this.periodicSyncHandler != null) {
            clearInterval(this.periodicSyncHandler);
            this.periodicSyncHandler = null;
        }
    }
    setPeriodicSync() {
        if (this.settings.periodicReplication && this.settings.periodicReplicationInterval > 0) {
            this.clearPeriodicSync();
            this.periodicSyncHandler = setInterval(async () => await this.periodicSync(), Math.max(this.settings.periodicReplicationInterval, 30) * 1000);
        }
    }
    async periodicSync() {
        await this.replicate();
    }
    async realizeSettingSyncMode() {
        this.localDatabase.closeReplication();
        this.clearPeriodicSync();
        await this.applyBatchChange();
        // disable all sync temporary.
        if (this.suspended) return;
        if (this.settings.liveSync) {
            this.localDatabase.openReplication(this.settings, true, false, this.parseReplicationResult);
            this.refreshStatusText();
        }
        this.setPeriodicSync();
    }
    refreshStatusText() {
        let sent = this.localDatabase.docSent;
        let arrived = this.localDatabase.docArrived;
        let w = "";
        switch (this.localDatabase.syncStatus) {
            case "CLOSED":
            case "COMPLETED":
            case "NOT_CONNECTED":
                w = "⏹";
                break;
            case "PAUSED":
                w = "💤";
                break;

            case "CONNECTED":
                w = "⚡";
                break;
            case "ERRORED":
                w = "⚠";
                break;
            default:
                w = "?";
        }
        this.statusBar.title = this.localDatabase.syncStatus;
        let waiting = "";
        if (this.settings.batchSave) {
            waiting = " " + this.batchFileChange.map((e) => "🚀").join("");
        }
        this.statusBar.setText(`Sync:${w} ↑${sent} ↓${arrived}${waiting}`);
    }
    async replicate(showMessage?: boolean) {
        if (this.settings.versionUpFlash != "") {
            new Notice("Open settings and check message, please.");
            return;
        }
        await this.applyBatchChange();
        this.localDatabase.openReplication(this.settings, false, showMessage, this.parseReplicationResult);
    }

    async initializeDatabase(showingNotice?: boolean) {
        await this.openDatabase();
        await this.syncAllFiles(showingNotice);
    }
    async replicateAllToServer(showingNotice?: boolean) {
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
        let notice: Notice = null;
        if (showingNotice) {
            notice = new Notice("Initializing", 0);
        }
        const filesStorage = this.app.vault.getFiles();
        const filesStorageName = filesStorage.map((e) => e.path);
        const wf = await this.localDatabase.localDatabase.allDocs();
        const filesDatabase = wf.rows.filter((e) => !e.id.startsWith("h:") && !e.id.startsWith("ps:") && e.id != "obsydian_livesync_version").map((e) => id2path(e.id));

        const onlyInStorage = filesStorage.filter((e) => filesDatabase.indexOf(e.path) == -1);
        const onlyInDatabase = filesDatabase.filter((e) => filesStorageName.indexOf(e) == -1);

        const onlyInStorageNames = onlyInStorage.map((e) => e.path);

        const syncFiles = filesStorage.filter((e) => onlyInStorageNames.indexOf(e.path) == -1);
        Logger("Initialize and checking database files");
        Logger("Updating database by new files");
        this.statusBar.setText(`UPDATE DATABASE`);
        async function runAll<T>(procedurename: string, objects: T[], callback: (arg: T) => Promise<void>) {
            const count = objects.length;
            Logger(procedurename);
            let i = 0;
            // let lastTicks = performance.now() + 2000;
            let procs = objects.map(async (e) => {
                try {
                    // debugger;
                    // Logger("hello?")
                    await callback(e);
                    i++;
                    if (i % 25 == 0) {
                        const notify = `${procedurename} : ${i}/${count}`;
                        if (notice != null) notice.setMessage(notify);
                        Logger(notify);
                        // lastTicks = performance.now() + 2000;
                        // this.statusBar.setText(notify);
                    }
                } catch (ex) {
                    Logger(`Error while ${procedurename}`, LOG_LEVEL.NOTICE);
                    Logger(ex);
                }
            });
            if (!Promise.allSettled) {
                await Promise.all(
                    procs.map((p) =>
                        p
                            .then((value) => ({
                                status: "fulfilled",
                                value,
                            }))
                            .catch((reason) => ({
                                status: "rejected",
                                reason,
                            }))
                    )
                );
            } else {
                await Promise.allSettled(procs);
            }
        }
        await runAll("UPDATE DATABASE", onlyInStorage, async (e) => {
            Logger(`Update into ${e.path}`);
            await this.updateIntoDB(e);
        });
        await runAll("UPDATE STORAGE", onlyInDatabase, async (e) => {
            Logger(`Pull from db:${e}`);
            await this.pullFile(e, filesStorage);
        });
        await runAll("CHECK FILE STATUS", syncFiles, async (e) => {
            await this.syncFileBetweenDBandStorage(e, filesStorage);
        });
        this.statusBar.setText(`NOW TRACKING!`);
        Logger("Initialized,NOW TRACKING!");
        if (showingNotice) {
            notice.hide();
            Logger("Initialize done!", LOG_LEVEL.NOTICE);
        }
    }
    async deleteFolderOnDB(folder: TFolder) {
        Logger(`delete folder:${folder.path}`);
        await this.localDatabase.deleteDBEntryPrefix(folder.path + "/");
        for (var v of folder.children) {
            let entry = v as TFile & TFolder;
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
                Logger(`error while delete filder:${folder.path}`, LOG_LEVEL.NOTICE);
                Logger(ex);
            }
        }
    }

    async renameFolder(folder: TFolder, oldFile: any) {
        for (var v of folder.children) {
            let entry = v as TFile & TFolder;
            if (entry.children) {
                await this.deleteFolderOnDB(entry);
                if (this.settings.trashInsteadDelete) {
                    await this.app.vault.trash(entry, false);
                } else {
                    await this.app.vault.delete(entry);
                }
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
            Logger(`could not get current revisions:${path}`, LOG_LEVEL.NOTICE);
            return false;
        }
        if (rightLeaf == false) {
            // Conflicted item could not load, delete this.
            await this.localDatabase.deleteDBEntry(path, { rev: test._conflicts[0] });
            await this.pullFile(path, null, true);
            Logger(`could not get old revisions, automaticaly used newer one:${path}`, LOG_LEVEL.NOTICE);
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
            Logger(`automaticaly merged:${path}`);
            return true;
        }
        if (this.settings.resolveConflictsByNewerFile) {
            let lmtime = ~~(leftLeaf.mtime / 1000);
            let rmtime = ~~(rightLeaf.mtime / 1000);
            let loser = leftLeaf;
            if (lmtime > rmtime) {
                loser = rightLeaf;
            }
            await this.localDatabase.deleteDBEntry(path, { rev: loser.rev });
            await this.pullFile(path, null, true);
            Logger(`Automaticaly merged (newerFileResolve) :${path}`, LOG_LEVEL.NOTICE);
            return true;
        }
        // make diff.
        let dmp = new diff_match_patch();
        var diff = dmp.diff_main(leftLeaf.data, rightLeaf.data);
        dmp.diff_cleanupSemantic(diff);
        Logger(`conflict(s) found:${path}`);
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
                    Logger("something went wrong on merging.", LOG_LEVEL.NOTICE);
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
                Logger(`resolved conflict:${file.path}`);
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
        let targetFiles = fileList.filter((e) => e.path == id2path(filename));
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
            Logger(`target files:${filename} is two or more files in your vault`);
            //something went wrong..
        }
        //when to opened file;
    }
    async syncFileBetweenDBandStorage(file: TFile, fileList?: TFile[]) {
        let doc = await this.localDatabase.getDBEntryMeta(file.path);
        if (doc === false) return;
        let storageMtime = ~~(file.stat.mtime / 1000);
        let docMtime = ~~(doc.mtime / 1000);
        if (storageMtime > docMtime) {
            //newer local file.
            Logger("DB -> STORAGE :" + file.path);
            Logger(`${storageMtime} > ${docMtime}`);
            await this.updateIntoDB(file);
        } else if (storageMtime < docMtime) {
            //newer database file.
            Logger("STORAGE <- DB :" + file.path);
            Logger(`${storageMtime} < ${docMtime}`);
            let docx = await this.localDatabase.getDBEntry(file.path);
            if (docx != false) {
                await this.doc2storate_modify(docx, file);
            }
        } else {
            // Logger("EVEN :" + file.path, LOG_LEVEL.VERBOSE);
            // Logger(`${storageMtime} = ${docMtime}`, LOG_LEVEL.VERBOSE);
            //eq.case
        }
    }

    async updateIntoDB(file: TFile) {
        let content = "";
        let datatype: "plain" | "newnote" = "newnote";
        if (file.extension != "md") {
            let contentBin = await this.app.vault.readBinary(file);
            content = await arrayBufferToBase64(contentBin);
            datatype = "newnote";
        } else {
            content = await this.app.vault.read(file);
            datatype = "plain";
        }
        let fullpath = path2id(file.path);
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
                Logger("not changed:" + fullpath + (d._deleted ? " (deleted)" : ""), LOG_LEVEL.VERBOSE);
                return;
            }
            // d._rev = old._rev;
        }
        let ret = await this.localDatabase.putDBEntry(d);

        Logger("put database:" + fullpath + "(" + datatype + ") ");
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
    }
    async deleteFromDB(file: TFile) {
        let fullpath = file.path;
        Logger(`deleteDB By path:${fullpath}`);
        await this.deleteFromDBbyPath(fullpath);
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
    }
    async deleteFromDBbyPath(fullpath: string) {
        await this.localDatabase.deleteDBEntry(fullpath);
        if (this.settings.syncOnSave && !this.suspended) {
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
        this.plugin.addLogHook = this.updateLog;
        this.updateLog();
    }
    onClose() {
        let { contentEl } = this;
        contentEl.empty();
        this.plugin.addLogHook = null;
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
        let db = await connectRemoteCouchDB(this.plugin.settings.couchDB_URI + (this.plugin.settings.couchDB_DBNAME == "" ? "" : "/" + this.plugin.settings.couchDB_DBNAME), {
            username: this.plugin.settings.couchDB_USER,
            password: this.plugin.settings.couchDB_PASSWORD,
        });
        if (typeof db === "string") {
            this.plugin.addLog(`could not connect to ${this.plugin.settings.couchDB_URI} : ${this.plugin.settings.couchDB_DBNAME} \n(${db})`, LOG_LEVEL.NOTICE);
            return;
        }
        this.plugin.addLog(`Connected to ${db.info.db_name}`, LOG_LEVEL.NOTICE);
    }
    display(): void {
        let { containerEl } = this;

        containerEl.empty();

        containerEl.createEl("h2", { text: "Settings for Self-hosted LiveSync." });

        containerEl.createEl("h3", { text: "Remote Database configuration" });

        const isAnySyncEnabled = (): boolean => {
            if (this.plugin.settings.liveSync) return true;
            if (this.plugin.settings.periodicReplication) return true;
            if (this.plugin.settings.syncOnFileOpen) return true;
            if (this.plugin.settings.syncOnSave) return true;
            if (this.plugin.settings.syncOnStart) return true;
        };
        const applyDisplayEnabled = () => {
            if (isAnySyncEnabled()) {
                dbsettings.forEach((e) => {
                    e.setDisabled(true).setTooltip("When any sync is enabled, It cound't be changed.");
                });
            } else {
                dbsettings.forEach((e) => {
                    e.setDisabled(false).setTooltip("");
                });
            }
            if (this.plugin.settings.liveSync) {
                syncNonLive.forEach((e) => {
                    e.setDisabled(true).setTooltip("");
                });
                syncLive.forEach((e) => {
                    e.setDisabled(false).setTooltip("");
                });
            } else if (this.plugin.settings.syncOnFileOpen || this.plugin.settings.syncOnSave || this.plugin.settings.syncOnStart || this.plugin.settings.periodicReplication) {
                syncNonLive.forEach((e) => {
                    e.setDisabled(false).setTooltip("");
                });
                syncLive.forEach((e) => {
                    e.setDisabled(true).setTooltip("");
                });
            } else {
                syncNonLive.forEach((e) => {
                    e.setDisabled(false).setTooltip("");
                });
                syncLive.forEach((e) => {
                    e.setDisabled(false).setTooltip("");
                });
            }
        };

        let dbsettings: Setting[] = [];
        dbsettings.push(
            new Setting(containerEl).setName("URI").addText((text) =>
                text
                    .setPlaceholder("https://........")
                    .setValue(this.plugin.settings.couchDB_URI)
                    .onChange(async (value) => {
                        this.plugin.settings.couchDB_URI = value;
                        await this.plugin.saveSettings();
                    })
            ),
            new Setting(containerEl)
                .setName("Username")
                .setDesc("username")
                .addText((text) =>
                    text
                        .setPlaceholder("")
                        .setValue(this.plugin.settings.couchDB_USER)
                        .onChange(async (value) => {
                            this.plugin.settings.couchDB_USER = value;
                            await this.plugin.saveSettings();
                        })
                ),
            new Setting(containerEl)
                .setName("Password")
                .setDesc("password")
                .addText((text) => {
                    text.setPlaceholder("")
                        .setValue(this.plugin.settings.couchDB_PASSWORD)
                        .onChange(async (value) => {
                            this.plugin.settings.couchDB_PASSWORD = value;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.setAttribute("type", "password");
                }),
            new Setting(containerEl).setName("Database name").addText((text) =>
                text
                    .setPlaceholder("")
                    .setValue(this.plugin.settings.couchDB_DBNAME)
                    .onChange(async (value) => {
                        this.plugin.settings.couchDB_DBNAME = value;
                        await this.plugin.saveSettings();
                    })
            )
        );

        new Setting(containerEl)
            .setName("Test Database Connection")
            .setDesc("Open database connection. If the remote database is not found and you have the privilege to create a database, the database will be created.")
            .addButton((button) =>
                button
                    .setButtonText("Test")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.testConnection();
                    })
            );

        containerEl.createEl("h3", { text: "Local Database configuration" });

        new Setting(containerEl)
            .setName("Batch database update (beta)")
            .setDesc("Delay all changes, save once before replication or opening another file.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.batchSave).onChange(async (value) => {
                    if (value && this.plugin.settings.liveSync) {
                        Logger("LiveSync and Batch database update cannot be used at the same time.", LOG_LEVEL.NOTICE);
                        toggle.setValue(false);
                        return;
                    }
                    this.plugin.settings.batchSave = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Auto Garbage Collection delay")
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
        new Setting(containerEl).setName("Manual Garbage Collect").addButton((button) =>
            button
                .setButtonText("Collect now")
                .setDisabled(false)
                .onClick(async () => {
                    await this.plugin.garbageCollect();
                })
        );
        new Setting(containerEl)
            .setName("End to End Encryption")
            .setDesc("Encrypting contents on the database.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.workingEncrypt).onChange(async (value) => {
                    this.plugin.settings.workingEncrypt = value;
                    phasspharase.setDisabled(!value);
                    await this.plugin.saveSettings();
                })
            );
        let phasspharase = new Setting(containerEl)
            .setName("Passphrase")
            .setDesc("Encrypting passphrase")
            .addText((text) => {
                text.setPlaceholder("")
                    .setValue(this.plugin.settings.workingPassphrase)
                    .onChange(async (value) => {
                        this.plugin.settings.workingPassphrase = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttribute("type", "password");
            });
        phasspharase.setDisabled(!this.plugin.settings.workingEncrypt);
        containerEl.createEl("div", {
            text: "When you change any encryption enabled or passphrase, you have to reset all databases to make sure that the last password is unused and erase encrypted data from anywhere. This operation will not lost your vault if you are fully synced.",
        });
        const applyEncryption = async (sendToServer: boolean) => {
            if (this.plugin.settings.workingEncrypt && this.plugin.settings.workingPassphrase == "") {
                Logger("If you enable encryption, you have to set the passphrase", LOG_LEVEL.NOTICE);
                return;
            }
            if (this.plugin.settings.workingEncrypt && !(await testCrypt())) {
                Logger("WARNING! Your device would not support encryption.", LOG_LEVEL.NOTICE);
                return;
            }
            if (!this.plugin.settings.workingEncrypt) {
                this.plugin.settings.workingPassphrase = "";
            }
            this.plugin.settings.liveSync = false;
            this.plugin.settings.periodicReplication = false;
            this.plugin.settings.syncOnSave = false;
            this.plugin.settings.syncOnStart = false;
            this.plugin.settings.syncOnFileOpen = false;
            this.plugin.settings.encrypt = this.plugin.settings.workingEncrypt;
            this.plugin.settings.passphrase = this.plugin.settings.workingPassphrase;

            await this.plugin.saveSettings();
            await this.plugin.resetLocalDatabase();
            if (sendToServer) {
                await this.plugin.initializeDatabase(true);
                await this.plugin.markRemoteLocked();
                await this.plugin.tryResetRemoteDatabase();
                await this.plugin.markRemoteLocked();
                await this.plugin.replicateAllToServer(true);
            } else {
                await this.plugin.markRemoteResolved();
                await this.plugin.replicate(true);
            }
        };
        new Setting(containerEl)
            .setName("Apply")
            .setDesc("apply encryption settinngs, and re-initialize database")
            .addButton((button) =>
                button
                    .setButtonText("Apply and send")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await applyEncryption(true);
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Apply and receive")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await applyEncryption(false);
                    })
            );

        containerEl.createEl("h3", { text: "General Settings" });

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
                    applyDisplayEnabled();
                    c.remove();
                });
            });
            c.addClass("op-warn");
        }

        let syncLive: Setting[] = [];
        let syncNonLive: Setting[] = [];
        syncLive.push(
            new Setting(containerEl)
                .setName("LiveSync")
                .setDesc("Sync realtime")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.liveSync).onChange(async (value) => {
                        if (value && this.plugin.settings.batchSave) {
                            Logger("LiveSync and Batch database update cannot be used at the same time.", LOG_LEVEL.NOTICE);
                            toggle.setValue(false);
                            return;
                        }

                        this.plugin.settings.liveSync = value;
                        // ps.setDisabled(value);
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                        await this.plugin.realizeSettingSyncMode();
                    })
                )
        );

        syncNonLive.push(
            new Setting(containerEl)
                .setName("Periodic Sync")
                .setDesc("Sync periodically")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.periodicReplication).onChange(async (value) => {
                        this.plugin.settings.periodicReplication = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                ),
            new Setting(containerEl)
                .setName("Periodic sync intreval")
                .setDesc("Interval (sec)")
                .addText((text) => {
                    text.setPlaceholder("")
                        .setValue(this.plugin.settings.periodicReplicationInterval + "")
                        .onChange(async (value) => {
                            let v = Number(value);
                            if (isNaN(v) || v > 5000) {
                                return 0;
                            }
                            this.plugin.settings.periodicReplicationInterval = v;
                            await this.plugin.saveSettings();
                            applyDisplayEnabled();
                        });
                    text.inputEl.setAttribute("type", "number");
                }),

            new Setting(containerEl)
                .setName("Sync on Save")
                .setDesc("When you save file, sync automatically")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
                        this.plugin.settings.syncOnSave = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                ),
            new Setting(containerEl)
                .setName("Sync on File Open")
                .setDesc("When you open file, sync automatically")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncOnFileOpen).onChange(async (value) => {
                        this.plugin.settings.syncOnFileOpen = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                ),
            new Setting(containerEl)
                .setName("Sync on Start")
                .setDesc("Start synchronization on Obsidian started.")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.syncOnStart).onChange(async (value) => {
                        this.plugin.settings.syncOnStart = value;
                        await this.plugin.saveSettings();
                        applyDisplayEnabled();
                    })
                )
        );

        new Setting(containerEl)
            .setName("Use Trash for deleted files")
            .setDesc("Do not delete files that deleted in remote, just move to trash.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.trashInsteadDelete).onChange(async (value) => {
                    this.plugin.settings.trashInsteadDelete = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Do not delete empty folder")
            .setDesc("Normally, folder is deleted When the folder became empty by replication. enable this, leave it as is")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.doNotDeleteFolder).onChange(async (value) => {
                    this.plugin.settings.doNotDeleteFolder = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Use newer file if conflicted (beta)")
            .setDesc("Resolve conflicts by newer files automatically.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.resolveConflictsByNewerFile).onChange(async (value) => {
                    this.plugin.settings.resolveConflictsByNewerFile = value;
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

        containerEl.createEl("h3", { text: "Hatch" });

        if (this.plugin.localDatabase.remoteLockedAndDeviceNotAccepted) {
            let c = containerEl.createEl("div", {
                text: "To prevent unwanted vault corruption, the remote database has been locked for synchronization, and this device was not marked as 'resolved'. it caused by some operations like this. re-initialized. Local database initialization should be required. please back your vault up, reset local database, and press 'Mark this device as resolved'. ",
            });
            c.createEl("button", { text: "I'm ready, mark this device 'resolved'" }, (e) => {
                e.addEventListener("click", async () => {
                    await this.plugin.markRemoteResolved();
                    c.remove();
                });
            });
            c.addClass("op-warn");
        } else {
            if (this.plugin.localDatabase.remoteLocked) {
                let c = containerEl.createEl("div", {
                    text: "To prevent unwanted vault corruption, the remote database has been locked for synchronization. (This device is marked 'resolved') When all your devices are marked 'resolved', unlock the database.",
                });
                c.createEl("button", { text: "I'm ready, unlock the database" }, (e) => {
                    e.addEventListener("click", async () => {
                        await this.plugin.markRemoteUnlocked();
                        c.remove();
                    });
                });
                c.addClass("op-warn");
            }
        }
        const dropHistory = async (sendToServer: boolean) => {
            this.plugin.settings.liveSync = false;
            this.plugin.settings.periodicReplication = false;
            this.plugin.settings.syncOnSave = false;
            this.plugin.settings.syncOnStart = false;
            this.plugin.settings.syncOnFileOpen = false;

            await this.plugin.saveSettings();
            applyDisplayEnabled();
            await this.plugin.resetLocalDatabase();
            if (sendToServer) {
                await this.plugin.initializeDatabase(true);
                await this.plugin.markRemoteLocked();
                await this.plugin.tryResetRemoteDatabase();
                await this.plugin.markRemoteLocked();
                await this.plugin.replicateAllToServer(true);
            } else {
                await this.plugin.markRemoteResolved();
                await this.plugin.replicate(true);
            }
        };
        new Setting(containerEl)
            .setName("Drop History")
            .setDesc("Initialize local and remote database, and send all or retrieve all again.")
            .addButton((button) =>
                button
                    .setButtonText("Drop and send")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await dropHistory(true);
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Drop and receive")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await dropHistory(false);
                    })
            );

        new Setting(containerEl)
            .setName("Lock remote database")
            .setDesc("Lock remote database for synchronize")
            .addButton((button) =>
                button
                    .setButtonText("Lock")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.markRemoteLocked();
                    })
            );

        new Setting(containerEl)
            .setName("Suspend file watching")
            .setDesc("if enables it, all file operations are ignored.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.suspendFileWatching).onChange(async (value) => {
                    this.plugin.settings.suspendFileWatching = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Reset remote database")
            .setDesc("Reset remote database, this affects only database. If you replicate again, remote database will restored by local database.")
            .addButton((button) =>
                button
                    .setButtonText("Reset")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.tryResetRemoteDatabase();
                    })
            );
        new Setting(containerEl)
            .setName("Reset local database")
            .setDesc("Reset local database, this affects only database. If you replicate again, local database will restored by remote database.")
            .addButton((button) =>
                button
                    .setButtonText("Reset")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.resetLocalDatabase();
                    })
            );
        new Setting(containerEl)
            .setName("Initialize local database again")
            .setDesc("WARNING: Reset local database and reconstruct by storage data. It affects local database, but if you replicate remote as is, remote data will be merged or corrupted.")
            .addButton((button) =>
                button
                    .setButtonText("INITIALIZE")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.resetLocalDatabase();
                        await this.plugin.initializeDatabase();
                    })
            );

        // With great respect, thank you TfTHacker!
        // refered: https://github.com/TfTHacker/obsidian42-brat/blob/main/src/features/BetaPlugins.ts
        containerEl.createEl("h3", { text: "Plugins and settings (bleeding edge)" });
        containerEl.createEl("div", {
            text: "This feature is not compatible with IBM Cloudant and some large plugins (e.g., Self-hosted LiveSync) yet.",
        }).addClass("op-warn");

        // new Setting(containerEl)
        //     .setName("Use Plugins and settings")
        //     .setDesc("It's on the bleeding edge. If you change this option, close setting dialog once,")
        //     .addToggle((toggle) =>
        //         toggle.setValue(this.plugin.settings.usePluginSettings).onChange(async (value) => {
        //             this.plugin.settings.usePluginSettings = value;
        //             await this.plugin.saveSettings();
        //         })
        //     );

        new Setting(containerEl)
            .setName("Device and Vault name")
            .setDesc("")
            .addText((text) => {
                text.setPlaceholder("desktop-main")
                    .setValue(this.plugin.settings.deviceAndVaultName)
                    .onChange(async (value) => {
                        this.plugin.settings.deviceAndVaultName = value;
                        await this.plugin.saveSettings();
                    });
                // text.inputEl.setAttribute("type", "password");
            });

        const sweepPlugin = async () => {
            // delete old database plugin entries
            // TODO: don't delete always.
            const db = this.plugin.localDatabase.localDatabase;
            let oldDocs = await db.allDocs({ startkey: `ps:${this.plugin.settings.deviceAndVaultName}-`, endkey: `ps:${this.plugin.settings.deviceAndVaultName}.`, include_docs: true });
            let delDocs = oldDocs.rows.map((e) => {
                e.doc._deleted = true;
                return e.doc;
            });
            await db.bulkDocs(delDocs);

            // sweep current plugin.
            // @ts-ignore
            const pl = this.plugin.app.plugins;
            const manifests: PluginManifest[] = Object.values(pl.manifests);
            console.dir(manifests);
            for (let m of manifests) {
                let path = normalizePath(m.dir) + "/";
                const adapter = this.plugin.app.vault.adapter;
                let files = ["manifest.json", "main.js", "style.css", "data.json"];
                let pluginData: { [key: string]: string } = {};
                for (let file of files) {
                    let thePath = path + file;
                    if (await adapter.exists(thePath)) {
                        // pluginData[file] = await arrayBufferToBase64(await adapter.readBinary(thePath));
                        pluginData[file] = await adapter.read(thePath);
                    }
                }
                console.dir(m.id);
                console.dir(pluginData);
                let mtime = 0;
                if (await adapter.exists(path + "/data.json")) {
                    mtime = (await adapter.stat(path + "/data.json")).mtime;
                }
                let p: PluginDataEntry = {
                    _id: `ps:${this.plugin.settings.deviceAndVaultName}-${m.id}`,
                    dataJson: pluginData["data.json"] ? await encrypt(pluginData["data.json"], this.plugin.settings.passphrase) : undefined,
                    deviceVaultName: this.plugin.settings.deviceAndVaultName,
                    mainJs: pluginData["main.js"],
                    styleCss: pluginData["style.css"],
                    manifest: m,
                    manifestJson: pluginData["manifest.json"],
                    mtime: mtime,
                    type: "plugin",
                };
                await db.put(p);
            }
            await this.plugin.replicate(true);
            updatePluginPane();
        };
        const updatePluginPane = async () => {
            const db = this.plugin.localDatabase.localDatabase;
            let oldDocs = await db.allDocs<PluginDataEntry>({ startkey: `ps:`, endkey: `ps;`, include_docs: true });
            let plugins: { [key: string]: PluginDataEntry[] } = {};
            let allPlugins: { [key: string]: PluginDataEntry } = {};
            let thisDevicePlugins: { [key: string]: PluginDataEntry } = {};
            for (let v of oldDocs.rows) {
                if (typeof plugins[v.doc.deviceVaultName] === "undefined") {
                    plugins[v.doc.deviceVaultName] = [];
                }
                plugins[v.doc.deviceVaultName].push(v.doc);
                allPlugins[v.doc._id] = v.doc;
                if (v.doc.deviceVaultName == this.plugin.settings.deviceAndVaultName) {
                    thisDevicePlugins[v.doc.manifest.id] = v.doc;
                }
            }
            let html = `
            <table>
            <tr>
            <th>vault</th>
            <th>plugin</th>
            <th>version</th>
            <th>modified</th>
            <th>plugin</th>
            <th>setting</th>
            </tr>`;
            for (let vaults in plugins) {
                if (vaults == this.plugin.settings.deviceAndVaultName) continue;
                for (let v of plugins[vaults]) {
                    let mtime = v.mtime == 0 ? "-" : new Date(v.mtime).toLocaleString();
                    let settingApplyable: boolean | string = "-";
                    let settingFleshness: string = "";
                    let isSameVersion = false;
                    if (thisDevicePlugins[v.manifest.id]) {
                        if (thisDevicePlugins[v.manifest.id].manifest.version == v.manifest.version) {
                            isSameVersion = true;
                        }
                    }
                    if (thisDevicePlugins[v.manifest.id] && thisDevicePlugins[v.manifest.id].dataJson && v.dataJson) {
                        // have this plugin.
                        let localSetting = await decrypt(thisDevicePlugins[v.manifest.id].dataJson, this.plugin.settings.passphrase);

                        try {
                            let remoteSetting = await decrypt(v.dataJson, this.plugin.settings.passphrase);
                            if (localSetting == remoteSetting) {
                                settingApplyable = "even";
                            } else {
                                if (v.mtime > thisDevicePlugins[v.manifest.id].mtime) {
                                    settingFleshness = "newer";
                                } else {
                                    settingFleshness = "older";
                                }
                                settingApplyable = true;
                            }
                        } catch (ex) {
                            settingApplyable = "could not decrypt";
                        }
                    } else if (!v.dataJson) {
                        settingApplyable = "N/A";
                    }
                    // very ugly way.
                    let piece = `<tr>
                    <th>${escapeStringToHTML(v.deviceVaultName)}</th>
                    <td>${escapeStringToHTML(v.manifest.name)}</td>
                    <td class="tcenter">${escapeStringToHTML(v.manifest.version)}</td>
                    <td class="tcenter">${escapeStringToHTML(mtime)}</td>
                    <td class="tcenter">${isSameVersion ? "even" : "<button data-key='" + v._id + "' class='apply-plugin-version'>Use</button>"}</td>
                    <td class="tcenter">${settingApplyable === true ? "<button data-key='" + v._id + "' class='apply-plugin-data'>Apply (" + settingFleshness + ")</button>" : settingApplyable}</td>
                    </tr>`;
                    html += piece;
                }
            }
            html += "</table>";
            pluginConfig.innerHTML = html;
            pluginConfig.querySelectorAll(".apply-plugin-data").forEach((e) =>
                e.addEventListener("click", async (evt) => {
                    console.dir("pluginData:" + e.attributes.getNamedItem("data-key").value);
                    let plugin = allPlugins[e.attributes.getNamedItem("data-key").value];
                    const pluginTargetFolderPath = normalizePath(plugin.manifest.dir) + "/";
                    const adapter = this.plugin.app.vault.adapter;
                    // @ts-ignore
                    let stat = this.plugin.app.plugins.enabledPlugins[plugin.manifest.id];
                    if (stat) {
                        // @ts-ignore
                        await this.plugin.app.plugins.unloadPlugin(plugin.manifest.id);
                        Logger(`Unload plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
                    }
                    if (plugin.dataJson) await adapter.write(pluginTargetFolderPath + "data.json", await decrypt(plugin.dataJson, this.plugin.settings.passphrase));
                    Logger("wrote:" + pluginTargetFolderPath + "data.json", LOG_LEVEL.NOTICE);
                    // @ts-ignore
                    if (stat) {
                        // @ts-ignore
                        await this.plugin.app.plugins.loadPlugin(plugin.manifest.id);
                        Logger(`Load plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
                    }
                    sweepPlugin();
                })
            );
            pluginConfig.querySelectorAll(".apply-plugin-version").forEach((e) =>
                e.addEventListener("click", async (evt) => {
                    console.dir("pluginVersion:" + e.attributes.getNamedItem("data-key").value);

                    let plugin = allPlugins[e.attributes.getNamedItem("data-key").value];

                    // @ts-ignore
                    let stat = this.plugin.app.plugins.enabledPlugins[plugin.manifest.id];
                    if (stat) {
                        // @ts-ignore
                        await this.plugin.app.plugins.unloadPlugin(plugin.manifest.id);
                        Logger(`Unload plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
                    }

                    const pluginTargetFolderPath = normalizePath(plugin.manifest.dir) + "/";
                    const adapter = this.plugin.app.vault.adapter;
                    if ((await adapter.exists(pluginTargetFolderPath)) === false) {
                        await adapter.mkdir(pluginTargetFolderPath);
                    }
                    await adapter.write(pluginTargetFolderPath + "main.js", plugin.mainJs);
                    await adapter.write(pluginTargetFolderPath + "manifest.json", plugin.manifestJson);
                    if (plugin.styleCss) await adapter.write(pluginTargetFolderPath + "styles.css", plugin.styleCss);
                    if (plugin.dataJson) await adapter.write(pluginTargetFolderPath + "data.json", await decrypt(plugin.dataJson, this.plugin.settings.passphrase));
                    if (stat) {
                        // @ts-ignore
                        await this.plugin.app.plugins.loadPlugin(plugin.manifest.id);
                        Logger(`Load plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
                    }
                    sweepPlugin();
                })
            );
        };

        let pluginConfig = containerEl.createEl("div");

        new Setting(containerEl)
            .setName("Reload")
            .setDesc("Reload List")
            .addButton((button) =>
                button
                    .setButtonText("Reload")
                    .setDisabled(false)
                    .onClick(async () => {
                        await updatePluginPane();
                    })
            );
        new Setting(containerEl)
            .setName("Save plugins into the database")
            .setDesc("Now, it wouldn't work automatically")
            .addButton((button) =>
                button
                    .setButtonText("Save plugins")
                    .setDisabled(false)
                    .onClick(async () => {
                        await sweepPlugin();
                    })
            );
        updatePluginPane();
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
        } else {
            let cx = containerEl.createEl("div", { text: "There's no collupted data." });
        }
        applyDisplayEnabled();
    }
}
