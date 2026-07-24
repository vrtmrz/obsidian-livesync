import { describe, expect, it, vi } from "vitest";

vi.mock("octagonal-wheels/number", () => ({
    sizeToHumanReadable: vi.fn((value: number) => `${value} B`),
}));
vi.mock("octagonal-wheels/concurrency/lock_v2", () => ({
    serialized: vi.fn((_key: string, task: () => unknown) => task()),
}));
vi.mock("octagonal-wheels/collection", () => ({
    arrayToChunkedArray: vi.fn((values: unknown[]) => [values]),
}));
vi.mock("@/features/LiveSyncCommands", () => ({
    LiveSyncCommands: class LiveSyncCommands {
        core!: { settings: unknown };
        get settings() {
            return this.core.settings;
        }
    },
}));
vi.mock("@/common/events", () => ({
    EVENT_ANALYSE_DB_USAGE: "analyse",
    EVENT_REQUEST_PERFORM_GC_V3: "gc",
    eventHub: {
        onEvent: vi.fn(),
    },
}));
import {
    DEFAULT_SETTINGS,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    REMOTE_P2P,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LocalDatabaseMaintenance } from "./CmdLocalDatabaseMainte";
import { ensureLocalDatabaseMaintenancePrerequisites } from "./maintenancePrerequisites";

function createPrerequisites(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
    const askSelectStringDialogue = vi.fn(
        async (
            _message: string,
            _buttons: readonly ["Apply and continue", "Cancel"],
            _options: { title: string; defaultAction: "Cancel" }
        ): Promise<"Apply and continue" | "Cancel" | false | undefined> => "Apply and continue"
    );
    const applyPartial = vi.fn(async () => undefined);
    const settings = {
        ...DEFAULT_SETTINGS,
        doNotUseFixedRevisionForChunks: false,
        readChunksOnline: true,
        ...settingsOverride,
    };

    return { settings, askSelectStringDialogue, applyPartial };
}

describe("LocalDatabaseMaintenance prerequisites", () => {
    it("shows database analysis in Advanced mode and Garbage Collection only in applicable Edge Case mode", () => {
        const commands: Array<{
            id: string;
            checkCallback?: (checking: boolean) => boolean | void;
        }> = [];
        const settings: {
            useAdvancedMode: boolean;
            useEdgeCaseMode: boolean;
            remoteType: string;
        } = {
            useAdvancedMode: false,
            useEdgeCaseMode: false,
            remoteType: REMOTE_COUCHDB,
        };
        const maintenance = Object.create(LocalDatabaseMaintenance.prototype) as LocalDatabaseMaintenance;
        Object.assign(maintenance, {
            plugin: {
                addCommand: vi.fn((command) => commands.push(command)),
            },
            core: {
                settings,
            },
            _isDatabaseReady: vi.fn(() => true),
        });

        maintenance.onload();

        const analyse = commands.find(({ id }) => id === "analyse-database");
        const garbageCollect = commands.find(({ id }) => id === "gc-v3");
        expect(analyse?.checkCallback?.(true)).toBe(false);
        expect(garbageCollect?.checkCallback?.(true)).toBe(false);

        settings.useAdvancedMode = true;
        expect(analyse?.checkCallback?.(true)).toBe(true);
        expect(garbageCollect?.checkCallback?.(true)).toBe(false);

        settings.useEdgeCaseMode = true;
        expect(garbageCollect?.checkCallback?.(true)).toBe(true);

        settings.remoteType = REMOTE_P2P;
        expect(garbageCollect?.checkCallback?.(true)).toBe(false);

        settings.remoteType = REMOTE_MINIO;
        expect(garbageCollect?.checkCallback?.(true)).toBe(false);
    });

    it("asks to disable on-demand chunk fetching before maintenance actions", async () => {
        const { settings, askSelectStringDialogue, applyPartial } = createPrerequisites();

        const result = await ensureLocalDatabaseMaintenancePrerequisites({
            operationName: "Garbage Collection",
            settings: {
                readChunksOnline: settings.readChunksOnline,
            },
            askSelectStringDialogue,
            applyPartial,
        });

        expect(result).toBe(true);
        expect(askSelectStringDialogue).toHaveBeenCalledWith(
            expect.stringContaining("Garbage Collection requires the following settings"),
            ["Apply and continue", "Cancel"],
            {
                title: "Garbage Collection prerequisites",
                defaultAction: "Cancel",
            }
        );
        expect(applyPartial).toHaveBeenCalledWith(
            {
                readChunksOnline: false,
            },
            true
        );
        expect(vi.mocked(askSelectStringDialogue).mock.calls[0]?.[0]).not.toContain("Compute revisions for chunks");
    });

    it("cancels maintenance actions when prerequisite changes are rejected", async () => {
        const { settings, askSelectStringDialogue, applyPartial } = createPrerequisites();
        askSelectStringDialogue.mockResolvedValueOnce("Cancel");

        const result = await ensureLocalDatabaseMaintenancePrerequisites({
            operationName: "Garbage Collection",
            settings: {
                readChunksOnline: settings.readChunksOnline,
            },
            askSelectStringDialogue,
            applyPartial,
        });

        expect(result).toBe(false);
        expect(applyPartial).not.toHaveBeenCalled();
    });

    it("continues without asking when prerequisite settings already match", async () => {
        const { settings, askSelectStringDialogue, applyPartial } = createPrerequisites({
            doNotUseFixedRevisionForChunks: true,
            readChunksOnline: false,
        });

        const result = await ensureLocalDatabaseMaintenancePrerequisites({
            operationName: "Garbage Collection",
            settings: {
                readChunksOnline: settings.readChunksOnline,
            },
            askSelectStringDialogue,
            applyPartial,
        });

        expect(askSelectStringDialogue).not.toHaveBeenCalled();
        expect(applyPartial).not.toHaveBeenCalled();
    });

    it("retirement guard: ignores the obsolete fixed-revision key as a maintenance prerequisite", async () => {
        const { settings, askSelectStringDialogue, applyPartial } = createPrerequisites({
            doNotUseFixedRevisionForChunks: false,
            readChunksOnline: false,
        });

        const result = await ensureLocalDatabaseMaintenancePrerequisites({
            operationName: "Garbage Collection",
            settings: {
                readChunksOnline: settings.readChunksOnline,
            },
            askSelectStringDialogue,
            applyPartial,
        });

        expect(result).toBe(true);
        expect(askSelectStringDialogue).not.toHaveBeenCalled();
        expect(applyPartial).not.toHaveBeenCalled();
    });

    it("describes the current chunk-recreation action without promising historical recovery", async () => {
        const maintenance = Object.create(LocalDatabaseMaintenance.prototype) as LocalDatabaseMaintenance;
        const askSelectStringDialogue = vi.fn().mockResolvedValue("Cancel");
        Object.assign(maintenance, {
            core: {
                confirm: {
                    askSelectStringDialogue,
                },
            },
            _log: vi.fn(),
        });
        vi.spyOn(maintenance, "ensureAvailable").mockResolvedValue(true);
        vi.spyOn(maintenance, "trackChanges").mockResolvedValue(undefined);

        await maintenance.performGC();

        const message = vi.mocked(askSelectStringDialogue).mock.calls[0]?.[0] as string;
        expect(message).toContain("Hatch -> Recreate chunks for current Vault files");
        expect(message).toContain("only from files currently present in the Vault");
        expect(message).not.toContain("Recreate missing chunks for all files");
    });
});

