import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    useConflictResolver,
    resolveConflictByDeletingRevHandler,
    resolveConflictHandler,
    resolveConflictByNewestHandler,
    resolveAllConflictedFilesByNewerOnesHandler,
    checkConflictAndPerformAutoMerge,
} from "./conflictResolver";
import { createMockServiceHub } from "../mockServiceHub";
import { AUTO_MERGED, MISSING_OR_ERROR, NOT_CONFLICTED, CANCELLED } from "@lib/common/types";

describe("conflictResolver", () => {
    let mockHub: ReturnType<typeof createMockServiceHub>;

    beforeEach(() => {
        mockHub = createMockServiceHub();
    });

    it("should register conflict resolver handlers", () => {
        useConflictResolver(mockHub as any);
        expect((mockHub.services.conflict.resolveByDeletingRevision as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.conflict.resolve as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.conflict.resolveByNewest as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.conflict.resolveAllConflictedFilesByNewerOnes as any).handlers.length).toBeGreaterThan(
            0
        );
    });

    describe("resolveConflictByDeletingRevHandler", () => {
        it("resolveConflictByDeletingRevHandler should return MISSING_OR_ERROR if delete fails", async () => {
            (mockHub as any).serviceModules = {
                fileHandler: {
                    deleteRevisionFromDB: vi.fn().mockResolvedValue(false),
                },
            };
            const res = await resolveConflictByDeletingRevHandler(mockHub as any, "test.md" as any, "1-abc");
            expect(res).toBe(MISSING_OR_ERROR);
            expect(mockHub.services.API.addLog).toHaveBeenCalledWith(
                expect.stringContaining("Could not delete conflicted revision"),
                expect.any(Number),
                ""
            );
        });

        it("resolveConflictByDeletingRevHandler should return early with AUTO_MERGED if conflicts are left", async () => {
            (mockHub as any).serviceModules = {
                fileHandler: {
                    deleteRevisionFromDB: vi.fn().mockResolvedValue(true),
                },
                databaseFileAccess: {
                    getConflictedRevs: vi.fn().mockResolvedValue(["2-def"]),
                },
            };
            const res = await resolveConflictByDeletingRevHandler(mockHub as any, "test.md" as any, "1-abc");
            expect(res).toBe(AUTO_MERGED);
        });

        it("resolveConflictByDeletingRevHandler should not write to storage for plugin metadata", async () => {
            (mockHub as any).serviceModules = {
                fileHandler: {
                    deleteRevisionFromDB: vi.fn().mockResolvedValue(true),
                },
                databaseFileAccess: {
                    getConflictedRevs: vi.fn().mockResolvedValue([]),
                },
            };
            const res = await resolveConflictByDeletingRevHandler(mockHub as any, "ps:someplugin" as any, "1-abc");
            expect(res).toBe(AUTO_MERGED);

            const resCustom = await resolveConflictByDeletingRevHandler(
                mockHub as any,
                "ix:somecustomisation" as any,
                "1-abc"
            );
            expect(resCustom).toBe(AUTO_MERGED);
        });

        it("resolveConflictByDeletingRevHandler should write to storage and return AUTO_MERGED for normal files", async () => {
            (mockHub as any).serviceModules = {
                fileHandler: {
                    deleteRevisionFromDB: vi.fn().mockResolvedValue(true),
                    dbToStorage: vi.fn().mockResolvedValue(true),
                },
                databaseFileAccess: {
                    getConflictedRevs: vi.fn().mockResolvedValue([]),
                },
            };
            const res = await resolveConflictByDeletingRevHandler(mockHub as any, "test.md" as any, "1-abc");
            expect(res).toBe(AUTO_MERGED);
            expect((mockHub as any).serviceModules.fileHandler.dbToStorage).toHaveBeenCalledWith(
                "test.md",
                "test.md",
                true
            );
        });

        it("resolveConflictByDeletingRevHandler should return MISSING_OR_ERROR if write to storage fails", async () => {
            (mockHub as any).serviceModules = {
                fileHandler: {
                    deleteRevisionFromDB: vi.fn().mockResolvedValue(true),
                    dbToStorage: vi.fn().mockResolvedValue(false),
                },
                databaseFileAccess: {
                    getConflictedRevs: vi.fn().mockResolvedValue([]),
                },
            };
            const res = await resolveConflictByDeletingRevHandler(mockHub as any, "test.md" as any, "1-abc");
            expect(res).toBe(MISSING_OR_ERROR);
        });
    });

    describe("checkConflictAndPerformAutoMerge", () => {
        it("should return ok result if tryAutoMerge returns ok", async () => {
            mockHub.services.database.localDatabase.tryAutoMerge = vi.fn().mockResolvedValue({ ok: NOT_CONFLICTED });
            const res = await checkConflictAndPerformAutoMerge(mockHub as any, "test.md" as any);
            expect(res).toBe(NOT_CONFLICTED);
        });

        it("should store content and resolve when tryAutoMerge returns merged result", async () => {
            mockHub.services.database.localDatabase.tryAutoMerge = vi.fn().mockResolvedValue({
                result: "merged content",
                conflictedRev: "2-def",
            });
            (mockHub as any).serviceModules = {
                databaseFileAccess: {
                    storeContent: vi.fn().mockResolvedValue(true),
                },
            };
            mockHub.services.conflict.resolveByDeletingRevision = vi.fn().mockResolvedValue(AUTO_MERGED);

            const res = await checkConflictAndPerformAutoMerge(mockHub as any, "test.md" as any);
            expect(res).toBe(AUTO_MERGED);
            expect((mockHub as any).serviceModules.databaseFileAccess.storeContent).toHaveBeenCalledWith(
                "test.md",
                "merged content"
            );
            expect(mockHub.services.conflict.resolveByDeletingRevision).toHaveBeenCalledWith(
                "test.md",
                "2-def",
                "Sensible"
            );
        });

        it("should return MISSING_OR_ERROR if storeContent fails", async () => {
            mockHub.services.database.localDatabase.tryAutoMerge = vi.fn().mockResolvedValue({
                result: "merged content",
                conflictedRev: "2-def",
            });
            (mockHub as any).serviceModules = {
                databaseFileAccess: {
                    storeContent: vi.fn().mockResolvedValue(false),
                },
            };

            const res = await checkConflictAndPerformAutoMerge(mockHub as any, "test.md" as any);
            expect(res).toBe(MISSING_OR_ERROR);
        });

        it("should handle missing leaves when tryAutoMerge returns leaves", async () => {
            mockHub.services.database.localDatabase.tryAutoMerge = vi.fn().mockResolvedValue({
                rightRev: "2-def",
                leftLeaf: false,
                rightLeaf: {},
            });

            let res = await checkConflictAndPerformAutoMerge(mockHub as any, "test.md" as any);
            expect(res).toBe(MISSING_OR_ERROR);

            mockHub.services.database.localDatabase.tryAutoMerge.mockResolvedValue({
                rightRev: "2-def",
                leftLeaf: {},
                rightLeaf: false,
            });
            mockHub.services.conflict.resolveByDeletingRevision = vi.fn().mockResolvedValue(AUTO_MERGED);
            res = await checkConflictAndPerformAutoMerge(mockHub as any, "test.md" as any);
            expect(res).toBe(AUTO_MERGED);
            expect(mockHub.services.conflict.resolveByDeletingRevision).toHaveBeenCalledWith(
                "test.md",
                "2-def",
                "MISSING OLD REV"
            );
        });

        it("should resolve conflict by newer leaf if isSame, isBinary, or alwaysNewer is true", async () => {
            mockHub.services.database.localDatabase.tryAutoMerge = vi.fn().mockResolvedValue({
                rightRev: "2-def",
                leftLeaf: { rev: "1-abc", mtime: 10000, data: "a", deleted: false },
                rightLeaf: { rev: "2-def", mtime: 20000, data: "a", deleted: false },
            });
            mockHub.services.conflict.resolveByDeletingRevision = vi.fn().mockResolvedValue(AUTO_MERGED);

            const res = await checkConflictAndPerformAutoMerge(mockHub as any, "test.md" as any);
            expect(res).toBe(AUTO_MERGED);
            expect(mockHub.services.conflict.resolveByDeletingRevision).toHaveBeenCalledWith(
                "test.md",
                "1-abc",
                "same"
            );
        });

        it("should return diff match result if manual merge is required", async () => {
            mockHub.services.database.localDatabase.tryAutoMerge = vi.fn().mockResolvedValue({
                rightRev: "2-def",
                leftLeaf: { rev: "1-abc", mtime: 100, data: "hello", deleted: false },
                rightLeaf: { rev: "2-def", mtime: 200, data: "world", deleted: false },
            });

            const res = await checkConflictAndPerformAutoMerge(mockHub as any, "test.md" as any);
            expect(res).toHaveProperty("left");
            expect(res).toHaveProperty("right");
            expect(res).toHaveProperty("diff");
        });
    });

    describe("resolveConflictHandler", () => {
        it("should run resolveConflictHandler and skip if not conflicted or cancelled", async () => {
            (mockHub.services.setting.settings as any).syncAfterMerge = true;
            mockHub.services.database.localDatabase.tryAutoMerge = vi.fn().mockResolvedValue({ ok: NOT_CONFLICTED });

            await resolveConflictHandler(mockHub as any, "test.md" as any);
            expect(mockHub.services.conflict.queueCheckFor).not.toHaveBeenCalled();
        });

        it("should queue check again and run replication if automatically merged", async () => {
            (mockHub.services.setting.settings as any).syncAfterMerge = true;
            mockHub.services.appLifecycle.isSuspended.mockReturnValue(false);
            mockHub.services.database.localDatabase.tryAutoMerge = vi.fn().mockResolvedValue({ ok: AUTO_MERGED });
            mockHub.services.replication.replicateByEvent = vi.fn().mockResolvedValue(true);

            await resolveConflictHandler(mockHub as any, "test.md" as any);

            expect(mockHub.services.replication.replicateByEvent).toHaveBeenCalled();
            expect(mockHub.services.conflict.queueCheckFor).toHaveBeenCalledWith("test.md");
        });

        it("should trigger manual user resolution if manual merge is required", async () => {
            (mockHub.services.setting.settings as any).showMergeDialogOnlyOnActive = true;
            mockHub.services.vault.getActiveFilePath = vi.fn().mockReturnValue("test.md");

            mockHub.services.database.localDatabase.tryAutoMerge = vi.fn().mockResolvedValue({
                rightRev: "2-def",
                leftLeaf: { rev: "1-abc", mtime: 100, data: "hello", deleted: false },
                rightLeaf: { rev: "2-def", mtime: 200, data: "world", deleted: false },
            });
            mockHub.services.conflict.resolveByUserInteraction = vi.fn().mockResolvedValue(true);

            await resolveConflictHandler(mockHub as any, "test.md" as any);
            expect(mockHub.services.conflict.resolveByUserInteraction).toHaveBeenCalled();
        });

        it("should postpone merge dialogue if showMergeDialogOnlyOnActive is true and file is not active", async () => {
            (mockHub.services.setting.settings as any).showMergeDialogOnlyOnActive = true;
            mockHub.services.vault.getActiveFilePath = vi.fn().mockReturnValue("other.md");

            mockHub.services.database.localDatabase.tryAutoMerge = vi.fn().mockResolvedValue({
                rightRev: "2-def",
                leftLeaf: { rev: "1-abc", mtime: 100, data: "hello", deleted: false },
                rightLeaf: { rev: "2-def", mtime: 200, data: "world", deleted: false },
            });
            mockHub.services.conflict.resolveByUserInteraction = vi.fn().mockResolvedValue(true);

            await resolveConflictHandler(mockHub as any, "test.md" as any);
            expect(mockHub.services.conflict.resolveByUserInteraction).not.toHaveBeenCalled();
        });
    });

    describe("resolveConflictByNewestHandler", () => {
        it("should return false if current rev cannot be fetched", async () => {
            (mockHub as any).serviceModules = {
                databaseFileAccess: {
                    fetchEntryMeta: vi.fn().mockResolvedValue(false),
                },
            };

            const res = await resolveConflictByNewestHandler(mockHub as any, "test.md" as any);
            expect(res).toBe(false);
        });

        it("should return true if there are no conflicted revs", async () => {
            (mockHub as any).serviceModules = {
                databaseFileAccess: {
                    fetchEntryMeta: vi.fn().mockResolvedValue({ mtime: 100, _rev: "1-abc" }),
                    getConflictedRevs: vi.fn().mockResolvedValue([]),
                },
            };

            const res = await resolveConflictByNewestHandler(mockHub as any, "test.md" as any);
            expect(res).toBe(true);
        });

        it("should sort conflicted revs and resolve older ones by deleting them", async () => {
            (mockHub as any).serviceModules = {
                databaseFileAccess: {
                    fetchEntryMeta: vi.fn().mockImplementation(async (file, rev) => {
                        if (!rev) return { mtime: 200, _rev: "2-def" };
                        if (rev === "1-abc") return { mtime: 100, _rev: "1-abc" };
                        return false;
                    }),
                    getConflictedRevs: vi.fn().mockResolvedValue(["1-abc", "3-ghi"]),
                },
            };
            mockHub.services.conflict.resolveByDeletingRevision = vi.fn().mockResolvedValue(AUTO_MERGED);

            const res = await resolveConflictByNewestHandler(mockHub as any, "test.md" as any);
            expect(res).toBe(true);
            expect(mockHub.services.conflict.resolveByDeletingRevision).toHaveBeenCalledWith(
                "test.md",
                "1-abc",
                "NEWEST"
            );
            expect(mockHub.services.conflict.resolveByDeletingRevision).toHaveBeenCalledWith(
                "test.md",
                "3-ghi",
                "NEWEST"
            );
        });
    });

    it("resolveAllConflictedFilesByNewerOnesHandler should iterate over conflicted files", async () => {
        (mockHub as any).serviceModules = {
            storageAccess: {
                getFileNames: vi.fn().mockResolvedValue(["file1.md", "file2.md"]),
            },
        };
        mockHub.services.conflict.resolveByNewest = vi.fn();

        await resolveAllConflictedFilesByNewerOnesHandler(mockHub as any);

        expect(mockHub.services.conflict.resolveByNewest).toHaveBeenCalledWith("file1.md");
        expect(mockHub.services.conflict.resolveByNewest).toHaveBeenCalledWith("file2.md");
    });
});
