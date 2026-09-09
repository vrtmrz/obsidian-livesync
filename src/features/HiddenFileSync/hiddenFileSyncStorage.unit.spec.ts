import { describe, expect, it, vi } from "vitest";
import {
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type LoadedEntry,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    deleteHiddenFileFromStorage,
    ensureHiddenFileDirectory,
    isHiddenFileWriteRequired,
    readHiddenFileWithInfo,
    removeHiddenFile,
    triggerHiddenFileEvent,
    writeHiddenFile,
    writeHiddenFileFromDatabase,
} from "./hiddenFileSyncStorage.ts";

const path = ".obsidian/plugins/example/data.json" as FilePath;
const stat = { ctime: 10, mtime: 20, size: 4, type: "file" } as UXStat;

function createStorageDependencies() {
    const storageAccess = {
        ensureDir: vi.fn(async () => true),
        isExistsIncludeHidden: vi.fn(async () => true),
        readHiddenFileAuto: vi.fn(async () => "data" as string | ArrayBuffer),
        removeHidden: vi.fn(async () => true),
        statHidden: vi.fn(async () => stat as UXStat | null),
        triggerHiddenFile: vi.fn(async () => undefined),
        writeHiddenFileAuto: vi.fn(async () => true),
    };
    const log = vi.fn();
    return { dependencies: { storageAccess, log }, log, storageAccess };
}

function databaseEntry(content: string, mtime = 30, ctime = 15): LoadedEntry {
    return {
        path,
        type: "plain",
        datatype: "plain",
        data: content,
        mtime,
        ctime,
    } as LoadedEntry;
}

