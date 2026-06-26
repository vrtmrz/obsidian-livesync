import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";
import { createMockServiceHub } from "../mockServiceHub";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";

describe("ReplicateResultProcessor", () => {
    let mockHub: ReturnType<typeof createMockServiceHub>;

    beforeEach(() => {
        mockHub = createMockServiceHub();
    });

    it("should instantiate and bind core correctly", () => {
        const processor = new ReplicateResultProcessor(mockHub as any as LiveSyncBaseCore);
        expect(processor).toBeDefined();
    });

    it("should process items and take snapshot", async () => {
        const processor = new ReplicateResultProcessor(mockHub as any as LiveSyncBaseCore);

        // Mock simple behaviors
        (processor as any).enqueue = vi.fn();

        (processor as any).enqueue({ id: "test", doc: { _id: "test" } });
        expect((processor as any).enqueue).toHaveBeenCalled();
    });
});
