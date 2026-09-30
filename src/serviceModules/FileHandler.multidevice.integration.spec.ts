import { afterEach, describe, expect, it, vi } from "vitest";
import PouchDB from "pouchdb-core";
import MemoryAdapter from "pouchdb-adapter-memory";
import HttpAdapter from "pouchdb-adapter-http";
import replication from "pouchdb-replication";
import type { EntryDoc, FilePathWithPrefix, UXFileInfo } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { compareMTime, createTextBlob, readContent } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { createLiveSyncEventHub } from "@vrtmrz/livesync-commonlib/context";
import { LiveSyncLocalDB, type LiveSyncLocalDBEnv } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import {
    ServiceDatabaseFileAccessBase,
    type ServiceDatabaseFileAccessDependencies,
} from "@vrtmrz/livesync-commonlib/compat/serviceModules/ServiceDatabaseFileAccessBase";
import type { ServiceFileHandlerDependencies } from "@vrtmrz/livesync-commonlib/compat/serviceModules/ServiceFileHandlerBase";
import { ServiceFileHandler } from "./FileHandler";
import {
    createConflictResolutionOperations,
    type ConflictResolutionOperationsDependencies,
} from "@/serviceFeatures/conflictResolution/operations";
import { runCommand } from "@/apps/cli/commands/runCommand";
import type { CLICommandContext } from "@/apps/cli/commands/types";

PouchDB.plugin(MemoryAdapter).plugin(HttpAdapter).plugin(replication);
const path = "multi-device.txt" as FilePathWithPrefix;
const old = "Original content\n";
const oldTime = 1_000_000;
class TestHandler extends ServiceFileHandler {}

function makeFile(body: string, mtime = oldTime): UXFileInfo {
    return {
        name: path,
        path,
        stat: { type: "file", ctime: oldTime, mtime, size: new Blob([body]).size },
        body: createTextBlob(body),
    };
}

async function makeDevice(name: string) {
    const db = new PouchDB<EntryDoc>(name, { adapter: "memory" });
    const reflection = new Map<FilePathWithPrefix, { revision: string; observedStorageMtime?: number }>();
    let storage = makeFile(old);
    const settings = { ...DEFAULT_SETTINGS, useOnlyLocalChunk: true, writeDocumentsIfConflicted: false };
    const setting = { currentSettings: () => settings };
    const pathService = {
        path2id: (value: string) => Promise.resolve(value),
        id2path: (id: string, entry?: { path?: string }) => entry?.path ?? id,
        getPath: (entry: { path: FilePathWithPrefix }) => entry.path,
        compareFileFreshness: (file: UXFileInfo, entry: { mtime: number }) =>
            compareMTime(file.stat.mtime, entry.mtime),
        markChangesAreSame: vi.fn(),
    };
    const events = createLiveSyncEventHub();
    const API = { addLog: vi.fn() };
    const localDatabase = new LiveSyncLocalDB(name, {
        services: {
            API,
            setting,
            path: pathService,
            context: { events },
            database: { createPouchDBInstance: () => db },
            databaseEvents: {
                onDatabaseInitialisation: () => Promise.resolve(true),
                onDatabaseHasReady: () => Promise.resolve(true),
                onCloseDatabase: () => Promise.resolve(true),
                onUnloadDatabase: () => Promise.resolve(true),
            },
            replicator: { onCloseActiveReplication: () => Promise.resolve(true) },
        },
    } as unknown as LiveSyncLocalDBEnv);
    await expect(localDatabase.initializeDatabase()).resolves.toBe(true);
    const storageAccess = {
        getStub: () => Promise.resolve(storage),
        getFileStub: () => Promise.resolve(storage),
        readStubContent: () => Promise.resolve(storage),
        ensureDir: () => Promise.resolve(true),
        writeFileAuto: vi.fn((_path: string, body: string, times: { mtime: number }) => {
            storage = makeFile(body, times.mtime);
            return Promise.resolve(true);
        }),
        stat: () => Promise.resolve(storage.stat),
        touched: () => Promise.resolve(),
        triggerFileEvent: vi.fn(),
    };
    const conflict = { queueCheckFor: vi.fn(), queueCheckForIfOpen: vi.fn() };
    const services = {
        API,
        path: pathService,
        setting,
        events,
        database: { localDatabase },
        vault: { isTargetFile: () => Promise.resolve(true), isFileSizeTooLarge: () => false },
        storageAccess,
        conflict,
        fileReflectionProvenance: {
            get: (value: FilePathWithPrefix) => Promise.resolve(reflection.get(value)),
            set: (value: FilePathWithPrefix, record: { revision: string }) => {
                reflection.set(value, record);
                return Promise.resolve();
            },
            delete: (value: FilePathWithPrefix) => {
                reflection.delete(value);
                return Promise.resolve();
            },
        },
        fileProcessing: { processFileEvent: { addHandler: vi.fn() } },
        replication: { processSynchroniseResult: { addHandler: vi.fn() } },
    } as unknown as ServiceFileHandlerDependencies & ServiceDatabaseFileAccessDependencies;
    const access = new ServiceDatabaseFileAccessBase(services);
    (services as ServiceFileHandlerDependencies).databaseFileAccess = access;
    const handler = new TestHandler(services);
    return {
        db,
        localDatabase,
        access,
        handler,
        conflict,
        reflection,
        storageAccess,
        settings,
        services,
        getStorage: () => storage,
        setStorage: (file: UXFileInfo) => {
            storage = file;
        },
    };
}

