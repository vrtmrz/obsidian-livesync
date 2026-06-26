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
    App: class MockApp {},
    ItemView: class MockItemView {},
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
import type { DatabaseMaintenanceHost } from "./types";
import { LOG_LEVEL_NOTICE, EntryTypes } from "@lib/common/types.ts";
import { eventHub, EVENT_ANALYSE_DB_USAGE, EVENT_REQUEST_PERFORM_GC_V3 } from "@/common/events.ts";
import { isGCAvailable, confirmDialogue, retrieveAllChunks } from "./utils";
import { compactDatabase } from "./compaction";
import { analyseDatabase } from "./diagnostics";
import { registerDatabaseMaintenanceCommands } from "./commands";
import {
    resurrectChunks,
    commitFileDeletion,
    commitChunkDeletion,
    markUnusedChunks,
    removeUnusedChunks,
    scanUnusedChunks,
    trackChanges,
    performGC,
    gcv3,
} from "./garbageCollection";
import { useDatabaseMaintenance } from "./index";

const createLoggerMock = (): LogFunction => vi.fn();

const createDatabaseMock = () => {
    return {
        allChunks: vi.fn(async (includeDeleted: boolean) => ({
            used: new Set(["chunk1", "chunk2"]),
            existing: new Map([
                ["chunk1", { _id: "chunk1", _rev: "1-abc", data: "data1", _deleted: false }],
                ["chunk2", { _id: "chunk2", _rev: "1-def", data: "", _deleted: true }],
            ]),
        })),
        localDatabase: {
            info: vi.fn(async () => ({ doc_count: 10, update_seq: 100 })),
            get: vi.fn(async (id: string, options?: any) => {
                if (id.startsWith("chunk")) {
                    return {
                        _id: id,
                        _rev: options?.rev || "1-xxx",
                        type: EntryTypes.CHUNK,
                        data: "chunk_data",
                    };
                }
                return {
                    _id: id,
                    _rev: options?.rev || "1-xxx",
                    type: "newnote",
                    children: ["chunk1"],
                    path: "test-note.md",
                };
            }),
            bulkDocs: vi.fn(async (docs: any[]) => docs.map((d) => ({ ok: true, id: d._id }))),
            changes: vi.fn(() => ({
                on: vi.fn(function (this: any, event: string, cb: any) {
                    if (event === "complete") {
                        cb({ last_seq: 100 });
                    }
                    return this;
                }),
            })),
            allDocs: vi.fn(async () => ({ rows: [] })),
        },
        clearCaches: vi.fn(),
        findEntryNames: vi.fn(() => ({
            [Symbol.asyncIterator]() {
                let idx = 0;
                const items = ["doc1", "chunk1"];
                return {
                    async next() {
                        if (idx < items.length) {
                            return { value: items[idx++], done: false };
                        }
                        return { done: true };
                    },
                };
            },
        })),
        getRaw: vi.fn(async (id: string) => ({
            _id: id,
            _rev: "1-xxx",
            _revs_info: [{ rev: "1-xxx", status: "available" }],
            children: id.startsWith("chunk") ? undefined : ["chunk1"],
            type: id.startsWith("chunk") ? EntryTypes.CHUNK : "newnote",
            data: id.startsWith("chunk") ? "chunk_data" : "revdata",
        })),
    };
};

const createSettingServiceMock = () => {
    const settings = {
        doNotUseFixedRevisionForChunks: true,
        readChunksOnline: false,
    };
    return {
        settings,
        currentSettings: vi.fn(() => settings),
    };
};

const createUIMock = () => {
    return {
        confirm: {
            askSelectStringDialogue: vi.fn(async () => "Yes"),
        },
        promptCopyToClipboard: vi.fn(async () => {}),
    };
};

const createReplicatorMock = () => {
    const mockReplicatorInstance = {
        connectRemoteCouchDBWithSetting: vi.fn(async () => ({
            db: {
                compact: vi.fn(async () => ({ ok: true })),
                info: vi.fn(async () => ({ compact_running: false })),
            },
        })),
        openOneShotReplication: vi.fn(async () => true),
        getConnectedDeviceList: vi.fn(async () => ({
            accepted_nodes: ["node1"],
            node_info: {
                node1: {
                    device_name: "Device 1",
                    app_version: "1.0",
                    plugin_version: "1.0",
                    progress: "100-abc",
                },
            },
        })),
    };
    return {
        getActiveReplicator: vi.fn(() => mockReplicatorInstance),
    };
};

