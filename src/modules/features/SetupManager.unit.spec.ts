import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_SETTINGS,
    REMOTE_COUCHDB,
    REMOTE_P2P,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { SettingService } from "@vrtmrz/livesync-commonlib/compat/services/base/SettingService";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";

vi.mock("./SetupWizard/dialogs/Intro.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/SelectMethodNewUser.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/SelectMethodExisting.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/ScanQRCode.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/UseSetupURI.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/OutroNewUser.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/OutroExistingUser.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/OutroAskUserMode.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/SetupRemote.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/SetupRemoteCouchDB.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/SetupRemoteBucket.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/SetupRemoteP2P.svelte", () => ({ default: {} }));
vi.mock("./SetupWizard/dialogs/SetupRemoteE2EE.svelte", () => ({ default: {} }));

vi.mock("@vrtmrz/livesync-commonlib/compat/API/processSetting", () => ({
    decodeSettingsFromQRCodeData: vi.fn(),
}));

import { decodeSettingsFromQRCodeData } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
import { SetupManager, UserMode } from "./SetupManager";

class TestSettingService extends SettingService<ServiceContext> {
    protected setItem(_key: string, _value: string): void {}
    protected getItem(_key: string): string {
        return "";
    }
    protected deleteItem(_key: string): void {}
    protected saveData(_setting: ObsidianLiveSyncSettings): Promise<void> {
        return Promise.resolve();
    }
    protected loadData(): Promise<ObsidianLiveSyncSettings | undefined> {
        return Promise.resolve(undefined);
    }
}

function createLegacyRemoteSetting(): ObsidianLiveSyncSettings {
    return {
        ...DEFAULT_SETTINGS,
        remoteConfigurations: {},
        activeConfigurationId: "",
        remoteType: REMOTE_COUCHDB,
        couchDB_URI: "http://localhost:5984",
        couchDB_USER: "user",
        couchDB_PASSWORD: "password",
        couchDB_DBNAME: "vault",
    };
}

function createSetupManager() {
    const setting = new TestSettingService(new ServiceContext(), {
        APIService: {
            getSystemVaultName: vi.fn(() => "vault"),
            getAppID: vi.fn(() => "app"),
            confirm: {
                askString: vi.fn(() => Promise.resolve("")),
            },
            addLog: vi.fn(),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        } as any,
    });
    setting.settings = {
        ...DEFAULT_SETTINGS,
        remoteConfigurations: {},
        activeConfigurationId: "",
    };
    vi.spyOn(setting, "saveSettingData").mockResolvedValue();

    const dialogManager = {
        openWithExplicitCancel: vi.fn(),
        open: vi.fn(),
    };
    const services = {
        API: {
            addLog: vi.fn(),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        },
        UI: {
            dialogManager,
        },
        setting,
    } as any;
    const core: any = {
        _services: services,
        rebuilder: {
            scheduleRebuild: vi.fn(async (prepareBeforeRestart?: () => Promise<void>) => {
                await prepareBeforeRestart?.();
                return true;
            }),
            scheduleFetch: vi.fn(async (prepareBeforeRestart?: () => Promise<void>) => {
                await prepareBeforeRestart?.();
                return true;
            }),
        },
    };
    Object.defineProperty(core, "services", {
        get() {
            return services;
        },
    });
    Object.defineProperty(core, "settings", {
        get() {
            return setting.settings;
        },
        set(value: ObsidianLiveSyncSettings) {
            setting.settings = value;
        },
    });

    return {
        manager: new SetupManager(core),
        setting,
        dialogManager,
        core,
    };
}

