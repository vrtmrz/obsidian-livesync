import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, REMOTE_COUCHDB, type ObsidianLiveSyncSettings } from "../../lib/src/common/types";
import { SettingService } from "../../lib/src/services/base/SettingService";
import { ServiceContext } from "../../lib/src/services/base/ServiceBase";

vi.mock("@/deps", () => ({
    getLanguage: () => "en",
}));

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

vi.mock("../../lib/src/API/processSetting.ts", () => ({
    decodeSettingsFromQRCodeData: vi.fn(),
}));

import { decodeSettingsFromQRCodeData } from "../../lib/src/API/processSetting.ts";
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
            scheduleRebuild: vi.fn(() => Promise.resolve()),
            scheduleFetch: vi.fn(() => Promise.resolve()),
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

    it("startOnBoarding should return true when new user setup is applied", async () => {
        const { manager, dialogManager, core } = createSetupManager();
        dialogManager.openWithExplicitCancel
            .mockResolvedValueOnce("new-user")
            .mockResolvedValueOnce("use-setup-uri")
            .mockResolvedValueOnce(createLegacyRemoteSetting())
            .mockResolvedValueOnce("apply");

        const result = await manager.startOnBoarding();

        expect(result).toBe(true);
        expect(core.rebuilder.scheduleRebuild).toHaveBeenCalled();
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
});
