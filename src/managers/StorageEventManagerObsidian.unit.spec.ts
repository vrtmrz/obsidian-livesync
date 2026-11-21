import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    StorageEventManagerBase,
    type StorageEventManagerBaseDependencies,
} from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import { StorageEventManagerObsidian } from "./StorageEventManagerObsidian";
vi.mock("@/deps", () => ({ TFile: class {}, TFolder: class {} }));

afterEach(() => vi.restoreAllMocks());
describe("Obsidian internal file event admission", () => {
    it("wires isTargetInternalFile to vaultService.isTargetFile with internalFileEvent: true", async () => {
        const isTargetFile = vi.fn(async () => true);
        const dependencies = {
            vaultService: { isTargetFile },
            fileProcessing: {},
            setting: { currentSettings: () => ({}) },
            storageAccess: {},
            appLifecycle: {},
            context: {},
        } as unknown as StorageEventManagerBaseDependencies;
        const manager = new StorageEventManagerObsidian({} as any, {} as any, dependencies);
        const internalChecker = (manager as any).admission.isTargetInternal as (path: FilePath) => Promise<boolean>;

        await expect(internalChecker(".obsidian/snippets/a.css" as FilePath)).resolves.toBe(true);
        expect(isTargetFile).toHaveBeenCalledWith(".obsidian/snippets/a.css", { internalFileEvent: true });
    });

    it("admits config-directory files accepted by isTargetFileInExtra and rejects siblings and folders", async () => {
        const appendQueue = vi.fn();
        const isTargetFileInExtra = vi.fn(async (path: string) => path === ".obsidian/snippets/a.css");
        const receiver = {
            settings: {
                syncInternalFiles: false,
                usePluginSync: true,
                watchInternalFileChanges: true,
                handleFilenameCaseSensitive: true,
            },
            core: { services: { API: { getSystemConfigDir: () => ".obsidian" } } },
            vaultService: { isTargetFileInExtra, isStorageInsensitive: () => false },
            adapter: { converter: { toInternalFileInfo: (path: FilePath) => ({ path, isInternal: true }) } },
            appendQueue,
        };
        const watchRaw = (StorageEventManagerObsidian.prototype as any)._watchVaultRawEvents;

        await watchRaw.call(receiver, ".obsidian-other/snippets/a.css" as FilePath);
        await watchRaw.call(receiver, ".obsidian/snippets/" as FilePath);
        await watchRaw.call(receiver, ".obsidian/snippets/ignored.css" as FilePath);
        await watchRaw.call(receiver, ".obsidian/snippets/a.css" as FilePath);

        expect(isTargetFileInExtra).toHaveBeenCalledTimes(2);
        expect(appendQueue).toHaveBeenCalledTimes(1);
        expect(appendQueue).toHaveBeenCalledWith(
            [
                {
                    type: "INTERNAL",
                    file: { path: ".obsidian/snippets/a.css", isInternal: true },
                    skipBatchWait: true,
                },
            ],
            null
        );
    });
});

describe("Obsidian file-processing failure boundary", () => {
    it("requests an owned database check without awaiting recovery which may drain this file event", async () => {
        const cause = new Error("file processing failed");
        const selected = {};
        const onLocalDatabaseError = vi.fn(() => new Promise<boolean>(() => {}));
        vi.spyOn(StorageEventManagerBase.prototype as any, "handleFileEvent").mockRejectedValue(cause);
        const receiver = { core: { services: { database: { localDatabaseDirect: selected, onLocalDatabaseError } } } };
        const handle = (StorageEventManagerObsidian.prototype as any).handleFileEvent;
        await expect(handle.call(receiver, {})).rejects.toBe(cause);
        expect(onLocalDatabaseError).toHaveBeenCalledWith(selected, cause);
    });
});
