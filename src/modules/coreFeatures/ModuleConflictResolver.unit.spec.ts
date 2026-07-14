import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, type FilePathWithPrefix } from "@lib/common/types";
import { ModuleConflictResolver } from "./ModuleConflictResolver";

function createModule(files: FilePathWithPrefix[] = []) {
    const resolveByNewest = vi.fn(async () => true);
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
                resolveByNewest,
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
    return { module, resolveByNewest };
}

describe("ModuleConflictResolver bulk newest resolution", () => {
    it("logs each successful newest resolution without displaying a notice", async () => {
        const { module } = createModule();
        const path = "example.md" as FilePathWithPrefix;

        await (module as any)._resolveConflictByDeletingRev(path, "2-old", "NEWEST");

        expect(module._log).toHaveBeenLastCalledWith(`${path} has been merged automatically`, LOG_LEVEL_INFO);
    });

    it("updates notice-level progress once every ten checked files", async () => {
        const files = Array.from({ length: 11 }, (_, index) => `note-${index}.md` as FilePathWithPrefix);
        const { module, resolveByNewest } = createModule(files);

        await (module as any)._resolveAllConflictedFilesByNewerOnes();

        expect(resolveByNewest).toHaveBeenCalledTimes(11);
        expect(module._log).toHaveBeenCalledWith(
            "Check and Processing 10 / 11",
            LOG_LEVEL_NOTICE,
            "resolveAllConflictedFilesByNewerOnes"
        );
        expect(module._log).toHaveBeenCalledTimes(3);
    });
});
