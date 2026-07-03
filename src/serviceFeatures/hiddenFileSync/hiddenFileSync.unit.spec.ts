import { describe, it, expect, vi } from "vitest";

// Mock the Obsidian dependency barrel
vi.mock("@/deps.ts", () => ({
    Platform: { isMobile: false, isDesktop: true, isDesktopApp: true },
    parseYaml: (str: string) => JSON.parse(str),
    stringifyYaml: (obj: unknown) => JSON.stringify(obj),
    Notice: vi.fn(),
    Modal: class MockModal {
        open() {}
        close() {}
    },
    ItemView: class MockItemView {},
    App: class MockApp {},
    normalizePath: (p: string) => p,
    diff_match_patch: class {
        diff_main(a: string, b: string) {
            return [[0, a]];
        }
        diff_cleanupSemantic() {}
    },
    DIFF_DELETE: -1,
    DIFF_EQUAL: 0,
    DIFF_INSERT: 1,
    request: vi.fn(),
    requestUrl: vi.fn(),
    sanitizeHTMLToDom: vi.fn(() => document.createDocumentFragment()),
    Setting: class MockSetting {},
    PluginSettingTab: class MockPluginSettingTab {},
    addIcon: vi.fn(),
    debounce: (fn: Function) => fn,
    TAbstractFile: class MockTAbstractFile {},
    TFile: class MockTFile {},
    TFolder: class MockTFolder {},
}));

import type { LogFunction } from "@lib/services/lib/logUtils";
import type { UXStat, MetaEntry, LoadedEntry, FilePath, FilePathWithPrefix } from "@lib/common/types.ts";
import { createHiddenFileSyncState } from "./state";
import { isThisModuleEnabled, isDatabaseReady, isReady, updateSettingCache, performStartupScan } from "./startupScan";
import { useHiddenFileSync } from "./index";
import { bindHiddenFileSyncEvents } from "./eventBindings";
import { registerHiddenFileSyncCommands } from "./commands";
import {
    getComparingMTime,
    statToKey,
    docToKey,
    fileToStatKey,
    updateLastProcessedFile,
    updateLastProcessedAsActualFile,
    resetLastProcessedFile,
    getLastProcessedFileMTime,
    getLastProcessedFileKey,
    getLastProcessedDatabaseKey,
    updateLastProcessedDatabase,
    updateLastProcessed,
    updateLastProcessedDeletion,
    updateLastProcessedAsActualDatabase,
    resetLastProcessedDatabase,
} from "./stateHelpers";

const createLoggerMock = (): LogFunction => {
    return vi.fn();
};

const createStorageAccessMock = () => {
    const files = new Map<string, UXStat>();
    return {
        files,
        isExistsIncludeHidden: vi.fn(async (path: string) => files.has(path)),
        statHidden: vi.fn(async (path: string) => files.get(path) || null),
    };
};

const createDatabaseMock = () => {
    const dbEntries = new Map<string, MetaEntry>();
    return {
        dbEntries,
        isDatabaseReady: vi.fn(() => true),
        getDBEntryMeta: vi.fn(async (path: string) => dbEntries.get(path) || false),
    };
};

const createSettingServiceMock = () => {
    const settings = {
        syncInternalFiles: true,
        pluginSyncExtendedSetting: {},
        usePluginSync: false,
    };
    return {
        settings,
        currentSettings: vi.fn(() => settings),
    };
};

const createAppLifecycleMock = () => {
    return {
        isReady: vi.fn(() => true),
        isSuspended: vi.fn(() => false),
        onBeforeUnload: createEventMock(),
        onUnload: createEventMock(),
        onSuspending: createEventMock(),
    };
};

const createPathMock = () => {
    return {
        getPath: vi.fn((doc: any) => doc.path || doc._id),
        markChangesAreSame: vi.fn(),
        unmarkChanges: vi.fn(),
    };
};

const createEventMock = () => {
    const fn = vi.fn();
    (fn as any).addHandler = vi.fn();
    (fn as any).removeHandler = vi.fn();
    (fn as any).setHandler = vi.fn();
    return fn;
};

