import { afterEach, describe, expect, it, vi } from "vitest";
import {
    AUTO_MERGED,
    DEFAULT_SETTINGS,
    REMOTE_P2P,
    type FilePathWithPrefix,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { NO_INTERACTION } from "@vrtmrz/livesync-commonlib/replication";
import { EVENT_FILE_SAVED, eventHub } from "@/common/events";

const taskMocks = vi.hoisted(() => ({
    scheduleTask: vi.fn((_key: string, _delay: number, task: () => unknown) => task()),
}));

vi.mock("octagonal-wheels/concurrency/task", () => taskMocks);

import { ModuleConflictResolver } from "../coreFeatures/ModuleConflictResolver";
import { ModuleObsidianEvents } from "../essentialObsidian/ModuleObsidianEvents";
import {
    createReplicationSchedulingContext,
    realiseReplicationScheduling,
    resumeReplicationScheduling,
    runPeriodicReplication,
} from "@/serviceFeatures/replicationScheduling";
import { ModuleReplicator } from "./ModuleReplicator";

function createApi() {
    return {
        addLog: vi.fn(),
        addCommand: vi.fn(),
        registerWindow: vi.fn(),
        addRibbonIcon: vi.fn(),
        registerProtocolHandler: vi.fn(),
        setInterval: vi.fn(),
        clearInterval: vi.fn(),
    };
}

function p2pSettings(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
    return {
        ...DEFAULT_SETTINGS,
        remoteType: REMOTE_P2P,
        isConfigured: true,
        ...overrides,
    };
}

function createObsidianEventHarness(settings: Partial<typeof DEFAULT_SETTINGS>) {
    const save = vi.fn();
    const saveCommand = { callback: save };
    const replicateUnattendedByEvent = vi.fn(async () => ({ status: "completed" as const }));
    const queueCheckForIfOpen = vi.fn(async () => undefined);
    const services = {
        API: createApi(),
        appLifecycle: {
            isReady: vi.fn(() => true),
            isSuspended: vi.fn(() => false),
        },
        conflict: { queueCheckForIfOpen },
        control: { hasUnloaded: vi.fn(() => false) },
        fileProcessing: { commitPendingFileEvents: vi.fn(async () => true) },
        replication: { replicateUnattendedByEvent },
    };
    const core = {
        _services: services,
        services,
        settings: p2pSettings(settings),
    } as any;
    const plugin = {
        app: {
            commands: {
                commands: { "editor:save-file": saveCommand },
                executeCommandById: vi.fn(),
            },
        },
    } as any;

    return {
        module: new ModuleObsidianEvents(plugin, core),
        queueCheckForIfOpen,
        replicateUnattendedByEvent,
        save,
        saveCommand,
        services,
    };
}

describe("automatic replication triggers while P2P is active", () => {
    afterEach(() => {
        eventHub.offAll();
        taskMocks.scheduleTask.mockClear();
    });

    it("keeps periodic synchronisation on the provider-independent replication boundary", async () => {
        const replicateUnattended = vi.fn(async () => ({ status: "completed" as const }));
        const services = {
            API: createApi(),
            control: { hasUnloaded: vi.fn(() => false) },
            replication: { replicateUnattended },
        };
        const core = {
            _services: services,
            services,
            settings: p2pSettings({ periodicReplication: true, syncOnStart: false }),
        } as any;
        const context = createReplicationSchedulingContext({
            isReady: vi.fn(() => true),
            isSuspended: vi.fn(() => false),
            currentSettings: vi.fn(() => core.settings),
            replicateUnattended,
            startContinuous: vi.fn(async () => ({ status: "completed" as const })),
            timer: { enable: vi.fn(), disable: vi.fn() },
            log: vi.fn(),
        });

        resumeReplicationScheduling(context);
        await runPeriodicReplication(context);

        expect(replicateUnattended).toHaveBeenCalledOnce();
        expect(replicateUnattended).toHaveBeenCalledWith({
            trigger: "periodic",
            interaction: NO_INTERACTION,
        });
    });

    it("keeps database-save synchronisation on the event replication boundary", async () => {
        const replicateUnattendedByEvent = vi.fn(async () => ({ status: "completed" as const }));
        const settings = p2pSettings({ syncOnSave: true });
        const services = {
            appLifecycle: { isSuspended: vi.fn(() => false) },
            replication: { replicateUnattendedByEvent },
        };
        const module = {
            core: { services, settings },
            services,
            settings,
            getNormalFileReflectionFilterSignature: (
                ModuleReplicator.prototype as unknown as {
                    getNormalFileReflectionFilterSignature: (value: typeof settings) => string;
                }
            ).getNormalFileReflectionFilterSignature,
        };

        await (ModuleReplicator.prototype as any)._everyOnloadAfterLoadSettings.call(module);
        eventHub.emitEvent(EVENT_FILE_SAVED);

        await vi.waitFor(() => expect(replicateUnattendedByEvent).toHaveBeenCalledOnce());
        expect(replicateUnattendedByEvent).toHaveBeenCalledWith({
            trigger: "database-event",
            interaction: NO_INTERACTION,
        });
    });

    it("keeps editor-save synchronisation on the event replication boundary", async () => {
        const { module, replicateUnattendedByEvent, save, saveCommand } = createObsidianEventHarness({
            syncOnEditorSave: true,
        });

        module.swapSaveCommand();
        saveCommand.callback();

        expect(save).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(replicateUnattendedByEvent).toHaveBeenCalledOnce());
        expect(replicateUnattendedByEvent).toHaveBeenCalledWith({
            trigger: "editor-save",
            interaction: NO_INTERACTION,
        });
    });

    it("keeps file-open synchronisation on the event replication boundary", async () => {
        const { module, queueCheckForIfOpen, replicateUnattendedByEvent, services } = createObsidianEventHarness({
            syncOnFileOpen: true,
        });
        const file = { path: "opened.md" } as never;

        await module.watchWorkspaceOpenAsync(file);

        expect(services.fileProcessing.commitPendingFileEvents).toHaveBeenCalledOnce();
        expect(replicateUnattendedByEvent).toHaveBeenCalledOnce();
        expect(replicateUnattendedByEvent).toHaveBeenCalledWith({
            trigger: "file-open",
            interaction: NO_INTERACTION,
        });
        expect(queueCheckForIfOpen).toHaveBeenCalledWith("opened.md");
    });

    it("keeps post-merge synchronisation on the event replication boundary", async () => {
        const replicateUnattendedByEvent = vi.fn(async () => ({ status: "completed" as const }));
        const queueCheckFor = vi.fn(async () => undefined);
        const path = "merged.md" as FilePathWithPrefix;
        const module = {
            settings: p2pSettings({ syncAfterMerge: true }),
            services: {
                appLifecycle: { isSuspended: vi.fn(() => false) },
                conflict: { queueCheckFor },
                replication: { replicateUnattendedByEvent },
            },
            checkConflictAndPerformAutoMerge: vi.fn(async () => AUTO_MERGED),
            _log: vi.fn(),
        };

        await (ModuleConflictResolver.prototype as any)._resolveConflict.call(module, path);

        expect(replicateUnattendedByEvent).toHaveBeenCalledOnce();
        expect(replicateUnattendedByEvent).toHaveBeenCalledWith({
            trigger: "merge",
            interaction: NO_INTERACTION,
        });
        expect(queueCheckFor).toHaveBeenCalledWith(path);
    });
});

