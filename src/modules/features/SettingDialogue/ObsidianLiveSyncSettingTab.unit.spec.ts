import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, LOG_LEVEL_NOTICE, REMOTE_COUCHDB } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { REMOTE_RESOURCE_KINDS } from "@vrtmrz/livesync-commonlib/replication";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

const settingsInitialisationMocks = vi.hoisted(() => ({
    applySettingsWithInitialisationChoice: vi.fn(),
}));
const loggerMocks = vi.hoisted(() => ({
    Logger: vi.fn(),
}));

vi.mock("@/deps.ts", () => ({
    App: class {},
    Component: class {
        load = vi.fn();
        unload = vi.fn();
        register = vi.fn();
    },
    PluginSettingTab: class {},
    SettingPage: undefined,
    requireApiVersion: vi.fn(() => false),
}));
vi.mock("@/main.ts", () => ({ default: class {} }));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/logger", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@vrtmrz/livesync-commonlib/compat/common/logger")>();
    return { ...actual, Logger: loggerMocks.Logger };
});
vi.mock("@/common/translation", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/common/translation")>();
    return { ...actual, $msg: vi.fn(actual.$msg) };
});
vi.mock("@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions", () => ({
    getLanguage: vi.fn(() => "en"),
    compatGlobal: {
        localStorage: {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
        },
    },
}));
vi.mock("@/common/events.ts", () => ({
    EVENT_ON_UNRESOLVED_ERROR: "on-unresolved-error",
    EVENT_REQUEST_COPY_SETUP_URI: "request-copy-setup-uri",
    EVENT_REQUEST_OPEN_SETUP_URI: "request-open-setup-uri",
    EVENT_REQUEST_RELOAD_SETTING_TAB: "request-reload-setting-tab",
    EVENT_REQUEST_SHOW_SETUP_QR: "request-show-setup-qr",
    eventHub: { emitEvent: vi.fn(), onEvent: vi.fn() },
}));
vi.mock("@/modules/features/SetupManager.ts", () => ({ SetupManager: class {} }));
vi.mock("./LiveSyncSetting.ts", () => ({ LiveSyncSetting: class {} }));
vi.mock("./SettingPane.ts", () => ({
    enableOnly: vi.fn(() => vi.fn()),
    setLevelClass: vi.fn(),
    setStyle: vi.fn(),
    visibleOnly: vi.fn(() => vi.fn()),
}));
vi.mock("./PaneChangeLog.ts", () => ({ paneChangeLog: vi.fn() }));
vi.mock("./PaneQuickSetup.ts", () => ({ paneQuickSetup: vi.fn() }));
vi.mock("./PaneHelp.ts", () => ({ paneHelp: vi.fn() }));
vi.mock("./PaneGeneral.ts", () => ({ paneGeneral: vi.fn() }));
vi.mock("./PaneRemoteConfig.ts", () => ({ paneRemoteConfig: vi.fn() }));
vi.mock("./PaneSelector.ts", () => ({ paneSelector: vi.fn() }));
vi.mock("./PaneSyncSettings.ts", () => ({ paneSyncSettings: vi.fn() }));
vi.mock("./PaneCustomisationSync.ts", () => ({ paneCustomisationSync: vi.fn() }));
vi.mock("./PaneHatch.ts", () => ({ paneHatch: vi.fn() }));
vi.mock("./PaneAdvanced.ts", () => ({ paneAdvanced: vi.fn() }));
vi.mock("./PanePowerUsers.ts", () => ({ panePowerUsers: vi.fn() }));
vi.mock("./PanePatches.ts", () => ({ panePatches: vi.fn() }));
vi.mock("./PaneMaintenance.ts", () => ({ paneMaintenance: vi.fn() }));

import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { $msg } from "@/common/translation";

beforeEach(() => {
    settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockReset();
    loggerMocks.Logger.mockClear();
    vi.mocked($msg).mockClear();
    vi.mocked(compatGlobal.localStorage.getItem).mockReset().mockReturnValue(null);
    vi.mocked(compatGlobal.localStorage.setItem).mockReset();
});