const createHostMock = () => {
    const storageAccess = createStorageAccessMock();
    const database = createDatabaseMock();
    const setting = createSettingServiceMock();
    const appLifecycle = createAppLifecycleMock();
    const path = createPathMock();

    return {
        services: {
            API: {
                getSystemConfigDir: vi.fn(() => ".obsidian"),
                addCommand: vi.fn(),
                addLog: vi.fn(),
                confirm: {
                    askSelectStringDialogue: vi.fn(),
                    askString: vi.fn(),
                },
            } as any,
            appLifecycle: {
                ...appLifecycle,
                onResuming: createEventMock(),
                onInitialise: createEventMock(),
                onSettingLoaded: createEventMock(),
                onLayoutReady: createEventMock(),
                onSuspend: createEventMock(),
                onResume: createEventMock(),
                onResumed: createEventMock(),
            } as any,
            setting: {
                ...setting,
                onRealiseSetting: createEventMock(),
                suspendExtraSync: createEventMock(),
                suggestOptionalFeatures: createEventMock(),
                enableOptionalFeature: createEventMock(),
            } as any,
            vault: {
                isIgnoredByIgnoreFile: vi.fn(async () => false),
                isTargetFileInExtra: createEventMock(),
            } as any,
            path,
            database: {
                ...database,
                localDatabase: {
                    allDocsRaw: vi.fn(async () => ({ rows: [] })),
                    findEntries: vi.fn(async () => []),
                },
            } as any,
            databaseEvents: {
                onDatabaseInitialised: createEventMock(),
            } as any,
            replication: {
                onBeforeReplicate: createEventMock(),
                processOptionalSynchroniseResult: createEventMock(),
            } as any,
            fileProcessing: {
                processOptionalFileEvent: createEventMock(),
            } as any,
            conflict: {
                getOptionalConflictCheckMethod: createEventMock(),
            } as any,
            keyValueDB: {
                kvDB: {
                    get: vi.fn(),
                    set: vi.fn(),
                },
            } as any,
        },
        serviceModules: {
            storageAccess,
        },
    };
};

describe("Hidden File Synchronisation - Startup Scan", () => {
    it("should check if the module is enabled", () => {
        const host = createHostMock();
        expect(isThisModuleEnabled(host as any)).toBe(true);

        host.services.setting.currentSettings().syncInternalFiles = false;
        expect(isThisModuleEnabled(host as any)).toBe(false);
    });

    it("should check if the database is ready", () => {
        const host = createHostMock();
        expect(isDatabaseReady(host as any)).toBe(true);

        host.services.database.isDatabaseReady.mockReturnValue(false);
        expect(isDatabaseReady(host as any)).toBe(false);
    });

    it("should check if the module is ready", () => {
        const host = createHostMock();
        const state = createHiddenFileSyncState();
        expect(isReady(host as any, state)).toBe(true);

        host.services.appLifecycle.isReady.mockReturnValue(false);
        expect(isReady(host as any, state)).toBe(false);

        host.services.appLifecycle.isReady.mockReturnValue(true);
        host.services.appLifecycle.isSuspended.mockReturnValue(true);
        expect(isReady(host as any, state)).toBe(false);

        host.services.appLifecycle.isSuspended.mockReturnValue(false);
        host.services.setting.currentSettings().syncInternalFiles = false;
        expect(isReady(host as any, state)).toBe(false);
    });

    it("should clear cache when setting cache is updated", () => {
        const host = createHostMock();
        const state = createHiddenFileSyncState();
        state.cacheCustomisationSyncIgnoredFiles.set("test", []);
        state.cacheFileRegExps.set("test", []);

        updateSettingCache(host as any, state);
        expect(state.cacheCustomisationSyncIgnoredFiles.size).toBe(0);
        expect(state.cacheFileRegExps.size).toBe(0);
    });

    it("should perform startup scan by running applyOfflineChanges", async () => {
        const host = createHostMock();
        const state = createHiddenFileSyncState();
        const log = createLoggerMock();
        const applyOfflineChangesMock = vi.fn();

        await performStartupScan(host as any, log, state, true, applyOfflineChangesMock);
        expect(applyOfflineChangesMock).toHaveBeenCalledWith(true);
    });
});

