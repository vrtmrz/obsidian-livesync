// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type ObsidianLiveSyncSettings } from "@lib/common/types.ts";
export declare const enum UserMode {
    NewUser = "new-user",
    ExistingUser = "existing-user",
    Unknown = "unknown",
    Update = "unknown" // eslint-disable-line @typescript-eslint/no-duplicate-enum-values -- Duplicate enum value
}
export interface SetupManagerAPI {
    startOnBoarding(): Promise<boolean>;
    onOnboard(userMode: UserMode): Promise<boolean>;
    onUseSetupURI(userMode: UserMode, setupURI?: string): Promise<boolean>;
    onCouchDBManualSetup(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings, activate?: boolean): Promise<boolean>;
    onBucketManualSetup(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings, activate?: boolean): Promise<boolean>;
    onP2PManualSetup(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings, activate?: boolean): Promise<boolean>;
    onlyE2EEConfiguration(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings): Promise<boolean>;
    onConfigureManually(originalSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean>;
    onSelectServer(currentSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean>;
    onConfirmApplySettingsFromWizard(newConf: ObsidianLiveSyncSettings, _userMode: UserMode, activate?: boolean, extra?: () => void): Promise<boolean>;
    onPromptQRCodeInstruction(): Promise<boolean>;
    decodeQR(qr: string): Promise<boolean>;
    applySetting(newConf: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean>;
    dialogManager: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
}
export declare const getSetupManager: () => SetupManagerAPI;
export declare const useSetupManagerFeature: import("@/types.ts").ObsidianServiceFeatureFunction<"setting" | "UI" | "appLifecycle" | "API" | "replicator", "rebuilder", never, SetupManagerAPI>;
