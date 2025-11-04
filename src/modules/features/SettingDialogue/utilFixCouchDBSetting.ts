import { requestToCouchDBWithCredentials } from "../../../common/utils";
import { $msg } from "../../../lib/src/common/i18n";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "../../../lib/src/common/logger";
import type { ObsidianLiveSyncSettings } from "../../../lib/src/common/types";
import { fireAndForget, parseHeaderValues } from "../../../lib/src/common/utils";
import { isCloudantURI } from "../../../lib/src/pouchdb/utils_couchdb";
import { generateCredentialObject } from "../../../lib/src/replication/httplib";

export const checkConfig = async (
    checkResultDiv: HTMLDivElement | undefined,
    editingSettings: ObsidianLiveSyncSettings
) => {
    Logger($msg("obsidianLiveSyncSettingTab.logCheckingDbConfig"), LOG_LEVEL_INFO);
    let isSuccessful = true;
    const emptyDiv = createDiv();
    emptyDiv.innerHTML = "<span></span>";
    checkResultDiv?.replaceChildren(...[emptyDiv]);
    const addResult = (msg: string, classes?: string[]) => {
        const tmpDiv = createDiv();
        tmpDiv.addClass("ob-btn-config-fix");
        if (classes) {
            tmpDiv.addClasses(classes);
        }
        tmpDiv.innerHTML = `${msg}`;
        checkResultDiv?.appendChild(tmpDiv);
    };
    try {
        if (isCloudantURI(editingSettings.couchDB_URI)) {
            Logger($msg("obsidianLiveSyncSettingTab.logCannotUseCloudant"), LOG_LEVEL_NOTICE);
            return;
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

        const addConfigFixButton = (title: string, key: string, value: string) => {
            if (!checkResultDiv) return;
            const tmpDiv = createDiv();
            tmpDiv.addClass("ob-btn-config-fix");
            tmpDiv.innerHTML = `<label>${title}</label><button>${$msg("obsidianLiveSyncSettingTab.btnFix")}</button>`;
            const x = checkResultDiv.appendChild(tmpDiv);
            x.querySelector("button")?.addEventListener("click", () => {
                fireAndForget(async () => {
                    Logger($msg("obsidianLiveSyncSettingTab.logCouchDbConfigSet", { title, key, value }));
                    const res = await requestToCouchDBWithCredentials(
                        editingSettings.couchDB_URI,
                        credential,
                        undefined,
                        key,
                        value,
                        undefined,
                        customHeaders
                    );
                    if (res.status == 200) {
                        Logger($msg("obsidianLiveSyncSettingTab.logCouchDbConfigUpdated", { title }), LOG_LEVEL_NOTICE);
                        checkResultDiv.removeChild(x);
                        await checkConfig(checkResultDiv, editingSettings);
                    } else {
                        Logger($msg("obsidianLiveSyncSettingTab.logCouchDbConfigFail", { title }), LOG_LEVEL_NOTICE);
                        Logger(res.text, LOG_LEVEL_VERBOSE);
                    }
                });
            });
        };
        addResult($msg("obsidianLiveSyncSettingTab.msgNotice"), ["ob-btn-config-head"]);
        addResult($msg("obsidianLiveSyncSettingTab.msgIfConfigNotPersistent"), ["ob-btn-config-info"]);
        addResult($msg("obsidianLiveSyncSettingTab.msgConfigCheck"), ["ob-btn-config-head"]);

        const serverBanner = r.headers["server"] ?? r.headers["Server"] ?? "unknown";
        addResult($msg("obsidianLiveSyncSettingTab.serverVersion", { info: serverBanner }));
        const versionMatch = serverBanner.match(/CouchDB(\/([0-9.]+))?/);
        const versionStr = versionMatch ? versionMatch[2] : "0.0.0";
        const versionParts = `${versionStr}.0.0.0`.split(".");
        // Compare version string with the target version.
        // version must be a string like "3.2.1" or "3.10.2", and must be two or three parts.
        function isGreaterThanOrEqual(version: string) {
            const targetParts = version.split(".");
            for (let i = 0; i < targetParts.length; i++) {
                // compare as number if possible (so 3.10 > 3.2, 3.10.1b > 3.10.1a)
                const result = versionParts[i].localeCompare(targetParts[i], undefined, { numeric: true });
                if (result > 0) return true;
                if (result < 0) return false;
            }
            return true;
        }
        // Admin check
        //  for database creation and deletion
        if (!(editingSettings.couchDB_USER in responseConfig.admins)) {
            addResult($msg("obsidianLiveSyncSettingTab.warnNoAdmin"));
        } else {
            addResult($msg("obsidianLiveSyncSettingTab.okAdminPrivileges"));
        }
        if (isGreaterThanOrEqual("3.2.0")) {
            // HTTP user-authorization check
            if (responseConfig?.chttpd?.require_valid_user != "true") {
                isSuccessful = false;
                addResult($msg("obsidianLiveSyncSettingTab.errRequireValidUser"));
                addConfigFixButton(
                    $msg("obsidianLiveSyncSettingTab.msgSetRequireValidUser"),
                    "chttpd/require_valid_user",
                    "true"
                );
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okRequireValidUser"));
            }
        } else {
            if (responseConfig?.chttpd_auth?.require_valid_user != "true") {
                isSuccessful = false;
                addResult($msg("obsidianLiveSyncSettingTab.errRequireValidUserAuth"));
                addConfigFixButton(
                    $msg("obsidianLiveSyncSettingTab.msgSetRequireValidUserAuth"),
                    "chttpd_auth/require_valid_user",
                    "true"
                );
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okRequireValidUserAuth"));
            }
        }
        // HTTPD check
        //  Check Authentication header
        if (!responseConfig?.httpd["WWW-Authenticate"]) {
            isSuccessful = false;
            addResult($msg("obsidianLiveSyncSettingTab.errMissingWwwAuth"));
            addConfigFixButton(
                $msg("obsidianLiveSyncSettingTab.msgSetWwwAuth"),
                "httpd/WWW-Authenticate",
                'Basic realm="couchdb"'
            );
        } else {
            addResult($msg("obsidianLiveSyncSettingTab.okWwwAuth"));
        }
        if (isGreaterThanOrEqual("3.2.0")) {
            if (responseConfig?.chttpd?.enable_cors != "true") {
                isSuccessful = false;
                addResult($msg("obsidianLiveSyncSettingTab.errEnableCorsChttpd"));
                addConfigFixButton(
                    $msg("obsidianLiveSyncSettingTab.msgEnableCorsChttpd"),
                    "chttpd/enable_cors",
                    "true"
                );
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okEnableCorsChttpd"));
            }
        } else {
            if (responseConfig?.httpd?.enable_cors != "true") {
                isSuccessful = false;
                addResult($msg("obsidianLiveSyncSettingTab.errEnableCors"));
                addConfigFixButton($msg("obsidianLiveSyncSettingTab.msgEnableCors"), "httpd/enable_cors", "true");
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okEnableCors"));
            }
        }
        // If the server is not cloudant, configure request size
        if (!isCloudantURI(editingSettings.couchDB_URI)) {
            // REQUEST SIZE
            if (Number(responseConfig?.chttpd?.max_http_request_size ?? 0) < 4294967296) {
                isSuccessful = false;
                addResult($msg("obsidianLiveSyncSettingTab.errMaxRequestSize"));
                addConfigFixButton(
                    $msg("obsidianLiveSyncSettingTab.msgSetMaxRequestSize"),
                    "chttpd/max_http_request_size",
                    "4294967296"
                );
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okMaxRequestSize"));
            }
            if (Number(responseConfig?.couchdb?.max_document_size ?? 0) < 50000000) {
                isSuccessful = false;
                addResult($msg("obsidianLiveSyncSettingTab.errMaxDocumentSize"));
                addConfigFixButton(
                    $msg("obsidianLiveSyncSettingTab.msgSetMaxDocSize"),
                    "couchdb/max_document_size",
                    "50000000"
                );
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okMaxDocumentSize"));
            }
        }
        // CORS check
        //  checking connectivity for mobile
        if (responseConfig?.cors?.credentials != "true") {
            isSuccessful = false;
            addResult($msg("obsidianLiveSyncSettingTab.errCorsCredentials"));
            addConfigFixButton($msg("obsidianLiveSyncSettingTab.msgSetCorsCredentials"), "cors/credentials", "true");
        } else {
            addResult($msg("obsidianLiveSyncSettingTab.okCorsCredentials"));
        }
        const ConfiguredOrigins = ((responseConfig?.cors?.origins ?? "") + "").split(",");
        if (
            responseConfig?.cors?.origins == "*" ||
            (ConfiguredOrigins.indexOf("app://obsidian.md") !== -1 &&
                ConfiguredOrigins.indexOf("capacitor://localhost") !== -1 &&
                ConfiguredOrigins.indexOf("http://localhost") !== -1)
        ) {
            addResult($msg("obsidianLiveSyncSettingTab.okCorsOrigins"));
        } else {
            const fixedValue = [
                ...new Set([
                    ...ConfiguredOrigins.map((e) => e.trim()),
                    "app://obsidian.md",
                    "capacitor://localhost",
                    "http://localhost",
                ]),
            ].join(",");
            addResult($msg("obsidianLiveSyncSettingTab.errCorsOrigins"));
            addConfigFixButton($msg("obsidianLiveSyncSettingTab.msgSetCorsOrigins"), "cors/origins", fixedValue);
            isSuccessful = false;
        }
        addResult($msg("obsidianLiveSyncSettingTab.msgConnectionCheck"), ["ob-btn-config-head"]);
        addResult($msg("obsidianLiveSyncSettingTab.msgCurrentOrigin", { origin: window.location.origin }));

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
            addResult($msg("obsidianLiveSyncSettingTab.msgOriginCheck", { org }));
            if (responseHeaders["access-control-allow-credentials"] != "true") {
                addResult($msg("obsidianLiveSyncSettingTab.errCorsNotAllowingCredentials"));
                isSuccessful = false;
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okCorsCredentialsForOrigin"));
            }
            if (responseHeaders["access-control-allow-origin"] != org) {
                addResult(
                    $msg("obsidianLiveSyncSettingTab.warnCorsOriginUnmatched", {
                        from: origin,
                        to: responseHeaders["access-control-allow-origin"],
                    })
                );
            } else {
                addResult($msg("obsidianLiveSyncSettingTab.okCorsOriginMatched"));
            }
        }
        addResult($msg("obsidianLiveSyncSettingTab.msgDone"), ["ob-btn-config-head"]);
        addResult($msg("obsidianLiveSyncSettingTab.msgConnectionProxyNote"), ["ob-btn-config-info"]);
        Logger($msg("obsidianLiveSyncSettingTab.logCheckingConfigDone"), LOG_LEVEL_INFO);
    } catch (ex: any) {
        if (ex?.status == 401) {
            isSuccessful = false;
            addResult($msg("obsidianLiveSyncSettingTab.errAccessForbidden"));
            addResult($msg("obsidianLiveSyncSettingTab.errCannotContinueTest"));
            Logger($msg("obsidianLiveSyncSettingTab.logCheckingConfigDone"), LOG_LEVEL_INFO);
        } else {
            Logger($msg("obsidianLiveSyncSettingTab.logCheckingConfigFailed"), LOG_LEVEL_NOTICE);
            Logger(ex);
            isSuccessful = false;
        }
    }
    return isSuccessful;
};
