import { describe, expect, it, vi } from "vitest";
import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type MetaEntry,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { HiddenFileSyncRemovalResult } from "./hiddenFileSyncStorage.ts";

vi.mock("@/deps.ts", () => ({}));

import {
    createHiddenFileSyncDatabaseExtractionOperations,
    extractHiddenFileFromDatabase,
    extractHiddenFileRevisionFromDatabase,
    type HiddenFileSyncDatabaseExtractionDependencies,
} from "./hiddenFileSyncDatabaseExtractionOperations.ts";
import { toHiddenFileSyncDatabaseStateKey } from "./hiddenFileSyncState.ts";

const path = ".obsidian/plugins/example/data.json" as FilePath;
const prefixedPath = `i:${path}` as FilePathWithPrefix;
const id = "hidden-entry-id" as DocumentID;

function metadata(overrides: Partial<MetaEntry> = {}): MetaEntry {
    return {
        _id: id,
        _rev: "2-current",
        path: prefixedPath,
        type: "plain",
        datatype: "plain",
        ctime: 10,
        mtime: 20,
        size: 20,
        children: [],
        eden: {},
        deleted: false,
        ...overrides,
    } as unknown as MetaEntry;
}

function loadedEntry(entry = metadata()): LoadedEntry {
    return {
        ...entry,
        data: '{"value":"database"}',
    } as LoadedEntry;
}

function storageStat(mtime = 20): UXStat {
    return {
        ctime: 11,
        mtime,
        size: 20,
        type: "file",
    };
}

function createDependencies(entry = metadata()) {
    const events: string[] = [];
    const serialiseFileOperation = vi.fn(async (_key: string, operation: () => Promise<unknown>) => {
        events.push("lock:start");
        try {
            return await operation();
        } finally {
            events.push("lock:end");
        }
    });
    const log = vi.fn();
    const isIgnoredByIgnoreFile = vi.fn(async () => false);
    const loadDatabaseMetadata = vi.fn(async () => entry as MetaEntry | false);
    const loadLiveRevision = vi.fn(async (_path: FilePathWithPrefix, revision: string) =>
        revision === entry._rev ? (entry as MetaEntry) : false
    );
    const loadDatabaseEntry = vi.fn(async () => loadedEntry(entry) as LoadedEntry | false);
    const statStorageFile = vi.fn(async () => storageStat() as UXStat | null);
    const writeStorageFile = vi.fn(async () => {
        events.push("storage:write");
        return storageStat(21) as UXStat | false;
    });
    const deleteStorageFile = vi.fn(async (): Promise<HiddenFileSyncRemovalResult> => {
        events.push("storage:delete");
        return "OK" as const;
    });
    const getLastProcessedDatabaseKey = vi.fn(() => undefined as string | undefined);
    const getLastProcessedFileMTime = vi.fn(() => 0);
    const updateLastProcessed = vi.fn(() => events.push("state:file"));
    const updateLastProcessedDatabase = vi.fn(() => events.push("state:database"));
    const updateLastProcessedFile = vi.fn(() => events.push("state:storage"));
    const updateLastProcessedDeletion = vi.fn(() => events.push("state:deletion"));
    const processedState = {
        databaseStateKey: toHiddenFileSyncDatabaseStateKey,
        getLastProcessedDatabaseKey,
        getLastProcessedFileMTime,
        updateLastProcessed,
        updateLastProcessedDatabase,
        updateLastProcessedFile,
        updateLastProcessedDeletion,
    };
    const queueNotification = vi.fn(() => events.push("notification"));
    const dependencies = {
        serialiseFileOperation,
        isIgnoredByIgnoreFile,
        loadDatabaseMetadata,
        loadLiveRevision,
        loadDatabaseEntry,
        statStorageFile,
        writeStorageFile,
        deleteStorageFile,
        processedState,
        queueNotification,
        log,
    } as HiddenFileSyncDatabaseExtractionDependencies;
    return {
        deleteStorageFile,
        dependencies,
        entry,
        events,
        getLastProcessedDatabaseKey,
        getLastProcessedFileMTime,
        isIgnoredByIgnoreFile,
        loadDatabaseEntry,
        loadDatabaseMetadata,
        loadLiveRevision,
        log,
        queueNotification,
        serialiseFileOperation,
        statStorageFile,
        updateLastProcessed,
        updateLastProcessedDatabase,
        updateLastProcessedDeletion,
        updateLastProcessedFile,
        writeStorageFile,
    };
}

