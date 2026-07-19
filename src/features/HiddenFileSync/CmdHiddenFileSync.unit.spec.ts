import { describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {},
}));
vi.mock("@/features/LiveSyncCommands.ts", () => ({
    LiveSyncCommands: class LiveSyncCommands {
        plugin!: { app: unknown };
        core!: { services: unknown };
        get app() {
            return this.plugin.app;
        }
        get services() {
            return this.core.services;
        }
    },
}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSync } from "./CmdHiddenFileSync.ts";

describe("HiddenFileSync configuration-change notices", () => {
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
});
