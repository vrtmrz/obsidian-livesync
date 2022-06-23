import { Logger } from "./lib/src/logger";
import { LOG_LEVEL, VER, VERSIONINFO_DOCID, EntryVersionInfo, EntryDoc, RemoteDBSettings, SYNCINFO_ID, SyncInfo } from "./lib/src/types";
import { enableEncryption, resolveWithIgnoreKnownError } from "./lib/src/utils";
import { PouchDB } from "./pouchdb-browser";
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

export const connectRemoteCouchDBWithSetting = (settings: RemoteDBSettings, isMobile: boolean) =>
    connectRemoteCouchDB(
        settings.couchDB_URI + (settings.couchDB_DBNAME == "" ? "" : "/" + settings.couchDB_DBNAME),
        {
            username: settings.couchDB_USER,
            password: settings.couchDB_PASSWORD,
        },
        settings.disableRequestURI || isMobile,
        settings.encrypt ? settings.passphrase : settings.encrypt
    );

const connectRemoteCouchDB = async (uri: string, auth: { username: string; password: string }, disableRequestURI: boolean, passphrase: string | boolean): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> => {
    if (!isValidRemoteCouchDBURI(uri)) return "Remote URI is not valid";
    if (uri.toLowerCase() != uri) return "Remote URI and database name cound not contain capital letters.";
    if (uri.indexOf(" ") !== -1) return "Remote URI and database name cound not contain spaces.";
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
            let size = "";
            const localURL = url.toString().substring(uri.length);
            const method = opts.method ?? "GET";
            if (opts.body) {
                const opts_length = opts.body.toString().length;
                if (opts_length > 1024 * 1024 * 10) {
                    // over 10MB
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
                    Logger(`HTTP:${method}${size} to:${localURL} -> ${r.status}`, LOG_LEVEL.DEBUG);

                    return new Response(r.arrayBuffer, {
                        headers: r.headers,
                        status: r.status,
                        statusText: `${r.status}`,
                    });
                } catch (ex) {
                    Logger(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL.VERBOSE);
                    // limit only in bulk_docs.
                    if (url.toString().indexOf("_bulk_docs") !== -1) {
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
                Logger(`HTTP:${method}${size} to:${localURL} -> ${responce.status}`, LOG_LEVEL.DEBUG);
                return responce;
            } catch (ex) {
                Logger(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL.VERBOSE);
                // limit only in bulk_docs.
                if (url.toString().indexOf("_bulk_docs") !== -1) {
                    last_post_successed = false;
                }
                Logger(ex);
                throw ex;
            }
            // return await fetch(url, opts);
        },
    };

    const db: PouchDB.Database<EntryDoc> = new PouchDB<EntryDoc>(uri, conf);
    if (passphrase && typeof passphrase === "string") {
        enableEncryption(db, passphrase);
    }
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

export const checkSyncInfo = async (db: PouchDB.Database): Promise<boolean> => {
    try {
        const syncinfo = (await db.get(SYNCINFO_ID)) as SyncInfo;
        console.log(syncinfo);
        // if we could decrypt the doc, it must be ok.
        return true;
    } catch (ex) {
        if (ex.status && ex.status == 404) {
            const randomStrSrc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
            const temp = [...Array(30)]
                .map((e) => Math.floor(Math.random() * randomStrSrc.length))
                .map((e) => randomStrSrc[e])
                .join("");
            const newSyncInfo: SyncInfo = {
                _id: SYNCINFO_ID,
                type: "syncinfo",
                data: temp,
            };
            if (await db.put(newSyncInfo)) {
                return true;
            }
            return false;
        } else {
            console.dir(ex);
            return false;
        }
    }
};
