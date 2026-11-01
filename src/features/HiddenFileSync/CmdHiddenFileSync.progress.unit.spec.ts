import { describe, expect, it, vi } from "vitest";
import {
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type MetaEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {},
}));
vi.mock("@/features/LiveSyncCommands.ts", () => ({
    LiveSyncCommands: class LiveSyncCommands {
        plugin!: { app: unknown };
        core!: { services: unknown; settings: unknown };
        get app() {
            return this.plugin.app;
        }
        get services() {
            return this.core.services;
        }
        get settings() {
            return this.core.settings;
        }
    },
}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSync } from "./CmdHiddenFileSync.ts";

function createProgress() {
    return {
        log: vi.fn(),
        once: vi.fn(),
        done: vi.fn(),
    };
}

function createHiddenFileSync() {
    const progress = createProgress();
    const log = vi.fn();
    const trackStorageFileModification = vi.fn(async (_file: FilePath) => false);
    const trackDatabaseFileModification = vi.fn(async (_path: FilePath) => false);
    const isTargetFile = vi.fn(async (_path: FilePath) => true);
    const getPath = vi.fn((file: MetaEntry) => file.path);
    const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;

    Object.assign(hiddenFileSync, {
        _progress: vi.fn(() => progress),
        _log: log,
        trackStorageFileModification,
        trackDatabaseFileModification,
        isTargetFile,
        getPath,
    });

    return {
        hiddenFileSync,
        progress,
        log,
        trackStorageFileModification,
        trackDatabaseFileModification,
        isTargetFile,
    };
}

function createStoragePaths(count: number): FilePath[] {
    return Array.from({ length: count }, (_, index) => `.obsidian/plugins/example/${index}.json` as FilePath);
}

function createDatabaseEntries(count: number): MetaEntry[] {
    return Array.from(
        { length: count },
        (_, index) =>
            ({
                _id: `i:.obsidian/plugins/example/${index}.json` as DocumentID,
                _rev: "1-test",
                path: `i:.obsidian/plugins/example/${index}.json` as FilePathWithPrefix,
                ctime: 1,
                mtime: 1,
                size: 0,
                type: "plain",
                datatype: "plain",
                children: [],
                eden: {},
                deleted: false,
            }) as MetaEntry
    );
}

describe("HiddenFileSync batch progress consumers", () => {
    it("counts completed storage modifications even when they return false", async () => {
        const { hiddenFileSync, progress, trackStorageFileModification } = createHiddenFileSync();
        const files = createStoragePaths(101);

        await hiddenFileSync.trackScannedStorageChanges(files);

        expect(trackStorageFileModification).toHaveBeenCalledTimes(101);
        expect(progress.log.mock.calls).toEqual([["1/101"], ["101/101"]]);
        expect(progress.done).toHaveBeenCalledTimes(1);
    });

    it("logs and skips failed storage items when counting progress", async () => {
        const { hiddenFileSync, progress, log, trackStorageFileModification } = createHiddenFileSync();
        const files = createStoragePaths(100);
        const failingFile = files[50];
        const error = new Error("Storage item failed");
        trackStorageFileModification.mockImplementation(async (file) => {
            if (file === failingFile) throw error;
            return false;
        });

        await hiddenFileSync.trackScannedStorageChanges(files);

        expect(progress.once).toHaveBeenCalledWith(`Failed to process storage change file:${failingFile}`);
        expect(log).toHaveBeenCalledWith(error, LOG_LEVEL_VERBOSE);
        expect(progress.log.mock.calls).toEqual([["1/100"]]);
        expect(progress.done).toHaveBeenCalledTimes(1);
    });

    it("counts completed database items, including filtered items and false returns", async () => {
        const { hiddenFileSync, progress, trackDatabaseFileModification, isTargetFile } = createHiddenFileSync();
        const files = createDatabaseEntries(101);
        const filteredPath = ".obsidian/plugins/example/50.json" as FilePath;
        isTargetFile.mockImplementation(async (path) => path !== filteredPath);

        await hiddenFileSync.trackScannedDatabaseChange(files);

        expect(isTargetFile).toHaveBeenCalledTimes(101);
        expect(trackDatabaseFileModification).toHaveBeenCalledTimes(100);
        expect(progress.log.mock.calls).toEqual([["1/101"], ["101/101"]]);
        expect(progress.done).toHaveBeenCalledTimes(1);
    });

    it("logs and skips failed database scan items when counting progress", async () => {
        const { hiddenFileSync, progress, log, trackDatabaseFileModification } = createHiddenFileSync();
        const files = createDatabaseEntries(101);
        const failingPath = ".obsidian/plugins/example/50.json" as FilePath;
        const error = new Error("Database scan item failed");
        trackDatabaseFileModification.mockImplementation(async (path) => {
            if (path === failingPath) throw error;
            return false;
        });

        await hiddenFileSync.trackScannedDatabaseChange(files);

        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("Failed to process storage change file:"),
            expect.anything()
        );
        expect(log).toHaveBeenCalledWith(error, LOG_LEVEL_VERBOSE);
        expect(progress.log.mock.calls).toEqual([["1/101"]]);
        expect(progress.done).toHaveBeenCalledTimes(1);
    });

    it("uses the database-file progress interval and counts false returns", async () => {
        const { hiddenFileSync, progress, trackDatabaseFileModification } = createHiddenFileSync();
        const files = createDatabaseEntries(26);

        await expect(hiddenFileSync.useDatabaseFiles(files)).resolves.toBe(true);

        expect(trackDatabaseFileModification).toHaveBeenCalledTimes(26);
        expect(progress.log.mock.calls).toEqual([["Scanning database files..."], ["1/26"], ["26/26"]]);
        expect(progress.done).toHaveBeenCalledTimes(1);
    });

    it("logs and skips failed database-file items when counting progress", async () => {
        const { hiddenFileSync, progress, log, trackDatabaseFileModification } = createHiddenFileSync();
        const files = createDatabaseEntries(26);
        const failingPath = ".obsidian/plugins/example/12.json" as FilePath;
        const error = new Error("Database file item failed");
        trackDatabaseFileModification.mockImplementation(async (path) => {
            if (path === failingPath) throw error;
            return false;
        });

        await expect(hiddenFileSync.useDatabaseFiles(files)).resolves.toBe(true);

        expect(log).toHaveBeenCalledWith(expect.stringContaining("Failed to process database changes:"));
        expect(log).toHaveBeenCalledWith(error, LOG_LEVEL_VERBOSE);
        expect(progress.log.mock.calls).toEqual([["Scanning database files..."], ["1/26"]]);
        expect(progress.done).toHaveBeenCalledTimes(1);
    });

    it("starts all storage work eagerly and calls done only after all promises resolve", async () => {
        const { hiddenFileSync, progress, trackStorageFileModification } = createHiddenFileSync();
        const files = createStoragePaths(101);
        const resolveModifications: Array<(result: boolean) => void> = [];
        trackStorageFileModification.mockImplementation(
            () => new Promise<boolean>((resolve) => resolveModifications.push(resolve))
        );

        const operation = hiddenFileSync.trackScannedStorageChanges(files);
        expect(trackStorageFileModification).toHaveBeenCalledTimes(files.length);
        expect(progress.done).not.toHaveBeenCalled();

        for (const resolveModification of resolveModifications) resolveModification(false);
        await operation;

        expect(progress.done).toHaveBeenCalledTimes(1);
    });

    it("does not call done when the item error handler rejects the batch", async () => {
        const { hiddenFileSync, progress, trackStorageFileModification } = createHiddenFileSync();
        const itemError = new Error("Storage item failed");
        const handlerError = new Error("Progress error handler failed");
        trackStorageFileModification.mockRejectedValueOnce(itemError);
        progress.once.mockImplementation(() => {
            throw handlerError;
        });

        await expect(hiddenFileSync.trackScannedStorageChanges(createStoragePaths(1))).rejects.toBe(handlerError);
        expect(progress.done).not.toHaveBeenCalled();
    });
});
