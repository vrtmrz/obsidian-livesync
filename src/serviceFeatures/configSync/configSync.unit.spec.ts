/**
 * @file configSync.unit.spec.ts
 * @description Unit tests for the Configuration Synchronisation service feature.
 *
 * Because the unit-test Vitest configuration aliases `"obsidian"` to `""` to prevent
 * accidental runtime imports, any module that transitively imports `@/deps.ts`
 * (which re-exports from `"obsidian"`) would cause a resolution failure.
 *
 * We solve this by mocking `@/deps.ts` at the top level, providing stubs for all
 * runtime values that downstream modules depend on.  Type-only imports are
 * unaffected because TypeScript erases them before bundling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the Obsidian re-export barrel ────────────────────────────────────────
// Must appear *before* any import that transitively reaches `@/deps.ts`.
vi.mock("@/deps.ts", () => ({
    Platform: { isMobile: false, isDesktop: true, isDesktopApp: true },
    parseYaml: (str: string) => JSON.parse(str),
    stringifyYaml: (obj: unknown) => JSON.stringify(obj),
    Notice: vi.fn(),
    Modal: class MockModal {
        open() {}
        close() {}
    },
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

// Mock the Obsidian UI modals that syncOperations.ts imports directly
vi.mock("@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", () => ({
    ConflictResolveModal: class MockConflictResolveModal {
        open() {}
        close() {}
    },
}));

vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class MockJsonResolveModal {
        open() {}
        close() {}
    },
}));

vi.mock("@/features/ConfigSync/PluginDialogModal.ts", () => ({
    PluginDialogModal: class MockPluginDialogModal {
        open() {}
        close() {}
    },
}));

// ── Actual imports (resolved *after* mocks are hoisted) ──────────────────────
import type { LogFunction } from "@lib/services/lib/logUtils";
import { createConfigSyncState } from "./state";
import { isThisModuleEnabled } from "./syncOperations";
import {
    categoryToFolder,
    getFileCategory,
    isTargetPath,
    filenameToUnifiedKey,
    filenameWithUnifiedKey,
    unifiedKeyPrefixOfTerminal,
    parseUnifiedPath,
    serialize,
    deserialize,
} from "./utils";
import { PluginDataExDisplayV2 } from "./pluginScanner";
import type { ConfigSyncHost, IPluginDataExDisplay } from "./types";
import { useConfigSync } from "./index";
import { bindConfigSyncEvents, configureHiddenFileSync } from "./eventBindings";
import { registerConfigSyncCommands } from "./commands";

// ── Test helpers ─────────────────────────────────────────────────────────────

const createLoggerMock = (): LogFunction => {
    return vi.fn();
};

const createStorageAccessMock = () => {
    return {
        statHidden: vi.fn(),
        readHiddenFileBinary: vi.fn(),
        readHiddenFileText: vi.fn(),
        writeHiddenFileAuto: vi.fn(),
        ensureDir: vi.fn(),
    };
};

const createEventMock = () => {
    const fn = vi.fn();
    (fn as any).addHandler = vi.fn();
    (fn as any).removeHandler = vi.fn();
    (fn as any).setHandler = vi.fn();
    return fn;
};

const createDatabaseMock = () => {
    return {
        getDBEntry: vi.fn(),
        getDBEntryMeta: vi.fn(),
        getDBEntryFromMeta: vi.fn(),
        putDBEntry: vi.fn(),
        putRaw: vi.fn(),
        allDocsRaw: vi.fn(async () => ({ rows: [] })),
        findEntries: vi.fn(async () => []),
    };
};

const createSettingServiceMock = () => {
    const settings = {
        usePluginSync: true,
        usePluginSyncV2: false,
        usePluginEtc: false,
        pluginSyncExtendedSetting: {},
        notifyPluginOrSettingUpdated: false,
        autoSweepPlugins: false,
        autoSweepPluginsPeriodic: false,
        watchInternalFileChanges: false,
    };
    return {
        settings,
        currentSettings: vi.fn(() => settings),
        getDeviceAndVaultName: vi.fn(() => "test-device"),
        setDeviceAndVaultName: vi.fn(),
        applyPartial: vi.fn(),
        onRealiseSetting: createEventMock(),
        suspendExtraSync: createEventMock(),
        suggestOptionalFeatures: createEventMock(),
        enableOptionalFeature: createEventMock(),
    };
};

const createHostMock = (): ConfigSyncHost => {
    const storageAccess = createStorageAccessMock();
    const database = createDatabaseMock();
    const setting = createSettingServiceMock();

    return {
        services: {
            API: {
                getSystemConfigDir: vi.fn(() => ".obsidian"),
                arrayBufferToBase64: vi.fn(async () => ["mockBase64"]),
                addCommand: vi.fn(),
                addRibbonIcon: vi.fn(() => ({
                    addClass: vi.fn(() => ({
                        toggleClass: vi.fn(),
                    })),
                })),
                confirm: {
                    askSelectStringDialogue: vi.fn(),
                    askString: vi.fn(),
                },
                addLog: vi.fn(),
            } as any,
            appLifecycle: {
                isReady: vi.fn(() => true),
                isSuspended: vi.fn(() => false),
                askRestart: vi.fn(),
                onInitialise: createEventMock(),
                onSettingLoaded: createEventMock(),
                onLayoutReady: createEventMock(),
                onSuspend: createEventMock(),
                onResume: createEventMock(),
                onResuming: createEventMock(),
                onResumed: createEventMock(),
            } as any,
            setting,
            vault: {} as any,
            path: {
                path2id: vi.fn(async (path: string) => `id-${path}`),
                getPath: vi.fn((doc: any) => doc.path || doc._id),
                isMarkedAsSameChanges: vi.fn(() => "EVEN"),
                markChangesAreSame: vi.fn(),
            } as any,
            database: {
                localDatabase: database,
            } as any,
            databaseEvents: {
                onChanged: createEventMock(),
                onDatabaseInitialised: createEventMock(),
            } as any,
            fileProcessing: {
                processOptionalFileEvent: createEventMock(),
            } as any,
            keyValueDB: {} as any,
            replication: {
                processVirtualDocument: createEventMock(),
                onBeforeReplicate: createEventMock(),
            } as any,
            conflict: {
                getOptionalConflictCheckMethod: createEventMock(),
            } as any,
            control: {} as any,
        },
        serviceModules: {
            storageAccess,
        } as any,
    } as unknown as ConfigSyncHost;
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Configuration Synchronisation - Module Enablement", () => {
    it("should return true when usePluginSync is enabled", () => {
        const host = createHostMock();
        expect(isThisModuleEnabled(host)).toBe(true);
    });

    it("should return false when usePluginSync is disabled", () => {
        const host = createHostMock();
        host.services.setting.currentSettings().usePluginSync = false;
        expect(isThisModuleEnabled(host)).toBe(false);
    });
});

describe("Configuration Synchronisation - Utility Helpers", () => {
    it("should map categories to correct subdirectories", () => {
        expect(categoryToFolder("CONFIG", ".obsidian")).toBe(".obsidian/");
        expect(categoryToFolder("THEME", ".obsidian")).toBe(".obsidian/themes/");
        expect(categoryToFolder("SNIPPET", ".obsidian")).toBe(".obsidian/snippets/");
        expect(categoryToFolder("PLUGIN_MAIN", ".obsidian")).toBe(".obsidian/plugins/");
        expect(categoryToFolder("UNKNOWN", ".obsidian")).toBe("");
    });

    it("should correctly identify file categories", () => {
        const configDir = ".obsidian";
        expect(getFileCategory(".obsidian/appearance.json", configDir, false, false)).toBe("CONFIG");
        expect(getFileCategory(".obsidian/themes/my-theme/manifest.json", configDir, false, false)).toBe("THEME");
        expect(getFileCategory(".obsidian/snippets/my-style.css", configDir, false, false)).toBe("SNIPPET");
        expect(getFileCategory(".obsidian/plugins/my-plugin/manifest.json", configDir, false, false)).toBe(
            "PLUGIN_MAIN"
        );
        expect(getFileCategory(".obsidian/plugins/my-plugin/data.json", configDir, false, false)).toBe("PLUGIN_DATA");
        expect(getFileCategory(".obsidian/plugins/my-plugin/extra.json", configDir, true, true)).toBe("PLUGIN_ETC");
        expect(getFileCategory(".obsidian/plugins/my-plugin/extra.json", configDir, false, false)).toBe("");
    });

    it("should determine if a path is a target for synchronisation", () => {
        const configDir = ".obsidian";
        expect(isTargetPath(".obsidian/appearance.json", configDir, false, false)).toBe(true);
        expect(isTargetPath("some/other/file.md", configDir, false, false)).toBe(false);
    });

    it("should generate correct unified keys", () => {
        const configDir = ".obsidian";
        const term = "my-device";

        expect(filenameToUnifiedKey(".obsidian/appearance.json", term, configDir, false, false)).toBe(
            "ix:my-device/CONFIG/appearance.json.md"
        );

        expect(filenameWithUnifiedKey(".obsidian/plugins/my-plugin/data.json", term, configDir, true, false)).toBe(
            "ix:my-device/PLUGIN_DATA/my-plugin%data.json"
        );
    });

    it("should return the unified key prefix for a device", () => {
        expect(unifiedKeyPrefixOfTerminal("my-device")).toBe("ix:my-device/");
    });

    it("should parse V2 unified paths correctly", () => {
        const path = "ix:my-device/PLUGIN_DATA/my-plugin%data.json" as any;
        const parsed = parseUnifiedPath(path);
        expect(parsed.device).toBe("my-device");
        expect(parsed.category).toBe("PLUGIN_DATA");
        expect(parsed.key).toBe("my-plugin");
        expect(parsed.filename).toBe("data.json");
    });
});

describe("Configuration Synchronisation - State Factory", () => {
    it("should create an initial state with default values", () => {
        const state = createConfigSyncState();
        expect(state.pluginList).toEqual([]);
        expect(state.pluginDialog).toBeUndefined();
        expect(state.periodicPluginSweepProcessor).toBeUndefined();
        expect(state.conflictResolutionProcessor).toBeUndefined();
        expect(state.loadedManifest_mTime).toBeInstanceOf(Map);
        expect(state.loadedManifest_mTime.size).toBe(0);
        expect(state.updatingV2Count).toBe(0);
        expect(state.updatePluginListV2Task).toBeUndefined();
        expect(state.pluginScanProcessor).toBeUndefined();
        expect(state.pluginScanProcessorV2).toBeUndefined();
        expect(state.recentProcessedInternalFiles).toEqual([]);
    });
});

describe("PluginDataExDisplayV2", () => {
    it("should initialise from an IPluginDataExDisplay", () => {
        const data: IPluginDataExDisplay = {
            documentPath: "_livesync_customisation/my-device/PLUGIN_DATA/my-plugin.md" as any,
            category: "PLUGIN_DATA",
            name: "my-plugin",
            term: "my-device",
            files: [],
            mtime: 0,
        };

        const display = new PluginDataExDisplayV2(data);
        expect(display.name).toBe("my-plugin");
        expect(display.displayName).toBe("my-plugin");
        expect(display.category).toBe("PLUGIN_DATA");
        expect(display.term).toBe("my-device");
    });

    it("should handle setting and deleting files", async () => {
        const data: IPluginDataExDisplay = {
            documentPath: "_livesync_customisation/my-device/PLUGIN_DATA/my-plugin.md" as any,
            category: "PLUGIN_DATA",
            name: "my-plugin",
            term: "my-device",
            files: [],
            mtime: 0,
        };

        const display = new PluginDataExDisplayV2(data);

        const mockFile = {
            filename: "data.json",
            mtime: 1000,
            data: ["{}"],
            hash: "123",
            size: 2,
        } as any;

        await display.setFile(mockFile);
        expect(display.files.length).toBe(1);
        expect(display.mtime).toBe(1000);

        display.deleteFile("data.json");
        expect(display.files.length).toBe(0);
    });

    it("should not duplicate files when setFile is called with the same filename and content", async () => {
        const data: IPluginDataExDisplay = {
            documentPath: "_livesync_customisation/my-device/CONFIG/test.md" as any,
            category: "CONFIG",
            name: "test",
            term: "my-device",
            files: [],
            mtime: 0,
        };

        const display = new PluginDataExDisplayV2(data);

        const file1 = { filename: "config.json", mtime: 500, data: ['{"a":1}'], hash: "abc", size: 7 } as any;
        const file2 = { filename: "config.json", mtime: 500, data: ['{"a":1}'], hash: "abc", size: 7 } as any;

        await display.setFile(file1);
        await display.setFile(file2);
        expect(display.files.length).toBe(1);
    });

    it("should replace file when content differs for the same filename", async () => {
        const data: IPluginDataExDisplay = {
            documentPath: "_livesync_customisation/my-device/CONFIG/test.md" as any,
            category: "CONFIG",
            name: "test",
            term: "my-device",
            files: [],
            mtime: 0,
        };

        const display = new PluginDataExDisplayV2(data);

        const file1 = { filename: "config.json", mtime: 500, data: ['{"a":1}'], hash: "abc", size: 7 } as any;
        const file2 = { filename: "config.json", mtime: 600, data: ['{"a":2}'], hash: "def", size: 7 } as any;

        await display.setFile(file1);
        await display.setFile(file2);
        expect(display.files.length).toBe(1);
        expect(display.files[0].mtime).toBe(600);
    });
});

describe("Serialisation and Deserialisation", () => {
    it("should serialise and deserialise plug-in data round-trip", () => {
        const original = {
            category: "CONFIG",
            name: "test-config",
            term: "test-device",
            version: "1.0.0",
            mtime: 123456,
            files: [
                {
                    filename: "appearance.json",
                    displayName: "Appearance Settings",
                    version: "1.0.0",
                    mtime: 123456,
                    size: 15,
                    data: ['{"theme":"dark"}'],
                },
            ],
        };

        const serialisedString = serialize(original);
        const deserialised = deserialize([serialisedString], {});

        expect(deserialised.category).toBe(original.category);
        expect(deserialised.name).toBe(original.name);
        expect(deserialised.term).toBe(original.term);
        expect(deserialised.version).toBe(original.version);
        expect(deserialised.mtime).toBe(original.mtime);
        expect(deserialised.files.length).toBe(original.files.length);
        expect(deserialised.files[0].filename).toBe(original.files[0].filename);
        expect(deserialised.files[0].displayName).toBe(original.files[0].displayName);
    });

    it("should handle data with multiple files", () => {
        const original = {
            category: "PLUGIN_MAIN",
            name: "my-plugin",
            term: "device-A",
            mtime: 999,
            files: [
                { filename: "manifest.json", mtime: 100, size: 10, data: ['{"id":"my-plugin"}'] },
                { filename: "main.js", mtime: 200, size: 500, data: ["console.log('hello')"] },
                { filename: "styles.css", mtime: 300, size: 50, data: ["body { }"] },
            ],
        };

        const serialisedString = serialize(original);
        const deserialised = deserialize([serialisedString], {});

        expect(deserialised.files.length).toBe(3);
        expect(deserialised.files[0].filename).toBe("manifest.json");
        expect(deserialised.files[1].filename).toBe("main.js");
        expect(deserialised.files[2].filename).toBe("styles.css");
    });

    it("should handle empty file list", () => {
        const original = {
            category: "SNIPPET",
            name: "empty-snippet",
            term: "device-B",
            mtime: 0,
            files: [],
        };

        const serialisedString = serialize(original);
        const deserialised = deserialize([serialisedString], {});

        expect(deserialised.category).toBe("SNIPPET");
        expect(deserialised.name).toBe("empty-snippet");
        expect(deserialised.files.length).toBe(0);
    });
});

describe("Configuration Synchronisation - Commands Registration", () => {
    it("should register command and ribbon icon", () => {
        const host = createHostMock();
        host.services.API.addCommand = vi.fn();
        host.services.API.addRibbonIcon = vi.fn(() => ({
            addClass: vi.fn(() => ({
                toggleClass: vi.fn(),
            })),
        })) as any;

        const handlers = {
            showPluginSyncModal: vi.fn(),
        };

        registerConfigSyncCommands(host, handlers);

        expect(host.services.API.addCommand).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "livesync-plugin-dialog-ex",
            })
        );
        expect(host.services.API.addRibbonIcon).toHaveBeenCalled();

        // Trigger command callback
        const addCommandCall = (host.services.API.addCommand as any).mock.calls[0][0];
        addCommandCall.callback();
        expect(handlers.showPluginSyncModal).toHaveBeenCalled();
    });
});

describe("Configuration Synchronisation - Event Bindings", () => {
    let host: ReturnType<typeof createHostMock>;
    let log: any;
    let state: any;
    let handlers: any;

    beforeEach(() => {
        host = createHostMock();
        log = createLoggerMock();
        state = createConfigSyncState();
        handlers = {
            showPluginSyncModal: vi.fn(),
            watchVaultRawEventsAsync: vi.fn(),
        };
    });

    it("should bind handlers on initialise", () => {
        bindConfigSyncEvents(host, log, state, handlers);

        expect(host.services.fileProcessing.processOptionalFileEvent.addHandler).toHaveBeenCalled();
        expect(host.services.conflict.getOptionalConflictCheckMethod.addHandler).toHaveBeenCalled();
        expect(host.services.replication.processVirtualDocument.addHandler).toHaveBeenCalled();
    });

    it("should return newer conflict check method for plugin meta paths", async () => {
        bindConfigSyncEvents(host, log, state, handlers);

        const checkMethodHandler = (host.services.conflict.getOptionalConflictCheckMethod.addHandler as any).mock
            .calls[0][0];

        const res1 = await checkMethodHandler("ix:device/PLUGIN_DATA/plugin.md");
        expect(res1).toBe("newer");

        const res2 = await checkMethodHandler("some/other/file.md");
        expect(res2).toBe(false);
    });

    it("should configure config sync on DISABLE mode", async () => {
        host.services.setting.applyPartial = vi.fn();

        await configureHiddenFileSync(host, log, state, "DISABLE");
        expect(host.services.setting.applyPartial).toHaveBeenCalledWith(
            expect.objectContaining({ usePluginSync: false }),
            true
        );
    });

    it("should configure config sync on CUSTOMIZE mode with set device name", async () => {
        host.services.setting.applyPartial = vi.fn();
        host.services.setting.getDeviceAndVaultName = vi.fn(() => "existing-device");
        host.services.setting.setDeviceAndVaultName = vi.fn();

        await configureHiddenFileSync(host, log, state, "CUSTOMIZE");
        expect(host.services.setting.setDeviceAndVaultName).not.toHaveBeenCalled();
        expect(host.services.setting.applyPartial).toHaveBeenCalledWith(
            expect.objectContaining({ usePluginSync: true }),
            true
        );
    });
});

describe("Configuration Synchronisation - Feature Hook", () => {
    it("should bootstrap correctly", () => {
        const host = createHostMock();
        host.context = {
            app: {} as any,
            plugin: {} as any,
            liveSyncPlugin: {} as any,
        } as any;

        useConfigSync(host as any);

        expect(host.services.fileProcessing.processOptionalFileEvent.addHandler).toHaveBeenCalled();
    });
});