describe("hidden-file database-to-storage admission", () => {
    it("returns undefined for an ignored path without taking the file lock", async () => {
        const fixture = createDependencies();
        fixture.isIgnoredByIgnoreFile.mockResolvedValue(true);

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBeUndefined();

        expect(fixture.serialiseFileOperation).not.toHaveBeenCalled();
        expect(fixture.loadDatabaseMetadata).not.toHaveBeenCalled();
    });

    it("propagates ignore-policy errors before taking the guarded path", async () => {
        const fixture = createDependencies();
        const error = new Error("ignore policy unavailable");
        fixture.isIgnoredByIgnoreFile.mockRejectedValue(error);

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path)).rejects.toBe(error);

        expect(fixture.serialiseFileOperation).not.toHaveBeenCalled();
        expect(fixture.log).not.toHaveBeenCalled();
    });

    it("prevents a conflicted entry from reaching storage", async () => {
        const entry = metadata({ _conflicts: ["2-conflict"] });
        const fixture = createDependencies(entry);

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path, { force: true })).resolves.toBe(false);

        expect(fixture.loadDatabaseEntry).not.toHaveBeenCalled();
        expect(fixture.writeStorageFile).not.toHaveBeenCalled();
        expect(fixture.log).toHaveBeenCalledWith(
            `Hidden file ${path} has conflicted revisions, to keep in safe, writing to storage has been prevented`,
            LOG_LEVEL_INFO,
            undefined
        );
    });
});

describe("hidden-file database-to-storage processed-state policy", () => {
    it("skips a previously processed revision without settling state again", async () => {
        const fixture = createDependencies();
        fixture.getLastProcessedDatabaseKey.mockReturnValue(toHiddenFileSyncDatabaseStateKey(fixture.entry));

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBeUndefined();

        expect(fixture.loadDatabaseEntry).not.toHaveBeenCalled();
        expect(fixture.updateLastProcessed).not.toHaveBeenCalled();
        expect(fixture.log).toHaveBeenCalledWith(
            `STORAGE <-- DB: ${path}: skipped (hidden, overwrite) (Previously processed)`,
            undefined,
            undefined
        );
    });

    it("allows force to bypass the previously processed revision", async () => {
        const fixture = createDependencies();
        fixture.getLastProcessedDatabaseKey.mockReturnValue(toHiddenFileSyncDatabaseStateKey(fixture.entry));

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path, { force: true })).resolves.toBe(true);

        expect(fixture.writeStorageFile).toHaveBeenCalledWith(path, loadedEntry(fixture.entry), true);
    });

    it("settles both sides when onlyNew declines an equally old database entry", async () => {
        const fixture = createDependencies();

        await expect(
            extractHiddenFileFromDatabase(fixture.dependencies, path, {
                metaEntry: fixture.entry,
                preventDoubleProcess: false,
                onlyNew: true,
            })
        ).resolves.toBeUndefined();

        expect(fixture.loadDatabaseMetadata).not.toHaveBeenCalled();
        expect(fixture.loadDatabaseEntry).not.toHaveBeenCalled();
        expect(fixture.updateLastProcessedDatabase).toHaveBeenCalledWith(path, fixture.entry);
        expect(fixture.updateLastProcessedFile).toHaveBeenCalledWith(path, storageStat());
        expect(fixture.events).toEqual(["lock:start", "state:database", "state:storage", "lock:end"]);
    });

    it("uses the last known mtime when onlyNew sees a zero storage mtime", async () => {
        const fixture = createDependencies(metadata({ mtime: 30 }));
        fixture.statStorageFile.mockResolvedValue(storageStat(0));
        fixture.getLastProcessedFileMTime.mockReturnValue(40);

        await expect(
            extractHiddenFileFromDatabase(fixture.dependencies, path, { onlyNew: true })
        ).resolves.toBeUndefined();

        expect(fixture.getLastProcessedFileMTime).toHaveBeenCalledWith(path);
        expect(fixture.writeStorageFile).not.toHaveBeenCalled();
    });
});

