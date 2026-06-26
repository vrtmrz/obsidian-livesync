import { describe, it, expect, vi, beforeEach } from "vitest";
import { useConflictChecker, queueConflictCheckIfOpenHandler, queueConflictCheckHandler } from "./conflictChecker";
import { createMockServiceHub } from "../mockServiceHub";
import { sendValue } from "octagonal-wheels/messagepassing/signal";

vi.mock("octagonal-wheels/messagepassing/signal", () => ({
    sendValue: vi.fn(),
}));

describe("conflictChecker", () => {
    let mockHub: ReturnType<typeof createMockServiceHub>;

    beforeEach(() => {
        mockHub = createMockServiceHub();
        mockHub.services.conflict.conflictProcessQueueCount = { value: 1 } as any;
        vi.clearAllMocks();
    });

    it("should register conflict checker handlers", () => {
        const { conflictCheckQueue, conflictResolveQueue } = useConflictChecker(mockHub as any);
        expect((mockHub.services.conflict.queueCheckForIfOpen as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.conflict.queueCheckFor as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.conflict.ensureAllProcessed as any).handlers.length).toBeGreaterThan(0);
        expect(conflictCheckQueue).toBeDefined();
        expect(conflictResolveQueue).toBeDefined();
    });

    it("queueConflictCheckIfOpenHandler should skip if checkConflictOnlyOnOpen is true and file is not active", async () => {
        mockHub.services.setting.settings.checkConflictOnlyOnOpen = true;
        mockHub.services.vault.getActiveFilePath = vi.fn().mockReturnValue("other.md");
        await queueConflictCheckIfOpenHandler(mockHub as any, "test.md" as any);
        expect(mockHub.services.conflict.queueCheckFor).not.toHaveBeenCalled();
        expect(mockHub.services.API.addLog).toHaveBeenCalledWith(
            expect.stringContaining("test.md"),
            expect.any(Number),
            ""
        );
    });

    it("queueConflictCheckIfOpenHandler should queue if checkConflictOnlyOnOpen is false", async () => {
        mockHub.services.setting.settings.checkConflictOnlyOnOpen = false;
        await queueConflictCheckIfOpenHandler(mockHub as any, "test.md" as any);
        expect(mockHub.services.conflict.queueCheckFor).toHaveBeenCalledWith("test.md");
    });

    it("queueConflictCheckHandler should resolve by newest if optionalConflictResult is newer", async () => {
        mockHub.services.conflict.getOptionalConflictCheckMethod = vi.fn().mockResolvedValue("newer");
        const mockQueue = { enqueue: vi.fn() };
        await queueConflictCheckHandler(mockHub as any, mockQueue as any, "test.md" as any);
        expect(mockHub.services.conflict.resolveByNewest).toHaveBeenCalledWith("test.md");
        expect(mockQueue.enqueue).not.toHaveBeenCalled();
    });

    it("queueConflictCheckHandler should return if optionalConflictResult is true", async () => {
        mockHub.services.conflict.getOptionalConflictCheckMethod = vi.fn().mockResolvedValue(true);
        const mockQueue = { enqueue: vi.fn() };
        await queueConflictCheckHandler(mockHub as any, mockQueue as any, "test.md" as any);
        expect(mockHub.services.conflict.resolveByNewest).not.toHaveBeenCalled();
        expect(mockQueue.enqueue).not.toHaveBeenCalled();
    });

    it("queueConflictCheckHandler should enqueue if optionalConflictResult is undefined", async () => {
        mockHub.services.conflict.getOptionalConflictCheckMethod = vi.fn().mockResolvedValue(undefined);
        const mockQueue = { enqueue: vi.fn() };
        await queueConflictCheckHandler(mockHub as any, mockQueue as any, "test.md" as any);
        expect(mockHub.services.conflict.resolveByNewest).not.toHaveBeenCalled();
        expect(mockQueue.enqueue).toHaveBeenCalledWith("test.md");
    });

    it("should process files in conflictCheckQueue and conflictResolveQueue", async () => {
        mockHub.services.conflict.resolve = vi.fn().mockResolvedValue(true);
        const { conflictCheckQueue, conflictResolveQueue } = useConflictChecker(mockHub as any);

        conflictCheckQueue.enqueue("file1.md" as any);

        await conflictResolveQueue.waitForAllProcessed();

        expect(mockHub.services.conflict.resolve).toHaveBeenCalledWith("file1.md");
    });

    it("should use replaceEnqueueProcessor to filter duplicates and cancel previous resolves", async () => {
        const { conflictResolveQueue } = useConflictChecker(mockHub as any);

        conflictResolveQueue.suspend();
        conflictResolveQueue.enqueue("dup.md" as any);
        conflictResolveQueue.enqueue("dup.md" as any);

        expect(sendValue).toHaveBeenCalledWith("cancel-resolve-conflict:dup.md", true);
    });
});
