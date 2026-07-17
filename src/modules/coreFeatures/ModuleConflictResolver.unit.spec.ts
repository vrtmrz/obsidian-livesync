import { describe, expect, it, vi } from "vitest";
import {
    DEFAULT_SETTINGS,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    type FilePathWithPrefix,
    type MetaEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ModuleConflictResolver } from "./ModuleConflictResolver";

function createModule(files: FilePathWithPrefix[] = []) {
    const core = {
        _services: {
            API: {
                addLog: vi.fn(),
                addCommand: vi.fn(),
                registerWindow: vi.fn(),
                addRibbonIcon: vi.fn(),
                registerProtocolHandler: vi.fn(),
            },
            setting: {
                saveSettingData: vi.fn(async () => undefined),
            },
            conflict: {
                resolveByNewest: vi.fn(async () => true),
            },
        },
        settings: DEFAULT_SETTINGS,
        fileHandler: {
            deleteRevisionFromDB: vi.fn(async () => true),
            dbToStorage: vi.fn(async () => true),
        },
        databaseFileAccess: {
            getConflictedRevs: vi.fn(async () => []),
        },
        storageAccess: {
            getFileNames: vi.fn(async () => files),
        },
    } as any;
    Object.defineProperty(core, "services", { get: () => core._services });

    const module = new ModuleConflictResolver(core);
    module._log = vi.fn();
    return { module };
}

describe("ModuleConflictResolver bulk newest resolution", () => {
    it("retains the success notice for a non-bulk newest resolution", async () => {
        const { module } = createModule();
        const path = "example.md" as FilePathWithPrefix;
        module.core.databaseFileAccess.fetchEntryMeta = vi.fn(
            async (_path: unknown, rev?: string): Promise<MetaEntry> =>
                ({
                    _id: "doc-id",
                    _rev: rev ?? "2-current",
                    path,
                    ctime: 1,
                    mtime: rev ? 1 : 2,
                    size: 0,
                    children: [],
                    type: "plain",
                    eden: {},
                }) as unknown as MetaEntry
        );
        module.core.databaseFileAccess.getConflictedRevs = vi
            .fn()
            .mockResolvedValueOnce(["1-old"])
            .mockResolvedValue([]);

        await (module as any)._anyResolveConflictByNewest(path);

        expect(module._log).toHaveBeenLastCalledWith(`${path} has been merged automatically`, LOG_LEVEL_NOTICE);
    });

    it("logs a successful bulk newest resolution without displaying a notice", async () => {
        const { module } = createModule();
        const path = "example.md" as FilePathWithPrefix;
        module.core.databaseFileAccess.fetchEntryMeta = vi.fn(
            async (_path: unknown, rev?: string): Promise<MetaEntry> =>
                ({
                    _id: "doc-id",
                    _rev: rev ?? "2-current",
                    path,
                    ctime: 1,
                    mtime: rev ? 1 : 2,
                    size: 0,
                    children: [],
                    type: "plain",
                    eden: {},
                }) as unknown as MetaEntry
        );
        module.core.databaseFileAccess.getConflictedRevs = vi
            .fn()
            .mockResolvedValueOnce(["1-old"])
            .mockResolvedValue([]);

        await (module as any)._anyResolveConflictByNewest(path, false);

        expect(module._log).toHaveBeenLastCalledWith(`${path} has been merged automatically`, LOG_LEVEL_INFO);
    });

    it("updates notice-level progress once every ten checked files", async () => {
        const files = Array.from({ length: 11 }, (_, index) => `note-${index}.md` as FilePathWithPrefix);
        const { module } = createModule(files);
        const resolveByNewest = vi.spyOn(module as any, "_anyResolveConflictByNewest").mockResolvedValue(true);

        await (module as any)._resolveAllConflictedFilesByNewerOnes();

        expect(resolveByNewest).toHaveBeenCalledTimes(11);
        expect(resolveByNewest).toHaveBeenCalledWith(files[0], false);
        expect(module._log).toHaveBeenCalledWith(
            "Check and Processing 10 / 11",
            LOG_LEVEL_NOTICE,
            "resolveAllConflictedFilesByNewerOnes"
        );
        expect(module._log).toHaveBeenCalledTimes(3);
    });
});
