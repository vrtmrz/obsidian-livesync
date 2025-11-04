import { requestToCouchDBWithCredentials } from "../../../../common/utils";
import { $msg } from "../../../../lib/src/common/i18n";
import { Logger } from "../../../../lib/src/common/logger";
import type { ObsidianLiveSyncSettings } from "../../../../lib/src/common/types";
import { parseHeaderValues } from "../../../../lib/src/common/utils";
import { isCloudantURI } from "../../../../lib/src/pouchdb/utils_couchdb";
import { generateCredentialObject } from "../../../../lib/src/replication/httplib";
export type ResultMessage = { message: string; classes: string[] };
export type ResultErrorMessage = { message: string; result: "error"; classes: string[] };
export type ResultOk = { message: string; result: "ok"; value?: any };
export type ResultError = { message: string; result: "error"; value: any; fixMessage: string; fix(): Promise<void> };
export type ConfigCheckResult = ResultOk | ResultError | ResultMessage | ResultErrorMessage;
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
async function updateRemoteSetting(setting: ObsidianLiveSyncSettings, key: string, value: any) {
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
    const result = [] as ConfigCheckResult[];
    const addMessage = (msg: string, classes: string[] = []) => {
        result.push({ message: msg, classes });
    };
    const addSuccess = (msg: string, value?: any) => {
        result.push({ message: msg, result: "ok", value });
    };
    const _addError = (message: string, fixMessage: string, fix: () => Promise<void>, value?: any) => {
        result.push({ message, result: "error", fixMessage, fix, value });
    };
    const addErrorMessage = (msg: string, classes: string[] = []) => {
        result.push({ message: msg, result: "error", classes });
    };

    const addError = (message: string, fixMessage: string, key: string, expected: any) => {
        _addError(message, fixMessage, async () => {
            await updateRemoteSetting(editingSettings, key, expected);
        });
    };

    addMessage($msg("obsidianLiveSyncSettingTab.logCheckingDbConfig"));

    try {
        if (isCloudantURI(editingSettings.couchDB_URI)) {
            addMessage($msg("obsidianLiveSyncSettingTab.logCannotUseCloudant"));
            return result;
        }
        // Tip: Add log for cloudant as Logger($msg("obsidianLiveSyncSettingTab.logServerConfigurationCheck"));
        const customHeaders = parseHeaderValues(editingSettings.couchDB_CustomHeaders);
        const credential = generateCredentialObject(editingSettings);
        const r = await requestToCouchDBWithCredentials(
            editingSettings.couchDB_URI,
            credential,
            window.origin,
            undefined,
            undefined,
            undefined,
            customHeaders
        );
        const responseConfig = r.json;
        addMessage($msg("obsidianLiveSyncSettingTab.msgNotice"), ["ob-btn-config-head"]);
        addMessage($msg("obsidianLiveSyncSettingTab.msgIfConfigNotPersistent"), ["ob-btn-config-info"]);
        addMessage($msg("obsidianLiveSyncSettingTab.msgConfigCheck"), ["ob-btn-config-head"]);

        const serverBanner = r.headers["server"] ?? r.headers["Server"] ?? "unknown";
        addMessage($msg("obsidianLiveSyncSettingTab.serverVersion", { info: serverBanner }));
        const versionMatch = serverBanner.match(/CouchDB(\/([0-9.]+))?/);
        const versionStr = versionMatch ? versionMatch[2] : "0.0.0";

        // Compare version string with the target version.
        // version must be a string like "3.2.1" or "3.10.2", and must be two or three parts.

        // Admin check
        //  for database creation and deletion
        if (!(editingSettings.couchDB_USER in responseConfig.admins)) {
            addSuccess($msg("obsidianLiveSyncSettingTab.warnNoAdmin"));
        } else {
            addSuccess($msg("obsidianLiveSyncSettingTab.okAdminPrivileges"));
        }
        if (isGreaterThanOrEqual(versionStr, "3.2.0")) {
            // HTTP user-authorization check
            if (responseConfig?.chttpd?.require_valid_user != "true") {
                addError(
                    $msg("obsidianLiveSyncSettingTab.errRequireValidUser"),
                    $msg("obsidianLiveSyncSettingTab.msgSetRequireValidUser"),
                    "chttpd/require_valid_user",
                    "true"
                );
            } else {
                addSuccess($msg("obsidianLiveSyncSettingTab.okRequireValidUser"));
            }
        } else {
            if (responseConfig?.chttpd_auth?.require_valid_user != "true") {
                addError(
                    $msg("obsidianLiveSyncSettingTab.errRequireValidUserAuth"),
                    $msg("obsidianLiveSyncSettingTab.msgSetRequireValidUserAuth"),
                    "chttpd_auth/require_valid_user",
                    "true"
                );
            } else {
                addSuccess($msg("obsidianLiveSyncSettingTab.okRequireValidUserAuth"));
            }
        }
        // HTTPD check
        //  Check Authentication header
        if (!responseConfig?.httpd["WWW-Authenticate"]) {
            addError(
                $msg("obsidianLiveSyncSettingTab.errMissingWwwAuth"),
                $msg("obsidianLiveSyncSettingTab.msgSetWwwAuth"),
                "httpd/WWW-Authenticate",
                'Basic realm="couchdb"'
            );
        } else {
            addSuccess($msg("obsidianLiveSyncSettingTab.okWwwAuth"));
        }
        if (isGreaterThanOrEqual(versionStr, "3.2.0")) {
            if (responseConfig?.chttpd?.enable_cors != "true") {
                addError(
                    $msg("obsidianLiveSyncSettingTab.errEnableCorsChttpd"),
                    $msg("obsidianLiveSyncSettingTab.msgEnableCorsChttpd"),
                    "chttpd/enable_cors",
                    "true"
                );
            } else {
                addSuccess($msg("obsidianLiveSyncSettingTab.okEnableCorsChttpd"));
            }
        } else {
            if (responseConfig?.httpd?.enable_cors != "true") {
                addError(
                    $msg("obsidianLiveSyncSettingTab.errEnableCors"),
                    $msg("obsidianLiveSyncSettingTab.msgEnableCors"),
                    "httpd/enable_cors",
                    "true"
                );
            } else {
                addSuccess($msg("obsidianLiveSyncSettingTab.okEnableCors"));
            }
        }
        // If the server is not cloudant, configure request size
        if (!isCloudantURI(editingSettings.couchDB_URI)) {
            // REQUEST SIZE
            if (Number(responseConfig?.chttpd?.max_http_request_size ?? 0) < 4294967296) {
                addError(
                    $msg("obsidianLiveSyncSettingTab.errMaxRequestSize"),
                    $msg("obsidianLiveSyncSettingTab.msgSetMaxRequestSize"),
                    "chttpd/max_http_request_size",
                    "4294967296"
                );
            } else {
                addSuccess($msg("obsidianLiveSyncSettingTab.okMaxRequestSize"));
            }
            if (Number(responseConfig?.couchdb?.max_document_size ?? 0) < 50000000) {
                addError(
                    $msg("obsidianLiveSyncSettingTab.errMaxDocumentSize"),
                    $msg("obsidianLiveSyncSettingTab.msgSetMaxDocSize"),
                    "couchdb/max_document_size",
                    "50000000"
                );
            } else {
                addSuccess($msg("obsidianLiveSyncSettingTab.okMaxDocumentSize"));
            }
        }
        // CORS check
        //  checking connectivity for mobile
        if (responseConfig?.cors?.credentials != "true") {
            addError(
                $msg("obsidianLiveSyncSettingTab.errCorsCredentials"),
                $msg("obsidianLiveSyncSettingTab.msgSetCorsCredentials"),
                "cors/credentials",
                "true"
            );
        } else {
            addSuccess($msg("obsidianLiveSyncSettingTab.okCorsCredentials"));
        }
        const ConfiguredOrigins = ((responseConfig?.cors?.origins ?? "") + "").split(",");
        if (
            responseConfig?.cors?.origins == "*" ||
            (ConfiguredOrigins.indexOf("app://obsidian.md") !== -1 &&
                ConfiguredOrigins.indexOf("capacitor://localhost") !== -1 &&
                ConfiguredOrigins.indexOf("http://localhost") !== -1)
        ) {
            addSuccess($msg("obsidianLiveSyncSettingTab.okCorsOrigins"));
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
                $msg("obsidianLiveSyncSettingTab.errCorsOrigins"),
                $msg("obsidianLiveSyncSettingTab.msgSetCorsOrigins"),
                "cors/origins",
                fixedValue
            );
        }
        addMessage($msg("obsidianLiveSyncSettingTab.msgConnectionCheck"), ["ob-btn-config-head"]);
        addMessage($msg("obsidianLiveSyncSettingTab.msgCurrentOrigin", { origin: window.location.origin }));

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
            addMessage($msg("obsidianLiveSyncSettingTab.msgOriginCheck", { org }));
            if (responseHeaders["access-control-allow-credentials"] != "true") {
                addErrorMessage($msg("obsidianLiveSyncSettingTab.errCorsNotAllowingCredentials"));
            } else {
                addSuccess($msg("obsidianLiveSyncSettingTab.okCorsCredentialsForOrigin"));
            }
            if (responseHeaders["access-control-allow-origin"] != org) {
                addErrorMessage(
                    $msg("obsidianLiveSyncSettingTab.warnCorsOriginUnmatched", {
                        from: origin,
                        to: responseHeaders["access-control-allow-origin"],
                    })
                );
            } else {
                addSuccess($msg("obsidianLiveSyncSettingTab.okCorsOriginMatched"));
            }
        }
        addMessage($msg("obsidianLiveSyncSettingTab.msgDone"), ["ob-btn-config-head"]);
        addMessage($msg("obsidianLiveSyncSettingTab.msgConnectionProxyNote"), ["ob-btn-config-info"]);
        addMessage($msg("obsidianLiveSyncSettingTab.logCheckingConfigDone"));
    } catch (ex: any) {
        if (ex?.status == 401) {
            addErrorMessage($msg("obsidianLiveSyncSettingTab.errAccessForbidden"));
            addErrorMessage($msg("obsidianLiveSyncSettingTab.errCannotContinueTest"));
            addMessage($msg("obsidianLiveSyncSettingTab.logCheckingConfigDone"));
        } else {
            addErrorMessage($msg("obsidianLiveSyncSettingTab.logCheckingConfigFailed"));
            Logger(ex);
        }
    }
    return result;
};
