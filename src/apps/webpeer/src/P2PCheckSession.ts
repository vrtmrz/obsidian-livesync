import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    EVENT_SERVER_STATUS,
    type P2PServerInfo,
} from "@vrtmrz/livesync-commonlib/compat/replication/trystero/TrysteroReplicatorP2PServer";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";

import { WEBPEER_SETTINGS_KEY } from "./WebPeerPersistence";
import { WebPeerRuntime } from "./WebPeerRuntime";

export const P2P_CHECK_SYSTEM_VAULT_NAME = "p2p-livesync-connection-check";

function createMemoryStore(settings: ObsidianLiveSyncSettings): SimpleStore<unknown> {
    const values = new Map<string, unknown>([[WEBPEER_SETTINGS_KEY, settings]]);
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

export class P2PCheckSession {
    private runtime?: WebPeerRuntime;
    private removeStatusListener?: () => void;

    async start(
        settings: ObsidianLiveSyncSettings,
        browserDeviceName: string,
        onStatus: (status: P2PServerInfo) => void
    ): Promise<void> {
        if (this.runtime) {
            throw new Error("This P2P connection-check session has already started");
        }

        const runtime = new WebPeerRuntime({
            store: createMemoryStore(settings),
            deviceName: browserDeviceName,
            systemVaultName: P2P_CHECK_SYSTEM_VAULT_NAME,
        });
        this.runtime = runtime;
        this.removeStatusListener = runtime.events.onEvent(EVENT_SERVER_STATUS, onStatus);

        try {
            await runtime.start();
            await runtime.currentReplicator.makeSureOpened();
        } catch (error) {
            await this.stop();
            throw error;
        }
    }

    async stop(): Promise<void> {
        this.removeStatusListener?.();
        this.removeStatusListener = undefined;
        const runtime = this.runtime;
        this.runtime = undefined;
        await runtime?.shutdown();
    }
}
