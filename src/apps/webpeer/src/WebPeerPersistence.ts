import {
    DEFAULT_SETTINGS,
    P2P_DEFAULT_SETTINGS,
    REMOTE_P2P,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import { SimpleStoreIDBv2 } from "octagonal-wheels/databases/SimpleStoreIDBv2";

import type { LiveSyncBrowserSettingsPersistence } from "@/apps/browser/createLiveSyncBrowserServiceHub";

export const WEBPEER_STORE_NAME = "p2p-livesync-web-peer";
export const WEBPEER_SETTINGS_KEY = "settings";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Creates WebPeer-owned settings persistence without retaining legacy database names. */
export function createWebPeerPersistence(
    store: SimpleStore<unknown> = SimpleStoreIDBv2.open<unknown>(WEBPEER_STORE_NAME)
): {
    readonly store: SimpleStore<unknown>;
    readonly settings: LiveSyncBrowserSettingsPersistence;
} {
    const settings: LiveSyncBrowserSettingsPersistence = {
        async load() {
            const savedSettings = await store.get(WEBPEER_SETTINGS_KEY);
            return {
                ...DEFAULT_SETTINGS,
                ...P2P_DEFAULT_SETTINGS,
                additionalSuffixOfDatabaseName: "",
                suspendParseReplicationResult: true,
                ...(isRecord(savedSettings) ? savedSettings : {}),
                remoteType: REMOTE_P2P,
                isConfigured: true,
            };
        },
        async save(currentSettings) {
            await store.set(WEBPEER_SETTINGS_KEY, currentSettings);
        },
    };

    return {
        store,
        settings,
    };
}
