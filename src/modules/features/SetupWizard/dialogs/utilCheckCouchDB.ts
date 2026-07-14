import { requestToCouchDBWithCredentials } from "@/common/utils";
import { $msg } from "@lib/common/i18n";
import { Logger } from "@lib/common/logger";
import type { ObsidianLiveSyncSettings } from "@lib/common/types";
import { parseHeaderValues } from "@lib/common/utils";
import { isCloudantURI } from "@lib/pouchdb/utils_couchdb";
import { generateCredentialObject } from "@lib/replication/httplib";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";
import { isUnauthorizedError } from "@lib/common/utils.doc";

export type ResultMessage = { message: string; classes: string[] };
export type ResultErrorMessage = { message: string; result: "error"; classes: string[] };
export type ResultOk<T> = { message: string; result: "ok"; value?: T };
export type ResultError<T> = { message: string; result: "error"; value: T; fixMessage: string; fix(): Promise<void> };
export type ConfigCheckResult<T = unknown, U = unknown> =
    | ResultOk<T>
    | ResultError<U>
    | ResultMessage
    | ResultErrorMessage;
/**
 * Compares two version strings to determine if the baseVersion is greater than or equal to the version.
 * @param baseVersion a.b.c format
 * @param version  a.b.c format
 * @returns true if baseVersion is greater than or equal to version, false otherwise
 */
function isGreaterThanOrEqual(baseVersion: string, version: string) {
    const versionParts = `${baseVersion}.0.0.0`.split(".");
    const targetParts = version.split(".");
    for (let i = 0; i < targetParts.length; i++) {
        // compare as number if possible (so 3.10 > 3.2, 3.10.1b > 3.10.1a)
        const result = versionParts[i].localeCompare(targetParts[i], undefined, { numeric: true });
        if (result > 0) return true;
        if (result < 0) return false;
    }
    return true;
}

/**
 * Updates the remote CouchDB setting with the given key and value.
 * @param setting Connection settings
 * @param key setting key to update
 * @param value setting value to update
 * @returns true if the update was successful, false otherwise
 */
async function updateRemoteSetting(
    setting: ObsidianLiveSyncSettings,
    key: string,
    value: string
): Promise<true | string> {
    const customHeaders = parseHeaderValues(setting.couchDB_CustomHeaders);
    const credential = generateCredentialObject(setting);
    const res = await requestToCouchDBWithCredentials(
        setting.couchDB_URI,
        credential,
        undefined,
        key,
        value,
        undefined,
        customHeaders
    );
    if (res.status == 200) {
        return true;
    } else {
        return res.text || "Unknown error";
    }
}

/**
 * Checks the CouchDB configuration and returns the results.
 * @param editingSettings
 * @returns  Array of ConfigCheckResult
 */