describe("LocalDatabaseMaintenance Garbage Collection V3", () => {
    it("keeps chunks referenced by a live conflict revision and deletes only unreachable chunks", async () => {
        const maintenance = Object.create(LocalDatabaseMaintenance.prototype) as LocalDatabaseMaintenance;
        const pushModes: string[] = [];
        const deletedChunks: Array<{ _id: string; _rev?: string; _deleted?: boolean }> = [];
        const allChunks = vi.fn(async () => ({
            used: new Set(["h:winner", "h:conflict"]),
            existing: new Map([
                ["h:winner", { _id: "h:winner", _rev: "1-winner", type: "leaf", data: "winner" }],
                ["h:conflict", { _id: "h:conflict", _rev: "1-conflict", type: "leaf", data: "conflict" }],
                ["h:obsolete", { _id: "h:obsolete", _rev: "1-obsolete", type: "leaf", data: "obsolete" }],
            ]),
        }));
        const rawDocuments = new Map<string, object>([
            [
                "note.md",
                {
                    _id: "note.md",
                    _rev: "2-winner",
                    _conflicts: ["2-conflict"],
                    type: "plain",
                    children: ["h:winner"],
                },
            ],
            ["h:winner", { _id: "h:winner", _rev: "1-winner", type: "leaf", data: "winner" }],
            ["h:conflict", { _id: "h:conflict", _rev: "1-conflict", type: "leaf", data: "conflict" }],
            ["h:obsolete", { _id: "h:obsolete", _rev: "1-obsolete", type: "leaf", data: "obsolete" }],
        ]);
        const findEntryNames = vi.fn(async function* () {
            yield* rawDocuments.keys();
        });
        const getRaw = vi.fn(async (id: string) => rawDocuments.get(id));
        const localDatabase = {
            allChunks,
            localDatabase: {
                info: vi.fn(async () => ({ doc_count: rawDocuments.size })),
                bulkDocs: vi.fn(async (docs: Array<{ _id: string; _rev?: string; _deleted?: boolean }>) => {
                    deletedChunks.push(...docs);
                    return docs.map(({ _id }) => ({ ok: true, id: _id, rev: "2-deleted" }));
                }),
            },
            findEntryNames,
            getRaw,
        };
        const replicator = {
            openOneShotReplication: vi.fn(
                async (
                    _settings: typeof DEFAULT_SETTINGS,
                    _showResult: boolean,
                    _ignoreCleanLock: boolean,
                    mode: string
                ) => {
                    pushModes.push(mode);
                    return true;
                }
            ),
            getConnectedDeviceList: vi.fn(async () => ({
                accepted_nodes: ["device-a"],
                node_info: {
                    "device-a": {
                        progress: "10-local",
                        device_name: "Device A",
                        app_version: "1.12.7",
                        plugin_version: "1.0.0-beta.0",
                    },
                },
            })),
        };
        Object.assign(maintenance, {
            core: {
                settings: {
                    ...DEFAULT_SETTINGS,
                    remoteType: REMOTE_COUCHDB,
                },
                replicator,
                confirm: {
                    askSelectStringDialogue: vi.fn(async () => "Proceed Garbage Collection"),
                },
            },
            localDatabase,
            _notice: vi.fn(),
        });
        vi.spyOn(maintenance, "ensureAvailable").mockResolvedValue(true);
        vi.spyOn(maintenance, "compactDatabase").mockResolvedValue(undefined);
        vi.spyOn(maintenance, "clearHash").mockImplementation(() => undefined);

        await maintenance.gcv3();

        expect(allChunks).toHaveBeenCalledOnce();
        expect(findEntryNames).not.toHaveBeenCalled();
        expect(getRaw).not.toHaveBeenCalled();
        expect(deletedChunks).toEqual([
            {
                _id: "h:obsolete",
                _rev: "1-obsolete",
                _deleted: true,
            },
        ]);
        expect(pushModes).toEqual(["sync", "pushOnly"]);
        expect(maintenance.compactDatabase).toHaveBeenCalledOnce();
    });
});
