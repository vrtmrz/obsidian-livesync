import { describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager", () => ({
    StorageEventManagerBase: class StorageEventManagerBase {
        settings: unknown;
        vaultService: unknown;
        fileProcessing: unknown;
        adapter: unknown;
        appendQueue = vi.fn(async () => undefined);

        constructor(adapter: unknown, dependencies: Record<string, unknown>) {
            this.adapter = adapter;
            this.settings = dependencies.settings;
            this.vaultService = dependencies.vaultService;
            this.fileProcessing = dependencies.fileProcessing;
        }
    },
}));
vi.mock("./ObsidianStorageEventManagerAdapter", () => ({
    ObsidianStorageEventManagerAdapter: class ObsidianStorageEventManagerAdapter {
        converter = {
            toInternalFileInfo: vi.fn((path: FilePath) => ({ path, isInternal: true, isFolder: false })),
        };
    },
}));

import { StorageEventManagerObsidian } from "./StorageEventManagerObsidian.ts";

function createManager(
    options: {
        customisationEnabled?: boolean;
        hiddenFileEnabled?: boolean;
        target?: boolean;
        configured?: boolean;
        suspended?: boolean;
        maxMTime?: number;
    } = {}
) {
    const settings = {
        usePluginSync: options.customisationEnabled ?? true,
        syncInternalFiles: options.hiddenFileEnabled ?? true,
        watchInternalFileChanges: true,
        isConfigured: options.configured ?? true,
        suspendFileWatching: options.suspended ?? false,
        maxMTimeForReflectEvents: options.maxMTime ?? 0,
    };
    const onStorageFileEvent = vi.fn();
    const processOptionalFileEvent = vi.fn(async () => true);
    const isTargetFileInExtra = vi.fn(async () => options.target ?? true);
    const core = {
        services: {
            API: { getSystemConfigDir: vi.fn(() => ".obsidian") },
        },
    };
    const manager = new StorageEventManagerObsidian(
        {} as never,
        core as never,
        {
            settings,
            vaultService: { isTargetFileInExtra },
            fileProcessing: { onStorageFileEvent, processOptionalFileEvent },
        } as never
    );
    const runRawEvent = (path: string) =>
        (manager as unknown as { _watchVaultRawEvents(path: FilePath): Promise<void> })._watchVaultRawEvents(
            path as FilePath
        );
    return {
        appendQueue: (manager as unknown as { appendQueue: ReturnType<typeof vi.fn> }).appendQueue,
        isTargetFileInExtra,
        onStorageFileEvent,
        processOptionalFileEvent,
        runRawEvent,
    };
}

describe("StorageEventManagerObsidian optional-file raw events", () => {
    it("dispatches a Customisation-only event without the base Hidden File Sync target gate", async () => {
        const fixture = createManager({ hiddenFileEnabled: false });

        await fixture.runRawEvent(".obsidian/app.json");

        expect(fixture.processOptionalFileEvent).toHaveBeenCalledWith(".obsidian/app.json");
        expect(fixture.onStorageFileEvent).toHaveBeenCalledOnce();
        expect(fixture.appendQueue).not.toHaveBeenCalled();
    });

    it("retains the base queue for events while Hidden File Sync is enabled", async () => {
        const fixture = createManager();

        await fixture.runRawEvent(".obsidian/workspace");

        expect(fixture.appendQueue).toHaveBeenCalledOnce();
        expect(fixture.processOptionalFileEvent).not.toHaveBeenCalled();
    });

    it("does not dispatch disabled, filtered, folder, or out-of-directory paths", async () => {
        const disabled = createManager({ customisationEnabled: false, hiddenFileEnabled: false });
        await disabled.runRawEvent(".obsidian/app.json");
        expect(disabled.appendQueue).not.toHaveBeenCalled();

        const filtered = createManager({ target: false });
        await filtered.runRawEvent(".obsidian/workspace");
        await filtered.runRawEvent(".obsidian/folder/");
        await filtered.runRawEvent("notes/example.md");
        expect(filtered.appendQueue).not.toHaveBeenCalled();
        expect(filtered.processOptionalFileEvent).not.toHaveBeenCalled();
    });

    it.each([
        ["unconfigured", { configured: false }],
        ["suspended", { suspended: true }],
        ["bounded by reflection time", { maxMTime: 1 }],
    ] as const)("preserves the base queue gate while %s", async (_label, options) => {
        const fixture = createManager({ hiddenFileEnabled: false, ...options });

        await fixture.runRawEvent(".obsidian/app.json");

        expect(fixture.isTargetFileInExtra).not.toHaveBeenCalled();
        expect(fixture.processOptionalFileEvent).not.toHaveBeenCalled();
    });
});
