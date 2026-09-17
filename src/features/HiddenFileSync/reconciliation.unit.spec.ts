import { describe, expect, it, vi } from "vitest";
import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    type FilePath,
    type MetaEntry,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));

import {
    createReconciliation,
    type ReconciliationProgress,
    type ReconciliationDependencies,
} from "./reconciliation.ts";

const targetPath = ".obsidian/app.json" as FilePath;
const filteredPath = ".obsidian/plugins/other/data.json" as FilePath;

function createFixture(options: { files?: FilePath[]; databaseFiles?: MetaEntry[] } = {}) {
    const files = options.files ?? [targetPath];
    const databaseFiles = options.databaseFiles ?? [];
    const processedFiles = new Map<string, string>();
    const progress = {
        log: vi.fn(),
        once: vi.fn(),
        done: vi.fn(),
    } satisfies ReconciliationProgress;
    const createProgress = vi.fn((_prefix = "", _level = LOG_LEVEL_NOTICE) => progress);
    const statHidden = vi.fn(
        async (path: FilePath): Promise<UXStat | null> => ({
            ctime: 10,
            mtime: path == targetPath ? 20 : 30,
            size: 10,
            type: "file",
        })
    );
    const isTargetFile = vi.fn(async (path: FilePath) => path == targetPath);
    const allDocsRaw = vi.fn(async () => ({
        rows: databaseFiles.map((doc) => ({ id: doc._id, doc })),
    }));
    const processedState = {
        databaseStateKey: vi.fn((entry: MetaEntry) => `${entry._rev}`),
        getLastProcessedDatabaseKey: vi.fn(() => undefined as string | undefined),
        getLastProcessedFileKey: vi.fn(() => undefined as string | undefined),
        getLastProcessedFileMTime: vi.fn(() => 0),
        hasLastProcessedDatabase: vi.fn(() => false),
        hasLastProcessedFile: vi.fn(() => false),
        getLastProcessedFileKeys: vi.fn(() => processedFiles.keys()),
        resetLastProcessedDatabase: vi.fn(),
        resetLastProcessedFile: vi.fn(),
        storageStateKey: vi.fn((stat: UXStat | null) => `${stat?.mtime ?? 0}`),
        updateLastProcessed: vi.fn(),
        updateLastProcessedAsActualDatabase: vi.fn(async () => undefined),
        updateLastProcessedAsActualFile: vi.fn(async () => undefined),
    };
    const changeProcessor = {
        processStorageChange: vi.fn(async () => true),
        processDatabaseChange: vi.fn(async () => true),
    };
    const dependencies = {
        listFiles: vi.fn(async () => ({ files, folders: [] })),
        getLocalDatabase: () => ({ allDocsRaw }),
        storageAccess: { statHidden },
        getRootPath: () => "root",
        getPath: (entry: MetaEntry) => entry.path,
        isTargetFile,
        isIgnoredByIgnoreFile: vi.fn(async () => false),
        createProgress,
        processedState,
        changeProcessor,
        log: vi.fn(),
    } as unknown as ReconciliationDependencies;
    return {
        dependencies,
        progress,
        createProgress,
        isTargetFile,
        statHidden,
        processedState,
        changeProcessor,
    };
}

function metadata(path: FilePath = targetPath): MetaEntry {
    return {
        _id: `i:${path}`,
        _rev: "2-current",
        path: `i:${path}`,
        type: "plain",
        datatype: "plain",
        ctime: 10,
        mtime: 20,
        size: 10,
        children: [],
        eden: {},
        deleted: false,
    } as unknown as MetaEntry;
}

describe("Reconciliation", () => {
    it("keeps push initialisation direction and follow-up scan order", async () => {
        const fixture = createFixture();
        const reconciliation = createReconciliation(fixture.dependencies);
        const order: string[] = [];
        const scanStorageChanges = vi.spyOn(reconciliation, "scanAllStorageChanges").mockImplementation(async () => {
            order.push("storage-scan");
        });
        const scanDatabaseChanges = vi.spyOn(reconciliation, "scanAllDatabaseChanges").mockImplementation(async () => {
            order.push("database-scan");
        });

        await reconciliation.initialiseInternalFileSync("push", true);

        expect(fixture.changeProcessor.processStorageChange).toHaveBeenCalledWith(targetPath, true, true, true);
        expect(order).toEqual(["storage-scan", "database-scan"]);
        expect(scanStorageChanges).toHaveBeenCalledWith(false, true, false);
        expect(scanDatabaseChanges).toHaveBeenCalledWith(false, true, false);
        expect(fixture.createProgress).toHaveBeenCalledWith("[⚙ Initialise]\n", LOG_LEVEL_NOTICE);
        expect(fixture.createProgress).toHaveBeenCalledWith("[⚙ Rebuild by Storage ]\n", LOG_LEVEL_INFO);
        expect(fixture.progress.done).toHaveBeenCalledTimes(3);
    });

    it("restores rebuild interception in stack order without clobbering a newer hook", async () => {
        const fixture = createFixture({ files: [] });
        const reconciliation = createReconciliation(fixture.dependencies);
        const events: string[] = [];
        const first = vi.fn(async (run, showNotice, targetFiles) => {
            events.push("first:start");
            const result = await run(showNotice, targetFiles);
            events.push("first:end");
            return result;
        });
        const second = vi.fn(async (run, showNotice, targetFiles) => {
            events.push("second:start");
            const result = await run(showNotice, targetFiles);
            events.push("second:end");
            return result;
        });
        const restoreFirst = reconciliation.interceptRebuildMerging(first);
        const restoreSecond = reconciliation.interceptRebuildMerging(second);

        restoreFirst();
        await reconciliation.initialiseInternalFileSync("safe", false);
        expect(second).toHaveBeenCalledOnce();

        restoreSecond();
        await reconciliation.initialiseInternalFileSync("safe", false);
        expect(first).toHaveBeenCalledOnce();
        expect(events[0]).toBe("second:start");
        expect(events[events.length - 1]).toBe("first:end");
    });

    it("uses admission and processed-state keys when selecting storage scan work", async () => {
        const fixture = createFixture({ files: [targetPath, filteredPath] });
        const reconciliation = createReconciliation(fixture.dependencies);

        await reconciliation.scanAllStorageChanges(false);

        expect(fixture.isTargetFile).toHaveBeenCalledWith(targetPath);
        expect(fixture.isTargetFile).toHaveBeenCalledWith(filteredPath);
        expect(fixture.processedState.getLastProcessedFileKey).toHaveBeenCalledWith(targetPath);
        expect(fixture.changeProcessor.processStorageChange).toHaveBeenCalledWith(targetPath, false, false, true);
        expect(fixture.changeProcessor.processStorageChange).not.toHaveBeenCalledWith(filteredPath, false, false, true);
        expect(fixture.progress.once).toHaveBeenCalledWith(expect.stringContaining("Offline Changed files: 1"));
    });
});
