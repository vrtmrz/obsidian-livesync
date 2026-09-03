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
import { cancelTask } from "@/common/utils.ts";
import { CustomisationSyncContext } from "./customisationSyncContext";
import { createCustomisationSyncTestDependencies } from "./customisationSyncContext.unit.fixture.ts";

describe("CustomisationSyncContext commands", () => {
    it("keeps the legacy dialogue methods as delegates to the host-owned UI", () => {
        const control = {
            open: vi.fn(),
            close: vi.fn(),
            isOpen: vi.fn(),
        };
        const configSync = Object.create(CustomisationSyncContext.prototype) as CustomisationSyncContext;
        Object.assign(configSync, {
            dependencies: createCustomisationSyncTestDependencies({
                getUIControl: () => control,
            }),
        });

        configSync.showPluginSyncModal();
        configSync.hidePluginSyncModal();

        expect(control.open).toHaveBeenCalledOnce();
        expect(control.close).toHaveBeenCalledOnce();
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
});
