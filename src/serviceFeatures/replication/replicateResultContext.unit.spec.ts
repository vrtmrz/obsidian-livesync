import type { LoadedEntry } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { describe, expect, it, vi } from "vitest";
import { inspectReflection } from "./replicateResultContext";

function entry(overrides: Partial<LoadedEntry> = {}): LoadedEntry {
    return {
        _id: "note-id",
        _rev: "2-current",
        path: "note.md",
        type: "plain",
        ...overrides,
    } as LoadedEntry;
}

describe("replication result context operations", () => {
    it("uses current conflict policy and preserves service receivers while inspecting", async () => {
        const settings = { writeDocumentsIfConflicted: false };
        const setting = {
            calls: 0,
            currentSettings() {
                this.calls += 1;
                return settings;
            },
        };
        const path = {
            prefix: "vault",
            getPathCalls: 0,
            getPath(value: LoadedEntry) {
                this.getPathCalls += 1;
                return `${this.prefix}/${value.path}`;
            },
        };
        const conflict = {
            queuedPaths: [] as string[],
            async queueCheckForIfOpen(value: string) {
                this.queuedPaths.push(value);
            },
        };
        const fileHandler = {
            result: true,
            calls: 0,
            async inspectCurrentFileProvenance() {
                this.calls += 1;
                return this.result;
            },
        };
        const context = {
            setting,
            path,
            conflict,
            storageAccess: { isExists: vi.fn(async () => false) },
            getLocalDatabase: vi.fn(),
            fileHandler,
            API: {},
        } as unknown as Parameters<typeof inspectReflection>[0];
        const conflictedEntry = entry({ _conflicts: ["1-conflict"] } as Partial<LoadedEntry>);

        await expect(inspectReflection(context, conflictedEntry, "received")).resolves.toBe("policy");
        expect(conflict.queuedPaths).toEqual(["vault/note.md"]);

        settings.writeDocumentsIfConflicted = true;
        await expect(inspectReflection(context, conflictedEntry, "received")).resolves.toBe("reflected");

        expect(setting.calls).toBe(2);
        expect(path.getPathCalls).toBe(2);
        expect(fileHandler.calls).toBe(1);
        expect(context.getLocalDatabase).not.toHaveBeenCalled();
    });

    it("reads the current local database when confirming a received deletion", async () => {
        const deletedEntry = entry({ deleted: true });
        const database = {
            current: entry({ _rev: "1-older", deleted: true }),
            calls: 0,
            async getRaw() {
                this.calls += 1;
                return this.current;
            },
        };
        const storageAccess = {
            calls: 0,
            async isExists() {
                this.calls += 1;
                return false;
            },
        };
        const getLocalDatabase = vi.fn(() => database as never);
        const context = {
            setting: { currentSettings: () => ({ writeDocumentsIfConflicted: false }) },
            conflict: { queueCheckForIfOpen: vi.fn() },
            path: { getPath: (_value: LoadedEntry) => "note.md" },
            storageAccess,
            getLocalDatabase,
            fileHandler: { inspectCurrentFileProvenance: vi.fn() },
            API: {},
        } as unknown as Parameters<typeof inspectReflection>[0];

        await expect(inspectReflection(context, deletedEntry, "received")).resolves.toBe("pending");
        database.current = deletedEntry;
        await expect(inspectReflection(context, deletedEntry, "received")).resolves.toBe("reflected");

        expect(getLocalDatabase).toHaveBeenCalledTimes(2);
        expect(database.calls).toBe(2);
        expect(storageAccess.calls).toBe(2);
    });
});
