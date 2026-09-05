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

function hiddenFileSyncRepairFixture() {
    return Object.freeze({
        scanInternalFiles: vi.fn(async () => []),
        storeInternalFileToDatabase: vi.fn(async () => true),
        storeInternalFileToDatabaseWithBaseRevision: vi.fn(async () => true),
        extractInternalFileRevisionFromDatabase: vi.fn(async () => true),
    });
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
    const customisationHandlers = {
        processOptionalFileEvent: vi.fn(async () => false),
        processVirtualDocument: vi.fn(async () => false),
        onRealiseSetting: vi.fn(async () => true),
        onResuming: vi.fn(async () => true),
        onBeforeReplicate: vi.fn(async () => true),
        onDatabaseInitialised: vi.fn(async () => true),
        suspendExtraSync: vi.fn(async () => true),
        enableOptionalFeature: vi.fn(async () => true),
    };
    const customisationTesting = Object.freeze({ kind: "customisation-testing" });
    const customisationSync = {
        dispose: vi.fn(() => calls.push("customisation:unload")),
        serviceHandlers: Object.freeze(customisationHandlers),
        testing: customisationTesting,
    };
    const hiddenFileHandlers = {
        onSettingLoaded: vi.fn(async () => true),
        processOptionalFileEvent: vi.fn(async () => false),
        queueConflict: vi.fn(async () => true),
        processOptionalSyncFiles: vi.fn(async () => false),
        realiseSettingSyncMode: vi.fn(async () => true),
        onResuming: vi.fn(async () => true),
        beforeReplicate: vi.fn(async () => true),
        onDatabaseInitialised: vi.fn(async () => true),
        suspendExtraSync: vi.fn(async () => true),
        configureOptionalSyncFeature: vi.fn(async () => true),
        isTargetFileEligible: vi.fn(async () => true),
    };
    const hiddenFileSyncRepair = hiddenFileSyncRepairFixture();
    const hiddenFileTesting = Object.freeze({ kind: "hidden-file-testing" });
    const hiddenFileSync = {
        dispose: vi.fn(() => calls.push("hidden:unload")),
        serviceHandlers: Object.freeze(hiddenFileHandlers),
        testing: hiddenFileTesting,
        repair: hiddenFileSyncRepair,
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
        customisationHandlers,
        customisationSync,
        customisationTesting,
        feature,
        hiddenFileHandlers,
        hiddenFileSync,
        hiddenFileTesting,
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
    const customisationHandlers = {
        processOptionalFileEvent: vi.fn(async () => false),
        processVirtualDocument: vi.fn(async () => false),
        onRealiseSetting: vi.fn(async () => true),
        onResuming: vi.fn(async () => true),
        onBeforeReplicate: vi.fn(async () => true),
        onDatabaseInitialised: vi.fn(async () => true),
        suspendExtraSync: vi.fn(async () => true),
        enableOptionalFeature: vi.fn(async () => true),
    };
    const customisationSync = {
        dispose: vi.fn(),
        serviceHandlers: Object.freeze(customisationHandlers),
        testing: Object.freeze({ kind: "customisation-testing" }),
    };
    const hiddenFileHandlers = {
        onSettingLoaded: vi.fn(async () => true),
        processOptionalFileEvent: vi.fn(async () => false),
        queueConflict: vi.fn(async () => true),
        processOptionalSyncFiles: vi.fn(async () => false),
        realiseSettingSyncMode: vi.fn(async () => true),
        onResuming: vi.fn(async () => true),
        beforeReplicate: vi.fn(async () => true),
        onDatabaseInitialised: vi.fn(async () => true),
        suspendExtraSync: vi.fn(async () => true),
        configureOptionalSyncFeature: vi.fn(async () => true),
        isTargetFileEligible: vi.fn(async () => true),
    };
    const hiddenFileSync = {
        dispose: vi.fn(),
        serviceHandlers: Object.freeze(hiddenFileHandlers),
        testing: Object.freeze({ kind: "hidden-file-testing" }),
        repair: hiddenFileSyncRepairFixture(),
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

    return { customisationHandlers, customisationSync, hiddenFileHandlers, hiddenFileSync, services, settings };
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
        const { customisationHandlers, hiddenFileHandlers, registries, settings } = createFixture();
        customisationHandlers.processOptionalFileEvent.mockResolvedValue(true);
        hiddenFileHandlers.processOptionalFileEvent.mockResolvedValue(true);
        hiddenFileHandlers.isTargetFileEligible.mockResolvedValue(false);

        await expect(registries.isTargetFileInExtra.handlers[0]!(".obsidian/plugins/example/data.json")).resolves.toBe(
            true
        );
        await expect(
            registries.processOptionalFileEvent.handlers[0]!(".obsidian/plugins/example/data.json")
        ).resolves.toBe(true);
        expect(customisationHandlers.processOptionalFileEvent).toHaveBeenCalledOnce();
        expect(hiddenFileHandlers.processOptionalFileEvent).not.toHaveBeenCalled();
        expect(hiddenFileHandlers.isTargetFileEligible).not.toHaveBeenCalled();

        settings.pluginSyncExtendedSetting = {
            "PLUGIN_DATA/example": {
                key: "PLUGIN_DATA/example",
                mode: MODE_AUTOMATIC,
                files: [],
            },
        };
        hiddenFileHandlers.isTargetFileEligible.mockResolvedValue(true);
        customisationHandlers.processOptionalFileEvent.mockClear();

        await expect(
            registries.processOptionalFileEvent.handlers[0]!(".obsidian/plugins/example/data.json")
        ).resolves.toBe(true);
        expect(hiddenFileHandlers.processOptionalFileEvent).toHaveBeenCalledOnce();
        expect(customisationHandlers.processOptionalFileEvent).not.toHaveBeenCalled();
    });

    it("does not fall back to the other context when the selected owner skips or fails", async () => {
        const { customisationHandlers, hiddenFileHandlers, services } = createAggregateFixture();
        customisationHandlers.processOptionalFileEvent.mockResolvedValueOnce(false);

        await expect(services.fileProcessing.processOptionalFileEvent(".obsidian/app.json")).resolves.toBe(false);
        expect(hiddenFileHandlers.processOptionalFileEvent).not.toHaveBeenCalled();

        customisationHandlers.processOptionalFileEvent.mockRejectedValueOnce(new Error("customisation failed"));
        await expect(services.fileProcessing.processOptionalFileEvent(".obsidian/app.json")).resolves.toBe(false);
        expect(hiddenFileHandlers.processOptionalFileEvent).not.toHaveBeenCalled();
    });

    it("dispatches conflict documents by their persisted namespace", async () => {
        const { hiddenFileHandlers, services } = createAggregateFixture();

        await expect(services.conflict.getOptionalConflictCheckMethod("ix:device/app.json")).resolves.toBe("newer");
        expect(hiddenFileHandlers.queueConflict).not.toHaveBeenCalled();
        await expect(services.conflict.getOptionalConflictCheckMethod("i:.obsidian/example.json")).resolves.toBe(true);
        expect(hiddenFileHandlers.queueConflict).toHaveBeenCalledOnce();
        expect(hiddenFileHandlers.queueConflict).toHaveBeenCalledWith("i:.obsidian/example.json");
        await expect(services.conflict.getOptionalConflictCheckMethod("notes/example.md")).resolves.toBe(false);
    });

    it("keeps persisted document acceptance separate from current local ownership", async () => {
        const { customisationHandlers, hiddenFileHandlers, registries, settings } = createFixture();
        settings.usePluginSync = false;
        settings.syncInternalFiles = false;

        await registries.processVirtualDocument.handlers[0]!({ _id: "ix:device-a/CONFIG/app.json.md" });
        await registries.processOptionalSynchroniseResult.handlers[0]!({ _id: "i:.obsidian/app.json" });

        expect(customisationHandlers.processVirtualDocument).toHaveBeenCalledOnce();
        expect(hiddenFileHandlers.processOptionalSyncFiles).toHaveBeenCalledOnce();
    });

    it("routes Ignore mode to neither local context", async () => {
        const { customisationHandlers, hiddenFileHandlers, registries, settings } = createFixture();
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
        expect(customisationHandlers.processOptionalFileEvent).not.toHaveBeenCalled();
        expect(hiddenFileHandlers.processOptionalFileEvent).not.toHaveBeenCalled();
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
        const { customisationHandlers, customisationSync, hiddenFileHandlers, hiddenFileSync, services } =
            createAggregateFixture();
        customisationHandlers.onRealiseSetting.mockResolvedValueOnce(false);

        await expect(services.setting.onRealiseSetting()).resolves.toBe(false);
        expect(hiddenFileHandlers.realiseSettingSyncMode).not.toHaveBeenCalled();

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
        const { hiddenFileHandlers, registries } = createFixture();

        await registries.isTargetFileInExtra.handlers[0]!({ path: "i:.obsidian/workspace" });

        expect(hiddenFileHandlers.isTargetFileEligible).toHaveBeenCalledWith(".obsidian/workspace");
    });

    it("returns a concrete repair adapter instead of exposing the broad context to UI", async () => {
        const {
            customisationSync,
            customisationTesting,
            feature,
            hiddenFileSync,
            hiddenFileTesting,
        } = createFixture();

        expect(feature.customisationSync).toBe(customisationSync);
        expect(feature.hiddenFileSyncCommands).toBe(hiddenFileSync);
        expect(feature.hiddenFileSyncInitialisation).toBe(hiddenFileSync);
        expect(feature.hiddenFileSyncRepair).toBe(hiddenFileSync.repair);
        expect(feature.hiddenFileSyncRepair).not.toBe(hiddenFileSync);
        expect(Object.isFrozen(feature.hiddenFileSyncRepair)).toBe(true);
        expect(Object.keys(feature.hiddenFileSyncRepair).sort()).toEqual(
            [
                "extractInternalFileRevisionFromDatabase",
                "scanInternalFiles",
                "storeInternalFileToDatabase",
                "storeInternalFileToDatabaseWithBaseRevision",
            ].sort()
        );
        const file = {
            path: ".obsidian/app.json",
            ctime: 1,
            mtime: 2,
            size: 3,
        } as never;
        await feature.hiddenFileSyncRepair.storeInternalFileToDatabaseWithBaseRevision(file, "2-selected", false);
        expect(hiddenFileSync.repair.storeInternalFileToDatabaseWithBaseRevision).toHaveBeenCalledWith(
            file,
            "2-selected",
            false
        );
        expect(feature.testing).toEqual({
            customisationSync: customisationTesting,
            hiddenFileSync: hiddenFileTesting,
        });
        expect(Object.isFrozen(feature.testing)).toBe(true);
        expect(feature.testing.customisationSync).not.toBe(customisationSync);
        expect(feature.testing.hiddenFileSync).not.toBe(hiddenFileSync);
    });
});
