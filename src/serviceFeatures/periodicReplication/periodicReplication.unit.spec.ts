import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePeriodicReplication, disablePeriodicHandler, resumePeriodicHandler } from "./periodicReplication";
import { createMockServiceHub } from "../mockServiceHub";

describe("periodicReplication", () => {
    let mockHub: ReturnType<typeof createMockServiceHub>;

    beforeEach(() => {
        mockHub = createMockServiceHub();
    });

    it("should register periodic replication handlers", () => {
        usePeriodicReplication(mockHub as any);
        expect((mockHub.services.appLifecycle.onUnload as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.setting.onBeforeRealiseSetting as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.setting.onSettingRealised as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.appLifecycle.onSuspending as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.appLifecycle.onResumed as any).handlers.length).toBeGreaterThan(0);
    });

    it("disablePeriodicHandler should disable the processor", async () => {
        const mockProcessor = { disable: vi.fn(), enable: vi.fn() };
        const res = await disablePeriodicHandler(mockProcessor as any);
        expect(res).toBe(true);
        expect(mockProcessor.disable).toHaveBeenCalled();
    });

    it("resumePeriodicHandler should enable the processor with interval if periodicReplication is true", async () => {
        const mockProcessor = { disable: vi.fn(), enable: vi.fn() };
        mockHub.services.setting.settings.periodicReplication = true;
        mockHub.services.setting.settings.periodicReplicationInterval = 5;
        const res = await resumePeriodicHandler(mockHub as any, mockProcessor as any);
        expect(res).toBe(true);
        expect(mockProcessor.enable).toHaveBeenCalledWith(5000);
    });

    it("resumePeriodicHandler should enable with 0 if periodicReplication is false", async () => {
        const mockProcessor = { disable: vi.fn(), enable: vi.fn() };
        mockHub.services.setting.settings.periodicReplication = false;
        const res = await resumePeriodicHandler(mockHub as any, mockProcessor as any);
        expect(res).toBe(true);
        expect(mockProcessor.enable).toHaveBeenCalledWith(0);
    });
});
