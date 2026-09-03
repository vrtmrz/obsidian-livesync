import { describe, expect, it, vi } from "vitest";
import {
    allSettledFunction,
    anySuccessFunction,
    bailFirstFailureFunction,
    firstResultFunction,
} from "@vrtmrz/livesync-commonlib/compat/services/lib/HandlerUtils";
import { MODE_AUTOMATIC, MODE_PAUSED } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/features/ConfigSync/customisationSyncContext.ts", () => ({
    CustomisationSyncContext: class CustomisationSyncContext {},
}));
vi.mock("@/features/HiddenFileSync/hiddenFileSyncContext.ts", () => ({
    HiddenFileSyncContext: class HiddenFileSyncContext {},
}));
vi.mock("./customisationSyncObsidianAdapter.ts", () => ({
    createCustomisationSyncObsidianDependencies: vi.fn(),
}));
vi.mock("./hiddenFileSyncObsidianAdapter.ts", () => ({
    createHiddenFileSyncObsidianDependencies: vi.fn(),
}));

import { useOptionalFileSync } from "./useOptionalFileSync.ts";

type Handler = (...args: any[]) => any;

function handlerRegistry() {
    const handlers: Handler[] = [];
    return {
        addHandler: vi.fn((handler: Handler) => {
            handlers.push(handler);
            return () => {
                const index = handlers.indexOf(handler);
                if (index >= 0) handlers.splice(index, 1);
            };
        }),
        handlers,
    };
}

function createFixture() {
    const processOptionalFileEvent = handlerRegistry();
    const getOptionalConflictCheckMethod = handlerRegistry();
    const processVirtualDocument = handlerRegistry();
    const processOptionalSynchroniseResult = handlerRegistry();
    const onRealiseSetting = handlerRegistry();
    const onSettingLoaded = handlerRegistry();
    const onResuming = handlerRegistry();
    const onBeforeReplicate = handlerRegistry();
    const onDatabaseInitialised = handlerRegistry();
    const suspendExtraSync = handlerRegistry();
    const enableOptionalFeature = handlerRegistry();
    const isTargetFileInExtra = handlerRegistry();
    const onUnload = handlerRegistry();

    const calls: string[] = [];
    const customisationSync = {
        dispose: vi.fn(() => calls.push("customisation:unload")),
        _anyProcessOptionalFileEvent: vi.fn(async () => false),
        _anyGetOptionalConflictCheckMethod: vi.fn(async () => false),
        _anyModuleParsedReplicationResultItem: vi.fn(async () => false),
        _everyRealizeSettingSyncMode: vi.fn(async () => true),
        _everyOnResumeProcess: vi.fn(async () => true),
        _everyBeforeReplicate: vi.fn(async () => true),
        _everyOnDatabaseInitialized: vi.fn(async () => true),
        _allSuspendExtraSync: vi.fn(async () => true),
        _allConfigureOptionalSyncFeature: vi.fn(async () => true),
    };
    const hiddenFileSync = {
        dispose: vi.fn(() => calls.push("hidden:unload")),
        _everyOnloadAfterLoadSettings: vi.fn(async () => true),
        _anyProcessOptionalFileEvent: vi.fn(async () => false),
        _anyGetOptionalConflictCheckMethod: vi.fn(async () => false),
        _anyProcessOptionalSyncFiles: vi.fn(async () => false),
        _everyRealizeSettingSyncMode: vi.fn(async () => true),
        _everyOnResumeProcess: vi.fn(async () => true),
        _everyBeforeReplicate: vi.fn(async () => true),
        _everyOnDatabaseInitialized: vi.fn(async () => true),
        _allSuspendExtraSync: vi.fn(async () => true),
        _allConfigureOptionalSyncFeature: vi.fn(async () => true),
        isTargetFileEligible: vi.fn(async () => true),
    };
    const settings = {
        usePluginSync: true,
        usePluginSyncV2: true,
        usePluginEtc: true,
        syncInternalFiles: true,
        pluginSyncExtendedSetting: {},
    };
    const services = {
        fileProcessing: { processOptionalFileEvent },
        conflict: { getOptionalConflictCheckMethod },
        replication: { processVirtualDocument, processOptionalSynchroniseResult, onBeforeReplicate },
        setting: { onRealiseSetting, suspendExtraSync, enableOptionalFeature },
        appLifecycle: {
            onSettingLoaded,
            onResuming,
            onUnload,
            isReady: vi.fn(() => true),
            isSuspended: vi.fn(() => false),
        },
        databaseEvents: { onDatabaseInitialised },
        vault: { isTargetFileInExtra },
        API: { getSystemConfigDir: vi.fn(() => ".obsidian") },
    };
    const host = { services, settings };

    let customisationDependencies: unknown;
    let hiddenFileDependencies: unknown;

    const feature = useOptionalFileSync(host as never, {
        createCustomisationSync: (contextDependencies) => {
            customisationDependencies = contextDependencies;
            return customisationSync as never;
        },
        createHiddenFileSync: (contextDependencies) => {
            hiddenFileDependencies = contextDependencies;
            return hiddenFileSync as never;
        },
    });

    return {
        calls,
        customisationSync,
        feature,
        hiddenFileSync,
        settings,
        contextDependencies: {
            customisation: () => customisationDependencies,
            hiddenFile: () => hiddenFileDependencies,
        },
        registries: {
            enableOptionalFeature,
            getOptionalConflictCheckMethod,
            isTargetFileInExtra,
            onBeforeReplicate,
            onDatabaseInitialised,
            onRealiseSetting,
            onResuming,
            onSettingLoaded,
            onUnload,
            processOptionalFileEvent,
            processOptionalSynchroniseResult,
            processVirtualDocument,
            suspendExtraSync,
        },
    };
}