describe("Hidden File Synchronisation - State Helpers", () => {
    describe("getComparingMTime", () => {
        it("should return 0 for null/undefined/false entries", () => {
            expect(getComparingMTime(null)).toBe(0);
            expect(getComparingMTime(undefined)).toBe(0);
            expect(getComparingMTime(false)).toBe(0);
        });

        it("should return mtime from document stat if present", () => {
            const doc = { stat: { mtime: 12345 } } as any;
            expect(getComparingMTime(doc)).toBe(12345);
        });

        it("should return mtime from document directly if stat not present", () => {
            const doc = { mtime: 54321 } as any;
            expect(getComparingMTime(doc)).toBe(54321);
        });

        it("should return 0 for deleted documents unless includeDeleted is true", () => {
            const doc = { mtime: 54321, deleted: true } as any;
            expect(getComparingMTime(doc)).toBe(0);
            expect(getComparingMTime(doc, true)).toBe(54321);

            const docUnderscore = { mtime: 54321, _deleted: true } as any;
            expect(getComparingMTime(docUnderscore)).toBe(0);
            expect(getComparingMTime(docUnderscore, true)).toBe(54321);
        });
    });

    describe("Key converters", () => {
        it("should convert stat to string key", () => {
            const stat = { mtime: 1000, size: 50, type: "file" as const, ctime: 900 };
            expect(statToKey(stat)).toBe("1000-50");
            expect(statToKey(null)).toBe("0-0");
        });

        it("should convert database doc to string key", () => {
            const doc: LoadedEntry = {
                _id: "test" as any,
                path: "test" as FilePathWithPrefix,
                mtime: 2000,
                ctime: 2000,
                size: 100,
                _rev: "1-abc",
                deleted: false,
                children: [],
                type: "plain",
                datatype: "plain",
                data: "",
                eden: {},
            };
            expect(docToKey(doc)).toBe("2000-100-1-abc--1");

            doc.deleted = true;
            expect(docToKey(doc)).toBe("2000-100-1-abc--0");
        });

        it("should generate file to stat key from storage", async () => {
            const host = createHostMock();
            const stat = { mtime: 3000, size: 150, type: "file" as const, ctime: 2900 };
            host.serviceModules.storageAccess.files.set("file.txt", stat);

            const key = await fileToStatKey(host as any, "file.txt" as FilePath);
            expect(key).toBe("3000-150");
        });
    });

    describe("Cache updates and resets", () => {
        it("should update last processed file info in state", () => {
            const state = createHiddenFileSyncState();
            updateLastProcessedFile(state, "file.txt" as FilePath, "4000-200");
            expect(state._fileInfoLastProcessed.get("file.txt" as FilePath)).toBe("4000-200");
            expect(getLastProcessedFileMTime(state, "file.txt" as FilePath)).toBe(4000);

            const stat = { mtime: 5000, size: 250, type: "file" as const, ctime: 4900 };
            updateLastProcessedFile(state, "file.txt" as FilePath, stat);
            expect(state._fileInfoLastProcessed.get("file.txt" as FilePath)).toBe("5000-250");
            expect(getLastProcessedFileMTime(state, "file.txt" as FilePath)).toBe(5000);
        });

        it("should fetch actual file stat and update last processed file", async () => {
            const host = createHostMock();
            const state = createHiddenFileSyncState();
            const stat = { mtime: 6000, size: 300, type: "file" as const, ctime: 5900 };
            host.serviceModules.storageAccess.files.set("file.txt", stat);

            await updateLastProcessedAsActualFile(host as any, state, "file.txt" as FilePath);
            expect(getLastProcessedFileKey(state, "file.txt" as FilePath)).toBe("6000-300");
        });

        it("should reset last processed file cache", () => {
            const state = createHiddenFileSyncState();
            state._fileInfoLastProcessed.set("file1.txt" as FilePath, "1000-10");
            state._fileInfoLastProcessed.set("file2.txt" as FilePath, "2000-20");

            resetLastProcessedFile(() => {}, state, ["file1.txt" as FilePath]);
            expect(state._fileInfoLastProcessed.has("file1.txt" as FilePath)).toBe(false);
            expect(state._fileInfoLastProcessed.has("file2.txt" as FilePath)).toBe(true);

            resetLastProcessedFile(() => {}, state, false);
            expect(state._fileInfoLastProcessed.size).toBe(0);
        });

        it("should update and reset last processed database key", () => {
            const state = createHiddenFileSyncState();
            const doc: MetaEntry = {
                _id: "test" as any,
                path: "test" as FilePathWithPrefix,
                mtime: 2000,
                ctime: 2000,
                size: 100,
                _rev: "1-abc",
                deleted: false,
                type: "plain",
                children: [],
                eden: {},
            };
            updateLastProcessedDatabase(state, "file.txt" as FilePath, doc);
            expect(getLastProcessedDatabaseKey(state, "file.txt" as FilePath)).toBe("2000-100-1-abc--1");

            resetLastProcessedDatabase(() => {}, state, ["file.txt" as FilePath]);
            expect(state._databaseInfoLastProcessed.has("file.txt" as FilePath)).toBe(false);
        });

        it("should update both file and database cache records in updateLastProcessed", () => {
            const host = createHostMock();
            const state = createHiddenFileSyncState();
            const stat = { mtime: 7000, size: 350, type: "file" as const, ctime: 6900 };
            const doc: MetaEntry = {
                _id: "test" as any,
                path: "test" as FilePathWithPrefix,
                mtime: 7000,
                ctime: 7000,
                size: 350,
                _rev: "1-abc",
                deleted: false,
                type: "plain",
                children: [],
                eden: {},
            };

            updateLastProcessed(host as any, state, "file.txt" as FilePath, doc, stat);
            expect(getLastProcessedFileKey(state, "file.txt" as FilePath)).toBe("7000-350");
            expect(getLastProcessedDatabaseKey(state, "file.txt" as FilePath)).toBe("7000-350-1-abc--1");
            expect(host.services.path.markChangesAreSame).toHaveBeenCalledWith("file.txt", 7000, 7000);
        });

        it("should handle deletion updates in updateLastProcessedDeletion", () => {
            const host = createHostMock();
            const state = createHiddenFileSyncState();
            const doc: MetaEntry = {
                _id: "test" as any,
                path: "test" as FilePathWithPrefix,
                mtime: 8000,
                ctime: 8000,
                size: 0,
                _rev: "2-abc",
                deleted: true,
                type: "plain",
                children: [],
                eden: {},
            };

            updateLastProcessedDeletion(host as any, state, "file.txt" as FilePath, doc);
            expect(getLastProcessedFileKey(state, "file.txt" as FilePath)).toBe("0-0");
            expect(getLastProcessedDatabaseKey(state, "file.txt" as FilePath)).toBe("8000-0-2-abc--0");
            expect(host.services.path.unmarkChanges).toHaveBeenCalledWith("file.txt");
        });

        it("should update last processed as actual database document", async () => {
            const host = createHostMock();
            const state = createHiddenFileSyncState();
            const doc: MetaEntry = {
                _id: "h-file.txt" as any,
                path: "h-file.txt" as FilePathWithPrefix,
                mtime: 9000,
                ctime: 9000,
                size: 400,
                _rev: "1-abc",
                deleted: false,
                type: "plain",
                children: [],
                eden: {},
            };
            host.services.database.dbEntries.set("h-file.txt", doc);

            await updateLastProcessedAsActualDatabase(host as any, state, "file.txt" as FilePath, doc);
            expect(getLastProcessedDatabaseKey(state, "file.txt" as FilePath)).toBe("9000-400-1-abc--1");
        });
    });
});

