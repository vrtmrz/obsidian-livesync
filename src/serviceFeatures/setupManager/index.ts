import {
    type BucketSyncSetting,
    type CouchDBConnection,
    type EncryptionSettings,
    type ObsidianLiveSyncSettings,
    type P2PSyncSetting,
    type LOG_LEVEL,
    DEFAULT_SETTINGS,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    REMOTE_P2P,
} from "@lib/common/types.ts";
import { isObjectDifferent } from "@lib/common/utils.ts";
import Intro from "@/modules/features/SetupWizard/dialogs/Intro.svelte";
import SelectMethodNewUser from "@/modules/features/SetupWizard/dialogs/SelectMethodNewUser.svelte";
import SelectMethodExisting from "@/modules/features/SetupWizard/dialogs/SelectMethodExisting.svelte";
import ScanQRCode from "@/modules/features/SetupWizard/dialogs/ScanQRCode.svelte";
import UseSetupURI from "@/modules/features/SetupWizard/dialogs/UseSetupURI.svelte";
import OutroNewUser from "@/modules/features/SetupWizard/dialogs/OutroNewUser.svelte";
import OutroExistingUser from "@/modules/features/SetupWizard/dialogs/OutroExistingUser.svelte";
import OutroAskUserMode from "@/modules/features/SetupWizard/dialogs/OutroAskUserMode.svelte";
import SetupRemote from "@/modules/features/SetupWizard/dialogs/SetupRemote.svelte";
import SetupRemoteCouchDB from "@/modules/features/SetupWizard/dialogs/SetupRemoteCouchDB.svelte";
import SetupRemoteBucket from "@/modules/features/SetupWizard/dialogs/SetupRemoteBucket.svelte";
import SetupRemoteP2P from "@/modules/features/SetupWizard/dialogs/SetupRemoteP2P.svelte";
import SetupRemoteE2EE from "@/modules/features/SetupWizard/dialogs/SetupRemoteE2EE.svelte";
import { decodeSettingsFromQRCodeData } from "@lib/API/processSetting.ts";
import { ConnectionStringParser } from "@lib/common/ConnectionString.ts";
import type {
    OutroAskUserModeResultType,
    OutroExistingUserResultType,
    OutroNewUserResultType,
    ScanQRCodeResultType,
    SetupRemoteBucketResultType,
    SetupRemoteCouchDBResultType,
    SetupRemoteE2EEResultType,
    SetupRemoteP2PResultType,
    SetupRemoteResultType,
    UseSetupURIResultType,
} from "@/modules/features/SetupWizard/dialogs/setupDialogTypes.ts";
import { createObsidianServiceFeature } from "@/types.ts";

export const enum UserMode {
    NewUser = "new-user",
    ExistingUser = "existing-user",
    Unknown = "unknown",
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
    Update = "unknown",
}