const createHostMock = (): DatabaseMaintenanceHost => {
    const database = createDatabaseMock();
    const setting = createSettingServiceMock();
    const ui = createUIMock();
    const replicator = createReplicatorMock();

    return {
        context: {
            plugin: {
                addCommand: vi.fn(),
            },
        },
        services: {
            API: {
                setInterval: vi.fn(() => 123),
                clearInterval: vi.fn(),
                addLog: vi.fn(),
            } as any,
            setting,
            UI: ui,
            database: {
                localDatabase: database,
            } as any,
            keyValueDB: {
                kvDB: {
                    get: vi.fn(async () => null),
                    set: vi.fn(async () => {}),
                },
            } as any,
            replication: {} as any,
            replicator: replicator as any,
        },
        serviceModules: {
            storageAccess: {} as any,
        },
    } as unknown as DatabaseMaintenanceHost;
};

describe("Database Maintenance - Settings and Availability Checks", () => {
    it("should return true for isGCAvailable when settings are correct", () => {
        const host = createHostMock();
        const log = createLoggerMock();
        expect(isGCAvailable(host, log)).toBe(true);
    });

    it("should return false for isGCAvailable when doNotUseFixedRevisionForChunks is disabled", () => {
        const host = createHostMock();
        const log = createLoggerMock();
        host.services.setting.currentSettings().doNotUseFixedRevisionForChunks = false;
        expect(isGCAvailable(host, log)).toBe(false);
    });

    it("should return false for isGCAvailable when readChunksOnline is enabled", () => {
        const host = createHostMock();
        const log = createLoggerMock();
        host.services.setting.currentSettings().readChunksOnline = true;
        expect(isGCAvailable(host, log)).toBe(false);
    });
});

describe("Database Maintenance - Confirmation Dialogue Helper", () => {
    it("should resolve to true when user selects affirmative option", async () => {
        const host = createHostMock();
        (host.services.UI.confirm.askSelectStringDialogue as any).mockResolvedValue("Yes");
        const res = await confirmDialogue(host, "Title", "Message", "Yes", "No");
        expect(res).toBe(true);
    });

    it("should resolve to false when user selects negative option", async () => {
        const host = createHostMock();
        (host.services.UI.confirm.askSelectStringDialogue as any).mockResolvedValue("No");
        const res = await confirmDialogue(host, "Title", "Message", "Yes", "No");
        expect(res).toBe(false);
    });
});

describe("Database Maintenance - Retrieve Chunks Utility", () => {
    it("should correctly trigger the database retrieve process", async () => {
        const host = createHostMock();
        const log = createLoggerMock();
        const res = await retrieveAllChunks(host, log, false);
        expect(host.services.database.localDatabase.allChunks).toHaveBeenCalledWith(false);
        expect(res.used.size).toBe(2);
    });
});

describe("Database Maintenance - Database Compaction", () => {
    it("should connect to remote database and run compact process", async () => {
        const host = createHostMock();
        const log = createLoggerMock();
        await compactDatabase(host, log);
        const activeReplicator = host.services.replicator.getActiveReplicator() as any;
        expect(activeReplicator?.connectRemoteCouchDBWithSetting).toHaveBeenCalled();
    });
});

