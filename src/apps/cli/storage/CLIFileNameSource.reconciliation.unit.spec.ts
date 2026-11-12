import { describe, expect, it, vi } from "vitest";
import {
    FilePathIndex,
    parseFilePath,
    type DirectoryEntry,
    type PathComparisonSettings,
    type StoragePath,
} from "@vrtmrz/livesync-commonlib/storage";
import type { DirectoryListing, InventoryReader, InventoryState } from "./CLIFileNameSource.state";
import { readDirectory as readInventoryDirectory } from "./CLIFileNameSource.inventory";
import {
    commitRefresh,
    createRefreshChanges,
    currentEntries,
    stageRemoveSubtree,
    stageFileMembershipChanges,
    generationsUnchanged,
    reconcilePending,
    refreshDirectory,
    refreshSingleDirectory,
    revalidateTargetBranches,
    type CommitRefreshDependencies,
    type ReconcilePendingDependencies,
    type RefreshDirectoryDependencies,
    type InventoryReconcilerDependencies,
} from "./CLIFileNameSource.reconciliation";

const legacyPolicy: PathComparisonSettings = {
    pathNormalizationVersion: 0,
    handleFilenameCaseSensitive: true,
};
const file = (name: string): DirectoryEntry => ({ name, kind: "file" });
const directory = (name: string): DirectoryEntry => ({ name, kind: "directory" });

const legacyListing = (entries: readonly DirectoryEntry[]): DirectoryListing => ({ kind: "legacy", entries });

/** Produce validated fixture paths through the same shared resolver as the real reader. */
function readerForListings(listings: ReadonlyMap<string, readonly DirectoryEntry[]>) {
    const storage = {
        readDirectory: (directory: StoragePath) => Promise.resolve(listings.get(directory) ?? null),
    };
    return vi.fn<InventoryReader["readDirectory"]>((directory, policy) =>
        readInventoryDirectory({ storage }, directory, policy)
    );
}

function inventory(
    names: readonly string[],
    listings: readonly (readonly [string, readonly DirectoryEntry[]])[],
    policy = legacyPolicy
): InventoryState {
    const files = new Set(names.map((name) => parseFilePath(name)));
    const index = new FilePathIndex();
    index.replaceAll(files);
    return {
        index,
        files,
        directories: new Map(listings),
        readErrors: new Map(),
        aliasErrors: new Map(),
        policy: { ...policy },
    };
}

