import { describe, expect, it, vi } from "vitest";
import { REMOTE_MINIO, REMOTE_POSTGREST, REMOTE_WEBDAV } from "@vrtmrz/livesync-commonlib/journal-storage";
import { REMOTE_COUCHDB } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator", () => ({
    LiveSyncJournalReplicator: class {},
}));

import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import { ModuleReplicatorMinIO } from "./ModuleReplicatorMinIO.ts";

function createModule(remoteType: string): ModuleReplicatorMinIO {
    const services = {
        API: {
            addCommand: vi.fn(),
            addLog: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
            registerWindow: vi.fn(),
        },
        setting: {
            saveSettingData: vi.fn(async () => undefined),
        },
    };
    const core = {
        _services: services,
        services,
        settings: { remoteType },
    } as any;
    return new ModuleReplicatorMinIO(core);
}

describe("ModuleReplicatorMinIO Journal provider routing", () => {
    it.each([REMOTE_MINIO, REMOTE_WEBDAV, REMOTE_POSTGREST])(
        "creates the Journal replicator for %s",
        async (remoteType) => {
            const replicator = await createModule(remoteType)._anyNewReplicator();

            expect(replicator).toBeInstanceOf(LiveSyncJournalReplicator);
        }
    );

    it("does not claim CouchDB", async () => {
        expect(await createModule(REMOTE_COUCHDB)._anyNewReplicator()).toBe(false);
    });
});
