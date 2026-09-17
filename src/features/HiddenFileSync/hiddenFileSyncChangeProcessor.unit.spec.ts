import { describe, expect, it, vi } from "vitest";
import type { FilePath, MetaEntry, UXFileInfo, UXStat } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));

import {
    createHiddenFileSyncChangeProcessor,
    type HiddenFileSyncChangeProcessorDependencies,
} from "./hiddenFileSyncChangeProcessor.ts";

const path = ".obsidian/app.json" as FilePath;
const stat = { ctime: 1, mtime: 2, size: 3, type: "file" } as UXStat;

function fileInfo(): UXFileInfo {
    return {
        path,
        name: "app.json",
        isInternal: true,
        deleted: false,
        body: new Blob(["{}"]),
        stat,
    } as UXFileInfo;
}

function metadata(): MetaEntry {
    return {
        _id: "i:app",
        _rev: "2-current",
        path: `i:${path}`,
        type: "plain",
        datatype: "plain",
        ctime: 1,
        mtime: 2,
        size: 3,
        children: [],
        eden: {},
        deleted: false,
    } as unknown as MetaEntry;
}

function createDependencies(
    overrides: Partial<HiddenFileSyncChangeProcessorDependencies> = {}
): HiddenFileSyncChangeProcessorDependencies {
    const state = {
        fileToStatKey: vi.fn(async () => "2-3"),
        getLastProcessedFileKey: vi.fn(() => undefined),
        getLastProcessedFileMTime: vi.fn(() => 0),
        databaseStateKey: vi.fn(() => "2-3-2-current--1"),
        getLastProcessedDatabaseKey: vi.fn(() => undefined),
        updateLastProcessedFile: vi.fn(),
        updateLastProcessedDatabase: vi.fn(),
        updateLastProcessed: vi.fn(),
    };
    return {
        storageAccess: {
            statHidden: vi.fn(async () => stat),
        },
        readFileWithInfo: vi.fn(async () => fileInfo()),
        loadDatabaseMetadata: vi.fn(async () => metadata()),
        databaseWriteOperations: {
            store: vi.fn(async () => true),
            delete: vi.fn(async () => true),
        },
        databaseExtractionOperations: {
            extract: vi.fn(async () => true),
        },
        processedState: state,
        conflictResolution: { queue: vi.fn() },
        log: vi.fn(),
        publishActivity: vi.fn(),
        ...overrides,
    } as HiddenFileSyncChangeProcessorDependencies;
}

describe("HiddenFileSyncChangeProcessor activity and serialisation", () => {
    it("publishes admission, processing, and release transitions", async () => {
        const dependencies = createDependencies();
        const processor = createHiddenFileSyncChangeProcessor(dependencies);

        await expect(processor.processStorageChange(path)).resolves.toBe(true);

        const publishActivity = vi.mocked(dependencies.publishActivity);
        expect(publishActivity.mock.calls).toEqual([
            [1, 0],
            [1, 1],
            [1, 0],
            [0, 0],
        ]);
        processor.dispose();
    });

    it("serialises same-path storage changes while allowing each event to settle", async () => {
        let active = 0;
        let maximumActive = 0;
        let releaseFirst!: () => void;
        const firstStarted = new Promise<void>((resolve) => {
            const write = resolve;
            releaseFirst = write;
        });
        const dependencies = createDependencies({
            databaseWriteOperations: {
                store: vi.fn(async () => {
                    active++;
                    maximumActive = Math.max(maximumActive, active);
                    if (active == 1) await firstStarted;
                    active--;
                    return true;
                }),
                delete: vi.fn(async () => true),
            },
        });
        const processor = createHiddenFileSyncChangeProcessor(dependencies);
        const first = processor.processStorageChange(path);
        await vi.waitFor(() => expect(dependencies.databaseWriteOperations.store).toHaveBeenCalledOnce());
        const second = processor.processStorageChange(path);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(dependencies.databaseWriteOperations.store).toHaveBeenCalledOnce();
        releaseFirst();
        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
        expect(maximumActive).toBe(1);
        expect(dependencies.databaseWriteOperations.store).toHaveBeenCalledTimes(2);
        processor.dispose();
    });
});

describe("HiddenFileSyncChangeProcessor compatibility settlement", () => {
    it("consumes database events when metadata loading fails", async () => {
        const error = new Error("metadata unavailable");
        const dependencies = createDependencies({
            loadDatabaseMetadata: vi.fn(async () => {
                throw error;
            }),
        });
        const processor = createHiddenFileSyncChangeProcessor(dependencies);

        await expect(processor.processDatabaseChange(path, "[Replication]")).resolves.toBe(true);

        expect(dependencies.log).toHaveBeenCalledWith("[Replication] Failed to process hidden file", undefined, undefined);
        expect(dependencies.log).toHaveBeenCalledWith(error, expect.any(Number), undefined);
        processor.dispose();
    });

    it("advances the storage marker before a failed database write", async () => {
        const dependencies = createDependencies({
            databaseWriteOperations: {
                store: vi.fn(async () => false),
                delete: vi.fn(async () => true),
            },
        });
        const processor = createHiddenFileSyncChangeProcessor(dependencies);

        await expect(processor.processStorageChange(path)).resolves.toBe(false);

        expect(dependencies.processedState.updateLastProcessedFile).toHaveBeenCalledWith(path, stat);
        expect(dependencies.databaseWriteOperations.store).toHaveBeenCalledOnce();
        processor.dispose();
    });
});
