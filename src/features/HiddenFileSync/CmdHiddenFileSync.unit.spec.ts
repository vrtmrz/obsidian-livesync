import { describe, expect, it, vi } from "vitest";
import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {},
}));
vi.mock("@/features/LiveSyncCommands.ts", () => ({
    LiveSyncCommands: class LiveSyncCommands {
        plugin!: { app: unknown };
        core!: { services: unknown; settings: unknown };
        get app() {
            return this.plugin.app;
        }
        get services() {
            return this.core.services;
        }
        get settings() {
            return this.core.settings;
        }
    },
}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSync } from "./CmdHiddenFileSync.ts";
import { configureHiddenFileSyncMode } from "./configureHiddenFileSyncMode.ts";

describe("HiddenFileSync configuration-change notices", () => {
    it("shows manual Hidden File Sync commands only when the feature, Advanced mode, and runtime are ready", () => {
        const commands: Array<{
            id: string;
            checkCallback?: (checking: boolean) => boolean | void;
        }> = [];
        const settings = {
            syncInternalFiles: false,
            useAdvancedMode: false,
        };
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            core: {
                settings,
                services: {
                    API: {
                        addCommand: vi.fn((command) => commands.push(command)),
                    },
                },
            },
            _isMainReady: vi.fn(() => true),
            _isMainSuspended: vi.fn(() => false),
            _isDatabaseReady: vi.fn(() => true),
        });

        hiddenFileSync.onload();

        const commandIds = [
            "livesync-sync-internal",
            "livesync-scaninternal-storage",
            "livesync-scaninternal-database",
            "livesync-internal-scan-offline-changes",
        ];
        for (const commandId of commandIds) {
            const command = commands.find(({ id }) => id === commandId);
            expect(command?.checkCallback?.(true)).toBe(false);
        }

        settings.syncInternalFiles = true;
        settings.useAdvancedMode = true;
        for (const commandId of commandIds) {
            const command = commands.find(({ id }) => id === commandId);
            expect(command?.checkCallback?.(true)).toBe(true);
        }
    });

    it("does not report Hidden File Sync as ready before the main runtime is ready", () => {
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            core: {
                settings: {
                    syncInternalFiles: true,
                },
            },
            _isMainReady: vi.fn(() => false),
            _isMainSuspended: vi.fn(() => false),
        });

        expect(hiddenFileSync.isReady()).toBe(false);
    });

    it("groups plug-in reloads and an Obsidian restart into one finished Notice", async () => {
        const noticeGroups = {
            setItem: vi.fn(),
            finish: vi.fn(() => true),
            removeItem: vi.fn(() => true),
        };
        const plugin = {
            app: {
                plugins: {
                    manifests: {
                        alpha: {
                            id: "alpha",
                            name: "Alpha",
                            dir: ".obsidian/plugins/alpha",
                        },
                        beta: {
                            id: "beta",
                            name: "Beta",
                            dir: ".obsidian/plugins/beta",
                        },
                    },
                    enabledPlugins: new Set(["alpha", "beta"]),
                    unloadPlugin: vi.fn(async () => undefined),
                    loadPlugin: vi.fn(async () => undefined),
                },
            },
        };
        const core = {
            confirm: { askInPopup: vi.fn() },
            services: {
                context: { noticeGroups },
                API: { getSystemConfigDir: vi.fn(() => ".obsidian") },
                appLifecycle: {
                    isReloadingScheduled: vi.fn(() => false),
                    scheduleRestart: vi.fn(),
                },
            },
        };
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            plugin,
            core,
            queuedNotificationFiles: new Set([".obsidian/plugins/alpha", ".obsidian/plugins/beta", ".obsidian"]),
            _log: vi.fn(),
        });

        hiddenFileSync.notifyConfigChange();

        expect(noticeGroups.setItem).toHaveBeenNthCalledWith(1, "hidden-file-changes", "plugin:alpha", {
            message: "Files in Alpha were updated.",
            action: expect.objectContaining({ label: "Reload Alpha" }),
        });
        expect(noticeGroups.setItem).toHaveBeenNthCalledWith(2, "hidden-file-changes", "plugin:beta", {
            message: "Files in Beta were updated.",
            action: expect.objectContaining({ label: "Reload Beta" }),
        });
        expect(noticeGroups.setItem).toHaveBeenNthCalledWith(3, "hidden-file-changes", "restart", {
            message: "Other Obsidian settings files were updated.",
            action: expect.objectContaining({ label: "Schedule an Obsidian restart" }),
        });
        expect(noticeGroups.setItem.mock.calls.every(([groupKey]) => groupKey === "hidden-file-changes")).toBe(true);
        expect(noticeGroups.finish).toHaveBeenCalledWith("hidden-file-changes", { durationMs: 20_000 });
        expect(core.confirm.askInPopup).not.toHaveBeenCalled();

        const reloadAction = (noticeGroups.setItem.mock.calls[0]?.[2] as { action: { onSelect: () => void } }).action
            .onSelect;
        reloadAction();
        await vi.waitFor(() => {
            expect(plugin.app.plugins.unloadPlugin).toHaveBeenCalledWith("alpha");
            expect(plugin.app.plugins.loadPlugin).toHaveBeenCalledWith("alpha");
            expect(noticeGroups.removeItem).toHaveBeenCalledWith("hidden-file-changes", "plugin:alpha");
        });

        const restartAction = (noticeGroups.setItem.mock.calls[2]?.[2] as { action: { onSelect: () => void } }).action
            .onSelect;
        restartAction();
        expect(core.services.appLifecycle.scheduleRestart).toHaveBeenCalledOnce();
        expect(noticeGroups.removeItem).toHaveBeenCalledWith("hidden-file-changes", "restart");
    });

    it("keeps subordinate initialisation phases below Notice level so one progress Notice owns the scan", async () => {
        const progress = {
            log: vi.fn(),
            once: vi.fn(),
            done: vi.fn(),
        };
        const rebuildMerging = vi.fn(async () => []);
        const adoptCurrentStorageFilesAsProcessed = vi.fn(async () => undefined);
        const adoptCurrentDatabaseFilesAsProcessed = vi.fn(async () => undefined);
        const scanAllStorageChanges = vi.fn(async () => undefined);
        const scanAllDatabaseChanges = vi.fn(async () => undefined);
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            _progress: vi.fn(() => progress),
            rebuildMerging,
            adoptCurrentStorageFilesAsProcessed,
            adoptCurrentDatabaseFilesAsProcessed,
            scanAllStorageChanges,
            scanAllDatabaseChanges,
        });

        await hiddenFileSync.initialiseInternalFileSync("safe", true);

        expect(rebuildMerging).toHaveBeenCalledWith(false, false);
        expect(scanAllStorageChanges).toHaveBeenCalledWith(false, true, false);
        expect(scanAllDatabaseChanges).toHaveBeenCalledWith(false, true, false);
        expect(progress.done).toHaveBeenCalledOnce();
    });

    it("retirement guard: does not restore separate gathering and restart Notices", async () => {
        vi.mocked(configureHiddenFileSyncMode).mockImplementation(async (_mode, handlers) => {
            await handlers.enable();
            await handlers.initialise("safe");
            return "enabled";
        });
        const events: string[] = [];
        const progress = {
            log: vi.fn((message: string) => {
                events.push(`progress:${message}`);
            }),
            once: vi.fn(),
            done: vi.fn(),
        };
        const createProgress = vi.fn(() => progress);
        const applyPartial = vi.fn(async () => {
            events.push("apply-settings");
        });
        const initialiseInternalFileSync = vi.fn(async () => undefined);
        const log = vi.fn();
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            core: {
                services: {
                    setting: { applyPartial },
                },
            },
            initialiseInternalFileSync,
            _progress: createProgress,
            _log: log,
        });

        await hiddenFileSync.configureHiddenFileSync("MERGE");

        expect(createProgress).toHaveBeenCalledWith("[⚙ Initialise]\n", LOG_LEVEL_NOTICE);
        expect(events[0]).toBe("progress:Preparing Hidden File Sync...");
        expect(initialiseInternalFileSync).toHaveBeenCalledWith("safe", true, false, progress);
        expect(log).not.toHaveBeenCalledWith("Gathering files for enabling Hidden File Sync", LOG_LEVEL_NOTICE);
        expect(log).not.toHaveBeenCalledWith("Done! Restarting the app is strongly recommended!", LOG_LEVEL_NOTICE);
        expect(log).toHaveBeenCalledWith("Hidden File Sync initialisation completed.", expect.any(Number));
    });

    it("closes the preparation Notice when enabling Hidden File Sync fails", async () => {
        vi.mocked(configureHiddenFileSyncMode).mockImplementation(async (_mode, handlers) => {
            await handlers.enable();
            return "enabled";
        });
        const error = new Error("setting persistence failed");
        const progress = {
            log: vi.fn(),
            once: vi.fn(),
            done: vi.fn(),
        };
        const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
        Object.assign(hiddenFileSync, {
            core: {
                services: {
                    setting: {
                        applyPartial: vi.fn(async () => {
                            throw error;
                        }),
                    },
                },
            },
            _progress: vi.fn(() => progress),
            _log: vi.fn(),
        });

        await expect(hiddenFileSync.configureHiddenFileSync("MERGE")).rejects.toBe(error);

        expect(progress.done).toHaveBeenCalledWith("Failed");
    });
});
