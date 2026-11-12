import { describe, expect, it, vi } from "vitest";
import {
    parseFilePath,
    type DirectoryEntry,
    type PathComparisonSettings,
    type StoragePath,
} from "@vrtmrz/livesync-commonlib/storage";
import {
    createEmptyState,
    enumerate,
    readDirectory,
    scanWholeDirectory,
    selectPolicy,
    type InventoryReaderDependencies,
} from "./CLIFileNameSource.inventory";
import type { InventoryState } from "./CLIFileNameSource.state";

function policy(pathNormalizationVersion: 0 | 1, handleFilenameCaseSensitive = true): PathComparisonSettings {
    return { pathNormalizationVersion, handleFilenameCaseSensitive };
}

describe("CLIFileNameSource inventory operations", () => {
    it("preserves physical spellings in Legacy listings and rejects NFC sibling aliases", async () => {
        const nfcName = "caf\u00e9.md";
        const nfdName = "cafe\u0301.md";
        const entries: readonly DirectoryEntry[] = [
            { name: nfcName, kind: "file" },
            { name: nfdName, kind: "file" },
        ];
        const storage = {
            readDirectory: vi.fn(async (_directory: StoragePath): Promise<readonly DirectoryEntry[] | null> => entries),
        };
        const freshFailures: Array<{
            state: InventoryState;
            policy: PathComparisonSettings;
            error: unknown;
        }> = [];
        const enumerationDependencies: Pick<
            InventoryReaderDependencies,
            "storage" | "basePath" | "reportDiagnostic" | "recordFreshFailure"
        > = {
            storage,
            basePath: "/vault",
            reportDiagnostic: vi.fn(),
            recordFreshFailure: (state, selectedPolicy, error) => {
                freshFailures.push({ state, policy: selectedPolicy, error });
            },
        };

        await expect(readDirectory({ storage }, "", policy(0))).resolves.toEqual({ kind: "legacy", entries });

        const legacyState = await enumerate(enumerationDependencies, policy(0));
        expect(Array.from(legacyState.files)).toEqual([parseFilePath(nfcName), parseFilePath(nfdName)]);

        await expect(readDirectory({ storage }, "", policy(1))).rejects.toThrow(/Ambiguous/);
        await expect(enumerate(enumerationDependencies, policy(1), true)).rejects.toThrow(/Ambiguous/);
        expect(freshFailures).toHaveLength(1);
        expect(freshFailures[0]?.state.aliasErrors.has("")).toBe(true);
        expect(freshFailures[0]?.policy).toEqual(policy(1));
        expect(freshFailures[0]?.error).toBeInstanceOf(Error);
    });

    it("returns full physical paths and entry kinds for non-root NFC listings", async () => {
        const nfdName = "cafe\u0301.md";
        const entries: readonly DirectoryEntry[] = [
            { name: nfdName, kind: "file" },
            { name: "nested", kind: "directory" },
        ];
        const storage = {
            readDirectory: vi.fn(
                async (directory: StoragePath): Promise<readonly DirectoryEntry[] | null> =>
                    directory === "folder" ? entries : null
            ),
        };

        await expect(readDirectory({ storage }, "folder", policy(1))).resolves.toEqual({
            kind: "validated",
            entries: [
                { path: "folder/" + nfdName, kind: "file" },
                { path: "folder/nested", kind: "directory" },
            ],
        });
        expect(storage.readDirectory).toHaveBeenCalledWith("folder");
    });

    it.each([0, 1] as const)("preserves an absent listing as null in mode %i", async (version) => {
        const storage = {
            readDirectory: vi.fn(async (_directory: StoragePath): Promise<readonly DirectoryEntry[] | null> => null),
        };

        await expect(readDirectory({ storage }, "folder", policy(version))).resolves.toBeNull();
        expect(storage.readDirectory).toHaveBeenCalledWith("folder");
    });

    it("keeps a readable Legacy inventory after a descendant failure and retains an NFC fresh failure", async () => {
        const descendantFailure = new Error("descendant listing failed");
        const rootEntries: readonly DirectoryEntry[] = [
            { name: "unreadable", kind: "directory" },
            { name: "visible.md", kind: "file" },
        ];
        const storage = {
            readDirectory: vi.fn(async (directory: StoragePath): Promise<readonly DirectoryEntry[] | null> => {
                if (directory === "") {
                    return rootEntries;
                }
                if (directory === "unreadable") {
                    throw descendantFailure;
                }
                return null;
            }),
        };
        const reportDiagnostic = vi.fn();
        const scanDependencies: Pick<InventoryReaderDependencies, "storage" | "basePath" | "reportDiagnostic"> = {
            storage,
            basePath: "/vault",
            reportDiagnostic,
        };
        const legacyState = createEmptyState(policy(0));

        await scanWholeDirectory(scanDependencies, legacyState, "", true);

        expect(Array.from(legacyState.files)).toEqual([parseFilePath("visible.md")]);
        expect(legacyState.readErrors.get("unreadable")).toBe(descendantFailure);
        expect(reportDiagnostic).toHaveBeenCalledWith(
            "[CLIFileNameSource] Skipped unreadable directory 'unreadable':",
            descendantFailure
        );

        const freshFailures: Array<{
            state: InventoryState;
            policy: PathComparisonSettings;
            error: unknown;
        }> = [];
        const enumerationDependencies: Pick<
            InventoryReaderDependencies,
            "storage" | "basePath" | "reportDiagnostic" | "recordFreshFailure"
        > = {
            ...scanDependencies,
            recordFreshFailure: (state, selectedPolicy, error) => {
                freshFailures.push({ state, policy: selectedPolicy, error });
            },
        };

        await expect(enumerate(enumerationDependencies, policy(1), true)).rejects.toThrow(/descendant listing failed/);
        expect(freshFailures).toHaveLength(1);
        expect(freshFailures[0]?.state.readErrors.has("unreadable")).toBe(true);
        expect(freshFailures[0]?.policy).toEqual(policy(1));
        expect(freshFailures[0]?.error).toBeInstanceOf(Error);
    });

    it.each([0, 1] as const)(
        "treats a missing root as unavailable and an absent descendant as empty (version %i)",
        async (version) => {
            const rootEntries: readonly DirectoryEntry[] = [
                { name: "absent", kind: "directory" },
                { name: "visible.md", kind: "file" },
            ];
            const descendantStorage = {
                readDirectory: vi.fn(
                    async (directory: StoragePath): Promise<readonly DirectoryEntry[] | null> =>
                        directory === "" ? rootEntries : null
                ),
            };
            const reportDiagnostic = vi.fn();
            const descendantState = createEmptyState(policy(version));

            await scanWholeDirectory(
                { storage: descendantStorage, basePath: "/vault", reportDiagnostic },
                descendantState,
                "",
                true
            );

            expect(Array.from(descendantState.files)).toEqual([parseFilePath("visible.md")]);
            expect(descendantState.directories.has("absent")).toBe(false);
            expect(reportDiagnostic).not.toHaveBeenCalled();

            const unavailableStorage = {
                readDirectory: vi.fn(
                    async (_directory: StoragePath): Promise<readonly DirectoryEntry[] | null> => null
                ),
            };
            const unavailableState = createEmptyState(policy(version));
            await expect(
                scanWholeDirectory(
                    { storage: unavailableStorage, basePath: "/vault", reportDiagnostic },
                    unavailableState,
                    "",
                    true
                )
            ).rejects.toThrow("The CLI file-name source root is unavailable: /vault");
            expect(unavailableStorage.readDirectory).toHaveBeenCalledWith("");
            expect(unavailableState.files.size).toBe(0);
        }
    );

    it("skips an invalid Legacy leaf while retaining readable names", async () => {
        const entries: readonly DirectoryEntry[] = [
            { name: "C:unsupported.md", kind: "file" },
            { name: "visible.md", kind: "file" },
        ];
        const storage = {
            readDirectory: vi.fn(async (_directory: StoragePath): Promise<readonly DirectoryEntry[] | null> => entries),
        };
        const reportDiagnostic = vi.fn();
        const state = createEmptyState(policy(0));

        await scanWholeDirectory({ storage, basePath: "/vault", reportDiagnostic }, state, "", true);

        expect(Array.from(state.files)).toEqual([parseFilePath("visible.md")]);
        expect(reportDiagnostic).toHaveBeenCalledWith(
            expect.stringContaining("Skipped invalid path 'C:unsupported.md':"),
            expect.any(Error)
        );

        // Legacy skips remain in physical coverage and must block NFC activation.
        await selectPolicy({ markDirectoryDirty: vi.fn() }, state, policy(1));
        expect(state.aliasErrors.get("")).toBeInstanceOf(Error);
        expect(storage.readDirectory).toHaveBeenCalledTimes(1);
        expect(Array.from(state.files)).toEqual([parseFilePath("visible.md")]);
    });

    it("rejects unsupported runtime policies before reading or publishing them", async () => {
        const unsupportedVersion = {
            pathNormalizationVersion: 2,
            handleFilenameCaseSensitive: true,
        } as unknown as PathComparisonSettings;
        const invalidCasePolicy = {
            pathNormalizationVersion: 1,
            handleFilenameCaseSensitive: 1,
        } as unknown as PathComparisonSettings;
        const storage = {
            readDirectory: vi.fn(async (_directory: StoragePath): Promise<readonly DirectoryEntry[] | null> => []),
        };
        const recordFreshFailure = vi.fn();
        const enumerationDependencies = {
            storage,
            basePath: "/vault",
            reportDiagnostic: vi.fn(),
            recordFreshFailure,
        };

        for (const invalidPolicy of [unsupportedVersion, invalidCasePolicy]) {
            await expect(enumerate(enumerationDependencies, invalidPolicy, true)).rejects.toThrow(
                "Unsupported path comparison policy"
            );
        }
        expect(storage.readDirectory).not.toHaveBeenCalled();
        expect(recordFreshFailure).not.toHaveBeenCalled();

        const state = createEmptyState(policy(0));
        const markDirectoryDirty = vi.fn();
        await expect(selectPolicy({ markDirectoryDirty }, state, invalidCasePolicy)).rejects.toThrow(
            "Unsupported path comparison policy"
        );
        expect(state.policy).toEqual(policy(0));
        expect(markDirectoryDirty).not.toHaveBeenCalled();
    });

    it("revalidates cached siblings and dirties unreadable scopes without storage access", async () => {
        const nfcName = "caf\u00e9.md";
        const nfdName = "cafe\u0301.md";
        const state = createEmptyState(policy(0));
        state.directories.set("", [
            { name: nfcName, kind: "file" },
            { name: nfdName, kind: "file" },
        ]);
        state.readErrors.set("unreadable", new Error("prior listing failure"));
        const markDirectoryDirty = vi.fn();
        const dependencies: Pick<InventoryReaderDependencies, "markDirectoryDirty"> = { markDirectoryDirty };

        await selectPolicy(dependencies, state, policy(1));

        expect(state.policy).toEqual(policy(1));
        expect(state.aliasErrors.get("")).toBeInstanceOf(Error);
        expect(state.aliasErrors.get("")?.message).toContain(nfcName);
        expect(state.aliasErrors.get("")?.message).toContain(nfdName);
        expect(markDirectoryDirty).toHaveBeenCalledTimes(1);
        expect(markDirectoryDirty).toHaveBeenCalledWith("unreadable");

        await selectPolicy(dependencies, state, policy(0));
        expect(state.aliasErrors.size).toBe(0);

        state.directories.set("", [{ name: nfcName, kind: "file" }]);
        await selectPolicy(dependencies, state, policy(1));

        expect(state.policy).toEqual(policy(1));
        expect(state.aliasErrors.size).toBe(0);
        expect(markDirectoryDirty).toHaveBeenCalledTimes(2);
    });
});