describe("hidden-file database-to-storage application", () => {
    it("settles state and queues a notification inside the file lock after a successful write", async () => {
        const fixture = createDependencies();

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBe(true);

        expect(fixture.updateLastProcessed).toHaveBeenCalledWith(path, fixture.entry, storageStat(21));
        expect(fixture.queueNotification).toHaveBeenCalledWith(path);
        expect(fixture.serialiseFileOperation).toHaveBeenCalledWith(`file-${prefixedPath}`, expect.any(Function));
        expect(fixture.events).toEqual(["lock:start", "storage:write", "state:file", "notification", "lock:end"]);
    });

    it("settles and notifies when the storage writer reports unchanged content with its existing stat", async () => {
        const fixture = createDependencies();
        fixture.writeStorageFile.mockResolvedValue(storageStat());

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBe(true);

        expect(fixture.updateLastProcessed).toHaveBeenCalledWith(path, fixture.entry, storageStat());
        expect(fixture.queueNotification).toHaveBeenCalledWith(path);
    });

    it("returns false without settlement when the storage writer fails", async () => {
        const fixture = createDependencies();
        fixture.writeStorageFile.mockResolvedValue(false);

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBe(false);

        expect(fixture.updateLastProcessed).not.toHaveBeenCalled();
        expect(fixture.queueNotification).not.toHaveBeenCalled();
    });

    it("records a successful storage deletion through deletion settlement", async () => {
        const entry = metadata({ deleted: true });
        const fixture = createDependencies(entry);

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBe(true);

        expect(fixture.updateLastProcessedDeletion).toHaveBeenCalledWith(path, entry);
        expect(fixture.updateLastProcessedDatabase).not.toHaveBeenCalled();
        expect(fixture.events).toEqual(["lock:start", "storage:delete", "state:deletion", "lock:end"]);
    });

    it("marks an already absent deleted file as database-processed only", async () => {
        const entry = metadata({ deleted: true });
        const fixture = createDependencies(entry);
        fixture.deleteStorageFile.mockImplementation(async () => {
            fixture.events.push("storage:delete");
            return "ALREADY";
        });

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBe(true);

        expect(fixture.updateLastProcessedDatabase).toHaveBeenCalledWith(path, entry);
        expect(fixture.updateLastProcessedDeletion).not.toHaveBeenCalled();
        expect(fixture.events).toEqual(["lock:start", "storage:delete", "state:database", "lock:end"]);
    });

    it("returns false without settling state when a storage deletion fails", async () => {
        const fixture = createDependencies(metadata({ _deleted: true }));
        fixture.deleteStorageFile.mockResolvedValue(false);

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBe(false);

        expect(fixture.updateLastProcessedDeletion).not.toHaveBeenCalled();
        expect(fixture.updateLastProcessedDatabase).not.toHaveBeenCalled();
    });

    it("turns a database content-read failure into false and reports the inherited write diagnostic", async () => {
        const fixture = createDependencies();
        const error = new Error("content unavailable");
        fixture.loadDatabaseEntry.mockRejectedValue(error);

        await expect(extractHiddenFileFromDatabase(fixture.dependencies, path, { force: true })).resolves.toBe(false);

        expect(fixture.log).toHaveBeenNthCalledWith(
            1,
            `STORAGE <-- DB: ${path}: written (hidden, overwrite, force) Failed`,
            undefined,
            undefined
        );
        expect(fixture.log).toHaveBeenNthCalledWith(2, error, LOG_LEVEL_VERBOSE, undefined);
    });
});

describe("selected-revision hidden-file database-to-storage application", () => {
    it("applies a selected live revision without reading ordinary Metadata", async () => {
        const fixture = createDependencies();

        await expect(
            extractHiddenFileRevisionFromDatabase(fixture.dependencies, path, fixture.entry._rev!, true)
        ).resolves.toBe(true);

        expect(fixture.loadLiveRevision).toHaveBeenCalledWith(prefixedPath, fixture.entry._rev);
        expect(fixture.loadDatabaseMetadata).not.toHaveBeenCalled();
        expect(fixture.writeStorageFile).toHaveBeenCalledWith(path, loadedEntry(fixture.entry), true);
    });

    it("can apply a selected live branch while ordinary Metadata reports a conflict", async () => {
        const selected = metadata({ _rev: "2-selected", _conflicts: undefined });
        const fixture = createDependencies(metadata({ _rev: "3-winner", _conflicts: [selected._rev!] }));
        fixture.loadLiveRevision.mockResolvedValue(selected);
        fixture.loadDatabaseEntry.mockResolvedValue(loadedEntry(selected));

        await expect(
            extractHiddenFileRevisionFromDatabase(fixture.dependencies, path, selected._rev!, true)
        ).resolves.toBe(true);

        expect(fixture.loadDatabaseMetadata).not.toHaveBeenCalled();
        expect(fixture.writeStorageFile).toHaveBeenCalledWith(path, loadedEntry(selected), true);
    });

    it("returns false when the selected revision ceased to be live", async () => {
        const fixture = createDependencies();
        fixture.loadLiveRevision.mockResolvedValue(false);

        await expect(extractHiddenFileRevisionFromDatabase(fixture.dependencies, path, "2-stale", true)).resolves.toBe(
            false
        );

        expect(fixture.loadDatabaseEntry).not.toHaveBeenCalled();
        expect(fixture.writeStorageFile).not.toHaveBeenCalled();
    });

    it("exposes frozen operations with the exact-revision Boolean contract", async () => {
        const fixture = createDependencies();
        fixture.isIgnoredByIgnoreFile.mockResolvedValue(true);
        const operations = createHiddenFileSyncDatabaseExtractionOperations(fixture.dependencies);

        expect(Object.isFrozen(operations)).toBe(true);
        await expect(operations.extractRevision(path, fixture.entry._rev!)).resolves.toBe(false);
    });
});
