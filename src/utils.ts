import { type DataWriteOptions, normalizePath, TFile, Platform, TAbstractFile, App, Plugin_2, type RequestUrlParam, requestUrl } from "./deps";
import { path2id_base, id2path_base, isValidFilenameInLinux, isValidFilenameInDarwin, isValidFilenameInWidows, isValidFilenameInAndroid, stripAllPrefixes } from "./lib/src/path";

import { Logger } from "./lib/src/logger";
import { type AnyEntry, type DocumentID, type EntryDoc, type EntryHasPath, type FilePath, type FilePathWithPrefix, LOG_LEVEL, type NewEntry } from "./lib/src/types";
import { CHeader, ICHeader, ICHeaderLength, PSCHeader } from "./types";
import { InputStringDialog, PopoverSelectString } from "./dialogs";
import ObsidianLiveSyncPlugin from "./main";
import { runWithLock } from "./lib/src/lock";

// For backward compatibility, using the path for determining id.
// Only CouchDB unacceptable ID (that starts with an underscore) has been prefixed with "/".
// The first slash will be deleted when the path is normalized.
export async function path2id(filename: FilePathWithPrefix | FilePath, obfuscatePassphrase: string | false): Promise<DocumentID> {
    const temp = filename.split(":");
    const path = temp.pop();
    const normalizedPath = normalizePath(path as FilePath);
    temp.push(normalizedPath);
    const fixedPath = temp.join(":") as FilePathWithPrefix;

    const out = await path2id_base(fixedPath, obfuscatePassphrase);
    return out;
}
export function id2path(id: DocumentID, entry?: EntryHasPath): FilePathWithPrefix {
    const filename = id2path_base(id, entry);
    const temp = filename.split(":");
    const path = temp.pop();
    const normalizedPath = normalizePath(path as FilePath);
    temp.push(normalizedPath);
    const fixedPath = temp.join(":") as FilePathWithPrefix;
    return fixedPath;
}
export function getPath(entry: AnyEntry) {
    return id2path(entry._id, entry);

}
export function getPathWithoutPrefix(entry: AnyEntry) {
    const f = getPath(entry);
    return stripAllPrefixes(f);
}

export function getPathFromTFile(file: TAbstractFile) {
    return file.path as FilePath;
}

const tasks: { [key: string]: ReturnType<typeof setTimeout> } = {};
export function scheduleTask(key: string, timeout: number, proc: (() => Promise<any> | void), skipIfTaskExist?: boolean) {
    if (skipIfTaskExist && key in tasks) {
        return;
    }
    cancelTask(key);
    tasks[key] = setTimeout(async () => {
        delete tasks[key];
        await proc();
    }, timeout);
}
export function cancelTask(key: string) {
    if (key in tasks) {
        clearTimeout(tasks[key]);
        delete tasks[key];
    }
}
export function cancelAllTasks() {
    for (const v in tasks) {
        clearTimeout(tasks[v]);
        delete tasks[v];
    }
}
const intervals: { [key: string]: ReturnType<typeof setInterval> } = {};
export function setPeriodicTask(key: string, timeout: number, proc: (() => Promise<any> | void)) {
    cancelPeriodicTask(key);
    intervals[key] = setInterval(async () => {
        delete intervals[key];
        await proc();
    }, timeout);
}
export function cancelPeriodicTask(key: string) {
    if (key in intervals) {
        clearInterval(intervals[key]);
        delete intervals[key];
    }
}
export function cancelAllPeriodicTask() {
    for (const v in intervals) {
        clearInterval(intervals[v]);
        delete intervals[v];
    }
}

const memos: { [key: string]: any } = {};
export function memoObject<T>(key: string, obj: T): T {
    memos[key] = obj;
    return memos[key] as T;
}
export async function memoIfNotExist<T>(key: string, func: () => T | Promise<T>): Promise<T> {
    if (!(key in memos)) {
        const w = func();
        const v = w instanceof Promise ? (await w) : w;
        memos[key] = v;
    }
    return memos[key] as T;
}
export function retrieveMemoObject<T>(key: string): T | false {
    if (key in memos) {
        return memos[key];
    } else {
        return false;
    }
}
export function disposeMemoObject(key: string) {
    delete memos[key];
}

