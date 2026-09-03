import { describe, expect, it, vi } from "vitest";
import {
    type DocumentID,
    LOG_LEVEL_NOTICE,
    type FilePath,
    type FilePathWithPrefix,
    type MetaEntry,
    type UXFileInfo,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSyncContext } from "./hiddenFileSyncContext.ts";
import { configureHiddenFileSyncMode } from "./configureHiddenFileSyncMode.ts";

function createHiddenRevisionOperation() {
    const path = ".obsidian/plugins/example/data.json" as FilePath;
    const file = {
        path,
        name: "data.json",
        isInternal: true,
        body: new Blob(['{"value":"vault"}']),
        stat: {
            ctime: 1,
            mtime: 2,
            size: 17,
            type: "file",
        },
    } as UXFileInfo;
    const selected = {
        _id: "i:example" as DocumentID,
        _rev: "2-selected",
        path: `i:${path}` as FilePathWithPrefix,
        ctime: 1,
        mtime: 2,
        size: 17,
        type: "plain",
        datatype: "plain",
        children: [],
        eden: {},
        deleted: false,
    } as MetaEntry;
    const winner = {
        ...selected,
        _rev: "3-winner",
    } as MetaEntry;
    const databaseFileAccess = {
        fetchEntryMeta: vi.fn(async (_path: unknown, revision?: string) =>
            revision === selected._rev ? selected : winner
        ),
        getConflictedRevs: vi.fn(async () => [selected._rev]),
        fetchEntryFromMeta: vi.fn(async () => ({ ...selected, data: '{"value":"database"}' })),
        storeWithBaseRevision: vi.fn(async () => "3-vault-child"),
    };
    const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
    Object.assign(hiddenFileSync, {
        dependencies: {
            databaseFileAccess,
            isIgnoredByIgnoreFile: vi.fn(async () => false),
        },
        loadFileWithInfo: vi.fn(async () => file),
        updateLastProcessed: vi.fn(),
        _log: vi.fn(),
    });
    return {
        hiddenFileSync,
        path,
        file,
        selected,
        winner,
        databaseFileAccess,
    };
}

