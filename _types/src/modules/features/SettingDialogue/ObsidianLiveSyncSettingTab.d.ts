// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { App, Component, PluginSettingTab } from "@/deps.ts";
import { type ObsidianLiveSyncSettings } from "@lib/common/types.ts";
import ObsidianLiveSyncPlugin from "@/main.ts";
import { type AllSettingItemKey, type AllStringItemKey, type AllNumericItemKey, type AllBooleanItemKey, type AllSettings, OnDialogSettingsDefault, type OnDialogSettings } from "./settingConstants.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { type OnSavedHandler, type OnSavedHandlerFunc, type OnUpdateFunc, type OnUpdateResult, type UpdateFunction } from "./SettingPane.ts";
import { JournalSyncCore } from "@lib/replication/journal/JournalSyncCore.js";
export declare class ObsidianLiveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianLiveSyncPlugin;
    private _lifetimeComponent;
    get lifetimeComponent(): Component;
    get core(): import("@/main.ts").LiveSyncCore;
    get services(): import("../../../lib/src/services/InjectableServices.ts").InjectableServiceHub<import("../../../lib/src/services/implements/obsidian/ObsidianServiceContext.ts").ObsidianServiceContext>;
    selectedScreen: string;
    _editingSettings?: AllSettings;
    get editingSettings(): AllSettings;
    set editingSettings(v: AllSettings);
    initialSettings?: typeof this.editingSettings;
    /**
     * Apply editing setting to the plug-in.
     * @param keys setting keys for applying
     */
    applySetting(keys: AllSettingItemKey[]): void;
    applyAllSettings(): void;
    saveLocalSetting(key: keyof typeof OnDialogSettingsDefault): Promise<void>;
    /**
     * Apply and save setting to the plug-in.
     * @param keys setting keys for applying
     */
    saveSettings(keys: AllSettingItemKey[]): Promise<void>;
    /**
     * Apply all editing setting to the plug-in.
     * @param keys setting keys for applying
     */
    saveAllDirtySettings(): Promise<void>;
    /**
     * Invalidate buffered value and fetch the latest.
     */
    requestUpdate(): void;
    reloadAllLocalSettings(): {
        configPassphrase: string;
        preset: "" | "PERIODIC" | "LIVESYNC" | "DISABLE";
        syncMode: "ONEVENTS" | "PERIODIC" | "LIVESYNC";
        dummy: number;
        deviceAndVaultName: string;
    };
    computeAllLocalSettings(): Partial<OnDialogSettings>;
    /**
     * Reread all settings and request invalidate
     */
    reloadAllSettings(skipUpdate?: boolean): void;
    /**
     * Reread each setting and request invalidate
     */
    refreshSetting(key: AllSettingItemKey): void;
    isDirty(key: AllSettingItemKey): boolean;
    isSomeDirty(keys: AllSettingItemKey[]): boolean;
    isConfiguredAs(key: AllStringItemKey, value: string): boolean;
    isConfiguredAs(key: AllNumericItemKey, value: number): boolean;
    isConfiguredAs(key: AllBooleanItemKey, value: boolean): boolean;
    settingComponents: Setting[];
    controlledElementFunc: UpdateFunction[];
    onSavedHandlers: OnSavedHandler<AllSettingItemKey>[];
    inWizard: boolean;
    constructor(app: App, plugin: ObsidianLiveSyncPlugin);
    testConnection(settingOverride?: Partial<ObsidianLiveSyncSettings>): Promise<void>;
    closeSetting(): void;
    handleElement(element: HTMLElement, func: OnUpdateFunc): void;
    createEl<T extends keyof HTMLElementTagNameMap>(el: HTMLElement, tag: T, o?: string | DomElementInfo, callback?: (el: HTMLElementTagNameMap[T]) => void, func?: OnUpdateFunc): HTMLElementTagNameMap[T];
    addEl<T extends keyof HTMLElementTagNameMap>(el: HTMLElement, tag: T, o?: string | DomElementInfo, callback?: (el: HTMLElementTagNameMap[T]) => void, func?: OnUpdateFunc): Promise<Awaited<HTMLElementTagNameMap[T]>>;
    addOnSaved<T extends AllSettingItemKey>(key: T, func: OnSavedHandlerFunc<T>): void;
    resetEditingSettings(): void;
    hide(): void;
    isShown: boolean;
    requestReload(): void;
    manifestVersion: string;
    lastVersion: number;
    screenElements: {
        [key: string]: HTMLElement[];
    };
    changeDisplay(screen: string): void;
    enableMinimalSetup(): Promise<void>;
    menuEl?: HTMLElement;
    addScreenElement(key: string, element: HTMLElement): void;
    selectPane(event: Event): void;
    isNeedRebuildLocal(): boolean;
    isNeedRebuildRemote(): boolean;
    isAnySyncEnabled(): boolean;
    enableOnlySyncDisabled: OnUpdateFunc;
    onlyOnP2POrCouchDB: () => OnUpdateResult;
    onlyOnCouchDB: () => OnUpdateResult;
    onlyOnMinIO: () => OnUpdateResult;
    onlyOnOnlyP2P: () => OnUpdateResult;
    onlyOnCouchDBOrMinIO: () => OnUpdateResult;
    checkWorkingPassphrase: () => Promise<boolean>;
    isPassphraseValid: () => Promise<boolean>;
    rebuildDB: (method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice" | "localOnlyWithChunks") => Promise<void>;
    confirmRebuild(): Promise<void>;
    display(): void;
    getMinioJournalSyncClient(): JournalSyncCore;
    resetRemoteBucket(): Promise<void>;
}