function createAggregateFixture() {
    const customisationSync = {
        dispose: vi.fn(),
        _anyProcessOptionalFileEvent: vi.fn(async () => false),
        _anyGetOptionalConflictCheckMethod: vi.fn(async (): Promise<boolean | "newer"> => false),
        _anyModuleParsedReplicationResultItem: vi.fn(async () => false),
        _everyRealizeSettingSyncMode: vi.fn(async () => true),
        _everyOnResumeProcess: vi.fn(async () => true),
        _everyBeforeReplicate: vi.fn(async () => true),
        _everyOnDatabaseInitialized: vi.fn(async () => true),
        _allSuspendExtraSync: vi.fn(async () => true),
        _allConfigureOptionalSyncFeature: vi.fn(async () => true),
    };
    const hiddenFileSync = {
        dispose: vi.fn(),
        _everyOnloadAfterLoadSettings: vi.fn(async () => true),
        _anyProcessOptionalFileEvent: vi.fn(async () => false),
        _anyGetOptionalConflictCheckMethod: vi.fn(async (): Promise<boolean | "newer"> => false),
        _anyProcessOptionalSyncFiles: vi.fn(async () => false),
        _everyRealizeSettingSyncMode: vi.fn(async () => true),
        _everyOnResumeProcess: vi.fn(async () => true),
        _everyBeforeReplicate: vi.fn(async () => true),
        _everyOnDatabaseInitialized: vi.fn(async () => true),
        _allSuspendExtraSync: vi.fn(async () => true),
        _allConfigureOptionalSyncFeature: vi.fn(async () => true),
        isTargetFileEligible: vi.fn(async () => true),
    };
    const settings = {
        usePluginSync: true,
        usePluginSyncV2: true,
        usePluginEtc: true,
        syncInternalFiles: true,
        pluginSyncExtendedSetting: {},
    };
    const booleanAnySuccess = (name: string) => anySuccessFunction<(...args: any[]) => Promise<boolean>>(name);
    const booleanBail = (name: string) => bailFirstFailureFunction<(...args: any[]) => Promise<boolean>>(name);
    const services = {
        fileProcessing: { processOptionalFileEvent: booleanAnySuccess("processOptionalFileEvent") },
        conflict: {
            getOptionalConflictCheckMethod: firstResultFunction<(...args: any[]) => Promise<boolean | "newer">>(
                "getOptionalConflictCheckMethod"
            ),
        },
        replication: {
            processVirtualDocument: booleanAnySuccess("processVirtualDocument"),
            processOptionalSynchroniseResult: booleanAnySuccess("processOptionalSynchroniseResult"),
            onBeforeReplicate: booleanBail("onBeforeReplicate"),
        },
        setting: {
            onRealiseSetting: booleanBail("onRealiseSetting"),
            suspendExtraSync: booleanBail("suspendExtraSync"),
            enableOptionalFeature: booleanBail("enableOptionalFeature"),
        },
        appLifecycle: {
            onSettingLoaded: booleanBail("onSettingLoaded"),
            onResuming: booleanBail("onResuming"),
            onUnload: allSettledFunction<() => Promise<boolean>>("onUnload"),
            isReady: vi.fn(() => true),
            isSuspended: vi.fn(() => false),
        },
        databaseEvents: { onDatabaseInitialised: booleanBail("onDatabaseInitialised") },
        vault: { isTargetFileInExtra: booleanAnySuccess("isTargetFileInExtra") },
        API: { getSystemConfigDir: vi.fn(() => ".obsidian") },
    };

    useOptionalFileSync({ services, settings } as never, {
        createCustomisationSync: () => customisationSync as never,
        createHiddenFileSync: () => hiddenFileSync as never,
    });

    return { customisationSync, hiddenFileSync, services, settings };
}