export const checkConfig = async (editingSettings: ObsidianLiveSyncSettings) => {
    const result = [] as ConfigCheckResult<unknown, unknown>[];
    const addMessage = (msg: string, classes: string[] = []) => {
        result.push({ message: msg, classes });
    };
    const addSuccess = <T>(msg: string, value?: T) => {
        result.push({ message: msg, result: "ok", value });
    };
    const _addError = <T>(message: string, fixMessage: string, fix: () => Promise<void>, value?: T) => {
        result.push({ message, result: "error", fixMessage, fix, value });
    };
    const addErrorMessage = (msg: string, classes: string[] = []) => {
        result.push({ message: msg, result: "error", classes });
    };

    const addError = (message: string, fixMessage: string, key: string, expected: string) => {
        _addError(
            message,
            fixMessage,
            async () => {
                await updateRemoteSetting(editingSettings, key, expected);
            },
            expected
        );
    };

    addMessage($msg("Checking database configuration"));

    try {
        if (isCloudantURI(editingSettings.couchDB_URI)) {
            addMessage($msg("This feature cannot be used with IBM Cloudant."));
            return result;
        }
        // Tip: Add log for cloudant as Logger($msg("obsidianLiveSyncSettingTab.logServerConfigurationCheck"));
        const customHeaders = parseHeaderValues(editingSettings.couchDB_CustomHeaders);
        const credential = generateCredentialObject(editingSettings);
        const r = await requestToCouchDBWithCredentials(
            editingSettings.couchDB_URI,
            credential,
            compatGlobal.origin,
            undefined,
            undefined,
            undefined,
            customHeaders
        );
        const responseConfig = r.json;
        addMessage($msg("---Notice---"), ["ob-btn-config-head"]);
        addMessage($msg("If the server configuration is not persistent (e.g., running on docker), the values here may change. Once you are able to connect, please update the settings in the server's local.ini."), ["ob-btn-config-info"]);
        addMessage($msg("--Config check--"), ["ob-btn-config-head"]);

        const serverBanner = r.headers["server"] ?? r.headers["Server"] ?? "unknown";
        addMessage($msg("Server info: ${info}", { info: serverBanner }));
        const versionMatch = serverBanner.match(/CouchDB(\/([0-9.]+))?/);
        const versionStr = versionMatch ? versionMatch[2] : "0.0.0";

        // Compare version string with the target version.
        // version must be a string like "3.2.1" or "3.10.2", and must be two or three parts.

        // Admin check
        //  for database creation and deletion
        if (!(editingSettings.couchDB_USER in responseConfig.admins)) {
            addSuccess($msg("⚠ You do not have administrator privileges."));
        } else {
            addSuccess($msg("✔ You have administrator privileges."));
        }
        if (isGreaterThanOrEqual(versionStr, "3.2.0")) {
            // HTTP user-authorization check
            if (responseConfig?.chttpd?.require_valid_user != "true") {
                addError(
                    $msg("❗ chttpd.require_valid_user is wrong."),
                    $msg("Set chttpd.require_valid_user = true"),
                    "chttpd/require_valid_user",
                    "true"
                );
            } else {
                addSuccess($msg("✔ chttpd.require_valid_user is ok."));
            }
        } else {
            if (responseConfig?.chttpd_auth?.require_valid_user != "true") {
                addError(
                    $msg("❗ chttpd_auth.require_valid_user is wrong."),
                    $msg("Set chttpd_auth.require_valid_user = true"),
                    "chttpd_auth/require_valid_user",
                    "true"
                );
            } else {
                addSuccess($msg("✔ chttpd_auth.require_valid_user is ok."));
            }
        }
        // HTTPD check
        //  Check Authentication header
        if (!responseConfig?.httpd["WWW-Authenticate"]) {
            addError(
                $msg("❗ httpd.WWW-Authenticate is missing"),
                $msg("Set httpd.WWW-Authenticate"),
                "httpd/WWW-Authenticate",
                'Basic realm="couchdb"'
            );
        } else {
            addSuccess($msg("✔ httpd.WWW-Authenticate is ok."));
        }
        if (isGreaterThanOrEqual(versionStr, "3.2.0")) {
            if (responseConfig?.chttpd?.enable_cors != "true") {
                addError(
                    $msg("❗ chttpd.enable_cors is wrong"),
                    $msg("Set chttpd.enable_cors"),
                    "chttpd/enable_cors",
                    "true"
                );
            } else {
                addSuccess($msg("✔ chttpd.enable_cors is ok."));
            }
        } else {
            if (responseConfig?.httpd?.enable_cors != "true") {
                addError(
                    $msg("❗ httpd.enable_cors is wrong"),
                    $msg("Set httpd.enable_cors"),
                    "httpd/enable_cors",
                    "true"
                );
            } else {
                addSuccess($msg("✔ httpd.enable_cors is ok."));
            }
        }
        // If the server is not cloudant, configure request size
        if (!isCloudantURI(editingSettings.couchDB_URI)) {
            // REQUEST SIZE
            if (Number(responseConfig?.chttpd?.max_http_request_size ?? 0) < 4294967296) {
                addError(
                    $msg("❗ chttpd.max_http_request_size is low)"),
                    $msg("Set chttpd.max_http_request_size"),
                    "chttpd/max_http_request_size",
                    "4294967296"
                );
            } else {
                addSuccess($msg("✔ chttpd.max_http_request_size is ok."));
            }
            if (Number(responseConfig?.couchdb?.max_document_size ?? 0) < 50000000) {
                addError(
                    $msg("❗ couchdb.max_document_size is low)"),
                    $msg("Set couchdb.max_document_size"),
                    "couchdb/max_document_size",
                    "50000000"
                );
            } else {
                addSuccess($msg("✔ couchdb.max_document_size is ok."));
            }
        }
        // CORS check
        //  checking connectivity for mobile
        if (responseConfig?.cors?.credentials != "true") {
            addError(
                $msg("❗ cors.credentials is wrong"),
                $msg("Set cors.credentials"),
                "cors/credentials",
                "true"
            );
        } else {
            addSuccess($msg("✔ cors.credentials is ok."));
        }
        const ConfiguredOrigins = ((responseConfig?.cors?.origins ?? "") + "").split(",");
        if (
            responseConfig?.cors?.origins == "*" ||
            (ConfiguredOrigins.indexOf("app://obsidian.md") !== -1 &&
                ConfiguredOrigins.indexOf("capacitor://localhost") !== -1 &&
                ConfiguredOrigins.indexOf("http://localhost") !== -1)
        ) {
            addSuccess($msg("✔ cors.origins is ok."));
        } else {
            const fixedValue = [
                ...new Set([
                    ...ConfiguredOrigins.map((e) => e.trim()),
                    "app://obsidian.md",
                    "capacitor://localhost",
                    "http://localhost",
                ]),
            ].join(",");
            addError(
                $msg("❗ cors.origins is wrong"),
                $msg("Set cors.origins"),
                "cors/origins",
                fixedValue
            );
        }
        addMessage($msg("--Connection check--"), ["ob-btn-config-head"]);
        addMessage($msg("Current origin: ${origin}", { origin: compatGlobal.location.origin }));

        // Request header check
        const origins = ["app://obsidian.md", "capacitor://localhost", "http://localhost"];
        for (const org of origins) {
            const rr = await requestToCouchDBWithCredentials(
                editingSettings.couchDB_URI,
                credential,
                org,
                undefined,
                undefined,
                undefined,
                customHeaders
            );
            const responseHeaders = Object.fromEntries(
                Object.entries(rr.headers).map((e) => {
                    e[0] = `${e[0]}`.toLowerCase();
                    return e;
                })
            );
            addMessage($msg("Origin check: ${org}", { org }));
            if (responseHeaders["access-control-allow-credentials"] != "true") {
                addErrorMessage($msg("❗ CORS is not allowing credentials"));
            } else {
                addSuccess($msg("CORS credentials OK"));
            }
            if (responseHeaders["access-control-allow-origin"] != org) {
                addErrorMessage(
                    $msg("⚠ CORS Origin is unmatched ${from}->${to}", {
                        from: origin,
                        to: responseHeaders["access-control-allow-origin"],
                    })
                );
            } else {
                addSuccess($msg("✔ CORS origin OK"));
            }
        }
        addMessage($msg("--Done--"), ["ob-btn-config-head"]);
        addMessage($msg("If you're having trouble with the Connection-check (even after checking config), please check your reverse proxy configuration."), ["ob-btn-config-info"]);
        addMessage($msg("Checking configuration done"));
    } catch (ex) {
        if (isUnauthorizedError(ex)) {
            addErrorMessage($msg("❗ Access forbidden."));
            addErrorMessage($msg("We could not continue the test."));
            addMessage($msg("Checking configuration done"));
        } else {
            addErrorMessage($msg("Checking configuration failed"));
            Logger(ex);
        }
    }
    return result;
};
