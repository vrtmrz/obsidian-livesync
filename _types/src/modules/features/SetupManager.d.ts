// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ObsidianLiveSyncSettings } from "@lib/common/types.ts";
import { AbstractModule } from "@/modules/AbstractModule.ts";
/**
 * User modes for onboarding and setup
 */
export declare const enum UserMode {
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
    Update = "unknown" // eslint-disable-line @typescript-eslint/no-duplicate-enum-values -- Duplicate enum value
}
/**
 * Setup Manager to handle onboarding and configuration setup
 */
export declare class SetupManager extends AbstractModule {
    get dialogManager(): import("../../lib/src/UI/svelteDialog.ts").SvelteDialogManagerBase<import("../../lib/src/services/base/ServiceBase.ts").ServiceContext>;
    /**
     * Starts the onboarding process
     * @returns Promise that resolves to true if onboarding completed successfully, false otherwise
     */
    startOnBoarding(): Promise<boolean>;
    /**
     *  Handles the onboarding process based on user mode
     * @param userMode
     * @returns Promise that resolves to true if onboarding completed successfully, false otherwise
     */
    onOnboard(userMode: UserMode): Promise<boolean>;
    /**
     * Handles setup using a setup URI
     * @param userMode
     * @param setupURI
     * @returns Promise that resolves to true if onboarding completed successfully, false otherwise
     */
    onUseSetupURI(userMode: UserMode, setupURI?: string): Promise<boolean>;
    /**
     * Handles manual setup for CouchDB
     * @param userMode
     * @param currentSetting
     * @param activate  Whether to activate the CouchDB as remote type
     * @returns Promise that resolves to true if setup completed successfully, false otherwise
     */
    onCouchDBManualSetup(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings, activate?: boolean): Promise<boolean>;
    /**
     * Handles manual setup for S3-compatible bucket
     * @param userMode
     * @param currentSetting
     * @param activate Whether to activate the Bucket as remote type
     * @returns Promise that resolves to true if setup completed successfully, false otherwise
     */
    onBucketManualSetup(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings, activate?: boolean): Promise<boolean>;
    /**
     * Handles manual setup for P2P
     * @param userMode
     * @param currentSetting
     * @param activate Whether to activate the P2P as remote type (as P2P Only setup)
     * @returns Promise that resolves to true if setup completed successfully, false otherwise
     */
    onP2PManualSetup(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings, activate?: boolean): Promise<boolean>;
    /**
     * Handles only E2EE configuration
     * @param userMode
     * @param currentSetting
     * @returns
     */
    onlyE2EEConfiguration(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings): Promise<boolean>;
    /**
     * Handles manual configuration flow (E2EE + select server)
     * @param originalSetting
     * @param userMode
     * @returns
     */
    onConfigureManually(originalSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean>;
    /**
     * Handles server selection during manual configuration
     * @param currentSetting
     * @param userMode
     * @returns
     */
    onSelectServer(currentSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean>;
    /**
     * Confirms and applies settings obtained from the wizard
     * @param newConf
     * @param _userMode
     * @param activate Whether to activate the remote type in the new settings
     * @param extra  Extra function to run before applying settings
     * @returns Promise that resolves to true if settings applied successfully, false otherwise
     */
    onConfirmApplySettingsFromWizard(newConf: ObsidianLiveSyncSettings, _userMode: UserMode, activate?: boolean, extra?: () => void): Promise<boolean>;
    /**
     * Prompts the user with QR code scanning instructions
     * @returns Promise that resolves to false as QR code instruction dialog does not yield settings directly
     */
    onPromptQRCodeInstruction(): Promise<boolean>;
    /**
     * Decodes settings from a QR code string and applies them
     * @param qr QR code string containing encoded settings
     * @returns Promise that resolves to true if settings applied successfully, false otherwise
     */
    decodeQR(qr: string): Promise<boolean>;
    /**
     * Applies the new settings to the core settings and saves them
     * @param newConf
     * @param userMode
     * @returns Promise that resolves to true if settings applied successfully, false otherwise
     */
    applySetting(newConf: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean>;
}
