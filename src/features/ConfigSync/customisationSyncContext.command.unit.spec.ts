import { describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    parseYaml: vi.fn(),
    Platform: {},
}));
vi.mock("@/common/types.ts", () => ({
    ICXHeader: "ix:",
    PERIODIC_PLUGIN_SWEEP: 60,
}));
vi.mock("@/common/utils.ts", () => ({
    cancelTask: vi.fn(),
    EVEN: Symbol("even"),
    isCustomisationSyncMetadata: vi.fn(),
    isPluginMetadata: vi.fn(),
    scheduleTask: vi.fn(),
}));
vi.mock("@/common/PeriodicProcessor.ts", () => ({
    PeriodicProcessor: class PeriodicProcessor {},
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));
import { cancelTask, scheduleTask } from "@/common/utils.ts";
import { CustomisationSyncContext } from "./customisationSyncContext";
import { createCustomisationSyncTestDependencies } from "./customisationSyncContext.unit.fixture.ts";

describe("CustomisationSyncContext commands", () => {
    it("opens the host-owned dialogue from a scheduled configuration Notice", async () => {
        const control = {
            open: vi.fn(),
            close: vi.fn(),
            isOpen: vi.fn(() => false),
        };
        const showConfigurationNotice = vi.fn();
        const updatePluginList = vi.fn(async () => undefined);
        const configSync = Object.create(CustomisationSyncContext.prototype) as CustomisationSyncContext;
        Object.assign(configSync, {
            dependencies: createCustomisationSyncTestDependencies({
                getUIControl: () => control,
                getSettings: () => ({ usePluginSync: true, notifyPluginOrSettingUpdated: true }) as never,
                showConfigurationNotice,
            }),
            updatePluginList,
        });

        await configSync.serviceHandlers.processVirtualDocument({
            _id: "ix:example",
            path: "ix:example",
        } as never);
        const scheduledNotice = vi.mocked(scheduleTask).mock.calls[0]?.[2] as (() => void) | undefined;
        expect(scheduledNotice).toBeTypeOf("function");
        scheduledNotice?.();
        const openDialogue = showConfigurationNotice.mock.calls[0]?.[0] as (() => void) | undefined;
        expect(openDialogue).toBeTypeOf("function");
        openDialogue?.();

        expect(control.open).toHaveBeenCalledOnce();
        expect(updatePluginList).toHaveBeenCalledWith(false, "ix:example");
    });

    it("releases every owned processor and reactive subscription", () => {
        const hideConfigurationNotice = vi.fn();
        const publishScanCount = vi.fn();
        const periodicPluginSweepProcessor = { disable: vi.fn() };
        const pluginScanProcessor = { terminate: vi.fn() };
        const pluginScanProcessorV2 = { terminate: vi.fn() };
        const pluginScanningChanged = vi.fn();
        const offChanged = vi.fn();
        const setEnumerationActive = vi.fn();
        const configSync = Object.create(CustomisationSyncContext.prototype) as CustomisationSyncContext;
        Object.assign(configSync, {
            dependencies: createCustomisationSyncTestDependencies({
                hideConfigurationNotice,
                publishScanCount,
            }),
            periodicPluginSweepProcessor,
            pluginScanProcessor,
            pluginScanProcessorV2,
            pluginScanningChanged,
            scanProgress: { offChanged },
            enumerationActive: { set: setEnumerationActive },
        });

        configSync.dispose();

        expect(cancelTask).toHaveBeenCalledWith("config-sync:updated-configuration");
        expect(hideConfigurationNotice).toHaveBeenCalledOnce();
        expect(periodicPluginSweepProcessor.disable).toHaveBeenCalledOnce();
        expect(pluginScanProcessor.terminate).toHaveBeenCalledOnce();
        expect(pluginScanProcessorV2.terminate).toHaveBeenCalledOnce();
        expect(offChanged).toHaveBeenCalledWith(pluginScanningChanged);
        expect(setEnumerationActive).toHaveBeenCalledWith(false);
        expect(publishScanCount).toHaveBeenCalledWith(0);
    });

    it("characterises the inherited setting-realisation gates pending separate review", async () => {
        const isReady = vi.fn(() => false);
        const isSuspended = vi.fn(() => false);
        const periodicPluginSweepProcessor = { disable: vi.fn(), enable: vi.fn() };
        const scanAllConfigFiles = vi.fn(async () => undefined);
        const configSync = Object.create(CustomisationSyncContext.prototype) as CustomisationSyncContext;
        Object.assign(configSync, {
            dependencies: createCustomisationSyncTestDependencies({ isReady, isSuspended }),
            periodicPluginSweepProcessor,
            scanAllConfigFiles,
        });

        await expect(configSync.serviceHandlers.onRealiseSetting()).resolves.toBe(true);

        expect(periodicPluginSweepProcessor.disable).toHaveBeenCalledOnce();
        expect(isReady).not.toHaveBeenCalled();
        expect(isSuspended).toHaveBeenCalledOnce();
        expect(scanAllConfigFiles).not.toHaveBeenCalled();
        expect(periodicPluginSweepProcessor.enable).not.toHaveBeenCalled();
    });
});