export interface SetupManagerAPI {
    startOnBoarding(): Promise<boolean>;
    onOnboard(userMode: UserMode): Promise<boolean>;
    onUseSetupURI(userMode: UserMode, setupURI?: string): Promise<boolean>;
    onCouchDBManualSetup(
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate?: boolean
    ): Promise<boolean>;
    onBucketManualSetup(
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate?: boolean
    ): Promise<boolean>;
    onP2PManualSetup(
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate?: boolean
    ): Promise<boolean>;
    onlyE2EEConfiguration(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings): Promise<boolean>;
    onConfigureManually(originalSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean>;
    onSelectServer(currentSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean>;
    onConfirmApplySettingsFromWizard(
        newConf: ObsidianLiveSyncSettings,
        _userMode: UserMode,
        activate?: boolean,
        extra?: () => void
    ): Promise<boolean>;
    onPromptQRCodeInstruction(): Promise<boolean>;
    decodeQR(qr: string): Promise<boolean>;
    applySetting(newConf: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean>;
    dialogManager: any;
}

let _setupManagerAPI: SetupManagerAPI | null = null;
export const getSetupManager = () => _setupManagerAPI!;

export const useSetupManagerFeature = createObsidianServiceFeature<
    "UI" | "API" | "appLifecycle" | "setting" | "replicator",
    "rebuilder",
    never,
    SetupManagerAPI
>((host): SetupManagerAPI => {
    const services = host.services;
    const serviceModules = host.serviceModules;

    const dialogManager = services.UI.dialogManager;

    const _log = (msg: string, level: LOG_LEVEL) => {
        services.API.addLog(msg, level);
    };

    const startOnBoarding = async (): Promise<boolean> => {
        const isUserNewOrExisting = await dialogManager.openWithExplicitCancel(Intro);
        if (isUserNewOrExisting === "new-user") {
            await onOnboard(UserMode.NewUser);
        } else if (isUserNewOrExisting === "existing-user") {
            await onOnboard(UserMode.ExistingUser);
        } else if (isUserNewOrExisting === "cancelled") {
            _log("Onboarding cancelled by user.", LOG_LEVEL_NOTICE);
            return false;
        }
        return false;
    };

    const onOnboard = async (userMode: UserMode): Promise<boolean> => {
        const originalSetting = userMode === UserMode.NewUser ? DEFAULT_SETTINGS : services.setting.settings;
        if (userMode === UserMode.NewUser) {
            const method = await dialogManager.openWithExplicitCancel(SelectMethodNewUser);
            if (method === "use-setup-uri") {
                await onUseSetupURI(userMode);
            } else if (method === "configure-manually") {
                await onConfigureManually(originalSetting, userMode);
            } else if (method === "cancelled") {
                _log("Onboarding cancelled by user.", LOG_LEVEL_NOTICE);
                return false;
            }
        } else if (userMode === UserMode.ExistingUser) {
            const method = await dialogManager.openWithExplicitCancel(SelectMethodExisting);
            if (method === "use-setup-uri") {
                await onUseSetupURI(userMode);
            } else if (method === "configure-manually") {
                await onConfigureManually(originalSetting, userMode);
            } else if (method === "scan-qr-code") {
                await onPromptQRCodeInstruction();
            } else if (method === "cancelled") {
                _log("Onboarding cancelled by user.", LOG_LEVEL_NOTICE);
                return false;
            }
        }
        return false;
    };

    const onUseSetupURI = async (userMode: UserMode, setupURI: string = ""): Promise<boolean> => {
        const newSetting = await dialogManager.openWithExplicitCancel<UseSetupURIResultType, string>(
            UseSetupURI,
            setupURI
        );
        if (newSetting === "cancelled") {
            _log("Setup URI dialog cancelled.", LOG_LEVEL_NOTICE);
            return false;
        }
        _log("Setup URI dialog closed.", LOG_LEVEL_VERBOSE);
        return await onConfirmApplySettingsFromWizard(newSetting, userMode);
    };

    const onCouchDBManualSetup = async (
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate = true
    ): Promise<boolean> => {
        const originalSetting = JSON.parse(JSON.stringify(currentSetting)) as ObsidianLiveSyncSettings;
        const baseSetting = JSON.parse(JSON.stringify(originalSetting)) as ObsidianLiveSyncSettings;
        const couchConf = await dialogManager.openWithExplicitCancel<SetupRemoteCouchDBResultType, CouchDBConnection>(
            SetupRemoteCouchDB,
            originalSetting
        );
        if (couchConf === "cancelled") {
            _log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await onOnboard(userMode);
        }
        const newSetting = { ...baseSetting, ...couchConf } as ObsidianLiveSyncSettings;
        if (activate) {
            newSetting.remoteType = REMOTE_COUCHDB;
        }
        return await onConfirmApplySettingsFromWizard(newSetting, userMode, activate);
    };

    const onBucketManualSetup = async (
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate = true
    ): Promise<boolean> => {
        const bucketConf = await dialogManager.openWithExplicitCancel<SetupRemoteBucketResultType, BucketSyncSetting>(
            SetupRemoteBucket,
            currentSetting
        );
        if (bucketConf === "cancelled") {
            _log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await onOnboard(userMode);
        }
        const newSetting = { ...currentSetting, ...bucketConf } as ObsidianLiveSyncSettings;
        if (activate) {
            newSetting.remoteType = REMOTE_MINIO;
        }
        return await onConfirmApplySettingsFromWizard(newSetting, userMode, activate);
    };

    const onP2PManualSetup = async (
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate = true
    ): Promise<boolean> => {
        const p2pConf = await dialogManager.openWithExplicitCancel<SetupRemoteP2PResultType, P2PSyncSetting>(
            SetupRemoteP2P,
            currentSetting
        );
        if (p2pConf === "cancelled") {
            _log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await onOnboard(userMode);
        }
        const newSetting = { ...currentSetting, ...p2pConf } as ObsidianLiveSyncSettings;
        if (newSetting.P2P_ActiveRemoteConfigurationId) {
            const id = newSetting.P2P_ActiveRemoteConfigurationId;
            const merged = {
                ...newSetting,
                ...p2pConf,
            } as ObsidianLiveSyncSettings;
            const uri = ConnectionStringParser.serialize({ type: "p2p", settings: merged });
            newSetting.remoteConfigurations[id] = {
                ...newSetting.remoteConfigurations[id],
                uri,
                isEncrypted: false,
            };
            newSetting.P2P_ActiveRemoteConfigurationId = id;
        }
        if (activate) {
            newSetting.remoteType = REMOTE_P2P;
            newSetting.activeConfigurationId = newSetting.P2P_ActiveRemoteConfigurationId;
        }
        return await onConfirmApplySettingsFromWizard(newSetting, userMode, activate);
    };

    const onlyE2EEConfiguration = async (
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings
    ): Promise<boolean> => {
        const e2eeConf = await dialogManager.openWithExplicitCancel<SetupRemoteE2EEResultType, EncryptionSettings>(
            SetupRemoteE2EE,
            currentSetting
        );
        if (e2eeConf === "cancelled") {
            _log("E2EE configuration cancelled.", LOG_LEVEL_NOTICE);
            return false;
        }
        const newSetting = {
            ...currentSetting,
            ...e2eeConf,
        } as ObsidianLiveSyncSettings;
        return await onConfirmApplySettingsFromWizard(newSetting, userMode);
    };

    const onConfigureManually = async (
        originalSetting: ObsidianLiveSyncSettings,
        userMode: UserMode
    ): Promise<boolean> => {
        const e2eeConf = await dialogManager.openWithExplicitCancel<SetupRemoteE2EEResultType, EncryptionSettings>(
            SetupRemoteE2EE,
            originalSetting
        );
        if (e2eeConf === "cancelled") {
            _log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await onOnboard(userMode);
        }
        const currentSetting = {
            ...originalSetting,
            ...e2eeConf,
        } as ObsidianLiveSyncSettings;
        return await onSelectServer(currentSetting, userMode);
    };

    const onSelectServer = async (currentSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean> => {
        const method = await dialogManager.openWithExplicitCancel<SetupRemoteResultType>(SetupRemote);
        if (method === "couchdb") {
            return await onCouchDBManualSetup(userMode, currentSetting, true);
        } else if (method === "bucket") {
            return await onBucketManualSetup(userMode, currentSetting, true);
        } else if (method === "p2p") {
            return await onP2PManualSetup(userMode, currentSetting, true);
        } else if (method === "cancelled") {
            _log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            if (userMode !== UserMode.Unknown) {
                return await onOnboard(userMode);
            }
        }
        return false;
    };

    const applySetting = async (newConf: ObsidianLiveSyncSettings, userMode: UserMode) => {
        services.setting.clearUsedPassphrase();
        await services.setting.applyExternalSettings(newConf, true);
        return true;
    };

    const onConfirmApplySettingsFromWizard = async (
        newConf: ObsidianLiveSyncSettings,
        _userMode: UserMode,
        activate: boolean = true,
        extra: () => void = () => {}
    ): Promise<boolean> => {
        newConf = await services.setting.adjustSettings({
            ...services.setting.settings,
            ...newConf,
        });
        let userMode = _userMode;
        if (userMode === UserMode.Unknown) {
            if (isObjectDifferent(services.setting.settings, newConf, true) === false) {
                _log("No changes in settings detected. Skipping applying settings from wizard.", LOG_LEVEL_NOTICE);
                return true;
            }
            if (!activate) {
                extra();
                await applySetting(newConf, UserMode.ExistingUser);
                _log("Setting Applied", LOG_LEVEL_NOTICE);
                return true;
            }
            const original = { ...services.setting.settings, P2P_DevicePeerName: "" } as ObsidianLiveSyncSettings;
            const modified = { ...newConf, P2P_DevicePeerName: "" } as ObsidianLiveSyncSettings;
            const isOnlyVirtualChange = isObjectDifferent(original, modified, true) === false;
            if (isOnlyVirtualChange) {
                extra();
                await applySetting(newConf, UserMode.ExistingUser);
                _log("Settings from wizard applied.", LOG_LEVEL_NOTICE);
                return true;
            } else {
                const userModeResult =
                    await dialogManager.openWithExplicitCancel<OutroAskUserModeResultType>(OutroAskUserMode);
                if (userModeResult === "new-user") {
                    userMode = UserMode.NewUser;
                } else if (userModeResult === "existing-user") {
                    userMode = UserMode.ExistingUser;
                } else if (userModeResult === "compatible-existing-user") {
                    extra();
                    await applySetting(newConf, UserMode.ExistingUser);
                    _log("Settings from wizard applied.", LOG_LEVEL_NOTICE);
                    return true;
                } else if (userModeResult === "cancelled") {
                    _log("User cancelled applying settings from wizard.", LOG_LEVEL_NOTICE);
                    return false;
                }
            }
        }
        const component = userMode === UserMode.NewUser ? OutroNewUser : OutroExistingUser;
        const confirm = await dialogManager.openWithExplicitCancel<
            OutroNewUserResultType | OutroExistingUserResultType
        >(component);
        if (confirm === "cancelled") {
            _log("User cancelled applying settings from wizard..", LOG_LEVEL_NOTICE);
            return false;
        }
        if (confirm) {
            extra();
            await applySetting(newConf, userMode);
            if (userMode === UserMode.NewUser) {
                await serviceModules.rebuilder.scheduleRebuild();
            } else {
                await serviceModules.rebuilder.scheduleFetch();
            }
        }
        return false;
    };

    const onPromptQRCodeInstruction = async (): Promise<boolean> => {
        const qrResult = await dialogManager.open<ScanQRCodeResultType>(ScanQRCode);
        _log("QR Code dialog closed.", LOG_LEVEL_VERBOSE);
        _log(qrResult as unknown as string, LOG_LEVEL_VERBOSE);
        return false;
    };

    const decodeQR = async (qr: string) => {
        const newSettings = decodeSettingsFromQRCodeData(qr);
        return await onConfirmApplySettingsFromWizard(newSettings, UserMode.Unknown);
    };

    const api: SetupManagerAPI = {
        startOnBoarding,
        onOnboard,
        onUseSetupURI,
        onCouchDBManualSetup,
        onBucketManualSetup,
        onP2PManualSetup,
        onlyE2EEConfiguration,
        onConfigureManually,
        onSelectServer,
        onConfirmApplySettingsFromWizard,
        onPromptQRCodeInstruction,
        decodeQR,
        applySetting,
        dialogManager,
    };

    _setupManagerAPI = api;

    return api;
});
