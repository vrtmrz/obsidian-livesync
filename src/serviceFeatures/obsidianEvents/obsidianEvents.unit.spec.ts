import { describe, it, expect, vi, afterEach } from "vitest";

// Mock the Obsidian dependency barrel
vi.mock("@/deps.ts", () => ({
    Platform: { isMobile: false, isDesktop: true, isDesktopApp: true },
    Notice: vi.fn(),
    App: class MockApp {},
    ItemView: class MockItemView {},
}));

const mockScheduleTask = vi.fn((key: string, delay: number, action: () => any) => {
    action();
});
vi.mock("octagonal-wheels/concurrency/task", () => ({
    scheduleTask: (key: string, delay: number, action: () => any) => mockScheduleTask(key, delay, action),
    cancelTask: vi.fn(),
    cancelAllTasks: vi.fn(),
}));

import { DEFAULT_SETTINGS, REMOTE_COUCHDB } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import { createObsidianEventsState } from "./state";
import { watchWindowVisibilityAsync } from "./windowVisibility";
import type { ObsidianEventsHost } from "./types";
import { useObsidianEvents } from "./index";
import { performAppReload, askReload, scheduleAppReload, isReloadingScheduled } from "./appReload";
import { swapSaveCommand } from "./saveCommandHack";

type SetupOptions = {
    settings?: Partial<typeof DEFAULT_SETTINGS>;
    hidden: boolean;
    isLastHidden?: boolean;
    hasFocus?: boolean;
    isSuspended?: boolean;
    isMobile?: boolean;
};

function setup(opts: SetupOptions) {
    const appLifecycle = {
        isReady: vi.fn(() => true),
        isSuspended: vi.fn(() => opts.isSuspended ?? false),
        onSuspending: vi.fn(async () => true),
        onResuming: vi.fn(async () => true),
        onResumed: vi.fn(async () => true),
    };
    const fileProcessing = { commitPendingFileEvents: vi.fn(async () => true) };

    const settings = {
        ...DEFAULT_SETTINGS,
        remoteType: REMOTE_COUCHDB,
        isConfigured: true,
        ...opts.settings,
    };

    const host = {
        services: {
            API: {
                isMobile: vi.fn(() => opts.isMobile ?? false),
            },
            setting: {
                currentSettings: vi.fn(() => settings),
            },
            appLifecycle,
            fileProcessing,
        },
    } as unknown as ObsidianEventsHost;

    const log: LogFunction = vi.fn();
    const state = createObsidianEventsState();
    state.isLastHidden = opts.isLastHidden ?? false;
    state.hasFocus = opts.hasFocus ?? true;

    // The handler reads `activeWindow.document.hidden` or `activeDocument.hidden`
    (globalThis as any).activeWindow = { document: { hidden: opts.hidden } };
    (globalThis as any).activeDocument = { hidden: opts.hidden };

    return { host, log, state, appLifecycle, fileProcessing };
}

