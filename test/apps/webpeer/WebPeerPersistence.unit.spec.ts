import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import { REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/types.js";
import { describe, expect, it } from "vitest";

import {
    WEBPEER_SETTINGS_KEY,
    createWebPeerPersistence,
} from "@/apps/webpeer/src/WebPeerPersistence";

function createMemoryStore(initial: Record<string, unknown> = {}): SimpleStore<unknown> {
    const values = new Map(Object.entries(initial));
    return {
        db: Promise.resolve(undefined),
        get: async (key) => values.get(key),
        set: async (key, value) => {
            values.set(key, value);
        },
        delete: async (key) => {
            values.delete(key);
        },
        keys: async (from, to, count) => {
            const selected = [...values.keys()]
                .sort()
                .filter((key) => (from === undefined || key >= from) && (to === undefined || key <= to));
            return count === undefined ? selected : selected.slice(0, count);
        },
    };
}

describe("WebPeer settings persistence", () => {
    it("loads P2P-only defaults and saves the complete settings object", async () => {
        const store = createMemoryStore({
            [WEBPEER_SETTINGS_KEY]: {
                P2P_AppID: "custom-app",
                P2P_roomID: "room-42",
                P2P_Enabled: true,
            },
        });
        const persistence = createWebPeerPersistence(store);

        const loaded = await persistence.settings.load();

        expect(loaded).toEqual(
            expect.objectContaining({
                P2P_AppID: "custom-app",
                P2P_roomID: "room-42",
                P2P_Enabled: true,
                remoteType: REMOTE_P2P,
                isConfigured: true,
                additionalSuffixOfDatabaseName: "",
                suspendParseReplicationResult: true,
            })
        );
        const updated = { ...loaded!, P2P_AutoStart: true };
        await persistence.settings.save(updated);
        await expect(store.get(WEBPEER_SETTINGS_KEY)).resolves.toEqual(updated);
    });
});
