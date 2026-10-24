import { randomUUID } from "node:crypto";
import PouchDB from "pouchdb-core";
import MemoryAdapter from "pouchdb-adapter-memory";
import { vi } from "vitest";
import {
    DEFAULT_SETTINGS,
    type EntryDoc,
    type SavingEntry,
    type FilePathWithPrefix,
    type DocumentID,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createTextBlob } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { createLiveSyncEventHub } from "@vrtmrz/livesync-commonlib/context";
import { LiveSyncLocalDB, type LiveSyncLocalDBEnv } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";

PouchDB.plugin(MemoryAdapter);

export function optionalFileEntry(path: string, content: string): SavingEntry {
    return {
        _id: path as DocumentID,
        path: path as FilePathWithPrefix,
        ctime: 1_000,
        mtime: 2_000,
        size: content.length,
        type: "plain",
        datatype: "plain",
        data: createTextBlob(content),
        children: [],
        eden: {},
    };
}

export async function createOptionalFileSyncDatabase() {
    const name = `optional-file-sync-${randomUUID()}`;
    const database = new PouchDB<EntryDoc>(name, { adapter: "memory" });
    const settings = {
        ...DEFAULT_SETTINGS,
        syncInternalFiles: true,
        useOnlyLocalChunk: true,
        usePluginSync: true,
        usePluginSyncV2: true,
        pluginSyncExtendedSetting: {},
    };
    const services = {
        API: { addLog: vi.fn(), getSystemConfigDir: () => ".obsidian" },
        setting: { currentSettings: () => settings, getDeviceAndVaultName: () => "device" },
        path: {
            path2id: async (path: string) => path,
            id2path: (id: string, entry?: { path?: string }) => entry?.path ?? id,
            getPath: (entry: { path: FilePathWithPrefix }) => entry.path,
        },
        context: { events: createLiveSyncEventHub() },
        database: { createPouchDBInstance: () => database },
        databaseEvents: {
            onDatabaseInitialisation: async () => true,
            onDatabaseHasReady: async () => true,
            onCloseDatabase: async () => true,
            onUnloadDatabase: async () => true,
        },
        replicator: { onCloseActiveReplication: async () => true },
    };
    const localDatabase = new LiveSyncLocalDB(name, { services } as unknown as LiveSyncLocalDBEnv);
    if (!(await localDatabase.initializeDatabase())) {
        await database.destroy();
        throw new Error("The optional-file test database could not initialise");
    }
    return {
        database,
        localDatabase,
        services,
        settings,
        async dispose() {
            localDatabase.offRemoteChunkFetchedHandler?.();
            await localDatabase.managers.teardownManagers();
            await database.destroy();
        },
    };
}