describe("watchWindowVisibilityAsync — keepReplicationActiveInBackground", () => {
    afterEach(() => {
        delete (globalThis as any).activeWindow;
        delete (globalThis as any).activeDocument;
    });

    it("does NOT suspend on hide when enabled in LiveSync mode on the desktop app", async () => {
        const { host, log, state, appLifecycle } = setup({
            settings: { keepReplicationActiveInBackground: true, liveSync: true },
            hidden: true,
        });
        await watchWindowVisibilityAsync(host, log, state);
        expect(appLifecycle.onSuspending).not.toHaveBeenCalled();
    });

    it("suspends on hide by default (setting off)", async () => {
        const { host, log, state, appLifecycle } = setup({
            settings: { keepReplicationActiveInBackground: false, liveSync: true },
            hidden: true,
        });
        await watchWindowVisibilityAsync(host, log, state);
        expect(appLifecycle.onSuspending).toHaveBeenCalledTimes(1);
    });

    it("forces onSuspending before the resume on becoming visible when enabled (LiveSync teardown)", async () => {
        const { host, log, state, appLifecycle } = setup({
            settings: { keepReplicationActiveInBackground: true, liveSync: true },
            hidden: false,
            isLastHidden: true, // hidden -> visible transition
        });
        await watchWindowVisibilityAsync(host, log, state);
        expect(appLifecycle.onSuspending).toHaveBeenCalledTimes(1);
        expect(appLifecycle.onResuming).toHaveBeenCalledTimes(1);
        expect(appLifecycle.onResumed).toHaveBeenCalledTimes(1);
        expect(appLifecycle.onSuspending.mock.invocationCallOrder[0]).toBeLessThan(
            appLifecycle.onResuming.mock.invocationCallOrder[0]
        );
    });

    it("does not force a teardown on becoming visible by default (setting off)", async () => {
        const { host, log, state, appLifecycle } = setup({
            settings: { keepReplicationActiveInBackground: false, liveSync: true },
            hidden: false,
            isLastHidden: true,
        });
        await watchWindowVisibilityAsync(host, log, state);
        expect(appLifecycle.onSuspending).not.toHaveBeenCalled();
        expect(appLifecycle.onResumed).toHaveBeenCalledTimes(1);
    });

    it("does not apply in On-Events mode even if the flag is set (no scope leak)", async () => {
        const { host, log, state, appLifecycle } = setup({
            settings: {
                keepReplicationActiveInBackground: true,
                liveSync: false,
                periodicReplication: false,
            },
            hidden: true,
        });
        await watchWindowVisibilityAsync(host, log, state);
        expect(appLifecycle.onSuspending).toHaveBeenCalledTimes(1);
    });

    it("does NOT suspend on hide when enabled in Periodic mode (the periodic timer also stalls otherwise)", async () => {
        const { host, log, state, appLifecycle } = setup({
            settings: {
                keepReplicationActiveInBackground: true,
                liveSync: false,
                periodicReplication: true,
            },
            hidden: true,
        });
        await watchWindowVisibilityAsync(host, log, state);
        expect(appLifecycle.onSuspending).not.toHaveBeenCalled();
    });

    it("does NOT force a teardown on becoming visible in Periodic mode (only the continuous channel can stall)", async () => {
        const { host, log, state, appLifecycle } = setup({
            settings: {
                keepReplicationActiveInBackground: true,
                liveSync: false,
                periodicReplication: true,
            },
            hidden: false,
            isLastHidden: true,
        });
        await watchWindowVisibilityAsync(host, log, state);
        expect(appLifecycle.onSuspending).not.toHaveBeenCalled();
        expect(appLifecycle.onResuming).toHaveBeenCalledTimes(1);
        expect(appLifecycle.onResumed).toHaveBeenCalledTimes(1);
    });

    it("does not apply on mobile even if the flag is set", async () => {
        const { host, log, state, appLifecycle } = setup({
            settings: { keepReplicationActiveInBackground: true, liveSync: true },
            hidden: true,
            isMobile: true,
        });
        await watchWindowVisibilityAsync(host, log, state);
        expect(appLifecycle.onSuspending).toHaveBeenCalledTimes(1);
    });
});

describe("useObsidianEvents Feature Hook", () => {
    it("should register lifecycle hooks, events, and commands", () => {
        const appLifecycle = {
            onLayoutReady: { addHandler: vi.fn() },
            onInitialise: { addHandler: vi.fn() },
            askRestart: { setHandler: vi.fn() },
            scheduleRestart: { setHandler: vi.fn() },
            isReloadingScheduled: { setHandler: vi.fn() },
        };
        const plugin = {
            registerEvent: vi.fn(),
            registerDomEvent: vi.fn(),
        };
        const app = {
            vault: {
                on: vi.fn(),
            },
            workspace: {
                on: vi.fn(),
            },
        };
        const host = {
            services: {
                API: {
                    addLog: vi.fn(),
                },
                appLifecycle,
            },
            context: {
                plugin,
                app,
            },
        } as any;

        useObsidianEvents(host);

        expect(appLifecycle.onLayoutReady.addHandler).toHaveBeenCalled();
        expect(appLifecycle.onInitialise.addHandler).toHaveBeenCalled();
        expect(appLifecycle.askRestart.setHandler).toHaveBeenCalled();
        expect(appLifecycle.scheduleRestart.setHandler).toHaveBeenCalled();
        expect(appLifecycle.isReloadingScheduled.setHandler).toHaveBeenCalled();
    });
});

