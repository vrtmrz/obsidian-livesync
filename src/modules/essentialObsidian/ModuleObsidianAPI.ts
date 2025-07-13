import { AbstractObsidianModule, type IObsidianModule } from "../AbstractObsidianModule.ts";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { Notice, requestUrl, type RequestUrlParam, type RequestUrlResponse } from "../../deps.ts";
import { type CouchDBCredentials, type EntryDoc, type FilePathWithPrefix } from "../../lib/src/common/types.ts";
import { getPathFromTFile } from "../../common/utils.ts";
import { isCloudantURI, isValidRemoteCouchDBURI } from "../../lib/src/pouchdb/utils_couchdb.ts";
import { replicationFilter } from "@/lib/src/pouchdb/compress.ts";
import { disableEncryption } from "@/lib/src/pouchdb/encryption.ts";
import { enableEncryption } from "@/lib/src/pouchdb/encryption.ts";
import { setNoticeClass } from "../../lib/src/mock_and_interop/wrapper.ts";
import { ObsHttpHandler } from "./APILib/ObsHttpHandler.ts";
import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser.ts";
import { AuthorizationHeaderGenerator } from "../../lib/src/replication/httplib.ts";

setNoticeClass(Notice);

async function fetchByAPI(request: RequestUrlParam, errorAsResult = false): Promise<RequestUrlResponse> {
    const ret = await requestUrl({ ...request, throw: !errorAsResult });
    return ret;
}

export class ModuleObsidianAPI extends AbstractObsidianModule implements IObsidianModule {
    _customHandler!: ObsHttpHandler;

    _authHeader = new AuthorizationHeaderGenerator();

    last_successful_post = false;
    $$customFetchHandler(): ObsHttpHandler {
        if (!this._customHandler) this._customHandler = new ObsHttpHandler(undefined, undefined);
        return this._customHandler;
    }
    $$getLastPostFailedBySize(): boolean {
        return !this.last_successful_post;
    }

    async _fetchByAPI(url: string, authHeader: string, opts?: RequestInit): Promise<Response> {
        const body = opts?.body as string;

        const transformedHeaders = { ...(opts?.headers as Record<string, string>) };
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
            const r = await this._fetchByAPI(url, authHeader, opts);
            this.plugin.requestCount.value = this.plugin.requestCount.value + 1;
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
            this.plugin.responseCount.value = this.plugin.responseCount.value + 1;
        }
    }

    async $$connectRemoteCouchDB(
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
        getPBKDF2Salt: () => Promise<Uint8Array>
    ): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> {
        if (!isValidRemoteCouchDBURI(uri)) return "Remote URI is not valid";
        if (uri.toLowerCase() != uri) return "Remote URI and database name could not contain capital letters.";
        if (uri.indexOf(" ") !== -1) return "Remote URI and database name could not contain spaces.";
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
                        this.plugin.requestCount.value = this.plugin.requestCount.value + 1;
                        const response: Response = await (useRequestAPI
                            ? this._fetchByAPI(url.toString(), authHeader, { ...opts, headers })
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
                                this._log(
                                    "The request was successful by API. But the native fetch API failed! Please check CORS settings on the remote database!. While this condition, you cannot enable LiveSync",
                                    LOG_LEVEL_NOTICE
                                );
                                return resp2;
                            }
                            const r2 = resp2.clone();
                            const msg = await r2.text();
                            this._log(`Failed to fetch by API. ${resp2.status}: ${msg}`, LOG_LEVEL_NOTICE);
                            return resp2;
                        }
                        throw ex;
                    }
                } catch (ex: any) {
                    this._log(`HTTP:${method}${size} to:${localURL} -> failed`, LOG_LEVEL_VERBOSE);
                    const msg = ex instanceof Error ? `${ex?.name}:${ex?.message}` : ex?.toString();
                    this._log(`Failed to fetch: ${msg}`, LOG_LEVEL_NOTICE);
                    this._log(ex, LOG_LEVEL_VERBOSE);
                    // limit only in bulk_docs.
                    if (url.toString().indexOf("_bulk_docs") !== -1) {
                        this.last_successful_post = false;
                    }
                    this._log(ex);
                    throw ex;
                } finally {
                    this.plugin.responseCount.value = this.plugin.responseCount.value + 1;
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

    $$isMobile(): boolean {
        //@ts-ignore : internal API
        return this.app.isMobile;
    }

    $$vaultName(): string {
        return this.app.vault.getName();
    }
    $$getVaultName(): string {
        return (
            this.core.$$vaultName() +
            (this.settings?.additionalSuffixOfDatabaseName ? "-" + this.settings.additionalSuffixOfDatabaseName : "")
        );
    }
    $$getActiveFilePath(): FilePathWithPrefix | undefined {
        const file = this.app.workspace.getActiveFile();
        if (file) {
            return getPathFromTFile(file);
        }
        return undefined;
    }

    $anyGetAppId(): Promise<string | undefined> {
        return Promise.resolve(`${"appId" in this.app ? this.app.appId : ""}`);
    }
}
