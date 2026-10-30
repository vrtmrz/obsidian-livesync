import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/settings";
import {
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    REMOTE_P2P,
} from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import {
    FlagFilesHumanReadable,
    FlagFilesOriginal,
} from "@vrtmrz/livesync-commonlib/compat/common/models/redflag.const";
import { readFetchFlagState, writeFetchFlagState, type FetchFlagState } from "./redFlag.fetchStateMarkdown";

type FetchStateHost = NecessaryServices<never, "storageAccess">;

function endpointDescription(value: string): string {
    try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return "";
    }
}

/** Describe the current destination for confirmation, without connection credentials. */
export function describeFetchRemote(settings: ObsidianLiveSyncSettings): string {
    switch (settings.remoteType) {
        case REMOTE_COUCHDB:
            return ["CouchDB", endpointDescription(settings.couchDB_URI), settings.couchDB_DBNAME].join(" / ");
        case REMOTE_MINIO:
            return [
                "Object Storage",
                endpointDescription(settings.endpoint),
                settings.region,
                settings.bucket,
                settings.bucketPrefix,
            ]
                .filter(Boolean)
                .join(" / ");
        case REMOTE_P2P:
            return [
                "P2P",
                settings.P2P_AppID,
                settings.P2P_roomID,
                ...settings.P2P_relays.split(",").map((relay) => endpointDescription(relay.trim())),
            ]
                .filter(Boolean)
                .join(" / ");
        default:
            throw new Error("The selected remote type cannot use Fast Setup.");
    }
}

async function readFetchFlag(host: FetchStateHost) {
    const storage = host.serviceModules.storageAccess;
    // A newly scheduled fetch writes the human-readable flag, even if an older alias remains.
    for (const name of [FlagFilesHumanReadable.FETCH_ALL, FlagFilesOriginal.FETCH_ALL]) {
        const path = storage.normalisePath(name);
        if (await storage.isExists(path)) {
            return { path, markdown: await storage.readFileText(path) };
        }
    }
    throw new Error("The scheduled fetch flag is missing.");
}

async function writeVerified(host: FetchStateHost, path: string, markdown: string) {
    const storage = host.serviceModules.storageAccess;
    if (!(await storage.writeFileAuto(path, markdown)) || (await storage.readFileText(path)) !== markdown) {
        throw new Error("The Fast Setup choices could not be saved in the fetch flag.");
    }
}

export async function readFetchSelection(host: FetchStateHost): Promise<FetchFlagState | "empty" | "unreadable"> {
    const { markdown } = await readFetchFlag(host);
    if (!markdown.trim()) return "empty";
    return readFetchFlagState(markdown) ?? "unreadable";
}

export async function saveFetchSelection(host: FetchStateHost, stage1: string, stage2: string): Promise<void> {
    const { path, markdown } = await readFetchFlag(host);
    const state: FetchFlagState = {
        type: "livesync-fast-setup",
        version: 1,
        stage1,
        stage2,
    };
    const updated = writeFetchFlagState(markdown, state);
    if (updated !== markdown) await writeVerified(host, path, updated);
}

export async function clearFetchSelection(host: FetchStateHost): Promise<void> {
    const { path, markdown } = await readFetchFlag(host);
    const cleared = writeFetchFlagState(markdown, undefined);
    if (cleared !== markdown) await writeVerified(host, path, cleared);
}

/** Remove both aliases, retaining the authoritative flag until the other alias is gone. */
export async function deleteFetchFlags(host: NecessaryServices<never, "storageAccess">): Promise<void> {
    const storage = host.serviceModules.storageAccess;
    for (const name of [FlagFilesOriginal.FETCH_ALL, FlagFilesHumanReadable.FETCH_ALL]) {
        const path = storage.normalisePath(name);
        if (await storage.isExists(path)) await storage.delete(path, true);
        if (await storage.isExists(path)) throw new Error(`Could not remove ${name}.`);
    }
}
