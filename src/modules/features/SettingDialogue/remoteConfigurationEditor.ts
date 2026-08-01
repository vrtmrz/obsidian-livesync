import {
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    REMOTE_P2P,
    REMOTE_WEBDAV,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    ConnectionStringParser,
    type RemoteConfigurationResult,
} from "@vrtmrz/livesync-commonlib/compat/common/ConnectionString";
import { parseWebDAVConnectionURI } from "@vrtmrz/livesync-commonlib/journal-storage";

export type ConfigurableRemoteType =
    | typeof REMOTE_COUCHDB
    | typeof REMOTE_MINIO
    | typeof REMOTE_WEBDAV
    | typeof REMOTE_P2P;

function publicOrigin(uri: string): string {
    const url = new URL(uri);
    return `${url.protocol}//${url.host}`;
}

export function serializeRemoteConfiguration(settings: ObsidianLiveSyncSettings): string {
    switch (settings.remoteType) {
        case REMOTE_COUCHDB:
            return ConnectionStringParser.serialize({ type: "couchdb", settings });
        case REMOTE_MINIO:
            return ConnectionStringParser.serialize({ type: "s3", settings });
        case REMOTE_WEBDAV:
            return ConnectionStringParser.serialize({ type: "webdav", settings });
        case REMOTE_P2P:
            return ConnectionStringParser.serialize({ type: "p2p", settings });
        default:
            throw new Error("Unsupported remote type");
    }
}

export function remoteTypeForRemoteConfiguration(parsed: RemoteConfigurationResult): ConfigurableRemoteType {
    switch (parsed.type) {
        case "couchdb":
            return REMOTE_COUCHDB;
        case "s3":
            return REMOTE_MINIO;
        case "webdav":
            return REMOTE_WEBDAV;
        case "p2p":
            return REMOTE_P2P;
    }
}

export function suggestRemoteConfigurationName(parsed: RemoteConfigurationResult): string {
    if (parsed.type === "couchdb") {
        try {
            const url = new URL(parsed.settings.couchDB_URI);
            return `CouchDB ${url.host}`;
        } catch {
            return "Imported CouchDB";
        }
    }
    if (parsed.type === "s3") {
        return `S3 ${parsed.settings.bucket || parsed.settings.endpoint}`;
    }
    if (parsed.type === "webdav") {
        try {
            const endpoint = new URL(parseWebDAVConnectionURI(parsed.settings.webDAVactiveConnectionURI).endpoint);
            return `WebDAV ${endpoint.host}`;
        } catch {
            return "Imported WebDAV";
        }
    }
    return `P2P ${parsed.settings.P2P_roomID || "Remote"}`;
}

export function describeRemoteConfiguration(uri: string): string {
    try {
        const parsed = ConnectionStringParser.parse(uri);
        if (parsed.type === "couchdb") return publicOrigin(parsed.settings.couchDB_URI);
        if (parsed.type === "s3") return publicOrigin(parsed.settings.endpoint);
        if (parsed.type === "webdav") {
            return publicOrigin(parseWebDAVConnectionURI(parsed.settings.webDAVactiveConnectionURI).endpoint);
        }
        return "P2P";
    } catch {
        return "";
    }
}
