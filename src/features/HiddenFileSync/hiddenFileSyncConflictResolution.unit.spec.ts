import { describe, expect, it, vi } from "vitest";
import {
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type MetaEntry,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

import {
    createHiddenFileSyncConflictResolution,
    findHiddenFileSyncMergeBase,
    selectHiddenFileSyncRevisionToDelete,
    type HiddenFileSyncConflictDatabase,
    type HiddenFileSyncConflictInteraction,
    type HiddenFileSyncConflictReconciliation,
    type HiddenFileSyncConflictResolutionDependencies,
    type HiddenFileSyncConflictStorage,
    type HiddenFileSyncJsonResolution,
    type HiddenFileSyncRevisionHistory,
} from "./hiddenFileSyncConflictResolution.ts";

const path = ".obsidian/plugins/example/data.json" as FilePath;
const prefixedPath = `i:${path}` as FilePathWithPrefix;
const id = "i:hidden-entry-id" as DocumentID;

function metadata(
    revision: string,
    mtime: number,
    overrides: Partial<HiddenFileSyncRevisionHistory> = {}
): HiddenFileSyncRevisionHistory {
    return {
        _id: id,
        _rev: revision,
        path: prefixedPath,
        type: "plain",
        datatype: "plain",
        ctime: 10,
        mtime,
        size: 20,
        children: [],
        eden: {},
        deleted: false,
        ...overrides,
    } as unknown as MetaEntry;
}

function loadedEntry(revision: string, content: string): LoadedEntry {
    return {
        ...metadata(revision, 20),
        data: content,
    } as LoadedEntry;
}

function entries(...values: MetaEntry[]): AsyncIterable<MetaEntry> {
    return {
        async *[Symbol.asyncIterator]() {
            yield* values;
        },
    };
}

type DependencyOverrides = {
    database?: Partial<HiddenFileSyncConflictDatabase>;
    storage?: Partial<HiddenFileSyncConflictStorage>;
    reconciliation?: Partial<HiddenFileSyncConflictReconciliation>;
    interaction?: Partial<HiddenFileSyncConflictInteraction>;
    shouldOverwrite?: HiddenFileSyncConflictResolutionDependencies["shouldOverwrite"];
    log?: HiddenFileSyncConflictResolutionDependencies["log"];
};

function createDependencies(overrides: DependencyOverrides = {}): HiddenFileSyncConflictResolutionDependencies {
    const database: HiddenFileSyncConflictDatabase = {
        scanConflictedEntries: () => entries(),
        getDocumentId: vi.fn(async () => id),
        loadCurrentMetadata: vi.fn(async () => metadata("1-current", 10)),
        loadConflictingMetadata: vi.fn(async () => metadata("1-conflict", 10)),
        loadRevisionHistory: vi.fn(async () => metadata("1-current", 10, { _revs_info: [] })),
        loadRevisionEntry: vi.fn(async (): Promise<LoadedEntry | false> => false),
        mergeJson: vi.fn(async (): Promise<string | false> => false),
        removeRevision: vi.fn(async () => true),
        deleteRevision: vi.fn(async () => true),
        ...overrides.database,
    };
    const storage: HiddenFileSyncConflictStorage = {
        ensureDirectory: vi.fn(async () => undefined),
        writeFile: vi.fn(async () => null),
        triggerEvent: vi.fn(async () => undefined),
        ...overrides.storage,
    };
    const reconciliation: HiddenFileSyncConflictReconciliation = {
        storeFile: vi.fn(async () => true),
        extractFile: vi.fn(async () => true),
        ...overrides.reconciliation,
    };
    const interaction: HiddenFileSyncConflictInteraction = {
        resolveJsonConflict: vi.fn(async () => false),
        ...overrides.interaction,
    };
    return {
        database,
        storage,
        reconciliation,
        interaction,
        shouldOverwrite: overrides.shouldOverwrite ?? (() => false),
        log: overrides.log ?? vi.fn(),
    };
}

describe("Hidden File Sync conflict policy", () => {
    it("keeps the current revision when both mtimes are equal", () => {
        const current = metadata("3-current", 20);
        const conflicted = metadata("2-conflict", 20);

        expect(selectHiddenFileSyncRevisionToDelete(current, current._rev!, conflicted, conflicted._rev!)).toBe(
            conflicted._rev
        );
    });

    it("selects the first available lower-generation revision as the merge base", () => {
        expect(
            findHiddenFileSyncMergeBase(
                [
                    { rev: "4-current", status: "available" },
                    { rev: "3-missing", status: "missing" },
                    { rev: "2-base", status: "available" },
                    { rev: "1-older", status: "available" },
                ],
                "3-conflict"
            )
        ).toBe("2-base");
        expect(findHiddenFileSyncMergeBase(undefined, "3-conflict")).toBe("");
    });
});

describe("Hidden File Sync conflict queue", () => {
    it("continues processing queued conflict notifications while a full scan is in progress", async () => {
        let releaseScan!: () => void;
        let markScanStarted!: () => void;
        const scanGate = new Promise<void>((resolve) => {
            releaseScan = resolve;
        });
        const scanStarted = new Promise<void>((resolve) => {
            markScanStarted = resolve;
        });
        const loadCurrentMetadata = vi.fn(async () => metadata("1-current", 10));
        const dependencies = createDependencies({
            database: {
                scanConflictedEntries: () => ({
                    async *[Symbol.asyncIterator]() {
                        markScanStarted();
                        await scanGate;
                    },
                }),
                loadCurrentMetadata,
            },
        });
        const resolution = createHiddenFileSyncConflictResolution(dependencies);
        const resolvingAll = resolution.resolveAll();
        await scanStarted;
        // Cross the macrotask boundary which allowed the legacy suspended
        // processor to stop before a database notification arrived.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        resolution.queue(prefixedPath);
        try {
            await vi.waitFor(() => expect(loadCurrentMetadata).toHaveBeenCalledOnce(), {
                interval: 10,
                timeout: 250,
            });
        } finally {
            releaseScan();
            await resolvingAll;
            resolution.dispose();
        }
    });

    it("deduplicates exact paths and does not accept work after disposal", async () => {
        const loadCurrentMetadata = vi.fn(async () => metadata("1-current", 10));
        const dependencies = createDependencies({ database: { loadCurrentMetadata } });
        const resolution = createHiddenFileSyncConflictResolution(dependencies);

        resolution.queue(prefixedPath);
        resolution.queue(prefixedPath);
        await resolution.resolveAll();

        expect(loadCurrentMetadata).toHaveBeenCalledOnce();
        resolution.dispose();
        resolution.queue(`i:${path}.other` as FilePathWithPrefix);
        expect(loadCurrentMetadata).toHaveBeenCalledOnce();
    });

    it("retains prefixed and unprefixed path forms as separate compatibility keys", async () => {
        const loadCurrentMetadata = vi.fn(async () => metadata("1-current", 10));
        const dependencies = createDependencies({ database: { loadCurrentMetadata } });
        const resolution = createHiddenFileSyncConflictResolution(dependencies);

        resolution.queue(path);
        resolution.queue(prefixedPath);
        await resolution.resolveAll();

        expect(loadCurrentMetadata).toHaveBeenCalledTimes(2);
        resolution.dispose();
    });

    it("deletes the conflicted revision on an mtime tie, then extracts", async () => {
        const events: string[] = [];
        const current = metadata("3-current", 20, { _conflicts: ["2-conflict"] });
        const settled = metadata("3-current", 20, { _conflicts: [] });
        const dependencies = createDependencies({
            database: {
                scanConflictedEntries: () => entries(current),
                loadCurrentMetadata: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(settled),
                loadConflictingMetadata: vi.fn(async () => metadata("2-conflict", 20)),
                removeRevision: vi.fn(async (_id, revision) => {
                    events.push(`remove:${revision}`);
                    return true;
                }),
            },
            reconciliation: {
                extractFile: vi.fn(async () => {
                    events.push("extract");
                    return true;
                }),
            },
        });
        const resolution = createHiddenFileSyncConflictResolution(dependencies);

        await resolution.resolveAll();

        expect(events).toEqual(["remove:2-conflict", "extract"]);
        resolution.dispose();
    });

    it("stores and extracts an automatic merge before removing the conflicted revision", async () => {
        const events: string[] = [];
        const current = metadata("3-current", 30, { _conflicts: ["2-conflict"] });
        const settled = metadata("4-merged", 40, { _conflicts: [] });
        const stat = { ctime: 10, mtime: 20, size: 30, type: "file" } as UXStat;
        const mergeJson = vi.fn(async () => '{"merged":true}');
        const dependencies = createDependencies({
            database: {
                scanConflictedEntries: () => entries(current),
                loadCurrentMetadata: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(settled),
                loadRevisionHistory: vi.fn(async () =>
                    metadata("3-current", 30, {
                        _revs_info: [
                            { rev: "3-current", status: "available" },
                            { rev: "1-base", status: "available" },
                        ],
                    })
                ),
                mergeJson,
                removeRevision: vi.fn(async () => {
                    events.push("remove");
                    return true;
                }),
            },
            storage: {
                ensureDirectory: vi.fn(async () => {
                    events.push("ensure");
                }),
                writeFile: vi.fn(async () => {
                    events.push("write");
                    return stat;
                }),
            },
            reconciliation: {
                storeFile: vi.fn(async () => {
                    events.push("store");
                    return true;
                }),
                extractFile: vi.fn(async () => {
                    events.push("extract");
                    return false;
                }),
            },
        });
        const resolution = createHiddenFileSyncConflictResolution(dependencies);

        await resolution.resolveAll();

        expect(mergeJson).toHaveBeenCalledWith(prefixedPath, "1-base", "3-current", "2-conflict");
        expect(events).toEqual(["ensure", "write", "store", "extract", "remove"]);
        resolution.dispose();
    });
});

describe("Hidden File Sync JSON conflict application", () => {
    function createJsonResolutionFixture(
        jsonResolution: HiddenFileSyncJsonResolution,
        deletionResult: boolean | Error = true
    ) {
        const events: string[] = [];
        const docA = loadedEntry("3-current", '{"current":true}');
        const docB = loadedEntry("2-conflict", '{"conflict":true}');
        const deleteRevision = vi.fn(async (entry: LoadedEntry) => {
            events.push(`delete:${entry._rev}`);
            if (deletionResult instanceof Error) {
                if (entry._rev === docB._rev) throw deletionResult;
                return true;
            }
            return deletionResult;
        });
        const extractFile = vi.fn(async () => {
            events.push("extract");
            return false;
        });
        const storeFile = vi.fn(async () => {
            events.push("store");
            return true;
        });
        const stat = { ctime: 11, mtime: 21, size: 22, type: "file" } as UXStat;
        const log = vi.fn();
        const dependencies = createDependencies({
            database: { deleteRevision },
            storage: {
                ensureDirectory: vi.fn(async () => {
                    events.push("ensure");
                }),
                writeFile: vi.fn(async () => {
                    events.push("write");
                    return stat;
                }),
                triggerEvent: vi.fn(async () => {
                    events.push("trigger");
                }),
            },
            reconciliation: { extractFile, storeFile },
            interaction: {
                resolveJsonConflict: vi.fn(async (_path, _docs, apply) => await apply(jsonResolution)),
            },
            log,
        });
        return {
            deleteRevision,
            docA,
            docB,
            events,
            extractFile,
            log,
            resolution: createHiddenFileSyncConflictResolution(dependencies),
            stat,
            storeFile,
        };
    }

    it("returns false without changing data when no resolution is selected", async () => {
        const fixture = createJsonResolutionFixture({});

        await expect(fixture.resolution.resolveJson(fixture.docA, fixture.docB)).resolves.toBe(false);

        expect(fixture.events).toEqual([]);
        fixture.resolution.dispose();
    });

    it("keeps the selected revision but reports success when follow-up extraction fails", async () => {
        const fixture = createJsonResolutionFixture({ keepRevision: "3-current" });

        await expect(fixture.resolution.resolveJson(fixture.docA, fixture.docB)).resolves.toBe(true);

        expect(fixture.deleteRevision).toHaveBeenCalledTimes(1);
        expect(fixture.deleteRevision).toHaveBeenCalledWith(fixture.docB);
        expect(fixture.events).toEqual([`delete:${fixture.docB._rev}`, "extract"]);
        expect(fixture.log).toHaveBeenCalledWith(
            `STORAGE --> DB:${path}: extracted (hidden,merged) Failed`,
            undefined,
            undefined
        );
        fixture.resolution.dispose();
    });

    it("deletes both supplied revisions when the selected revision is unknown", async () => {
        const fixture = createJsonResolutionFixture({ keepRevision: "9-unknown" });

        await expect(fixture.resolution.resolveJson(fixture.docA, fixture.docB)).resolves.toBe(true);

        expect(fixture.events).toEqual([`delete:${fixture.docA._rev}`, `delete:${fixture.docB._rev}`, "extract"]);
        expect(fixture.storeFile).not.toHaveBeenCalled();
        fixture.resolution.dispose();
    });

    it("deletes both revisions before writing and storing a merged result", async () => {
        const fixture = createJsonResolutionFixture({ mergedText: '{"merged":true}' });

        await expect(fixture.resolution.resolveJson(fixture.docA, fixture.docB)).resolves.toBe(true);

        expect(fixture.storeFile).toHaveBeenCalledWith(
            {
                path,
                ctime: fixture.stat.ctime,
                mtime: fixture.stat.mtime,
                size: fixture.stat.size,
            },
            true
        );
        expect(fixture.events).toEqual([
            `delete:${fixture.docA._rev}`,
            `delete:${fixture.docB._rev}`,
            "ensure",
            "write",
            "store",
            "trigger",
            "extract",
        ]);
        fixture.resolution.dispose();
    });

    it("keeps an earlier successful deletion when a later deletion throws", async () => {
        const error = new Error("second deletion failed");
        const fixture = createJsonResolutionFixture({ mergedText: '{"merged":true}' }, error);

        await expect(fixture.resolution.resolveJson(fixture.docA, fixture.docB)).resolves.toBe(false);

        expect(fixture.events).toEqual([`delete:${fixture.docA._rev}`, `delete:${fixture.docB._rev}`]);
        expect(fixture.storeFile).not.toHaveBeenCalled();
        expect(fixture.log).toHaveBeenCalledWith(error, LOG_LEVEL_VERBOSE, undefined);
        fixture.resolution.dispose();
    });
});