describe("performAppReload", () => {
    it("should trigger restart on host appLifecycle service", () => {
        const performRestart = vi.fn();
        const host = {
            services: {
                appLifecycle: {
                    performRestart,
                },
            },
        } as any;
        performAppReload(host);
        expect(performRestart).toHaveBeenCalledTimes(1);
    });
});

describe("askReload", () => {
    it("should log and return early if reloading is already scheduled", () => {
        const isReloadingScheduledMock = vi.fn(() => true);
        const host = {
            services: {
                appLifecycle: {
                    isReloadingScheduled: isReloadingScheduledMock,
                },
            },
        } as any;
        const log = vi.fn();
        askReload(host, log);
        expect(isReloadingScheduledMock).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("Reloading is already scheduled", 16); // LOG_LEVEL_VERBOSE is 16
    });

    it("should prompt user and reload immediately when user selects immediate restart option", async () => {
        const isReloadingScheduledMock = vi.fn(() => false);
        const performRestart = vi.fn();
        const askSelectStringDialogue = vi.fn(async () => "Yes, restart immediately");
        const host = {
            services: {
                appLifecycle: {
                    isReloadingScheduled: isReloadingScheduledMock,
                    performRestart,
                },
                UI: {
                    confirm: {
                        askSelectStringDialogue,
                    },
                },
            },
        } as any;
        const log = vi.fn();

        mockScheduleTask.mockClear();
        askReload(host, log, "Custom message");
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(mockScheduleTask).toHaveBeenCalledWith("configReload", 250, expect.any(Function));
        expect(askSelectStringDialogue).toHaveBeenCalledWith(
            "Custom message",
            ["Yes, schedule a restart after stabilisation", "Yes, restart immediately", "No, Leave it to me"],
            { defaultAction: "No, Leave it to me" }
        );
        expect(performRestart).toHaveBeenCalledTimes(1);
    });

    it("should prompt user and schedule reload when user selects stabilisation option", async () => {
        const isReloadingScheduledMock = vi.fn(() => false);
        const scheduleRestart = vi.fn();
        const askSelectStringDialogue = vi.fn(async () => "Yes, schedule a restart after stabilisation");
        const host = {
            services: {
                appLifecycle: {
                    isReloadingScheduled: isReloadingScheduledMock,
                    scheduleRestart,
                },
                UI: {
                    confirm: {
                        askSelectStringDialogue,
                    },
                },
            },
        } as any;
        const log = vi.fn();

        askReload(host, log);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(scheduleRestart).toHaveBeenCalledTimes(1);
    });

    it("should do nothing when user cancels or selects leave it to me option", async () => {
        const isReloadingScheduledMock = vi.fn(() => false);
        const performRestart = vi.fn();
        const scheduleRestart = vi.fn();
        const askSelectStringDialogue = vi.fn(async () => "No, Leave it to me");
        const host = {
            services: {
                appLifecycle: {
                    isReloadingScheduled: isReloadingScheduledMock,
                    performRestart,
                    scheduleRestart,
                },
                UI: {
                    confirm: {
                        askSelectStringDialogue,
                    },
                },
            },
        } as any;
        const log = vi.fn();

        askReload(host, log);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(performRestart).not.toHaveBeenCalled();
        expect(scheduleRestart).not.toHaveBeenCalled();
    });
});