describe("CLI name reconciliation operations", () => {
    it("stages a target-only refresh without publishing or recursively reading new subtrees", async () => {
        const original = [file("old.md"), file("keep.md")];
        const state = inventory(["old.md", "keep.md"], [["", original]]);
        const entries = [file("keep.md"), file("new.md"), file(".hidden.md"), directory("later"), directory(".config")];
        const readDirectory = vi.fn<InventoryReader["readDirectory"]>().mockResolvedValue(legacyListing(entries));
        const markDirectoryDirty = vi.fn();
        const directoryGenerations = new Map([["", 4]]);
        const dependencies: RefreshDirectoryDependencies = {
            reader: { readDirectory },
            basePath: "/vault",
            reportDiagnostic: vi.fn(),
            directoryGenerations,
            getBoundary: () => Math.max(0, ...directoryGenerations.values()),
            markDirectoryDirty,
        };
        const changes = createRefreshChanges();

        await refreshDirectory(dependencies, state, "", changes, false, new Set());

        expect(state.index.getFileNames().sort()).toEqual(["keep.md", "old.md"]);
        expect(state.directories.get("")).toBe(original);
        expect(readDirectory).toHaveBeenCalledExactlyOnceWith("", legacyPolicy);
        expect(markDirectoryDirty).toHaveBeenCalledExactlyOnceWith("later");

        const invalidatedDirectories = new Map([["", 1]]);
        const commitDependencies: CommitRefreshDependencies = {
            assertNotClosed: vi.fn(),
            onValidatedDirectories: vi.fn(),
            invalidatedDirectories,
            directoryGenerations,
        };
        commitRefresh(commitDependencies, state, changes, 1);

        expect(state.index.getFileNames().sort()).toEqual([".hidden.md", "keep.md", "new.md"]);
        expect([...state.files].sort()).toEqual([".hidden.md", "keep.md", "new.md"]);
        expect(state.directories.get("")).toBe(entries);
        expect(invalidatedDirectories.has("")).toBe(false);
    });

    it("retires an absent subtree while preserving newer descendant invalidations", async () => {
        const state = inventory(
            ["gone/one.md", "gone/nested/two.md", "keep.md"],
            [
                ["", [directory("gone"), file("keep.md")]],
                ["gone", [file("one.md"), directory("nested")]],
                ["gone/nested", [file("two.md")]],
            ]
        );
        const unrelatedFailure = new Error("unrelated scope remains unreadable");
        state.readErrors.set("gone/nested", new Error("obsolete descendant failure"));
        state.readErrors.set("other", unrelatedFailure);
        const directoryGenerations = new Map([
            ["gone", 2],
            ["gone/nested", 3],
        ]);
        const readDependencies: RefreshDirectoryDependencies = {
            reader: { readDirectory: vi.fn<InventoryReader["readDirectory"]>().mockResolvedValue(null) },
            basePath: "/vault",
            reportDiagnostic: vi.fn(),
            directoryGenerations,
            getBoundary: () => Math.max(0, ...directoryGenerations.values()),
            markDirectoryDirty: vi.fn(),
        };
        const changes = createRefreshChanges();
        await refreshDirectory(readDependencies, state, "gone", changes, true, new Set());
        expect(state.index.getFileNames()).toContain("gone/nested/two.md");

        const invalidatedDirectories = new Map([
            ["gone", 5],
            ["gone/nested", 9],
        ]);
        commitRefresh(
            { assertNotClosed: vi.fn(), onValidatedDirectories: vi.fn(), invalidatedDirectories, directoryGenerations },
            state,
            changes,
            5
        );

        expect(state.index.getFileNames()).toEqual(["keep.md"]);
        expect(state.directories.has("gone")).toBe(false);
        expect(state.directories.has("gone/nested")).toBe(false);
        expect(state.readErrors.has("gone/nested")).toBe(false);
        expect(state.readErrors.get("other")).toBe(unrelatedFailure);
        expect(invalidatedDirectories.get("gone/nested")).toBe(9);
        expect(directoryGenerations.get("gone/nested")).toBe(3);
        expect(directoryGenerations.has("gone")).toBe(false);
    });

    it("stages validated physical spellings while retiring prior Legacy exclusions", async () => {
        const originalName = "Cafe\u0301.md";
        const readDirectory = readerForListings(new Map([["", [file(originalName), file(".hidden.md")]]]));
        const policy: PathComparisonSettings = { ...legacyPolicy, pathNormalizationVersion: 1 };
        const listing = await readDirectory("", policy);
        expect(listing?.kind).toBe("validated");
        if (!listing) {
            throw new Error("Expected a validated fixture listing");
        }
        const changes = createRefreshChanges();
        const reportDiagnostic = vi.fn();

        stageFileMembershipChanges({ reportDiagnostic }, "", [file("old.md"), file("C:excluded.md")], listing, changes);

        expect([...changes.removedFiles]).toEqual(["old.md"]);
        expect([...changes.addedFiles].sort()).toEqual([".hidden.md", originalName]);
        expect(reportDiagnostic).not.toHaveBeenCalled();
    });

    it("diagnoses only newly excluded Legacy file names when staging a delta", () => {
        const changes = createRefreshChanges();
        const reportDiagnostic = vi.fn();
        stageFileMembershipChanges(
            { reportDiagnostic },
            "",
            [file("keep.md"), file("old.md"), file("C:retained.md"), file("C:removed.md")],
            legacyListing([file("keep.md"), file("new.md"), file("C:retained.md"), file("C:added.md")]),
            changes
        );

        expect([...changes.removedFiles]).toEqual(["old.md"]);
        expect([...changes.addedFiles]).toEqual(["new.md"]);
        expect(reportDiagnostic).toHaveBeenCalledExactlyOnceWith(
            "[CLIFileNameSource] Skipped invalid path 'C:added.md':",
            expect.any(Error)
        );
    });

    it("keeps subtree retirement idempotent and excludes hidden child directories", () => {
        const state = inventory(
            ["gone/one.md", "gone/nested/two.md", "keep.md"],
            [
                ["", [directory("gone"), file("keep.md")]],
                ["gone", [file("one.md"), directory("nested"), directory(".private")]],
                ["gone/nested", [file("two.md")]],
            ]
        );
        const changes = createRefreshChanges();
        const visited = new Set<string>();
        stageRemoveSubtree(state, "gone", changes, visited);
        stageRemoveSubtree(state, "gone", changes, visited);
        stageRemoveSubtree(state, "gone", changes, new Set());

        expect(currentEntries(state, "gone", changes)).toEqual([]);
        expect([...changes.removedFiles].sort()).toEqual(["gone/nested/two.md", "gone/one.md"]);
        expect([...changes.removedDirectories].sort()).toEqual(["gone", "gone/nested"]);
        expect(state.index.getFileNames().sort()).toEqual(["gone/nested/two.md", "gone/one.md", "keep.md"]);
    });

    it("keeps the published view and pending scope when an observation supersedes a read", async () => {
        const state = inventory(["before.md"], [["", [file("before.md")]]]);
        let finishRead!: (listing: DirectoryListing) => void;
        const readDirectory = vi.fn<InventoryReader["readDirectory"]>(
            () =>
                new Promise((resolve) => {
                    finishRead = resolve;
                })
        );
        const directoryGenerations = new Map([["", 1]]);
        const invalidatedDirectories = new Map([["", 7]]);
        const onValidatedDirectories = vi.fn();
        const dependencies: ReconcilePendingDependencies = {
            reader: { readDirectory },
            basePath: "/vault",
            reportDiagnostic: vi.fn(),
            directoryGenerations,
            getBoundary: () => Math.max(0, ...directoryGenerations.values()),
            invalidatedDirectories,
            markDirectoryDirty: vi.fn(),
            assertNotClosed: vi.fn(),
            onValidatedDirectories,
        };

        const pending = reconcilePending(dependencies, state, 7);
        directoryGenerations.set("", 2);
        finishRead(legacyListing([file("after.md")]));

        await expect(pending).resolves.toEqual(new Set([""]));
        expect(state.index.getFileNames()).toEqual(["before.md"]);
        expect(state.directories.get("")).toEqual([file("before.md")]);
        expect(invalidatedDirectories.get("")).toBe(7);
        expect(onValidatedDirectories).not.toHaveBeenCalled();
    });

    it("clears prior error evidence before notifying the owner and then publishes new errors", () => {
        const state = inventory([], [["", []]]);
        state.readErrors.set("", new Error("previous failed read"));
        const failure = new Error("new failed read");
        const changes = createRefreshChanges();
        changes.clearedErrors.add("");
        changes.readErrors.set("", failure);
        const onValidatedDirectories = vi.fn((_policy: PathComparisonSettings, scopes: ReadonlySet<string>) => {
            expect(scopes.has("")).toBe(true);
            expect(state.readErrors.has("")).toBe(false);
        });
        const dependencies: CommitRefreshDependencies = {
            assertNotClosed: vi.fn(),
            onValidatedDirectories,
            invalidatedDirectories: new Map(),
            directoryGenerations: new Map(),
        };

        commitRefresh(dependencies, state, changes, 0);

        expect(onValidatedDirectories).toHaveBeenCalledOnce();
        expect(state.readErrors.get("")).toBe(failure);
    });

    it("retains an observation whose generation is newer than the staged read", () => {
        const state = inventory(["keep.md"], [["", [file("keep.md")]]]);
        const changes = createRefreshChanges();
        changes.checkedGenerations.set("", 1);
        const invalidatedDirectories = new Map([["", 5]]);
        const directoryGenerations = new Map([["", 2]]);

        commitRefresh(
            {
                assertNotClosed: vi.fn(),
                onValidatedDirectories: vi.fn(),
                invalidatedDirectories,
                directoryGenerations,
            },
            state,
            changes,
            5
        );

        // Its first sequence is captured, but the newer observation remains pending.
        expect(invalidatedDirectories.get("")).toBe(5);
        expect(directoryGenerations.get("")).toBe(2);
        expect(state.index.getFileNames()).toEqual(["keep.md"]);
    });

    it.each([0, 1] as const)(
        "retires a parent disappearing during target traversal without treating absence as a read error (version %i)",
        async (version) => {
            const policy: PathComparisonSettings = { ...legacyPolicy, pathNormalizationVersion: version };
            const rootEntries = [directory("docs"), file("keep.md")];
            const state = inventory(
                ["docs/nested/note.md", "keep.md"],
                [
                    ["", rootEntries],
                    ["docs", [directory("nested")]],
                    ["docs/nested", [file("note.md")]],
                ],
                policy
            );
            // The root listing precedes deletion; the next physical read sees absence.
            const readDirectory = readerForListings(new Map([["", rootEntries]]));
            const directoryGenerations = new Map([
                ["", 1],
                ["docs", 2],
                ["docs/nested", 3],
            ]);
            const dependencies: InventoryReconcilerDependencies = {
                reader: {
                    readDirectory,
                },
                basePath: "/vault",
                reportDiagnostic: vi.fn(),
                invalidatedDirectories: new Map(),
                directoryGenerations,
                markDirectoryDirty: vi.fn(),
                assertNotClosed: vi.fn(),
                onValidatedDirectories: vi.fn(),
                getBoundary: () => 3,
                assertInventoryAvailable: vi.fn(),
            };
            const target = parseFilePath("docs/nested/note.md");

            const generations = await revalidateTargetBranches(dependencies, state, target);

            expect(readDirectory.mock.calls.map(([path]) => path)).toEqual(["", "docs"]);
            expect(state.directories.has("docs")).toBe(false);
            expect(state.directories.has("docs/nested")).toBe(false);
            expect(state.index.getFileNames()).toEqual(["keep.md"]);
            expect(state.index.findPathIdentityCandidates(target, policy)).toEqual([]);
            expect(state.readErrors.size).toBe(0);
            expect(dependencies.reportDiagnostic).not.toHaveBeenCalled();
            expect(generationsUnchanged(directoryGenerations, generations)).toBe(true);
        }
    );

    it("retains last known membership and the read failure before rejecting a target branch", async () => {
        const policy: PathComparisonSettings = { pathNormalizationVersion: 1, handleFilenameCaseSensitive: true };
        const state = inventory(["retained.md"], [["", [file("retained.md")]]], policy);
        const failure = new Error("directory unreadable");
        const dependencies: InventoryReconcilerDependencies = {
            reader: {
                readDirectory: vi.fn<InventoryReader["readDirectory"]>().mockRejectedValue(failure),
            },
            basePath: "/vault",
            reportDiagnostic: vi.fn(),
            invalidatedDirectories: new Map([["", 1]]),
            directoryGenerations: new Map([["", 1]]),
            markDirectoryDirty: vi.fn(),
            assertNotClosed: vi.fn(),
            onValidatedDirectories: vi.fn(),
            getBoundary: () => 1,
            assertInventoryAvailable: vi.fn(),
        };

        await expect(refreshSingleDirectory(dependencies, state, "")).rejects.toBe(failure);

        expect(state.index.getFileNames()).toEqual(["retained.md"]);
        expect(state.readErrors.get("")).toBe(failure);
    });

    it("validates every equivalent physical parent before returning target generations", async () => {
        const policy: PathComparisonSettings = { pathNormalizationVersion: 0, handleFilenameCaseSensitive: false };
        const state = inventory([], [["", []]], policy);
        const listings = new Map<string, readonly DirectoryEntry[]>([
            ["", [directory("Docs"), directory("docs")]],
            ["Docs", [file("Note.md")]],
            ["docs", [file("note.md")]],
        ]);
        const readDirectory = readerForListings(listings);
        const invalidatedDirectories = new Map<string, number>();
        const directoryGenerations = new Map([["", 1]]);
        let boundary = 1;
        const dependencies: InventoryReconcilerDependencies = {
            reader: {
                readDirectory,
            },
            basePath: "/vault",
            reportDiagnostic: vi.fn(),
            invalidatedDirectories,
            directoryGenerations,
            markDirectoryDirty: (path) => {
                invalidatedDirectories.set(path, ++boundary);
                directoryGenerations.set(path, (directoryGenerations.get(path) ?? 0) + 1);
            },
            assertNotClosed: vi.fn(),
            onValidatedDirectories: vi.fn(),
            getBoundary: () => boundary,
            assertInventoryAvailable: vi.fn(),
        };

        const generations = await revalidateTargetBranches(dependencies, state, parseFilePath("docs/note.md"));

        expect(readDirectory.mock.calls.map(([path]) => path)).toEqual(["", "Docs", "docs"]);
        expect(state.index.findPathIdentityCandidates(parseFilePath("docs/note.md"), policy)).toEqual([
            "Docs/Note.md",
            "docs/note.md",
        ]);
        expect(generationsUnchanged(directoryGenerations, generations)).toBe(true);
        directoryGenerations.set("Docs", 2);
        expect(generationsUnchanged(directoryGenerations, generations)).toBe(false);
    });
    it.each([
        [0, ".private/secret.md", [""]],
        [1, "visible/.private/secret.md", ["", "visible"]],
    ] as const)(
        "keeps hidden subtrees outside current-path validation (version %i, path %s)",
        async (version, target, expectedReads) => {
            const policy: PathComparisonSettings = { ...legacyPolicy, pathNormalizationVersion: version };
            const state = inventory([], [["", []]], policy);
            const listings = new Map<string, readonly DirectoryEntry[]>([
                ["", [directory(".private"), directory("visible")]],
                ["visible", [directory(".private")]],
                [".private", [file("secret.md")]],
                ["visible/.private", [file("secret.md")]],
            ]);
            const readDirectory = readerForListings(listings);
            const dependencies: InventoryReconcilerDependencies = {
                reader: {
                    readDirectory,
                },
                basePath: "/vault",
                reportDiagnostic: vi.fn(),
                invalidatedDirectories: new Map(),
                directoryGenerations: new Map(),
                markDirectoryDirty: vi.fn(),
                assertNotClosed: vi.fn(),
                onValidatedDirectories: vi.fn(),
                getBoundary: () => 0,
                assertInventoryAvailable: vi.fn(),
            };

            await revalidateTargetBranches(dependencies, state, parseFilePath(target));

            expect(readDirectory.mock.calls.map(([path]) => path)).toEqual(expectedReads);
            expect(state.index.getFileNames()).toEqual([]);
            expect(state.index.findPathIdentityCandidates(parseFilePath(target), policy)).toEqual([]);
        }
    );
    it("rejects subtree retirement when a descendant changes during its parent read", async () => {
        const state = inventory(
            ["gone/nested/old.md"],
            [
                ["", [directory("gone")]],
                ["gone", [directory("nested")]],
                ["gone/nested", [file("old.md")]],
            ]
        );
        let sequence = 2;
        const directoryGenerations = new Map([
            ["gone", 1],
            ["gone/nested", 2],
        ]);
        const readDirectory = vi.fn<InventoryReader["readDirectory"]>(async () => {
            // The parent snapshot misses a child recreated before this read
            // completes. Its earlier pending sequence is deliberately retained.
            directoryGenerations.set("gone/nested", ++sequence);
            return legacyListing([]);
        });
        const dependencies = {
            reader: { readDirectory },
            basePath: "/vault",
            reportDiagnostic: vi.fn(),
            directoryGenerations,
            getBoundary: () => sequence,
            markDirectoryDirty: vi.fn(),
        };
        const changes = createRefreshChanges();
        await refreshDirectory(dependencies, state, "gone", changes, true, new Set());

        expect(generationsUnchanged(directoryGenerations, changes.checkedGenerations)).toBe(false);
        expect(state.index.getFileNames()).toEqual(["gone/nested/old.md"]);
    });
    it("reconciles a recreated descendant instead of losing its older pending observation", async () => {
        const state = inventory(
            ["gone/nested/old.md"],
            [
                ["", [directory("gone")]],
                ["gone", [directory("nested")]],
                ["gone/nested", [file("old.md")]],
            ]
        );
        let sequence = 2;
        const directoryGenerations = new Map([
            ["gone", 1],
            ["gone/nested", 2],
        ]);
        const invalidatedDirectories = new Map([
            ["gone", 1],
            ["gone/nested", 1],
        ]);
        const readDirectory = vi.fn<InventoryReader["readDirectory"]>(async (path) => {
            if (path === "gone") {
                directoryGenerations.set("gone/nested", ++sequence);
                return legacyListing([]);
            }
            return legacyListing([file("new.md")]);
        });
        const dependencies: ReconcilePendingDependencies = {
            reader: { readDirectory },
            basePath: "/vault",
            reportDiagnostic: vi.fn(),
            directoryGenerations,
            invalidatedDirectories,
            getBoundary: () => sequence,
            markDirectoryDirty: vi.fn(),
            assertNotClosed: vi.fn(),
            onValidatedDirectories: vi.fn(),
        };
        const unresolved = await reconcilePending(dependencies, state, 2);

        expect(unresolved).toEqual(new Set(["gone"]));
        expect(invalidatedDirectories.get("gone")).toBe(1);
        expect(readDirectory.mock.calls.map(([path]) => path)).toEqual(["gone", "gone/nested"]);
        expect(state.index.getFileNames()).toEqual(["gone/nested/new.md"]);
    });
});
