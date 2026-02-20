import { App, PluginSettingTab } from "../../../deps.ts";
import {
    type ObsidianLiveSyncSettings,
    type RemoteDBSettings,
    LOG_LEVEL_NOTICE,
    FLAGMD_REDFLAG2_HR,
    FLAGMD_REDFLAG3_HR,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    type ConfigLevel,
    LEVEL_POWER_USER,
    LEVEL_ADVANCED,
    LEVEL_EDGE_CASE,
    REMOTE_P2P,
} from "../../../lib/src/common/types.ts";
import { delay, isObjectDifferent, sizeToHumanReadable } from "../../../lib/src/common/utils.ts";
import { versionNumberString2Number } from "../../../lib/src/string_and_binary/convert.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { checkSyncInfo } from "@lib/pouchdb/negotiation.ts";
import { testCrypt } from "octagonal-wheels/encryption/encryption";
import ObsidianLiveSyncPlugin from "../../../main.ts";
import { scheduleTask } from "../../../common/utils.ts";
import { LiveSyncCouchDBReplicator } from "../../../lib/src/replication/couchdb/LiveSyncReplicator.ts";
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
import { $msg } from "../../../lib/src/common/i18n.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { fireAndForget, yieldNextAnimationFrame } from "octagonal-wheels/promises";
import { confirmWithMessage } from "../../coreObsidian/UILib/dialogs.ts";
import { EVENT_REQUEST_RELOAD_SETTING_TAB, eventHub } from "../../../common/events.ts";
import { JournalSyncMinio } from "../../../lib/src/replication/journal/objectstore/JournalSyncMinio.ts";
import { paneChangeLog } from "./PaneChangeLog.ts";
import {
    enableOnly,
    findAttrFromParent,
    getLevelStr,
    setLevelClass,
    setStyle,
    visibleOnly,
    type OnSavedHandler,
    type OnUpdateFunc,
    type OnUpdateResult,
    type PageFunctions,
    type UpdateFunction,
} from "./SettingPane.ts";
import { paneSetup } from "./PaneSetup.ts";
import { paneGeneral } from "./PaneGeneral.ts";
import { paneRemoteConfig } from "./PaneRemoteConfig.ts";
import { paneSelector } from "./PaneSelector.ts";
import { paneSyncSettings } from "./PaneSyncSettings.ts";
import { paneCustomisationSync } from "./PaneCustomisationSync.ts";
import { paneHatch } from "./PaneHatch.ts";
import { paneAdvanced } from "./PaneAdvanced.ts";
import { panePowerUsers } from "./PanePowerUsers.ts";
import { panePatches } from "./PanePatches.ts";
import { paneMaintenance } from "./PaneMaintenance.ts";

// For creating a document
const toc = new Set<string>();
const stubs = {} as {
    [key: string]: { [key: string]: Map<string, Record<string, string>> };
};
export function createStub(name: string, key: string, value: string, panel: string, pane: string) {
    DEV: {
        if (!(pane in stubs)) {
            stubs[pane] = {};
        }
        if (!(panel in stubs[pane])) {
            stubs[pane][panel] = new Map<string, Record<string, string>>();
        }
        const old = stubs[pane][panel].get(name) ?? {};
        stubs[pane][panel].set(name, { ...old, [key]: value });
        scheduleTask("update-stub", 100, () => {
            eventHub.emitEvent("document-stub-created", { toc: toc, stub: stubs });
        });
    }
}

