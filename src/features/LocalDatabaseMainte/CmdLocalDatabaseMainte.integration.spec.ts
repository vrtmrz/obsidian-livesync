import { describe, expect, it, vi } from "vitest";
import PouchDB from "pouchdb-core";
import HttpPouch from "pouchdb-adapter-http";
import MemoryAdapter from "pouchdb-adapter-memory";
import replication from "pouchdb-replication";

vi.mock("@/features/LiveSyncCommands", () => ({
    LiveSyncCommands: class LiveSyncCommands {
        core!: { settings: unknown };
        get settings() {
            return this.core.settings;
        }
    },
}));
vi.mock("@/common/events", () => ({
    EVENT_ANALYSE_DB_USAGE: "analyse",
    EVENT_REQUEST_PERFORM_GC_V3: "gc",
    eventHub: {
        onEvent: vi.fn(),
    },
}));

import {
    DEFAULT_SETTINGS,
    REMOTE_COUCHDB,
    type DocumentID,
    type EntryDoc,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import { LocalDatabaseMaintenance } from "./CmdLocalDatabaseMainte";

PouchDB.plugin(HttpPouch).plugin(MemoryAdapter).plugin(replication);

type FixtureContent = {
    type: "leaf" | "plain";
    data?: string;
    path?: string;
    children?: string[];
    ctime?: number;
    mtime?: number;
    size?: number;
    eden?: Record<string, never>;
};

type FixtureDocument = PouchDB.Core.PutDocument<FixtureContent> & {
    _id: DocumentID;
    _revisions?: {
        start: number;
        ids: string[];
    };
};

function chunk(id: string, data = id): FixtureDocument {
    return {
        _id: id as DocumentID,
        type: "leaf",
        data,
    };
}

function revision(id: string, rev: string, history: string[], children: string[]): FixtureDocument {
    return {
        _id: id as DocumentID,
        _rev: rev,
        _revisions: {
            start: Number(rev.split("-")[0]),
            ids: history,
        },
        type: "plain",
        path: id,
        children,
        ctime: 1,
        mtime: 1,
        size: children.length,
        eden: {},
    } as unknown as FixtureDocument;
}

function liveSyncDatabaseFor(database: PouchDB.Database<FixtureContent>): LiveSyncLocalDB {
    const subject = Object.create(LiveSyncLocalDB.prototype) as LiveSyncLocalDB;
    Object.assign(subject, {
        localDatabase: database as unknown as PouchDB.Database<EntryDoc>,
    });
    return subject;
}

function requiredEnvironment(name: "hostname" | "username" | "password"): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required integration-test environment variable: ${name}`);
    }
    return value;
}

describe("LocalDatabaseMaintenance Garbage Collection V3 with CouchDB", () => {
    it("propagates collection safely, completes compaction, and permits content-addressed chunk recreation", async () => {
        const databaseName = `livesync-gcv3-${crypto.randomUUID()}`;
        const createRemote = () =>
            new PouchDB<FixtureContent>(`${requiredEnvironment("hostname").replace(/\/+$/u, "")}/${databaseName}`, {
                adapter: "http",
                auth: {
                    username: requiredEnvironment("username"),
                    password: requiredEnvironment("password"),
                },
            });
        const local = new PouchDB<FixtureContent>(`${databaseName}-source`, { adapter: "memory" });
        const replica = new PouchDB<FixtureContent>(`${databaseName}-replica`, { adapter: "memory" });
        const remote = createRemote();
        const maintenanceRemote = createRemote();
        const closeMaintenanceRemote = vi.spyOn(maintenanceRemote, "close");

        try {
            await remote.info();
            await local.bulkDocs([
                chunk("h:obsolete"),
                chunk("h:current"),
                chunk("h:shared"),
                chunk("h:base"),
                chunk("h:left"),
                chunk("h:right"),
            ]);

            const firstRevision = revision("first.md", "1-first", ["first"], ["h:obsolete"]);
            delete firstRevision._rev;
            delete firstRevision._revisions;
            await local.put(firstRevision);
            await local.put({
                ...(await local.get("first.md")),
                children: ["h:current"],
            });

            for (const id of ["second.md", "third.md"]) {
                const sharedRevision = revision(id, `1-${id}`, [id], ["h:shared"]);
                delete sharedRevision._rev;
                delete sharedRevision._revisions;
                await local.put(sharedRevision);
            }

            await local.bulkDocs(
                [
                    revision("conflicted.md", "1-base", ["base"], ["h:base"]),
                    revision("conflicted.md", "2-left", ["left", "base"], ["h:left"]),
                    revision("conflicted.md", "2-right", ["right", "base"], ["h:right"]),
                ],
                { new_edits: false }
            );

            const liveSyncDatabase = liveSyncDatabaseFor(local);
            const replicationModes: string[] = [];
            const replicator = {
                openOneShotReplication: vi.fn(
                    async (
                        _settings: typeof DEFAULT_SETTINGS,
                        _showResult: boolean,
                        _ignoreCleanLock: boolean,
                        mode: string
                    ) => {
                        replicationModes.push(mode);
                        if (mode === "sync") {
                            await local.sync(remote);
                        } else if (mode === "pushOnly") {
                            await local.replicate.to(remote);
                        } else {
                            throw new Error(`Unexpected replication mode: ${mode}`);
                        }
                        return true;
                    }
                ),
                getConnectedDeviceList: vi.fn(() =>
                    Promise.resolve({
                        accepted_nodes: ["integration-device"],
                        node_info: {
                            "integration-device": {
                                progress: "10-local",
                                device_name: "Integration device",
                                app_version: "1.12.7",
                                plugin_version: "1.0.0-beta.0",
                            },
                        },
                    })
                ),
                connectRemoteCouchDBWithSetting: vi.fn(() => Promise.resolve({ db: maintenanceRemote })),
            };
            const notice = vi.fn();
            const maintenance = Object.create(LocalDatabaseMaintenance.prototype) as LocalDatabaseMaintenance;
            Object.assign(maintenance, {
                core: {
                    settings: {
                        ...DEFAULT_SETTINGS,
                        remoteType: REMOTE_COUCHDB,
                    },
                    replicator,
                    confirm: {
                        askSelectStringDialogue: vi.fn(() => Promise.resolve("Proceed Garbage Collection")),
                    },
                },
                localDatabase: liveSyncDatabase,
                _notice: notice,
            });
            vi.spyOn(maintenance, "ensureAvailable").mockResolvedValue(true);
            const clearHash = vi.spyOn(maintenance, "clearHash").mockImplementation(() => undefined);

            await maintenance.gcv3();

            expect(closeMaintenanceRemote).toHaveBeenCalledOnce();
            expect(replicationModes).toEqual(["sync", "pushOnly"]);
            expect(clearHash).toHaveBeenCalledOnce();
            expect(notice).toHaveBeenCalledWith("Compaction on remote database completed successfully.", "gc-compact");
            expect(notice).not.toHaveBeenCalledWith("Compaction on remote database timed out.", "gc-compact");
            expect(notice).not.toHaveBeenCalledWith("Compaction on remote database failed.", "gc-compact");

            const obsoleteRow = (await remote.allDocs({ keys: ["h:obsolete"] })).rows[0];
            expect(obsoleteRow).toMatchObject({
                id: "h:obsolete",
                value: {
                    deleted: true,
                },
            });

            for (const retainedChunk of ["h:current", "h:shared", "h:base", "h:left", "h:right"]) {
                await expect(remote.get(retainedChunk)).resolves.toMatchObject({
                    _id: retainedChunk,
                    type: "leaf",
                });
            }
            await expect(remote.get("second.md")).resolves.toMatchObject({ children: ["h:shared"] });
            await expect(remote.get("third.md")).resolves.toMatchObject({ children: ["h:shared"] });
            await expect(remote.get("conflicted.md", { conflicts: true })).resolves.toMatchObject({
                _conflicts: [expect.any(String)],
            });

            await remote.replicate.to(replica);
            await expect(replica.get("h:obsolete")).rejects.toMatchObject({ status: 404 });
            for (const retainedChunk of ["h:current", "h:shared", "h:base", "h:left", "h:right"]) {
                await expect(replica.get(retainedChunk)).resolves.toMatchObject({
                    _id: retainedChunk,
                    type: "leaf",
                });
            }

            await local.put(chunk("h:obsolete", "recreated"));
            await local.replicate.to(remote);
            await remote.replicate.to(replica);

            await expect(remote.get("h:obsolete")).resolves.toMatchObject({
                _id: "h:obsolete",
                type: "leaf",
                data: "recreated",
            });
            await expect(replica.get("h:obsolete")).resolves.toMatchObject({
                _id: "h:obsolete",
                type: "leaf",
                data: "recreated",
            });
        } finally {
            if (closeMaintenanceRemote.mock.calls.length === 0) {
                await maintenanceRemote.close();
            }
            await Promise.all([local.destroy(), replica.destroy(), remote.destroy()]);
        }
    }, 30_000);
});