describe("SetupManager", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    it("starts manual new-user setup from the recommended new-Vault settings", async () => {
        const { manager, dialogManager } = createSetupManager();
        dialogManager.openWithExplicitCancel.mockResolvedValueOnce("configure-manually");
        const configureManually = vi.spyOn(manager, "onConfigureManually").mockResolvedValue(true);

        await manager.onOnboard(UserMode.NewUser);

        expect(configureManually).toHaveBeenCalledWith(createNewVaultSettings(), UserMode.NewUser);
    });

    it("onUseSetupURI should normalise imported legacy remote settings before applying", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce(createLegacyRemoteSetting())
            .mockResolvedValueOnce("compatible-existing-user");

        const result = await manager.onUseSetupURI(UserMode.Unknown, "mock-config://settings");

        expect(result).toBe(true);
        expect(setting.currentSettings().remoteConfigurations["legacy-couchdb"]?.uri).toContain(
            "sls+http://user:password@localhost:5984"
        );
        expect(setting.currentSettings().activeConfigurationId).toBe("legacy-couchdb");
    });

    it("decodeQR should normalise imported legacy remote settings before applying", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        vi.mocked(decodeSettingsFromQRCodeData).mockReturnValue(createLegacyRemoteSetting());
        dialogManager.openWithExplicitCancel.mockResolvedValueOnce("compatible-existing-user");

        const result = await manager.decodeQR("qr-data");

        expect(result).toBe(true);
        expect(decodeSettingsFromQRCodeData).toHaveBeenCalledWith("qr-data");
        expect(setting.currentSettings().remoteConfigurations["legacy-couchdb"]?.uri).toContain(
            "sls+http://user:password@localhost:5984"
        );
        expect(setting.currentSettings().activeConfigurationId).toBe("legacy-couchdb");
    });

    it("reserves Rebuild before saving a new-user configuration", async () => {
        const { manager, setting, dialogManager, core } = createSetupManager();
        setting.settings = { ...setting.currentSettings(), isConfigured: false };
        const applyExternalSettings = vi.spyOn(setting, "applyExternalSettings");
        dialogManager.openWithExplicitCancel.mockResolvedValueOnce(true);

        await manager.onConfirmApplySettingsFromWizard(
            { ...createLegacyRemoteSetting(), isConfigured: true },
            UserMode.NewUser
        );

        expect(core.rebuilder.scheduleRebuild).toHaveBeenCalledWith(expect.any(Function));
        expect(core.rebuilder.scheduleRebuild.mock.invocationCallOrder[0]).toBeLessThan(
            applyExternalSettings.mock.invocationCallOrder[0]
        );
        expect(setting.currentSettings().isConfigured).toBe(true);
    });

    it("identifies P2P when opening the new-user initialisation confirmation", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        setting.settings = { ...setting.currentSettings(), isConfigured: false };
        dialogManager.openWithExplicitCancel.mockResolvedValueOnce(true);
        const p2pProfileId = "p2p-profile";

        await manager.onConfirmApplySettingsFromWizard(
            {
                ...setting.currentSettings(),
                isConfigured: true,
                // Imported profile settings can still carry the previous compatibility field
                // until the selected profile is projected by the setting lifecycle.
                remoteType: REMOTE_COUCHDB,
                activeConfigurationId: p2pProfileId,
                remoteConfigurations: {
                    [p2pProfileId]: {
                        id: p2pProfileId,
                        name: "P2P room",
                        uri: "sls+p2p://:secret@team-room?relays=wss%3A%2F%2Frelay.example",
                        isEncrypted: false,
                    },
                },
            },
            UserMode.NewUser
        );

        expect(dialogManager.openWithExplicitCancel).toHaveBeenCalledWith(expect.anything(), {
            isP2P: true,
        });
    });

    it("reserves Fetch when compatible imported settings activate an unconfigured device", async () => {
        const { manager, setting, dialogManager, core } = createSetupManager();
        setting.settings = { ...setting.currentSettings(), isConfigured: false };
        const applyExternalSettings = vi.spyOn(setting, "applyExternalSettings");
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce({ ...createLegacyRemoteSetting(), isConfigured: true })
            .mockResolvedValueOnce("compatible-existing-user");

        await manager.onUseSetupURI(UserMode.Unknown, "mock-config://settings");

        expect(core.rebuilder.scheduleFetch).toHaveBeenCalledWith(expect.any(Function));
        expect(core.rebuilder.scheduleFetch.mock.invocationCallOrder[0]).toBeLessThan(
            applyExternalSettings.mock.invocationCallOrder[0]
        );
        expect(setting.currentSettings().isConfigured).toBe(true);
    });

    it("applies compatible settings to an already configured device without scheduling Fetch", async () => {
        const { manager, setting, dialogManager, core } = createSetupManager();
        setting.settings = { ...setting.currentSettings(), isConfigured: true };
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce({ ...createLegacyRemoteSetting(), isConfigured: true })
            .mockResolvedValueOnce("compatible-existing-user");

        await manager.onUseSetupURI(UserMode.Unknown, "mock-config://settings");

        expect(core.rebuilder.scheduleFetch).not.toHaveBeenCalled();
        expect(setting.currentSettings().isConfigured).toBe(true);
    });

    it("does not enable imported settings when the initialisation flag cannot be reserved", async () => {
        const { manager, setting, dialogManager, core } = createSetupManager();
        setting.settings = { ...setting.currentSettings(), isConfigured: false };
        const applyExternalSettings = vi.spyOn(setting, "applyExternalSettings");
        core.rebuilder.scheduleRebuild.mockResolvedValueOnce(false);
        dialogManager.openWithExplicitCancel.mockResolvedValueOnce(true);

        await manager.onConfirmApplySettingsFromWizard(
            { ...createLegacyRemoteSetting(), isConfigured: true },
            UserMode.NewUser
        );

        expect(core.rebuilder.scheduleRebuild).toHaveBeenCalledWith(expect.any(Function));
        expect(applyExternalSettings).not.toHaveBeenCalled();
        expect(setting.currentSettings().isConfigured).toBe(false);
    });

    it("preserves modern profiles, display names, and the active selection from a Setup URI", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        const imported = {
            ...DEFAULT_SETTINGS,
            remoteConfigurations: {
                couch: {
                    id: "couch",
                    name: "Office CouchDB",
                    uri: "sls+https://alice:secret@couch.example/?db=notes",
                    isEncrypted: false,
                },
                archive: {
                    id: "archive",
                    name: "Archive bucket",
                    uri: "sls+s3://key:secret@storage.example/?endpoint=https%3A%2F%2Fstorage.example&bucket=archive&region=auto",
                    isEncrypted: false,
                },
            },
            activeConfigurationId: "archive",
        } as ObsidianLiveSyncSettings;
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce(imported)
            .mockResolvedValueOnce("compatible-existing-user");

        await manager.onUseSetupURI(UserMode.Unknown, "mock-config://modern-settings");

        const current = setting.currentSettings();
        expect(current.remoteConfigurations).toEqual(imported.remoteConfigurations);
        expect(current.activeConfigurationId).toBe("archive");
        expect(Object.keys(current.remoteConfigurations).some((id) => id.startsWith("legacy-"))).toBe(false);
    });

    it("adds and activates a manually configured CouchDB without replacing existing profiles", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        setting.settings = {
            ...setting.currentSettings(),
            isConfigured: true,
            remoteConfigurations: {
                existing: {
                    id: "existing",
                    name: "Existing remote",
                    uri: "sls+http://old:secret@old.example/?db=old",
                    isEncrypted: false,
                },
            },
            activeConfigurationId: "existing",
        };
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce({
                couchDB_URI: "https://couch.example",
                couchDB_USER: "alice",
                couchDB_PASSWORD: "secret",
                couchDB_DBNAME: "notes",
                couchDB_CustomHeaders: "",
                useJWT: false,
                jwtAlgorithm: "",
                jwtKey: "",
                jwtKid: "",
                jwtSub: "",
                jwtExpDuration: 5,
                useRequestAPI: false,
            })
            .mockResolvedValueOnce(true);

        await manager.onCouchDBManualSetup(UserMode.ExistingUser, setting.currentSettings());

        const current = setting.currentSettings();
        expect(current.remoteConfigurations.existing).toBeDefined();
        expect(Object.keys(current.remoteConfigurations)).toHaveLength(2);
        expect(current.activeConfigurationId).not.toBe("existing");
        const activeProfile = current.remoteConfigurations[current.activeConfigurationId];
        expect(activeProfile?.name).toBe("CouchDB couch.example");
        expect(activeProfile?.uri).toContain("sls+https://alice:secret@couch.example");
    });

    it.each([
        [UserMode.NewUser, "create-or-connect"],
        [UserMode.ExistingUser, "connect-existing"],
        [UserMode.Update, "settings"],
    ] as const)(
        "passes the %s CouchDB database policy to the manual setup dialogue",
        async (userMode, expectedMode) => {
            const { manager, setting, dialogManager } = createSetupManager();
            const couchConf = {
                couchDB_URI: "https://couch.example",
                couchDB_USER: "alice",
                couchDB_PASSWORD: "secret",
                couchDB_DBNAME: "notes",
                couchDB_CustomHeaders: "",
                useJWT: false,
                jwtAlgorithm: "",
                jwtKey: "",
                jwtKid: "",
                jwtSub: "",
                jwtExpDuration: 5,
                useRequestAPI: false,
            };
            dialogManager.openWithExplicitCancel.mockResolvedValueOnce(couchConf).mockResolvedValueOnce("cancelled");

            await manager.onCouchDBManualSetup(userMode, setting.currentSettings());

            expect(dialogManager.openWithExplicitCancel).toHaveBeenNthCalledWith(1, expect.anything(), {
                settings: setting.currentSettings(),
                mode: expectedMode,
            });
        }
    );

    it("adds and activates a manually configured Object Storage profile without replacing existing profiles", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        setting.settings = {
            ...setting.currentSettings(),
            isConfigured: true,
            remoteConfigurations: {
                existing: {
                    id: "existing",
                    name: "Existing remote",
                    uri: "sls+http://old:secret@old.example/?db=old",
                    isEncrypted: false,
                },
            },
            activeConfigurationId: "existing",
        };
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce({
                endpoint: "https://storage.example",
                accessKey: "key",
                secretKey: "secret",
                bucket: "notes",
                region: "auto",
                bucketPrefix: "",
                useCustomRequestHandler: false,
                bucketCustomHeaders: "",
                forcePathStyle: true,
            })
            .mockResolvedValueOnce(true);

        await manager.onBucketManualSetup(UserMode.ExistingUser, setting.currentSettings());

        const current = setting.currentSettings();
        expect(current.remoteConfigurations.existing).toBeDefined();
        expect(Object.keys(current.remoteConfigurations)).toHaveLength(2);
        expect(current.activeConfigurationId).not.toBe("existing");
        const activeProfile = current.remoteConfigurations[current.activeConfigurationId];
        expect(activeProfile?.name).toBe("S3 notes");
        expect(activeProfile?.uri).toContain("sls+s3://key:secret@storage.example");
    });

    it("creates and selects a P2P profile during fresh manual onboarding", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        setting.settings = {
            ...setting.currentSettings(),
            isConfigured: false,
            remoteConfigurations: {},
            activeConfigurationId: "",
            P2P_ActiveRemoteConfigurationId: "",
        };
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce({
                P2P_Enabled: true,
                P2P_roomID: "team-room",
                P2P_passphrase: "secret",
                P2P_relays: "wss://relay.example",
                P2P_AppID: "self-hosted-livesync",
                P2P_AutoStart: true,
                P2P_AutoBroadcast: false,
                P2P_turnServers: "",
                P2P_turnUsername: "",
                P2P_turnCredential: "",
            })
            .mockResolvedValueOnce(true);

        await manager.onP2PManualSetup(UserMode.NewUser, setting.currentSettings());

        const current = setting.currentSettings();
        expect(Object.keys(current.remoteConfigurations)).toHaveLength(1);
        expect(current.activeConfigurationId).not.toBe("");
        expect(current.P2P_ActiveRemoteConfigurationId).toBe(current.activeConfigurationId);
        const activeProfile = current.remoteConfigurations[current.activeConfigurationId];
        expect(activeProfile?.name).toBe("P2P team-room");
        expect(activeProfile?.uri).toContain("sls+p2p://");
    });

    it("selects a configured P2P profile without replacing the active main remote", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        setting.settings = {
            ...setting.currentSettings(),
            isConfigured: true,
            remoteConfigurations: {
                main: {
                    id: "main",
                    name: "Main CouchDB",
                    uri: "sls+http://old:secret@old.example/?db=old",
                    isEncrypted: false,
                },
            },
            activeConfigurationId: "main",
            P2P_ActiveRemoteConfigurationId: "",
        };
        dialogManager.openWithExplicitCancel.mockResolvedValueOnce({
            P2P_Enabled: true,
            P2P_roomID: "team-room",
            P2P_passphrase: "secret",
            P2P_relays: "wss://relay.example",
            P2P_AppID: "self-hosted-livesync",
            P2P_AutoStart: true,
            P2P_AutoBroadcast: false,
            P2P_turnServers: "",
            P2P_turnUsername: "",
            P2P_turnCredential: "",
        });

        await manager.onP2PManualSetup(UserMode.Unknown, setting.currentSettings(), false);

        const current = setting.currentSettings();
        expect(Object.keys(current.remoteConfigurations)).toHaveLength(2);
        expect(current.activeConfigurationId).toBe("main");
        expect(current.P2P_ActiveRemoteConfigurationId).not.toBe("");
        expect(current.P2P_ActiveRemoteConfigurationId).not.toBe("main");
        expect(current.remoteConfigurations[current.P2P_ActiveRemoteConfigurationId]?.name).toBe("P2P team-room");
    });

    it("does not register Object Storage when final confirmation is cancelled", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        setting.settings = {
            ...setting.currentSettings(),
            isConfigured: true,
            remoteConfigurations: {
                existing: {
                    id: "existing",
                    name: "Existing remote",
                    uri: "sls+http://old:secret@old.example/?db=old",
                    isEncrypted: false,
                },
            },
            activeConfigurationId: "existing",
        };
        const before = structuredClone(setting.currentSettings().remoteConfigurations);
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce({
                endpoint: "https://storage.example",
                accessKey: "key",
                secretKey: "secret",
                bucket: "notes",
                region: "auto",
                bucketPrefix: "",
                useCustomRequestHandler: false,
                bucketCustomHeaders: "",
                forcePathStyle: true,
            })
            .mockResolvedValueOnce("cancelled");

        await manager.onBucketManualSetup(UserMode.ExistingUser, setting.currentSettings());

        expect(setting.currentSettings().remoteConfigurations).toEqual(before);
        expect(setting.currentSettings().activeConfigurationId).toBe("existing");
    });

    it("does not mutate an existing P2P profile when final confirmation is cancelled", async () => {
        const { manager, setting, dialogManager } = createSetupManager();
        setting.settings = {
            ...setting.currentSettings(),
            isConfigured: true,
            remoteConfigurations: {
                existing: {
                    id: "existing",
                    name: "Existing P2P remote",
                    uri: "sls+p2p://old-room?passphrase=old-secret",
                    isEncrypted: false,
                },
            },
            activeConfigurationId: "existing",
            P2P_ActiveRemoteConfigurationId: "existing",
        };
        const before = structuredClone(setting.currentSettings().remoteConfigurations);
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce({
                P2P_Enabled: true,
                P2P_roomID: "new-room",
                P2P_passphrase: "new-secret",
                P2P_relays: "wss://relay.example",
                P2P_AppID: "self-hosted-livesync",
                P2P_AutoStart: true,
                P2P_AutoBroadcast: false,
                P2P_turnServers: "",
                P2P_turnUsername: "",
                P2P_turnCredential: "",
            })
            .mockResolvedValueOnce("cancelled");

        await manager.onP2PManualSetup(UserMode.ExistingUser, setting.currentSettings());

        expect(setting.currentSettings().remoteConfigurations).toEqual(before);
        expect(setting.currentSettings().activeConfigurationId).toBe("existing");
        expect(setting.currentSettings().P2P_ActiveRemoteConfigurationId).toBe("existing");
    });
});
