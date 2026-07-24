import type {
    ObsidianLiveSyncSettings,
    RemoteDBSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type";

export type CouchDBConnectionProbeResult = { ok: true } | { ok: false; reason: string };

type CouchDBConnectionResult =
    | string
    | {
          db: unknown;
          info: unknown;
      };

export interface CouchDBConnectionProbe {
    isMobile(): boolean;
    connectRemoteCouchDBWithSetting(
        settings: RemoteDBSettings,
        isMobile: boolean,
        performSetup: boolean,
        skipInfo: boolean
    ): CouchDBConnectionResult | Promise<CouchDBConnectionResult>;
}

export function isCouchDBConnectionProbe(value: unknown): value is CouchDBConnectionProbe {
    return (
        typeof value === "object" &&
        value !== null &&
        "isMobile" in value &&
        typeof value.isMobile === "function" &&
        "connectRemoteCouchDBWithSetting" in value &&
        typeof value.connectRemoteCouchDBWithSetting === "function"
    );
}

export async function probeCouchDBConnection(
    replicator: unknown,
    settings: ObsidianLiveSyncSettings,
    createIfMissing: boolean
): Promise<CouchDBConnectionProbeResult> {
    if (!isCouchDBConnectionProbe(replicator)) {
        return { ok: false, reason: "The CouchDB connection probe is unavailable." };
    }
    const result = await replicator.connectRemoteCouchDBWithSetting(
        settings,
        replicator.isMobile(),
        createIfMissing,
        false
    );
    if (typeof result === "string") {
        return { ok: false, reason: result };
    }
    return { ok: true };
}

export function isValidCouchDBServerURL(value: string): boolean {
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    } catch {
        return false;
    }
}