describe("scheduleAppReload and isReloadingScheduled", () => {
    it("should correctly manage reloading schedule and transition through ticks", () => {
        vi.useFakeTimers();

        const performRestart = vi.fn();
        const host = {
            services: {
                replication: {
                    databaseQueueCount: { value: 0 },
                    replicationResultCount: { value: 0 },
                    storageApplyingCount: { value: 0 },
                },
                conflict: {
                    conflictProcessQueueCount: { value: 0 },
                },
                appLifecycle: {
                    performRestart,
                },
            },
            context: {
                plugin: {
                    registerInterval: vi.fn(),
                },
            },
        } as any;

        const state = createObsidianEventsState();
        const log = vi.fn();

        expect(isReloadingScheduled(state)).toBe(false);

        scheduleAppReload(host, log, state);
        expect(isReloadingScheduled(state)).toBe(true);
        expect(host.context.plugin.registerInterval).toHaveBeenCalled();

        vi.advanceTimersByTime(1000);
        expect(log).toHaveBeenCalledWith(
            "Obsidian will be restarted soon! (Within 2 seconds)",
            64, // LOG_LEVEL_NOTICE is 64
            "restart-notice"
        );

        vi.advanceTimersByTime(1000);
        expect(log).toHaveBeenCalledWith(
            "Obsidian will be restarted soon! (Within 1 seconds)",
            64, // LOG_LEVEL_NOTICE is 64
            "restart-notice"
        );

        vi.advanceTimersByTime(1000);
        expect(log).toHaveBeenCalledWith(
            "Obsidian will be restarted soon! (Within 0 seconds)",
            64, // LOG_LEVEL_NOTICE is 64
            "restart-notice"
        );

        vi.advanceTimersByTime(1000);
        expect(performRestart).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it("should reset stabilisation check if total processing count becomes non-zero", () => {
        vi.useFakeTimers();

        const performRestart = vi.fn();
        const host = {
            services: {
                replication: {
                    databaseQueueCount: { value: 0 },
                    replicationResultCount: { value: 0 },
                    storageApplyingCount: { value: 0 },
                },
                conflict: {
                    conflictProcessQueueCount: { value: 0 },
                },
                appLifecycle: {
                    performRestart,
                },
            },
            context: {
                plugin: {
                    registerInterval: vi.fn(),
                },
            },
        } as any;

        const state = createObsidianEventsState();
        const log = vi.fn();

        scheduleAppReload(host, log, state);

        vi.advanceTimersByTime(1000);
        expect(log).toHaveBeenCalledWith(
            "Obsidian will be restarted soon! (Within 2 seconds)",
            64, // LOG_LEVEL_NOTICE is 64
            "restart-notice"
        );

        host.services.replication.databaseQueueCount.value = 5;
        vi.advanceTimersByTime(1000);

        host.services.replication.databaseQueueCount.value = 0;
        vi.advanceTimersByTime(1000);
        expect(log).toHaveBeenCalledWith(
            "Obsidian will be restarted soon! (Within 2 seconds)",
            64, // LOG_LEVEL_NOTICE is 64
            "restart-notice"
        );

        vi.useRealTimers();
    });
});

describe("swapSaveCommand", () => {
    it("should override the save command callback and handle execution flow", () => {
        const originalCallback = vi.fn();
        const saveCommandDefinition = {
            callback: originalCallback,
        };
        const replicateByEvent = vi.fn(async () => {});
        const host = {
            context: {
                app: {
                    commands: {
                        commands: {
                            "editor:save-file": saveCommandDefinition,
                        },
                        executeCommandById: vi.fn(),
                    },
                },
            },
            services: {
                control: {
                    hasUnloaded: vi.fn(() => false),
                },
                setting: {
                    currentSettings: vi.fn(() => ({
                        syncOnEditorSave: true,
                    })),
                },
                replication: {
                    replicateByEvent,
                },
            },
        } as any;

        const state = createObsidianEventsState();
        const log = vi.fn();

        mockScheduleTask.mockClear();
        swapSaveCommand(host, log, state);

        expect(state.initialCallback).toBe(originalCallback);
        expect(saveCommandDefinition.callback).not.toBe(originalCallback);

        saveCommandDefinition.callback();
        expect(originalCallback).toHaveBeenCalledTimes(1);
        expect(mockScheduleTask).toHaveBeenCalledWith("syncOnEditorSave", 250, expect.any(Function));
        expect(replicateByEvent).toHaveBeenCalledTimes(1);
    });

    it("should restore the original save callback if the plug-in is unloaded", () => {
        const originalCallback = vi.fn();
        const saveCommandDefinition = {
            callback: originalCallback,
        };
        const host = {
            context: {
                app: {
                    commands: {
                        commands: {
                            "editor:save-file": saveCommandDefinition,
                        },
                    },
                },
            },
            services: {
                control: {
                    hasUnloaded: vi.fn(() => true),
                },
            },
        } as any;

        const state = createObsidianEventsState();
        const log = vi.fn();

        swapSaveCommand(host, log, state);
        saveCommandDefinition.callback();

        expect(saveCommandDefinition.callback).toBe(originalCallback);
        expect(state.initialCallback).toBeUndefined();
    });
});