describe("Hidden File Sync storage operations", () => {
    it("represents a missing hidden file as a deleted empty file", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();
        storageAccess.statHidden.mockResolvedValue(null);

        const result = await readHiddenFileWithInfo(dependencies, path);

        expect(result).toMatchObject({
            name: "data.json",
            path,
            isInternal: true,
            deleted: true,
            stat: { ctime: 0, mtime: 0, size: 0, type: "file" },
        });
        expect(await result.body.text()).toBe("");
        expect(storageAccess.readHiddenFileAuto).not.toHaveBeenCalled();
    });

    it("loads an existing hidden file with its storage stat", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();
        storageAccess.readHiddenFileAuto.mockResolvedValue("data");

        const result = await readHiddenFileWithInfo(dependencies, path);

        expect(result).toMatchObject({ name: "data.json", path, isInternal: true, deleted: false, stat });
        expect(await result.body.text()).toBe("data");
    });

    it("ensures a directory only when the target does not exist", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();

        await ensureHiddenFileDirectory(dependencies, path);
        expect(storageAccess.ensureDir).not.toHaveBeenCalled();

        storageAccess.isExistsIncludeHidden.mockResolvedValue(false);
        await ensureHiddenFileDirectory(dependencies, path);
        expect(storageAccess.ensureDir).toHaveBeenCalledOnce();
        expect(storageAccess.ensureDir).toHaveBeenCalledWith(path);
    });

    it("writes a hidden file and returns the resulting stat", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();

        await expect(writeHiddenFile(dependencies, path, "data", { mtime: 30, ctime: 15 })).resolves.toBe(stat);
        expect(storageAccess.writeHiddenFileAuto).toHaveBeenCalledWith(path, "data", { mtime: 30, ctime: 15 });
        expect(storageAccess.statHidden).toHaveBeenCalledWith(path);
    });

    it("uses the post-write stat even when the storage writer reports false", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();
        storageAccess.writeHiddenFileAuto.mockResolvedValue(false);

        await expect(writeHiddenFile(dependencies, path, "data")).resolves.toBe(stat);
        expect(storageAccess.statHidden).toHaveBeenCalledAfter(storageAccess.writeHiddenFileAuto);
    });

    it("distinguishes an absent, removed, and unremovable file", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();

        storageAccess.isExistsIncludeHidden.mockResolvedValueOnce(false);
        await expect(removeHiddenFile(dependencies, path)).resolves.toBe("ALREADY");
        expect(storageAccess.removeHidden).not.toHaveBeenCalled();

        storageAccess.isExistsIncludeHidden.mockResolvedValueOnce(true);
        storageAccess.removeHidden.mockResolvedValueOnce(true);
        await expect(removeHiddenFile(dependencies, path)).resolves.toBe("OK");

        storageAccess.isExistsIncludeHidden.mockResolvedValueOnce(true);
        storageAccess.removeHidden.mockResolvedValueOnce(false);
        await expect(removeHiddenFile(dependencies, path)).resolves.toBe(false);
    });

    it("turns a removal error into a logged false result", async () => {
        const { dependencies, log, storageAccess } = createStorageDependencies();
        const error = new Error("remove failed");
        storageAccess.isExistsIncludeHidden.mockRejectedValue(error);

        await expect(removeHiddenFile(dependencies, path)).resolves.toBe(false);
        expect(log).toHaveBeenNthCalledWith(1, `Failed to remove file:${path}`, undefined, undefined);
        expect(log).toHaveBeenNthCalledWith(2, error, LOG_LEVEL_VERBOSE, undefined);
    });

    it("treats a content-read failure as requiring a write", async () => {
        const { dependencies, log, storageAccess } = createStorageDependencies();
        const error = new Error("read failed");
        storageAccess.readHiddenFileAuto.mockRejectedValue(error);

        await expect(isHiddenFileWriteRequired(dependencies, path, "data")).resolves.toBe(true);
        expect(log).toHaveBeenNthCalledWith(1, `Cannot check the content of ${path}`, undefined, undefined);
        expect(log).toHaveBeenNthCalledWith(2, error, LOG_LEVEL_VERBOSE, undefined);
    });

    it("compares binary content without involving the context", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();
        storageAccess.readHiddenFileAuto.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);

        await expect(
            isHiddenFileWriteRequired(dependencies, path, new Uint8Array([1, 2, 3]).buffer)
        ).resolves.toBe(false);
        await expect(
            isHiddenFileWriteRequired(dependencies, path, new Uint8Array([1, 2, 4]).buffer)
        ).resolves.toBe(true);
    });

    it("skips an unchanged database file and preserves its current stat", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();
        storageAccess.readHiddenFileAuto.mockResolvedValue("data");

        await expect(writeHiddenFileFromDatabase(dependencies, path, databaseEntry("data"), false)).resolves.toBe(
            stat
        );
        expect(storageAccess.ensureDir).not.toHaveBeenCalled();
        expect(storageAccess.writeHiddenFileAuto).not.toHaveBeenCalled();
    });

    it("writes changed database content with its original timestamps", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();
        storageAccess.readHiddenFileAuto.mockResolvedValue("old");

        await expect(writeHiddenFileFromDatabase(dependencies, path, databaseEntry("new"), false)).resolves.toBe(
            stat
        );
        expect(storageAccess.writeHiddenFileAuto).toHaveBeenCalledWith(path, "new", { mtime: 30, ctime: 15 });
        expect(storageAccess.triggerHiddenFile).not.toHaveBeenCalled();
    });

    it("forces a write without reading existing content", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();

        await expect(writeHiddenFileFromDatabase(dependencies, path, databaseEntry("data"), true)).resolves.toBe(stat);
        expect(storageAccess.readHiddenFileAuto).not.toHaveBeenCalled();
        expect(storageAccess.writeHiddenFileAuto).toHaveBeenCalledOnce();
    });

    it("returns false when a completed write has no resulting stat", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();
        storageAccess.statHidden.mockResolvedValue(null);

        await expect(writeHiddenFileFromDatabase(dependencies, path, databaseEntry("data"), false)).resolves.toBe(
            false
        );
        expect(storageAccess.writeHiddenFileAuto).toHaveBeenCalledOnce();
    });

    it("triggers a storage event only after an actual deletion", async () => {
        const { dependencies, log, storageAccess } = createStorageDependencies();

        storageAccess.isExistsIncludeHidden.mockResolvedValueOnce(false);
        await expect(deleteHiddenFileFromStorage(dependencies, path)).resolves.toBe("ALREADY");
        expect(storageAccess.triggerHiddenFile).not.toHaveBeenCalled();
        log.mockClear();

        storageAccess.isExistsIncludeHidden.mockResolvedValueOnce(true);
        storageAccess.removeHidden.mockResolvedValueOnce(true);
        await expect(deleteHiddenFileFromStorage(dependencies, path)).resolves.toBe("OK");
        expect(storageAccess.triggerHiddenFile).toHaveBeenCalledOnce();
        expect(storageAccess.triggerHiddenFile).toHaveBeenCalledWith(path);
        expect(storageAccess.triggerHiddenFile).toHaveBeenCalledAfter(storageAccess.removeHidden);
        expect(log).toHaveBeenCalledAfter(storageAccess.triggerHiddenFile);
    });

    it("does not trigger a storage event after a failed deletion", async () => {
        const { dependencies, storageAccess } = createStorageDependencies();
        storageAccess.removeHidden.mockResolvedValue(false);

        await expect(deleteHiddenFileFromStorage(dependencies, path)).resolves.toBe(false);
        expect(storageAccess.triggerHiddenFile).not.toHaveBeenCalled();
    });

    it("swallows and logs storage-event failures", async () => {
        const { dependencies, log, storageAccess } = createStorageDependencies();
        const error = new Error("event failed");
        storageAccess.triggerHiddenFile.mockRejectedValue(error);

        await expect(triggerHiddenFileEvent(dependencies, path)).resolves.toBeUndefined();
        expect(log).toHaveBeenNthCalledWith(
            1,
            "Failed to call internal API(reconcileInternalFile)",
            LOG_LEVEL_VERBOSE,
            undefined
        );
        expect(log).toHaveBeenNthCalledWith(2, error, LOG_LEVEL_VERBOSE, undefined);
    });
});
