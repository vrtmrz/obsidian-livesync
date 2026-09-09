import { describe, expect, it, vi } from "vitest";
import {
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type MetaEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

import { loadHiddenFileSyncBaseEntry, loadLiveHiddenFileSyncRevision } from "./hiddenFileSyncDatabaseLoaders.ts";

const path = ".obsidian/app.json" as FilePath;
const prefixedPath = `i:${path}` as FilePathWithPrefix;
const id = "hidden-entry-id" as DocumentID;

function loadedEntry(): LoadedEntry {
    return {
        _id: id,
        _rev: "1-a",
        path: prefixedPath,
        type: "plain",
        datatype: "plain",
        data: "content",
        ctime: 10,
        mtime: 20,
        size: 7,
        children: [],
        eden: {},
        deleted: false,
    } as LoadedEntry;
}

function createBaseEntryDependencies() {
    const getDBEntry = vi.fn();
    const getDBEntryMeta = vi.fn();
    const path2id = vi.fn(async () => id);
    const log = vi.fn();
    const dependencies = {
        getLocalDatabase: () => ({ getDBEntry, getDBEntryMeta }) as never,
        path: { path2id } as never,
        log,
    };
    return { dependencies, getDBEntry, getDBEntryMeta, log, path2id };
}

function metaEntry(revision: string): MetaEntry {
    return {
        ...loadedEntry(),
        _rev: revision,
        data: undefined,
    } as unknown as MetaEntry;
}

function createLiveRevisionDependencies() {
    const selected = metaEntry("2-selected");
    const current = metaEntry("3-current");
    const fetchEntryMeta = vi.fn(async (_path: unknown, revision?: string) => {
        if (revision === undefined || revision === current._rev) return current;
        if (revision === selected._rev) return selected;
        return false;
    });
    const getConflictedRevs = vi.fn(async () => [selected._rev!]);
    const log = vi.fn();
    const dependencies = {
        databaseFileAccess: { fetchEntryMeta, getConflictedRevs } as never,
        log,
    };
    return { current, dependencies, fetchEntryMeta, getConflictedRevs, log, selected };
}

describe("Hidden File Sync base-entry loader", () => {
    it("synthesises a new empty base whenever the content lookup reports false", async () => {
        const { dependencies, getDBEntry, path2id } = createBaseEntryDependencies();
        getDBEntry.mockResolvedValue(false);

        await expect(loadHiddenFileSyncBaseEntry(dependencies, path)).resolves.toEqual({
            _id: id,
            data: [],
            path: prefixedPath,
            mtime: 0,
            ctime: 0,
            datatype: "newnote",
            children: [],
            size: 0,
            deleted: false,
            type: "newnote",
            eden: {},
        });
        expect(path2id).toHaveBeenCalledWith(prefixedPath, "i:");
        expect(getDBEntry).toHaveBeenCalledWith(prefixedPath, undefined, false, true);
    });

    it("returns an existing content entry unchanged", async () => {
        const { dependencies, getDBEntry, path2id } = createBaseEntryDependencies();
        const existing = loadedEntry();
        getDBEntry.mockResolvedValue(existing);

        await expect(loadHiddenFileSyncBaseEntry(dependencies, path, true)).resolves.toBe(existing);
        expect(path2id).toHaveBeenCalledWith(prefixedPath, "i:");
    });

    it("uses the conflict-aware metadata lookup when content is not requested", async () => {
        const { dependencies, getDBEntry, getDBEntryMeta } = createBaseEntryDependencies();
        const existing = loadedEntry();
        getDBEntryMeta.mockResolvedValue(existing);

        await expect(loadHiddenFileSyncBaseEntry(dependencies, path, false)).resolves.toBe(existing);
        expect(getDBEntry).not.toHaveBeenCalled();
        expect(getDBEntryMeta).toHaveBeenCalledWith(prefixedPath, { conflicts: true }, true);
    });

    it("turns a database lookup failure into a logged false result", async () => {
        const { dependencies, getDBEntry, log } = createBaseEntryDependencies();
        const error = new Error("database unavailable");
        getDBEntry.mockRejectedValue(error);

        await expect(loadHiddenFileSyncBaseEntry(dependencies, path)).resolves.toBe(false);
        expect(log).toHaveBeenNthCalledWith(1, "Getting base save data failed", undefined, undefined);
        expect(log).toHaveBeenNthCalledWith(2, error, LOG_LEVEL_VERBOSE, undefined);
    });

    it("propagates path-to-ID failures which occur before the guarded lookup", async () => {
        const { dependencies, getDBEntry, log, path2id } = createBaseEntryDependencies();
        const error = new Error("ID conversion failed");
        path2id.mockRejectedValue(error);

        await expect(loadHiddenFileSyncBaseEntry(dependencies, path)).rejects.toBe(error);
        expect(getDBEntry).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });
});

describe("Hidden File Sync live-revision loader", () => {
    it("accepts the current winning revision", async () => {
        const { current, dependencies, fetchEntryMeta, getConflictedRevs } = createLiveRevisionDependencies();

        await expect(loadLiveHiddenFileSyncRevision(dependencies, prefixedPath, current._rev!)).resolves.toBe(current);
        expect(fetchEntryMeta).toHaveBeenNthCalledWith(1, prefixedPath, current._rev, true);
        expect(fetchEntryMeta).toHaveBeenNthCalledWith(2, prefixedPath, undefined, true);
        expect(getConflictedRevs).toHaveBeenCalledWith(prefixedPath);
    });

    it("accepts a selected conflict leaf while it remains live", async () => {
        const { dependencies, selected } = createLiveRevisionDependencies();

        await expect(loadLiveHiddenFileSyncRevision(dependencies, prefixedPath, selected._rev!)).resolves.toBe(
            selected
        );
    });

    it("accepts a live conflict even when there is no current winner", async () => {
        const { dependencies, fetchEntryMeta, selected } = createLiveRevisionDependencies();
        fetchEntryMeta.mockImplementation(async (_path: unknown, revision?: string) =>
            revision === selected._rev ? selected : false
        );

        await expect(loadLiveHiddenFileSyncRevision(dependencies, prefixedPath, selected._rev!)).resolves.toBe(
            selected
        );
    });

    it("accepts deleted metadata while its revision remains live", async () => {
        const { dependencies, fetchEntryMeta, selected } = createLiveRevisionDependencies();
        const deleted = { ...selected, deleted: true } as MetaEntry;
        fetchEntryMeta.mockImplementation(async (_path: unknown, revision?: string) =>
            revision === undefined ? metaEntry("3-current") : deleted
        );

        await expect(loadLiveHiddenFileSyncRevision(dependencies, prefixedPath, selected._rev!)).resolves.toBe(deleted);
    });

    it("rejects a selected revision which is no longer current or conflicted", async () => {
        const { dependencies, getConflictedRevs, log, selected } = createLiveRevisionDependencies();
        getConflictedRevs.mockResolvedValue([]);

        await expect(loadLiveHiddenFileSyncRevision(dependencies, prefixedPath, selected._rev!)).resolves.toBe(false);
        expect(log).toHaveBeenCalledWith(
            `Could not use hidden-file revision ${selected._rev} of ${path}; the selected revision is no longer live`,
            LOG_LEVEL_NOTICE,
            undefined
        );
    });

    it("rejects a lookup result whose revision does not match the selection", async () => {
        const { dependencies, fetchEntryMeta, log, selected } = createLiveRevisionDependencies();
        fetchEntryMeta.mockResolvedValue(metaEntry("2-other"));

        await expect(loadLiveHiddenFileSyncRevision(dependencies, prefixedPath, selected._rev!)).resolves.toBe(false);
        expect(log).toHaveBeenCalledOnce();
    });

    it("propagates database-file-access failures", async () => {
        const { dependencies, fetchEntryMeta, log, selected } = createLiveRevisionDependencies();
        const error = new Error("revision lookup failed");
        fetchEntryMeta.mockRejectedValue(error);

        await expect(loadLiveHiddenFileSyncRevision(dependencies, prefixedPath, selected._rev!)).rejects.toBe(error);
        expect(log).not.toHaveBeenCalled();
    });
});
