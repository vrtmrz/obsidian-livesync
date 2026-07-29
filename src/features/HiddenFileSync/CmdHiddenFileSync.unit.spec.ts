import { describe, expect, it, vi } from "vitest";
import {
    type DocumentID,
    LOG_LEVEL_NOTICE,
    type FilePath,
    type FilePathWithPrefix,
    type MetaEntry,
    type UXFileInfo,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

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

function createHiddenRevisionOperation() {
    const path = ".obsidian/plugins/example/data.json" as FilePath;
    const file = {
        path,
        name: "data.json",
        isInternal: true,
        body: new Blob(["{\"value\":\"vault\"}"]),
        stat: {
            ctime: 1,
            mtime: 2,
            size: 17,
            type: "file",
        },
    } as UXFileInfo;
    const selected = {
        _id: "i:example" as DocumentID,
        _rev: "2-selected",
        path: `i:${path}` as FilePathWithPrefix,
        ctime: 1,
        mtime: 2,
        size: 17,
        type: "plain",
        datatype: "plain",
        children: [],
        eden: {},
        deleted: false,
    } as MetaEntry;
    const winner = {
        ...selected,
        _rev: "3-winner",
    } as MetaEntry;
    const databaseFileAccess = {
        fetchEntryMeta: vi.fn(
            async (_path: unknown, revision?: string) =>
                revision === selected._rev ? selected : winner
        ),
        getConflictedRevs: vi.fn(async () => [selected._rev]),
        fetchEntryFromMeta: vi.fn(async () => ({ ...selected, data: "{\"value\":\"database\"}" })),
        storeWithBaseRevision: vi.fn(async () => "3-vault-child"),
    };
    const hiddenFileSync = Object.create(HiddenFileSync.prototype) as HiddenFileSync;
    Object.assign(hiddenFileSync, {
        core: {
            services: {
                vault: {
                    isIgnoredByIgnoreFile: vi.fn(async () => false),
                },
            },
            databaseFileAccess,
        },
        loadFileWithInfo: vi.fn(async () => file),
        updateLastProcessed: vi.fn(),
        _log: vi.fn(),
    });
    return {
        hiddenFileSync,
        path,
        file,
        selected,
        winner,
        databaseFileAccess,
    };
}

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

describe("HiddenFileSync exact revision repair operations", () => {
    it("stores the current hidden Vault file as a child of the selected live revision", async () => {
        const {
            hiddenFileSync,
            file,
            selected,
            databaseFileAccess,
        } = createHiddenRevisionOperation();

        await expect(
            hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(file, selected._rev!)
        ).resolves.toBe(true);

        expect(databaseFileAccess.storeWithBaseRevision).toHaveBeenCalledWith(
            expect.objectContaining({
                path: file.path,
                body: file.body,
                isInternal: true,
            }),
            selected._rev,
            true
        );
        expect(hiddenFileSync.updateLastProcessed).toHaveBeenCalledWith(
            file.path,
            expect.objectContaining({ _rev: "3-vault-child" }),
            file.stat
        );
    });

    it("refuses to extend a hidden-file revision which is no longer live", async () => {
        const {
            hiddenFileSync,
            file,
            selected,
            databaseFileAccess,
        } = createHiddenRevisionOperation();
        databaseFileAccess.getConflictedRevs.mockResolvedValue([]);

        await expect(
            hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(file, selected._rev!)
        ).resolves.toBe(false);

        expect(databaseFileAccess.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(hiddenFileSync.updateLastProcessed).not.toHaveBeenCalled();
    });

    it("does not create a hidden-file child when asked only to mark a revision which differs from the Vault", async () => {
        const {
            hiddenFileSync,
            file,
            selected,
            databaseFileAccess,
        } = createHiddenRevisionOperation();

        await expect(
            hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(
                file,
                selected._rev!,
                false
            )
        ).resolves.toBe(false);

        expect(databaseFileAccess.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(hiddenFileSync.updateLastProcessed).not.toHaveBeenCalled();
    });

    it("marks a matching hidden-file revision without creating a child", async () => {
        const {
            hiddenFileSync,
            file,
            selected,
            databaseFileAccess,
        } = createHiddenRevisionOperation();
        databaseFileAccess.fetchEntryFromMeta.mockResolvedValue({
            ...selected,
            data: "{\"value\":\"vault\"}",
        });

        await expect(
            hiddenFileSync.storeInternalFileToDatabaseWithBaseRevision(
                file,
                selected._rev!,
                false
            )
        ).resolves.toBe(true);

        expect(databaseFileAccess.storeWithBaseRevision).not.toHaveBeenCalled();
        expect(hiddenFileSync.updateLastProcessed).toHaveBeenCalledWith(
            file.path,
            selected,
            file.stat
        );
    });

    it("applies the selected live hidden-file revision through the existing extraction path", async () => {
        const {
            hiddenFileSync,
            path,
            selected,
        } = createHiddenRevisionOperation();
        const extract = vi.fn(async () => true);
        hiddenFileSync.extractInternalFileFromDatabase = extract;

        await expect(
            hiddenFileSync.extractInternalFileRevisionFromDatabase(path, selected._rev!, true)
        ).resolves.toBe(true);

        expect(extract).toHaveBeenCalledWith(path, true, undefined, true, false, true, selected._rev);
    });

    it("does not apply a hidden-file revision which ceased to be live", async () => {
        const {
            hiddenFileSync,
            path,
            selected,
            databaseFileAccess,
        } = createHiddenRevisionOperation();
        databaseFileAccess.getConflictedRevs.mockResolvedValue([]);

        await expect(
            hiddenFileSync.extractInternalFileRevisionFromDatabase(path, selected._rev!, true)
        ).resolves.toBe(false);

        expect(databaseFileAccess.fetchEntryFromMeta).not.toHaveBeenCalled();
    });
});