describe("ObsidianLiveSyncSettingTab passphrase verification", () => {
    it("awaits and disposes the owned synchronisation-information resource", async () => {
        const check = vi.fn(async () => true);
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ check, dispose }));
        const plugin = {
            app: {},
            core: {
                services: {
                    replicator: { createRemoteResource },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                remoteType: REMOTE_COUCHDB,
            },
        });

        await expect(tab.checkWorkingPassphrase()).resolves.toBe(true);

        expect(createRemoteResource).toHaveBeenCalledWith(
            REMOTE_RESOURCE_KINDS.SYNCHRONISATION_INFORMATION,
            expect.objectContaining({ remoteType: REMOTE_COUCHDB })
        );
        expect(check).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("does not use the general Replicator factory solely to verify synchronisation information", async () => {
        const getNewReplicator = vi.fn(() => Promise.reject(new Error("must not construct a Replicator")));
        const createRemoteResource = vi.fn(async () => ({
            check: vi.fn(async () => true),
            dispose: vi.fn(async () => undefined),
        }));
        const plugin = {
            app: {},
            core: {
                services: {
                    replicator: { createRemoteResource, getNewReplicator },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                remoteType: REMOTE_COUCHDB,
            },
        });

        await expect(tab.checkWorkingPassphrase()).resolves.toBe(true);

        expect(getNewReplicator).not.toHaveBeenCalled();
    });

    it("reports a CouchDB connection or setup failure with the connection-failure message", async () => {
        const failure = new Error("remote unavailable");
        const check = vi.fn(async () => {
            throw failure;
        });
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ check, dispose }));
        const plugin = {
            app: {},
            core: {
                services: {
                    replicator: { createRemoteResource },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                remoteType: REMOTE_COUCHDB,
            },
        });

        await expect(tab.checkWorkingPassphrase()).resolves.toBe(false);

        expect(vi.mocked($msg)).toHaveBeenCalledWith("obsidianLiveSyncSettingTab.logCheckPassphraseFailed", {
            db: failure.message,
        });
        expect(vi.mocked($msg)).not.toHaveBeenCalledWith("obsidianLiveSyncSettingTab.logPassphraseNotCompatible");
        expect(loggerMocks.Logger).toHaveBeenCalledWith(expect.any(String), LOG_LEVEL_NOTICE);
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("reports an actual synchronisation-information mismatch with the incompatibility message", async () => {
        const check = vi.fn(async () => false);
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ check, dispose }));
        const plugin = {
            app: {},
            core: {
                services: {
                    replicator: { createRemoteResource },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                remoteType: REMOTE_COUCHDB,
            },
        });

        await expect(tab.checkWorkingPassphrase()).resolves.toBe(false);

        expect(vi.mocked($msg)).toHaveBeenCalledWith("obsidianLiveSyncSettingTab.logPassphraseNotCompatible");
        expect(vi.mocked($msg)).not.toHaveBeenCalledWith(
            "obsidianLiveSyncSettingTab.logCheckPassphraseFailed",
            expect.anything()
        );
        expect(loggerMocks.Logger).toHaveBeenCalledWith(expect.any(String), LOG_LEVEL_NOTICE);
        expect(dispose).toHaveBeenCalledOnce();
    });
});

describe("ObsidianLiveSyncSettingTab connection testing", () => {
    it("uses and disposes the flow-specific connection probe without borrowing a Replicator", async () => {
        const check = vi.fn(async () => ({ ok: true as const }));
        const getStatus = vi.fn(async () => ({ estimatedSize: 1024 }));
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ check, getStatus, dispose }));
        const getNewReplicator = vi.fn(() => Promise.reject(new Error("must not borrow a Replicator")));
        const plugin = {
            app: {},
            core: {
                services: {
                    replicator: { createRemoteResource, getNewReplicator },
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                remoteType: REMOTE_COUCHDB,
                couchDB_DBNAME: "saved",
            },
        });

        await expect(tab.testConnection({ couchDB_DBNAME: "trial" })).resolves.toBeUndefined();

        expect(createRemoteResource).toHaveBeenCalledWith(
            REMOTE_RESOURCE_KINDS.CONNECTION,
            expect.objectContaining({ remoteType: REMOTE_COUCHDB, couchDB_DBNAME: "trial" })
        );
        expect(check).toHaveBeenCalledWith({ createIfMissing: true, showResult: true });
        expect(getStatus).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
        expect(getNewReplicator).not.toHaveBeenCalled();
    });
});

