import { Logger } from "./logger";
import { LOG_LEVEL, VER, VERSIONINFO_DOCID, EntryVersionInfo, EntryDoc } from "./types";
import { resolveWithIgnoreKnownError } from "./utils";
import { PouchDB } from "../pouchdb-browser-webpack/dist/pouchdb-browser.js";
import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";

export const isValidRemoteCouchDBURI = (uri: string): boolean => {
    if (uri.startsWith("https://")) return true;
    if (uri.startsWith("http://")) return true;
    return false;
};
let last_post_successed = false;
export const getLastPostFailedBySize = () => {
    return !last_post_successed;
};
const fetchByAPI = async (request: RequestUrlParam): Promise<RequestUrlResponse> => {
    const ret = await requestUrl(request);
    if (ret.status - (ret.status % 100) !== 200) {
        const er: Error & { status?: number } = new Error(`Request Error:${ret.status}`);
        if (ret.json) {
            er.message = ret.json.reason;
            er.name = `${ret.json.error ?? ""}:${ret.json.message ?? ""}`;
        }
        er.status = ret.status;
        throw er;
    }
    return ret;
};

export const connectRemoteCouchDB = async (uri: string, auth: { username: string; password: string }, disableRequestURI: boolean): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> => {
    if (!isValidRemoteCouchDBURI(uri)) return "Remote URI is not valid";
    let authHeader = "";
    if (auth.username && auth.password) {
        const utf8str = String.fromCharCode.apply(null, new TextEncoder().encode(`${auth.username}:${auth.password}`));
        const encoded = window.btoa(utf8str);
        authHeader = "Basic " + encoded;
    } else {
        authHeader = "";
    }
    const conf: PouchDB.HttpAdapter.HttpAdapterConfiguration = {
        adapter: "http",
        auth,
        fetch: async function (url: string | Request, opts: RequestInit) {
            let size_ok = true;
            let size = "";
            const localURL = url.toString().substring(uri.length);
            const method = opts.method ?? "GET";
            if (opts.body) {
                const opts_length = opts.body.toString().length;
                if (opts_length > 1024 * 1024 * 10) {
                    // over 10MB
                    size_ok = false;
                    if (uri.contains(".cloudantnosqldb.")) {
                        last_post_successed = false;
                        Logger("This request should fail on IBM Cloudant.", LOG_LEVEL.VERBOSE);
                        throw new Error("This request should fail on IBM Cloudant.");
                    }
                }
                size = ` (${opts_length})`;
            }

            if (!disableRequestURI && typeof url == "string" && typeof (opts.body ?? "") == "string") {
                const body = opts.body as string;

                const transformedHeaders = { ...(opts.headers as Record<string, string>) };
                if (authHeader != "") transformedHeaders["authorization"] = authHeader;
                delete transformedHeaders["host"];
                delete transformedHeaders["Host"];
                delete transformedHeaders["content-length"];
                delete transformedHeaders["Content-Length"];
                const requestParam: RequestUrlParam = {
                    url: url as string,
                    method: opts.method,
                    body: body,
                    headers: transformedHeaders,
                    contentType: "application/json",
                    // contentType: opts.headers,
                };

                try {
                    const r = await fetchByAPI(requestParam);
                    if (method == "POST" || method == "PUT") {
                        last_post_successed = r.status - (r.status % 100) == 200;
                    } else {
                        last_post_successed = true;
                    }
                    Logger(`HTTP:${method}${size} to:${localURL} -> ${r.status}`, LOG_LEVEL.VERBOSE);

                    return new Response(r.arrayBuffer, {
                        headers: r.headers,
                        status: r.status,
                        statusText: `${r.status}`,
                    });
                } catch (ex) {
                    Logger(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL.VERBOSE);
                    if (!size_ok && (method == "POST" || method == "PUT")) {
                        last_post_successed = false;
                    }
                    Logger(ex);
                    throw ex;
                }
            }

            // -old implementation

            try {
                const responce: Response = await fetch(url, opts);
                if (method == "POST" || method == "PUT") {
                    last_post_successed = responce.ok;
                } else {
                    last_post_successed = true;
                }
                Logger(`HTTP:${method}${size} to:${localURL} -> ${responce.status}`, LOG_LEVEL.VERBOSE);
                return responce;
            } catch (ex) {
                Logger(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL.VERBOSE);
                if (!size_ok && (method == "POST" || method == "PUT")) {
                    last_post_successed = false;
                }
                Logger(ex);
                throw ex;
            }
            // return await fetch(url, opts);
        },
    };
    const db: PouchDB.Database<EntryDoc> = new PouchDB<EntryDoc>(uri, conf);
    try {
        const info = await db.info();
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
export const checkRemoteVersion = async (db: PouchDB.Database, migrate: (from: number, to: number) => Promise<boolean>, barrier: number = VER): Promise<boolean> => {
    try {
        const versionInfo = (await db.get(VERSIONINFO_DOCID)) as EntryVersionInfo;
        if (versionInfo.type != "versioninfo") {
            return false;
        }

        const version = versionInfo.version;
        if (version < barrier) {
            const versionUpResult = await migrate(version, barrier);
            if (versionUpResult) {
                await bumpRemoteVersion(db);
                return true;
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
export const bumpRemoteVersion = async (db: PouchDB.Database, barrier: number = VER): Promise<boolean> => {
    const vi: EntryVersionInfo = {
        _id: VERSIONINFO_DOCID,
        version: barrier,
        type: "versioninfo",
    };
    const versionInfo = (await resolveWithIgnoreKnownError(db.get(VERSIONINFO_DOCID), vi)) as EntryVersionInfo;
    if (versionInfo.type != "versioninfo") {
        return false;
    }
    vi._rev = versionInfo._rev;
    await db.put(vi);
    return true;
};
