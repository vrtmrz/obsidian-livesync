import { describe, expect, it, vi } from "vitest";
import {
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type MetaEntry,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ICHeader, ICHeaderEnd } from "@/common/types.ts";

vi.mock("@/deps.ts", () => ({}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSyncContext } from "./hiddenFileSyncContext.ts";

describe("HiddenFileSyncContext operation composition", () => {
    it("composes the conflict owner from the current database and path capabilities", async () => {
        const path = ".obsidian/app.json" as FilePath;
        const prefixedPath = `i:${path}` as FilePathWithPrefix;
        const metadata = {
            _id: "i:hidden-entry-id" as DocumentID,
            _rev: "2-current",
            path: prefixedPath,
            type: "plain",
            datatype: "plain",
            ctime: 10,
            mtime: 20,
            size: 20,
            children: [],
            eden: {},
            deleted: false,
            _conflicts: [],
        } as unknown as MetaEntry;
        const findEntries = vi.fn(() => ({
            async *[Symbol.asyncIterator]() {
                yield metadata;
            },
        }));
        const getRaw = vi.fn(async () => metadata);
        const path2id = vi.fn(async () => metadata._id);
        const periodicProcessor = { enable: vi.fn(), disable: vi.fn() };
        const context = new HiddenFileSyncContext({
            createPeriodicProcessor: vi.fn(() => periodicProcessor),
            getLocalDatabase: () => ({ findEntries, getRaw }),
            path: { path2id },
            log: vi.fn(),
            publishActivity: vi.fn(),
            closeJsonConflictDialogs: vi.fn(),
            hideConfigurationChangeNotice: vi.fn(),
        } as never);

        await context.testing.conflictResolution.resolveAll();

        expect(findEntries).toHaveBeenCalledWith(ICHeader, ICHeaderEnd, { conflicts: true });
        expect(path2id).toHaveBeenCalledWith(prefixedPath, ICHeader);
        expect(getRaw).toHaveBeenCalledWith(metadata._id, { conflicts: true });
        context.dispose();
    });

    it("applies a selected live revision through the narrow repair view", async () => {
        const path = ".obsidian/plugins/example/data.json" as FilePath;
        const prefixedPath = `i:${path}` as FilePathWithPrefix;
        const revision = "2-selected";
        const metadata = {
            _id: "hidden-entry-id" as DocumentID,
            _rev: revision,
            path: prefixedPath,
            type: "plain",
            datatype: "plain",
            ctime: 10,
            mtime: 20,
            size: 20,
            children: [],
            eden: {},
            deleted: false,
        } as unknown as MetaEntry;
        const loaded = {
            ...metadata,
            data: '{"value":"database"}',
        } as LoadedEntry;
        const stat = { ctime: 10, mtime: 20, size: 20, type: "file" } as UXStat;
        const statHidden = vi.fn<() => Promise<UXStat | null>>().mockResolvedValueOnce(null).mockResolvedValue(stat);
        const writeHiddenFileAuto = vi.fn(async () => true);
        const getDBEntryFromMeta = vi.fn(async () => loaded);
        const fetchEntryMeta = vi.fn(async () => metadata);
        const getConflictedRevs = vi.fn(async () => [] as string[]);
        const markChangesAreSame = vi.fn();
        const periodicProcessor = { enable: vi.fn(), disable: vi.fn() };
        const context = new HiddenFileSyncContext({
            createPeriodicProcessor: vi.fn(() => periodicProcessor),
            isIgnoredByIgnoreFile: vi.fn(async () => false),
            databaseFileAccess: {
                fetchEntryMeta,
                getConflictedRevs,
            },
            getLocalDatabase: () => ({ getDBEntryFromMeta }),
            storageAccess: {
                statHidden,
                isExistsIncludeHidden: vi.fn(async () => false),
                ensureDir: vi.fn(async () => true),
                writeHiddenFileAuto,
            },
            path: {
                markChangesAreSame,
                unmarkChanges: vi.fn(),
            },
            getSettings: () => ({ suppressNotifyHiddenFilesChange: true }),
            log: vi.fn(),
            publishActivity: vi.fn(),
            closeJsonConflictDialogs: vi.fn(),
            hideConfigurationChangeNotice: vi.fn(),
        } as never);
        await expect(context.repair.extractInternalFileRevisionFromDatabase(path, revision, true)).resolves.toBe(true);

        expect(fetchEntryMeta).toHaveBeenCalledWith(prefixedPath, revision, true);
        expect(getConflictedRevs).toHaveBeenCalledWith(prefixedPath);
        expect(getDBEntryFromMeta).toHaveBeenCalledWith(metadata, false, true);
        expect(writeHiddenFileAuto).toHaveBeenCalledWith(path, '{"value":"database"}', {
            ctime: metadata.ctime,
            mtime: metadata.mtime,
        });
        expect(markChangesAreSame).toHaveBeenCalledWith(path, metadata.mtime, stat.mtime);

        context.dispose();
    });
});
