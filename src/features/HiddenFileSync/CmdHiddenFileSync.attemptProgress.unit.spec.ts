import { describe, expect, it, vi } from "vitest";
import {
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type MetaEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {},
}));
vi.mock("@/features/LiveSyncCommands.ts", () => ({
    LiveSyncCommands: class LiveSyncCommands {
        plugin!: { app: unknown };
        core!: { services: unknown; settings: unknown };
        get app() {
            return this.plugin.app;
        }
        get services() {
            return this.core.services;
        }
        get settings() {
            return this.core.settings;
        }
    },
}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSync } from "./CmdHiddenFileSync.ts";

function createProgress(events: string[] = []) {
    return {
        log: vi.fn((message: string) => {
            if (/^(?:\d+\/\d+|Checking \d+\/\d+)$/.test(message)) events.push(message);
        }),
        once: vi.fn(),
        done: vi.fn(),
    };
}

function createStoragePaths(count: number): FilePath[] {
    return Array.from({ length: count }, (_, index) => `.obsidian/plugins/example/${index}.json` as FilePath);
}

function createDatabaseEntries(count: number): MetaEntry[] {
    return Array.from(
        { length: count },
        (_, index) =>
            ({
                _id: `i:.obsidian/plugins/example/${index}.json` as DocumentID,
                _rev: "1-test",
                path: `i:.obsidian/plugins/example/${index}.json` as FilePathWithPrefix,
                ctime: 1,
                mtime: 1,
                size: 0,
                type: "plain",
                datatype: "plain",
                children: [],
                eden: {},
                deleted: false,
            }) as MetaEntry
    );
}

function createHiddenFileSync(count: number, events: string[] = []) {
    const progress = createProgress(events);
    const statHidden = vi.fn(async () => {
        events.push(`stat:${statHidden.mock.calls.length}`);
        return { mtime: 1 };
    });
    const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
    Object.assign(hiddenFileSync, {
        _progress: vi.fn(() => progress),
        _log: vi.fn(),
        _fileInfoLastProcessed: new Map(),
        _databaseInfoLastProcessed: new Map(),
        scanInternalFileNames: vi.fn(async () => createStoragePaths(count)),
        getAllDatabaseFiles: vi.fn(async () => createDatabaseEntries(count)),
        getPath: vi.fn((file: MetaEntry) => file.path),
        updateLastProcessed: vi.fn(),
        scanAllStorageChanges: vi.fn(async () => undefined),
        scanAllDatabaseChanges: vi.fn(async () => undefined),
        resetLastProcessedDatabase: vi.fn(),
        resetLastProcessedFile: vi.fn(),
        useStorageFiles: vi.fn(async () => false),
        useDatabaseFiles: vi.fn(async () => false),
        trackStorageFileModification: vi.fn(async () => false),
        trackDatabaseFileModification: vi.fn(async () => false),
        core: { storageAccess: { statHidden } },
    });
    return { hiddenFileSync, progress, statHidden };
}

describe("HiddenFileSync attempt progress", () => {
    it("reports applyOfflineChanges attempts at 1 and each 25 items, without a final partial count", async () => {
        const events: string[] = [];
        const { hiddenFileSync, progress } = createHiddenFileSync(52, events);

        await hiddenFileSync.applyOfflineChanges(false);

        expect(progress.log.mock.calls.map(([message]) => message).filter((message) => /^\d+\/\d+$/.test(message))).toEqual([
            "1/52",
            "26/52",
            "51/52",
        ]);
        expect(events.indexOf("51/52")).toBeLessThan(events.indexOf("stat:1"));
    });

    it("reports rebuildMerging attempts at 1 and each 100 items, without a final partial count", async () => {
        const events: string[] = [];
        const { hiddenFileSync, progress } = createHiddenFileSync(202, events);

        await hiddenFileSync.rebuildMerging(false);

        expect(progress.log.mock.calls.map(([message]) => message).filter((message) => message.startsWith("Checking "))).toEqual([
            "Checking 1/202",
            "Checking 101/202",
            "Checking 201/202",
        ]);
        expect(events.indexOf("Checking 101/202")).toBeLessThan(events.indexOf("stat:101"));
    });

    it("preserves stat failures from applyOfflineChanges", async () => {
        const { hiddenFileSync, progress, statHidden } = createHiddenFileSync(1);
        const error = new Error("stat failed");
        statHidden.mockRejectedValueOnce(error);

        await expect(hiddenFileSync.applyOfflineChanges(false)).rejects.toBe(error);
        expect(progress.done).not.toHaveBeenCalled();
    });

    it("preserves stat failures from rebuildMerging", async () => {
        const { hiddenFileSync, progress, statHidden } = createHiddenFileSync(1);
        const error = new Error("stat failed");
        statHidden.mockRejectedValueOnce(error);

        await expect(hiddenFileSync.rebuildMerging(false)).rejects.toBe(error);
        expect(progress.done).not.toHaveBeenCalled();
    });
});