describe("HiddenFileSyncContext configuration-change notices", () => {
    it("releases processors, transient queues, the pattern cache, activity, and the host Notice effect", () => {
        const periodicInternalFileScanProcessor = { disable: vi.fn() };
        const conflictResolutionProcessor = { terminate: vi.fn() };
        const pendingConflictChecks = new Set(["i:.obsidian/example.json"]);
        const queuedNotificationFiles = new Set([".obsidian/plugins/example"]);
        const cacheFileRegExps = new Map([["patterns", []]]);
        const publishActivity = vi.fn();
        const hideConfigurationChangeNotice = vi.fn();
        const closeJsonConflictDialogs = vi.fn();
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: { publishActivity, hideConfigurationChangeNotice, closeJsonConflictDialogs },
            periodicInternalFileScanProcessor,
            conflictResolutionProcessor,
            pendingConflictChecks,
            queuedNotificationFiles,
            cacheFileRegExps,
            eventCount: 4,
            processingCount: 2,
        });

        hiddenFileSync.dispose();
        hiddenFileSync.dispose();

        expect(periodicInternalFileScanProcessor.disable).toHaveBeenCalledOnce();
        expect(conflictResolutionProcessor.terminate).toHaveBeenCalledOnce();
        expect(pendingConflictChecks.size).toBe(0);
        expect(queuedNotificationFiles.size).toBe(0);
        expect(cacheFileRegExps.size).toBe(0);
        expect(publishActivity).toHaveBeenCalledWith(0, 0);
        expect(closeJsonConflictDialogs).toHaveBeenCalledOnce();
        expect(hideConfigurationChangeNotice).toHaveBeenCalledOnce();
    });

    it("does not report Hidden File Sync as ready before the main runtime is ready", () => {
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: {
                getSettings: () => ({
                    syncInternalFiles: true,
                }),
            },
            _isMainReady: vi.fn(() => false),
            _isMainSuspended: vi.fn(() => false),
        });

        expect(hiddenFileSync.isReady()).toBe(false);
    });

    it("settles one batch of changed folders through the host notification effect", () => {
        const showConfigurationChangeNotice = vi.fn();
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: { showConfigurationChangeNotice },
            queuedNotificationFiles: new Set([".obsidian/plugins/alpha", ".obsidian/plugins/beta", ".obsidian"]),
        });

        hiddenFileSync.notifyConfigChange();

        expect(showConfigurationChangeNotice).toHaveBeenCalledWith([
            ".obsidian/plugins/alpha",
            ".obsidian/plugins/beta",
            ".obsidian",
        ]);
        expect(hiddenFileSync.queuedNotificationFiles.size).toBe(0);
    });

    it("keeps subordinate initialisation phases below Notice level so one progress Notice owns the scan", async () => {
        const progress = {
            log: vi.fn(),
            once: vi.fn(),
            done: vi.fn(),
        };
        const rebuildMerging = vi.fn(async () => []);
        const adoptCurrentStorageFilesAsProcessed = vi.fn(async () => undefined);
        const adoptCurrentDatabaseFilesAsProcessed = vi.fn(async () => undefined);
        const scanAllStorageChanges = vi.fn(async () => undefined);
        const scanAllDatabaseChanges = vi.fn(async () => undefined);
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            _progress: vi.fn(() => progress),
            rebuildMerging,
            adoptCurrentStorageFilesAsProcessed,
            adoptCurrentDatabaseFilesAsProcessed,
            scanAllStorageChanges,
            scanAllDatabaseChanges,
        });

        await hiddenFileSync.initialiseInternalFileSync("safe", true);

        expect(rebuildMerging).toHaveBeenCalledWith(false, false);
        expect(scanAllStorageChanges).toHaveBeenCalledWith(false, true, false);
        expect(scanAllDatabaseChanges).toHaveBeenCalledWith(false, true, false);
        expect(progress.done).toHaveBeenCalledOnce();
    });

    it("retirement guard: does not restore separate gathering and restart Notices", async () => {
        vi.mocked(configureHiddenFileSyncMode).mockImplementation(async (_mode, handlers) => {
            await handlers.enable();
            await handlers.initialise("safe");
            return "enabled";
        });
        const events: string[] = [];
        const progress = {
            log: vi.fn((message: string) => {
                events.push(`progress:${message}`);
            }),
            once: vi.fn(),
            done: vi.fn(),
        };
        const createProgress = vi.fn(() => progress);
        const applyPartial = vi.fn(async () => {
            events.push("apply-settings");
        });
        const initialiseInternalFileSync = vi.fn(async () => undefined);
        const log = vi.fn();
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: { applySettings: applyPartial },
            initialiseInternalFileSync,
            _progress: createProgress,
            _log: log,
        });

        await hiddenFileSync.configureHiddenFileSync("MERGE");

        expect(createProgress).toHaveBeenCalledWith("[⚙ Initialise]\n", LOG_LEVEL_NOTICE);
        expect(events[0]).toBe("progress:Preparing Hidden File Sync...");
        expect(initialiseInternalFileSync).toHaveBeenCalledWith("safe", true, false, progress);
        expect(log).not.toHaveBeenCalledWith("Gathering files for enabling Hidden File Sync", LOG_LEVEL_NOTICE);
        expect(log).not.toHaveBeenCalledWith("Done! Restarting the app is strongly recommended!", LOG_LEVEL_NOTICE);
        expect(log).toHaveBeenCalledWith("Hidden File Sync initialisation completed.", expect.any(Number));
    });

    it("closes the preparation Notice when enabling Hidden File Sync fails", async () => {
        vi.mocked(configureHiddenFileSyncMode).mockImplementation(async (_mode, handlers) => {
            await handlers.enable();
            return "enabled";
        });
        const error = new Error("setting persistence failed");
        const progress = {
            log: vi.fn(),
            once: vi.fn(),
            done: vi.fn(),
        };
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: {
                applySettings: vi.fn(async () => {
                    throw error;
                }),
            },
            _progress: vi.fn(() => progress),
            _log: vi.fn(),
        });

        await expect(hiddenFileSync.configureHiddenFileSync("MERGE")).rejects.toBe(error);

        expect(progress.done).toHaveBeenCalledWith("Failed");
    });
});