export class ObsidianLiveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianLiveSyncPlugin;
    get services() {
        return this.plugin.services;
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
            //@ts-ignore
            this.plugin.settings[k] = this.editingSettings[k];
            //@ts-ignore
            this.initialSettings[k] = this.plugin.settings[k];
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
            localStorage.setItem("ls-setting-passphrase", this.editingSettings?.[key] ?? "");
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
                //@ts-ignore
                this.initialSettings[k] = this.editingSettings[k];
                continue;
            }
            //@ts-ignore
            this.plugin.settings[k] = this.editingSettings[k];
            //@ts-ignore
            this.initialSettings[k] = this.plugin.settings[k];
            hasChanged = true;
        }

        if (hasChanged) {
            await this.plugin.saveSettings();
        }

        // if (runOnSaved) {
        const handlers = this.onSavedHandlers
            .filter((e) => appliedKeys.indexOf(e.key) !== -1)
            .map((e) => e.handler(this.editingSettings[e.key as AllSettingItemKey]));
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
        });
    }

    reloadAllLocalSettings() {
        const ret = { ...OnDialogSettingsDefault };
        ret.configPassphrase = localStorage.getItem("ls-setting-passphrase") || "";
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
        this._editingSettings = { ...this.plugin.settings, ...localSetting };
        this._editingSettings = { ...this.editingSettings, ...this.computeAllLocalSettings() };
        this.initialSettings = { ...this.editingSettings };
        if (!skipUpdate) this.requestUpdate();
    }

    /**
     * Reread each setting and request invalidate
     */
    refreshSetting(key: AllSettingItemKey) {
        const localSetting = this.reloadAllLocalSettings();
        if (key in this.plugin.settings) {
            if (key in localSetting) {
                //@ts-ignore
                this.initialSettings[key] = localSetting[key];
                //@ts-ignore
                this.editingSettings[key] = localSetting[key];
            } else {
                //@ts-ignore
                this.initialSettings[key] = this.plugin.settings[key];
                //@ts-ignore
                this.editingSettings[key] = this.initialSettings[key];
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
    onSavedHandlers = [] as OnSavedHandler<any>[];

    inWizard: boolean = false;

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        Setting.env = this;
        eventHub.onEvent(EVENT_REQUEST_RELOAD_SETTING_TAB, () => {
            this.requestReload();
        });
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
        // @ts-ignore
        this.plugin.app.setting.close();
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
        o?: string | DomElementInfo | undefined,
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
        o?: string | DomElementInfo | undefined,
        callback?: (el: HTMLElementTagNameMap[T]) => void,
        func?: OnUpdateFunc
    ) {
        const elm = this.createEl(el, tag, o, callback, func);
        return Promise.resolve(elm);
    }

    addOnSaved<T extends AllSettingItemKey>(key: T, func: (value: AllSettings[T]) => Promise<void> | void) {
        this.onSavedHandlers.push({ key, handler: func });
    }
    resetEditingSettings() {
        this._editingSettings = undefined;
        this.initialSettings = undefined;
    }

    override hide() {
        this.isShown = false;
    }
    isShown: boolean = false;

    requestReload() {
        if (this.isShown) {
            const newConf = this.plugin.settings;
            const keys = Object.keys(newConf) as (keyof ObsidianLiveSyncSettings)[];
            let hasLoaded = false;
            for (const k of keys) {
                if (isObjectDifferent(newConf[k], this.initialSettings?.[k])) {
                    // Something has changed
                    if (this.isDirty(k as AllSettingItemKey)) {
                        // And modified.
                        this.plugin.confirm.askInPopup(
                            `config-reloaded-${k}`,
                            $msg("obsidianLiveSyncSettingTab.msgSettingModified", {
                                setting: getConfName(k as AllSettingItemKey),
                            }),
                            (anchor) => {
                                anchor.text = $msg("obsidianLiveSyncSettingTab.optionHere");
                                anchor.addEventListener("click", () => {
                                    this.refreshSetting(k as AllSettingItemKey);
                                    this.display();
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
                    }
                }
            }
            if (hasLoaded) {
                this.display();
            } else {
                this.requestUpdate();
            }
        } else {
            this.reloadAllSettings(true);
        }
    }

    //@ts-ignore
    manifestVersion: string = MANIFEST_VERSION || "-";

    lastVersion = ~~(versionNumberString2Number(this.manifestVersion) / 1000);

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
    async enableMinimalSetup() {
        this.editingSettings.liveSync = false;
        this.editingSettings.periodicReplication = false;
        this.editingSettings.syncOnSave = false;
        this.editingSettings.syncOnEditorSave = false;
        this.editingSettings.syncOnStart = false;
        this.editingSettings.syncOnFileOpen = false;
        this.editingSettings.syncAfterMerge = false;
        this.plugin.replicator.closeReplication();
        await this.saveAllDirtySettings();
        this.containerEl.addClass("isWizard");
        this.inWizard = true;
        this.changeDisplay("20");
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
            "doNotUseFixedRevisionForChunks",
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
            "doNotUseFixedRevisionForChunks",
            "handleFilenameCaseSensitive",
            "passphrase",
            "useDynamicIterationCount",
            "usePathObfuscation",
            "encrypt",
        ]);
    }
    isAnySyncEnabled() {
        if (this.isConfiguredAs("isConfigured", false)) return false;
        if (this.isConfiguredAs("liveSync", true)) return true;
        if (this.isConfiguredAs("periodicReplication", true)) return true;
        if (this.isConfiguredAs("syncOnFileOpen", true)) return true;
        if (this.isConfiguredAs("syncOnSave", true)) return true;
        if (this.isConfiguredAs("syncOnEditorSave", true)) return true;
        if (this.isConfiguredAs("syncOnStart", true)) return true;
        if (this.isConfiguredAs("syncAfterMerge", true)) return true;
        if (this.isConfiguredAs("syncOnFileOpen", true)) return true;
        if (this.plugin?.replicator?.syncStatus == "CONNECTED") return true;
        if (this.plugin?.replicator?.syncStatus == "PAUSED") return true;
        return false;
    }

    enableOnlySyncDisabled = enableOnly(() => !this.isAnySyncEnabled());

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
        } else {
            if (await checkSyncInfo(db.db)) {
                // Logger($msg("obsidianLiveSyncSettingTab.logDatabaseConnected"), LOG_LEVEL_NOTICE);
                return true;
            } else {
                Logger($msg("obsidianLiveSyncSettingTab.logPassphraseNotCompatible"), LOG_LEVEL_NOTICE);
                return false;
            }
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
        await this.plugin.rebuilder.$performRebuildDB(method);
    };
    async confirmRebuild() {
        if (!(await this.isPassphraseValid())) {
            Logger(`Passphrase is not valid, please fix it.`, LOG_LEVEL_NOTICE);
            return;
        }
        const OPTION_FETCH = $msg("obsidianLiveSyncSettingTab.optionFetchFromRemote");
        const OPTION_REBUILD_BOTH = $msg("obsidianLiveSyncSettingTab.optionRebuildBoth");
        const OPTION_ONLY_SETTING = $msg("obsidianLiveSyncSettingTab.optionSaveOnlySettings");
        const OPTION_CANCEL = $msg("obsidianLiveSyncSettingTab.optionCancel");
        const title = $msg("obsidianLiveSyncSettingTab.titleRebuildRequired");
        const note = $msg("obsidianLiveSyncSettingTab.msgRebuildRequired", {
            OPTION_REBUILD_BOTH,
            OPTION_FETCH,
            OPTION_ONLY_SETTING,
        });
        const buttons = [
            OPTION_FETCH,
            OPTION_REBUILD_BOTH, // OPTION_REBUILD_REMOTE,
            OPTION_ONLY_SETTING,
            OPTION_CANCEL,
        ];
        const result = await confirmWithMessage(this.plugin, title, note, buttons, OPTION_CANCEL, 0);
        if (result == OPTION_CANCEL) return;
        if (result == OPTION_FETCH) {
            if (!(await this.checkWorkingPassphrase())) {
                if (
                    (await this.plugin.confirm.askYesNoDialog($msg("obsidianLiveSyncSettingTab.msgAreYouSureProceed"), {
                        defaultOption: "No",
                    })) != "yes"
                )
                    return;
            }
        }
        if (!this.editingSettings.encrypt) {
            this.editingSettings.passphrase = "";
        }
        await this.saveAllDirtySettings();
        await this.applyAllSettings();
        if (result == OPTION_FETCH) {
            await this.plugin.storageAccess.writeFileAuto(FLAGMD_REDFLAG3_HR, "");
            this.services.appLifecycle.scheduleRestart();
            this.closeSetting();
            // await rebuildDB("localOnly");
        } else if (result == OPTION_REBUILD_BOTH) {
            await this.plugin.storageAccess.writeFileAuto(FLAGMD_REDFLAG2_HR, "");
            this.services.appLifecycle.scheduleRestart();
            this.closeSetting();
        } else if (result == OPTION_ONLY_SETTING) {
            await this.plugin.saveSettings();
        }
    }

    display(): void {
        const changeDisplay = this.changeDisplay.bind(this);
        const { containerEl } = this;
        this.settingComponents.length = 0;
        this.controlledElementFunc.length = 0;
        this.onSavedHandlers.length = 0;
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
        containerEl.removeClass("isWizard");

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

        this.createEl(
            menuWrapper,
            "div",
            { cls: "sls-setting-menu-buttons" },
            (el) => {
                el.addClass("wizardHidden");
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

        let paneNo = 0;
        const addPane = (
            parentEl: HTMLElement,
            title: string,
            icon: string,
            order: number,
            wizardHidden: boolean,
            level?: ConfigLevel
        ) => {
            const el = this.createEl(parentEl, "div", { text: "" });
            DEV: {
                const mdTitle = `${paneNo++}. ${title}${getLevelStr(level ?? "")}`;
                el.setAttribute("data-pane", mdTitle);
                toc.add(
                    `| ${icon} | [${mdTitle}](#${mdTitle
                        .toLowerCase()
                        .replace(/ /g, "-")
                        .replace(/[^\w\s-]/g, "")}) | `
                );
            }
            setLevelClass(el, level);
            el.createEl("h3", { text: title, cls: "sls-setting-pane-title" });
            if (this.menuEl) {
                this.menuEl.createEl(
                    "label",
                    { cls: `sls-setting-label c-${order} ${wizardHidden ? "wizardHidden" : ""}` },
                    (el) => {
                        setLevelClass(el, level);
                        const inputEl = el.createEl("input", {
                            type: "radio",
                            name: "disp",
                            value: `${order}`,
                            cls: "sls-setting-tab",
                        } as DomElementInfo);
                        el.createEl("div", {
                            cls: "sls-setting-menu-btn",
                            text: icon,
                            title: title,
                        });
                        inputEl.addEventListener("change", (evt) => this.selectPane(evt));
                        inputEl.addEventListener("click", (evt) => this.selectPane(evt));
                    }
                );
            }
            this.addScreenElement(`${order}`, el);
            const p = Promise.resolve(el);
            // fireAndForget
            // p.finally(() => {
            //     // Recap at the end.
            // });
            return p;
        };
        const panelNoMap = {} as { [key: string]: number };
        const addPanel = (
            parentEl: HTMLElement,
            title: string,
            callback?: (el: HTMLDivElement) => void,
            func?: OnUpdateFunc,
            level?: ConfigLevel
        ) => {
            const el = this.createEl(parentEl, "div", { text: "" }, callback, func);
            DEV: {
                const paneNo = findAttrFromParent(parentEl, "data-pane");
                if (!(paneNo in panelNoMap)) {
                    panelNoMap[paneNo] = 0;
                }
                panelNoMap[paneNo] += 1;
                const panelNo = panelNoMap[paneNo];
                el.setAttribute("data-panel", `${panelNo}. ${title}${getLevelStr(level ?? "")}`);
            }
            setLevelClass(el, level);
            this.createEl(el, "h4", { text: title, cls: "sls-setting-panel-title" });
            const p = Promise.resolve(el);
            // p.finally(() => {
            //     // Recap at the end.
            // })
            return p;
        };

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

        void addPane(containerEl, $msg("obsidianLiveSyncSettingTab.panelChangeLog"), "💬", 100, false).then(
            bindPane(paneChangeLog)
        );
        void addPane(containerEl, $msg("obsidianLiveSyncSettingTab.panelSetup"), "🧙‍♂️", 110, false).then(
            bindPane(paneSetup)
        );
        void addPane(containerEl, $msg("obsidianLiveSyncSettingTab.panelGeneralSettings"), "⚙️", 20, false).then(
            bindPane(paneGeneral)
        );
        void addPane(containerEl, $msg("obsidianLiveSyncSettingTab.panelRemoteConfiguration"), "🛰️", 0, false).then(
            bindPane(paneRemoteConfig)
        );
        void addPane(containerEl, $msg("obsidianLiveSyncSettingTab.titleSyncSettings"), "🔄", 30, false).then(
            bindPane(paneSyncSettings)
        );
        void addPane(containerEl, "Selector", "🚦", 33, false, LEVEL_ADVANCED).then(bindPane(paneSelector));
        void addPane(containerEl, "Customization sync", "🔌", 60, false, LEVEL_ADVANCED).then(
            bindPane(paneCustomisationSync)
        );

        void addPane(containerEl, "Hatch", "🧰", 50, true).then(bindPane(paneHatch));
        void addPane(containerEl, "Advanced", "🔧", 46, false, LEVEL_ADVANCED).then(bindPane(paneAdvanced));
        void addPane(containerEl, "Power users", "💪", 47, true, LEVEL_POWER_USER).then(bindPane(panePowerUsers));

        void addPane(containerEl, "Patches", "🩹", 51, false, LEVEL_EDGE_CASE).then(bindPane(panePatches));

        void addPane(containerEl, "Maintenance", "🎛️", 70, true).then(bindPane(paneMaintenance));

        void yieldNextAnimationFrame().then(() => {
            if (this.selectedScreen == "") {
                if (this.lastVersion != this.editingSettings.lastReadUpdates) {
                    if (this.editingSettings.isConfigured) {
                        changeDisplay("100");
                    } else {
                        changeDisplay("110");
                    }
                } else {
                    if (this.isAnySyncEnabled()) {
                        changeDisplay("20");
                    } else {
                        changeDisplay("110");
                    }
                }
            } else {
                changeDisplay(this.selectedScreen);
            }
            this.requestUpdate();
        });
    }

    getMinioJournalSyncClient() {
        return new JournalSyncMinio(this.plugin.settings, this.plugin.simpleStore, this.plugin);
    }
    async resetRemoteBucket() {
        const minioJournal = this.getMinioJournalSyncClient();
        await minioJournal.resetBucket();
    }
}
