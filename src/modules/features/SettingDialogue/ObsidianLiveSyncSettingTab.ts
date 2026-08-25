import { App, Component, PluginSettingTab, requireApiVersion, SettingPage } from "@/deps.ts";
import {
    type ObsidianLiveSyncSettings,
    type RemoteDBSettings,
    LOG_LEVEL_NOTICE,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    type ConfigLevel,
    LEVEL_POWER_USER,
    LEVEL_ADVANCED,
    LEVEL_EDGE_CASE,
    REMOTE_P2P,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { delay, isObjectDifferent, sizeToHumanReadable } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { Logger } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import { checkSyncInfo } from "@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation";
import { testCrypt } from "octagonal-wheels/encryption/encryption";
import ObsidianLiveSyncPlugin from "@/main.ts";
import { scheduleTask } from "@/common/utils.ts";
import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import {
    type AllSettingItemKey,
    type AllStringItemKey,
    type AllNumericItemKey,
    type AllBooleanItemKey,
    type AllSettings,
    OnDialogSettingsDefault,
    type OnDialogSettings,
    getConfName,
} from "./settingConstants.ts";
import { $msg } from "@/common/translation";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { fireAndForget, yieldNextAnimationFrame } from "octagonal-wheels/promises";
import {
    EVENT_ON_UNRESOLVED_ERROR,
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_RELOAD_SETTING_TAB,
    EVENT_REQUEST_SHOW_SETUP_QR,
    eventHub,
} from "@/common/events.ts";
import {
    // findAttrFromParent,
    // getLevelStr,
    setLevelClass,
    setStyle,
    visibleOnly,
    type OnSavedHandler,
    type OnSavedHandlerFunc,
    type OnUpdateFunc,
    type OnUpdateResult,
    type DeferredPageElement,
    type PageFunctions,
    type UpdateFunction,
} from "./SettingPane.ts";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { JournalSyncCore } from "@vrtmrz/livesync-commonlib/compat/replication/journal/JournalSyncCore";
import { MinioStorageAdapter } from "@vrtmrz/livesync-commonlib/compat/replication/journal/objectstore/MinioStorageAdapter";
import { closeObsidianSettings } from "@/common/obsidianSettings.ts";
import {
    createAdvancedSettingDefinitionGroups,
    createExtraMenuSettingDefinitions,
    createGeneralSettingDefinitionGroups,
    createSettingsPageCatalogue,
    getSettingsRootGroupEntry,
    type SettingsPageEntry,
    type SettingsRootGroupId,
} from "./SettingsPageCatalogue.ts";
import { createAdvancedSettingSpecGroups } from "./AdvancedSettingSpecs.ts";
import { isValidSettingSpecValue, type SettingSpec } from "./SettingSpec.ts";
import type {
    SettingDefinitionAction,
    SettingDefinitionGroup,
    SettingDefinitionItem,
    SettingDefinitionPage,
    SettingGroupItem,
} from "obsidian";
import { createExtraMenuSettingSpecGroup, createGeneralSettingSpecGroups } from "./GeneralSettingSpecs.ts";
import { SetupManager } from "@/modules/features/SetupManager.ts";
import { isP2PMainRemote } from "@/common/remoteConfiguration.ts";

// For creating a document
// const toc = new Set<string>();

export class ObsidianLiveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianLiveSyncPlugin;
    private _lifetimeComponent?: Component;
    private activePageRefresh?: () => void;
    get lifetimeComponent(): Component {
        if (!this._lifetimeComponent) {
            throw new Error("The settings page render scope has not been initialised");
        }
        return this._lifetimeComponent;
    }
    get core() {
        return this.plugin.core;
    }
    get services() {
        return this.core.services;
    }
    selectedScreen = "";

    _editingSettings?: AllSettings;
    // Buffered Settings for editing
    get editingSettings(): AllSettings {
        if (!this._editingSettings) {
            this.reloadAllSettings();
        }
        return this._editingSettings!;
    }
    set editingSettings(v) {
        if (!this._editingSettings) {
            this.reloadAllSettings();
        }
        this._editingSettings = v;
    }

    // Buffered Settings for comparing.
    initialSettings?: typeof this.editingSettings;

    private copySettingValue(target: object | undefined, source: object, key: AllSettingItemKey): void {
        if (!target) {
            throw new Error("Initial settings have not been loaded");
        }
        const value: unknown = Reflect.get(source, key);
        Reflect.set(target, key, value);
    }

    /**
     * Apply editing setting to the plug-in.
     * @param keys setting keys for applying
     */
    applySetting(keys: AllSettingItemKey[]) {
        for (const k of keys) {
            if (!this.isDirty(k)) continue;
            if (k in OnDialogSettingsDefault) {
                // //@ts-ignore
                // this.initialSettings[k] = this.editingSettings[k];
                continue;
            }
            this.copySettingValue(this.core.settings, this.editingSettings, k);
            this.copySettingValue(this.initialSettings, this.core.settings, k);
        }
        keys.forEach((e) => this.refreshSetting(e));
    }
    applyAllSettings() {
        const changedKeys = (Object.keys(this.editingSettings ?? {}) as AllSettingItemKey[]).filter((e) =>
            this.isDirty(e)
        );
        this.applySetting(changedKeys);
        this.reloadAllSettings();
    }

    async saveLocalSetting(key: keyof typeof OnDialogSettingsDefault) {
        if (key == "configPassphrase") {
            compatGlobal.localStorage.setItem("ls-setting-passphrase", this.editingSettings?.[key] ?? "");
            return await Promise.resolve();
        }
        if (key == "deviceAndVaultName") {
            this.services.setting.setDeviceAndVaultName(this.editingSettings?.[key] ?? "");
            this.services.setting.saveDeviceAndVaultName();
            return await Promise.resolve();
        }
    }
    /**
     * Apply and save setting to the plug-in.
     * @param keys setting keys for applying
     */
    async saveSettings(keys: AllSettingItemKey[]) {
        let hasChanged = false;
        const appliedKeys = [] as AllSettingItemKey[];
        for (const k of keys) {
            if (!this.isDirty(k)) continue;
            appliedKeys.push(k);
            if (k in OnDialogSettingsDefault) {
                await this.saveLocalSetting(k as keyof OnDialogSettings);
                this.copySettingValue(this.initialSettings, this.editingSettings, k);
                continue;
            }
            this.copySettingValue(this.core.settings, this.editingSettings, k);
            this.copySettingValue(this.initialSettings, this.core.settings, k);
            hasChanged = true;
        }

        if (hasChanged) {
            await this.services.setting.saveSettingData();
        }

        // if (runOnSaved) {
        const handlers = this.onSavedHandlers
            .filter((e) => appliedKeys.indexOf(e.key) !== -1)
            .map((e) => Promise.resolve(e.handler(this.editingSettings[e.key])));
        await Promise.all(handlers);
        // }
        keys.forEach((e) => this.refreshSetting(e));
    }

    /**
     * Apply all editing setting to the plug-in.
     * @param keys setting keys for applying
     */
    async saveAllDirtySettings() {
        const changedKeys = (Object.keys(this.editingSettings ?? {}) as AllSettingItemKey[]).filter((e) =>
            this.isDirty(e)
        );
        await this.saveSettings(changedKeys);
        this.reloadAllSettings();
    }

    /**
     * Invalidate buffered value and fetch the latest.
     */
    requestUpdate() {
        scheduleTask("update-setting", 10, () => {
            for (const setting of this.settingComponents) {
                setting._onUpdate();
            }
            for (const func of this.controlledElementFunc) {
                func();
            }
            if (requireApiVersion("1.13.0") && typeof this.refreshDomState === "function") {
                this.refreshDomState();
            }
        });
    }

    /** Re-render the active imperative page without assuming which settings renderer owns it. */
    requestPageRefresh() {
        if (this.activePageRefresh) {
            this.activePageRefresh();
            return;
        }
        if (requireApiVersion("1.13.0") && typeof SettingPage === "function" && typeof this.update === "function") {
            this.update();
            return;
        }
        this.displayImperative();
    }

    /** Rebuild the native page catalogue and preserve the current imperative page where possible. */
    requestCatalogueRefresh() {
        if (requireApiVersion("1.13.0") && typeof SettingPage === "function" && typeof this.update === "function") {
            const refreshPage = this.activePageRefresh;
            const owner = this._lifetimeComponent;
            this.update();
            if (owner && this._lifetimeComponent === owner) {
                refreshPage?.();
            }
        } else {
            this.displayImperative();
        }
    }

    reloadAllLocalSettings() {
        const ret = { ...OnDialogSettingsDefault };
        ret.configPassphrase = compatGlobal.localStorage.getItem("ls-setting-passphrase") || "";
        ret.preset = "";
        ret.deviceAndVaultName = this.services.setting.getDeviceAndVaultName();
        return ret;
    }
    computeAllLocalSettings(): Partial<OnDialogSettings> {
        const syncMode = this.editingSettings?.liveSync
            ? "LIVESYNC"
            : this.editingSettings?.periodicReplication
              ? "PERIODIC"
              : "ONEVENTS";
        return {
            syncMode,
        };
    }
    /**
     * Reread all settings and request invalidate
     */
    reloadAllSettings(skipUpdate: boolean = false) {
        const localSetting = this.reloadAllLocalSettings();
        this._editingSettings = { ...this.core.settings, ...localSetting };
        this._editingSettings = { ...this.editingSettings, ...this.computeAllLocalSettings() };
        this.initialSettings = { ...this.editingSettings };
        if (!skipUpdate) this.requestUpdate();
    }

    /**
     * Reread each setting and request invalidate
     */
    refreshSetting(key: AllSettingItemKey) {
        const localSetting = this.reloadAllLocalSettings();
        if (key in this.core.settings) {
            if (key in localSetting) {
                this.copySettingValue(this.initialSettings, localSetting, key);
                this.copySettingValue(this.editingSettings, localSetting, key);
            } else {
                this.copySettingValue(this.initialSettings, this.core.settings, key);
                this.copySettingValue(this.editingSettings, this.initialSettings ?? {}, key);
            }
        }
        this.editingSettings = { ...this.editingSettings, ...this.computeAllLocalSettings() };
        // this.initialSettings = { ...this.initialSettings };
        this.requestUpdate();
    }

    isDirty(key: AllSettingItemKey) {
        return isObjectDifferent(this.editingSettings[key], this.initialSettings?.[key]);
    }
    isSomeDirty(keys: AllSettingItemKey[]) {
        // if (debug) {
        //     console.dir(keys);
        //     console.dir(keys.map(e => this.isDirty(e)));
        // }
        return keys.some((e) => this.isDirty(e));
    }

    isConfiguredAs(key: AllStringItemKey, value: string): boolean;
    isConfiguredAs(key: AllNumericItemKey, value: number): boolean;
    isConfiguredAs(key: AllBooleanItemKey, value: boolean): boolean;
    isConfiguredAs(key: AllSettingItemKey, value: AllSettings[typeof key]) {
        if (!this.editingSettings) {
            return false;
        }
        return this.editingSettings[key] == value;
    }
    // UI Element Wrapper -->
    settingComponents = [] as Setting[];
    controlledElementFunc = [] as UpdateFunction[];
    onSavedHandlers = [] as OnSavedHandler<AllSettingItemKey>[];

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        Setting.env = this;
        eventHub.onEvent(EVENT_REQUEST_RELOAD_SETTING_TAB, () => {
            this.requestReload();
        });
        this.addOnSaved("displayLanguage", () => this.requestCatalogueRefresh());
        this.addOnSaved("showStatusOnEditor", () => eventHub.emitEvent(EVENT_ON_UNRESOLVED_ERROR));
        this.addOnSaved("networkWarningStyle", () => eventHub.emitEvent(EVENT_ON_UNRESOLVED_ERROR));
        this.addOnSaved("useAdvancedMode", () => this.requestCatalogueRefresh());
        this.addOnSaved("usePowerUserMode", () => this.requestCatalogueRefresh());
        this.addOnSaved("useEdgeCaseMode", () => this.requestCatalogueRefresh());
    }

    async testConnection(settingOverride: Partial<ObsidianLiveSyncSettings> = {}): Promise<void> {
        const trialSetting = { ...this.editingSettings, ...settingOverride };
        const replicator = await this.services.replicator.getNewReplicator(trialSetting);
        if (!replicator) {
            Logger("No replicator available for the current settings.", LOG_LEVEL_NOTICE);
            return;
        }
        await replicator.tryConnectRemote(trialSetting);
        const status = await replicator.getRemoteStatus(trialSetting);
        if (status) {
            if (status.estimatedSize) {
                Logger(
                    $msg("obsidianLiveSyncSettingTab.logEstimatedSize", {
                        size: sizeToHumanReadable(status.estimatedSize),
                    }),
                    LOG_LEVEL_NOTICE
                );
            }
        }
    }

    closeSetting() {
        closeObsidianSettings(this.plugin.app);
    }

    requestOpenSetupURI(): void {
        this.closeSetting();
        eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
    }

    async rerunOnboardingWizard(): Promise<void> {
        await this.core.getModule(SetupManager).startOnBoarding();
    }

    async enableLiveSyncFromSettings(): Promise<void> {
        this.editingSettings.isConfigured = true;
        await this.saveAllDirtySettings();
        this.services.appLifecycle.askRestart();
    }

    requestCopySetupURI(): void {
        eventHub.emitEvent(EVENT_REQUEST_COPY_SETUP_URI);
    }

    requestShowSetupQRCode(): void {
        eventHub.emitEvent(EVENT_REQUEST_SHOW_SETUP_QR);
    }

    handleElement(element: HTMLElement, func: OnUpdateFunc) {
        const updateFunc = ((element, func) => {
            const prev = {} as OnUpdateResult;
            return () => {
                const newValue = func();
                const keys = Object.keys(newValue) as [keyof OnUpdateResult];
                for (const k of keys) {
                    if (prev[k] !== newValue[k]) {
                        if (k == "visibility") {
                            element.toggleClass("sls-setting-hidden", !(newValue[k] || false));
                        }
                        //@ts-ignore
                        prev[k] = newValue[k];
                    }
                }
            };
        })(element, func);
        this.controlledElementFunc.push(updateFunc);
        updateFunc();
    }

    createEl<T extends keyof HTMLElementTagNameMap>(
        el: HTMLElement,
        tag: T,
        o?: string | DomElementInfo,
        callback?: (el: HTMLElementTagNameMap[T]) => void,
        func?: OnUpdateFunc
    ) {
        const element = el.createEl(tag, o, callback);
        if (func) this.handleElement(element, func);
        return element;
    }

    addEl<T extends keyof HTMLElementTagNameMap>(
        el: HTMLElement,
        tag: T,
        o?: string | DomElementInfo,
        callback?: (el: HTMLElementTagNameMap[T]) => void,
        func?: OnUpdateFunc
    ) {
        const elm = this.createEl(el, tag, o, callback, func);
        return Promise.resolve(elm);
    }

    addOnSaved<T extends AllSettingItemKey>(key: T, func: OnSavedHandlerFunc<T>) {
        const newHandler = { key, handler: func } as OnSavedHandler<AllSettingItemKey>;
        const existing = this.onSavedHandlers.findIndex((handler) => handler.key === key);
        if (existing === -1) {
            this.onSavedHandlers.push(newHandler);
        } else {
            this.onSavedHandlers.splice(existing, 1, newHandler);
        }
    }
    resetEditingSettings() {
        this._editingSettings = undefined;
        this.initialSettings = undefined;
    }

    override hide() {
        this.disposeRenderScope();
        super.hide();
        this.isShown = false;
    }
    isShown: boolean = false;

    private changesPageCatalogue(key: AllSettingItemKey): boolean {
        return (
            key === "displayLanguage" ||
            key === "useAdvancedMode" ||
            key === "usePowerUserMode" ||
            key === "useEdgeCaseMode" ||
            key === "isConfigured" ||
            key === "liveSync" ||
            key === "periodicReplication" ||
            key === "syncOnSave" ||
            key === "syncOnEditorSave" ||
            key === "syncOnStart" ||
            key === "syncOnFileOpen" ||
            key === "syncAfterMerge"
        );
    }

    requestReload() {
        const nativeTabIsShown =
            this.supportsDeclarativeSettings() && this.containerEl !== undefined && this.containerEl.isShown();
        if (this.isShown || nativeTabIsShown) {
            const newConf = this.core.settings;
            const keys = Object.keys(newConf) as (keyof ObsidianLiveSyncSettings)[];
            let hasLoaded = false;
            let catalogueVisibilityChanged = false;
            for (const k of keys) {
                if (isObjectDifferent(newConf[k], this.initialSettings?.[k])) {
                    // Something has changed
                    if (this.isDirty(k as AllSettingItemKey)) {
                        // And modified.
                        this.core.confirm.askInPopup(
                            `config-reloaded-${k}`,
                            $msg("obsidianLiveSyncSettingTab.msgSettingModified", {
                                setting: getConfName(k as AllSettingItemKey),
                            }),
                            (anchor) => {
                                anchor.text = $msg("obsidianLiveSyncSettingTab.optionHere");
                                anchor.addEventListener("click", () => {
                                    this.refreshSetting(k as AllSettingItemKey);
                                    if (this.changesPageCatalogue(k as AllSettingItemKey)) {
                                        this.requestCatalogueRefresh();
                                    } else {
                                        this.requestPageRefresh();
                                    }
                                });
                            }
                        );
                    } else {
                        // not modified
                        this.refreshSetting(k as AllSettingItemKey);
                        if (k in OnDialogSettingsDefault) {
                            continue;
                        }
                        hasLoaded = true;
                        if (this.changesPageCatalogue(k as AllSettingItemKey)) {
                            catalogueVisibilityChanged = true;
                        }
                    }
                }
            }
            if (hasLoaded) {
                if (catalogueVisibilityChanged) {
                    this.requestCatalogueRefresh();
                } else {
                    this.requestPageRefresh();
                }
            } else {
                this.requestUpdate();
            }
        } else {
            this.reloadAllSettings(true);
        }
    }

    screenElements: { [key: string]: HTMLElement[] } = {};
    changeDisplay(screen: string) {
        for (const k in this.screenElements) {
            if (k == screen) {
                this.screenElements[k].forEach((element) => element.removeClass("setting-collapsed"));
            } else {
                this.screenElements[k].forEach((element) => element.addClass("setting-collapsed"));
            }
        }
        if (this.menuEl) {
            this.menuEl.querySelectorAll(`.sls-setting-label`).forEach((element) => {
                if (element.hasClass(`c-${screen}`)) {
                    element.addClass("selected");
                    element.querySelector<HTMLInputElement>("input[type=radio]")!.checked = true;
                } else {
                    element.removeClass("selected");
                    element.querySelector<HTMLInputElement>("input[type=radio]")!.checked = false;
                }
            });
        }
        this.selectedScreen = screen;
    }
    menuEl?: HTMLElement;

    addScreenElement(key: string, element: HTMLElement) {
        if (!(key in this.screenElements)) {
            this.screenElements[key] = [];
        }
        this.screenElements[key].push(element);
    }

    selectPane(event: Event) {
        const target = event.target as HTMLElement;
        if (target.tagName == "INPUT") {
            const value = target.getAttribute("value");
            if (value && this.selectedScreen != value) {
                this.changeDisplay(value);
            }
        }
    }

    isNeedRebuildLocal() {
        return this.isSomeDirty([
            "useIndexedDBAdapter",
            "handleFilenameCaseSensitive",
            "passphrase",
            "useDynamicIterationCount",
            "usePathObfuscation",
            "encrypt",
            // "remoteType",
        ]);
    }
    isNeedRebuildRemote() {
        return this.isSomeDirty([
            "handleFilenameCaseSensitive",
            "passphrase",
            "useDynamicIterationCount",
            "usePathObfuscation",
            "encrypt",
        ]);
    }
    isLiveSyncConfigured() {
        return this.isConfiguredAs("isConfigured", true);
    }

    private supportsDeclarativeSettings(): boolean {
        return requireApiVersion("1.13.0") && typeof SettingPage === "function";
    }

    private isPageVisible(level?: ConfigLevel): boolean {
        if (level === LEVEL_ADVANCED) {
            return this.isConfiguredAs("useAdvancedMode", true);
        }
        if (level === LEVEL_POWER_USER) {
            return this.isConfiguredAs("usePowerUserMode", true);
        }
        if (level === LEVEL_EDGE_CASE) {
            return this.isConfiguredAs("useEdgeCaseMode", true);
        }
        return true;
    }

    private getDeclarativeSettingSpec(key: string): SettingSpec {
        const spec = [
            ...createGeneralSettingSpecGroups({
                showEditorStatusDetails: () => this.isConfiguredAs("showStatusOnEditor", true),
                showVerboseLog: () => this.isConfiguredAs("lessInformationInLog", false),
            }),
            createExtraMenuSettingSpecGroup(),
            ...createAdvancedSettingSpecGroups({
                isCouchDB: () => this.isConfiguredAs("remoteType", REMOTE_COUCHDB),
            }),
        ]
            .flatMap((group) => group.items)
            .find((candidate) => candidate.key === key);
        if (!spec) {
            throw new Error(`Unknown declarative setting key: ${key}`);
        }
        return spec;
    }

    override getControlValue(key: string): unknown {
        const spec = this.getDeclarativeSettingSpec(key);
        return this.editingSettings[spec.key];
    }

    override async setControlValue(key: string, value: unknown): Promise<void> {
        const spec = this.getDeclarativeSettingSpec(key);
        if (!isValidSettingSpecValue(spec, value)) {
            throw new TypeError(`Invalid value for declarative setting ${key}`);
        }
        Reflect.set(this.editingSettings, spec.key, value);
        await this.saveSettings([spec.key]);
    }

    private createRebuildRequiredAction(): SettingDefinitionAction {
        return {
            name: $msg("obsidianLiveSyncSettingTab.optionApply"),
            desc: $msg("obsidianLiveSyncSettingTab.msgChangesNeedToBeApplied"),
            visible: () => this.isNeedRebuildLocal() || this.isNeedRebuildRemote(),
            action: () => fireAndForget(async () => await this.confirmRebuild()),
        };
    }

    private renderRebuildRequiredAction(parentEl: HTMLElement): void {
        this.createEl(
            parentEl,
            "div",
            { cls: "sls-setting-menu-buttons" },
            (el) => {
                el.createEl("label", { text: $msg("obsidianLiveSyncSettingTab.msgChangesNeedToBeApplied") });
                void this.addEl(
                    el,
                    "button",
                    { text: $msg("obsidianLiveSyncSettingTab.optionApply"), cls: "mod-warning" },
                    (buttonEl) => {
                        buttonEl.addEventListener("click", () =>
                            fireAndForget(async () => await this.confirmRebuild())
                        );
                    }
                );
            },
            visibleOnly(() => this.isNeedRebuildLocal() || this.isNeedRebuildRemote())
        );
    }

    private addPanel(
        parentEl: HTMLElement,
        title: string,
        callback?: (el: HTMLDivElement) => void,
        func?: OnUpdateFunc,
        level?: ConfigLevel
    ): DeferredPageElement {
        const owner = this.lifetimeComponent;
        const el = this.createEl(parentEl, "div", { text: "" }, callback, func);
        setLevelClass(el, level);
        this.createEl(el, "h4", { text: title, cls: "sls-setting-panel-title" });
        return this.resolveWithinRenderScope(el, owner);
    }

    /** Run delayed pane construction only while the requesting page still owns the render scope. */
    private resolveWithinRenderScope<T extends HTMLElement>(value: T, owner: Component): DeferredPageElement<T> {
        return {
            then: (callback) => {
                queueMicrotask(() => {
                    if (this._lifetimeComponent === owner) {
                        callback(value);
                    }
                });
            },
        };
    }

    private renderCustomPage(page: SettingPage, entry: SettingsPageEntry): Component {
        if (requireApiVersion("1.13.0")) {
            const component = this.beginRenderScope(() => page.display());
            this.isShown = true;
            page.title = entry.name();
            page.containerEl.empty();
            page.containerEl.addClass("sls-setting");
            setStyle(page.containerEl, "menu-setting-poweruser", () => this.isConfiguredAs("usePowerUserMode", true));
            setStyle(page.containerEl, "menu-setting-advanced", () => this.isConfiguredAs("useAdvancedMode", true));
            setStyle(page.containerEl, "menu-setting-edgecase", () => this.isConfiguredAs("useEdgeCaseMode", true));
            this.renderRebuildRequiredAction(page.containerEl);

            const addPane: PageFunctions["addPane"] = (parentEl, title, _icon, _order, level) => {
                const paneEl = this.createEl(parentEl, "div", { text: "" });
                setLevelClass(paneEl, level);
                new Setting(paneEl).setName(title).setHeading().setClass("sls-setting-pane-title");
                return this.resolveWithinRenderScope(paneEl, component);
            };
            entry.legacy.call(this, page.containerEl, {
                addPane,
                addPanel: this.addPanel.bind(this),
            });
            this.requestUpdate();
            return component;
        }
        throw new Error("Custom settings pages require Obsidian 1.13.0 or later");
    }

    private createCustomSettingPage(entry: SettingsPageEntry): SettingPage {
        if (requireApiVersion("1.13.0") && typeof SettingPage === "function") {
            const renderCustomPage = this.renderCustomPage.bind(this);
            const disposeRenderScope = this.disposeRenderScope.bind(this);
            return new (class extends SettingPage {
                private scope?: Component;
                override title = entry.name();

                override display(): void {
                    this.scope = renderCustomPage(this, entry);
                }

                override hide(): void {
                    disposeRenderScope(this.scope);
                    this.scope = undefined;
                    super.hide();
                }
            })();
        }
        throw new Error("Custom settings pages require Obsidian 1.13.0 or later");
    }

    private createDeclarativePage(entry: SettingsPageEntry): SettingDefinitionPage {
        const page: SettingDefinitionPage = {
            type: "page",
            name: `${entry.icon} ${entry.name()}`,
            visible: () => this.isPageVisible(entry.level),
        };
        if (entry.content === "native") {
            page.items = [
                this.createRebuildRequiredAction(),
                ...createAdvancedSettingDefinitionGroups({
                    isCouchDB: () => this.isConfiguredAs("remoteType", REMOTE_COUCHDB),
                }),
            ];
        } else {
            page.page = () => this.createCustomSettingPage(entry);
        }
        return page;
    }

    private createGeneralSettingsGroup(): SettingDefinitionGroup {
        const groups = createGeneralSettingDefinitionGroups({
            showEditorStatusDetails: () => this.isConfiguredAs("showStatusOnEditor", true),
            showVerboseLog: () => this.isConfiguredAs("lessInformationInLog", false),
        });
        const [appearance, logging] = groups;
        if (!appearance || !logging) {
            throw new Error("General settings must define Appearance and Logging groups");
        }
        return this.createRootGroup("general-settings", [
            {
                type: "page",
                name: `🎨 ${appearance.heading}`,
                items: appearance.items,
            },
            {
                type: "page",
                name: `📝 ${logging.heading}`,
                items: logging.items,
            },
            this.createExtraMenusPage(),
        ]);
    }

    private createExtraMenusPage(): SettingDefinitionPage {
        return {
            type: "page",
            name: `🎚️ ${$msg("obsidianLiveSyncSettingTab.titleExtraMenus")}`,
            items: createExtraMenuSettingDefinitions(),
        };
    }

    private createQuickSetupGroup(): SettingDefinitionGroup {
        return this.createRootGroup("quick-setup", [
            {
                name: $msg("obsidianLiveSyncSettingTab.nameConnectSetupURI"),
                desc: $msg("obsidianLiveSyncSettingTab.descConnectSetupURI"),
                action: () => this.requestOpenSetupURI(),
            },
            {
                name: $msg("Rerun Onboarding Wizard"),
                desc: $msg("Rerun the onboarding wizard to set up Self-hosted LiveSync again."),
                action: () => fireAndForget(async () => await this.rerunOnboardingWizard()),
            },
            {
                name: $msg("obsidianLiveSyncSettingTab.nameEnableLiveSync"),
                desc: $msg("obsidianLiveSyncSettingTab.descEnableLiveSync"),
                visible: () => !this.isConfiguredAs("isConfigured", true),
                action: () => fireAndForget(async () => await this.enableLiveSyncFromSettings()),
            },
        ]);
    }

    private createRootGroup(
        id: SettingsRootGroupId,
        items: SettingGroupItem[],
        visible?: () => boolean
    ): SettingDefinitionGroup {
        const { icon, name } = getSettingsRootGroupEntry(id);
        return {
            type: "group",
            heading: `${icon} ${name()}`,
            items,
            ...(visible ? { visible } : {}),
        };
    }

    private createSetupOtherDevicesGroup(): SettingDefinitionGroup {
        return this.createRootGroup(
            "setup-other-devices",
            [
                {
                    name: $msg("obsidianLiveSyncSettingTab.nameCopySetupURI"),
                    desc: $msg("obsidianLiveSyncSettingTab.descCopySetupURI"),
                    action: () => this.requestCopySetupURI(),
                },
                {
                    name: $msg("Setup.ShowQRCode"),
                    desc: $msg("Setup.ShowQRCode.Desc"),
                    action: () => this.requestShowSetupQRCode(),
                },
            ],
            () => this.isConfiguredAs("isConfigured", true)
        );
    }

    override getSettingDefinitions(): SettingDefinitionItem[] {
        if (!this.supportsDeclarativeSettings()) {
            return [];
        }
        const catalogue = createSettingsPageCatalogue();
        const getPage = (id: string): SettingDefinitionPage => {
            const entry = catalogue.find((candidate) => candidate.id === id);
            if (!entry) {
                throw new Error(`Unknown settings page: ${id}`);
            }
            return this.createDeclarativePage(entry);
        };
        const synchronisation = this.createRootGroup("synchronisation", [
            getPage("remote-configuration"),
            getPage("synchronisation"),
        ]);
        const generalSettings = this.createGeneralSettingsGroup();
        const quickSetup = this.createQuickSetupGroup();
        const setupOtherDevices = this.createSetupOtherDevicesGroup();
        const maintenance = this.createRootGroup("maintenance-and-recovery", [
            getPage("maintenance"),
            getPage("hatch"),
        ]);
        const extraFeatures = this.createRootGroup(
            "extra-features",
            [getPage("selector"), getPage("customisation-sync")],
            () => this.isPageVisible(LEVEL_ADVANCED)
        );
        const advancedSettings = this.createRootGroup(
            "advanced-settings",
            [getPage("advanced"), getPage("power-users"), getPage("patches")],
            () =>
                this.isPageVisible(LEVEL_ADVANCED) ||
                this.isPageVisible(LEVEL_POWER_USER) ||
                this.isPageVisible(LEVEL_EDGE_CASE)
        );
        const helpAndInformation = this.createRootGroup("help-and-information", [
            getPage("help"),
            getPage("change-log"),
        ]);
        const laterGroups = [maintenance, extraFeatures, advancedSettings, helpAndInformation];

        const pendingInitialisation = this.createRebuildRequiredAction();
        if (this.isLiveSyncConfigured()) {
            return [
                pendingInitialisation,
                synchronisation,
                generalSettings,
                setupOtherDevices,
                quickSetup,
                ...laterGroups,
            ];
        }
        return [pendingInitialisation, quickSetup, synchronisation, generalSettings, setupOtherDevices, ...laterGroups];
    }

    private beginRenderScope(refresh: () => void): Component {
        this.disposeRenderScope();
        const component = new Component();
        this._lifetimeComponent = component;
        this.activePageRefresh = refresh;
        this.settingComponents.length = 0;
        this.controlledElementFunc.length = 0;
        component.load();
        return component;
    }

    private disposeRenderScope(owner?: Component): void {
        if (owner && this._lifetimeComponent !== owner) {
            return;
        }
        this._lifetimeComponent?.unload();
        this._lifetimeComponent = undefined;
        this.activePageRefresh = undefined;
        this.settingComponents.length = 0;
        this.controlledElementFunc.length = 0;
    }

    onlyOnP2POrCouchDB = () =>
        ({
            visibility:
                this.isConfiguredAs("remoteType", REMOTE_P2P) || this.isConfiguredAs("remoteType", REMOTE_COUCHDB),
        }) as OnUpdateResult;

    onlyOnCouchDB = () =>
        ({
            visibility: this.isConfiguredAs("remoteType", REMOTE_COUCHDB),
        }) as OnUpdateResult;
    onlyOnMinIO = () =>
        ({
            visibility: this.isConfiguredAs("remoteType", REMOTE_MINIO),
        }) as OnUpdateResult;
    onlyOnOnlyP2P = () =>
        ({
            visibility: this.isConfiguredAs("remoteType", REMOTE_P2P),
        }) as OnUpdateResult;
    onlyOnCouchDBOrMinIO = () =>
        ({
            visibility:
                this.isConfiguredAs("remoteType", REMOTE_COUCHDB) || this.isConfiguredAs("remoteType", REMOTE_MINIO),
        }) as OnUpdateResult;
    // E2EE Function
    checkWorkingPassphrase = async (): Promise<boolean> => {
        if (this.editingSettings.remoteType == REMOTE_MINIO) return true;

        const settingForCheck: RemoteDBSettings = {
            ...this.editingSettings,
        };
        const replicator = this.services.replicator.getNewReplicator(settingForCheck);
        if (!(replicator instanceof LiveSyncCouchDBReplicator)) return true;

        const db = await replicator.connectRemoteCouchDBWithSetting(
            settingForCheck,
            this.services.API.isMobile(),
            true
        );
        if (typeof db === "string") {
            Logger($msg("obsidianLiveSyncSettingTab.logCheckPassphraseFailed", { db }), LOG_LEVEL_NOTICE);
            return false;
        }
        try {
            if (await checkSyncInfo(db.db)) {
                // Logger($msg("obsidianLiveSyncSettingTab.logDatabaseConnected"), LOG_LEVEL_NOTICE);
                return true;
            } else {
                Logger($msg("obsidianLiveSyncSettingTab.logPassphraseNotCompatible"), LOG_LEVEL_NOTICE);
                return false;
            }
        } finally {
            await db.db.close();
        }
    };
    isPassphraseValid = async () => {
        if (this.editingSettings.encrypt && this.editingSettings.passphrase == "") {
            Logger($msg("obsidianLiveSyncSettingTab.logEncryptionNoPassphrase"), LOG_LEVEL_NOTICE);
            return false;
        }
        if (this.editingSettings.encrypt && !(await testCrypt())) {
            Logger($msg("obsidianLiveSyncSettingTab.logEncryptionNoSupport"), LOG_LEVEL_NOTICE);
            return false;
        }
        return true;
    };

    rebuildDB = async (method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice" | "localOnlyWithChunks") => {
        if (this.editingSettings.encrypt && this.editingSettings.passphrase == "") {
            Logger($msg("obsidianLiveSyncSettingTab.logEncryptionNoPassphrase"), LOG_LEVEL_NOTICE);
            return;
        }
        if (this.editingSettings.encrypt && !(await testCrypt())) {
            Logger($msg("obsidianLiveSyncSettingTab.logEncryptionNoSupport"), LOG_LEVEL_NOTICE);
            return;
        }
        if (!this.editingSettings.encrypt) {
            this.editingSettings.passphrase = "";
        }
        this.applyAllSettings();
        await this.services.setting.suspendAllSync();
        await this.services.setting.suspendExtraSync();
        this.reloadAllSettings();
        this.editingSettings.isConfigured = true;
        Logger($msg("obsidianLiveSyncSettingTab.logRebuildNote"), LOG_LEVEL_NOTICE);
        await this.saveAllDirtySettings();
        this.closeSetting();
        await delay(2000);
        await this.core.rebuilder.$performRebuildDB(method);
    };
    async confirmRebuild() {
        if (!(await this.isPassphraseValid())) {
            Logger(`Passphrase is not valid, please fix it.`, LOG_LEVEL_NOTICE);
            return;
        }
        const keepEditing = $msg("Ui.SetupWizard.ApplySettingsInitialisation.KeepEditing");
        const setupManager = this.core.getModule(SetupManager);
        const result = await setupManager.applySettingsWithInitialisationChoice({
            isP2P: isP2PMainRemote(this.editingSettings),
            validateChoice: async (mode) => {
                if (mode !== "fetch" || (await this.checkWorkingPassphrase())) {
                    return true;
                }
                const continueFetch = $msg("Ui.SetupWizard.ApplySettingsInitialisation.ContinueFetch");
                return (
                    (await this.core.confirm.confirmWithMessage(
                        $msg("Ui.SetupWizard.ApplySettingsInitialisation.RemoteVerificationTitle"),
                        $msg("Ui.SetupWizard.ApplySettingsInitialisation.RemoteVerificationGuidance"),
                        [continueFetch, keepEditing],
                        keepEditing
                    )) === continueFetch
                );
            },
            applySettings: async () => {
                if (!this.editingSettings.encrypt) {
                    this.editingSettings.passphrase = "";
                }
                await this.saveAllDirtySettings();
            },
        });
        if (result.result === "scheduled") {
            this.closeSetting();
            return;
        }
        if (result.result === "failed") {
            return;
        }

        const applyWithoutInitialisation = $msg(
            "Ui.SetupWizard.ApplySettingsInitialisation.ApplyWithoutInitialisation"
        );
        const fallback = await this.core.confirm.confirmWithMessage(
            $msg("Ui.SetupWizard.ApplySettingsInitialisation.BypassTitle"),
            $msg("Ui.SetupWizard.ApplySettingsInitialisation.BypassGuidance"),
            [applyWithoutInitialisation, keepEditing],
            keepEditing
        );
        if (fallback === applyWithoutInitialisation) {
            if (!this.editingSettings.encrypt) {
                this.editingSettings.passphrase = "";
            }
            await this.saveAllDirtySettings();
        }
    }

    // The imperative renderer remains required by the declared Obsidian 1.7.2 minimum version.
    override display(): void {
        this.displayImperative();
    }

    private displayImperative(): void {
        const changeDisplay = this.changeDisplay.bind(this);
        // Make sure the page-owned component is loaded for markdown rendering in panes.
        this.beginRenderScope(() => this.displayImperative());
        const { containerEl } = this;
        this.screenElements = {};
        if (this._editingSettings == undefined || this.initialSettings == undefined) {
            this.reloadAllSettings();
        }
        if (this.editingSettings === undefined || this.initialSettings == undefined) {
            return;
        }
        this.isShown = true;

        containerEl.empty();

        containerEl.addClass("sls-setting");

        setStyle(containerEl, "menu-setting-poweruser", () => this.isConfiguredAs("usePowerUserMode", true));
        setStyle(containerEl, "menu-setting-advanced", () => this.isConfiguredAs("useAdvancedMode", true));
        setStyle(containerEl, "menu-setting-edgecase", () => this.isConfiguredAs("useEdgeCaseMode", true));

        // const addScreenElement = (key: string, element: HTMLElement) => addScreenElement.bind(this)(key, element);
        const menuWrapper = this.createEl(containerEl, "div", { cls: "sls-setting-menu-wrapper" });

        if (this.menuEl) {
            this.menuEl.remove();
        }
        this.menuEl = menuWrapper.createDiv("");
        this.menuEl.addClass("sls-setting-menu");
        const menuTabs = this.menuEl.querySelectorAll(".sls-setting-label");

        this.renderRebuildRequiredAction(menuWrapper);

        // let paneNo = 0;
        const addPane = (parentEl: HTMLElement, title: string, icon: string, order: number, level?: ConfigLevel) => {
            const owner = this.lifetimeComponent;
            const el = this.createEl(parentEl, "div", { text: "" });

            setLevelClass(el, level);
            new Setting(el).setName(title).setHeading().setClass("sls-setting-pane-title");
            if (this.menuEl) {
                this.menuEl.createEl("label", { cls: `sls-setting-label c-${order}` }, (el) => {
                    setLevelClass(el, level);
                    const inputEl = el.createEl("input", {
                        type: "radio",
                        name: "disp",
                        value: `${order}`,
                        cls: "sls-setting-tab",
                    } as DomElementInfo);
                    el.createDiv({
                        cls: "sls-setting-menu-btn",
                        text: icon,
                        title: title,
                    });
                    inputEl.addEventListener("change", (evt) => this.selectPane(evt));
                    inputEl.addEventListener("click", (evt) => this.selectPane(evt));
                });
            }
            this.addScreenElement(`${order}`, el);
            return this.resolveWithinRenderScope(el, owner);
        };
        // const panelNoMap = {} as { [key: string]: number };
        const addPanel = this.addPanel.bind(this);

        menuTabs.forEach((element) => {
            const e = element.querySelector(".sls-setting-tab");
            if (!e) return;
            e.addEventListener("change", (event) => {
                menuTabs.forEach((element) => element.removeClass("selected"));
                this.changeDisplay((event.currentTarget as HTMLInputElement).value);
                element.addClass("selected");
            });
        });

        // Panes

        const bindPane = (
            paneFunc: (this: ObsidianLiveSyncSettingTab, paneEl: HTMLElement, funcs: PageFunctions) => void
        ): ((paneEl: HTMLElement) => void) => {
            const callback = (paneEl: HTMLElement) => {
                paneFunc.call(this, paneEl, {
                    addPane,
                    addPanel,
                });
            };
            return callback;
        };

        // Add panes

        for (const entry of createSettingsPageCatalogue()) {
            void addPane(containerEl, entry.name(), entry.icon, entry.order, entry.level).then(bindPane(entry.legacy));
        }

        void yieldNextAnimationFrame().then(() => {
            if (this.selectedScreen == "") {
                if (this.isLiveSyncConfigured()) {
                    changeDisplay("20");
                } else {
                    changeDisplay("110");
                }
            } else {
                changeDisplay(this.selectedScreen);
            }
            this.requestUpdate();
        });
    }

    getMinioJournalSyncClient() {
        // return new JournalSyncMinio(this.core.settings, this.core.simpleStore, this.core);
        // const settings = this.editingSettings as ObsidianLiveSyncSettings;
        return new JournalSyncCore(
            this.core.settings,
            this.core.simpleStore,
            this.core,
            new MinioStorageAdapter(this.core.settings, this.core)
        );
    }
    async resetRemoteBucket() {
        const minioJournal = this.getMinioJournalSyncClient();
        await minioJournal.resetBucket();
    }
}
