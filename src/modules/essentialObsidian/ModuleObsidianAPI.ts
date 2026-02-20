import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import {
    LEVEL_INFO,
    LEVEL_NOTICE,
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type LOG_LEVEL,
} from "octagonal-wheels/common/logger";
import { Notice, requestUrl, type RequestUrlParam, type RequestUrlResponse } from "../../deps.ts";
import { type CouchDBCredentials, type EntryDoc } from "../../lib/src/common/types.ts";
import { isCloudantURI, isValidRemoteCouchDBURI } from "../../lib/src/pouchdb/utils_couchdb.ts";
import { replicationFilter } from "@lib/pouchdb/compress.ts";
import { disableEncryption } from "@lib/pouchdb/encryption.ts";
import { enableEncryption } from "@lib/pouchdb/encryption.ts";
import { setNoticeClass } from "../../lib/src/mock_and_interop/wrapper.ts";
import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser.ts";
import { AuthorizationHeaderGenerator } from "../../lib/src/replication/httplib.ts";
import type { LiveSyncCore } from "../../main.ts";
import { EVENT_ON_UNRESOLVED_ERROR, eventHub } from "../../common/events.ts";

setNoticeClass(Notice);

async function fetchByAPI(request: RequestUrlParam, errorAsResult = false): Promise<RequestUrlResponse> {
    const ret = await requestUrl({ ...request, throw: !errorAsResult });
    return ret;
}
export class ModuleObsidianAPI extends AbstractObsidianModule {
    _authHeader = new AuthorizationHeaderGenerator();
    _previousErrors = new Set<string>();

    showError(msg: string, max_log_level: LOG_LEVEL = LEVEL_NOTICE) {
        const level = this._previousErrors.has(msg) ? LEVEL_INFO : max_log_level;
        this._log(msg, level);
        if (!this._previousErrors.has(msg)) {
            this._previousErrors.add(msg);
            eventHub.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
        }
    }
    clearErrors() {
        this._previousErrors.clear();
        eventHub.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
    }
    last_successful_post = false;

    _getLastPostFailedBySize(): boolean {
        return !this.last_successful_post;
    }

    async __fetchByAPI(url: string, authHeader: string, opts?: RequestInit): Promise<Response> {
        const body = opts?.body as string;

        const optHeaders = {} as Record<string, string>;
        if (opts && "headers" in opts) {
            if (opts.headers instanceof Headers) {
                // For Compatibility, mostly headers.entries() is supported, but not all environments.
                opts.headers.forEach((value, key) => {
                    optHeaders[key] = value;
                });
            } else {
                for (const [key, value] of Object.entries(opts.headers as Record<string, string>)) {
                    optHeaders[key] = value;
                }
            }
        }
        const transformedHeaders = { ...optHeaders };
        if (authHeader != "") transformedHeaders["authorization"] = authHeader;
        delete transformedHeaders["host"];
        delete transformedHeaders["Host"];
        delete transformedHeaders["content-length"];
        delete transformedHeaders["Content-Length"];
        const requestParam: RequestUrlParam = {
            url,
            method: opts?.method,
            body: body,
            headers: transformedHeaders,
            contentType:
                transformedHeaders?.["content-type"] ?? transformedHeaders?.["Content-Type"] ?? "application/json",
        };
        const r = await fetchByAPI(requestParam, true);
        return new Response(r.arrayBuffer, {
            headers: r.headers,
            status: r.status,
            statusText: `${r.status}`,
        });
    }

    async fetchByAPI(
        url: string,
        localURL: string,
        method: string,
        authHeader: string,
        opts?: RequestInit
    ): Promise<Response> {
        const body = opts?.body as string;
        const size = body ? ` (${body.length})` : "";
        try {
            const r = await this.__fetchByAPI(url, authHeader, opts);
            this.services.API.requestCount.value = this.services.API.requestCount.value + 1;
            if (method == "POST" || method == "PUT") {
                this.last_successful_post = r.status - (r.status % 100) == 200;
            } else {
                this.last_successful_post = true;
            }
            this._log(`HTTP:${method}${size} to:${localURL} -> ${r.status}`, LOG_LEVEL_DEBUG);
            return r;
        } catch (ex) {
            this._log(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL_VERBOSE);
            // limit only in bulk_docs.
            if (url.toString().indexOf("_bulk_docs") !== -1) {
                this.last_successful_post = false;
            }
            this._log(ex);
            throw ex;
        } finally {
            this.services.API.responseCount.value = this.services.API.responseCount.value + 1;
        }
    }

