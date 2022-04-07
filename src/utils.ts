import { normalizePath } from "obsidian";
import { Logger } from "./logger";
import { FLAGMD_REDFLAG, LOG_LEVEL } from "./types";

export function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
    return new Promise((res) => {
        const blob = new Blob([buffer], { type: "application/octet-binary" });
        const reader = new FileReader();
        reader.onload = function (evt) {
            const dataurl = evt.target.result.toString();
            res(dataurl.substr(dataurl.indexOf(",") + 1));
        };
        reader.readAsDataURL(blob);
    });
}

export function base64ToString(base64: string): string {
    try {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
    } catch (ex) {
        return base64;
    }
}
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    try {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
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

export const escapeStringToHTML = (str: string) => {
    if (!str) return "";
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

export function resolveWithIgnoreKnownError<T>(p: Promise<T>, def: T): Promise<T> {
    return new Promise((res, rej) => {
        p.then(res).catch((ex) => ((ex.status && ex.status == 404) || (ex.message && ex.message == "Request Error:404") ? res(def) : rej(ex)));
    });
}

export function isValidPath(filename: string): boolean {
    // eslint-disable-next-line no-control-regex
    const regex = /[\u0000-\u001f]|[\\":?<>|*#]/g;
    let x = filename.replace(regex, "_");
    const win = /(\\|\/)(COM\d|LPT\d|CON|PRN|AUX|NUL|CLOCK$)($|\.)/gi;
    const sx = (x = x.replace(win, "/_"));
    return sx == filename;
}

export function shouldBeIgnored(filename: string): boolean {
    if (filename == FLAGMD_REDFLAG) {
        return true;
    }
    return false;
}

export function versionNumberString2Number(version: string): number {
    return version // "1.23.45"
        .split(".") // 1  23  45
        .reverse() // 45  23  1
        .map((e, i) => ((e as any) / 1) * 1000 ** i) // 45 23000 1000000
        .reduce((prev, current) => prev + current, 0); // 1023045
}

export const delay = (ms: number): Promise<void> => {
    return new Promise((res) => {
        setTimeout(() => {
            res();
        }, ms);
    });
};

// For backward compatibility, using the path for determining id.
// Only CouchDB nonacceptable ID (that starts with an underscore) has been prefixed with "/".
// The first slash will be deleted when the path is normalized.
export function path2id(filename: string): string {
    let x = normalizePath(filename);
    if (x.startsWith("_")) x = "/" + x;
    return x;
}
export function id2path(filename: string): string {
    return normalizePath(filename);
}

const runningProcs: string[] = [];
const pendingProcs: { [key: string]: (() => Promise<void>)[] } = {};
function objectToKey(key: any): string {
    if (typeof key === "string") return key;
    const keys = Object.keys(key).sort((a, b) => a.localeCompare(b));
    return keys.map((e) => e + objectToKey(key[e])).join(":");
}
export function getProcessingCounts() {
    let count = 0;
    for (const v in pendingProcs) {
        count += pendingProcs[v].length;
    }
    count += runningProcs.length;
    return count;
}

let externalNotifier: () => void = () => {};
let notifyTimer: number = null;
export function setLockNotifier(fn: () => void) {
    externalNotifier = fn;
}
function notifyLock() {
    if (notifyTimer != null) {
        window.clearTimeout(notifyTimer);
    }
    notifyTimer = window.setTimeout(() => {
        externalNotifier();
    }, 100);
}
// Just run async/await as like transacion ISOLATION SERIALIZABLE
export function runWithLock<T>(key: unknown, ignoreWhenRunning: boolean, proc: () => Promise<T>): Promise<T> {
    // Logger(`Lock:${key}:enter`, LOG_LEVEL.VERBOSE);
    const lockKey = typeof key === "string" ? key : objectToKey(key);
    const handleNextProcs = () => {
        if (typeof pendingProcs[lockKey] === "undefined") {
            //simply unlock
            runningProcs.remove(lockKey);
            notifyLock();
            // Logger(`Lock:${lockKey}:released`, LOG_LEVEL.VERBOSE);
        } else {
            Logger(`Lock:${lockKey}:left ${pendingProcs[lockKey].length}`, LOG_LEVEL.VERBOSE);
            let nextProc = null;
            nextProc = pendingProcs[lockKey].shift();
            notifyLock();
            if (nextProc) {
                // left some
                nextProc()
                    .then()
                    .catch((err) => {
                        Logger(err);
                    })
                    .finally(() => {
                        if (pendingProcs && lockKey in pendingProcs && pendingProcs[lockKey].length == 0) {
                            delete pendingProcs[lockKey];
                            notifyLock();
                        }
                        queueMicrotask(() => {
                            handleNextProcs();
                        });
                    });
            } else {
                if (pendingProcs && lockKey in pendingProcs && pendingProcs[lockKey].length == 0) {
                    delete pendingProcs[lockKey];
                    notifyLock();
                }
            }
        }
    };
    if (runningProcs.contains(lockKey)) {
        if (ignoreWhenRunning) {
            return null;
        }
        if (typeof pendingProcs[lockKey] === "undefined") {
            pendingProcs[lockKey] = [];
        }
        let responderRes: (value: T | PromiseLike<T>) => void;
        let responderRej: (reason?: unknown) => void;
        const responder = new Promise<T>((res, rej) => {
            responderRes = res;
            responderRej = rej;
            //wait for subproc resolved
        });
        const subproc = () =>
            new Promise<void>((res, rej) => {
                proc()
                    .then((v) => {
                        // Logger(`Lock:${key}:processed`, LOG_LEVEL.VERBOSE);
                        handleNextProcs();
                        responderRes(v);
                        res();
                    })
                    .catch((reason) => {
                        Logger(`Lock:${key}:rejected`, LOG_LEVEL.VERBOSE);
                        handleNextProcs();
                        rej(reason);
                        responderRej(reason);
                    });
            });

        pendingProcs[lockKey].push(subproc);
        notifyLock();
        // Logger(`Lock:${lockKey}:queud:left${pendingProcs[lockKey].length}`, LOG_LEVEL.VERBOSE);
        return responder;
    } else {
        runningProcs.push(lockKey);
        notifyLock();
        // Logger(`Lock:${lockKey}:aqquired`, LOG_LEVEL.VERBOSE);
        return new Promise((res, rej) => {
            proc()
                .then((v) => {
                    handleNextProcs();
                    res(v);
                })
                .catch((reason) => {
                    handleNextProcs();
                    rej(reason);
                });
        });
    }
}

export function isPlainText(filename: string): boolean {
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