describe("recurring replication scheduling precedence", () => {
    afterEach(() => {
        eventHub.offAll();
    });

    function createRecurringSchedulingHarness() {
        let resolveContinuous!: (
            outcome: { status: "completed" } | { status: "blocked"; reason: "capability-not-applicable" }
        ) => void;
        const startContinuous = vi.fn(
            () =>
                new Promise<{ status: "completed" } | { status: "blocked"; reason: "capability-not-applicable" }>(
                    (resolve) => {
                        resolveContinuous = resolve;
                    }
                )
        );
        const API = createApi();
        const settings = {
            ...DEFAULT_SETTINGS,
            isConfigured: true,
            liveSync: true,
            syncOnStart: true,
            periodicReplication: true,
            periodicReplicationInterval: 60,
        };
        const context = createReplicationSchedulingContext({
            isReady: vi.fn(() => true),
            isSuspended: vi.fn(() => false),
            currentSettings: vi.fn(() => settings),
            startContinuous,
            replicateUnattended: vi.fn(async () => ({ status: "completed" as const })),
            timer: {
                enable: (interval) => {
                    API.setInterval(vi.fn(), interval);
                },
                disable: () => {
                    API.clearInterval(0);
                },
            },
            log: vi.fn(),
        });

        return {
            API,
            resolveContinuous: (
                outcome: { status: "completed" } | { status: "blocked"; reason: "capability-not-applicable" }
            ) => resolveContinuous(outcome),
            resume: async () => {
                resumeReplicationScheduling(context);
                await Promise.resolve();
            },
            realiseSettings: async () => {
                realiseReplicationScheduling(context);
                await Promise.resolve();
            },
        };
    }

    it("does not enable the generic periodic timer while Continuous owns recurring synchronisation", async () => {
        const harness = createRecurringSchedulingHarness();

        await harness.resume();
        await harness.realiseSettings();

        expect(harness.API.setInterval).not.toHaveBeenCalled();
        harness.resolveContinuous({ status: "completed" });
        await vi.waitFor(() => expect(harness.API.setInterval).not.toHaveBeenCalled());
    });

    it("restores the generic periodic timer when Continuous is not applicable", async () => {
        const harness = createRecurringSchedulingHarness();

        await harness.resume();
        await harness.realiseSettings();
        harness.resolveContinuous({ status: "blocked", reason: "capability-not-applicable" });

        await vi.waitFor(() => expect(harness.API.setInterval).toHaveBeenCalledOnce());
    });
});