export function isSensibleMargeApplicable(path: string) {
    if (path.endsWith(".md")) return true;
    return false;
}
export function isObjectMargeApplicable(path: string) {
    if (path.endsWith(".canvas")) return true;
    if (path.endsWith(".json")) return true;
    return false;
}

export function tryParseJSON(str: string, fallbackValue?: any) {
    try {
        return JSON.parse(str);
    } catch (ex) {
        return fallbackValue;
    }
}

const MARK_OPERATOR = `\u{0001}`;
const MARK_DELETED = `${MARK_OPERATOR}__DELETED`;
const MARK_ISARRAY = `${MARK_OPERATOR}__ARRAY`;
const MARK_SWAPPED = `${MARK_OPERATOR}__SWAP`;

function unorderedArrayToObject(obj: Array<any>) {
    return obj.map(e => ({ [e.id as string]: e })).reduce((p, c) => ({ ...p, ...c }), {})
}
function objectToUnorderedArray(obj: object) {
    const entries = Object.entries(obj);
    if (entries.some(e => e[0] != e[1]?.id)) throw new Error("Item looks like not unordered array")
    return entries.map(e => e[1]);
}
function generatePatchUnorderedArray(from: Array<any>, to: Array<any>) {
    if (from.every(e => typeof (e) == "object" && ("id" in e)) && to.every(e => typeof (e) == "object" && ("id" in e))) {
        const fObj = unorderedArrayToObject(from);
        const tObj = unorderedArrayToObject(to);
        const diff = generatePatchObj(fObj, tObj);
        if (Object.keys(diff).length > 0) {
            return { [MARK_ISARRAY]: diff };
        } else {
            return {};
        }
    }
    return { [MARK_SWAPPED]: to };
}

export function generatePatchObj(from: Record<string | number | symbol, any>, to: Record<string | number | symbol, any>) {
    const entries = Object.entries(from);
    const tempMap = new Map<string | number | symbol, any>(entries);
    const ret = {} as Record<string | number | symbol, any>;
    const newEntries = Object.entries(to);
    for (const [key, value] of newEntries) {
        if (!tempMap.has(key)) {
            //New
            ret[key] = value;
            tempMap.delete(key);
        } else {
            //Exists
            const v = tempMap.get(key);
            if (typeof (v) !== typeof (value) || (Array.isArray(v) !== Array.isArray(value))) {
                //if type is not match, replace completely.
                ret[key] = { [MARK_SWAPPED]: value };
            } else {
                if (typeof (v) == "object" && typeof (value) == "object" && !Array.isArray(v) && !Array.isArray(value)) {
                    const wk = generatePatchObj(v, value);
                    if (Object.keys(wk).length > 0) ret[key] = wk;
                } else if (typeof (v) == "object" && typeof (value) == "object" && Array.isArray(v) && Array.isArray(value)) {
                    const wk = generatePatchUnorderedArray(v, value);
                    if (Object.keys(wk).length > 0) ret[key] = wk;
                } else if (typeof (v) != "object" && typeof (value) != "object") {
                    if (JSON.stringify(tempMap.get(key)) !== JSON.stringify(value)) {
                        ret[key] = value;
                    }
                } else {
                    if (JSON.stringify(tempMap.get(key)) !== JSON.stringify(value)) {
                        ret[key] = { [MARK_SWAPPED]: value };
                    }
                }
            }
            tempMap.delete(key);
        }
    }
    //Not used item, means deleted one
    for (const [key,] of tempMap) {
        ret[key] = MARK_DELETED
    }
    return ret;
}


export function applyPatch(from: Record<string | number | symbol, any>, patch: Record<string | number | symbol, any>) {
    const ret = from;
    const patches = Object.entries(patch);
    for (const [key, value] of patches) {
        if (value == MARK_DELETED) {
            delete ret[key];
            continue;
        }
        if (typeof (value) == "object") {
            if (MARK_SWAPPED in value) {
                ret[key] = value[MARK_SWAPPED];
                continue;
            }
            if (MARK_ISARRAY in value) {
                if (!(key in ret)) ret[key] = [];
                if (!Array.isArray(ret[key])) {
                    throw new Error("Patch target type is mismatched (array to something)");
                }
                const orgArrayObject = unorderedArrayToObject(ret[key]);
                const appliedObject = applyPatch(orgArrayObject, value[MARK_ISARRAY]);
                const appliedArray = objectToUnorderedArray(appliedObject);
                ret[key] = [...appliedArray];
            } else {
                if (!(key in ret)) {
                    ret[key] = value;
                    continue;
                }
                ret[key] = applyPatch(ret[key], value);
            }
        } else {
            ret[key] = value;
        }
    }
    return ret;
}

