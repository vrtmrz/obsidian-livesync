import { describe, expect, it } from "vitest";
import type { FilePathWithPrefix, LoadedEntry, UXStat } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    describeHiddenFileSyncDocument,
    getHiddenFileSyncComparisonMTime,
    toHiddenFileSyncDatabaseStateKey,
    toHiddenFileSyncStorageStateKey,
} from "./hiddenFileSyncState.ts";

describe("Hidden File Sync state keys", () => {
    it("represents a missing storage file with zero values", () => {
        expect(toHiddenFileSyncStorageStateKey(null)).toBe("0-0");
    });

    it("uses storage modification time and size", () => {
        expect(toHiddenFileSyncStorageStateKey({ mtime: 123, size: 456 } as UXStat)).toBe("123-456");
    });

    it.each([
        [false, "123-456-3-example--1"],
        [true, "123-456-3-example--0"],
    ])("includes database revision and deletion state=%s", (deleted, expected) => {
        const doc = { mtime: 123, size: 456, _rev: "3-example", deleted } as LoadedEntry;

        expect(toHiddenFileSyncDatabaseStateKey(doc)).toBe(expected);
    });
});

describe("getHiddenFileSyncComparisonMTime", () => {
    const absentSources = [null, false, undefined] as const;

    it.each(absentSources)("returns zero for an absent source=%s", (source) => {
        expect(getHiddenFileSyncComparisonMTime(source)).toBe(0);
    });

    it("reads a direct stat or a file-info stat", () => {
        expect(getHiddenFileSyncComparisonMTime({ mtime: 123 } as UXStat)).toBe(123);
        expect(getHiddenFileSyncComparisonMTime({ stat: { mtime: 456 } } as never)).toBe(456);
    });

    it("treats deleted entries as zero unless deletion time is requested", () => {
        const deleted = { mtime: 123, deleted: true } as LoadedEntry;

        expect(getHiddenFileSyncComparisonMTime(deleted)).toBe(0);
        expect(getHiddenFileSyncComparisonMTime(deleted, true)).toBe(123);
    });
});

describe("describeHiddenFileSyncDocument", () => {
    it("derives the unprefixed path and diagnostic revision fields", () => {
        const doc = {
            _id: "0123456789abcdef",
            _rev: "3-example",
            mtime: 123,
            size: 456,
            deleted: true,
        } as LoadedEntry;

        expect(describeHiddenFileSyncDocument(doc, "i:.obsidian/app.json" as FilePathWithPrefix)).toEqual({
            id: "0123456789abcdef",
            rev: "3-example",
            revDisplay: "3-exampl",
            prefixedPath: "i:.obsidian/app.json",
            path: ".obsidian/app.json",
            isDeleted: true,
            shortenedId: "0123456789",
            shortenedPath: ".obsidian/",
        });
    });
});
