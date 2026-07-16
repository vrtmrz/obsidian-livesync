import { requestToCouchDBWithCredentials } from "@/common/utils";
import { $msg } from "@lib/common/i18n";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "@lib/common/logger";
import type { ObsidianLiveSyncSettings } from "@lib/common/types";
import { fireAndForget, parseHeaderValues } from "@lib/common/utils";
import { isCloudantURI } from "@lib/pouchdb/utils_couchdb";
import { generateCredentialObject } from "@lib/replication/httplib";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";
import { isUnauthorizedError } from "@lib/common/utils.doc";

export const checkConfig = async (
    checkResultDiv: HTMLDivElement | undefined,
    editingSettings: ObsidianLiveSyncSettings
) => {
    Logger($msg("Checking database configuration"), LOG_LEVEL_INFO);
    let isSuccessful = true;
    const emptyDiv = createDiv();
    emptyDiv.createSpan();
    checkResultDiv?.replaceChildren(...[emptyDiv]);
    const addResult = (msg: string, classes?: string[]) => {
        const tmpDiv = createDiv();
        tmpDiv.addClass("ob-btn-config-fix");
        if (classes) {
            tmpDiv.addClasses(classes);
        }
        tmpDiv.textContent = msg;
        checkResultDiv?.appendChild(tmpDiv);
    };
    try {
        if (isCloudantURI(editingSettings.couchDB_URI)) {
            Logger($msg("This feature cannot be used with IBM Cloudant."), LOG_LEVEL_NOTICE);
            return;
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

        const addConfigFixButton = (title: string, key: string, value: string) => {
            if (!checkResultDiv) return;
            const tmpDiv = createDiv();
            tmpDiv.addClass("ob-btn-config-fix");
            tmpDiv.createEl("label", { text: title });
            const fixButton = tmpDiv.createEl("button", { text: $msg("obsidianLiveSyncSettingTab.btnFix") });
            const x = checkResultDiv.appendChild(tmpDiv);
            fixButton.addEventListener("click", () => {
                fireAndForget(async () => {
                    Logger($msg("CouchDB Configuration: ${title} -> Set ${key} to ${value}", { title, key, value }));
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
                        Logger($msg("CouchDB Configuration: ${title} successfully updated", { title }), LOG_LEVEL_NOTICE);
                        checkResultDiv.removeChild(x);
                        await checkConfig(checkResultDiv, editingSettings);
                    } else {
                        Logger($msg("CouchDB Configuration: ${title} failed", { title }), LOG_LEVEL_NOTICE);
                        Logger(res.text, LOG_LEVEL_VERBOSE);
                    }
                });
            });
        };
        addResult($msg("---Notice---"), ["ob-btn-config-head"]);
        addResult($msg("If the server configuration is not persistent (e.g., running on docker), the values here may change. Once you are able to connect, please update the settings in the server's local.ini."), ["ob-btn-config-info"]);
        addResult($msg("--Config check--"), ["ob-btn-config-head"]);

        const serverBanner = r.headers["server"] ?? r.headers["Server"] ?? "unknown";
        addResult($msg("Server info: ${info}", { info: serverBanner }));
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
            addResult($msg("⚠ You do not have administrator privileges."));
        } else {
            addResult($msg("✔ You have administrator privileges."));
        }
        if (isGreaterThanOrEqual("3.2.0")) {
            // HTTP user-authorization check
            if (responseConfig?.chttpd?.require_valid_user != "true") {
                isSuccessful = false;
                addResult($msg("❗ chttpd.require_valid_user is wrong."));
                addConfigFixButton(
                    $msg("Set chttpd.require_valid_user = true"),
                    "chttpd/require_valid_user",
                    "true"
                );
            } else {
                addResult($msg("✔ chttpd.require_valid_user is ok."));
            }
        } else {
            if (responseConfig?.chttpd_auth?.require_valid_user != "true") {
                isSuccessful = false;
                addResult($msg("❗ chttpd_auth.require_valid_user is wrong."));
                addConfigFixButton(
                    $msg("Set chttpd_auth.require_valid_user = true"),
                    "chttpd_auth/require_valid_user",
                    "true"
                );
            } else {
                addResult($msg("✔ chttpd_auth.require_valid_user is ok."));
            }
        }
        // HTTPD check
        //  Check Authentication header
        if (!responseConfig?.httpd["WWW-Authenticate"]) {
            isSuccessful = false;
            addResult($msg("❗ httpd.WWW-Authenticate is missing"));
            addConfigFixButton(
                $msg("Set httpd.WWW-Authenticate"),
                "httpd/WWW-Authenticate",
                'Basic realm="couchdb"'
            );
        } else {
            addResult($msg("✔ httpd.WWW-Authenticate is ok."));
        }
        if (isGreaterThanOrEqual("3.2.0")) {
            if (responseConfig?.chttpd?.enable_cors != "true") {
                isSuccessful = false;
                addResult($msg("❗ chttpd.enable_cors is wrong"));
                addConfigFixButton(
                    $msg("Set chttpd.enable_cors"),
                    "chttpd/enable_cors",
                    "true"
                );
            } else {
                addResult($msg("✔ chttpd.enable_cors is ok."));
            }
        } else {
            if (responseConfig?.httpd?.enable_cors != "true") {
                isSuccessful = false;
                addResult($msg("❗ httpd.enable_cors is wrong"));
                addConfigFixButton($msg("Set httpd.enable_cors"), "httpd/enable_cors", "true");
            } else {
                addResult($msg("✔ httpd.enable_cors is ok."));
            }
        }
        // If the server is not cloudant, configure request size
        if (!isCloudantURI(editingSettings.couchDB_URI)) {
            // REQUEST SIZE
            if (Number(responseConfig?.chttpd?.max_http_request_size ?? 0) < 4294967296) {
                isSuccessful = false;
                addResult($msg("❗ chttpd.max_http_request_size is low)"));
                addConfigFixButton(
                    $msg("Set chttpd.max_http_request_size"),
                    "chttpd/max_http_request_size",
                    "4294967296"
                );
            } else {
                addResult($msg("✔ chttpd.max_http_request_size is ok."));
            }
            if (Number(responseConfig?.couchdb?.max_document_size ?? 0) < 50000000) {
                isSuccessful = false;
                addResult($msg("❗ couchdb.max_document_size is low)"));
                addConfigFixButton(
                    $msg("Set couchdb.max_document_size"),
                    "couchdb/max_document_size",
                    "50000000"
                );
            } else {
                addResult($msg("✔ couchdb.max_document_size is ok."));
            }
        }
        // CORS check
        //  checking connectivity for mobile
        if (responseConfig?.cors?.credentials != "true") {
            isSuccessful = false;
            addResult($msg("❗ cors.credentials is wrong"));
            addConfigFixButton($msg("Set cors.credentials"), "cors/credentials", "true");
        } else {
            addResult($msg("✔ cors.credentials is ok."));
        }
        const ConfiguredOrigins = ((responseConfig?.cors?.origins ?? "") + "").split(",");
        if (
            responseConfig?.cors?.origins == "*" ||
            (ConfiguredOrigins.indexOf("app://obsidian.md") !== -1 &&
                ConfiguredOrigins.indexOf("capacitor://localhost") !== -1 &&
                ConfiguredOrigins.indexOf("http://localhost") !== -1)
        ) {
            addResult($msg("✔ cors.origins is ok."));
        } else {
            const fixedValue = [
                ...new Set([
                    ...ConfiguredOrigins.map((e) => e.trim()),
                    "app://obsidian.md",
                    "capacitor://localhost",
                    "http://localhost",
                ]),
            ].join(",");
            addResult($msg("❗ cors.origins is wrong"));
            addConfigFixButton($msg("Set cors.origins"), "cors/origins", fixedValue);
            isSuccessful = false;
        }
        addResult($msg("--Connection check--"), ["ob-btn-config-head"]);
        addResult($msg("Current origin: ${origin}", { origin: compatGlobal.location.origin }));

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
            addResult($msg("Origin check: ${org}", { org }));
            if (responseHeaders["access-control-allow-credentials"] != "true") {
                addResult($msg("❗ CORS is not allowing credentials"));
                isSuccessful = false;
            } else {
                addResult($msg("CORS credentials OK"));
            }
            if (responseHeaders["access-control-allow-origin"] != org) {
                addResult(
                    $msg("⚠ CORS Origin is unmatched ${from}->${to}", {
                        from: origin,
                        to: responseHeaders["access-control-allow-origin"],
                    })
                );
            } else {
                addResult($msg("✔ CORS origin OK"));
            }
        }
        addResult($msg("--Done--"), ["ob-btn-config-head"]);
        addResult($msg("If you're having trouble with the Connection-check (even after checking config), please check your reverse proxy configuration."), ["ob-btn-config-info"]);
        Logger($msg("Checking configuration done"), LOG_LEVEL_INFO);
    } catch (ex) {
        if (isUnauthorizedError(ex)) {
            isSuccessful = false;
            addResult($msg("❗ Access forbidden."));
            addResult($msg("We could not continue the test."));
            Logger($msg("Checking configuration done"), LOG_LEVEL_INFO);
        } else {
            Logger($msg("Checking configuration failed"), LOG_LEVEL_NOTICE);
            Logger(ex);
            isSuccessful = false;
        }
    }
    return isSuccessful;
};