export function mergeObject(
    objA: Record<string | number | symbol, any> | [any],
    objB: Record<string | number | symbol, any> | [any]
) {
    const newEntries = Object.entries(objB);
    const ret: any = { ...objA };
    if (
        typeof objA !== typeof objB ||
        Array.isArray(objA) !== Array.isArray(objB)
    ) {
        return objB;
    }

    for (const [key, v] of newEntries) {
        if (key in ret) {
            const value = ret[key];
            if (
                typeof v !== typeof value ||
                Array.isArray(v) !== Array.isArray(value)
            ) {
                //if type is not match, replace completely.
                ret[key] = v;
            } else {
                if (
                    typeof v == "object" &&
                    typeof value == "object" &&
                    !Array.isArray(v) &&
                    !Array.isArray(value)
                ) {
                    ret[key] = mergeObject(v, value);
                } else if (
                    typeof v == "object" &&
                    typeof value == "object" &&
                    Array.isArray(v) &&
                    Array.isArray(value)
                ) {
                    ret[key] = [...new Set([...v, ...value])];
                } else {
                    ret[key] = v;
                }
            }
        } else {
            ret[key] = v;
        }
    }
    if (Array.isArray(objA) && Array.isArray(objB)) {
        return Object.values(Object.entries(ret)
            .sort()
            .reduce((p, [key, value]) => ({ ...p, [key]: value }), {}));
    }
    return Object.entries(ret)
        .sort()
        .reduce((p, [key, value]) => ({ ...p, [key]: value }), {});
}

export function flattenObject(obj: Record<string | number | symbol, any>, path: string[] = []): [string, any][] {
    if (typeof (obj) != "object") return [[path.join("."), obj]];
    if (Array.isArray(obj)) return [[path.join("."), JSON.stringify(obj)]];
    const e = Object.entries(obj);
    const ret = []
    for (const [key, value] of e) {
        const p = flattenObject(value, [...path, key]);
        ret.push(...p);
    }
    return ret;
}

export function modifyFile(file: TFile, data: string | ArrayBuffer, options?: DataWriteOptions) {
    if (typeof (data) === "string") {
        return app.vault.modify(file, data, options);
    } else {
        return app.vault.modifyBinary(file, data, options);
    }
}
export function createFile(path: string, data: string | ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
    if (typeof (data) === "string") {
        return app.vault.create(path, data, options);
    } else {
        return app.vault.createBinary(path, data, options);
    }
}

export function isValidPath(filename: string) {
    if (Platform.isDesktop) {
        // if(Platform.isMacOS) return isValidFilenameInDarwin(filename);
        if (process.platform == "darwin") return isValidFilenameInDarwin(filename);
        if (process.platform == "linux") return isValidFilenameInLinux(filename);
        return isValidFilenameInWidows(filename);
    }
    if (Platform.isAndroidApp) return isValidFilenameInAndroid(filename);
    if (Platform.isIosApp) return isValidFilenameInDarwin(filename);
    //Fallback
    Logger("Could not determine platform for checking filename", LOG_LEVEL.VERBOSE);
    return isValidFilenameInWidows(filename);
}

let touchedFiles: string[] = [];

export function getAbstractFileByPath(path: FilePath): TAbstractFile | null {
    // Disabled temporary.
    return app.vault.getAbstractFileByPath(path);
    // // Hidden API but so useful.
    // // @ts-ignore
    // if ("getAbstractFileByPathInsensitive" in app.vault && (app.vault.adapter?.insensitive ?? false)) {
    //     // @ts-ignore
    //     return app.vault.getAbstractFileByPathInsensitive(path);
    // } else {
    //    return app.vault.getAbstractFileByPath(path);
    // }
}
export function trimPrefix(target: string, prefix: string) {
    return target.startsWith(prefix) ? target.substring(prefix.length) : target;
}

