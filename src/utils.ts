import { normalizePath, Platform, TAbstractFile, App, type RequestUrlParam, requestUrl, TFile } from "./deps";
import { path2id_base, id2path_base, isValidFilenameInLinux, isValidFilenameInDarwin, isValidFilenameInWidows, isValidFilenameInAndroid, stripAllPrefixes } from "./lib/src/path";

import { Logger } from "./lib/src/logger";
import { LOG_LEVEL_VERBOSE, type AnyEntry, type DocumentID, type EntryHasPath, type FilePath, type FilePathWithPrefix } from "./lib/src/types";
import { CHeader, ICHeader, ICHeaderLength, ICXHeader, PSCHeader } from "./types";
import { InputStringDialog, PopoverSelectString } from "./dialogs";
import type ObsidianLiveSyncPlugin from "./main";
import { writeString } from "./lib/src/strbin";
import { fireAndForget } from "./lib/src/utils";
import { sameChangePairs } from "./stores";

export { scheduleTask, setPeriodicTask, cancelTask, cancelAllTasks, cancelPeriodicTask, cancelAllPeriodicTask, } from "./lib/src/task";

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
    const retSorted = Object.fromEntries(Object.entries(ret).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (Array.isArray(objA) && Array.isArray(objB)) {
        return Object.values(retSorted);
    }
    return retSorted;
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
    Logger("Could not determine platform for checking filename", LOG_LEVEL_VERBOSE);
    return isValidFilenameInWidows(filename);
}

export function trimPrefix(target: string, prefix: string) {
    return target.startsWith(prefix) ? target.substring(prefix.length) : target;
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
export function isCustomisationSyncMetadata(str: string): boolean {
    return str.startsWith(ICXHeader);
}

export const askYesNo = (app: App, message: string): Promise<"yes" | "no"> => {
    return new Promise((res) => {
        const popover = new PopoverSelectString(app, message, undefined, undefined, (result) => res(result as "yes" | "no"));
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


export const askString = (app: App, title: string, key: string, placeholder: string, isPassword: boolean = false): Promise<string | false> => {
    return new Promise((res) => {
        const dialog = new InputStringDialog(app, title, key, placeholder, isPassword, (result) => res(result));
        dialog.open();
    });
};


export class PeriodicProcessor {
    _process: () => Promise<any>;
    _timer?: number;
    _plugin: ObsidianLiveSyncPlugin;
    constructor(plugin: ObsidianLiveSyncPlugin, process: () => Promise<any>) {
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
        this._timer = window.setInterval(() => fireAndForget(async () => {
            await this.process();
            if (this._plugin._unloaded) {
                this.disable();
            }
        }), interval);
        this._plugin.registerInterval(this._timer);
    }
    disable() {
        if (this._timer !== undefined) {
            window.clearInterval(this._timer);
            this._timer = undefined;
        }
    }
}

export const _requestToCouchDBFetch = async (baseUri: string, username: string, password: string, path?: string, body?: string | any, method?: string) => {
    const utf8str = String.fromCharCode.apply(null, [...writeString(`${username}:${password}`)]);
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
    const utf8str = String.fromCharCode.apply(null, [...writeString(`${username}:${password}`)]);
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
export const requestToCouchDB = async (baseUri: string, username: string, password: string, origin: string = "", key?: string, body?: string, method?: string) => {
    const uri = `_node/_local/_config${key ? "/" + key : ""}`;
    return await _requestToCouchDB(baseUri, username, password, origin, uri, body, method);
};

export async function performRebuildDB(plugin: ObsidianLiveSyncPlugin, method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice" | "localOnlyWithChunks") {
    if (method == "localOnly") {
        await plugin.addOnSetup.fetchLocal();
    }
    if (method == "localOnlyWithChunks") {
        await plugin.addOnSetup.fetchLocal(true);
    }
    if (method == "remoteOnly") {
        await plugin.addOnSetup.rebuildRemote();
    }
    if (method == "rebuildBothByThisDevice") {
        await plugin.addOnSetup.rebuildEverything();
    }
}

export const BASE_IS_NEW = Symbol("base");
export const TARGET_IS_NEW = Symbol("target");
export const EVEN = Symbol("even");


// Why 2000? : ZIP FILE Does not have enough resolution.
const resolution = 2000;
export function compareMTime(baseMTime: number, targetMTime: number): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN {
    const truncatedBaseMTime = (~~(baseMTime / resolution)) * resolution;
    const truncatedTargetMTime = (~~(targetMTime / resolution)) * resolution;
    // Logger(`Resolution MTime ${truncatedBaseMTime} and ${truncatedTargetMTime} `, LOG_LEVEL_VERBOSE);
    if (truncatedBaseMTime == truncatedTargetMTime) return EVEN;
    if (truncatedBaseMTime > truncatedTargetMTime) return BASE_IS_NEW;
    if (truncatedBaseMTime < truncatedTargetMTime) return TARGET_IS_NEW;
    throw new Error("Unexpected error");
}

export function markChangesAreSame(file: TFile | AnyEntry | string, mtime1: number, mtime2: number) {
    if (mtime1 === mtime2) return true;
    const key = typeof file == "string" ? file : file instanceof TFile ? file.path : file.path ?? file._id;
    const pairs = sameChangePairs.get(key, []) || [];
    if (pairs.some(e => e == mtime1 || e == mtime2)) {
        sameChangePairs.set(key, [...new Set([...pairs, mtime1, mtime2])]);
    } else {
        sameChangePairs.set(key, [mtime1, mtime2]);
    }
}
export function isMarkedAsSameChanges(file: TFile | AnyEntry | string, mtimes: number[]) {
    const key = typeof file == "string" ? file : file instanceof TFile ? file.path : file.path ?? file._id;
    const pairs = sameChangePairs.get(key, []) || [];
    if (mtimes.every(e => pairs.indexOf(e) !== -1)) {
        return EVEN;
    }
}
export function compareFileFreshness(baseFile: TFile | AnyEntry, checkTarget: TFile | AnyEntry): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN {
    const modifiedBase = baseFile instanceof TFile ? baseFile?.stat?.mtime ?? 0 : baseFile?.mtime ?? 0;
    const modifiedTarget = checkTarget instanceof TFile ? checkTarget?.stat?.mtime ?? 0 : checkTarget?.mtime ?? 0;

    if (modifiedBase && modifiedTarget && isMarkedAsSameChanges(baseFile, [modifiedBase, modifiedTarget])) {
        return EVEN;
    }
    return compareMTime(modifiedBase, modifiedTarget);
}