describe("HiddenFileSyncContext reconciliation settlement", () => {
    it("compatibility: consumes a selected database file even when reading its Metadata fails", async () => {
        const error = new Error("metadata unavailable");
        const getDBEntryMeta = vi.fn(async () => {
            throw error;
        });
        const log = vi.fn();
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: {
                getLocalDatabase: () => ({ getDBEntryMeta }),
                log,
            },
            serializedForEvent: vi.fn(async (_path: FilePath, operation: () => Promise<boolean>) => await operation()),
        });

        await expect(
            hiddenFileSync.trackDatabaseFileModification(".obsidian/app.json" as FilePath, "[Replication]")
        ).resolves.toBe(true);

        expect(log).toHaveBeenCalledWith("[Replication] Failed to process hidden file", undefined, undefined);
        expect(log).toHaveBeenCalledWith(error, expect.any(Number), undefined);
    });
});

describe("HiddenFileSyncContext exact revision repair operations", () => {
    it("stores the current hidden Vault file as a child of the selected live revision", async () => {
        const { hiddenFileSync, file, selected, databaseFileAccess } = createHiddenRevisionOperation();

        await expect(hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(file, selected._rev!)).resolves.toBe(
            true
        );

        expect(databaseFileAccess.storeWithBaseRevision).toHaveBeenCalledWith(
            expect.objectContaining({
                path: file.path,
                body: file.body,
                isInternal: true,
            }),
            selected._rev,
            true
        );
        expect(hiddenFileSync.updateLastProcessed).toHaveBeenCalledWith(
            file.path,
            expect.objectContaining({ _rev: "3-vault-child" }),
            file.stat
        );
    });

    it("refuses to extend a hidden-file revision which is no longer live", async () => {
        const { hiddenFileSync, file, selected, databaseFileAccess } = createHiddenRevisionOperation();
        databaseFileAccess.getConflictedRevs.mockResolvedValue([]);

        await expect(hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(file, selected._rev!)).resolves.toBe(
            false
        );

        expect(databaseFileAccess.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(hiddenFileSync.updateLastProcessed).not.toHaveBeenCalled();
    });

    it("does not create a hidden-file child when asked only to mark a revision which differs from the Vault", async () => {
        const { hiddenFileSync, file, selected, databaseFileAccess } = createHiddenRevisionOperation();

        await expect(
            hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(file, selected._rev!, false)
        ).resolves.toBe(false);

        expect(databaseFileAccess.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(hiddenFileSync.updateLastProcessed).not.toHaveBeenCalled();
    });

    it("marks a matching hidden-file revision without creating a child", async () => {
        const { hiddenFileSync, file, selected, databaseFileAccess } = createHiddenRevisionOperation();
        databaseFileAccess.fetchEntryFromMeta.mockResolvedValue({
            ...selected,
            data: '{"value":"vault"}',
        });

        await expect(
            hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(file, selected._rev!, false)
        ).resolves.toBe(true);

        expect(databaseFileAccess.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(hiddenFileSync.updateLastProcessed).toHaveBeenCalledWith(file.path, selected, file.stat);
    });

    it("applies the selected live hidden-file revision through the existing extraction path", async () => {
        const { hiddenFileSync, path, selected } = createHiddenRevisionOperation();
        const extract = vi.fn(async () => true);
        hiddenFileSync.extractInternalFileFromDatabase = extract;

        await expect(hiddenFileSync.extractInternalFileRevisionFromDatabase(path, selected._rev!, true)).resolves.toBe(
            true
        );

        expect(extract).toHaveBeenCalledWith(path, true, undefined, true, false, true, selected._rev);
    });

    it("does not apply a hidden-file revision which ceased to be live", async () => {
        const { hiddenFileSync, path, selected, databaseFileAccess } = createHiddenRevisionOperation();
        databaseFileAccess.getConflictedRevs.mockResolvedValue([]);

        await expect(hiddenFileSync.extractInternalFileRevisionFromDatabase(path, selected._rev!, true)).resolves.toBe(
            false
        );

        expect(databaseFileAccess.fetchEntryFromMeta).not.toHaveBeenCalled();
    });
});