describe("Hidden File Synchronisation - Commands", () => {
    it("should register hidden file sync commands", () => {
        const host = createHostMock();
        const handlers = {
            isReady: vi.fn(() => true),
            initialiseInternalFileSync: vi.fn(async () => {}),
            scanAllStorageChanges: vi.fn(async () => true),
            scanAllDatabaseChanges: vi.fn(async () => true),
            applyOfflineChanges: vi.fn(async () => {}),
            resolveConflicts: vi.fn(async () => {}),
        };

        registerHiddenFileSyncCommands(host as any, handlers);
        expect(host.services.API.addCommand).toHaveBeenCalledTimes(5);

        // Test one command callback
        const calls = (host.services.API.addCommand as any).mock.calls;
        const scanStorageCmd = calls.find((c: any) => c[0].id === "livesync-scaninternal-storage");
        expect(scanStorageCmd).toBeDefined();
        scanStorageCmd[0].callback();
        expect(handlers.scanAllStorageChanges).toHaveBeenCalledWith(true);
    });
});

describe("Hidden File Synchronisation - Event Bindings", () => {
    it("should bind event handlers successfully", () => {
        const host = createHostMock();
        const state = createHiddenFileSyncState();
        const log = createLoggerMock();
        const handlers = {
            updateSettingCache: vi.fn(),
            isThisModuleEnabled: vi.fn(() => true),
            isDatabaseReady: vi.fn(() => true),
            isReady: vi.fn(() => true),
            scanAllStorageChanges: vi.fn(async () => true),
            performStartupScan: vi.fn(async () => {}),
            trackStorageFileModification: vi.fn(async () => true),
            queueConflictCheck: vi.fn(),
            processOptionalSyncFiles: vi.fn(async () => true),
            suspendExtraSync: vi.fn(async () => true),
            askUsingOptionalSyncFeature: vi.fn(async () => true),
            configureOptionalSyncFeature: vi.fn(async () => true),
            isTargetFile: vi.fn(async () => true),
        };

        bindHiddenFileSyncEvents(host as any, log, state, handlers);
        expect(host.services.databaseEvents.onDatabaseInitialised.addHandler).toHaveBeenCalled();
        expect(host.services.replication.onBeforeReplicate.addHandler).toHaveBeenCalled();
        expect(host.services.appLifecycle.onResuming.addHandler).toHaveBeenCalled();
    });
});

describe("Hidden File Synchronisation - Feature Entry Hook", () => {
    it("should bootstrap feature correctly", () => {
        const host = createHostMock();
        useHiddenFileSync(host as any);
        expect(host.services.databaseEvents.onDatabaseInitialised.addHandler).toHaveBeenCalled();
        expect(host.services.API.addCommand).toHaveBeenCalled();
    });
});
