import { normalizePath } from "obsidian";

import { path2id_base, id2path_base } from "./lib/src/utils";

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