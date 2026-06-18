import { REMOTE_COUCHDB, REMOTE_MINIO } from "@lib/common/models/setting.const";
import type { ObsidianLiveSyncSettings } from "@lib/common/models/setting.type";
import { generateCredentialObject } from "@lib/replication/httplib";
import { parseHeaderValues } from "@lib/common/utils";
import { requestToCouchDBWithCredentials } from "./utils";
import { LOG_LEVEL_VERBOSE, Logger } from "@lib/common/logger";
import { DEFAULT_SETTINGS } from "@lib/common/models/setting.const.defaults";
import { isCloudantURI } from "@lib/pouchdb/utils_couchdb";
import { compatGlobal } from "@lib/common/coreEnvFunctions";
import { manifestVersion, packageVersion } from "@lib/common/coreEnvVars";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
function redactObject(obj: Record<string, unknown>, dotted: string, redactedValue = "REDACTED") {
    const keys = dotted.split(".");
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in current)) {
            current[key] = {};
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        current = current[key] as Record<string, unknown>;
    }
    const lastKey = keys[keys.length - 1];
    if (lastKey in current) {
        current[lastKey] = redactedValue;
    }
    return obj;
}
export async function generateReport(settings: ObsidianLiveSyncSettings, core: LiveSyncBaseCore) {
    let responseConfig: Record<string, unknown> = {};
    const REDACTED = "𝑅𝐸𝐷𝐴𝐶𝑇𝐸𝐷";
    if (settings.remoteType == REMOTE_COUCHDB) {
        try {
            const credential = generateCredentialObject(settings);
            const customHeaders = parseHeaderValues(settings.couchDB_CustomHeaders);
            const r = await requestToCouchDBWithCredentials(
                settings.couchDB_URI,
                credential,
                compatGlobal.origin,
                undefined,
                undefined,
                undefined,
                customHeaders
            );
            responseConfig = r.json as Record<string, unknown>;
            redactObject(responseConfig, "couch_httpd_auth.secret");
            redactObject(responseConfig, "couch_httpd_auth.authentication_db");
            redactObject(responseConfig, "couch_httpd_auth.authentication_redirect");
            redactObject(responseConfig, "couchdb.uuid");
            redactObject(responseConfig, "admins");
            redactObject(responseConfig, "users");
            redactObject(responseConfig, "chttpd_auth.secret");
            delete responseConfig["jwt_keys"];
        } catch (ex) {
            Logger(ex, LOG_LEVEL_VERBOSE);
            responseConfig = {
                error: "Requesting information from the remote CouchDB has failed. If you are using IBM Cloudant, this is normal behaviour.",
            };
        }
    } else if (settings.remoteType == REMOTE_MINIO) {
        responseConfig = { error: "Object Storage Synchronisation" };
        //
    }
    const defaultKeys = Object.keys(DEFAULT_SETTINGS) as (keyof ObsidianLiveSyncSettings)[];
    const pluginConfig = JSON.parse(JSON.stringify(settings)) as ObsidianLiveSyncSettings;
    const pluginKeys = Object.keys(pluginConfig);
    for (const key of pluginKeys) {
        if (defaultKeys.includes(key as keyof ObsidianLiveSyncSettings)) continue;
        delete pluginConfig[key as keyof ObsidianLiveSyncSettings];
    }

    pluginConfig.couchDB_DBNAME = REDACTED;
    pluginConfig.couchDB_PASSWORD = REDACTED;
    const scheme = pluginConfig.couchDB_URI.startsWith("http:")
        ? "(HTTP)"
        : pluginConfig.couchDB_URI.startsWith("https:")
          ? "(HTTPS)"
          : "";
    pluginConfig.couchDB_URI = isCloudantURI(pluginConfig.couchDB_URI) ? "cloudant" : `self-hosted${scheme}`;
    pluginConfig.couchDB_USER = REDACTED;
    pluginConfig.passphrase = REDACTED;
    pluginConfig.encryptedPassphrase = REDACTED;
    pluginConfig.encryptedCouchDBConnection = REDACTED;
    pluginConfig.accessKey = REDACTED;
    pluginConfig.secretKey = REDACTED;
    const redact = (source: string) => `${REDACTED}(${source.length} letters)`;
    const toSchemeOnly = (uri: string) => {
        try {
            return `${new URL(uri).protocol}//`;
        } catch {
            const matched = uri.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//);
            return matched?.[0] ?? REDACTED;
        }
    };
    pluginConfig.remoteConfigurations = Object.fromEntries(
        Object.entries(pluginConfig.remoteConfigurations || {}).map(([id, config]) => [
            id,
            {
                ...config,
                uri: toSchemeOnly(config.uri),
            },
        ])
    );
    pluginConfig.region = redact(pluginConfig.region);
    pluginConfig.bucket = redact(pluginConfig.bucket);
    pluginConfig.pluginSyncExtendedSetting = {};
    pluginConfig.P2P_AppID = redact(pluginConfig.P2P_AppID);
    pluginConfig.P2P_passphrase = redact(pluginConfig.P2P_passphrase);
    pluginConfig.P2P_roomID = redact(pluginConfig.P2P_roomID);
    pluginConfig.P2P_relays = redact(pluginConfig.P2P_relays);
    pluginConfig.jwtKey = redact(pluginConfig.jwtKey);
    pluginConfig.jwtSub = redact(pluginConfig.jwtSub);
    pluginConfig.jwtKid = redact(pluginConfig.jwtKid);
    pluginConfig.bucketCustomHeaders = redact(pluginConfig.bucketCustomHeaders);
    pluginConfig.couchDB_CustomHeaders = redact(pluginConfig.couchDB_CustomHeaders);
    pluginConfig.P2P_turnCredential = redact(pluginConfig.P2P_turnCredential);
    pluginConfig.P2P_turnUsername = redact(pluginConfig.P2P_turnUsername);
    pluginConfig.P2P_turnServers = `(${pluginConfig.P2P_turnServers.split(",").length} servers configured)`;
    const endpoint = pluginConfig.endpoint;
    if (endpoint == "") {
        pluginConfig.endpoint = "Not configured or AWS";
    } else {
        const endpointScheme = pluginConfig.endpoint.startsWith("http:")
            ? "(HTTP)"
            : pluginConfig.endpoint.startsWith("https:")
              ? "(HTTPS)"
              : "";
        pluginConfig.endpoint = `${endpoint.indexOf(".r2.cloudflarestorage.") !== -1 ? "R2" : "self-hosted?"}(${endpointScheme})`;
    }
    const obsidianInfo = {
        navigator: compatGlobal.navigator.userAgent,
        fileSystem: core.services.vault.isStorageInsensitive() ? "insensitive" : "sensitive",
    };
    const result = {
        obsidianInfo,
        responseConfig,
        pluginConfig,
        manifestVersion,
        packageVersion,
    };
    return result;
}
