import {
    type ObsidianLiveSyncSettings,
    DEFAULT_SETTINGS,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    REMOTE_P2P,
} from "../../lib/src/common/types.ts";
import { generatePatchObj, isObjectDifferent } from "../../lib/src/common/utils.ts";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { SvelteDialogManager } from "./SetupWizard/ObsidianSvelteDialog.ts";
import Intro from "./SetupWizard/dialogs/Intro.svelte";
import SelectMethodNewUser from "./SetupWizard/dialogs/SelectMethodNewUser.svelte";
import SelectMethodExisting from "./SetupWizard/dialogs/SelectMethodExisting.svelte";
import ScanQRCode from "./SetupWizard/dialogs/ScanQRCode.svelte";
import UseSetupURI from "./SetupWizard/dialogs/UseSetupURI.svelte";
import OutroNewUser from "./SetupWizard/dialogs/OutroNewUser.svelte";
import OutroExistingUser from "./SetupWizard/dialogs/OutroExistingUser.svelte";
import OutroAskUserMode from "./SetupWizard/dialogs/OutroAskUserMode.svelte";
import SetupRemote from "./SetupWizard/dialogs/SetupRemote.svelte";
import SetupRemoteCouchDB from "./SetupWizard/dialogs/SetupRemoteCouchDB.svelte";
import SetupRemoteBucket from "./SetupWizard/dialogs/SetupRemoteBucket.svelte";
import SetupRemoteP2P from "./SetupWizard/dialogs/SetupRemoteP2P.svelte";
import SetupRemoteE2EE from "./SetupWizard/dialogs/SetupRemoteE2EE.svelte";
import { decodeSettingsFromQRCodeData } from "../../lib/src/API/processSetting.ts";

/**
 * User modes for onboarding and setup
 */
export const enum UserMode {
    /**
     * New User Mode - for users who are new to the plugin
     */
    NewUser = "new-user",
    /**
     * Existing User Mode - for users who have used the plugin before, or just configuring again
     */
    ExistingUser = "existing-user",
    /**
     * Unknown User Mode - for cases where the user mode is not determined
     */
    Unknown = "unknown",
    /**
     * Update User Mode - for users who are updating configuration. May be `existing-user` as well, but possibly they want to treat it differently.
     */
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
    Update = "unknown", // Alias for Unknown for better readability
}

/**
 * Setup Manager to handle onboarding and configuration setup
 */
export class SetupManager extends AbstractObsidianModule {
    /**
     * Dialog manager for handling Svelte dialogs
     */
    private dialogManager: SvelteDialogManager = new SvelteDialogManager(this.plugin);

    /**
     * Starts the onboarding process
     * @returns Promise that resolves to true if onboarding completed successfully, false otherwise
     */
    async startOnBoarding(): Promise<boolean> {
        const isUserNewOrExisting = await this.dialogManager.openWithExplicitCancel(Intro);
        if (isUserNewOrExisting === "new-user") {
            await this.onOnboard(UserMode.NewUser);
        } else if (isUserNewOrExisting === "existing-user") {
            await this.onOnboard(UserMode.ExistingUser);
        } else if (isUserNewOrExisting === "cancelled") {
            this._log("Onboarding cancelled by user.", LOG_LEVEL_NOTICE);
            return false;
        }
        return false;
    }

    /**
     *  Handles the onboarding process based on user mode
     * @param userMode
     * @returns Promise that resolves to true if onboarding completed successfully, false otherwise
     */
    async onOnboard(userMode: UserMode): Promise<boolean> {
        const originalSetting = userMode === UserMode.NewUser ? DEFAULT_SETTINGS : this.core.settings;
        if (userMode === UserMode.NewUser) {
            //Ask how to apply initial setup
            const method = await this.dialogManager.openWithExplicitCancel(SelectMethodNewUser);
            if (method === "use-setup-uri") {
                await this.onUseSetupURI(userMode);
            } else if (method === "configure-manually") {
                await this.onConfigureManually(originalSetting, userMode);
            } else if (method === "cancelled") {
                this._log("Onboarding cancelled by user.", LOG_LEVEL_NOTICE);
                return false;
            }
        } else if (userMode === UserMode.ExistingUser) {
            const method = await this.dialogManager.openWithExplicitCancel(SelectMethodExisting);
            if (method === "use-setup-uri") {
                await this.onUseSetupURI(userMode);
            } else if (method === "configure-manually") {
                await this.onConfigureManually(originalSetting, userMode);
            } else if (method === "scan-qr-code") {
                await this.onPromptQRCodeInstruction();
            } else if (method === "cancelled") {
                this._log("Onboarding cancelled by user.", LOG_LEVEL_NOTICE);
                return false;
            }
        }
        return false;
    }

