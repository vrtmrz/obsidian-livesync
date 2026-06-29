// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ObsidianLiveSyncSettings } from "@lib/common/types";
import type { IAPIService, ISettingService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils";
export interface SettingServiceDependencies {
    APIService: IAPIService;
}
export declare abstract class SettingService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements ISettingService {
    deviceAndVaultName: string;
    protected APIService: IAPIService;
    protected abstract setItem(key: string, value: string): void;
    protected abstract getItem(key: string): string;
    protected abstract deleteItem(key: string): void;
    _settings: ObsidianLiveSyncSettings;
    get settings(): ObsidianLiveSyncSettings;
    set settings(value: ObsidianLiveSyncSettings);
    protected abstract saveData(setting: ObsidianLiveSyncSettings): Promise<void>;
    protected abstract loadData(): Promise<ObsidianLiveSyncSettings | undefined>;
    private _lastPersistedSettings?;
    _log: ReturnType<typeof createInstanceLogFunction>;
    constructor(context: T, dependencies: SettingServiceDependencies);
    /**
     * Adjust the given settings, e.g., migrate old settings to new format.
     * @param settings The settings to adjust.
     */
    adjustSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings>;
    /**
     * Get the unique name for identify the device.
     */
    getDeviceAndVaultName(): string;
    /**
     * Set the unique name for identify the device.
     * @param name The unique name to set.
     */
    setDeviceAndVaultName(name: string): void;
    /**
     * Save the current device and vault name to settings, aside from the main settings.
     */
    saveDeviceAndVaultName(): void;
    private additionalSuffixOfDatabaseName;
    private getKey;
    setSmallConfig(key: string, value: string): void;
    getSmallConfig(key: string): string;
    deleteSmallConfig(key: string): void;
    /**
     * Save the current settings to storage.
     */
    saveSettingData(): Promise<void>;
    private encryptRemoteConfigurationUris;
    private decryptRemoteConfigurationUris;
    /**
     * Event triggered before realising the settings.
     * Handlers can return false to abort the realisation process.
     */
    readonly onBeforeRealiseSetting: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered after the settings have been realised.
     */
    readonly onSettingRealised: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered to realise the settings.
     */
    readonly onRealiseSetting: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Suspend all synchronisation activities and save to the settings.
     */
    readonly suspendAllSync: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Suspend extra synchronisation activities, e.g., hidden files sync.
     */
    readonly suspendExtraSync: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Suggest enabling optional features to the user.
     */
    readonly suggestOptionalFeatures: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(opt: {
        enableFetch?: boolean;
        enableOverwrite?: boolean;
    }) => Promise<boolean>>;
    /**
     * Enable an optional feature and save to the settings.
     * It may also raised from `handleSuggestOptionalFeatures` if the user agrees.
     * @param mode The optional feature to enable.
     */
    readonly enableOptionalFeature: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(mode: keyof OPTIONAL_SYNC_FEATURES) => Promise<boolean>>;
    readonly onSettingLoaded: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(settings: ObsidianLiveSyncSettings) => Promise<boolean>>;
    readonly onSettingChanged: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(settings: ObsidianLiveSyncSettings) => Promise<boolean>>;
    readonly onSettingSaved: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(settings: ObsidianLiveSyncSettings) => Promise<boolean>>;
    readonly onBeforeSaveSettingData: import("@lib/services/lib/HandlerUtils").CollectiveHandlerFunction<(nextSettings: ObsidianLiveSyncSettings, previousSettings: ObsidianLiveSyncSettings) => Promise<(Partial<ObsidianLiveSyncSettings> | void)[]>, unknown>;
    /**
     * Get the current settings.
     */
    currentSettings(): ObsidianLiveSyncSettings;
    updateSettings(updateFn: (settings: ObsidianLiveSyncSettings) => ObsidianLiveSyncSettings, saveImmediately?: boolean): Promise<void>;
    applyExternalSettings(partial: Partial<ObsidianLiveSyncSettings>, saveImmediately?: boolean): Promise<void>;
    applyPartial(partial: Partial<ObsidianLiveSyncSettings>, saveImmediately?: boolean): Promise<void>;
    getPassphrase(settings: ObsidianLiveSyncSettings): Promise<string | false>;
    private usedPassphrase;
    /**
     * Clear any used passphrase from memory.
     */
    clearUsedPassphrase(): void;
    decryptConfigurationItem(encrypted: string, passphrase: string): Promise<string | false>;
    encryptConfigurationItem(src: string, settings: ObsidianLiveSyncSettings): Promise<string>;
    /**
     * Decrypt the given settings.
     * @param settings The settings to decrypt.
     */
    decryptSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings>;
    loadSettings(): Promise<void>;
    private tryDecodeJson;
    private cloneSettings;
}
