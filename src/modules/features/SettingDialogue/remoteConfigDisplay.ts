import { ConnectionStringParser } from "@lib/common/ConnectionString.ts";

export function getRemoteConfigurationDescription(uri: string): string {
    try {
        const parsed = ConnectionStringParser.parse(uri);
        if (parsed.type === "couchdb") {
            const url = new URL(parsed.settings.couchDB_URI);
            url.username = "";
            url.password = "";
            url.search = "";
            url.hash = "";
            return url.toString();
        }
        if (parsed.type === "s3") {
            return `${parsed.settings.endpoint.replace(/\/+$/g, "")}/${parsed.settings.bucket}`;
        }
        if (parsed.type === "webdav") {
            const url = new URL(parsed.settings.webDAVactiveConnectionURI.replace(/^sls\+webdav:/, "https:"));
            url.username = "";
            url.password = "";
            url.search = "";
            url.hash = "";
            return url.toString();
        }
        return `P2P ${parsed.settings.P2P_roomID || "Remote"}`;
    } catch {
        return uri.split("@").pop()?.split("?")[0] || "";
    }
}