export function touch(file: TFile | FilePath) {
    const f = file instanceof TFile ? file : getAbstractFileByPath(file) as TFile;
    const key = `${f.path}-${f.stat.mtime}-${f.stat.size}`;
    touchedFiles.unshift(key);
    touchedFiles = touchedFiles.slice(0, 100);
}
export function recentlyTouched(file: TFile) {
    const key = `${file.path}-${file.stat.mtime}-${file.stat.size}`;
    if (touchedFiles.indexOf(key) == -1) return false;
    return true;
}
export function clearTouched() {
    touchedFiles = [];
}

/**
 * returns is internal chunk of file
 * @param id ID
 * @returns 
 */
export function isInternalMetadata(id: FilePath | FilePathWithPrefix | DocumentID): boolean {
    return id.startsWith(ICHeader);
}
export function stripInternalMetadataPrefix<T extends FilePath | FilePathWithPrefix | DocumentID>(id: T): T {
    return id.substring(ICHeaderLength) as T;
}
export function id2InternalMetadataId(id: DocumentID): DocumentID {
    return ICHeader + id as DocumentID;
}

// const CHeaderLength = CHeader.length;
export function isChunk(str: string): boolean {
    return str.startsWith(CHeader);
}

export function isPluginMetadata(str: string): boolean {
    return str.startsWith(PSCHeader);
}

export const askYesNo = (app: App, message: string): Promise<"yes" | "no"> => {
    return new Promise((res) => {
        const popover = new PopoverSelectString(app, message, null, null, (result) => res(result as "yes" | "no"));
        popover.open();
    });
};

export const askSelectString = (app: App, message: string, items: string[]): Promise<string> => {
    const getItemsFun = () => items;
    return new Promise((res) => {
        const popover = new PopoverSelectString(app, message, "", getItemsFun, (result) => res(result));
        popover.open();
    });
};


export const askString = (app: App, title: string, key: string, placeholder: string, isPassword?: boolean): Promise<string | false> => {
    return new Promise((res) => {
        const dialog = new InputStringDialog(app, title, key, placeholder, isPassword, (result) => res(result));
        dialog.open();
    });
};


export class PeriodicProcessor {
    _process: () => Promise<any>;
    _timer?: number;
    _plugin: Plugin_2;
    constructor(plugin: Plugin_2, process: () => Promise<any>) {
        this._plugin = plugin;
        this._process = process;
    }
    async process() {
        try {
            await this._process();
        } catch (ex) {
            Logger(ex);
        }
    }
    enable(interval: number) {
        this.disable();
        if (interval == 0) return;
        this._timer = window.setInterval(() => this._process().then(() => { }), interval);
        this._plugin.registerInterval(this._timer);
    }
    disable() {
        if (this._timer) clearInterval(this._timer);
    }
}