    /**
     * Handles setup using a setup URI
     * @param userMode
     * @param setupURI
     * @returns Promise that resolves to true if onboarding completed successfully, false otherwise
     */
    async onUseSetupURI(userMode: UserMode, setupURI: string = ""): Promise<boolean> {
        const newSetting = await this.dialogManager.openWithExplicitCancel(UseSetupURI, setupURI);
        if (newSetting === "cancelled") {
            this._log("Setup URI dialog cancelled.", LOG_LEVEL_NOTICE);
            return false;
        }
        this._log("Setup URI dialog closed.", LOG_LEVEL_VERBOSE);
        return await this.onConfirmApplySettingsFromWizard(newSetting, userMode);
    }

    /**
     * Handles manual setup for CouchDB
     * @param userMode
     * @param currentSetting
     * @param activate  Whether to activate the CouchDB as remote type
     * @returns Promise that resolves to true if setup completed successfully, false otherwise
     */
    async onCouchDBManualSetup(
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate = true
    ): Promise<boolean> {
        const originalSetting = JSON.parse(JSON.stringify(currentSetting)) as ObsidianLiveSyncSettings;
        const baseSetting = JSON.parse(JSON.stringify(originalSetting)) as ObsidianLiveSyncSettings;
        const couchConf = await this.dialogManager.openWithExplicitCancel(SetupRemoteCouchDB, originalSetting);
        if (couchConf === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await this.onOnboard(userMode);
        }
        const newSetting = { ...baseSetting, ...couchConf } as ObsidianLiveSyncSettings;
        if (activate) {
            newSetting.remoteType = REMOTE_COUCHDB;
        }
        return await this.onConfirmApplySettingsFromWizard(newSetting, userMode, activate);
    }

    /**
     * Handles manual setup for S3-compatible bucket
     * @param userMode
     * @param currentSetting
     * @param activate Whether to activate the Bucket as remote type
     * @returns Promise that resolves to true if setup completed successfully, false otherwise
     */
    async onBucketManualSetup(
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate = true
    ): Promise<boolean> {
        const bucketConf = await this.dialogManager.openWithExplicitCancel(SetupRemoteBucket, currentSetting);
        if (bucketConf === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await this.onOnboard(userMode);
        }
        const newSetting = { ...currentSetting, ...bucketConf } as ObsidianLiveSyncSettings;
        if (activate) {
            newSetting.remoteType = REMOTE_MINIO;
        }
        return await this.onConfirmApplySettingsFromWizard(newSetting, userMode, activate);
    }

    /**
     * Handles manual setup for P2P
     * @param userMode
     * @param currentSetting
     * @param activate Whether to activate the P2P as remote type (as P2P Only setup)
     * @returns Promise that resolves to true if setup completed successfully, false otherwise
     */
    async onP2PManualSetup(
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate = true
    ): Promise<boolean> {
        const p2pConf = await this.dialogManager.openWithExplicitCancel(SetupRemoteP2P, currentSetting);
        if (p2pConf === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await this.onOnboard(userMode);
        }
        const newSetting = { ...currentSetting, ...p2pConf } as ObsidianLiveSyncSettings;
        if (activate) {
            newSetting.remoteType = REMOTE_P2P;
        }
        return await this.onConfirmApplySettingsFromWizard(newSetting, userMode, activate);
    }

    /**
     * Handles only E2EE configuration
     * @param userMode
     * @param currentSetting
     * @returns
     */
    async onlyE2EEConfiguration(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings): Promise<boolean> {
        const e2eeConf = await this.dialogManager.openWithExplicitCancel(SetupRemoteE2EE, currentSetting);
        if (e2eeConf === "cancelled") {
            this._log("E2EE configuration cancelled.", LOG_LEVEL_NOTICE);
            return await false;
        }
        const newSetting = {
            ...currentSetting,
            ...e2eeConf,
        } as ObsidianLiveSyncSettings;
        return await this.onConfirmApplySettingsFromWizard(newSetting, userMode);
    }