describe("useOptionalFileSync", () => {
    it("registers one owner-selecting handler for each overlapping result contract", () => {
        const { registries } = createFixture();

        expect(registries.processOptionalFileEvent.handlers).toHaveLength(1);
        expect(registries.getOptionalConflictCheckMethod.handlers).toHaveLength(1);
        expect(registries.onRealiseSetting.handlers).toHaveLength(2);
        expect(registries.onResuming.handlers).toHaveLength(2);
        expect(registries.onBeforeReplicate.handlers).toHaveLength(2);
        expect(registries.onDatabaseInitialised.handlers).toHaveLength(2);
        expect(registries.suspendExtraSync.handlers).toHaveLength(2);
        expect(registries.enableOptionalFeature.handlers).toHaveLength(2);
        expect(registries.processVirtualDocument.handlers).toHaveLength(1);
        expect(registries.processOptionalSynchroniseResult.handlers).toHaveLength(1);
        expect(registries.onSettingLoaded.handlers).toHaveLength(1);
        expect(registries.isTargetFileInExtra.handlers).toHaveLength(1);
    });

    it("routes Selective and Automatic paths to exactly one local owner", async () => {
        const { customisationSync, hiddenFileSync, registries, settings } = createFixture();
        customisationSync._anyProcessOptionalFileEvent.mockResolvedValue(true);
        hiddenFileSync._anyProcessOptionalFileEvent.mockResolvedValue(true);
        hiddenFileSync.isTargetFileEligible.mockResolvedValue(false);

        await expect(registries.isTargetFileInExtra.handlers[0]!(".obsidian/plugins/example/data.json")).resolves.toBe(
            true
        );
        await expect(
            registries.processOptionalFileEvent.handlers[0]!(".obsidian/plugins/example/data.json")
        ).resolves.toBe(true);
        expect(customisationSync._anyProcessOptionalFileEvent).toHaveBeenCalledOnce();
        expect(hiddenFileSync._anyProcessOptionalFileEvent).not.toHaveBeenCalled();
        expect(hiddenFileSync.isTargetFileEligible).not.toHaveBeenCalled();

        settings.pluginSyncExtendedSetting = {
            "PLUGIN_DATA/example": {
                key: "PLUGIN_DATA/example",
                mode: MODE_AUTOMATIC,
                files: [],
            },
        };
        hiddenFileSync.isTargetFileEligible.mockResolvedValue(true);
        customisationSync._anyProcessOptionalFileEvent.mockClear();

        await expect(
            registries.processOptionalFileEvent.handlers[0]!(".obsidian/plugins/example/data.json")
        ).resolves.toBe(true);
        expect(hiddenFileSync._anyProcessOptionalFileEvent).toHaveBeenCalledOnce();
        expect(customisationSync._anyProcessOptionalFileEvent).not.toHaveBeenCalled();
    });

    it("does not fall back to the other context when the selected owner skips or fails", async () => {
        const { customisationSync, hiddenFileSync, services } = createAggregateFixture();
        customisationSync._anyProcessOptionalFileEvent.mockResolvedValueOnce(false);

        await expect(services.fileProcessing.processOptionalFileEvent(".obsidian/app.json")).resolves.toBe(false);
        expect(hiddenFileSync._anyProcessOptionalFileEvent).not.toHaveBeenCalled();

        customisationSync._anyProcessOptionalFileEvent.mockRejectedValueOnce(new Error("customisation failed"));
        await expect(services.fileProcessing.processOptionalFileEvent(".obsidian/app.json")).resolves.toBe(false);
        expect(hiddenFileSync._anyProcessOptionalFileEvent).not.toHaveBeenCalled();
    });

    it("dispatches conflict documents by their persisted namespace", async () => {
        const { customisationSync, hiddenFileSync, services } = createAggregateFixture();
        customisationSync._anyGetOptionalConflictCheckMethod.mockResolvedValue("newer");
        hiddenFileSync._anyGetOptionalConflictCheckMethod.mockResolvedValue(true);

        await expect(services.conflict.getOptionalConflictCheckMethod("ix:device/app.json")).resolves.toBe("newer");
        expect(hiddenFileSync._anyGetOptionalConflictCheckMethod).not.toHaveBeenCalled();
        await expect(services.conflict.getOptionalConflictCheckMethod("i:.obsidian/example.json")).resolves.toBe(true);
        expect(customisationSync._anyGetOptionalConflictCheckMethod).toHaveBeenCalledOnce();
    });

    it("keeps persisted document acceptance separate from current local ownership", async () => {
        const { customisationSync, hiddenFileSync, registries, settings } = createFixture();
        settings.usePluginSync = false;
        settings.syncInternalFiles = false;

        await registries.processVirtualDocument.handlers[0]!({ _id: "ix:device-a/CONFIG/app.json.md" });
        await registries.processOptionalSynchroniseResult.handlers[0]!({ _id: "i:.obsidian/app.json" });

        expect(customisationSync._anyModuleParsedReplicationResultItem).toHaveBeenCalledOnce();
        expect(hiddenFileSync._anyProcessOptionalSyncFiles).toHaveBeenCalledOnce();
    });

    it("routes Ignore mode to neither local context", async () => {
        const { customisationSync, hiddenFileSync, registries, settings } = createFixture();
        settings.pluginSyncExtendedSetting = {
            "PLUGIN_DATA/example": {
                key: "PLUGIN_DATA/example",
                mode: MODE_PAUSED,
                files: ["plugins/example/data.json"],
            },
        };

        await expect(
            registries.processOptionalFileEvent.handlers[0]!(".obsidian/plugins/example/data.json")
        ).resolves.toBe(false);
        expect(customisationSync._anyProcessOptionalFileEvent).not.toHaveBeenCalled();
        expect(hiddenFileSync._anyProcessOptionalFileEvent).not.toHaveBeenCalled();
    });

    it("injects the same static ownership policy into both scan contexts", () => {
        const { contextDependencies, settings } = createFixture();
        const customisation = contextDependencies.customisation() as {
            ownsLocalFile(path: string): boolean;
            ownsLocalDocument(path: string): boolean;
        };
        const hiddenFile = contextDependencies.hiddenFile() as {
            ownsLocalFile(path: string): boolean;
        };
        const path = ".obsidian/plugins/example/data.json";

        expect(customisation.ownsLocalFile(path)).toBe(true);
        expect(hiddenFile.ownsLocalFile(path)).toBe(false);
        expect(customisation.ownsLocalDocument("ix:device-a/PLUGIN_DATA/example.md")).toBe(true);

        settings.pluginSyncExtendedSetting = {
            "PLUGIN_DATA/example": {
                key: "PLUGIN_DATA/example",
                mode: MODE_AUTOMATIC,
                files: [],
            },
        };
        expect(customisation.ownsLocalFile(path)).toBe(false);
        expect(hiddenFile.ownsLocalFile(path)).toBe(true);
        expect(customisation.ownsLocalDocument("ix:device-a/PLUGIN_DATA/example.md")).toBe(false);
    });

    it("preserves bail-first-failure and settled-unload behaviour", async () => {
        const { customisationSync, hiddenFileSync, services } = createAggregateFixture();
        customisationSync._everyRealizeSettingSyncMode.mockResolvedValueOnce(false);

        await expect(services.setting.onRealiseSetting()).resolves.toBe(false);
        expect(hiddenFileSync._everyRealizeSettingSyncMode).not.toHaveBeenCalled();

        customisationSync.dispose.mockImplementationOnce(() => {
            throw new Error("customisation disposal failed");
        });
        await expect(services.appLifecycle.onUnload()).resolves.toBe(false);
        expect(hiddenFileSync.dispose).toHaveBeenCalledOnce();
    });

    it("disposes both contexts and their registrations through the application lifecycle", async () => {
        const { calls, customisationSync, hiddenFileSync, registries } = createFixture();
        customisationSync.dispose.mockImplementation(() =>
            calls.push(`customisation:unload:${registries.processOptionalFileEvent.handlers.length}`)
        );
        hiddenFileSync.dispose.mockImplementation(() =>
            calls.push(`hidden:unload:${registries.processOptionalFileEvent.handlers.length}`)
        );

        await registries.onUnload.handlers[0]!();
        expect(calls).toEqual(["customisation:unload:0", "hidden:unload:0"]);
        expect(registries.processOptionalFileEvent.handlers).toHaveLength(0);
        expect(registries.getOptionalConflictCheckMethod.handlers).toHaveLength(0);
    });

    it("strips a database prefix before evaluating a Hidden File Sync target", async () => {
        const { hiddenFileSync, registries } = createFixture();

        await registries.isTargetFileInExtra.handlers[0]!({ path: "i:.obsidian/workspace" });

        expect(hiddenFileSync.isTargetFileEligible).toHaveBeenCalledWith(".obsidian/workspace");
    });

    it("returns focused views without registering either context as an add-on", () => {
        const { customisationSync, feature, hiddenFileSync } = createFixture();

        expect(feature.customisationSync).toBe(customisationSync);
        expect(feature.hiddenFileSyncCommands).toBe(hiddenFileSync);
        expect(feature.hiddenFileSyncInitialisation).toBe(hiddenFileSync);
        expect(feature.hiddenFileSyncRepair).toBe(hiddenFileSync);
        expect(feature.testing).toEqual({ customisationSync, hiddenFileSync });
        expect(Object.isFrozen(feature.testing)).toBe(true);
    });
});