function sizeToHumanReadable(size: number | undefined) {
    if (!size) return "-";
    const i = Math.floor(Math.log(size) / Math.log(1024));
    return Number.parseInt((size / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

export const _requestToCouchDBFetch = async (baseUri: string, username: string, password: string, path?: string, body?: string | any, method?: string) => {
    const utf8str = String.fromCharCode.apply(null, new TextEncoder().encode(`${username}:${password}`));
    const encoded = window.btoa(utf8str);
    const authHeader = "Basic " + encoded;
    const transformedHeaders: Record<string, string> = { authorization: authHeader, "content-type": "application/json" };
    const uri = `${baseUri}/${path}`;
    const requestParam = {
        url: uri,
        method: method || (body ? "PUT" : "GET"),
        headers: new Headers(transformedHeaders),
        contentType: "application/json",
        body: JSON.stringify(body),
    };
    return await fetch(uri, requestParam);
}

export const _requestToCouchDB = async (baseUri: string, username: string, password: string, origin: string, path?: string, body?: any, method?: string) => {
    const utf8str = String.fromCharCode.apply(null, new TextEncoder().encode(`${username}:${password}`));
    const encoded = window.btoa(utf8str);
    const authHeader = "Basic " + encoded;
    const transformedHeaders: Record<string, string> = { authorization: authHeader, origin: origin };
    const uri = `${baseUri}/${path}`;
    const requestParam: RequestUrlParam = {
        url: uri,
        method: method || (body ? "PUT" : "GET"),
        headers: transformedHeaders,
        contentType: "application/json",
        body: body ? JSON.stringify(body) : undefined,
    };
    return await requestUrl(requestParam);
}
export const requestToCouchDB = async (baseUri: string, username: string, password: string, origin: string, key?: string, body?: string, method?: string) => {
    const uri = `_node/_local/_config${key ? "/" + key : ""}`;
    return await _requestToCouchDB(baseUri, username, password, origin, uri, body, method);
};

export async function performRebuildDB(plugin: ObsidianLiveSyncPlugin, method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice") {
    if (method == "localOnly") {
        await plugin.addOnSetup.fetchLocal();
    }
    if (method == "remoteOnly") {
        await plugin.addOnSetup.rebuildRemote();
    }
    if (method == "rebuildBothByThisDevice") {
        await plugin.addOnSetup.rebuildEverything();
    }
}

export const gatherChunkUsage = async (db: PouchDB.Database<EntryDoc>) => {
    const used = new Map();
    const unreferenced = new Map();
    const removed = new Map();
    const missing = new Map();
    const xx = await db.allDocs({ startkey: "h:", endkey: `h:\u{10ffff}` });
    for (const xxd of xx.rows) {
        const chunk = xxd.id
        unreferenced.set(chunk, xxd.value.rev);
    }

    const x = await db.find({ limit: 999999999, selector: { children: { $exists: true, $type: "array" } }, fields: ["_id", "path", "mtime", "children"] });
    for (const temp of x.docs) {
        for (const chunk of (temp as NewEntry).children) {
            used.set(chunk, (used.has(chunk) ? used.get(chunk) : 0) + 1);
            if (unreferenced.has(chunk)) {
                removed.set(chunk, unreferenced.get(chunk));
                unreferenced.delete(chunk);
            } else {
                if (!removed.has(chunk)) {
                    if (!missing.has(temp._id)) {
                        missing.set(temp._id, []);
                    }
                    missing.get(temp._id).push(chunk);
                }
            }
        }
    }

    return { used, unreferenced, missing };
}

export const localDatabaseCleanUp = async (plugin: ObsidianLiveSyncPlugin, force: boolean, dryRun: boolean) => {

    await runWithLock("clean-up:local", true, async () => {
        const db = plugin.localDatabase.localDatabase;
        if ((db as any)?.adapter != "indexeddb") {
            if (force && !dryRun) {
                Logger("Fetch from the remote database", LOG_LEVEL.NOTICE, "clean-up-db");
                await performRebuildDB(plugin, "localOnly");
                return;
            } else {
                Logger("This feature requires disabling `Use an old adapter for compatibility`.", LOG_LEVEL.NOTICE, "clean-up-db");
                return;
            }
        }
        Logger(`The remote database has been locked for garbage collection`, LOG_LEVEL.NOTICE, "clean-up-db");
        Logger(`Gathering chunk usage information`, LOG_LEVEL.NOTICE, "clean-up-db");

        const { unreferenced, missing } = await gatherChunkUsage(db);
        if (missing.size != 0) {
            Logger(`Some chunks are not found! We have to rescue`, LOG_LEVEL.NOTICE);
            Logger(missing, LOG_LEVEL.VERBOSE);
        } else {
            Logger(`All chunks are OK`, LOG_LEVEL.NOTICE);
        }
        const payload = {} as Record<string, string[]>;
        for (const [id, rev] of unreferenced) {
            payload[id] = [rev];
        }
        const removeItems = Object.keys(payload).length;
        if (removeItems == 0) {
            Logger(`No unreferenced chunks found (Local)`, LOG_LEVEL.NOTICE);
            await plugin.markRemoteResolved();
        }
        if (dryRun) {
            Logger(`There are ${removeItems} unreferenced chunks (Local)`, LOG_LEVEL.NOTICE);
            return;
        }
        Logger(`Deleting unreferenced chunks: ${removeItems}`, LOG_LEVEL.NOTICE, "clean-up-db");
        for (const [id, rev] of unreferenced) {
            //@ts-ignore
            const ret = await db.purge(id, rev);
            Logger(ret, LOG_LEVEL.VERBOSE);
        }
        plugin.localDatabase.refreshSettings();
        Logger(`Compacting local database...`, LOG_LEVEL.NOTICE, "clean-up-db");
        await db.compact();
        await plugin.markRemoteResolved();
        Logger("Done!", LOG_LEVEL.NOTICE, "clean-up-db");
    })
}


export const balanceChunks = async (plugin: ObsidianLiveSyncPlugin, dryRun: boolean) => {

    await runWithLock("clean-up:balance", true, async () => {
        const localDB = plugin.localDatabase.localDatabase;
        Logger(`Gathering chunk usage information`, LOG_LEVEL.NOTICE, "clean-up-db");

        const ret = await plugin.replicator.connectRemoteCouchDBWithSetting(plugin.settings, plugin.isMobile);
        if (typeof ret === "string") {
            Logger(`Connect error: ${ret}`, LOG_LEVEL.NOTICE, "clean-up-db");
            return;
        }
        const localChunks = new Map<string, string>();
        const xx = await localDB.allDocs({ startkey: "h:", endkey: `h:\u{10ffff}` });
        for (const xxd of xx.rows) {
            const chunk = xxd.id
            localChunks.set(chunk, xxd.value.rev);
        }
        // const info = ret.info;
        const remoteDB = ret.db;
        const remoteChunks = new Map<string, string>();
        const xxr = await remoteDB.allDocs({ startkey: "h:", endkey: `h:\u{10ffff}` });
        for (const xxd of xxr.rows) {
            const chunk = xxd.id
            remoteChunks.set(chunk, xxd.value.rev);
        }
        const localToRemote = new Map<string, string>([...localChunks]);
        const remoteToLocal = new Map<string, string>([...remoteChunks]);
        for (const id of new Set([...localChunks.keys(), ...remoteChunks.keys()])) {
            if (remoteChunks.has(id)) {
                localToRemote.delete(id);
            }
            if (localChunks.has(id)) {
                remoteToLocal.delete(id);
            }
        }

        function arrayToChunkedArray<T>(src: T[], size = 25) {
            const ret = [] as T[][];
            let i = 0;
            while (i < src.length) {
                ret.push(src.slice(i, i += size));
            }
            return ret;
        }

        if (localToRemote.size == 0) {
            Logger(`No chunks need to be sent`, LOG_LEVEL.NOTICE);
        } else {
            Logger(`${localToRemote.size} chunks need to be sent`, LOG_LEVEL.NOTICE);
            if (!dryRun) {
                const w = arrayToChunkedArray([...localToRemote]);
                for (const chunk of w) {
                    for (const [id,] of chunk) {
                        const queryRet = await localDB.allDocs({ keys: [id], include_docs: true });
                        const docs = queryRet.rows.filter(e => !("error" in e)).map(x => x.doc);

                        const ret = await remoteDB.bulkDocs(docs, { new_edits: false });
                        Logger(ret, LOG_LEVEL.VERBOSE);
                    }
                }
                Logger(`Done! ${remoteToLocal.size} chunks have been sent`, LOG_LEVEL.NOTICE);
            }
        }
        if (remoteToLocal.size == 0) {
            Logger(`No chunks need to be retrieved`, LOG_LEVEL.NOTICE);
        } else {
            Logger(`${remoteToLocal.size} chunks need to be retrieved`, LOG_LEVEL.NOTICE);
            if (!dryRun) {
                const w = arrayToChunkedArray([...remoteToLocal]);
                for (const chunk of w) {
                    for (const [id,] of chunk) {
                        const queryRet = await remoteDB.allDocs({ keys: [id], include_docs: true });
                        const docs = queryRet.rows.filter(e => !("error" in e)).map(x => x.doc);

                        const ret = await localDB.bulkDocs(docs, { new_edits: false });
                        Logger(ret, LOG_LEVEL.VERBOSE);
                    }
                }
                Logger(`Done! ${remoteToLocal.size} chunks have been retrieved`, LOG_LEVEL.NOTICE);
            }
        }
    })
}

export const remoteDatabaseCleanup = async (plugin: ObsidianLiveSyncPlugin, dryRun: boolean) => {
    const getSize = function (info: PouchDB.Core.DatabaseInfo, key: "active" | "external" | "file") {
        return Number.parseInt((info as any)?.sizes?.[key] ?? 0);
    }
    await runWithLock("clean-up:remote", true, async () => {
        const CHUNK_SIZE = 100;
        function makeChunkedArrayFromArray<T>(items: T[]): T[][] {
            const chunked = [];
            for (let i = 0; i < items.length; i += CHUNK_SIZE) {
                chunked.push(items.slice(i, i + CHUNK_SIZE));
            }
            return chunked;
        }
        try {
            const ret = await plugin.replicator.connectRemoteCouchDBWithSetting(plugin.settings, plugin.isMobile);
            if (typeof ret === "string") {
                Logger(`Connect error: ${ret}`, LOG_LEVEL.NOTICE, "clean-up-db");
                return;
            }
            const info = ret.info;
            Logger(JSON.stringify(info), LOG_LEVEL.VERBOSE, "clean-up-db");
            Logger(`Database active-size: ${sizeToHumanReadable(getSize(info, "active"))}, external-size:${sizeToHumanReadable(getSize(info, "external"))}, file-size: ${sizeToHumanReadable(getSize(info, "file"))}`, LOG_LEVEL.NOTICE);

            if (!dryRun) {
                Logger(`The remote database has been locked for garbage collection`, LOG_LEVEL.NOTICE, "clean-up-db");
                await plugin.markRemoteLocked(true);
            }
            Logger(`Gathering chunk usage information`, LOG_LEVEL.NOTICE, "clean-up-db");
            const db = ret.db;

            const { unreferenced, missing } = await gatherChunkUsage(db);
            if (missing.size != 0) {
                Logger(`Some chunks are not found! We have to rescue`, LOG_LEVEL.NOTICE);
                Logger(missing, LOG_LEVEL.VERBOSE);
            } else {
                Logger(`All chunks are OK`, LOG_LEVEL.NOTICE);
            }
            const payload = {} as Record<string, string[]>;
            for (const [id, rev] of unreferenced) {
                payload[id] = [rev];
            }
            const removeItems = Object.keys(payload).length;
            if (removeItems == 0) {
                Logger(`No unreferenced chunk found (Remote)`, LOG_LEVEL.NOTICE);
                return;
            }
            if (dryRun) {
                Logger(`There are ${removeItems} unreferenced chunks (Remote)`, LOG_LEVEL.NOTICE);
                return;
            }
            Logger(`Deleting unreferenced chunks: ${removeItems}`, LOG_LEVEL.NOTICE, "clean-up-db");
            const buffer = makeChunkedArrayFromArray(Object.entries(payload));
            for (const chunkedPayload of buffer) {
                const rets = await _requestToCouchDBFetch(
                    `${plugin.settings.couchDB_URI}/${plugin.settings.couchDB_DBNAME}`,
                    plugin.settings.couchDB_USER,
                    plugin.settings.couchDB_PASSWORD,
                    "_purge",
                    chunkedPayload.reduce((p, c) => ({ ...p, [c[0]]: c[1] }), {}), "POST");
                // const result = await rets();
                Logger(JSON.stringify(await rets.json()), LOG_LEVEL.VERBOSE);
            }
            Logger(`Compacting database...`, LOG_LEVEL.NOTICE, "clean-up-db");
            await db.compact();
            const endInfo = await db.info();

            Logger(`Processed database active-size: ${sizeToHumanReadable(getSize(endInfo, "active"))}, external-size:${sizeToHumanReadable(getSize(endInfo, "external"))}, file-size: ${sizeToHumanReadable(getSize(endInfo, "file"))}`, LOG_LEVEL.NOTICE);
            Logger(`Reduced sizes: active-size: ${sizeToHumanReadable(getSize(info, "active") - getSize(endInfo, "active"))}, external-size:${sizeToHumanReadable(getSize(info, "external") - getSize(endInfo, "external"))}, file-size: ${sizeToHumanReadable(getSize(info, "file") - getSize(endInfo, "file"))}`, LOG_LEVEL.NOTICE);
            Logger(JSON.stringify(endInfo), LOG_LEVEL.VERBOSE, "clean-up-db");
            Logger(`Local database cleaning up...`);
            await localDatabaseCleanUp(plugin, true, false);
        } catch (ex) {
            Logger("Failed to clean up db.")
            Logger(ex, LOG_LEVEL.VERBOSE);
        }
    });
}