    async _connectRemoteCouchDB(
        uri: string,
        auth: CouchDBCredentials,
        disableRequestURI: boolean,
        passphrase: string | false,
        useDynamicIterationCount: boolean,
        performSetup: boolean,
        skipInfo: boolean,
        compression: boolean,
        customHeaders: Record<string, string>,
        useRequestAPI: boolean,
        getPBKDF2Salt: () => Promise<Uint8Array<ArrayBuffer>>
    ): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> {
        if (!isValidRemoteCouchDBURI(uri)) return "Remote URI is not valid";
        if (uri.toLowerCase() != uri) return "Remote URI and database name could not contain capital letters.";
        if (uri.indexOf(" ") !== -1) return "Remote URI and database name could not contain spaces.";
        if (!this.core.managers.networkManager.isOnline) {
            return "Network is offline";
        }
        // let authHeader = await this._authHeader.getAuthorizationHeader(auth);
        const conf: PouchDB.HttpAdapter.HttpAdapterConfiguration = {
            adapter: "http",
            auth: "username" in auth ? auth : undefined,
            skip_setup: !performSetup,
            fetch: async (url: string | Request, opts?: RequestInit) => {
                const authHeader = await this._authHeader.getAuthorizationHeader(auth);
                let size = "";
                const localURL = url.toString().substring(uri.length);
                const method = opts?.method ?? "GET";
                if (opts?.body) {
                    const opts_length = opts.body.toString().length;
                    if (opts_length > 1000 * 1000 * 10) {
                        // over 10MB
                        if (isCloudantURI(uri)) {
                            this.last_successful_post = false;
                            this._log("This request should fail on IBM Cloudant.", LOG_LEVEL_VERBOSE);
                            throw new Error("This request should fail on IBM Cloudant.");
                        }
                    }
                    size = ` (${opts_length})`;
                }
                try {
                    const headers = new Headers(opts?.headers);
                    if (customHeaders) {
                        for (const [key, value] of Object.entries(customHeaders)) {
                            if (key && value) {
                                headers.append(key, value);
                            }
                        }
                    }
                    if (!("username" in auth)) {
                        headers.append("authorization", authHeader);
                    }
                    try {
                        this.services.API.requestCount.value = this.services.API.requestCount.value + 1;
                        const response: Response = await (useRequestAPI
                            ? this.__fetchByAPI(url.toString(), authHeader, { ...opts, headers })
                            : fetch(url, { ...opts, headers }));
                        if (method == "POST" || method == "PUT") {
                            this.last_successful_post = response.ok;
                        } else {
                            this.last_successful_post = true;
                        }
                        this._log(`HTTP:${method}${size} to:${localURL} -> ${response.status}`, LOG_LEVEL_DEBUG);
                        if (Math.floor(response.status / 100) !== 2) {
                            if (response.status == 404) {
                                if (method === "GET" && localURL.indexOf("/_local/") === -1) {
                                    this._log(
                                        `Just checkpoint or some server information has been missing. The 404 error shown above is not an error.`,
                                        LOG_LEVEL_VERBOSE
                                    );
                                }
                            } else {
                                const r = response.clone();
                                this._log(
                                    `The request may have failed. The reason sent by the server: ${r.status}: ${r.statusText}`,
                                    LOG_LEVEL_NOTICE
                                );
                                try {
                                    const result = await r.text();
                                    this._log(result, LOG_LEVEL_VERBOSE);
                                } catch (_) {
                                    this._log("Cloud not fetch response body", LOG_LEVEL_VERBOSE);
                                    this._log(_, LOG_LEVEL_VERBOSE);
                                }
                            }
                        }
                        this.clearErrors();
                        return response;
                    } catch (ex) {
                        if (ex instanceof TypeError) {
                            if (useRequestAPI) {
                                this._log("Failed to request by API.");
                                throw ex;
                            }
                            this._log(
                                "Failed to fetch by native fetch API. Trying to fetch by API to get more information."
                            );
                            const resp2 = await this.fetchByAPI(url.toString(), localURL, method, authHeader, {
                                ...opts,
                                headers,
                            });
                            if (resp2.status / 100 == 2) {
                                this.showError(
                                    "The request was successful by API. But the native fetch API failed! Please check CORS settings on the remote database!. While this condition, you cannot enable LiveSync",
                                    LOG_LEVEL_NOTICE
                                );
                                return resp2;
                            }
                            const r2 = resp2.clone();
                            const msg = await r2.text();
                            this.showError(`Failed to fetch by API. ${resp2.status}: ${msg}`, LOG_LEVEL_NOTICE);
                            return resp2;
                        }
                        throw ex;
                    }
                } catch (ex: any) {
                    this._log(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL_VERBOSE);
                    const msg = ex instanceof Error ? `${ex?.name}:${ex?.message}` : ex?.toString();
                    this.showError(`Failed to fetch: ${msg}`); // Do not show notice, due to throwing below
                    this._log(ex, LOG_LEVEL_VERBOSE);
                    // limit only in bulk_docs.
                    if (url.toString().indexOf("_bulk_docs") !== -1) {
                        this.last_successful_post = false;
                    }
                    this._log(ex);
                    throw ex;
                } finally {
                    this.services.API.responseCount.value = this.services.API.responseCount.value + 1;
                }

                // return await fetch(url, opts);
            },
        };

        const db: PouchDB.Database<EntryDoc> = new PouchDB<EntryDoc>(uri, conf);
        replicationFilter(db, compression);
        disableEncryption();
        if (passphrase !== "false" && typeof passphrase === "string") {
            enableEncryption(
                db,
                passphrase,
                useDynamicIterationCount,
                false,
                getPBKDF2Salt,
                this.settings.E2EEAlgorithm
            );
        }
        if (skipInfo) {
            return { db: db, info: { db_name: "", doc_count: 0, update_seq: "" } };
        }
        try {
            const info = await db.info();
            return { db: db, info: info };
        } catch (ex: any) {
            const msg = `${ex?.name}:${ex?.message}`;
            this._log(ex, LOG_LEVEL_VERBOSE);
            return msg;
        }
    }

    private _reportUnresolvedMessages(): Promise<(string | Error)[]> {
        return Promise.resolve([...this._previousErrors]);
    }

    override onBindFunction(core: LiveSyncCore, services: typeof core.services) {
        services.API.isLastPostFailedDueToPayloadSize.setHandler(this._getLastPostFailedBySize.bind(this));
        services.remote.connect.setHandler(this._connectRemoteCouchDB.bind(this));
        services.appLifecycle.getUnresolvedMessages.addHandler(this._reportUnresolvedMessages.bind(this));
    }
}
