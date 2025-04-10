import { AbstractObsidianModule, type IObsidianModule } from "../AbstractObsidianModule.ts";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { Notice, requestUrl, type RequestUrlParam, type RequestUrlResponse } from "../../deps.ts";
import {
    type CouchDBCredentials,
    type EntryDoc,
    type FilePathWithPrefix,
    type JWTCredentials,
    type JWTHeader,
    type JWTParams,
    type JWTPayload,
    type PreparedJWT,
} from "../../lib/src/common/types.ts";
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
import { reactive, reactiveSource } from "octagonal-wheels/dataobject/reactive.js";
import { arrayBufferToBase64Single, writeString } from "../../lib/src/string_and_binary/convert.ts";
import { Refiner } from "octagonal-wheels/dataobject/Refiner";

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

    _importKey(auth: JWTCredentials) {
        if (auth.jwtAlgorithm == "HS256" || auth.jwtAlgorithm == "HS512") {
            const key = (auth.jwtKey || "").trim();
            if (key == "") {
                throw new Error("JWT key is empty");
            }
            const binaryDerString = window.atob(key);
            const binaryDer = new Uint8Array(binaryDerString.length);
            for (let i = 0; i < binaryDerString.length; i++) {
                binaryDer[i] = binaryDerString.charCodeAt(i);
            }
            const hashName = auth.jwtAlgorithm == "HS256" ? "SHA-256" : "SHA-512";
            return crypto.subtle.importKey("raw", binaryDer, { name: "HMAC", hash: { name: hashName } }, true, [
                "sign",
            ]);
        } else if (auth.jwtAlgorithm == "ES256" || auth.jwtAlgorithm == "ES512") {
            const pem = auth.jwtKey
                .replace(/-----BEGIN [^-]+-----/, "")
                .replace(/-----END [^-]+-----/, "")
                .replace(/\s+/g, "");
            // const pem = key.replace(/\s/g, "");
            const binaryDerString = window.atob(pem);
            const binaryDer = new Uint8Array(binaryDerString.length);
            for (let i = 0; i < binaryDerString.length; i++) {
                binaryDer[i] = binaryDerString.charCodeAt(i);
            }
            // const binaryDer = base64ToArrayBuffer(pem);
            const namedCurve = auth.jwtAlgorithm == "ES256" ? "P-256" : "P-521";
            const param = { name: "ECDSA", namedCurve };
            return crypto.subtle.importKey("pkcs8", binaryDer, param, true, ["sign"]);
        } else {
            throw new Error("Supplied JWT algorithm is not supported.");
        }
    }

    _currentCryptoKey = new Refiner<JWTCredentials, CryptoKey>({
        evaluation: async (auth, previous) => {
            return await this._importKey(auth);
        },
    });

    _jwt = new Refiner<JWTParams, PreparedJWT>({
        evaluation: async (params, previous) => {
            const encodedHeader = btoa(JSON.stringify(params.header));
            const encodedPayload = btoa(JSON.stringify(params.payload));
            const buff = `${encodedHeader}.${encodedPayload}`.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

            const key = await this._currentCryptoKey.update(params.credentials).value;
            let token = "";
            if (params.header.alg == "ES256" || params.header.alg == "ES512") {
                const jwt = await crypto.subtle.sign(
                    { name: "ECDSA", hash: { name: "SHA-256" } },
                    key,
                    writeString(buff)
                );
                token = (await arrayBufferToBase64Single(jwt))
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_")
                    .replace(/=/g, "");
            } else if (params.header.alg == "HS256" || params.header.alg == "HS512") {
                const jwt = await crypto.subtle.sign(
                    { name: "HMAC", hash: { name: params.header.alg } },
                    key,
                    writeString(buff)
                );
                token = (await arrayBufferToBase64Single(jwt))
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_")
                    .replace(/=/g, "");
            } else {
                throw new Error("JWT algorithm is not supported.");
            }
            return {
                ...params,
                token: `${buff}.${token}`,
            } as PreparedJWT;
        },
    });

    _jwtParams = new Refiner<JWTCredentials, JWTParams>({
        evaluation(source, previous) {
            const kid = source.jwtKid || undefined;
            const sub = (source.jwtSub || "").trim();
            if (sub == "") {
                throw new Error("JWT sub is empty");
            }
            const algorithm = source.jwtAlgorithm || "";
            if (!algorithm) {
                throw new Error("JWT algorithm is not configured.");
            }
            if (algorithm != "HS256" && algorithm != "HS512" && algorithm != "ES256" && algorithm != "ES512") {
                throw new Error("JWT algorithm is not supported.");
            }
            const header: JWTHeader = {
                alg: source.jwtAlgorithm || "HS256",
                typ: "JWT",
                kid,
            };
            const iat = ~~(new Date().getTime() / 1000);
            const exp = iat + (source.jwtExpDuration || 5) * 60; // 5 minutes
            const payload = {
                exp,
                iat,
                sub: source.jwtSub || "",
                "_couchdb.roles": ["_admin"],
            } satisfies JWTPayload;
            return {
                header,
                payload,
                credentials: source,
            };
        },
        shouldUpdate(isDifferent, source, previous) {
            if (isDifferent) {
                return true;
            }
            if (!previous) {
                return true;
            }
            // if expired.
            const d = ~~(new Date().getTime() / 1000);
            if (previous.payload.exp < d) {
                // console.warn(`jwt expired ${previous.payload.exp} < ${d}`);
                return true;
            }
            return false;
        },
    });

    async $$connectRemoteCouchDB(
        uri: string,
        auth: CouchDBCredentials,
        disableRequestURI: boolean,
        passphrase: string | false,
        useDynamicIterationCount: boolean,
        performSetup: boolean,
        skipInfo: boolean,
        compression: boolean,
        customHeaders: Record<string, string>
    ): Promise<string | { db: PouchDB.Database<EntryDoc>; info: PouchDB.Core.DatabaseInfo }> {
        if (!isValidRemoteCouchDBURI(uri)) return "Remote URI is not valid";
        if (uri.toLowerCase() != uri) return "Remote URI and database name could not contain capital letters.";
        if (uri.indexOf(" ") !== -1) return "Remote URI and database name could not contain spaces.";
        let authHeader = "";
        if ("username" in auth) {
            const userNameAndPassword = auth.username && auth.password ? `${auth.username}:${auth.password}` : "";
            if (this.authHeaderSource.value != userNameAndPassword) {
                this.authHeaderSource.value = userNameAndPassword;
            }
            authHeader = this.authHeader.value;
        } else if ("jwtAlgorithm" in auth) {
            const params = await this._jwtParams.update(auth).value;
            const jwt = await this._jwt.update(params).value;
            const token = jwt.token;
            authHeader = `Bearer ${token}`;
        }

        const conf: PouchDB.HttpAdapter.HttpAdapterConfiguration = {
            adapter: "http",
            auth: "username" in auth ? auth : undefined,
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
                        if (customHeaders) {
                            for (const [key, value] of Object.entries(customHeaders)) {
                                if (key && value) {
                                    (opts!.headers as Headers).append(key, value);
                                }
                            }
                            // // Issue #407
                            // (opts!.headers as Headers).append("ngrok-skip-browser-warning", "123");
                        }
                        // debugger;
                        if (!("username" in auth)) {
                            (opts!.headers as Headers).append("authorization", authHeader);
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
