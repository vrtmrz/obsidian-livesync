import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Obsidian dependency barrel to avoid runtime errors on Node
vi.mock("@/deps.ts", () => ({
    Platform: { isMobile: false, isDesktop: true, isDesktopApp: true },
    Notice: vi.fn(),
    App: class MockApp {},
    ItemView: class MockItemView {},
    Modal: class MockModal {
        app: any;
        constructor(app: any) {
            this.app = app;
        }
        open() {}
        close() {}
    },
}));

// Mock the ConflictResolveModal class
const mockOpen = vi.fn();
const mockWaitForResult = vi.fn();

vi.mock("@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", () => {
    return {
        ConflictResolveModal: class {
            open = mockOpen;
            waitForResult = mockWaitForResult;
        },
    };
});

import { CANCELLED, LEAVE_TO_SUBSEQUENT, MISSING_OR_ERROR, DEFAULT_SETTINGS } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { ConflictResolverHost } from "./types.ts";
import { resolveConflictByUI, pickFileForResolve, allConflictCheck, allScanStat } from "./conflictOperations.ts";

describe("InteractiveConflictResolver Operations", () => {
    let host: ConflictResolverHost;
    let log: LogFunction;

    const mockGetDBEntry = vi.fn();
    const mockFindAllDocs = vi.fn();
    const mockStoreContent = vi.fn();
    const mockResolveByDeletingRevision = vi.fn();
    const mockReplicateByEvent = vi.fn();
    const mockQueueCheckFor = vi.fn();
    const mockEnsureAllProcessed = vi.fn();
    const mockAskSelectString = vi.fn();
    const mockAskInPopup = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        host = {
            app: {} as any,
            services: {
                API: {
                    confirm: {
                        askInPopup: mockAskInPopup,
                    },
                },
                setting: {
                    settings: {
                        ...DEFAULT_SETTINGS,
                        syncAfterMerge: true,
                    },
                },
                database: {
                    localDatabase: {
                        getDBEntry: mockGetDBEntry,
                        findAllDocs: mockFindAllDocs,
                    },
                },
                conflict: {
                    resolveByDeletingRevision: mockResolveByDeletingRevision,
                    queueCheckFor: mockQueueCheckFor,
                    ensureAllProcessed: mockEnsureAllProcessed,
                },
                appLifecycle: {
                    isSuspended: vi.fn(() => false),
                },
                replication: {
                    replicateByEvent: mockReplicateByEvent,
                },
                path: {
                    getPath: vi.fn((doc) => doc._id),
                },
                UI: {
                    confirm: {
                        askSelectString: mockAskSelectString,
                        askInPopup: mockAskInPopup,
                    },
                },
            },
            serviceModules: {
                databaseFileAccess: {
                    storeContent: mockStoreContent,
                },
            },
        } as unknown as ConflictResolverHost;

        log = vi.fn() as unknown as LogFunction;
    });

    describe("resolveConflictByUI", () => {
        it("returns false and logs when merge dialogue is cancelled by the user", async () => {
            mockWaitForResult.mockResolvedValueOnce(CANCELLED);

            const res = await resolveConflictByUI(
                host,
                log,
                "test-file.md" as any,
                {
                    left: { rev: "rev1" },
                    right: { rev: "rev2" },
                    diff: [],
                } as any
            );

            expect(res).toBe(false);
            expect(mockOpen).toHaveBeenCalled();
            expect(log).toHaveBeenCalledWith(expect.stringContaining("Cancelled"), expect.any(Number));
        });

        it("returns false if local database has no entry for the file", async () => {
            mockWaitForResult.mockResolvedValueOnce("rev2");
            mockGetDBEntry.mockResolvedValueOnce(false); // file not found in DB

            const res = await resolveConflictByUI(
                host,
                log,
                "test-file.md" as any,
                {
                    left: { rev: "rev1" },
                    right: { rev: "rev2" },
                    diff: [],
                } as any
            );

            expect(res).toBe(false);
            expect(log).toHaveBeenCalledWith(expect.stringContaining("Could not read"), expect.any(Number));
        });

        it("resolves conflict by deleting selected revision and triggers replication", async () => {
            mockWaitForResult.mockResolvedValueOnce("rev2"); // user selects "rev2" to delete
            mockGetDBEntry.mockResolvedValueOnce({
                _id: "test-file.md",
                _conflicts: ["rev2"],
            });
            mockResolveByDeletingRevision.mockResolvedValueOnce("deleted-successfully");

            const res = await resolveConflictByUI(
                host,
                log,
                "test-file.md" as any,
                {
                    left: { rev: "rev1" },
                    right: { rev: "rev2" },
                    diff: [],
                } as any
            );

            expect(res).toBe(false);
            expect(mockResolveByDeletingRevision).toHaveBeenCalledWith("test-file.md", "rev2", "UI Selected");
            expect(mockReplicateByEvent).toHaveBeenCalled();
            expect(mockQueueCheckFor).toHaveBeenCalledWith("test-file.md");
        });

        it("handles concatenated resolving (LEAVE_TO_SUBSEQUENT) correctly", async () => {
            mockWaitForResult.mockResolvedValueOnce(LEAVE_TO_SUBSEQUENT);
            mockGetDBEntry.mockResolvedValueOnce({
                _id: "test-file.md",
                _conflicts: ["rev2"],
            });
            mockStoreContent.mockResolvedValueOnce(true);
            mockResolveByDeletingRevision.mockResolvedValueOnce("deleted-successfully");

            const res = await resolveConflictByUI(
                host,
                log,
                "test-file.md" as any,
                {
                    left: { rev: "rev1" },
                    right: { rev: "rev2" },
                    diff: [[0, "hello world"]],
                } as any
            );

            expect(res).toBe(false);
            expect(mockStoreContent).toHaveBeenCalledWith("test-file.md", "hello world");
            expect(mockResolveByDeletingRevision).toHaveBeenCalledWith("test-file.md", "rev2", "UI Concatenated");
            expect(mockReplicateByEvent).toHaveBeenCalled();
        });

        it("fails concatenation when storage content storage fails", async () => {
            mockWaitForResult.mockResolvedValueOnce(LEAVE_TO_SUBSEQUENT);
            mockGetDBEntry.mockResolvedValueOnce({
                _id: "test-file.md",
                _conflicts: ["rev2"],
            });
            mockStoreContent.mockResolvedValueOnce(false); // storage fails

            const res = await resolveConflictByUI(
                host,
                log,
                "test-file.md" as any,
                {
                    left: { rev: "rev1" },
                    right: { rev: "rev2" },
                    diff: [[0, "hello world"]],
                } as any
            );

            expect(res).toBe(false);
            expect(mockResolveByDeletingRevision).not.toHaveBeenCalled();
            expect(log).toHaveBeenCalledWith(
                expect.stringContaining("Concatenated content cannot be stored"),
                expect.any(Number)
            );
        });

        it("logs notice when delete revision fails", async () => {
            mockWaitForResult.mockResolvedValueOnce("rev2");
            mockGetDBEntry.mockResolvedValueOnce({
                _id: "test-file.md",
                _conflicts: ["rev2"],
            });
            mockResolveByDeletingRevision.mockResolvedValueOnce(MISSING_OR_ERROR);

            const res = await resolveConflictByUI(
                host,
                log,
                "test-file.md" as any,
                {
                    left: { rev: "rev1" },
                    right: { rev: "rev2" },
                    diff: [],
                } as any
            );

            expect(res).toBe(false);
            expect(log).toHaveBeenCalledWith(expect.stringContaining("Something went wrong"), expect.any(Number));
        });
    });

    describe("pickFileForResolve", () => {
        it("returns false if no conflicts are found", async () => {
            // Mock generator/iterator for findAllDocs
            mockFindAllDocs.mockImplementation(async function* () {
                // Yield nothing
            });

            const res = await pickFileForResolve(host, log);

            expect(res).toBe(false);
            expect(log).toHaveBeenCalledWith(expect.stringContaining("no conflicted documents"), expect.any(Number));
        });

        it("picks a conflict and queues check when selected by user", async () => {
            mockFindAllDocs.mockImplementation(async function* () {
                yield { _id: "file1.md", _conflicts: ["revB"], mtime: 100 };
            });
            mockAskSelectString.mockResolvedValueOnce("file1.md");

            const res = await pickFileForResolve(host, log);

            expect(res).toBe(true);
            expect(mockQueueCheckFor).toHaveBeenCalledWith("file1.md");
            expect(mockEnsureAllProcessed).toHaveBeenCalled();
        });

        it("returns false if user cancels the selection", async () => {
            mockFindAllDocs.mockImplementation(async function* () {
                yield { _id: "file1.md", _conflicts: ["revB"], mtime: 100 };
            });
            mockAskSelectString.mockResolvedValueOnce(null); // cancelled

            const res = await pickFileForResolve(host, log);

            expect(res).toBe(false);
            expect(mockQueueCheckFor).not.toHaveBeenCalled();
        });
    });

    describe("allScanStat", () => {
        it("logs no conflicting files if none are found", async () => {
            mockFindAllDocs.mockImplementation(async function* () {});

            const res = await allScanStat(host, log);

            expect(res).toBe(true);
            expect(log).toHaveBeenCalledWith(
                expect.stringContaining("There are no conflicting files"),
                expect.any(Number)
            );
        });

        it("prompts the user in popup if conflicted files are present", async () => {
            mockFindAllDocs.mockImplementation(async function* () {
                yield { _id: "conflict1.md", _conflicts: ["revA"], mtime: 100 };
            });

            const res = await allScanStat(host, log);

            expect(res).toBe(true);
            expect(mockAskInPopup).toHaveBeenCalled();
            expect(log).toHaveBeenCalledWith(
                expect.stringContaining("Some files have been left conflicted"),
                expect.any(Number)
            );
        });
    });

    describe("allConflictCheck", () => {
        it("loops while pickFileForResolve returns true", async () => {
            // First time yields a file, second time yields a file
            mockFindAllDocs.mockImplementationOnce(async function* () {
                yield { _id: "file1.md", _conflicts: ["revB"], mtime: 100 };
            });
            mockFindAllDocs.mockImplementationOnce(async function* () {
                yield { _id: "file2.md", _conflicts: ["revC"], mtime: 200 };
            });
            // First select, second cancel
            mockAskSelectString.mockResolvedValueOnce("file1.md");
            mockAskSelectString.mockResolvedValueOnce(null);

            await allConflictCheck(host, log);

            expect(mockAskSelectString).toHaveBeenCalledTimes(2);
        });
    });
});
