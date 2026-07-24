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
import { DEFAULT_SETTINGS, REMOTE_COUCHDB, REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/types";
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
});