    /**
     * Handles manual configuration flow (E2EE + select server)
     * @param originalSetting
     * @param userMode
     * @returns
     */
    async onConfigureManually(originalSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean> {
        const e2eeConf = await this.dialogManager.openWithExplicitCancel(SetupRemoteE2EE, originalSetting);
        if (e2eeConf === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await this.onOnboard(userMode);
        }
        const currentSetting = {
            ...originalSetting,
            ...e2eeConf,
        } as ObsidianLiveSyncSettings;
        return await this.onSelectServer(currentSetting, userMode);
    }

    /**
     * Handles server selection during manual configuration
     * @param currentSetting
     * @param userMode
     * @returns
     */
    async onSelectServer(currentSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean> {
        const method = await this.dialogManager.openWithExplicitCancel(SetupRemote);
        if (method === "couchdb") {
            return await this.onCouchDBManualSetup(userMode, currentSetting, true);
        } else if (method === "bucket") {
            return await this.onBucketManualSetup(userMode, currentSetting, true);
        } else if (method === "p2p") {
            return await this.onP2PManualSetup(userMode, currentSetting, true);
        } else if (method === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            if (userMode !== UserMode.Unknown) {
                return await this.onOnboard(userMode);
            }
        }
        // Should not reach here.
        return false;
    }
    /**
     * Confirms and applies settings obtained from the wizard
     * @param newConf
     * @param _userMode
     * @param activate Whether to activate the remote type in the new settings
     * @param extra  Extra function to run before applying settings
     * @returns Promise that resolves to true if settings applied successfully, false otherwise
     */
    async onConfirmApplySettingsFromWizard(
        newConf: ObsidianLiveSyncSettings,
        _userMode: UserMode,
        activate: boolean = true,
        extra: () => void = () => {}
    ): Promise<boolean> {
        let userMode = _userMode;
        if (userMode === UserMode.Unknown) {
            if (isObjectDifferent(this.settings, newConf, true) === false) {
                this._log("No changes in settings detected. Skipping applying settings from wizard.", LOG_LEVEL_NOTICE);
                return true;
            }
            const patch = generatePatchObj(this.settings, newConf);
            console.log(`Changes:`);
            console.dir(patch);
            if (!activate) {
                extra();
                await this.applySetting(newConf, UserMode.ExistingUser);
                this._log("Setting Applied", LOG_LEVEL_NOTICE);
                return true;
            }
            // Check virtual changes
            const original = { ...this.settings, P2P_DevicePeerName: "" } as ObsidianLiveSyncSettings;
            const modified = { ...newConf, P2P_DevicePeerName: "" } as ObsidianLiveSyncSettings;
            const isOnlyVirtualChange = isObjectDifferent(original, modified, true) === false;
            if (isOnlyVirtualChange) {
                extra();
                await this.applySetting(newConf, UserMode.ExistingUser);
                this._log("Settings from wizard applied.", LOG_LEVEL_NOTICE);
                return true;
            } else {
                const userModeResult = await this.dialogManager.openWithExplicitCancel(OutroAskUserMode);
                if (userModeResult === "new-user") {
                    userMode = UserMode.NewUser;
                } else if (userModeResult === "existing-user") {
                    userMode = UserMode.ExistingUser;
                } else if (userModeResult === "compatible-existing-user") {
                    extra();
                    await this.applySetting(newConf, UserMode.ExistingUser);
                    this._log("Settings from wizard applied.", LOG_LEVEL_NOTICE);
                    return true;
                } else if (userModeResult === "cancelled") {
                    this._log("User cancelled applying settings from wizard.", LOG_LEVEL_NOTICE);
                    return false;
                }
            }
        }
        const component = userMode === UserMode.NewUser ? OutroNewUser : OutroExistingUser;
        const confirm = await this.dialogManager.openWithExplicitCancel(component);
        if (confirm === "cancelled") {
            this._log("User cancelled applying settings from wizard..", LOG_LEVEL_NOTICE);
            return false;
        }
        if (confirm) {
            extra();
            await this.applySetting(newConf, userMode);
            if (userMode === UserMode.NewUser) {
                // For new users, schedule a rebuild everything.
                await this.core.rebuilder.scheduleRebuild();
            } else {
                // For existing users, schedule a fetch.
                await this.core.rebuilder.scheduleFetch();
            }
        }
        // Settings applied, but may require rebuild to take effect.
        return false;
    }

    /**
     * Prompts the user with QR code scanning instructions
     * @returns Promise that resolves to false as QR code instruction dialog does not yield settings directly
     */

    async onPromptQRCodeInstruction(): Promise<boolean> {
        const qrResult = await this.dialogManager.open(ScanQRCode);
        this._log("QR Code dialog closed.", LOG_LEVEL_VERBOSE);
        // Result is not used, but log it for debugging.
        this._log(`QR Code result: ${qrResult}`, LOG_LEVEL_VERBOSE);
        // QR Code instruction dialog never yields settings directly.
        return false;
    }

    /**
     * Decodes settings from a QR code string and applies them
     * @param qr QR code string containing encoded settings
     * @returns Promise that resolves to true if settings applied successfully, false otherwise
     */
    async decodeQR(qr: string) {
        const newSettings = decodeSettingsFromQRCodeData(qr);
        return await this.onConfirmApplySettingsFromWizard(newSettings, UserMode.Unknown);
    }

    /**
     * Applies the new settings to the core settings and saves them
     * @param newConf
     * @param userMode
     * @returns Promise that resolves to true if settings applied successfully, false otherwise
     */
    async applySetting(newConf: ObsidianLiveSyncSettings, userMode: UserMode) {
        const newSetting = {
            ...this.core.settings,
            ...newConf,
        };
        this.core.settings = newSetting;
        this.services.setting.clearUsedPassphrase();
        await this.services.setting.saveSettingData();
        return true;
    }
}