describe("ObsidianLiveSyncSettingTab Fresh Start Wipe", () => {
    it("returns the remote wipe result and disposes its temporary Journal client", async () => {
        const resetBucket = vi.fn(async () => false);
        const dispose = vi.fn();
        const tab = new ObsidianLiveSyncSettingTab(
            {} as never,
            {
                app: {},
                core: {},
            } as never
        );
        vi.spyOn(tab, "getMinioJournalSyncClient").mockReturnValue({ resetBucket, dispose } as never);

        await expect(tab.resetRemoteBucket()).resolves.toBe(false);

        expect(resetBucket).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });
});

describe("ObsidianLiveSyncSettingTab pending-setting initialisation", () => {
    function createSettingsTab() {
        const saveSettingData = vi.fn(async () => undefined);
        const suspendAllSync = vi.fn(async () => undefined);
        const suspendExtraSync = vi.fn(async () => undefined);
        const performRebuildDB = vi.fn(async () => undefined);
        const confirmWithMessage = vi.fn();
        const plugin = {
            app: {},
            core: {
                settings: {
                    ...DEFAULT_SETTINGS,
                    handleFilenameCaseSensitive: false,
                },
                getModule: vi.fn(() => settingsInitialisationMocks),
                confirm: {
                    confirmWithMessage,
                },
                services: {
                    setting: {
                        saveSettingData,
                        getDeviceAndVaultName: vi.fn(() => ""),
                        suspendAllSync,
                        suspendExtraSync,
                    },
                },
                rebuilder: {
                    $performRebuildDB: performRebuildDB,
                },
            },
        };
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                handleFilenameCaseSensitive: true,
            },
            initialSettings: {
                ...DEFAULT_SETTINGS,
                handleFilenameCaseSensitive: false,
            },
        });
        vi.spyOn(tab, "isPassphraseValid").mockResolvedValue(true);
        vi.spyOn(tab, "checkWorkingPassphrase").mockResolvedValue(true);
        const closeSetting = vi.spyOn(tab, "closeSetting").mockImplementation(() => undefined);
        return {
            tab,
            saveSettingData,
            suspendAllSync,
            suspendExtraSync,
            performRebuildDB,
            confirmWithMessage,
            closeSetting,
        };
    }

    it("requires local and remote rebuilds when path identity changes", () => {
        const { tab } = createSettingsTab();
        const initialSettings = tab.initialSettings!;
        initialSettings.handleFilenameCaseSensitive = false;
        tab.editingSettings.handleFilenameCaseSensitive = false;
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);

        expect(tab.isNeedRebuildLocal()).toBe(true);
        expect(tab.isNeedRebuildRemote()).toBe(true);
    });

    it("does not offer settings-only fallback when path identity changes", async () => {
        const { tab, saveSettingData, confirmWithMessage } = createSettingsTab();
        const initialSettings = tab.initialSettings!;
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockResolvedValueOnce({
            result: "cancelled",
        });

        await tab.confirmRebuild();

        expect(confirmWithMessage).not.toHaveBeenCalled();
        expect(saveSettingData).not.toHaveBeenCalled();
        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(Reflect.get(initialSettings, "pathNormalizationVersion")).toBe(0);
        expect(tab.isDirty("pathNormalizationVersion")).toBe(true);
    });

    it.each([
        ["regular-expression Apply", "syncOnlyRegEx", "notes/.*"],
        ["preset Apply", "preset", "LIVESYNC"],
    ] as const)("keeps path identity pending during %s", async (_label, setting, value) => {
        const { tab } = createSettingsTab();
        const initialSettings = tab.initialSettings!;
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);
        Reflect.set(tab.editingSettings, setting, value);
        if (setting === "preset") {
            tab.addOnSaved("preset", async () => {
                tab.editingSettings.liveSync = true;
                await tab.saveAllDirtySettings();
            });
        }

        await tab.saveAllDirtySettings();

        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.initialSettings!, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(tab.isDirty("pathNormalizationVersion")).toBe(true);
        if (setting === "syncOnlyRegEx") {
            expect(tab.core.settings.syncOnlyRegEx).toBe(value);
        } else {
            expect(tab.core.settings.liveSync).toBe(true);
        }
    });

    it("excludes path identity from direct save operations", async () => {
        const { tab, saveSettingData } = createSettingsTab();
        const initialSettings = tab.initialSettings!;
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);

        await tab.saveSettings(["pathNormalizationVersion"]);

        expect(saveSettingData).not.toHaveBeenCalled();
        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.initialSettings!, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(tab.isDirty("pathNormalizationVersion")).toBe(true);
    });

    it("excludes path identity from ordinary Apply operations", async () => {
        const { tab, saveSettingData } = createSettingsTab();
        const initialSettings = tab.initialSettings!;
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);

        await tab.applyAllSettings();

        expect(saveSettingData).not.toHaveBeenCalled();
        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.initialSettings!, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(tab.isDirty("pathNormalizationVersion")).toBe(true);
    });

    it("retains a pending path identity edit and its applied baseline after reload", () => {
        const { tab } = createSettingsTab();
        const initialSettings = tab.initialSettings!;
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);

        tab.reloadAllSettings();

        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.initialSettings!, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(tab.isDirty("pathNormalizationVersion")).toBe(true);
        expect(tab.isNeedRebuildLocal()).toBe(true);
        expect(tab.isNeedRebuildRemote()).toBe(true);
    });

    it("keeps pending settings in the editing buffer when initialisation and the fallback are cancelled", async () => {
        const { tab, saveSettingData, confirmWithMessage, closeSetting } = createSettingsTab();
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockResolvedValueOnce({
            result: "cancelled",
        });
        confirmWithMessage.mockResolvedValueOnce("Keep Editing");

        await tab.confirmRebuild();

        expect(settingsInitialisationMocks.applySettingsWithInitialisationChoice).toHaveBeenCalledOnce();
        expect(confirmWithMessage).toHaveBeenCalledWith(
            "Apply Settings without Initialisation?",
            expect.any(String),
            ["Apply without Initialisation", "Keep Editing"],
            "Keep Editing"
        );
        expect(saveSettingData).not.toHaveBeenCalled();
        expect(tab.editingSettings.handleFilenameCaseSensitive).toBe(true);
        expect(tab.core.settings.handleFilenameCaseSensitive).toBe(false);
        expect(closeSetting).not.toHaveBeenCalled();
    });

    it("applies pending settings only after a separately confirmed initialisation bypass", async () => {
        const { tab, saveSettingData, confirmWithMessage, closeSetting } = createSettingsTab();
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockResolvedValueOnce({
            result: "cancelled",
        });
        confirmWithMessage.mockResolvedValueOnce("Apply without Initialisation");

        await tab.confirmRebuild();

        expect(settingsInitialisationMocks.applySettingsWithInitialisationChoice).toHaveBeenCalledOnce();
        expect(saveSettingData).toHaveBeenCalledOnce();
        expect(tab.core.settings.handleFilenameCaseSensitive).toBe(true);
        expect(closeSetting).not.toHaveBeenCalled();
    });

    it("applies path identity only from a successful initialisation reservation callback", async () => {
        const { tab, saveSettingData, confirmWithMessage, closeSetting } = createSettingsTab();
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(tab.initialSettings!, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockImplementationOnce(
            async ({ applySettings }: { applySettings: () => Promise<void> }) => {
                await applySettings();
                return { result: "scheduled", mode: "rebuild" };
            }
        );

        await tab.confirmRebuild();

        expect(saveSettingData).toHaveBeenCalledTimes(2);
        expect(confirmWithMessage).not.toHaveBeenCalled();
        expect(closeSetting).toHaveBeenCalledOnce();
        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(1);
        expect(Reflect.get(tab.initialSettings!, "pathNormalizationVersion")).toBe(1);
        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(tab.isDirty("pathNormalizationVersion")).toBe(false);
    });

    it("rolls path identity back and keeps it pending when saving after reservation fails", async () => {
        const { tab, saveSettingData, closeSetting } = createSettingsTab();
        const initialSettings = tab.initialSettings!;
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);
        tab.editingSettings.handleFilenameCaseSensitive = false;
        const failure = new Error("settings could not be saved");
        saveSettingData.mockRejectedValueOnce(failure);
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockImplementationOnce(
            async ({ applySettings }: { applySettings: () => Promise<void> }) => {
                await applySettings();
                return { result: "scheduled", mode: "rebuild" };
            }
        );

        await expect(tab.confirmRebuild()).rejects.toBe(failure);

        expect(saveSettingData).toHaveBeenCalledOnce();
        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.initialSettings!, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(tab.isDirty("pathNormalizationVersion")).toBe(true);
        expect(closeSetting).not.toHaveBeenCalled();
    });

    it("retains pending path identity when fetch validation fails", async () => {
        const { tab } = createSettingsTab();
        const initialSettings = tab.initialSettings!;
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);
        vi.spyOn(tab, "checkWorkingPassphrase").mockResolvedValue(false);
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockImplementationOnce(
            async ({ validateChoice }: { validateChoice: (mode: "fetch" | "rebuild") => Promise<boolean> }) => {
                expect(await validateChoice("fetch")).toBe(false);
                return { result: "failed", mode: "fetch" };
            }
        );

        await tab.confirmRebuild();

        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.initialSettings!, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(tab.isDirty("pathNormalizationVersion")).toBe(true);
        expect(tab.closeSetting).not.toHaveBeenCalled();
    });

    it("retains pending path identity when initialisation reservation fails", async () => {
        const { tab, saveSettingData } = createSettingsTab();
        const initialSettings = tab.initialSettings!;
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockResolvedValueOnce({
            result: "failed",
            mode: "rebuild",
        });

        await tab.confirmRebuild();

        expect(saveSettingData).not.toHaveBeenCalled();
        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.initialSettings!, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(tab.isDirty("pathNormalizationVersion")).toBe(true);
        expect(tab.closeSetting).not.toHaveBeenCalled();
    });

    it("refuses remote-only overwrite with pending path identity before side effects", async () => {
        const { tab, saveSettingData, suspendAllSync, suspendExtraSync, performRebuildDB, closeSetting } =
            createSettingsTab();
        const initialSettings = tab.initialSettings!;
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 1);
        tab.editingSettings.encrypt = false;
        const applyAllSettings = vi.spyOn(tab, "applyAllSettings");
        const reloadAllSettings = vi.spyOn(tab, "reloadAllSettings");

        await tab.rebuildDB("remoteOnly");

        expect(applyAllSettings).not.toHaveBeenCalled();
        expect(suspendAllSync).not.toHaveBeenCalled();
        expect(suspendExtraSync).not.toHaveBeenCalled();
        expect(reloadAllSettings).not.toHaveBeenCalled();
        expect(saveSettingData).not.toHaveBeenCalled();
        expect(performRebuildDB).not.toHaveBeenCalled();
        expect(closeSetting).not.toHaveBeenCalled();
        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.initialSettings!, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(tab.isDirty("pathNormalizationVersion")).toBe(true);
        expect(vi.mocked($msg)).toHaveBeenCalledWith(
            "CouchDB only. Version 0 preserves legacy path identity; version 1 uses Unicode NFC. Physical file names stay unchanged. Update every device and stop synchronisation, then Rebuild both databases from a complete authoritative Vault and Fetch on the other devices. Resolve colliding file names first. P2P and Object Storage do not support version 1."
        );
        expect(loggerMocks.Logger).toHaveBeenCalledWith(
            expect.stringContaining(
                "Rebuild both databases from a complete authoritative Vault and Fetch on the other devices."
            ),
            LOG_LEVEL_NOTICE
        );
    });

    it("does not offer the settings-only fallback after an initialisation failure", async () => {
        const { tab, saveSettingData, confirmWithMessage, closeSetting } = createSettingsTab();
        settingsInitialisationMocks.applySettingsWithInitialisationChoice.mockResolvedValueOnce({
            result: "failed",
            mode: "fetch",
        });

        await tab.confirmRebuild();

        expect(saveSettingData).not.toHaveBeenCalled();
        expect(confirmWithMessage).not.toHaveBeenCalled();
        expect(tab.editingSettings.handleFilenameCaseSensitive).toBe(true);
        expect(tab.core.settings.handleFilenameCaseSensitive).toBe(false);
        expect(closeSetting).not.toHaveBeenCalled();
    });

    it("does not apply unrelated settings or start a rebuild when configuration encryption fails", async () => {
        const { tab, saveSettingData, suspendAllSync, suspendExtraSync, performRebuildDB, closeSetting } =
            createSettingsTab();
        const failure = new Error("configuration encryption could not be saved");
        const changeConfigurationEncryption = vi.fn(async () => {
            throw failure;
        });
        Object.assign(tab.core.services.setting, { changeConfigurationEncryption });
        const savedStore = "LOCALSTORAGE";
        const editedStore = "ASK_AT_LAUNCH";
        tab.core.settings.encrypt = false;
        tab.core.settings.configPassphraseStore = savedStore;
        tab.initialSettings!.configPassphraseStore = savedStore;
        tab.editingSettings.configPassphraseStore = editedStore;
        tab.initialSettings!.configPassphrase = "old custom passphrase";
        tab.editingSettings.configPassphrase = "new custom passphrase";
        tab.editingSettings.handleFilenameCaseSensitive = true;
        const applySetting = vi.spyOn(tab, "applySetting");
        const reloadAllSettings = vi.spyOn(tab, "reloadAllSettings");
        const saveAllDirtySettings = vi.spyOn(tab, "saveAllDirtySettings");

        await expect(tab.rebuildDB("localOnly")).rejects.toBe(failure);

        expect(changeConfigurationEncryption).toHaveBeenCalledOnce();
        expect(changeConfigurationEncryption).toHaveBeenCalledWith(editedStore, "new custom passphrase");
        expect(applySetting).not.toHaveBeenCalled();
        expect(tab.core.settings.handleFilenameCaseSensitive).toBe(false);
        expect(tab.initialSettings!.handleFilenameCaseSensitive).toBe(false);
        expect(tab.editingSettings.handleFilenameCaseSensitive).toBe(true);
        expect(tab.core.settings.configPassphraseStore).toBe(savedStore);
        expect(tab.initialSettings!.configPassphraseStore).toBe(savedStore);
        expect(tab.initialSettings!.configPassphrase).toBe("old custom passphrase");
        expect(tab.editingSettings.configPassphraseStore).toBe(editedStore);
        expect(tab.editingSettings.configPassphrase).toBe("new custom passphrase");
        expect(suspendAllSync).not.toHaveBeenCalled();
        expect(suspendExtraSync).not.toHaveBeenCalled();
        expect(reloadAllSettings).not.toHaveBeenCalled();
        expect(saveAllDirtySettings).not.toHaveBeenCalled();
        expect(saveSettingData).not.toHaveBeenCalled();
        expect(closeSetting).not.toHaveBeenCalled();
        expect(performRebuildDB).not.toHaveBeenCalled();
    });
});

