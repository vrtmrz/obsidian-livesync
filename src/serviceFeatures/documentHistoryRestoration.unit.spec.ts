import { describe, expect, it, vi } from "vitest";
import type {
    FilePath,
    FilePathWithPrefix,
    LoadedEntry,
    MetaEntry,
    UXFileInfo,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { restoreDocumentHistoryRevision, type DocumentHistoryRestorationCore } from "./documentHistoryRestoration";

const path = "history.md" as FilePathWithPrefix;
const currentPath = "History.md" as FilePathWithPrefix;

function createSource(): LoadedEntry {
    return {
        _id: "f:history",
        _rev: "2-source",
        path,
        ctime: 10,
        mtime: 20,
        size: 18,
        type: "plain",
        datatype: "plain",
        children: ["h:source"],
        data: ["historical content"],
        eden: {},
    } as LoadedEntry;
}

function createCurrent(): MetaEntry {
    return {
        _id: "f:history",
        _rev: "4-deleted",
        path: currentPath,
        ctime: 10,
        mtime: 40,
        size: 18,
        type: "plain",
        children: ["h:current"],
        deleted: true,
        eden: {},
    } as MetaEntry;
}

function createCore(
    overrides: {
        source?: LoadedEntry | false;
        current?: MetaEntry | false;
        storedRevision?: string | false;
        reflected?: boolean;
        reflectionError?: unknown;
        conflicts?: string[];
        conflictCheckError?: unknown;
    } = {}
) {
    const calls: string[] = [];
    const fetchEntry = vi.fn(async () => {
        calls.push("read-source");
        return overrides.source === undefined ? createSource() : overrides.source;
    });
    const fetchEntryMeta = vi.fn(async () => {
        calls.push("read-current");
        return overrides.current === undefined ? createCurrent() : overrides.current;
    });
    const storeWithLiveBaseRevision = vi.fn(async (_file: UXFileInfo) => {
        calls.push("store");
        return overrides.storedRevision === undefined ? "5-restored" : overrides.storedRevision;
    });
    const getConflictedRevs = vi.fn(async () => {
        calls.push("check-conflicts");
        if (overrides.conflictCheckError !== undefined) {
            throw overrides.conflictCheckError;
        }
        return overrides.conflicts ?? [];
    });
    const dbToStorageWithSpecificRev = vi.fn(async () => {
        calls.push("reflect");
        if (overrides.reflectionError !== undefined) {
            throw overrides.reflectionError;
        }
        return overrides.reflected ?? true;
    });
    const core: DocumentHistoryRestorationCore = {
        databaseFileAccess: {
            fetchEntry,
            fetchEntryMeta,
            getConflictedRevs,
            storeWithLiveBaseRevision,
        },
        fileHandler: {
            dbToStorageWithSpecificRev,
        },
    };
    return {
        calls,
        core,
        dbToStorageWithSpecificRev,
        fetchEntry,
        fetchEntryMeta,
        getConflictedRevs,
        storeWithLiveBaseRevision,
    };
}

describe("restoreDocumentHistoryRevision", () => {
    it("stores historical bytes below the current deleted winner before reflecting the exact new revision", async () => {
        const { calls, core, dbToStorageWithSpecificRev, fetchEntry, fetchEntryMeta, storeWithLiveBaseRevision } =
            createCore();

        await expect(restoreDocumentHistoryRevision(core, path, "2-source", { now: () => 50 })).resolves.toEqual({
            status: "restored",
            path: "History.md" as FilePath,
            revision: "5-restored",
            conflictsRemain: false,
        });

        expect(calls).toEqual(["read-source", "read-current", "store", "reflect", "check-conflicts"]);
        expect(fetchEntry).toHaveBeenCalledWith(path, "2-source", true, true);
        expect(fetchEntryMeta).toHaveBeenCalledWith(path, undefined, true);
        expect(storeWithLiveBaseRevision).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "History.md",
                path: "History.md",
                stat: {
                    ctime: 10,
                    mtime: 50,
                    size: 18,
                    type: "file",
                },
                body: expect.any(Blob),
            }),
            "4-deleted",
            true
        );
        const storedFile = storeWithLiveBaseRevision.mock.calls[0][0];
        await expect(storedFile.body.text()).resolves.toBe("historical content");
        expect(storedFile.deleted).toBeUndefined();
        expect(dbToStorageWithSpecificRev).toHaveBeenCalledWith("History.md", "5-restored", true);
    });

    it("leaves the Vault unchanged when the conditional database write is refused", async () => {
        const { calls, core, dbToStorageWithSpecificRev } = createCore({ storedRevision: false });

        await expect(restoreDocumentHistoryRevision(core, path, "2-source")).resolves.toEqual({
            status: "database-write-refused",
        });

        expect(calls).toEqual(["read-source", "read-current", "store"]);
        expect(dbToStorageWithSpecificRev).not.toHaveBeenCalled();
    });

    it("reports a stored revision when its subsequent Vault reflection fails", async () => {
        const { core, storeWithLiveBaseRevision } = createCore({ reflected: false });

        await expect(restoreDocumentHistoryRevision(core, path, "2-source")).resolves.toEqual({
            status: "stored-not-reflected",
            path: "History.md" as FilePath,
            revision: "5-restored",
        });

        expect(storeWithLiveBaseRevision).toHaveBeenCalledOnce();
    });

    it("reports a stored revision when its subsequent Vault reflection throws", async () => {
        const reflectionError = new Error("adapter unavailable");
        const { core, getConflictedRevs } = createCore({ reflectionError });

        await expect(restoreDocumentHistoryRevision(core, path, "2-source")).resolves.toEqual({
            status: "stored-not-reflected",
            path: "History.md" as FilePath,
            revision: "5-restored",
            cause: reflectionError,
        });

        expect(getConflictedRevs).not.toHaveBeenCalled();
    });

    it("reports remaining conflict leaves after restoration", async () => {
        const { core, getConflictedRevs } = createCore({ conflicts: ["3-other"] });

        await expect(restoreDocumentHistoryRevision(core, path, "2-source")).resolves.toEqual({
            status: "restored",
            path: "History.md" as FilePath,
            revision: "5-restored",
            conflictsRemain: true,
        });

        expect(getConflictedRevs).toHaveBeenCalledWith("History.md");
    });

    it("does not turn a completed restoration into a failure when conflict inspection fails", async () => {
        const conflictCheckError = new Error("inspection unavailable");
        const { core } = createCore({ conflictCheckError });

        await expect(restoreDocumentHistoryRevision(core, path, "2-source")).resolves.toEqual({
            status: "restored",
            path: "History.md" as FilePath,
            revision: "5-restored",
            conflictsRemain: undefined,
            conflictCheckError,
        });
    });

    it("does not read or mutate the current tree when the historical source is unavailable", async () => {
        const { core, fetchEntryMeta, storeWithLiveBaseRevision } = createCore({ source: false });

        await expect(restoreDocumentHistoryRevision(core, path, "2-source")).resolves.toEqual({
            status: "source-unavailable",
        });

        expect(fetchEntryMeta).not.toHaveBeenCalled();
        expect(storeWithLiveBaseRevision).not.toHaveBeenCalled();
    });

    it("does not write when the current winner cannot supply an exact base revision", async () => {
        const current = { ...createCurrent(), _rev: undefined } as MetaEntry;
        const { core, storeWithLiveBaseRevision } = createCore({ current });

        await expect(restoreDocumentHistoryRevision(core, path, "2-source")).resolves.toEqual({
            status: "current-unavailable",
        });

        expect(storeWithLiveBaseRevision).not.toHaveBeenCalled();
    });

    it("refuses prefixed internal Metadata before creating a database revision", async () => {
        const current = { ...createCurrent(), path: "i:.obsidian/config.json" as FilePathWithPrefix } as MetaEntry;
        const { core, storeWithLiveBaseRevision } = createCore({ current });

        await expect(restoreDocumentHistoryRevision(core, path, "2-source")).resolves.toEqual({
            status: "unsupported-path",
        });

        expect(storeWithLiveBaseRevision).not.toHaveBeenCalled();
    });

    it("uses the host path validator before creating a database revision", async () => {
        const { core, storeWithLiveBaseRevision } = createCore();

        await expect(
            restoreDocumentHistoryRevision(core, path, "2-source", { isPathValid: () => false })
        ).resolves.toEqual({ status: "unsupported-path" });

        expect(storeWithLiveBaseRevision).not.toHaveBeenCalled();
    });
});
