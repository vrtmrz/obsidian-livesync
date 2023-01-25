import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
import { KeyValueDatabase, OpenKeyValueDatabase } from "./KeyValueDB.js";
import { LocalPouchDBBase } from "./lib/src/LocalPouchDBBase.js";
import { Logger } from "./lib/src/logger.js";
import { PouchDB } from "./lib/src/pouchdb-browser.js";
import { EntryDoc, LOG_LEVEL, ObsidianLiveSyncSettings } from "./lib/src/types.js";
import { enableEncryption } from "./lib/src/utils_couchdb.js";
import { isCloudantURI, isValidRemoteCouchDBURI } from "./lib/src/utils_couchdb.js";
import { id2path, path2id } from "./utils.js";

export class LocalPouchDB extends LocalPouchDBBase {

    kvDB: KeyValueDatabase;
    settings: ObsidianLiveSyncSettings;
    id2path(filename: string): string {
        return id2path(filename);
    }
    path2id(filename: string): string {
        return path2id(filename);
    }
    CreatePouchDBInstance<T>(name?: string, options?: PouchDB.Configuration.DatabaseConfiguration): PouchDB.Database<T> {
        if (this.settings.useIndexedDBAdapter) {
            options.adapter = "indexeddb";
            return new PouchDB(name + "-indexeddb", options);
        }
        return new PouchDB(name, options);
    }
    beforeOnUnload(): void {
        this.kvDB.close();
    }
    onClose(): void {
        this.kvDB.close();
    }
    async onInitializeDatabase(): Promise<void> {
        this.kvDB = await OpenKeyValueDatabase(this.dbname + "-livesync-kv");
    }
    async onResetDatabase(): Promise<void> {
        await this.kvDB.destroy();
    }

    last_successful_post = false;
    getLastPostFailedBySize() {
        return !this.last_successful_post;
    }
    async fetchByAPI(request: RequestUrlParam): Promise<RequestUrlResponse> {
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
    }


    async connectRemoteCouchDB(uri: string, auth: { username: string; password: string }, disableRequestURI: boolean, passphrase: string | false, useDynamicIterationCount: boolean): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> {
        if (!isValidRemoteCouchDBURI(uri)) return "Remote URI is not valid";
        if (uri.toLowerCase() != uri) return "Remote URI and database name could not contain capital letters.";
        if (uri.indexOf(" ") !== -1) return "Remote URI and database name could not contain spaces.";
        let authHeader = "";
        if (auth.username && auth.password) {
            const utf8str = String.fromCharCode.apply(null, new TextEncoder().encode(`${auth.username}:${auth.password}`));
            const encoded = window.btoa(utf8str);
            authHeader = "Basic " + encoded;
        } else {
            authHeader = "";
        }
        // const _this = this;

        const conf: PouchDB.HttpAdapter.HttpAdapterConfiguration = {
            adapter: "http",
            auth,
            fetch: async (url: string | Request, opts: RequestInit) => {
                let size = "";
                const localURL = url.toString().substring(uri.length);
                const method = opts.method ?? "GET";
                if (opts.body) {
                    const opts_length = opts.body.toString().length;
                    if (opts_length > 1000 * 1000 * 10) {
                        // over 10MB
                        if (isCloudantURI(uri)) {
                            this.last_successful_post = false;
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
                        const r = await this.fetchByAPI(requestParam);
                        if (method == "POST" || method == "PUT") {
                            this.last_successful_post = r.status - (r.status % 100) == 200;
                        } else {
                            this.last_successful_post = true;
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
                            this.last_successful_post = false;
                        }
                        Logger(ex);
                        throw ex;
                    }
                }

                // -old implementation

                try {
                    const response: Response = await fetch(url, opts);
                    if (method == "POST" || method == "PUT") {
                        this.last_successful_post = response.ok;
                    } else {
                        this.last_successful_post = true;
                    }
                    Logger(`HTTP:${method}${size} to:${localURL} -> ${response.status}`, LOG_LEVEL.DEBUG);
                    return response;
                } catch (ex) {
                    Logger(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL.VERBOSE);
                    // limit only in bulk_docs.
                    if (url.toString().indexOf("_bulk_docs") !== -1) {
                        this.last_successful_post = false;
                    }
                    Logger(ex);
                    throw ex;
                }
                // return await fetch(url, opts);
            },
        };

        const db: PouchDB.Database<EntryDoc> = new PouchDB<EntryDoc>(uri, conf);
        if (passphrase !== "false" && typeof passphrase === "string") {
            enableEncryption(db, passphrase, useDynamicIterationCount);
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
    }

}