describe("ObsidianLiveSyncSettingTab declarative settings boundary", () => {
    function createSettingsTab() {
        const saveSettingData = vi.fn(async () => undefined);
        const plugin = {
            app: {},
            core: {
                settings: {
                    ...DEFAULT_SETTINGS,
                    hashCacheMaxCount: 300,
                    displayLanguage: "",
                },
                services: {
                    setting: {
                        saveSettingData,
                        getDeviceAndVaultName: vi.fn(() => ""),
                    },
                },
            },
        };
        Object.defineProperty(plugin, "settings", {
            get: () => {
                throw new Error("The declarative adapter must not use plugin.settings");
            },
        });
        const tab = new ObsidianLiveSyncSettingTab({} as never, plugin as never);
        Object.assign(tab, {
            _editingSettings: {
                ...DEFAULT_SETTINGS,
                hashCacheMaxCount: 300,
                displayLanguage: "",
            },
            initialSettings: {
                ...DEFAULT_SETTINGS,
                hashCacheMaxCount: 300,
                displayLanguage: "",
            },
        });
        return { tab, saveSettingData };
    }

    it("loads the imperative fallback without a SettingPage runtime export", () => {
        const { tab } = createSettingsTab();

        expect(tab.display).toBeTypeOf("function");
        expect(tab.getSettingDefinitions()).toEqual([]);
    });

    it("reads and writes registered controls through the editing buffer and existing save owner", async () => {
        const { tab } = createSettingsTab();
        const saveSettings = vi.spyOn(tab, "saveSettings").mockResolvedValue(undefined);

        expect(tab.getControlValue("hashCacheMaxCount")).toBe(300);

        await tab.setControlValue("hashCacheMaxCount", 321);

        expect(tab.editingSettings.hashCacheMaxCount).toBe(321);
        expect(saveSettings).toHaveBeenCalledOnce();
        expect(saveSettings).toHaveBeenCalledWith(["hashCacheMaxCount"]);
    });

    it("keeps a path identity dropdown edit pending until the rebuild flow applies it", async () => {
        const { tab, saveSettingData } = createSettingsTab();
        const initialSettings = tab.initialSettings!;
        const saveSettings = vi.spyOn(tab, "saveSettings");
        vi.spyOn(tab, "requestUpdate").mockImplementation(() => undefined);
        Reflect.set(tab.core.settings, "pathNormalizationVersion", 0);
        Reflect.set(tab.editingSettings, "pathNormalizationVersion", 0);
        Reflect.set(initialSettings, "pathNormalizationVersion", 0);

        expect(tab.getControlValue("pathNormalizationVersion")).toBe("0");

        await tab.setControlValue("pathNormalizationVersion", "1");

        expect(Reflect.get(tab.editingSettings, "pathNormalizationVersion")).toBe(1);
        expect(tab.getControlValue("pathNormalizationVersion")).toBe("1");
        expect(Reflect.get(tab.core.settings, "pathNormalizationVersion")).toBe(0);
        expect(Reflect.get(initialSettings, "pathNormalizationVersion")).toBe(0);
        expect(saveSettings).not.toHaveBeenCalled();
        expect(tab.requestUpdate).toHaveBeenCalledOnce();
        expect(saveSettingData).not.toHaveBeenCalled();
        expect(tab.isNeedRebuildLocal()).toBe(true);
        expect(tab.isNeedRebuildRemote()).toBe(true);
        await expect(tab.setControlValue("pathNormalizationVersion", "0.5")).rejects.toThrow(
            /Invalid value for declarative setting/u
        );
    });

    it("rejects unregistered declarative control keys", async () => {
        const { tab } = createSettingsTab();

        expect(() => tab.getControlValue("couchDB_PASSWORD")).toThrow(/Unknown declarative setting key/u);
        await expect(tab.setControlValue("couchDB_PASSWORD", "secret")).rejects.toThrow(
            /Unknown declarative setting key/u
        );
    });

    it("rejects declarative values outside the registered control contract", async () => {
        const { tab } = createSettingsTab();
        const saveSettings = vi.spyOn(tab, "saveSettings").mockResolvedValue(undefined);

        await expect(tab.setControlValue("hashCacheMaxCount", 9)).rejects.toThrow(
            /Invalid value for declarative setting/u
        );
        await expect(tab.setControlValue("chunkSplitterVersion", "unknown-splitter")).rejects.toThrow(
            /Invalid value for declarative setting/u
        );

        expect(saveSettings).not.toHaveBeenCalled();
    });

    it("replaces a saved-setting handler when a page is rendered again", async () => {
        const { tab } = createSettingsTab();
        const first = vi.fn();
        const replacement = vi.fn();
        tab.addOnSaved("displayLanguage", first);
        tab.addOnSaved("displayLanguage", replacement);
        tab.editingSettings.displayLanguage = "ja";

        await tab.saveSettings(["displayLanguage"]);

        expect(first).not.toHaveBeenCalled();
        expect(replacement).toHaveBeenCalledOnce();
    });

    it("saves a custom configuration passphrase edit through the setting service", async () => {
        const { tab } = createSettingsTab();
        const changeConfigurationEncryption = vi.fn(async () => {
            vi.mocked(compatGlobal.localStorage.getItem).mockReturnValue("new custom passphrase");
        });
        Object.assign(tab.core.services.setting, { changeConfigurationEncryption });
        const store = "LOCALSTORAGE";
        tab.editingSettings.configPassphraseStore = store;
        tab.initialSettings!.configPassphraseStore = store;
        tab.editingSettings.configPassphrase = "new custom passphrase";
        tab.initialSettings!.configPassphrase = "old custom passphrase";
        vi.mocked(compatGlobal.localStorage.setItem).mockClear();

        await tab.saveSettings(["configPassphrase"]);

        expect(changeConfigurationEncryption).toHaveBeenCalledOnce();
        expect(changeConfigurationEncryption).toHaveBeenCalledWith(store, "new custom passphrase");
        expect(compatGlobal.localStorage.setItem).not.toHaveBeenCalled();
        expect(tab.initialSettings!.configPassphrase).toBe("new custom passphrase");
    });

    it("keeps a later passphrase edit dirty while an earlier Apply is pending", async () => {
        const { tab } = createSettingsTab();
        let resolveApply!: () => void;
        const changeConfigurationEncryption = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveApply = resolve;
                })
        );
        Object.assign(tab.core.services.setting, { changeConfigurationEncryption });
        tab.editingSettings.configPassphraseStore = "LOCALSTORAGE";
        tab.initialSettings!.configPassphraseStore = "LOCALSTORAGE";
        tab.initialSettings!.configPassphrase = "previous passphrase";
        tab.editingSettings.configPassphrase = "passphrase A";
        vi.mocked(compatGlobal.localStorage.getItem).mockReturnValue("passphrase A");

        const apply = tab.saveSettings(["configPassphrase"]);
        expect(changeConfigurationEncryption).toHaveBeenCalledWith("LOCALSTORAGE", "passphrase A");

        tab.editingSettings.configPassphrase = "passphrase B";
        resolveApply();
        await apply;
        tab.reloadAllSettings();

        expect(tab.initialSettings!.configPassphrase).toBe("passphrase A");
        expect(tab.editingSettings.configPassphrase).toBe("passphrase B");
        expect(tab.isDirty("configPassphrase")).toBe(true);
    });

    it("keeps both configuration encryption edits pending when applying them fails", async () => {
        const { tab } = createSettingsTab();
        const failure = new Error("configuration encryption could not be saved");
        const changeConfigurationEncryption = vi.fn(async () => {
            throw failure;
        });
        Object.assign(tab.core.services.setting, { changeConfigurationEncryption });
        const savedStore = "LOCALSTORAGE";
        const editedStore = "ASK_AT_LAUNCH";
        tab.core.settings.configPassphraseStore = savedStore;
        tab.initialSettings!.configPassphraseStore = savedStore;
        tab.editingSettings.configPassphraseStore = editedStore;
        tab.initialSettings!.configPassphrase = "old custom passphrase";
        tab.editingSettings.configPassphrase = "new custom passphrase";
        vi.mocked(compatGlobal.localStorage.setItem).mockClear();

        await expect(tab.saveSettings(["configPassphraseStore", "configPassphrase"])).rejects.toBe(failure);

        expect(changeConfigurationEncryption).toHaveBeenCalledOnce();
        expect(changeConfigurationEncryption).toHaveBeenCalledWith(editedStore, "new custom passphrase");
        expect(compatGlobal.localStorage.setItem).not.toHaveBeenCalled();
        expect(tab.core.settings.configPassphraseStore).toBe(savedStore);
        expect(tab.initialSettings!.configPassphraseStore).toBe(savedStore);
        expect(tab.initialSettings!.configPassphrase).toBe("old custom passphrase");
        expect(tab.editingSettings.configPassphraseStore).toBe(editedStore);
        expect(tab.editingSettings.configPassphrase).toBe("new custom passphrase");
    });
});
