import { AbstractObsidianModule, type IObsidianModule } from "../AbstractObsidianModule.ts";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { Notice, requestUrl, type RequestUrlParam, type RequestUrlResponse } from "../../deps.ts";
import { type EntryDoc, type FilePathWithPrefix } from "../../lib/src/common/types.ts";
import { getPathFromTFile } from "../../common/utils.ts";
import {
    disableEncryption,
    enableEncryption,
    isCloudantURI,
    isValidRemoteCouchDBURI,
    replicationFilter,
} from "../../lib/src/pouchdb/utils_couchdb.ts";
import { setNoticeClass } from "../../lib/src/mock_and_interop/wrapper.ts";
import { ObsHttpHandler } from "./APILib/ObsHttpHandler.ts";
import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser.ts";
import { reactive, reactiveSource } from "octagonal-wheels/dataobject/reactive";

setNoticeClass(Notice);

async function fetchByAPI(request: RequestUrlParam): Promise<RequestUrlResponse> {
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

export class ModuleObsidianAPI extends AbstractObsidianModule implements IObsidianModule {
    _customHandler!: ObsHttpHandler;
    authHeaderSource = reactiveSource<string>("");
    authHeader = reactive(() =>
        this.authHeaderSource.value == "" ? "" : "Basic " + window.btoa(this.authHeaderSource.value)
    );

    last_successful_post = false;
    $$customFetchHandler(): ObsHttpHandler {
        if (!this._customHandler) this._customHandler = new ObsHttpHandler(undefined, undefined);
        return this._customHandler;
    }
    $$getLastPostFailedBySize(): boolean {
        return !this.last_successful_post;
    }

    async fetchByAPI(
        url: string,
        localURL: string,
        method: string,
        authHeader: string,
        opts?: RequestInit
    ): Promise<Response> {
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
            contentType: "application/json",
            // contentType: opts.headers,
        };
        const size = body ? ` (${body.length})` : "";
        try {
            this.plugin.requestCount.value = this.plugin.requestCount.value + 1;
            const r = await fetchByAPI(requestParam);
            if (method == "POST" || method == "PUT") {
                this.last_successful_post = r.status - (r.status % 100) == 200;
            } else {
                this.last_successful_post = true;
            }
            this._log(`HTTP:${method}${size} to:${localURL} -> ${r.status}`, LOG_LEVEL_DEBUG);

            return new Response(r.arrayBuffer, {
                headers: r.headers,
                status: r.status,
                statusText: `${r.status}`,
            });
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
        auth: { username: string; password: string },
        disableRequestURI: boolean,
        passphrase: string | false,
        useDynamicIterationCount: boolean,
        performSetup: boolean,
        skipInfo: boolean,
        compression: boolean
    ): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> {
        if (!isValidRemoteCouchDBURI(uri)) return "Remote URI is not valid";
        if (uri.toLowerCase() != uri) return "Remote URI and database name could not contain capital letters.";
        if (uri.indexOf(" ") !== -1) return "Remote URI and database name could not contain spaces.";
        const userNameAndPassword = auth.username && auth.password ? `${auth.username}:${auth.password}` : "";
        if (this.authHeaderSource.value != userNameAndPassword) {
            this.authHeaderSource.value = userNameAndPassword;
        }
        const authHeader = this.authHeader.value;
        // const _this = this;

        const conf: PouchDB.HttpAdapter.HttpAdapterConfiguration = {
            adapter: "http",
            auth,
            skip_setup: !performSetup,
            fetch: async (url: string | Request, opts?: RequestInit) => {
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
                    if (!disableRequestURI && typeof url == "string" && typeof (opts?.body ?? "") == "string") {
                        return await this.fetchByAPI(url, localURL, method, authHeader, opts);
                    }
                    // --> native Fetch API.

                    try {
                        if (this.settings.enableDebugTools) {
                            // Issue #407
                            (opts!.headers as Headers).append("ngrok-skip-browser-warning", "123");
                        }
                        this.plugin.requestCount.value = this.plugin.requestCount.value + 1;
                        const response: Response = await fetch(url, opts);
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
                            this._log(
                                "Failed to fetch by native fetch API. Trying to fetch by API to get more information."
                            );
                            const resp2 = await this.fetchByAPI(url.toString(), localURL, method, authHeader, opts);
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
            enableEncryption(db, passphrase, useDynamicIterationCount, false);
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
