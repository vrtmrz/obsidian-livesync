import { describe, expect, it, vi } from "vitest";
import {
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type MetaEntry,
    type UXFileInfo,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

import {
    deleteHiddenFileFromDatabase,
    storeHiddenFileInDatabase,
    storeHiddenFileWithBaseRevision,
    type HiddenFileSyncDatabaseWriteDependencies,
} from "./hiddenFileSyncDatabaseWriteOperations.ts";

const path = ".obsidian/plugins/example/data.json" as FilePath;
const prefixedPath = `i:${path}` as FilePathWithPrefix;
const id = "hidden-entry-id" as DocumentID;

function fileInfo(content = '{"value":"vault"}'): UXFileInfo {
    return {
        path,
        name: "data.json",
        isInternal: true,
        body: new Blob([content]),
        stat: {
            ctime: 41,
            mtime: 42,
            size: content.length,
            type: "file",
        },
        deleted: false,
    } as UXFileInfo;
}

function loadedEntry(overrides: Partial<LoadedEntry> = {}): LoadedEntry {
    return {
        _id: id,
        _rev: "2-current",
        path: prefixedPath,
        type: "plain",
        datatype: "plain",
        data: '{"value":"database"}',
        ctime: 10,
        mtime: 20,
        size: 20,
        children: [],
        eden: {},
        deleted: false,
        ...overrides,
    } as LoadedEntry;
}

function createDependencies(base = loadedEntry()) {
    const events: string[] = [];
    const serialiseFileOperation = vi.fn(async (_key: string, operation: () => Promise<unknown>) => {
        events.push("lock:start");
        try {
            return await operation();
        } finally {
            events.push("lock:end");
        }
    });
    const isIgnoredByIgnoreFile = vi.fn(async () => false);
    const readFileWithInfo = vi.fn(async () => fileInfo());
    const loadBaseEntry = vi.fn(async () => base as LoadedEntry | false);
    const loadBaseMetadata = vi.fn(async () => base as LoadedEntry | false);
    const loadLiveRevision = vi.fn(async (_path: FilePathWithPrefix, revision: string) =>
        revision === base._rev ? (base as MetaEntry) : false
    );
    const fetchEntryFromMeta = vi.fn(async () => base as LoadedEntry | false);
    const storeWithBaseRevision = vi.fn(async () => "3-selected-child" as string | false);
    const putDatabaseEntry = vi.fn(async (_entry: unknown) => ({ ok: true, id, rev: "3-written" }));
    const putRaw = vi.fn(async (_entry: LoadedEntry) => ({ ok: true, id, rev: "3-deleted" }));
    const removeRevision = vi.fn(async () => true);
    const updateLastProcessed = vi.fn(() => events.push("state:file"));
    const updateLastProcessedDeletion = vi.fn(() => events.push("state:deletion"));
    const processedState = {
        updateLastProcessed,
        updateLastProcessedDeletion,
    };
    const now = vi.fn(() => 1_000);
    const log = vi.fn();
    const dependencies = {
        serialiseFileOperation,
        isIgnoredByIgnoreFile,
        readFileWithInfo,
        loadBaseEntry,
        loadBaseMetadata,
        loadLiveRevision,
        fetchEntryFromMeta,
        storeWithBaseRevision,
        putDatabaseEntry,
        putRaw,
        removeRevision,
        processedState,
        now,
        log,
    } as unknown as HiddenFileSyncDatabaseWriteDependencies;
    return {
        base,
        dependencies,
        events,
        fetchEntryFromMeta,
        isIgnoredByIgnoreFile,
        loadBaseEntry,
        loadBaseMetadata,
        loadLiveRevision,
        log,
        now,
        putDatabaseEntry,
        putRaw,
        readFileWithInfo,
        removeRevision,
        serialiseFileOperation,
        storeWithBaseRevision,
        updateLastProcessed,
        updateLastProcessedDeletion,
    };
}

describe("ordinary hidden-file database writes", () => {
    it("keeps the synthetic base ctime and settles the new revision inside the file lock", async () => {
        const base = loadedEntry({
            _rev: undefined,
            ctime: 0,
            data: [],
            datatype: "newnote",
            type: "newnote",
        });
        const fixture = createDependencies(base);
        const file = fileInfo();

        await expect(storeHiddenFileInDatabase(fixture.dependencies, file)).resolves.toBe(true);

        expect(fixture.putDatabaseEntry).toHaveBeenCalledWith(
            expect.objectContaining({ ctime: 0, mtime: file.stat.mtime, data: file.body })
        );
        expect(fixture.updateLastProcessed).toHaveBeenCalledWith(
            path,
            expect.objectContaining({ _rev: "3-written", ctime: 0 }),
            file.stat
        );
        expect(fixture.serialiseFileOperation).toHaveBeenCalledWith(`file-${prefixedPath}`, expect.any(Function));
        expect(fixture.events).toEqual(["lock:start", "state:file", "lock:end"]);
    });

    it("settles matching content without writing or emitting a transfer log", async () => {
        const base = loadedEntry({ data: '{"value":"vault"}' });
        const fixture = createDependencies(base);
        const file = fileInfo();

        await expect(storeHiddenFileInDatabase(fixture.dependencies, file)).resolves.toBeUndefined();

        expect(fixture.putDatabaseEntry).not.toHaveBeenCalled();
        expect(fixture.updateLastProcessed).toHaveBeenCalledWith(path, base, file.stat);
        expect(fixture.log).not.toHaveBeenCalled();
    });

    it("writes matching content when forceWrite is enabled", async () => {
        const fixture = createDependencies(loadedEntry({ data: '{"value":"vault"}' }));

        await expect(storeHiddenFileInDatabase(fixture.dependencies, fileInfo(), true)).resolves.toBe(true);

        expect(fixture.putDatabaseEntry).toHaveBeenCalledOnce();
    });

    it("returns false and reports both messages when a guarded write fails", async () => {
        const fixture = createDependencies();
        const error = new Error("storage read failed");
        fixture.readFileWithInfo.mockRejectedValue(error);

        await expect(
            storeHiddenFileInDatabase(fixture.dependencies, {
                path,
                ctime: 1,
                mtime: 2,
                size: 3,
            })
        ).resolves.toBe(false);

        expect(fixture.log).toHaveBeenNthCalledWith(1, `STORAGE --> DB:${path}: (hidden) Failed`, undefined, undefined);
        expect(fixture.log).toHaveBeenNthCalledWith(2, error, LOG_LEVEL_VERBOSE, undefined);
    });
});

describe("selected-revision hidden-file database writes", () => {
    it("stores the Vault content as a child of a selected live revision", async () => {
        const fixture = createDependencies();
        const file = fileInfo();

        await expect(storeHiddenFileWithBaseRevision(fixture.dependencies, file, fixture.base._rev!)).resolves.toBe(
            true
        );

        expect(fixture.storeWithBaseRevision).toHaveBeenCalledWith(
            expect.objectContaining({ path, body: file.body, isInternal: true }),
            fixture.base._rev,
            true
        );
        expect(fixture.updateLastProcessed).toHaveBeenCalledWith(
            path,
            expect.objectContaining({ _rev: "3-selected-child" }),
            file.stat
        );
    });

    it("validates liveness before reading storage and refuses a stale revision", async () => {
        const fixture = createDependencies();
        fixture.loadLiveRevision.mockResolvedValue(false);

        await expect(
            storeHiddenFileWithBaseRevision(fixture.dependencies, { path, ctime: 1, mtime: 2, size: 3 }, "2-stale")
        ).resolves.toBe(false);

        expect(fixture.readFileWithInfo).not.toHaveBeenCalled();
        expect(fixture.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(fixture.updateLastProcessed).not.toHaveBeenCalled();
    });

    it("marks matching content without creating a child", async () => {
        const base = loadedEntry({ data: '{"value":"vault"}' });
        const fixture = createDependencies(base);
        const file = fileInfo();

        await expect(storeHiddenFileWithBaseRevision(fixture.dependencies, file, base._rev!, false)).resolves.toBe(
            true
        );

        expect(fixture.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(fixture.updateLastProcessed).toHaveBeenCalledWith(path, base, file.stat);
    });

    it("reports differing content without creating a child when requested", async () => {
        const fixture = createDependencies();

        await expect(
            storeHiddenFileWithBaseRevision(fixture.dependencies, fileInfo(), fixture.base._rev!, false)
        ).resolves.toBe(false);

        expect(fixture.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(fixture.updateLastProcessed).not.toHaveBeenCalled();
        expect(fixture.log).toHaveBeenCalledWith(
            `Could not mark hidden file ${path} as revision ${fixture.base._rev}; the storage content differs`,
            LOG_LEVEL_NOTICE,
            undefined
        );
    });

    it("keeps a selected branch's _deleted marker in the processed-state entry", async () => {
        const base = loadedEntry({ deleted: true, _deleted: true });
        const fixture = createDependencies(base);
        const file = fileInfo();

        await expect(storeHiddenFileWithBaseRevision(fixture.dependencies, file, base._rev!)).resolves.toBe(true);

        expect(fixture.fetchEntryFromMeta).not.toHaveBeenCalled();
        expect(fixture.updateLastProcessed).toHaveBeenCalledWith(
            path,
            expect.objectContaining({ _rev: "3-selected-child", deleted: false, _deleted: true }),
            file.stat
        );
    });
});

describe("hidden-file database deletions", () => {
    it("removes conflicts before accepting an already deleted entry", async () => {
        const base = loadedEntry({ deleted: true, _conflicts: ["2-conflict"] });
        const fixture = createDependencies(base);

        await expect(deleteHiddenFileFromDatabase(fixture.dependencies, path, true)).resolves.toBe(true);

        expect(fixture.removeRevision).toHaveBeenCalledWith(id, "2-conflict");
        expect(fixture.putRaw).not.toHaveBeenCalled();
        expect(fixture.updateLastProcessedDeletion).toHaveBeenCalledWith(path, base);
    });

    it("writes a deletion when only the PouchDB _deleted marker is present", async () => {
        const base = loadedEntry({ deleted: false, _deleted: true });
        const fixture = createDependencies(base);

        await expect(deleteHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBe(true);

        expect(fixture.putRaw).toHaveBeenCalledWith(expect.objectContaining({ deleted: true, _deleted: true }));
        expect(fixture.updateLastProcessedDeletion).toHaveBeenCalledWith(
            path,
            expect.objectContaining({ _rev: "3-deleted" })
        );
    });

    it("writes a tombstone for a synthetic base without a revision", async () => {
        const base = loadedEntry({ _rev: undefined, data: [], datatype: "newnote", type: "newnote" });
        const fixture = createDependencies(base);
        let submitted: LoadedEntry | undefined;
        fixture.putRaw.mockImplementation(async (entry: LoadedEntry) => {
            submitted = { ...entry };
            return { ok: true, id, rev: "3-deleted" };
        });

        await expect(deleteHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBe(true);

        expect(submitted).toEqual(expect.objectContaining({ _rev: undefined, deleted: true, type: "newnote" }));
    });

    it("keeps earlier conflict removals when a later removal fails", async () => {
        const base = loadedEntry({ _conflicts: ["2-first", "2-second"] });
        const fixture = createDependencies(base);
        const error = new Error("second removal failed");
        fixture.removeRevision.mockResolvedValueOnce(true).mockRejectedValueOnce(error);

        await expect(deleteHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBe(false);

        expect(fixture.removeRevision.mock.calls).toEqual([
            [id, "2-first"],
            [id, "2-second"],
        ]);
        expect(fixture.putRaw).not.toHaveBeenCalled();
        expect(fixture.updateLastProcessedDeletion).not.toHaveBeenCalled();
        expect(fixture.log).toHaveBeenLastCalledWith(error, LOG_LEVEL_VERBOSE, undefined);
    });

    it("captures the deletion time before evaluating ignore policy", async () => {
        const fixture = createDependencies();
        const events: string[] = [];
        fixture.now.mockImplementation(() => {
            events.push("now");
            return 1_000;
        });
        fixture.isIgnoredByIgnoreFile.mockImplementation(async () => {
            events.push("ignore");
            return true;
        });

        await expect(deleteHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBeUndefined();

        expect(events).toEqual(["now", "ignore"]);
        expect(fixture.serialiseFileOperation).not.toHaveBeenCalled();
    });
});

describe("hidden-file database write admission", () => {
    it("preserves the different ignored results of the three write paths", async () => {
        const fixture = createDependencies();
        fixture.isIgnoredByIgnoreFile.mockResolvedValue(true);
        const file = fileInfo();

        await expect(storeHiddenFileInDatabase(fixture.dependencies, file)).resolves.toBeUndefined();
        await expect(storeHiddenFileWithBaseRevision(fixture.dependencies, file, fixture.base._rev!)).resolves.toBe(
            false
        );
        await expect(deleteHiddenFileFromDatabase(fixture.dependencies, path)).resolves.toBeUndefined();

        expect(fixture.loadBaseEntry).not.toHaveBeenCalled();
        expect(fixture.loadBaseMetadata).not.toHaveBeenCalled();
        expect(fixture.loadLiveRevision).not.toHaveBeenCalled();
    });

    it("propagates ignore-policy failures before entering the guarded lock", async () => {
        const fixture = createDependencies();
        const error = new Error("ignore policy unavailable");
        fixture.isIgnoredByIgnoreFile.mockRejectedValue(error);

        await expect(storeHiddenFileInDatabase(fixture.dependencies, fileInfo())).rejects.toBe(error);

        expect(fixture.serialiseFileOperation).not.toHaveBeenCalled();
        expect(fixture.log).not.toHaveBeenCalled();
    });
});