describe("Database Maintenance - registerDatabaseMaintenanceCommands", () => {
    it("should register commands and event listeners", async () => {
        const addCommand = vi.fn();
        const host = createHostMock();
        (host.context as any) = {
            plugin: {
                addCommand,
            },
        };
        const log = createLoggerMock();

        registerDatabaseMaintenanceCommands(host, log);

        expect(addCommand).toHaveBeenCalledTimes(3);
        expect(addCommand).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                id: "analyse-database",
                name: "Analyse Database Usage (advanced)",
            })
        );
        expect(addCommand).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                id: "gc-v3",
                name: "Garbage Collection V3 (advanced, beta)",
            })
        );
    });

    it("should execute analysis and garbage collection via event hub triggers", async () => {
        const host = createHostMock();
        const log = createLoggerMock();

        const promptSpy = vi.spyOn(host.services.UI, "promptCopyToClipboard");

        registerDatabaseMaintenanceCommands(host, log);

        eventHub.emitEvent(EVENT_ANALYSE_DB_USAGE);

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(promptSpy).toHaveBeenCalled();
    });

    it("should execute registerDatabaseMaintenanceCommands command callbacks", async () => {
        const addCommand = vi.fn();
        const host = createHostMock();
        (host.context as any) = {
            plugin: {
                addCommand,
            },
        };
        const log = createLoggerMock();
        (host.services as any).vault = {
            scanVault: vi.fn().mockResolvedValue(true),
        };

        registerDatabaseMaintenanceCommands(host, log);

        const analyseCmd = addCommand.mock.calls.find((c) => c[0].id === "analyse-database")![0];
        const gcCmd = addCommand.mock.calls.find((c) => c[0].id === "gc-v3")![0];
        const scanCmd = addCommand.mock.calls.find((c) => c[0].id === "livesync-scan-files")![0];

        const promptSpy = vi.spyOn(host.services.UI, "promptCopyToClipboard");
        await analyseCmd.callback();
        expect(promptSpy).toHaveBeenCalled();

        const selectSpy = vi
            .spyOn(host.services.UI.confirm, "askSelectStringDialogue")
            .mockResolvedValue("Cancel Garbage Collection");
        await gcCmd.callback();
        expect(selectSpy).toHaveBeenCalled();

        await scanCmd.callback();
        expect(host.services.vault.scanVault).toHaveBeenCalledWith(true);
    });

    it("should trigger garbage collection via EVENT_REQUEST_PERFORM_GC_V3 trigger", async () => {
        const host = createHostMock();
        const log = createLoggerMock();
        registerDatabaseMaintenanceCommands(host, log);

        const selectSpy = vi
            .spyOn(host.services.UI.confirm, "askSelectStringDialogue")
            .mockResolvedValue("Cancel Garbage Collection");
        eventHub.emitEvent(EVENT_REQUEST_PERFORM_GC_V3);

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(selectSpy).toHaveBeenCalled();
    });
});

describe("Database Maintenance - Diagnostics & analyseDatabase", () => {
    it("should perform a full analysis and copy the result to clipboard", async () => {
        const host = createHostMock();
        const log = createLoggerMock();
        const promptSpy = vi.spyOn(host.services.UI, "promptCopyToClipboard");

        (host.services.database.localDatabase.getRaw as any).mockResolvedValue({
            _id: "doc1",
            _rev: "1-xxx",
            _revs_info: [{ rev: "1-xxx", status: "available" }],
            children: ["chunk1"],
        });

        await analyseDatabase(host, log);

        expect(promptSpy).toHaveBeenCalledWith(
            "Database Analysis data (TSV):",
            expect.stringContaining("Title\tDocument ID\tPath\tRevision No\tRevision Hash")
        );
    });
});

describe("Database Maintenance - Garbage Collection V3 (gcv3)", () => {
    it("should run the gcv3 process to scan and delete unused chunks", async () => {
        const host = createHostMock();
        const log = createLoggerMock();

        (host.services.UI.confirm.askSelectStringDialogue as any).mockResolvedValue("Proceed Garbage Collection");

        (host.services.database.localDatabase.getRaw as any).mockImplementation(async (id: string) => {
            if (id === "chunk1") {
                return { _id: "chunk1", _rev: "1-xxx", type: EntryTypes.CHUNK };
            }
            return { _id: "doc1", _rev: "1-yyy", children: ["chunk2"] };
        });

        await gcv3(host, log);

        const db = host.services.database.localDatabase.localDatabase;
        expect(db.bulkDocs).toHaveBeenCalledWith([
            {
                _id: "chunk1",
                _deleted: true,
                _rev: "1-xxx",
            },
        ]);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("Garbage Collection completed"), LOG_LEVEL_NOTICE);
    });

    it("should abort garbage collection if one-shot replication fails to start", async () => {
        const host = createHostMock();
        const log = createLoggerMock();
        const replicator = host.services.replicator.getActiveReplicator() as any;
        replicator.openOneShotReplication.mockResolvedValue(false);

        await gcv3(host, log);

        expect(log).toHaveBeenCalledWith(
            "Failed to start one-shot replication before Garbage Collection. Garbage Collection Cancelled.",
            LOG_LEVEL_NOTICE
        );
    });

    it("should prompt user when connected nodes are missing node information", async () => {
        const host = createHostMock();
        const log = createLoggerMock();
        const replicator = host.services.replicator.getActiveReplicator() as any;

        replicator.getConnectedDeviceList.mockResolvedValue({
            accepted_nodes: ["node1"],
            node_info: {},
        });

        (host.services.UI.confirm.askSelectStringDialogue as any).mockResolvedValue("Cancel Garbage Collection");

        await gcv3(host, log);

        expect(host.services.UI.confirm.askSelectStringDialogue).toHaveBeenCalledWith(
            expect.stringContaining("missing its node information"),
            ["Cancel Garbage Collection", "Ignore and Proceed"],
            expect.any(Object)
        );
        expect(log).toHaveBeenCalledWith("Garbage Collection cancelled by user.", LOG_LEVEL_NOTICE);
    });
});

