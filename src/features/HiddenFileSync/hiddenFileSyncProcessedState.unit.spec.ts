import { describe, expect, it, vi } from "vitest";
import {
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type LoadedEntry,
    type MetaEntry,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { KeyValueDatabase } from "@vrtmrz/livesync-commonlib/compat/interfaces/KeyValueDatabase";

vi.mock("@/deps.ts", () => ({}));

import {
    createHiddenFileSyncProcessedState,
    type HiddenFileSyncProcessedStateDependencies,
} from "./hiddenFileSyncProcessedState.ts";
import { toHiddenFileSyncDatabaseStateKey } from "./hiddenFileSyncState.ts";

const path = ".obsidian/plugins/example/data.json" as FilePath;

function stat(mtime: number, size = 20): UXStat {
    return { ctime: mtime, mtime, size, type: "file" };
}

function metadata(overrides: Partial<MetaEntry> = {}): MetaEntry {
    return {
        _id: "hidden-entry-id",
        _rev: "2-current",
        path: `i:${path}`,
        type: "plain",
        datatype: "plain",
        ctime: 10,
        mtime: 20,
        size: 20,
        children: [],
        eden: {},
        deleted: false,
        ...overrides,
    } as unknown as MetaEntry;
}

function createState() {
    const events: string[] = [];
    const caches = new Map<string, Map<unknown, unknown>>([
        ["hidden-file-lastProcessed", new Map([[path, "40-20"]])],
        ["hidden-file-lastProcessed-database", new Map([[path, "20-20-2-current--1"]])],
        ["hidden-file-lastKnown", new Map([[path, 40]])],
    ]);
    let activeReads = 0;
    let maximumActiveReads = 0;
    const keyValueDatabase = {
        get: vi.fn(async (key: IDBValidKey) => {
            events.push(`get:${String(key)}`);
            activeReads++;
            maximumActiveReads = Math.max(maximumActiveReads, activeReads);
            await Promise.resolve();
            activeReads--;
            return caches.get(String(key));
        }),
        set: vi.fn(async () => "ok"),
    } as unknown as KeyValueDatabase;
    const getDBEntryMeta = vi.fn(async () => false as false | LoadedEntry);
    const statHidden = vi.fn(async () => stat(41));
    const markChangesAreSame = vi.fn(() => undefined);
    const unmarkChanges = vi.fn();
    const log = vi.fn();
    const dependencies: HiddenFileSyncProcessedStateDependencies = {
        getKeyValueDatabase: () => keyValueDatabase,
        getLocalDatabase: () => ({ getDBEntryMeta }),
        storageAccess: { statHidden },
        path: { markChangesAreSame, unmarkChanges },
        log,
    };
    const state = createHiddenFileSyncProcessedState(dependencies);
    return {
        dependencies,
        events,
        getDBEntryMeta,
        keyValueDatabase,
        log,
        markChangesAreSame,
        maximumActiveReads: () => maximumActiveReads,
        state,
        statHidden,
        unmarkChanges,
    };
}

describe("Hidden File Sync processed state", () => {
    it("loads the three autosave caches sequentially under their existing keys", async () => {
        const fixture = createState();

        await fixture.state.initialise();

        expect(fixture.events).toEqual([
            "get:hidden-file-lastProcessed",
            "get:hidden-file-lastProcessed-database",
            "get:hidden-file-lastKnown",
        ]);
        expect(fixture.maximumActiveReads()).toBe(1);
        expect(fixture.state.getLastProcessedFileCount()).toBe(1);
        expect(fixture.state.getLastProcessedFileKey(path)).toBe("40-20");
        expect(fixture.state.getLastProcessedDatabaseKey(path)).toBe("20-20-2-current--1");
        expect(fixture.state.getLastProcessedFileMTime(path)).toBe(40);
    });

    it("re-reads a null storage stat and retains the last known mtime on deletion", async () => {
        const fixture = createState();
        await fixture.state.initialise();

        fixture.statHidden.mockResolvedValueOnce(stat(45, 3));
        await expect(fixture.state.fileToStatKey(path, null)).resolves.toBe("45-3");
        expect(fixture.statHidden).toHaveBeenCalledWith(path);

        fixture.state.updateLastProcessedFile(path, stat(45, 3));
        fixture.state.updateLastProcessedDeletion(path, metadata({ mtime: 50, size: 0 }));

        expect(fixture.state.getLastProcessedFileKey(path)).toBe("0-0");
        expect(fixture.state.getLastProcessedFileMTime(path)).toBe(45);
        expect(fixture.state.getLastProcessedDatabaseKey(path)).toBe(
            toHiddenFileSyncDatabaseStateKey(metadata({ mtime: 50, size: 0 }))
        );
        expect(fixture.unmarkChanges).toHaveBeenCalledWith(path);
    });

    it("settles combined state before applying the matching-path marker", async () => {
        const fixture = createState();
        await fixture.state.initialise();
        const document = metadata({ mtime: 60, size: 9 });
        const storageStat = stat(61, 9);

        fixture.state.updateLastProcessed(path, document, storageStat);

        expect(fixture.markChangesAreSame).toHaveBeenCalledWith(path, 60, 61);
        expect(fixture.unmarkChanges).not.toHaveBeenCalled();
        expect(fixture.state.getLastProcessedDatabaseKey(path)).toBe(toHiddenFileSyncDatabaseStateKey(document));
        expect(fixture.state.getLastProcessedFileKey(path)).toBe("61-9");
    });

    it("resets each processed side without clearing last-known storage mtimes", async () => {
        const fixture = createState();
        await fixture.state.initialise();
        fixture.state.updateLastProcessedFile(path, stat(70, 4));
        fixture.state.updateLastProcessedDatabase(path, "database-key");

        fixture.state.resetLastProcessedFile([path]);
        expect(fixture.state.getLastProcessedFileKey(path)).toBeUndefined();
        expect(fixture.state.getLastProcessedDatabaseKey(path)).toBe("database-key");
        expect(fixture.state.getLastProcessedFileMTime(path)).toBe(70);

        fixture.state.resetLastProcessedDatabase([path]);
        expect(fixture.state.getLastProcessedDatabaseKey(path)).toBeUndefined();
    });

    it("does not settle a database marker for a false or missing database document", async () => {
        const fixture = createState();
        await fixture.state.initialise();

        await fixture.state.updateLastProcessedAsActualDatabase(path, false);
        expect(fixture.getDBEntryMeta).toHaveBeenCalledWith(`i:${path}`);
        expect(fixture.state.getLastProcessedDatabaseKey(path)).toBe("20-20-2-current--1");

        fixture.getDBEntryMeta.mockResolvedValueOnce(false);
        await fixture.state.updateLastProcessedAsActualDatabase(path);
        expect(fixture.state.getLastProcessedDatabaseKey(path)).toBe("20-20-2-current--1");
    });

    it("logs and clears both sides when a full reset is requested", async () => {
        const fixture = createState();
        await fixture.state.initialise();

        fixture.state.resetLastProcessedFile(false);
        fixture.state.resetLastProcessedDatabase(false);

        expect(fixture.log).toHaveBeenNthCalledWith(1, "Delete all processed mark.", LOG_LEVEL_VERBOSE, undefined);
        expect(fixture.log).toHaveBeenNthCalledWith(2, "Delete all processed mark.", LOG_LEVEL_VERBOSE, undefined);
        expect(fixture.state.getLastProcessedFileCount()).toBe(0);
        expect(fixture.state.getLastProcessedFileKey(path)).toBeUndefined();
        expect(fixture.state.getLastProcessedDatabaseKey(path)).toBeUndefined();
        expect(fixture.state.getLastProcessedFileMTime(path)).toBe(40);
    });
});