type Device = Awaited<ReturnType<typeof makeDevice>>;

function requiredEnvironment(name: "hostname" | "username" | "password"): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing integration-test environment variable: ${name}`);
    return value;
}

/** Read every non-deleted leaf, including branches which are not the winner. */
async function leaves(db: PouchDB.Database<EntryDoc>) {
    const docs = await db.get(path, { open_revs: "all", revs: true });
    return docs
        .flatMap((result) => ("ok" in result && !result.ok._deleted ? [result.ok] : []))
        .sort((left, right) => left._rev.localeCompare(right._rev));
}

async function revisionContent(device: Device, rev: string) {
    const entry = await device.access.fetchEntry(path, rev, true);
    if (!entry) throw new Error(`Missing content for ${rev}`);
    return readContent(entry);
}

/** Exercise the real CLI dispatcher and conflict operations with the fixture's real DB services. */
async function resolveFromCLI(device: Device, keep: string) {
    const operations = createConflictResolutionOperations({
        events: device.services.events,
        databaseFileAccess: device.access,
        fileHandler: device.handler,
        log: vi.fn(),
    } as unknown as ConflictResolutionOperationsDependencies);
    const context = {
        databasePath: "/fixture",
        vaultPath: "/fixture",
        core: {
            services: {
                context: { standardIo: { writeStdout: vi.fn(), writeStderr: vi.fn() } },
                control: { activated: Promise.resolve() },
                conflict: { resolveByDeletingRevision: operations.resolveByDeletingRevision },
            },
            serviceModules: { databaseFileAccess: device.access, fileHandler: device.handler },
        },
    } as unknown as CLICommandContext;
    await expect(runCommand({ command: "resolve", commandArgs: [path, keep] }, context)).resolves.toBe(true);
}

describe("file provenance across multiple devices and real CouchDB", () => {
    const databases: PouchDB.Database<EntryDoc>[] = [];
    const owners: LiveSyncLocalDB[] = [];
    afterEach(async () => {
        for (const owner of owners.splice(0)) {
            owner.offRemoteChunkFetchedHandler?.();
            await owner.managers.teardownManagers();
        }
        const results = await Promise.allSettled(databases.splice(0).map((db) => db.destroy()));
        for (const result of results) if (result.status === "rejected") throw result.reason;
    });

    /** Replication deliberately precedes file reflection, modelling a delayed storage event. */
    async function conflictedDevices(count: number) {
        const name = `livesync-provenance-${crypto.randomUUID()}`;
        const remote = new PouchDB<EntryDoc>(`${requiredEnvironment("hostname").replace(/\/+$/u, "")}/${name}`, {
            adapter: "http",
            auth: { username: requiredEnvironment("username"), password: requiredEnvironment("password") },
        });
        databases.push(remote);
        await remote.info();
        const devices: Device[] = [];
        for (let i = 0; i < count; i++) {
            const device = await makeDevice(`${name}-${i}`);
            devices.push(device);
            owners.push(device.localDatabase);
            databases.push(device.db);
        }
        const root = await devices[0].access.storeWithBaseRevision(makeFile(old), undefined, true);
        if (!root) throw new Error("Could not create the shared original revision");
        await devices[0].db.replicate.to(remote);
        const revisions: string[] = [];
        for (const [index, device] of devices.entries()) {
            await device.db.replicate.from(remote);
            device.reflection.set(path, { revision: root });
            // All devices edit while disconnected. Equal mtimes rule out timestamp-based detection.
            device.setStorage(makeFile(`Edited on device ${index}\n`));
            await expect(device.handler.storeFileToDB(path)).resolves.toBe(true);
            revisions.push((await device.db.get(path))._rev);
        }
        // Reverse upload order so the fixture does not rely on the first writer winning.
        for (const device of [...devices].reverse()) await device.db.replicate.to(remote);
        for (const device of devices) {
            await device.db.replicate.from(remote);
            expect((await leaves(device.db)).map((doc) => doc._rev)).toEqual([...revisions].sort());
            expect(await Promise.all(revisions.map((rev) => revisionContent(device, rev)))).toEqual(
                devices.map((_, index) => `Edited on device ${index}\n`)
            );
        }
        expect(await leaves(remote)).toHaveLength(count);
        return { devices, remote, root, revisions };
    }

    async function resolveAndReplicate(f: Awaited<ReturnType<typeof conflictedDevices>>) {
        const winner = (await f.devices[0].db.get(path))._rev;
        const keepIndex = f.revisions.findIndex((rev) => rev !== winner);
        const keep = f.revisions[keepIndex];
        const content = await revisionContent(f.devices[0], keep);
        await resolveFromCLI(f.devices[0], keep);
        expect((await leaves(f.devices[0].db)).map((doc) => doc._rev)).toEqual([keep]);
        expect(await f.devices[0].getStorage().body.text()).toBe(content);
        expect(f.devices[0].reflection.get(path)?.revision).toBe(keep);
        await f.devices[0].db.replicate.to(f.remote);
        for (const device of f.devices) await device.db.replicate.from(f.remote);
        return { keep, content };
    }

    it.each([3, 4])(
        "does not resurrect unchanged files before or after CLI resolution with %i editing devices",
        async (count) => {
            const f = await conflictedDevices(count);
            for (const [index, device] of f.devices.entries()) {
                const before = (await device.db.info()).update_seq;
                await expect(device.handler.storeFileToDB(path)).resolves.toBe(true);
                expect((await device.db.info()).update_seq).toBe(before);
                expect(await device.getStorage().body.text()).toBe(`Edited on device ${index}\n`);
                expect(device.conflict.queueCheckFor).toHaveBeenCalled();
            }
            const { keep, content } = await resolveAndReplicate(f);
            for (const device of f.devices) {
                const before = (await device.db.info()).update_seq;
                await expect(device.handler.storeFileToDB(path)).resolves.toBe(true);
                expect((await device.db.info()).update_seq).toBe(before);
                expect(await device.getStorage().body.text()).toBe(content);
                expect(device.reflection.get(path)?.revision).toBe(keep);
                await device.db.replicate.to(f.remote);
            }
            for (const device of f.devices) {
                await device.db.replicate.from(f.remote);
                expect((await leaves(device.db)).map((doc) => doc._rev)).toEqual([keep]);
            }
            expect((await leaves(f.remote)).map((doc) => doc._rev)).toEqual([keep]);
        },
        60_000
    );

    it("preserves a real edit made on a losing device after three-way resolution", async () => {
        const f = await conflictedDevices(3);
        const { keep, content } = await resolveAndReplicate(f);
        const index = f.revisions.findIndex((rev, i) => i > 0 && rev !== keep);
        const device = f.devices[index];
        const edit = `${await device.getStorage().body.text()}A further offline edit\n`;
        device.setStorage(makeFile(edit));
        await expect(device.handler.storeFileToDB(path)).resolves.toBe(true);
        const editedRevision = device.reflection.get(path)!.revision;
        const edited = await device.db.get(path, { rev: editedRevision, revs: true });
        expect(edited._revisions?.ids[1]).toBe(f.revisions[index].split("-")[1]);
        await device.db.replicate.to(f.remote);
        for (const peer of f.devices) {
            await peer.db.replicate.from(f.remote);
            expect((await leaves(peer.db)).map((doc) => doc._rev)).toEqual([keep, editedRevision].sort());
            expect(await revisionContent(peer, keep)).toBe(content);
            expect(await revisionContent(peer, editedRevision)).toBe(edit);
        }
    }, 60_000);

    it.each(["missing record", "compacted base"] as const)(
        "preserves uncertain storage as one independent conflict with four devices: %s",
        async (reason) => {
            const f = await conflictedDevices(4);
            const { keep, content } = await resolveAndReplicate(f);
            const index = f.revisions.findIndex((rev, i) => i > 0 && rev !== keep);
            const device = f.devices[index];
            if (reason === "missing record") {
                device.reflection.delete(path);
                // Matching an old ancestor must not be mistaken for an unchanged current branch.
                device.setStorage(makeFile(old));
            } else {
                await device.db.compact();
                await expect(device.db.get(path, { rev: f.revisions[index] })).rejects.toMatchObject({ status: 404 });
            }
            const uncertainContent = await device.getStorage().body.text();
            await expect(device.handler.storeFileToDB(path)).resolves.toBe(true);
            const independent = device.reflection.get(path)!.revision;
            expect(independent).toMatch(/^1-/u);
            expect(independent).not.toBe(f.root);
            expect((await device.db.get(path, { rev: independent, revs: true }))._revisions?.ids).toHaveLength(1);
            const before = (await device.db.info()).update_seq;
            device.reflection.delete(path);
            await expect(device.handler.storeFileToDB(path)).resolves.toBe(true);
            await expect(device.handler.storeFileToDB(path)).resolves.toBe(true);
            expect((await device.db.info()).update_seq).toBe(before);
            await device.db.replicate.to(f.remote);
            for (const peer of f.devices) {
                await peer.db.replicate.from(f.remote);
                expect((await leaves(peer.db)).map((doc) => doc._rev)).toEqual([keep, independent].sort());
                expect(await revisionContent(peer, keep)).toBe(content);
                expect(await revisionContent(peer, independent)).toBe(uncertainContent);
            }
            // The CLI must also accept the independent root as the selected conflict.
            await resolveFromCLI(f.devices[0], independent);
            await f.devices[0].db.replicate.to(f.remote);
            for (const peer of f.devices) {
                await peer.db.replicate.from(f.remote);
                expect((await leaves(peer.db)).map((doc) => doc._rev)).toEqual([independent]);
            }
            expect(await f.devices[0].getStorage().body.text()).toBe(uncertainContent);
        },
        60_000
    );
});
