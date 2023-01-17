import { normalizePath } from "obsidian";

import { path2id_base, id2path_base } from "./lib/src/path";

// For backward compatibility, using the path for determining id.
// Only CouchDB unacceptable ID (that starts with an underscore) has been prefixed with "/".
// The first slash will be deleted when the path is normalized.
export function path2id(filename: string): string {
    const x = normalizePath(filename);
    return path2id_base(x);
}
export function id2path(filename: string): string {
    return id2path_base(normalizePath(filename));
}

const triggers: { [key: string]: ReturnType<typeof setTimeout> } = {};
export function setTrigger(key: string, timeout: number, proc: (() => Promise<any> | void)) {
    clearTrigger(key);
    triggers[key] = setTimeout(async () => {
        delete triggers[key];
        await proc();
    }, timeout);
}
export function clearTrigger(key: string) {
    if (key in triggers) {
        clearTimeout(triggers[key]);
    }
}
export function clearAllTriggers() {
    for (const v in triggers) {
        clearTimeout(triggers[v]);
    }
}
const intervals: { [key: string]: ReturnType<typeof setInterval> } = {};
export function setPeriodic(key: string, timeout: number, proc: (() => Promise<any> | void)) {
    clearPeriodic(key);
    intervals[key] = setInterval(async () => {
        delete intervals[key];
        await proc();
    }, timeout);
}
export function clearPeriodic(key: string) {
    if (key in intervals) {
        clearInterval(intervals[key]);
    }
}
export function clearAllPeriodic() {
    for (const v in intervals) {
        clearInterval(intervals[v]);
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
