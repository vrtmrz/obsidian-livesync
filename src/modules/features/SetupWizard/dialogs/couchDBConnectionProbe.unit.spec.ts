import { describe, expect, it, vi } from "vitest";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.type";
import { isValidCouchDBServerURL, probeCouchDBConnection } from "./couchDBConnectionProbe";

const settings = {
    couchDB_URI: "https://couch.example",
    couchDB_DBNAME: "notes",
} as ObsidianLiveSyncSettings;

describe("CouchDB setup connection policy", () => {
    it.each([
        [false, "connect to an existing database"],
        [true, "create or connect to a database"],
    ] as const)(
        "%s can %s without changing the Commonlib connection contract",
        async (createIfMissing, _description) => {
            const connectRemoteCouchDBWithSetting = vi.fn(async () => ({
                db: {},
                info: { db_name: "notes" },
            }));
            const replicator = {
                isMobile: vi.fn(() => false),
                connectRemoteCouchDBWithSetting,
                tryConnectRemote: vi.fn(),
            };

            await expect(probeCouchDBConnection(replicator, settings, createIfMissing)).resolves.toEqual({ ok: true });
            expect(connectRemoteCouchDBWithSetting).toHaveBeenCalledWith(settings, false, createIfMissing, false);
            expect(replicator.tryConnectRemote).not.toHaveBeenCalled();
        }
    );

    it("returns the connection error without saving or creating through another path", async () => {
        const replicator = {
            isMobile: vi.fn(() => true),
            connectRemoteCouchDBWithSetting: vi.fn(() => "database does not exist"),
        };

        await expect(probeCouchDBConnection(replicator, settings, false)).resolves.toEqual({
            ok: false,
            reason: "database does not exist",
        });
    });

    it.each([
        ["https://couch.example", true],
        ["http://127.0.0.1:5984", true],
        ["ftp://couch.example", false],
        ["couch.example", false],
        ["https://", false],
    ])("validates the saved server URL %s", (value, expected) => {
        expect(isValidCouchDBServerURL(value)).toBe(expected);
    });
});
