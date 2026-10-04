import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    addIcon: vi.fn(),
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    parseYaml: vi.fn(),
    Platform: {},
}));
vi.mock("./PluginDialogModal.ts", () => ({
    PluginDialogModal: class PluginDialogModal {},
}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {},
}));
vi.mock("@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", () => ({
    ConflictResolveModal: class ConflictResolveModal {},
}));
// The readiness and suspension helpers come from the real LiveSyncCommands, so only its log view dependency is replaced.
vi.mock("@/modules/features/ModuleLog.ts", () => ({
    MARK_DONE: "",
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
vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG: "open-plugin-sync",
    eventHub: {
        onEvent: vi.fn(),
    },
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));

import { createServiceContext, type ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { ControlService } from "@vrtmrz/livesync-commonlib/compat/services/base/ControlService";
import { InjectableAppLifecycleService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableAppLifecycleService";
import { InjectableSettingService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableSettingService";
import { ConfigSync } from "./CmdConfigSync";

type HarnessOptions = {
    ready?: boolean;
    suspended?: boolean;
};

const PERIODIC_SWEEP_INTERVAL = 60 * 1000;

class TestAppLifecycleService extends InjectableAppLifecycleService {}
class TestSettingService extends InjectableSettingService<ServiceContext> {}

/**
 * Binds ConfigSync to Commonlib's real ControlService, so settings are applied in the order the plug-in uses.
 */
function setup(options: HarnessOptions = {}) {
    const context = createServiceContext();
    const settings = {
        isConfigured: true,
        usePluginSync: true,
        autoSweepPlugins: true,
        autoSweepPluginsPeriodic: true,
        watchInternalFileChanges: false,
        pluginSyncExtendedSetting: {},
    };
    const API = {
        addLog: vi.fn(),
        getSystemConfigDir: () => ".obsidian",
    };
    const appLifecycle = new TestAppLifecycleService(context, {
        settingService: { currentSettings: () => settings },
    } as never);
    const setting = new TestSettingService(context, { APIService: API } as never);
    const control = new ControlService(context, {
        APIService: API,
        appLifecycleService: appLifecycle,
        databaseService: { localDatabase: { refreshSettings: vi.fn() } },
        fileProcessingService: { commitPendingFileEvents: vi.fn(async () => true) },
        settingService: setting,
    } as never);
    const handler = () => ({ addHandler: vi.fn() });
    const services = {
        API,
        appLifecycle,
        conflict: { getOptionalConflictCheckMethod: handler() },
        control,
        databaseEvents: { onDatabaseInitialised: handler() },
        fileProcessing: { processOptionalFileEvent: handler() },
        replication: { onBeforeReplicate: handler(), processVirtualDocument: handler() },
        setting,
    };
    const periodicPluginSweepProcessor = { disable: vi.fn(), enable: vi.fn() };
    const scanAllConfigFiles = vi.fn(async () => undefined);
    const configSync = Object.create(ConfigSync.prototype) as ConfigSync;
    Object.assign(configSync, {
        core: { settings, services },
        periodicPluginSweepProcessor,
        scanAllConfigFiles,
    });
    configSync.onBindFunction(configSync.core, services as never);

    if (options.ready ?? true) appLifecycle.markIsReady();
    appLifecycle.setSuspended(options.suspended ?? false);

    // The periodic sweep is running when the last call left it enabled with a non-zero interval.
    const isPeriodicSweepRunning = () => {
        const calls = [
            ...periodicPluginSweepProcessor.disable.mock.invocationCallOrder.map((order) => ({ order, interval: 0 })),
            ...periodicPluginSweepProcessor.enable.mock.calls.map(([interval], index) => ({
                order: periodicPluginSweepProcessor.enable.mock.invocationCallOrder[index],
                interval: interval as number,
            })),
        ].sort((a, b) => a.order - b.order);
        return (calls[calls.length - 1]?.interval ?? 0) > 0;
    };

    return { appLifecycle, control, isPeriodicSweepRunning, periodicPluginSweepProcessor, scanAllConfigFiles };
}

describe("ConfigSync when settings are applied", () => {
    beforeEach(() => {
        vi.stubGlobal("activeDocument", { querySelector: vi.fn(() => null) });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([true, false])(
        "does not sweep configuration files while the plug-in is suspended (ready: %s)",
        async (ready) => {
            const { control, isPeriodicSweepRunning, periodicPluginSweepProcessor, scanAllConfigFiles } = setup({
                ready,
                suspended: true,
            });

            await control.applySettings();

            expect(periodicPluginSweepProcessor.disable).toHaveBeenCalled();
            expect(scanAllConfigFiles).not.toHaveBeenCalled();
            expect(periodicPluginSweepProcessor.enable).not.toHaveBeenCalled();
            expect(isPeriodicSweepRunning()).toBe(false);
        }
    );

    it("sweeps configuration files once and starts the periodic sweep while the plug-in is running", async () => {
        const { control, isPeriodicSweepRunning, periodicPluginSweepProcessor, scanAllConfigFiles } = setup();

        await control.applySettings();

        expect(scanAllConfigFiles).toHaveBeenCalledOnce();
        expect(periodicPluginSweepProcessor.enable).toHaveBeenCalledOnce();
        expect(periodicPluginSweepProcessor.enable).toHaveBeenCalledWith(PERIODIC_SWEEP_INTERVAL);
        expect(isPeriodicSweepRunning()).toBe(true);
    });

    it("stops the periodic sweep when all synchronisation is suspended and restarts it once on resumption", async () => {
        const { appLifecycle, control, isPeriodicSweepRunning, periodicPluginSweepProcessor, scanAllConfigFiles } =
            setup();
        await control.applySettings();
        scanAllConfigFiles.mockClear();
        periodicPluginSweepProcessor.enable.mockClear();

        appLifecycle.setSuspended(true);
        await control.applySettings();

        expect(scanAllConfigFiles).not.toHaveBeenCalled();
        expect(periodicPluginSweepProcessor.enable).not.toHaveBeenCalled();
        expect(isPeriodicSweepRunning()).toBe(false);

        appLifecycle.setSuspended(false);
        await control.applySettings();

        expect(scanAllConfigFiles).toHaveBeenCalledOnce();
        expect(periodicPluginSweepProcessor.enable).toHaveBeenCalledOnce();
        expect(isPeriodicSweepRunning()).toBe(true);
    });
});