describe("Database Maintenance - Garbage Collection - resurrectChunks", () => {
    it("should resurrect chunks that are deleted but still referenced", async () => {
        const host = createHostMock();
        const log = createLoggerMock();
        const db = host.services.database.localDatabase.localDatabase;

        (host.services.database.localDatabase.allChunks as any).mockResolvedValue({
            used: new Set(["chunk1"]),
            existing: new Map([["chunk1", { _id: "chunk1", _rev: "1-xxx", data: "", _deleted: true }]]),
        });

        (db.get as any).mockImplementation(async (id: string, options?: any) => {
            if (options?.rev === "1-available") {
                return { type: "leaf", data: "resurrected_data" };
            }
            return {
                _revs_info: [{ rev: "1-available", status: "available" }],
            };
        });

        (host.services.UI.confirm.askSelectStringDialogue as any).mockResolvedValue("Resurrect");

        await resurrectChunks(host, log);

        expect(db.bulkDocs).toHaveBeenCalledWith([
            {
                _id: "chunk1",
                _rev: "1-xxx",
                data: "resurrected_data",
                _deleted: false,
            },
        ]);
        expect(log).toHaveBeenCalledWith("Resurrected chunks: 1 / 1", LOG_LEVEL_NOTICE);
    });
});

describe("Database Maintenance - Garbage Collection - commitFileDeletion", () => {
    it("should permanently delete files marked as deleted", async () => {
        const host = createHostMock();
        const log = createLoggerMock();
        const db = host.services.database.localDatabase.localDatabase;

        (db.allDocs as any).mockResolvedValue({
            rows: [
                {
                    id: "doc1",
                    doc: {
                        _id: "doc1",
                        type: "newnote",
                        deleted: true,
                    },
                },
            ],
        });

        (host.services.UI.confirm.askSelectStringDialogue as any).mockResolvedValue("Delete");

        await commitFileDeletion(host, log);

        expect(db.bulkDocs).toHaveBeenCalledWith([
            expect.objectContaining({
                _id: "doc1",
                _deleted: true,
            }),
        ]);
    });
});

describe("Database Maintenance - Garbage Collection - commitChunkDeletion & markUnusedChunks", () => {
    it("should permanently delete chunk documents", async () => {
        const host = createHostMock();
        const log = createLoggerMock();
        const db = host.services.database.localDatabase.localDatabase;

        (host.services.database.localDatabase.allChunks as any).mockResolvedValue({
            used: new Set([]),
            existing: new Map([["chunk1", { _id: "chunk1", _rev: "1-xxx", data: "chunk_data", _deleted: true }]]),
        });

        (host.services.UI.confirm.askSelectStringDialogue as any).mockResolvedValue("Delete");

        await commitChunkDeletion(host, log);

        expect(db.bulkDocs).toHaveBeenCalledWith([
            {
                _id: "chunk1",
                _rev: "1-xxx",
                data: "",
                _deleted: true,
            },
        ]);
    });

    it("should mark unused chunks as deleted", async () => {
        const host = createHostMock();
        const log = createLoggerMock();
        const db = host.services.database.localDatabase.localDatabase;

        (host.services.database.localDatabase.allChunks as any).mockResolvedValue({
            used: new Set([]),
            existing: new Map([["chunk1", { _id: "chunk1", _rev: "1-xxx", data: "chunk_data", _deleted: false }]]),
        });

        (host.services.UI.confirm.askSelectStringDialogue as any).mockResolvedValue("Mark");

        await markUnusedChunks(host, log);

        expect(db.bulkDocs).toHaveBeenCalledWith([
            {
                _id: "chunk1",
                _rev: "1-xxx",
                data: "chunk_data",
                _deleted: true,
            },
        ]);
    });
});

describe("Database Maintenance - useDatabaseMaintenance Hook", () => {
    it("should initialise database maintenance feature and return API methods", () => {
        const host = createHostMock();
        (host as any).context = {
            plugin: {
                addCommand: vi.fn(),
            },
        };
        const api = useDatabaseMaintenance(host);
        expect(api).toHaveProperty("gcv3");
        expect(api).toHaveProperty("analyseDatabase");
        expect(api).toHaveProperty("compactDatabase");
        expect(api).toHaveProperty("performGC");
    });
});
