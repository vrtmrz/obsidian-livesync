import { App, PluginSettingTab, Setting as SettingOrg, sanitizeHTMLToDom, MarkdownRenderer, stringifyYaml } from "../deps.ts";
import {
    DEFAULT_SETTINGS,
    type ObsidianLiveSyncSettings,
    type ConfigPassphraseStore,
    type RemoteDBSettings,
    type FilePathWithPrefix,
    type HashAlgorithm,
    type DocumentID,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    LOG_LEVEL_INFO,
    type LoadedEntry,
    PREFERRED_SETTING_CLOUDANT,
    PREFERRED_SETTING_SELF_HOSTED,
    FLAGMD_REDFLAG2_HR,
    FLAGMD_REDFLAG3_HR,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    PREFERRED_JOURNAL_SYNC,
    statusDisplay,
    type ConfigurationItem
} from "../lib/src/common/types.ts";
import { createBlob, delay, isDocContentSame, isObjectDifferent, readAsBlob, unique } from "../lib/src/common/utils.ts";
import { versionNumberString2Number } from "../lib/src/string_and_binary/strbin.ts";
import { Logger } from "../lib/src/common/logger.ts";
import { checkSyncInfo, isCloudantURI } from "../lib/src/pouchdb/utils_couchdb.ts";
import { testCrypt } from "../lib/src/encryption/e2ee_v2.ts";
import ObsidianLiveSyncPlugin from "../main.ts";
import { askYesNo, performRebuildDB, requestToCouchDB, scheduleTask } from "../common/utils.ts";
import { request, ButtonComponent, TFile, TextComponent, ToggleComponent, DropdownComponent, ValueComponent, TextAreaComponent } from "obsidian";
import { shouldBeIgnored } from "../lib/src/string_and_binary/path.ts";
import MultipleRegExpControl from './components/MultipleRegExpControl.svelte';
import { LiveSyncCouchDBReplicator } from "../lib/src/replication/couchdb/LiveSyncReplicator.ts";
import { type AllSettingItemKey, type AllStringItemKey, type AllNumericItemKey, type AllBooleanItemKey, type AllSettings, OnDialogSettingsDefault, getConfig, type OnDialogSettings, getConfName } from "./settingConstants.ts";
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "src/lib/src/common/rosetta.ts";
import { $t } from "src/lib/src/common/i18n.ts";

type OnUpdateResult = {
    visibility?: boolean,
    disabled?: boolean,
    classes?: string[],
    isCta?: boolean,
    isWarning?: boolean,
}
type OnUpdateFunc = () => OnUpdateResult;
type UpdateFunction = () => void;

type AutoWireOption = {
    placeHolder?: string,
    holdValue?: boolean,
    isPassword?: boolean,
    invert?: boolean,
    onUpdate?: OnUpdateFunc;
}

function visibleOnly(cond: () => boolean): OnUpdateFunc {
    return () => ({
        visibility: cond()
    })
}
function enableOnly(cond: () => boolean): OnUpdateFunc {
    return () => ({
        disabled: !cond()
    })
}

type OnSavedHandlerFunc<T extends AllSettingItemKey> = (value: AllSettings[T]) => (Promise<void> | void);
type OnSavedHandler<T extends AllSettingItemKey> = {
    key: T,
    handler: OnSavedHandlerFunc<T>,
}

function wrapMemo<T>(func: (arg: T) => void) {
    let buf: T | undefined = undefined;
    return (arg: T) => {
        if (buf !== arg) {
            func(arg);
            buf = arg;
        }
    }
}

class Setting extends SettingOrg {
    autoWiredComponent?: TextComponent | ToggleComponent | DropdownComponent | ButtonComponent | TextAreaComponent;
    applyButtonComponent?: ButtonComponent;
    selfKey?: AllSettingItemKey;
    watchDirtyKeys = [] as AllSettingItemKey[];
    holdValue: boolean = false;
    static env: ObsidianLiveSyncSettingTab;

    descBuf: string | DocumentFragment = "";
    nameBuf: string | DocumentFragment = "";
    placeHolderBuf: string = "";
    hasPassword: boolean = false;

    invalidateValue?: () => void;
    setValue?: (value: any) => void;
    constructor(containerEl: HTMLElement) {
        super(containerEl);
        Setting.env.settingComponents.push(this);
    }

    setDesc(desc: string | DocumentFragment): this {
        this.descBuf = desc;
        super.setDesc(desc);
        return this;
    }
    setName(name: string | DocumentFragment): this {
        this.nameBuf = name;
        super.setName(name);
        return this;
    }
    setAuto(key: AllSettingItemKey, opt?: AutoWireOption) {
        this.autoWireSetting(key, opt);
        return this;
    }
    autoWireSetting(key: AllSettingItemKey, opt?: AutoWireOption) {
        const conf = getConfig(key);
        if (!conf) {
            // throw new Error(`No such setting item :${key}`)
            return;
        }
        const name = `${conf.name}${statusDisplay(conf.status)}`;
        this.setName(name);
        if (conf.desc) {
            this.setDesc(conf.desc);
        }
        this.holdValue = opt?.holdValue || this.holdValue;
        this.selfKey = key;
        if (opt?.onUpdate) this.addOnUpdate(opt.onUpdate);
        const stat = this._getComputedStatus();
        if (stat.visibility === false) {
            this.settingEl.toggleClass("sls-setting-hidden", !stat.visibility);
        }
        return conf;
    }
    autoWireComponent(component: ValueComponent<any>, conf?: ConfigurationItem, opt?: AutoWireOption) {
        this.placeHolderBuf = conf?.placeHolder || opt?.placeHolder || "";
        if (this.placeHolderBuf && component instanceof TextComponent) {
            component.setPlaceholder(this.placeHolderBuf)
        }
        if (opt?.onUpdate) this.addOnUpdate(opt.onUpdate);
    }
    async commitValue<T extends AllSettingItemKey>(value: AllSettings[T]) {
        const key = this.selfKey as T;
        if (key !== undefined) {
            if (value != Setting.env.editingSettings[key]) {
                Setting.env.editingSettings[key] = value;
                if (!this.holdValue) {
                    await Setting.env.saveSettings([key]);
                }
            }
        }
        Setting.env.requestUpdate()
    }
    autoWireText(key: AllStringItemKey, opt?: AutoWireOption) {
        const conf = this.autoWireSetting(key, opt);
        this.addText(text => {
            this.autoWiredComponent = text;
            const setValue = wrapMemo((value: string) => text.setValue(value));
            this.invalidateValue = () => setValue(`${Setting.env.editingSettings[key]}`);
            this.invalidateValue();
            text.onChange(async value => {
                await this.commitValue(value);
            })
            if (opt?.isPassword) {
                text.inputEl.setAttribute("type", "password")
                this.hasPassword = true;
            }
            this.autoWireComponent(this.autoWiredComponent, conf, opt);
        })
        return this;
    }
    autoWireTextArea(key: AllStringItemKey, opt?: AutoWireOption) {
        const conf = this.autoWireSetting(key, opt);
        this.addTextArea(text => {
            this.autoWiredComponent = text;
            const setValue = wrapMemo((value: string) => text.setValue(value));
            this.invalidateValue = () => setValue(`${Setting.env.editingSettings[key]}`);
            this.invalidateValue();
            text.onChange(async value => {
                await this.commitValue(value);
            })
            if (opt?.isPassword) {
                text.inputEl.setAttribute("type", "password")
                this.hasPassword = true;
            }
            this.autoWireComponent(this.autoWiredComponent, conf, opt);
        })
        return this;
    }
    autoWireNumeric(key: AllNumericItemKey, opt: AutoWireOption & { clampMin?: number, clampMax?: number, acceptZero?: boolean }) {
        const conf = this.autoWireSetting(key, opt);
        this.addText(text => {
            this.autoWiredComponent = text;
            if (opt.clampMin) {
                text.inputEl.setAttribute("min", `${opt.clampMin}`);
            }
            if (opt.clampMax) {
                text.inputEl.setAttribute("max", `${opt.clampMax}`);
            }
            let lastError = false;
            const setValue = wrapMemo((value: string) => text.setValue(value));
            this.invalidateValue = () => {
                if (!lastError) setValue(`${Setting.env.editingSettings[key]}`);
            }
            this.invalidateValue();
            text.onChange(async TextValue => {
                const parsedValue = Number(TextValue);
                const value = parsedValue;
                let hasError = false;
                if (isNaN(value)) hasError = true;
                if (opt.clampMax && opt.clampMax < value) hasError = true;
                if (opt.clampMin && opt.clampMin > value) {
                    if (opt.acceptZero && value == 0) {
                        // This is ok.
                    } else {
                        hasError = true;
                    }
                }
                if (!hasError) {
                    lastError = false;
                    this.setTooltip(``);
                    text.inputEl.toggleClass("sls-item-invalid-value", false);
                    await this.commitValue(value);
                } else {
                    this.setTooltip(`The value should ${opt.clampMin || "~"} < value < ${opt.clampMax || "~"}`);
                    text.inputEl.toggleClass("sls-item-invalid-value", true);
                    lastError = true;
                    return false;
                }
            })
            text.inputEl.setAttr("type", "number");
            this.autoWireComponent(this.autoWiredComponent, conf, opt);
        })
        return this;
    }
    autoWireToggle(key: AllBooleanItemKey, opt?: AutoWireOption) {
        const conf = this.autoWireSetting(key, opt);
        this.addToggle(toggle => {
            this.autoWiredComponent = toggle;
            const setValue = wrapMemo((value: boolean) => toggle.setValue(opt?.invert ? !value : value));
            this.invalidateValue = () => setValue(Setting.env.editingSettings[key] ?? false);
            this.invalidateValue();

            toggle.onChange(async value => {
                await this.commitValue(opt?.invert ? !value : value);
            })

            this.autoWireComponent(this.autoWiredComponent, conf, opt);
        })
        return this;
    }
    autoWireDropDown<T extends string>(key: AllStringItemKey, opt: AutoWireOption & { options: Record<T, string> }) {
        const conf = this.autoWireSetting(key, opt);
        this.addDropdown(dropdown => {
            this.autoWiredComponent = dropdown;
            const setValue = wrapMemo((value: string) => {
                dropdown.setValue(value)
            });

            dropdown
                .addOptions(opt.options)

            this.invalidateValue = () => setValue(Setting.env.editingSettings[key] || "");
            this.invalidateValue();
            dropdown.onChange(async value => {
                await this.commitValue(value);
            })
            this.autoWireComponent(this.autoWiredComponent, conf, opt);
        })
        return this;
    }
    addApplyButton(keys: AllSettingItemKey[]) {
        this.addButton((button) => {
            this.applyButtonComponent = button;
            this.watchDirtyKeys = unique([...keys, ...this.watchDirtyKeys]);
            button.setButtonText("Apply")
            button.onClick(async () => {
                await Setting.env.saveSettings(keys);
                Setting.env.reloadAllSettings();
            })
            Setting.env.requestUpdate()
        })
        return this;
    }
    addOnUpdate(func: () => OnUpdateResult) {
        this.updateHandlers.add(func);
        // this._applyOnUpdateHandlers();
        return this;
    }
    updateHandlers = new Set<() => OnUpdateResult>();

    prevStatus: OnUpdateResult = {};

    _getComputedStatus() {
        let newConf = {} as OnUpdateResult;
        for (const handler of this.updateHandlers) {
            newConf = {
                ...newConf,
                ...handler(),
            }
        }
        return newConf;
    }
    _applyOnUpdateHandlers() {
        if (this.updateHandlers.size > 0) {
            const newConf = this._getComputedStatus();
            const keys = Object.keys(newConf) as [keyof OnUpdateResult];
            for (const k of keys) {

                if (k in this.prevStatus && this.prevStatus[k] == newConf[k]) {
                    continue;
                }
                // const newValue = newConf[k];
                switch (k) {
                    case "visibility":
                        this.settingEl.toggleClass("sls-setting-hidden", !(newConf[k] || false))
                        this.prevStatus[k] = newConf[k];
                        break
                    case "classes":
                        break
                    case "disabled":
                        this.setDisabled((newConf[k] || false))
                        this.settingEl.toggleClass("sls-setting-disabled", (newConf[k] || false))
                        this.prevStatus[k] = newConf[k];
                        break
                    case "isCta":
                        {
                            const component = this.autoWiredComponent;
                            if (component instanceof ButtonComponent) {
                                if (newConf[k]) {
                                    component.setCta();
                                } else {
                                    component.removeCta();
                                }
                            }
                            this.prevStatus[k] = newConf[k];
                        }
                        break
                    case "isWarning":
                        {
                            const component = this.autoWiredComponent;
                            if (component instanceof ButtonComponent) {
                                if (newConf[k]) {
                                    component.setWarning();
                                } else {
                                    //TODO:IMPLEMENT
                                    // component.removeCta();
                                }
                            }
                            this.prevStatus[k] = newConf[k];
                        }
                        break
                }
            }
        }
    }
    _onUpdate() {
        if (this.applyButtonComponent) {
            const isDirty = Setting.env.isSomeDirty(this.watchDirtyKeys);
            this.applyButtonComponent.setDisabled(!isDirty);
            if (isDirty) {
                this.applyButtonComponent.setCta();
            } else {
                this.applyButtonComponent.removeCta();
            }
        }
        if (this.selfKey && !Setting.env.isDirty(this.selfKey) && this.invalidateValue) {
            this.invalidateValue();
        }
        if (this.holdValue && this.selfKey) {
            const isDirty = Setting.env.isDirty(this.selfKey);
            const alt = isDirty ? `Original: ${Setting.env.initialSettings![this.selfKey]}` : ""
            this.controlEl.toggleClass("sls-item-dirty", isDirty);
            if (!this.hasPassword) {
                this.nameEl.toggleClass("sls-item-dirty-help", isDirty);
                this.setTooltip(alt, { delay: 10, placement: "right" });
            }
        }
        this._applyOnUpdateHandlers();
    }

}


export class ObsidianLiveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianLiveSyncPlugin;
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
    applySetting(keys: (AllSettingItemKey)[]) {
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
        keys.forEach(e => this.refreshSetting(e));
    }
    applyAllSettings() {
        const changedKeys = (Object.keys(this.editingSettings ?? {}) as AllSettingItemKey[]).filter(e => this.isDirty(e));
        this.applySetting(changedKeys);
        this.reloadAllSettings();
    }

    async saveLocalSetting(key: (keyof typeof OnDialogSettingsDefault)) {
        if (key == "configPassphrase") {
            localStorage.setItem("ls-setting-passphrase", this.editingSettings?.[key] ?? "");
            return await Promise.resolve();
        }
        if (key == "deviceAndVaultName") {
            this.plugin.deviceAndVaultName = this.editingSettings?.[key];
            this.plugin.saveDeviceAndVaultName();
            return await Promise.resolve();
        }
    }
    /**
     * Apply and save setting to the plug-in.
     * @param keys setting keys for applying
     */
    async saveSettings(keys: (AllSettingItemKey)[]) {
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
        const handlers =
            this.onSavedHandlers.filter(e => appliedKeys.indexOf(e.key) !== -1).map(e => e.handler(this.editingSettings[e.key as AllSettingItemKey]));
        await Promise.all(handlers);
        // }
        keys.forEach(e => this.refreshSetting(e));

    }

    /**
     * Apply all editing setting to the plug-in.
     * @param keys setting keys for applying
     */
    async saveAllDirtySettings() {
        const changedKeys = (Object.keys(this.editingSettings ?? {}) as AllSettingItemKey[]).filter(e => this.isDirty(e));
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
        ret.preset = ""
        ret.deviceAndVaultName = this.plugin.deviceAndVaultName;
        return ret;
    }
    computeAllLocalSettings(): Partial<OnDialogSettings> {
        const syncMode = this.editingSettings?.liveSync ? "LIVESYNC" :
            this.editingSettings?.periodicReplication ? "PERIODIC" : "ONEVENTS";
        return {
            syncMode
        }
    }
    /**
     * Reread all settings and request invalidate
     */
    reloadAllSettings(skipUpdate: boolean = false) {
        const localSetting = this.reloadAllLocalSettings();
        this._editingSettings = { ...this.plugin.settings, ...localSetting };
        this._editingSettings = { ...this.editingSettings, ...this.computeAllLocalSettings() };
        this.initialSettings = { ...this.editingSettings, };
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
        this.editingSettings = { ...(this.editingSettings), ...this.computeAllLocalSettings() };
        // this.initialSettings = { ...this.initialSettings };
        this.requestUpdate();
    }

    isDirty(key: AllSettingItemKey) {
        return isObjectDifferent(this.editingSettings[key], this.initialSettings?.[key]);
    }
    isSomeDirty(keys: (AllSettingItemKey)[]) {
        // if (debug) {
        //     console.dir(keys);
        //     console.dir(keys.map(e => this.isDirty(e)));
        // }
        return keys.some(e => this.isDirty(e));
    }

    isConfiguredAs(key: AllStringItemKey, value: string): boolean
    isConfiguredAs(key: AllNumericItemKey, value: number): boolean
    isConfiguredAs(key: AllBooleanItemKey, value: boolean): boolean
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

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        Setting.env = this;
    }

    async testConnection(settingOverride: Partial<ObsidianLiveSyncSettings> = {}): Promise<void> {
        const trialSetting = { ...this.editingSettings, ...settingOverride };
        const replicator = this.plugin.getNewReplicator(trialSetting);
        await replicator.tryConnectRemote(trialSetting);
    }

    closeSetting() {
        // @ts-ignore
        this.plugin.app.setting.close()
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
                            element.toggleClass("sls-setting-hidden", !(newValue[k] || false))
                        }
                        //@ts-ignore
                        prev[k] = newValue[k];
                    }
                }
            }
        })(element, func);
        this.controlledElementFunc.push(updateFunc);
        updateFunc();
    }

    createEl<T extends keyof HTMLElementTagNameMap>(el: HTMLElement,
        tag: T,
        o?: string | DomElementInfo | undefined,
        callback?: ((el: HTMLElementTagNameMap[T]) => void),
        func?: OnUpdateFunc) {
        const element = el.createEl(tag, o, callback);
        if (func) this.handleElement(element, func);
        return element;
    }

    addOnSaved<T extends AllSettingItemKey>(key: T, func: (value: AllSettings[T]) => (Promise<void> | void)) {
        this.onSavedHandlers.push({ key, handler: func });
    }
    resetEditingSettings() {
        this._editingSettings = undefined;
        this.initialSettings = undefined;
    }

    hide() {
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
                        this.plugin.askInPopup(`config-reloaded-${k}`, `The setting "${getConfName(k as AllSettingItemKey)}" being in editing has been changed from somewhere. We can discard modification and reload by clicking {HERE}. Click elsewhere to ignore changes`, (anchor) => {
                            anchor.text = "HERE";
                            anchor.addEventListener("click", () => {
                                this.refreshSetting(k as AllSettingItemKey);
                                this.display();
                            });
                        });
                    } else {
                        // not modified
                        this.refreshSetting(k as AllSettingItemKey);
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

    display(): void {
        const { containerEl } = this;
        this.settingComponents.length = 0;
        this.controlledElementFunc.length = 0;
        this.onSavedHandlers.length = 0;
        if (this._editingSettings == undefined || this.initialSettings == undefined) {
            this.reloadAllSettings();
        }
        if (this.editingSettings === undefined || this.initialSettings == undefined) {
            return;
        }
        this.isShown = true;

        containerEl.empty();
        this.createEl(containerEl, "h2", { text: "Settings for Self-hosted LiveSync." });
        containerEl.addClass("sls-setting");
        containerEl.removeClass("isWizard");


        const w = containerEl.createDiv("");
        const screenElements: { [key: string]: HTMLElement[] } = {};
        const addScreenElement = (key: string, element: HTMLElement) => {
            if (!(key in screenElements)) {
                screenElements[key] = [];
            }
            screenElements[key].push(element);
        };
        w.addClass("sls-setting-menu");
        w.innerHTML = `
<label class='sls-setting-label c-100 wizardHidden'><input type='radio' name='disp' value='100' class='sls-setting-tab'><div class='sls-setting-menu-btn'>💬</div></label>
<label class='sls-setting-label c-110'><input type='radio' name='disp' value='110' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🧙‍♂️</div></label>
<label class='sls-setting-label c-20 wizardHidden'><input type='radio' name='disp' value='20' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>⚙️</div></label>
<label class='sls-setting-label c-0'><input type='radio' name='disp' value='0' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🛰️</div></label>
<label class='sls-setting-label c-30'><input type='radio' name='disp' value='30' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🔁</div></label>
<label class='sls-setting-label c-60 wizardHidden'><input type='radio' name='disp' value='60' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🔌</div></label>
<label class='sls-setting-label c-50 wizardHidden'><input type='radio' name='disp' value='50' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🧰</div></label>
<label class='sls-setting-label c-70 wizardHidden'><input type='radio' name='disp' value='70' class='sls-setting-tab' ><div class='sls-setting-menu-btn'>🎛️</div></label>
        `;
        const menuTabs = w.querySelectorAll(".sls-setting-label");
        const changeDisplay = (screen: string) => {
            for (const k in screenElements) {
                if (k == screen) {
                    screenElements[k].forEach((element) => element.removeClass("setting-collapsed"));
                } else {
                    screenElements[k].forEach((element) => element.addClass("setting-collapsed"));
                }
            }
            w.querySelectorAll(`.sls-setting-label`).forEach((element) => {
                element.removeClass("selected");
                (element.querySelector<HTMLInputElement>("input[type=radio]"))!.checked = false;
            });
            w.querySelectorAll(`.sls-setting-label.c-${screen}`).forEach((element) => {
                element.addClass("selected");
                (element.querySelector<HTMLInputElement>("input[type=radio]"))!.checked = true;
            });
            this.selectedScreen = screen;
        };
        menuTabs.forEach((element) => {
            const e = element.querySelector(".sls-setting-tab");
            if (!e) return;
            e.addEventListener("change", (event) => {
                menuTabs.forEach((element) => element.removeClass("selected"));
                changeDisplay((event.currentTarget as HTMLInputElement).value);
                element.addClass("selected");
            });
        });

        const containerInformationEl = containerEl.createDiv();
        const h3El = this.createEl(containerInformationEl, "h3", { text: "Updates" });
        const informationDivEl = this.createEl(containerInformationEl, "div", { text: "" });

        //@ts-ignore
        const manifestVersion: string = MANIFEST_VERSION || "-";
        //@ts-ignore
        const updateInformation: string = UPDATE_INFO || "";

        const lastVersion = ~~(versionNumberString2Number(manifestVersion) / 1000);

        const tmpDiv = createSpan();
        tmpDiv.addClass("sls-header-button");
        tmpDiv.innerHTML = `<button> OK, I read everything. </button>`;
        if (lastVersion > (this.editingSettings?.lastReadUpdates || 0)) {
            const informationButtonDiv = h3El.appendChild(tmpDiv);
            informationButtonDiv.querySelector("button")?.addEventListener("click", async () => {
                this.editingSettings.lastReadUpdates = lastVersion;
                await this.saveAllDirtySettings();
                informationButtonDiv.remove();
            });

        }

        MarkdownRenderer.render(this.plugin.app, updateInformation, informationDivEl, "/", this.plugin);


        addScreenElement("100", containerInformationEl);
        const isAnySyncEnabled = (): boolean => {
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
        };
        // const visibleOnlySyncDisabled = visibleOnly(() => !isAnySyncEnabled())
        // const visibleOnlySyncDisabled = visibleOnly(() => !isAnySyncEnabled())
        const enableOnlySyncDisabled = enableOnly(() => !isAnySyncEnabled())

        let inWizard = false;
        if (containerEl.hasClass("inWizard")) {
            inWizard = true;
        }

        const setupWizardEl = containerEl.createDiv();
        this.createEl(setupWizardEl, "h3", { text: "Setup wizard" });
        new Setting(setupWizardEl)
            .setName("Use the copied setup URI")
            .setDesc("To setup Self-hosted LiveSync, this method is the most preferred one.")
            .addButton((text) => {
                text.setButtonText("Use").onClick(async () => {
                    this.closeSetting();
                    await this.plugin.addOnSetup.command_openSetupURI();
                })
            })
        if (this.editingSettings.isConfigured) {
            new Setting(setupWizardEl)
                .setName("Copy current settings as a new setup URI")
                .addButton((text) => {
                    text.setButtonText("Copy").onClick(async () => {
                        await this.plugin.addOnSetup.command_copySetupURI();
                    })
                })
        }
        new Setting(setupWizardEl)
            .setName("Minimal setup")
            .addButton((text) => {
                text.setButtonText("Start").onClick(async () => {
                    this.editingSettings.liveSync = false;
                    this.editingSettings.periodicReplication = false;
                    this.editingSettings.syncOnSave = false;
                    this.editingSettings.syncOnEditorSave = false;
                    this.editingSettings.syncOnStart = false;
                    this.editingSettings.syncOnFileOpen = false;
                    this.editingSettings.syncAfterMerge = false;
                    this.plugin.replicator.closeReplication();
                    await this.saveAllDirtySettings();
                    containerEl.addClass("isWizard");
                    inWizard = true;
                    changeDisplay("0")
                })
            })
        new Setting(setupWizardEl)
            .setName("Enable LiveSync on this device as the setup was completed manually")
            .addButton((text) => {
                text.setButtonText("Enable").onClick(async () => {
                    this.editingSettings.isConfigured = true;
                    await this.saveAllDirtySettings();
                    this.plugin.askReload();
                })
            })
            .addOnUpdate(visibleOnly(() => !this.isConfiguredAs("isConfigured", true)))

        new Setting(setupWizardEl)
            .setName("Discard existing settings and databases")
            .addButton((text) => {
                text.setButtonText("Discard").onClick(async () => {
                    if (await askYesNo(this.plugin.app, "Do you really want to discard existing settings and databases?") == "yes") {
                        this.editingSettings = { ...this.editingSettings, ...DEFAULT_SETTINGS };
                        await this.plugin.saveSettingData();
                        await this.plugin.resetLocalDatabase();
                        // await this.plugin.initializeDatabase();
                        this.plugin.askReload();
                    }
                }).setWarning()
            }).addOnUpdate(visibleOnly(() => this.isConfiguredAs("isConfigured", true)))
        // }
        this.createEl(setupWizardEl, "h3", { text: "Online Tips" });
        const repo = "vrtmrz/obsidian-livesync";
        const topPath = "/docs/troubleshooting.md";
        const rawRepoURI = `https://raw.githubusercontent.com/${repo}/main`;
        this.createEl(setupWizardEl, "div", "", el => el.innerHTML = `<a href='https://github.com/${repo}/blob/main${topPath}' target="_blank">Open in browser</a>`);
        const troubleShootEl = this.createEl(setupWizardEl, "div", { text: "", cls: "sls-troubleshoot-preview" });
        const loadMarkdownPage = async (pathAll: string, basePathParam: string = "") => {
            troubleShootEl.style.minHeight = troubleShootEl.clientHeight + "px";
            troubleShootEl.empty();
            const fullPath = pathAll.startsWith("/") ? pathAll : `${basePathParam}/${pathAll}`;

            const directoryArr = fullPath.split("/");
            const filename = directoryArr.pop();
            const directly = directoryArr.join("/");
            const basePath = directly;

            let remoteTroubleShootMDSrc = "";
            try {
                remoteTroubleShootMDSrc = await request(`${rawRepoURI}${basePath}/${filename}`);
            } catch (ex: any) {
                remoteTroubleShootMDSrc = "An error occurred!!\n" + ex.toString();
            }
            const remoteTroubleShootMD = remoteTroubleShootMDSrc.replace(/\((.*?(.png)|(.jpg))\)/g, `(${rawRepoURI}${basePath}/$1)`)
            // Render markdown
            await MarkdownRenderer.render(this.plugin.app, `<a class='sls-troubleshoot-anchor'></a> [Tips and Troubleshooting](${topPath}) [PageTop](${filename})\n\n${remoteTroubleShootMD}`, troubleShootEl, `${rawRepoURI}`, this.plugin);
            // Menu
            troubleShootEl.querySelector<HTMLAnchorElement>(".sls-troubleshoot-anchor")?.parentElement?.setCssStyles({
                position: "sticky",
                top: "-1em",
                backgroundColor: "var(--modal-background)"
            });
            // Trap internal links.
            troubleShootEl.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((anchorEl) => {
                anchorEl.addEventListener("click", async (evt) => {
                    const uri = anchorEl.getAttr("data-href");
                    if (!uri) return;
                    if (uri.startsWith("#")) {
                        evt.preventDefault();
                        const elements = Array.from(troubleShootEl.querySelectorAll<HTMLHeadingElement>("[data-heading]"))
                        const p = elements.find(e => e.getAttr("data-heading")?.toLowerCase().split(" ").join("-") == uri.substring(1).toLowerCase());
                        if (p) {
                            p.setCssStyles({ scrollMargin: "3em" });
                            p.scrollIntoView({ behavior: "instant", block: "start" });
                        }
                    } else {
                        evt.preventDefault();
                        await loadMarkdownPage(uri, basePath);
                        troubleShootEl.setCssStyles({ scrollMargin: "1em" });
                        troubleShootEl.scrollIntoView({ behavior: "instant", block: "start" });
                    }
                })
            })
            troubleShootEl.style.minHeight = "";
        }
        loadMarkdownPage(topPath);
        addScreenElement("110", setupWizardEl);

        const containerRemoteDatabaseEl = containerEl.createDiv();
        this.createEl(containerRemoteDatabaseEl, "h3", { text: "Remote configuration" });

        new Setting(containerRemoteDatabaseEl)
            .autoWireDropDown("remoteType", {
                holdValue: true, options: {
                    [REMOTE_COUCHDB]: "CouchDB", [REMOTE_MINIO]: "Minio,S3,R2",
                }, onUpdate: enableOnlySyncDisabled
            })

        const onlyOnCouchDB = () => ({
            visibility: this.isConfiguredAs('remoteType', REMOTE_COUCHDB)
        }) as OnUpdateResult;
        const onlyOnMinIO = () => ({
            visibility: this.isConfiguredAs('remoteType', REMOTE_MINIO)
        }) as OnUpdateResult;

        this.createEl(containerRemoteDatabaseEl, "div", undefined, containerRemoteDatabaseEl => {

            const syncWarnMinio = this.createEl(containerRemoteDatabaseEl, "div", {
                text: ""
            });
            const ObjectStorageMessage = `Kindly notice: this is a pretty experimental feature, hence we have some limitations. 
- Append only architecture. It will not shrink used storage if we do not perform a rebuild.
- A bit fragile.
- During the first synchronization, the entire history to date will be transferred. For this reason, it is preferable to do this while connected to a Wi-Fi network.
- From the second, we always transfer only differences.

However, your report is needed to stabilise this. I appreciate you for your great dedication.
`;

            MarkdownRenderer.render(this.plugin.app, ObjectStorageMessage, syncWarnMinio, "/", this.plugin);
            syncWarnMinio.addClass("op-warn-info");

            new Setting(containerRemoteDatabaseEl).autoWireText("endpoint", { holdValue: true })
            new Setting(containerRemoteDatabaseEl).autoWireText("accessKey", { holdValue: true });

            new Setting(containerRemoteDatabaseEl).autoWireText("secretKey", { holdValue: true, isPassword: true });

            new Setting(containerRemoteDatabaseEl).autoWireText("region", { holdValue: true });

            new Setting(containerRemoteDatabaseEl).autoWireText("bucket", { holdValue: true });

            new Setting(containerRemoteDatabaseEl).autoWireToggle("useCustomRequestHandler", { holdValue: true });
            new Setting(containerRemoteDatabaseEl)
                .setName("Test Connection")
                .addButton((button) =>
                    button
                        .setButtonText("Test")
                        .setDisabled(false)
                        .onClick(async () => {
                            await this.testConnection(this.editingSettings);
                        })
                );
            new Setting(containerRemoteDatabaseEl)
                .setName("Apply Settings")
                .setClass("wizardHidden")
                .addApplyButton(["remoteType", "endpoint", "region", "accessKey", "secretKey", "bucket", "useCustomRequestHandler"])
                .addOnUpdate(onlyOnMinIO)

        }, onlyOnMinIO);


        this.createEl(containerRemoteDatabaseEl, "div", undefined, containerRemoteDatabaseEl => {
            if (this.plugin.isMobile) {
                this.createEl(containerRemoteDatabaseEl, "div", {
                    text: `Configured as using non-HTTPS. We cannot connect to the remote. Please set up the credentials and use HTTPS for the remote URI.`,
                }, undefined, visibleOnly(() => !this.editingSettings.couchDB_URI.startsWith("https://")))
                    .addClass("op-warn");
            } else {
                this.createEl(containerRemoteDatabaseEl, "div", {
                    text: `Configured as using non-HTTPS. We might fail on mobile devices.`
                }, undefined, visibleOnly(() => !this.editingSettings.couchDB_URI.startsWith("https://")))
                    .addClass("op-warn-info");
            }

            this.createEl(containerRemoteDatabaseEl, "div", { text: `These settings are kept locked while any synchronization options are enabled. Disable these options in the "Sync Settings" tab to unlock.` },
                undefined, visibleOnly(() => isAnySyncEnabled())
            ).addClass("sls-setting-hidden");

            new Setting(containerRemoteDatabaseEl).autoWireText("couchDB_URI", { holdValue: true, onUpdate: enableOnlySyncDisabled });
            new Setting(containerRemoteDatabaseEl).autoWireText("couchDB_USER", { holdValue: true, onUpdate: enableOnlySyncDisabled });
            new Setting(containerRemoteDatabaseEl).autoWireText("couchDB_PASSWORD", { holdValue: true, isPassword: true, onUpdate: enableOnlySyncDisabled });
            new Setting(containerRemoteDatabaseEl).autoWireText("couchDB_DBNAME", { holdValue: true, onUpdate: enableOnlySyncDisabled });


            new Setting(containerRemoteDatabaseEl)
                .setName("Test Database Connection")
                .setClass("wizardHidden")
                .setDesc("Open database connection. If the remote database is not found and you have the privilege to create a database, the database will be created.")
                .addButton((button) =>
                    button
                        .setButtonText("Test")
                        .setDisabled(false)
                        .onClick(async () => {
                            await this.testConnection();
                        })
                );

            new Setting(containerRemoteDatabaseEl)
                .setName("Check and fix database configuration")
                .setDesc("Check the database configuration, and fix if there are any problems.")
                .addButton((button) =>
                    button
                        .setButtonText("Check")
                        .setDisabled(false)
                        .onClick(async () => {
                            const checkConfig = async () => {
                                Logger(`Checking database configuration`, LOG_LEVEL_INFO);

                                const emptyDiv = createDiv();
                                emptyDiv.innerHTML = "<span></span>";
                                checkResultDiv.replaceChildren(...[emptyDiv]);
                                const addResult = (msg: string, classes?: string[]) => {
                                    const tmpDiv = createDiv();
                                    tmpDiv.addClass("ob-btn-config-fix");
                                    if (classes) {
                                        tmpDiv.addClasses(classes);
                                    }
                                    tmpDiv.innerHTML = `${msg}`;
                                    checkResultDiv.appendChild(tmpDiv);
                                };
                                try {

                                    if (isCloudantURI(this.editingSettings.couchDB_URI)) {
                                        Logger("This feature cannot be used with IBM Cloudant.", LOG_LEVEL_NOTICE);
                                        return;
                                    }
                                    const r = await requestToCouchDB(this.editingSettings.couchDB_URI, this.editingSettings.couchDB_USER, this.editingSettings.couchDB_PASSWORD, window.origin);
                                    const responseConfig = r.json;

                                    const addConfigFixButton = (title: string, key: string, value: string) => {
                                        const tmpDiv = createDiv();
                                        tmpDiv.addClass("ob-btn-config-fix");
                                        tmpDiv.innerHTML = `<label>${title}</label><button>Fix</button>`;
                                        const x = checkResultDiv.appendChild(tmpDiv);
                                        x.querySelector("button")?.addEventListener("click", async () => {
                                            Logger(`CouchDB Configuration: ${title} -> Set ${key} to ${value}`)
                                            const res = await requestToCouchDB(this.editingSettings.couchDB_URI, this.editingSettings.couchDB_USER, this.editingSettings.couchDB_PASSWORD, undefined, key, value);
                                            if (res.status == 200) {
                                                Logger(`CouchDB Configuration: ${title} successfully updated`, LOG_LEVEL_NOTICE);
                                                checkResultDiv.removeChild(x);
                                                checkConfig();
                                            } else {
                                                Logger(`CouchDB Configuration: ${title} failed`, LOG_LEVEL_NOTICE);
                                                Logger(res.text, LOG_LEVEL_VERBOSE);
                                            }
                                        });
                                    };
                                    addResult("---Notice---", ["ob-btn-config-head"]);
                                    addResult(
                                        "If the server configuration is not persistent (e.g., running on docker), the values set from here will also be volatile. Once you are able to connect, please reflect the settings in the server's local.ini.",
                                        ["ob-btn-config-info"]
                                    );

                                    addResult("--Config check--", ["ob-btn-config-head"]);

                                    // Admin check
                                    //  for database creation and deletion
                                    if (!(this.editingSettings.couchDB_USER in responseConfig.admins)) {
                                        addResult(`⚠ You do not have administrative privileges.`);
                                    } else {
                                        addResult("✔ You have administrative privileges.");
                                    }
                                    // HTTP user-authorization check
                                    if (responseConfig?.chttpd?.require_valid_user != "true") {
                                        addResult("❗ chttpd.require_valid_user is wrong.");
                                        addConfigFixButton("Set chttpd.require_valid_user = true", "chttpd/require_valid_user", "true");
                                    } else {
                                        addResult("✔ chttpd.require_valid_user is ok.");
                                    }
                                    if (responseConfig?.chttpd_auth?.require_valid_user != "true") {
                                        addResult("❗ chttpd_auth.require_valid_user is wrong.");
                                        addConfigFixButton("Set chttpd_auth.require_valid_user = true", "chttpd_auth/require_valid_user", "true");
                                    } else {
                                        addResult("✔ chttpd_auth.require_valid_user is ok.");
                                    }
                                    // HTTPD check
                                    //  Check Authentication header
                                    if (!responseConfig?.httpd["WWW-Authenticate"]) {
                                        addResult("❗ httpd.WWW-Authenticate is missing");
                                        addConfigFixButton("Set httpd.WWW-Authenticate", "httpd/WWW-Authenticate", 'Basic realm="couchdb"');
                                    } else {
                                        addResult("✔ httpd.WWW-Authenticate is ok.");
                                    }
                                    if (responseConfig?.httpd?.enable_cors != "true") {
                                        addResult("❗ httpd.enable_cors is wrong");
                                        addConfigFixButton("Set httpd.enable_cors", "httpd/enable_cors", "true");
                                    } else {
                                        addResult("✔ httpd.enable_cors is ok.");
                                    }
                                    // If the server is not cloudant, configure request size
                                    if (!isCloudantURI(this.editingSettings.couchDB_URI)) {
                                        // REQUEST SIZE
                                        if (Number(responseConfig?.chttpd?.max_http_request_size ?? 0) < 4294967296) {
                                            addResult("❗ chttpd.max_http_request_size is low)");
                                            addConfigFixButton("Set chttpd.max_http_request_size", "chttpd/max_http_request_size", "4294967296");
                                        } else {
                                            addResult("✔ chttpd.max_http_request_size is ok.");
                                        }
                                        if (Number(responseConfig?.couchdb?.max_document_size ?? 0) < 50000000) {
                                            addResult("❗ couchdb.max_document_size is low)");
                                            addConfigFixButton("Set couchdb.max_document_size", "couchdb/max_document_size", "50000000");
                                        } else {
                                            addResult("✔ couchdb.max_document_size is ok.");
                                        }
                                    }
                                    // CORS check
                                    //  checking connectivity for mobile
                                    if (responseConfig?.cors?.credentials != "true") {
                                        addResult("❗ cors.credentials is wrong");
                                        addConfigFixButton("Set cors.credentials", "cors/credentials", "true");
                                    } else {
                                        addResult("✔ cors.credentials is ok.");
                                    }
                                    const ConfiguredOrigins = ((responseConfig?.cors?.origins ?? "") + "").split(",");
                                    if (
                                        responseConfig?.cors?.origins == "*" ||
                                        (ConfiguredOrigins.indexOf("app://obsidian.md") !== -1 && ConfiguredOrigins.indexOf("capacitor://localhost") !== -1 && ConfiguredOrigins.indexOf("http://localhost") !== -1)
                                    ) {
                                        addResult("✔ cors.origins is ok.");
                                    } else {
                                        addResult("❗ cors.origins is wrong");
                                        addConfigFixButton("Set cors.origins", "cors/origins", "app://obsidian.md,capacitor://localhost,http://localhost");
                                    }
                                    addResult("--Connection check--", ["ob-btn-config-head"]);
                                    addResult(`Current origin:${window.location.origin}`);

                                    // Request header check
                                    const origins = ["app://obsidian.md", "capacitor://localhost", "http://localhost"];
                                    for (const org of origins) {
                                        const rr = await requestToCouchDB(this.editingSettings.couchDB_URI, this.editingSettings.couchDB_USER, this.editingSettings.couchDB_PASSWORD, org);
                                        const responseHeaders = Object.fromEntries(Object.entries(rr.headers)
                                            .map((e) => {
                                                e[0] = `${e[0]}`.toLowerCase();
                                                return e;
                                            }));
                                        addResult(`Origin check:${org}`);
                                        if (responseHeaders["access-control-allow-credentials"] != "true") {
                                            addResult("❗ CORS is not allowing credentials");
                                        } else {
                                            addResult("✔ CORS credentials OK");
                                        }
                                        if (responseHeaders["access-control-allow-origin"] != org) {
                                            addResult(`❗ CORS Origin is unmatched:${origin}->${responseHeaders["access-control-allow-origin"]}`);
                                        } else {
                                            addResult("✔ CORS origin OK");
                                        }
                                    }
                                    addResult("--Done--", ["ob-btn-config-head"]);
                                    addResult("If you have some trouble with Connection-check even though all Config-check has been passed, please check your reverse proxy's configuration.", ["ob-btn-config-info"]);
                                    Logger(`Checking configuration done`, LOG_LEVEL_INFO);
                                } catch (ex: any) {
                                    if (ex?.status == 401) {
                                        addResult(`❗ Access forbidden.`);
                                        addResult(`We could not continue the test.`);
                                        Logger(`Checking configuration done`, LOG_LEVEL_INFO);
                                    } else {
                                        Logger(`Checking configuration failed`, LOG_LEVEL_NOTICE);
                                        Logger(ex);
                                    }
                                }
                            };
                            await checkConfig();
                        })
                );
            const checkResultDiv = this.createEl(containerRemoteDatabaseEl, "div", {
                text: "",
            });

            new Setting(containerRemoteDatabaseEl)
                .setName("Apply Settings")
                .setClass("wizardHidden")
                .addApplyButton(["remoteType", "couchDB_URI", "couchDB_USER", "couchDB_PASSWORD", "couchDB_DBNAME"])
                .addOnUpdate(onlyOnCouchDB)
        }, onlyOnCouchDB);

        this.createEl(containerRemoteDatabaseEl, "h4", { text: "Effective Storage Using" }).addClass("wizardHidden")

        new Setting(containerRemoteDatabaseEl).autoWireToggle("useEden").setClass("wizardHidden");
        const onlyUsingEden = visibleOnly(() => this.isConfiguredAs("useEden", true));
        new Setting(containerRemoteDatabaseEl).autoWireNumeric("maxChunksInEden", { onUpdate: onlyUsingEden }).setClass("wizardHidden");
        new Setting(containerRemoteDatabaseEl).autoWireNumeric("maxTotalLengthInEden", { onUpdate: onlyUsingEden }).setClass("wizardHidden");
        new Setting(containerRemoteDatabaseEl).autoWireNumeric("maxAgeInEden", { onUpdate: onlyUsingEden }).setClass("wizardHidden");

        new Setting(containerRemoteDatabaseEl).autoWireToggle("enableCompression").setClass("wizardHidden");

        this.createEl(containerRemoteDatabaseEl, "h4", { text: "Confidentiality" });

        new Setting(containerRemoteDatabaseEl)
            .autoWireToggle("encrypt", { holdValue: true })

        const isEncryptEnabled = visibleOnly(() => this.isConfiguredAs("encrypt", true))

        new Setting(containerRemoteDatabaseEl)
            .autoWireText("passphrase", { holdValue: true, isPassword: true, onUpdate: isEncryptEnabled })

        new Setting(containerRemoteDatabaseEl)
            .autoWireToggle("usePathObfuscation", { holdValue: true, onUpdate: isEncryptEnabled })
        new Setting(containerRemoteDatabaseEl)
            .autoWireToggle("useDynamicIterationCount", { holdValue: true, onUpdate: isEncryptEnabled }).setClass("wizardHidden");

        new Setting(containerRemoteDatabaseEl)
            .setName("Apply")
            .setDesc("Apply encryption settings")
            .setClass("wizardHidden")
            .addButton((button) =>
                button
                    .setButtonText("Just apply")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await applyEncryption(false);
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Apply and fetch")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("localOnly");
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Apply and rebuild")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("rebuildBothByThisDevice");
                    })
            )
            .addOnUpdate(() => ({
                isCta: this.isSomeDirty(["passphrase", "useDynamicIterationCount", "usePathObfuscation", "encrypt"]),
                disabled: !this.isSomeDirty(["passphrase", "useDynamicIterationCount", "usePathObfuscation", "encrypt"]),
            }))

        const checkWorkingPassphrase = async (): Promise<boolean> => {
            if (this.editingSettings.remoteType == REMOTE_MINIO) return true;

            const settingForCheck: RemoteDBSettings = {
                ...this.editingSettings,
                // encrypt: encrypt,
                // passphrase: passphrase,
                // useDynamicIterationCount: useDynamicIterationCount,
            };
            const replicator = this.plugin.getReplicator();
            if (!(replicator instanceof LiveSyncCouchDBReplicator)) return true;

            const db = await replicator.connectRemoteCouchDBWithSetting(settingForCheck, this.plugin.isMobile, true);
            if (typeof db === "string") {
                Logger("Could not connect to the database.", LOG_LEVEL_NOTICE);
                return false;
            } else {
                if (await checkSyncInfo(db.db)) {
                    // Logger("Database connected", LOG_LEVEL_NOTICE);
                    return true;
                } else {
                    Logger("Failed to read remote database", LOG_LEVEL_NOTICE);
                    return false;
                }
            }
        };
        const applyEncryption = async (sendToServer: boolean) => {
            if (this.editingSettings.encrypt && this.editingSettings.passphrase == "") {
                Logger("If you enable encryption, you have to set the passphrase", LOG_LEVEL_NOTICE);
                return;
            }
            if (this.editingSettings.encrypt && !(await testCrypt())) {
                Logger("WARNING! Your device does not support encryption.", LOG_LEVEL_NOTICE);
                return;
            }
            if (!(await checkWorkingPassphrase()) && !sendToServer) {
                return;
            }
            if (!this.editingSettings.encrypt) {
                this.editingSettings.passphrase = "";
            }
            // this.applyAllSettings();
            this.saveAllDirtySettings();
            this.plugin.addOnSetup.suspendAllSync();
            this.plugin.addOnSetup.suspendExtraSync();
            this.reloadAllSettings();
            // this.editingSettings.encrypt = encrypt;
            // this.editingSettings.passphrase = passphrase;
            // this.editingSettings.useDynamicIterationCount = useDynamicIterationCount;
            // this.editingSettings.usePathObfuscation = usePathObfuscation;
            this.editingSettings.isConfigured = true;
            await this.saveAllDirtySettings();
            if (sendToServer) {
                await this.plugin.addOnSetup.rebuildRemote()
            } else {
                await this.plugin.markRemoteResolved();
                await this.plugin.replicate(true);
            }
        };

        const rebuildDB = async (method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice" | "localOnlyWithChunks") => {
            if (this.editingSettings.encrypt && this.editingSettings.passphrase == "") {
                Logger("If you enable encryption, you have to set the passphrase", LOG_LEVEL_NOTICE);
                return;
            }
            if (this.editingSettings.encrypt && !(await testCrypt())) {
                Logger("WARNING! Your device does not support encryption.", LOG_LEVEL_NOTICE);
                return;
            }
            if (!this.editingSettings.encrypt) {
                this.editingSettings.passphrase = "";
            }
            this.applyAllSettings();
            this.plugin.addOnSetup.suspendAllSync();
            this.plugin.addOnSetup.suspendExtraSync();
            this.reloadAllSettings();
            this.editingSettings.isConfigured = true;
            Logger("All synchronizations have been temporarily disabled. Please enable them after the fetching, if you need them.", LOG_LEVEL_NOTICE)
            await this.saveAllDirtySettings();
            this.closeSetting();
            await delay(2000);
            await performRebuildDB(this.plugin, method);
            // this.resetEditingSettings();
        }


        new Setting(containerRemoteDatabaseEl)
            .setClass("wizardOnly")
            .addButton((button) =>
                button
                    .setButtonText("Next")
                    .setCta()
                    .setDisabled(false)
                    .onClick(() => {
                        if (!this.editingSettings.encrypt) {
                            this.editingSettings.passphrase = "";
                        }
                        if (isCloudantURI(this.editingSettings.couchDB_URI)) {
                            this.editingSettings = { ...this.editingSettings, ...PREFERRED_SETTING_CLOUDANT };
                        } else if (this.editingSettings.remoteType == REMOTE_MINIO) {
                            this.editingSettings = { ...this.editingSettings, ...PREFERRED_JOURNAL_SYNC };
                        } else {
                            this.editingSettings = { ...this.editingSettings, ...PREFERRED_SETTING_SELF_HOSTED };
                        }
                        changeDisplay("30")
                    })
            )
            ;

        addScreenElement("0", containerRemoteDatabaseEl);

        const containerGeneralSettingsEl = containerEl.createDiv();
        this.createEl(containerGeneralSettingsEl, "h3", { text: "General Settings" });

        this.createEl(containerGeneralSettingsEl, "h4", { text: "Appearance" });


        const languages = Object.fromEntries([["", "Default"], ...SUPPORTED_I18N_LANGS.map(e => [e, $t(`lang-${e}`)])]) as Record<I18N_LANGS, string>;
        new Setting(containerGeneralSettingsEl).autoWireDropDown(
            "displayLanguage",
            {
                options: languages
            }
        )
        this.addOnSaved("displayLanguage", () => this.display());
        new Setting(containerGeneralSettingsEl).autoWireToggle("showStatusOnEditor");
        new Setting(containerGeneralSettingsEl).autoWireToggle("showOnlyIconsOnEditor",
            { onUpdate: visibleOnly(() => this.isConfiguredAs("showStatusOnEditor", true)) }
        );
        new Setting(containerGeneralSettingsEl).autoWireToggle("showStatusOnStatusbar");

        this.createEl(containerGeneralSettingsEl, "h4", { text: "Logging" });

        new Setting(containerGeneralSettingsEl).autoWireToggle("lessInformationInLog");

        new Setting(containerGeneralSettingsEl)
            .autoWireToggle("showVerboseLog", { onUpdate: visibleOnly(() => this.isConfiguredAs("lessInformationInLog", false)) });

        this.createEl(containerGeneralSettingsEl, "h4", { text: "Performance tweaks" });

        new Setting(containerGeneralSettingsEl)
            .autoWireNumeric("hashCacheMaxCount", { clampMin: 10 });
        new Setting(containerGeneralSettingsEl)
            .autoWireNumeric("hashCacheMaxAmount", { clampMin: 1 });

        this.createEl(containerGeneralSettingsEl, "h4", { text: "Share settings via markdown" });
        new Setting(containerGeneralSettingsEl)
            .autoWireText("settingSyncFile", { holdValue: true })
            .addApplyButton(["settingSyncFile"])

        new Setting(containerGeneralSettingsEl)
            .autoWireToggle("writeCredentialsForSettingSync");

        new Setting(containerGeneralSettingsEl)
            .autoWireToggle("notifyAllSettingSyncFile")

        this.createEl(containerGeneralSettingsEl, "h4", { text: "Advanced Confidentiality" });

        const passphrase_options: Record<ConfigPassphraseStore, string> = {
            "": "Default",
            LOCALSTORAGE: "Use a custom passphrase",
            ASK_AT_LAUNCH: "Ask an passphrase at every launch",
        }

        new Setting(containerGeneralSettingsEl)
            .setName("Encrypting sensitive configuration items")
            .autoWireDropDown("configPassphraseStore", { options: passphrase_options, holdValue: true })
            .setClass("wizardHidden");

        new Setting(containerGeneralSettingsEl)
            .autoWireText("configPassphrase", { isPassword: true, holdValue: true })
            .setClass("wizardHidden")
            .addOnUpdate(() => ({
                disabled: !this.isConfiguredAs("configPassphraseStore", "LOCALSTORAGE")
            }))
        new Setting(containerGeneralSettingsEl)
            .addApplyButton(["configPassphrase", "configPassphraseStore"])
            .setClass("wizardHidden")

        addScreenElement("20", containerGeneralSettingsEl);
        const containerSyncSettingEl = containerEl.createDiv();
        this.createEl(containerSyncSettingEl, "h3", { text: "Sync Settings" });
        // containerSyncSettingEl.addClass("wizardHidden")

        if (this.editingSettings.versionUpFlash != "") {
            const c = this.createEl(containerSyncSettingEl, "div", {
                text: this.editingSettings.versionUpFlash,
                cls: "op-warn sls-setting-hidden"
            }, el => {
                this.createEl(el, "button", { text: "I got it and updated." }, (e) => {
                    e.addClass("mod-cta");
                    e.addEventListener("click", async () => {
                        this.editingSettings.versionUpFlash = "";
                        await this.saveAllDirtySettings();
                        c.remove();
                    });
                })
            }, visibleOnly(() => !this.isConfiguredAs("versionUpFlash", "")));
        }

        this.createEl(containerSyncSettingEl, "div",
            {
                text: `Please select any preset to complete the wizard.`,
                cls: "wizardOnly"
            }
        ).addClasses(["op-warn-info"]);



        const options: Record<string, string> = this.editingSettings.remoteType == REMOTE_COUCHDB ? {
            NONE: "",
            LIVESYNC: "LiveSync",
            PERIODIC: "Periodic w/ batch",
            DISABLE: "Disable all automatic"
        } : { NONE: "", PERIODIC: "Periodic w/ batch", DISABLE: "Disable all automatic" };

        new Setting(containerSyncSettingEl)
            .autoWireDropDown("preset", {
                options: options, holdValue: true,
            }).addButton(button => {
                button.setButtonText("Apply");
                button.onClick(async () => {
                    await this.saveSettings(["preset"]);
                })
            })

        this.addOnSaved("preset", async (currentPreset) => {
            if (currentPreset == "") {
                Logger("Select any preset.", LOG_LEVEL_NOTICE);
                return;
            }
            const presetAllDisabled = {
                batchSave: false,
                liveSync: false,
                periodicReplication: false,
                syncOnSave: false,
                syncOnEditorSave: false,
                syncOnStart: false,
                syncOnFileOpen: false,
                syncAfterMerge: false,
            } as Partial<ObsidianLiveSyncSettings>;
            const presetLiveSync = {
                ...presetAllDisabled,
                liveSync: true
            } as Partial<ObsidianLiveSyncSettings>;
            const presetPeriodic = {
                ...presetAllDisabled,
                batchSave: true,
                periodicReplication: true,
                syncOnSave: false,
                syncOnEditorSave: false,
                syncOnStart: true,
                syncOnFileOpen: true,
                syncAfterMerge: true,
            } as Partial<ObsidianLiveSyncSettings>;

            if (currentPreset == "LIVESYNC") {
                this.editingSettings = {
                    ...this.editingSettings,
                    ...presetLiveSync
                }
                Logger("Synchronization setting configured as LiveSync.", LOG_LEVEL_NOTICE);
            } else if (currentPreset == "PERIODIC") {
                this.editingSettings = {
                    ...this.editingSettings,
                    ...presetPeriodic
                }
                Logger("Synchronization setting configured as Periodic sync with batch database update.", LOG_LEVEL_NOTICE);
            } else {
                Logger("All synchronizations disabled.", LOG_LEVEL_NOTICE);
                this.editingSettings = {
                    ...this.editingSettings,
                    ...presetAllDisabled
                }
            }
            await this.saveAllDirtySettings();
            await this.plugin.realizeSettingSyncMode();
            if (inWizard) {
                this.closeSetting();
                if (!this.editingSettings.isConfigured) {
                    this.editingSettings.isConfigured = true;
                    await this.saveAllDirtySettings();
                    await rebuildDB("localOnly");
                    // this.resetEditingSettings();
                    Logger("All done! Please set up subsequent devices with 'Copy current settings as a new setup URI' and 'Use the copied setup URI'.", LOG_LEVEL_NOTICE);
                    await this.plugin.addOnSetup.command_copySetupURI();
                } else {
                    this.plugin.askReload();
                }
            }
        })

        this.createEl(containerSyncSettingEl, "h4", { text: "Synchronization Methods" }).addClass("wizardHidden");

        // const onlyOnLiveSync = visibleOnly(() => this.isConfiguredAs("syncMode", "LIVESYNC"));
        const onlyOnNonLiveSync = visibleOnly(() => !this.isConfiguredAs("syncMode", "LIVESYNC"));
        const onlyOnPeriodic = visibleOnly(() => this.isConfiguredAs("syncMode", "PERIODIC"));

        const optionsSyncMode = this.editingSettings.remoteType == REMOTE_COUCHDB ? {
            "ONEVENTS": "On events",
            PERIODIC: "Periodic and On events",
            "LIVESYNC": "LiveSync"
        } : { "ONEVENTS": "On events", PERIODIC: "Periodic and On events" }


        new Setting(containerSyncSettingEl)
            .autoWireDropDown("syncMode", {
                //@ts-ignore
                options: optionsSyncMode
            })
            .setClass("wizardHidden")
        this.addOnSaved("syncMode", async (value) => {
            // debugger;
            this.editingSettings.liveSync = false;
            this.editingSettings.periodicReplication = false;
            if (value == "LIVESYNC") {
                this.editingSettings.liveSync = true;
            } else if (value == "PERIODIC") {
                this.editingSettings.periodicReplication = true;
            }
            await this.saveSettings(["liveSync", "periodicReplication"]);

            await this.plugin.realizeSettingSyncMode();
        })

        new Setting(containerSyncSettingEl)
            .autoWireNumeric("periodicReplicationInterval",
                { clampMax: 5000, onUpdate: onlyOnPeriodic }
            ).setClass("wizardHidden")


        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("syncOnSave", { onUpdate: onlyOnNonLiveSync })
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("syncOnEditorSave", { onUpdate: onlyOnNonLiveSync })
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("syncOnFileOpen", { onUpdate: onlyOnNonLiveSync })
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("syncOnStart", { onUpdate: onlyOnNonLiveSync })
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("syncAfterMerge", { onUpdate: onlyOnNonLiveSync })
        this.createEl(containerSyncSettingEl, "h4", { text: "Deletions propagation" }).addClass("wizardHidden")
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("trashInsteadDelete")

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("doNotDeleteFolder")

        this.createEl(containerSyncSettingEl, "h4", { text: "Conflict resolution" }).addClass("wizardHidden");

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("resolveConflictsByNewerFile")

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("checkConflictOnlyOnOpen")

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("showMergeDialogOnlyOnActive")
        this.createEl(containerSyncSettingEl, "h4", { text: "Compatibility" }).addClass("wizardHidden");
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("disableMarkdownAutoMerge")
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("writeDocumentsIfConflicted")

        this.createEl(containerSyncSettingEl, "h4", { text: "Hidden files" }).addClass("wizardHidden");
        const LABEL_ENABLED = "🔁 : Enabled";
        const LABEL_DISABLED = "⏹️ : Disabled"

        const hiddenFileSyncSetting = new Setting(containerSyncSettingEl)
            .setName("Hidden file synchronization").setClass("wizardHidden")
        const hiddenFileSyncSettingEl = hiddenFileSyncSetting.settingEl
        const hiddenFileSyncSettingDiv = hiddenFileSyncSettingEl.createDiv("");
        hiddenFileSyncSettingDiv.innerText = this.editingSettings.syncInternalFiles ? LABEL_ENABLED : LABEL_DISABLED;

        if (this.editingSettings.syncInternalFiles) {
            new Setting(containerSyncSettingEl)
                .setName("Disable Hidden files sync")
                .setClass("wizardHidden")
                .addButton((button) => {
                    button.setButtonText("Disable")
                        .onClick(async () => {
                            this.editingSettings.syncInternalFiles = false;
                            await this.saveAllDirtySettings();
                            this.display();
                        })
                })
        } else {

            new Setting(containerSyncSettingEl)
                .setName("Enable Hidden files sync")
                .setClass("wizardHidden")
                .addButton((button) => {
                    button.setButtonText("Merge")
                        .onClick(async () => {
                            this.closeSetting()
                            // this.resetEditingSettings();
                            await this.plugin.addOnSetup.configureHiddenFileSync("MERGE");
                        })
                })
                .addButton((button) => {
                    button.setButtonText("Fetch")
                        .onClick(async () => {
                            this.closeSetting()
                            // this.resetEditingSettings();
                            await this.plugin.addOnSetup.configureHiddenFileSync("FETCH");
                        })
                })
                .addButton((button) => {
                    button.setButtonText("Overwrite")
                        .onClick(async () => {
                            this.closeSetting()
                            // this.resetEditingSettings();
                            await this.plugin.addOnSetup.configureHiddenFileSync("OVERWRITE");
                        })
                });
        }

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("syncInternalFilesBeforeReplication",
                { onUpdate: visibleOnly(() => this.isConfiguredAs("watchInternalFileChanges", false)) }
            )

        // }
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireNumeric("syncInternalFilesInterval", { clampMin: 10, acceptZero: true })

        const defaultSkipPattern = "\\/node_modules\\/, \\/\\.git\\/, ^\\.git\\/, \\/obsidian-livesync\\/";
        const defaultSkipPatternXPlat = defaultSkipPattern + ",\\/workspace$ ,\\/workspace.json$,\\/workspace-mobile.json$";

        const pat = this.editingSettings.syncInternalFilesIgnorePatterns.split(",").map(x => x.trim()).filter(x => x != "");
        const patSetting = new Setting(containerSyncSettingEl)
            .setName("Hidden files ignore patterns")
            .setClass("wizardHidden")
            .setDesc("");

        new MultipleRegExpControl(
            {
                target: patSetting.controlEl,
                props: {
                    patterns: pat, originals: [...pat], apply: async (newPatterns) => {
                        this.editingSettings.syncInternalFilesIgnorePatterns = newPatterns.map(e => e.trim()).filter(e => e != "").join(", ");
                        await this.saveAllDirtySettings();
                        this.display();
                    }
                }
            }
        )

        const addDefaultPatterns = async (patterns: string) => {
            const oldList = this.editingSettings.syncInternalFilesIgnorePatterns.split(",").map(x => x.trim()).filter(x => x != "");
            const newList = patterns.split(",").map(x => x.trim()).filter(x => x != "");
            const allSet = new Set([...oldList, ...newList]);
            this.editingSettings.syncInternalFilesIgnorePatterns = [...allSet].join(", ");
            await this.saveAllDirtySettings();
            this.display();
        }

        new Setting(containerSyncSettingEl)
            .setName("Add default patterns")
            .setClass("wizardHidden")
            .addButton((button) => {
                button.setButtonText("Default")
                    .onClick(async () => {
                        await addDefaultPatterns(defaultSkipPattern);
                    })
            }).addButton((button) => {
                button.setButtonText("Cross-platform")
                    .onClick(async () => {
                        await addDefaultPatterns(defaultSkipPatternXPlat);
                    })
            })


        this.createEl(containerSyncSettingEl, "h4", { text: "Performance tweaks" }).addClass("wizardHidden");
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("batchSave")

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireNumeric("customChunkSize", { clampMin: 0 })

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("readChunksOnline", { onUpdate: onlyOnCouchDB })

        this.createEl(containerSyncSettingEl, "h4", {
            text: sanitizeHTMLToDom(`Targets`),
        }).addClass("wizardHidden");

        const syncFilesSetting = new Setting(containerSyncSettingEl)
            .setName("Synchronising files")
            .setDesc("(RegExp) Empty to sync all files. Set filter as a regular expression to limit synchronising files.")
            .setClass("wizardHidden")
        new MultipleRegExpControl(
            {
                target: syncFilesSetting.controlEl,
                props: {
                    patterns: this.editingSettings.syncOnlyRegEx.split("|[]|"),
                    originals: [...this.editingSettings.syncOnlyRegEx.split("|[]|")],
                    apply: async (newPatterns) => {
                        this.editingSettings.syncOnlyRegEx = newPatterns.map(e => e.trim()).filter(e => e != "").join("|[]|");
                        await this.saveAllDirtySettings();
                        this.display();
                    }
                }
            }
        )

        const nonSyncFilesSetting = new Setting(containerSyncSettingEl)
            .setName("Non-Synchronising files")
            .setDesc("(RegExp) If this is set, any changes to local and remote files that match this will be skipped.")
            .setClass("wizardHidden");

        new MultipleRegExpControl(
            {
                target: nonSyncFilesSetting.controlEl,
                props: {
                    patterns: this.editingSettings.syncIgnoreRegEx.split("|[]|"),
                    originals: [...this.editingSettings.syncIgnoreRegEx.split("|[]|")],
                    apply: async (newPatterns) => {
                        this.editingSettings.syncIgnoreRegEx = newPatterns.map(e => e.trim()).filter(e => e != "").join("|[]|");
                        await this.saveAllDirtySettings();
                        this.display();
                    }
                }
            }
        )
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireNumeric("syncMaxSizeInMB", { clampMin: 0 })

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("useIgnoreFiles")
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireTextArea("ignoreFiles", { onUpdate: visibleOnly(() => this.isConfiguredAs("useIgnoreFiles", true)) });

        this.createEl(containerSyncSettingEl, "h4", {
            text: sanitizeHTMLToDom(`Advanced settings`),
        }, undefined, onlyOnCouchDB).addClass("wizardHidden");

        this.createEl(containerSyncSettingEl, "div", {
            text: `If you reached the payload size limit when using IBM Cloudant, please decrease batch size and batch limit to a lower value.`,
        }, undefined, onlyOnCouchDB).addClass("wizardHidden");

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireNumeric("batch_size", { clampMin: 2, onUpdate: onlyOnCouchDB })
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireNumeric("batches_limit", { clampMin: 2, onUpdate: onlyOnCouchDB })
        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireToggle("useTimeouts", { onUpdate: onlyOnCouchDB });

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireNumeric("concurrencyOfReadChunksOnline", { clampMin: 10, onUpdate: onlyOnCouchDB })

        new Setting(containerSyncSettingEl)
            .setClass("wizardHidden")
            .autoWireNumeric("minimumIntervalOfReadChunksOnline", { clampMin: 10, onUpdate: onlyOnCouchDB })

        addScreenElement("30", containerSyncSettingEl);
        const containerHatchEl = containerEl.createDiv();

        this.createEl(containerHatchEl, "h3", { text: "Hatch" });


        new Setting(containerHatchEl)
            .setName("Make report to inform the issue")
            .addButton((button) =>
                button
                    .setButtonText("Make report")
                    .setDisabled(false)
                    .onClick(async () => {
                        let responseConfig: any = {};
                        const REDACTED = "𝑅𝐸𝐷𝐴𝐶𝑇𝐸𝐷";
                        if (this.editingSettings.remoteType == REMOTE_COUCHDB) {
                            try {
                                const r = await requestToCouchDB(this.editingSettings.couchDB_URI, this.editingSettings.couchDB_USER, this.editingSettings.couchDB_PASSWORD, window.origin);

                                Logger(JSON.stringify(r.json, null, 2));

                                responseConfig = r.json;
                                responseConfig["couch_httpd_auth"].secret = REDACTED;
                                responseConfig["couch_httpd_auth"].authentication_db = REDACTED;
                                responseConfig["couch_httpd_auth"].authentication_redirect = REDACTED;
                                responseConfig["couchdb"].uuid = REDACTED;
                                responseConfig["admins"] = REDACTED;

                            } catch (ex) {
                                responseConfig = "Requesting information from the remote CouchDB has failed. If you are using IBM Cloudant, this is normal behaviour."
                            }
                        } else if (this.editingSettings.remoteType == REMOTE_MINIO) {
                            responseConfig = "Object Storage Synchronisation";
                            //
                        }
                        const pluginConfig = JSON.parse(JSON.stringify(this.editingSettings)) as ObsidianLiveSyncSettings;
                        pluginConfig.couchDB_DBNAME = REDACTED;
                        pluginConfig.couchDB_PASSWORD = REDACTED;
                        const scheme = pluginConfig.couchDB_URI.startsWith("http:") ? "(HTTP)" : (pluginConfig.couchDB_URI.startsWith("https:")) ? "(HTTPS)" : ""
                        pluginConfig.couchDB_URI = isCloudantURI(pluginConfig.couchDB_URI) ? "cloudant" : `self-hosted${scheme}`;
                        pluginConfig.couchDB_USER = REDACTED;
                        pluginConfig.passphrase = REDACTED;
                        pluginConfig.encryptedPassphrase = REDACTED;
                        pluginConfig.encryptedCouchDBConnection = REDACTED;
                        pluginConfig.accessKey = REDACTED;
                        pluginConfig.secretKey = REDACTED;
                        pluginConfig.region = `${REDACTED}(${pluginConfig.region.length} letters)`;
                        pluginConfig.bucket = `${REDACTED}(${pluginConfig.bucket.length} letters)`;
                        pluginConfig.pluginSyncExtendedSetting = {};
                        const endpoint = pluginConfig.endpoint;
                        if (endpoint == "") {
                            pluginConfig.endpoint = "Not configured or AWS";
                        } else {
                            const endpointScheme = pluginConfig.endpoint.startsWith("http:") ? "(HTTP)" : (pluginConfig.endpoint.startsWith("https:")) ? "(HTTPS)" : "";
                            pluginConfig.endpoint = `${endpoint.indexOf(".r2.cloudflarestorage.") !== -1 ? "R2" : "self-hosted?"}(${endpointScheme})`;
                        }
                        const obsidianInfo = navigator.userAgent;
                        const msgConfig = `---- Obsidian info ----
${obsidianInfo}
---- remote config ----
${stringifyYaml(responseConfig)}
---- Plug-in config ---
version:${manifestVersion}
${stringifyYaml(pluginConfig)}`;
                        console.log(msgConfig);
                        await navigator.clipboard.writeText(msgConfig);
                        Logger(`Information has been copied to clipboard`, LOG_LEVEL_NOTICE);
                    })
            );

        if (this.plugin?.replicator?.remoteLockedAndDeviceNotAccepted) {
            const c = this.createEl(containerHatchEl, "div", {
                text: "To prevent unwanted vault corruption, the remote database has been locked for synchronization, and this device was not marked as 'resolved'. It caused by some operations like this. Re-initialized. Local database initialization should be required. Please back your vault up, reset the local database, and press 'Mark this device as resolved'. ",
            });
            this.createEl(c, "button", { text: "I'm ready, mark this device 'resolved'" }, (e) => {
                e.addClass("mod-warning");
                e.addEventListener("click", async () => {
                    await this.plugin.markRemoteResolved();
                    c.remove();
                });
            });
            c.addClass("op-warn");
        } else {
            if (this.plugin?.replicator?.remoteLocked) {
                const c = this.createEl(containerHatchEl, "div", {
                    text: "To prevent unwanted vault corruption, the remote database has been locked for synchronization. (This device is marked 'resolved') When all your devices are marked 'resolved', unlock the database.",
                });
                this.createEl(c, "button", { text: "I'm ready, unlock the database" }, (e) => {
                    e.addClass("mod-warning");
                    e.addEventListener("click", async () => {
                        await this.plugin.markRemoteUnlocked();
                        c.remove();
                    });
                });
                c.addClass("op-warn");
            }
        }

        new Setting(containerHatchEl)
            .setName("Back to non-configured")
            .addButton((button) =>
                button
                    .setButtonText("Back")
                    .setDisabled(false)
                    .onClick(async () => {
                        this.editingSettings.isConfigured = false;
                        await this.saveAllDirtySettings();
                        this.plugin.askReload();
                    }));
        const hatchWarn = this.createEl(containerHatchEl, "div", { text: `To stop the boot up sequence for fixing problems on databases, you can put redflag.md on top of your vault (Rebooting obsidian is required).` });
        hatchWarn.addClass("op-warn-info");


        const addResult = (path: string, file: TFile | false, fileOnDB: LoadedEntry | false) => {
            resultArea.appendChild(this.createEl(resultArea, "div", {}, el => {
                el.appendChild(this.createEl(el, "h6", { text: path }));
                el.appendChild(this.createEl(el, "div", {}, infoGroupEl => {
                    infoGroupEl.appendChild(this.createEl(infoGroupEl, "div", { text: `Storage : Modified: ${!file ? `Missing:` : `${new Date(file.stat.mtime).toLocaleString()}, Size:${file.stat.size}`}` }))
                    infoGroupEl.appendChild(this.createEl(infoGroupEl, "div", { text: `Database: Modified: ${!fileOnDB ? `Missing:` : `${new Date(fileOnDB.mtime).toLocaleString()}, Size:${fileOnDB.size}`}` }))
                }));
                if (fileOnDB && file) {
                    el.appendChild(this.createEl(el, "button", { text: "Show history" }, buttonEl => {
                        buttonEl.onClickEvent(() => {
                            this.plugin.showHistory(file, fileOnDB._id);
                        })
                    }))
                }
                if (file) {
                    el.appendChild(this.createEl(el, "button", { text: "Storage -> Database" }, buttonEl => {
                        buttonEl.onClickEvent(() => {
                            this.plugin.updateIntoDB(file, undefined, true);
                            el.remove();
                        })
                    }))
                }
                if (fileOnDB) {
                    el.appendChild(this.createEl(el, "button", { text: "Database -> Storage" }, buttonEl => {
                        buttonEl.onClickEvent(() => {
                            this.plugin.pullFile(this.plugin.getPath(fileOnDB), [], true, undefined, false);
                            el.remove();
                        })
                    }))
                }
                return el;
            }))
        }

        const checkBetweenStorageAndDatabase = async (file: TFile, fileOnDB: LoadedEntry) => {
            const dataContent = readAsBlob(fileOnDB);
            const content = createBlob(await this.plugin.vaultAccess.vaultReadAuto(file))
            if (await isDocContentSame(content, dataContent)) {
                Logger(`Compare: SAME: ${file.path}`)
            } else {
                Logger(`Compare: CONTENT IS NOT MATCHED! ${file.path}`, LOG_LEVEL_NOTICE);
                addResult(file.path, file, fileOnDB)
            }
        }
        new Setting(containerHatchEl)
            .setName("Verify and repair all files")
            .setDesc("Compare the content of files between on local database and storage. If not matched, you will be asked which one you want to keep.")
            .addButton((button) =>
                button
                    .setButtonText("Verify all")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        const files = this.app.vault.getFiles();
                        const documents = [] as FilePathWithPrefix[];

                        const adn = this.plugin.localDatabase.findAllNormalDocs()
                        for await (const i of adn) documents.push(this.plugin.getPath(i));
                        const allPaths = [...new Set([...documents, ...files.map(e => e.path as FilePathWithPrefix)])];
                        let i = 0;
                        for (const path of allPaths) {
                            i++;
                            Logger(`${i}/${files.length}\n${path}`, LOG_LEVEL_NOTICE, "verify");
                            if (shouldBeIgnored(path)) continue;
                            const abstractFile = this.plugin.vaultAccess.getAbstractFileByPath(path);
                            const fileOnStorage = abstractFile instanceof TFile ? abstractFile : false;
                            if (!await this.plugin.isTargetFile(path)) continue;

                            if (fileOnStorage && this.plugin.isFileSizeExceeded(fileOnStorage.stat.size)) continue;
                            const fileOnDB = await this.plugin.localDatabase.getDBEntry(path);
                            if (fileOnDB && this.plugin.isFileSizeExceeded(fileOnDB.size)) continue;

                            if (!fileOnDB && fileOnStorage) {
                                Logger(`Compare: Not found on the local database: ${path}`, LOG_LEVEL_NOTICE);
                                addResult(path, fileOnStorage, false)
                                continue;
                            }
                            if (fileOnDB && !fileOnStorage) {
                                Logger(`Compare: Not found on the storage: ${path}`, LOG_LEVEL_NOTICE);
                                addResult(path, false, fileOnDB)
                                continue;
                            }
                            if (fileOnStorage && fileOnDB) {
                                await checkBetweenStorageAndDatabase(fileOnStorage, fileOnDB)
                            }
                        }
                        Logger("done", LOG_LEVEL_NOTICE, "verify");
                    })
            );
        const resultArea = containerHatchEl.createDiv({ text: "" });
        new Setting(containerHatchEl)
            .setName("Check and convert non-path-obfuscated files")
            .setDesc("")
            .addButton((button) =>
                button
                    .setButtonText("Perform")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        for await (const docName of this.plugin.localDatabase.findAllDocNames()) {
                            if (!docName.startsWith("f:")) {
                                const idEncoded = await this.plugin.path2id(docName as FilePathWithPrefix);
                                const doc = await this.plugin.localDatabase.getRaw(docName as DocumentID);
                                if (!doc) continue;
                                if (doc.type != "newnote" && doc.type != "plain") {
                                    continue;
                                }
                                if (doc?.deleted ?? false) continue;
                                const newDoc = { ...doc };
                                //Prepare converted data
                                newDoc._id = idEncoded;
                                newDoc.path = docName as FilePathWithPrefix;
                                // @ts-ignore
                                delete newDoc._rev;
                                try {
                                    const obfuscatedDoc = await this.plugin.localDatabase.getRaw(idEncoded, { revs_info: true });
                                    // Unfortunately we have to delete one of them.
                                    // Just now, save it as a conflicted document.
                                    obfuscatedDoc._revs_info?.shift(); // Drop latest revision.
                                    const previousRev = obfuscatedDoc._revs_info?.shift(); // Use second revision.
                                    if (previousRev) {
                                        newDoc._rev = previousRev.rev;
                                    } else {
                                        //If there are no revisions, set the possibly unique one
                                        newDoc._rev = "1-" + (`00000000000000000000000000000000${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}`.slice(-32));
                                    }
                                    const ret = await this.plugin.localDatabase.putRaw(newDoc, { force: true });
                                    if (ret.ok) {
                                        Logger(`${docName} has been converted as conflicted document`, LOG_LEVEL_NOTICE);
                                        doc._deleted = true;
                                        if ((await this.plugin.localDatabase.putRaw(doc)).ok) {
                                            Logger(`Old ${docName} has been deleted`, LOG_LEVEL_NOTICE);
                                        }
                                        await this.plugin.queueConflictCheck(docName as FilePathWithPrefix);
                                    } else {
                                        Logger(`Converting ${docName} Failed!`, LOG_LEVEL_NOTICE);
                                        Logger(ret, LOG_LEVEL_VERBOSE);
                                    }
                                } catch (ex: any) {
                                    if (ex?.status == 404) {
                                        // We can perform this safely
                                        if ((await this.plugin.localDatabase.putRaw(newDoc)).ok) {
                                            Logger(`${docName} has been converted`, LOG_LEVEL_NOTICE);
                                            doc._deleted = true;
                                            if ((await this.plugin.localDatabase.putRaw(doc)).ok) {
                                                Logger(`Old ${docName} has been deleted`, LOG_LEVEL_NOTICE);
                                            }
                                        }
                                    } else {
                                        Logger(`Something went wrong while converting ${docName}`, LOG_LEVEL_NOTICE);
                                        Logger(ex, LOG_LEVEL_VERBOSE);
                                        // Something wrong.
                                    }
                                }
                            }
                        }
                        Logger(`Converting finished`, LOG_LEVEL_NOTICE);
                    }));

        new Setting(containerHatchEl)
            .setName("Delete all customization sync data")
            .addButton((button) =>
                button
                    .setButtonText("Delete")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        Logger(`Deleting customization sync data`, LOG_LEVEL_NOTICE);
                        const entriesToDelete = (await this.plugin.localDatabase.allDocsRaw({
                            startkey: "ix:",
                            endkey: "ix:\u{10ffff}",
                            include_docs: true
                        }));
                        const newData = entriesToDelete.rows.map(e => ({ ...e.doc, _deleted: true }));
                        const r = await this.plugin.localDatabase.bulkDocsRaw(newData as any[]);
                        // Do not care about the result.
                        Logger(`${r.length} items have been removed, to confirm how many items are left, please perform it again.`, LOG_LEVEL_NOTICE);
                    }))


        new Setting(containerHatchEl)
            .autoWireToggle("suspendFileWatching")
        this.addOnSaved("suspendFileWatching", () => this.plugin.askReload());

        new Setting(containerHatchEl)
            .autoWireToggle("suspendParseReplicationResult")
        this.addOnSaved("suspendParseReplicationResult", () => this.plugin.askReload());

        new Setting(containerHatchEl)
            .autoWireToggle("writeLogToTheFile")

        this.createEl(containerHatchEl, "h4", {
            text: sanitizeHTMLToDom(`Compatibility`),
            cls: "wizardHidden"
        });

        new Setting(containerHatchEl)
            .setClass("wizardHidden")
            .autoWireToggle("deleteMetadataOfDeletedFiles")

        new Setting(containerHatchEl)
            .setClass("wizardHidden")
            .autoWireNumeric("automaticallyDeleteMetadataOfDeletedFiles", { onUpdate: visibleOnly(() => this.isConfiguredAs("deleteMetadataOfDeletedFiles", true)) })


        new Setting(containerHatchEl)
            .autoWireToggle("useIndexedDBAdapter", { invert: true })

        this.addOnSaved("useIndexedDBAdapter", async () => {
            await this.saveAllDirtySettings();
            await rebuildDB("localOnly");
        })

        new Setting(containerHatchEl)
            .autoWireToggle("watchInternalFileChanges", { invert: true })

        new Setting(containerHatchEl)
            .autoWireText("additionalSuffixOfDatabaseName", { holdValue: true })
            .addApplyButton(["additionalSuffixOfDatabaseName"]);

        this.addOnSaved("additionalSuffixOfDatabaseName", async (key) => {
            Logger("Suffix has been changed. Reopening database...", LOG_LEVEL_NOTICE);
            await this.plugin.initializeDatabase();
        })

        new Setting(containerHatchEl)
            .autoWireDropDown("hashAlg", {
                options: {
                    "": "Old Algorithm",
                    "xxhash32": "xxhash32 (Fast)",
                    "xxhash64": "xxhash64 (Fastest)",
                    "sha1": "Fallback (Without WebAssembly)"
                } as Record<HashAlgorithm, string>
            })
        this.addOnSaved("hashAlg", async () => {
            await this.plugin.localDatabase.prepareHashFunctions();
        })


        new Setting(containerHatchEl)
            .autoWireToggle("doNotSuspendOnFetching")
        new Setting(containerHatchEl)
            .autoWireToggle("disableCheckingConfigMismatch")

        addScreenElement("50", containerHatchEl);


        // With great respect, thank you TfTHacker!
        // Refer: https://github.com/TfTHacker/obsidian42-brat/blob/main/src/features/BetaPlugins.ts
        const containerPluginSettings = containerEl.createDiv();
        this.createEl(containerPluginSettings, "h3", { text: "Customization sync (beta)" });

        const enableOnlyOnPluginSyncIsNotEnabled = enableOnly(() => this.isConfiguredAs("usePluginSync", false));
        const visibleOnlyOnPluginSyncEnabled = visibleOnly(() => this.isConfiguredAs("usePluginSync", true));

        new Setting(containerPluginSettings)
            .autoWireText("deviceAndVaultName", {
                placeHolder: "desktop",
                onUpdate: enableOnlyOnPluginSyncIsNotEnabled
            });

        new Setting(containerPluginSettings)
            .autoWireToggle("usePluginSync", {
                onUpdate: enableOnly(() => !this.isConfiguredAs("deviceAndVaultName", ""))
            });

        new Setting(containerPluginSettings)
            .autoWireToggle("autoSweepPlugins", {
                onUpdate: visibleOnlyOnPluginSyncEnabled
            })

        new Setting(containerPluginSettings)
            .autoWireToggle("autoSweepPluginsPeriodic", {
                onUpdate: visibleOnly(() => this.isConfiguredAs("usePluginSync", true) && this.isConfiguredAs("autoSweepPlugins", true))
            })
        new Setting(containerPluginSettings)
            .autoWireToggle("notifyPluginOrSettingUpdated", {
                onUpdate: visibleOnlyOnPluginSyncEnabled
            })

        new Setting(containerPluginSettings)
            .setName("Open")
            .setDesc("Open the dialog")
            .addButton((button) => {
                button
                    .setButtonText("Open")
                    .setDisabled(false)
                    .onClick(() => {
                        this.plugin.addOnConfigSync.showPluginSyncModal();
                    });
            })
            .addOnUpdate(visibleOnlyOnPluginSyncEnabled);

        addScreenElement("60", containerPluginSettings);

        const containerMaintenanceEl = containerEl.createDiv();

        this.createEl(containerMaintenanceEl, "h3", { text: "Maintenance" });

        this.createEl(containerMaintenanceEl, "h4", { text: "Remote" });

        new Setting(containerMaintenanceEl)
            .setName("Perform compaction")
            .setDesc("Compaction discards all of Eden in the non-latest revisions, reducing the storage usage. However, this operation requires the same free space on the remote as the current database.")
            .addButton((button) =>
                button
                    .setButtonText("Perform")
                    .setDisabled(false)
                    .onClick(async () => {
                        const replicator = this.plugin.replicator as LiveSyncCouchDBReplicator;
                        Logger(`Compaction has been began`, LOG_LEVEL_NOTICE, "compaction")
                        if (await replicator.compactRemote(this.editingSettings)) {
                            Logger(`Compaction has been completed!`, LOG_LEVEL_NOTICE, "compaction");
                        } else {
                            Logger(`Compaction has been failed!`, LOG_LEVEL_NOTICE, "compaction");
                        }
                    })
            ).addOnUpdate(onlyOnCouchDB);

        new Setting(containerMaintenanceEl)
            .setName("Lock remote")
            .setDesc("Lock remote to prevent synchronization with other devices.")
            .addButton((button) =>
                button
                    .setButtonText("Lock")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.markRemoteLocked();
                    })
            );

        new Setting(containerMaintenanceEl)
            .setName("Overwrite remote")
            .setDesc("Overwrite remote with local DB and passphrase.")
            .addButton((button) =>
                button
                    .setButtonText("Send")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("remoteOnly");
                    })
            )

        new Setting(containerMaintenanceEl)
            .setName("Reset journal received history")
            .setDesc("Initialise journal received history. On the next sync, every item except this device sent will be downloaded again.")
            .addButton((button) =>
                button
                    .setButtonText("Reset received")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                            ...info,
                            receivedFiles: new Set(),
                            knownIDs: new Set()
                        }));
                        Logger(`Journal received history has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            ).addOnUpdate(onlyOnMinIO);

        new Setting(containerMaintenanceEl)
            .setName("Reset journal sent history")
            .setDesc("Initialise journal sent history. On the next sync, every item except this device received will be sent again.")
            .addButton((button) =>
                button
                    .setButtonText("Reset sent history")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                            ...info,
                            lastLocalSeq: 0,
                            sentIDs: new Set(),
                            sentFiles: new Set()
                        }));
                        Logger(`Journal sent history has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            ).addOnUpdate(onlyOnMinIO);

        new Setting(containerMaintenanceEl)
            .setName("Reset all journal counter")
            .setDesc("Initialise all journal history, On the next sync, every item will be received and sent.")
            .addButton((button) =>
                button
                    .setButtonText("Reset all")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.getMinioJournalSyncClient().resetCheckpointInfo();
                        Logger(`Journal exchange history has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            ).addOnUpdate(onlyOnMinIO);

        new Setting(containerMaintenanceEl)
            .setName("Purge all journal counter")
            .setDesc("Purge all sending and downloading cache.")
            .addButton((button) =>
                button
                    .setButtonText("Reset all")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.getMinioJournalSyncClient().resetAllCaches();
                        Logger(`Journal sending and downloading cache has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            ).addOnUpdate(onlyOnMinIO);

        new Setting(containerMaintenanceEl)
            .setName("Make empty the bucket")
            .setDesc("Delete all data on the remote.")
            .addButton((button) =>
                button
                    .setButtonText("Delete")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                            ...info,
                            receivedFiles: new Set(),
                            knownIDs: new Set(),
                            lastLocalSeq: 0,
                            sentIDs: new Set(),
                            sentFiles: new Set()
                        }));
                        await this.plugin.resetRemoteBucket();
                        Logger(`the bucket has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            ).addOnUpdate(onlyOnMinIO);

        this.createEl(containerMaintenanceEl, "h4", { text: "Local database" });

        new Setting(containerMaintenanceEl)
            .setName("Fetch from remote")
            .setDesc("Restore or reconstruct local database from remote.")
            .addButton((button) =>
                button
                    .setButtonText("Fetch")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.vaultAccess.vaultCreate(FLAGMD_REDFLAG3_HR, "");
                        this.plugin.performAppReload();
                    })
            ).addButton((button) =>
                button
                    .setButtonText("Fetch w/o restarting")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("localOnly");
                    })
            )

        new Setting(containerMaintenanceEl)
            .setName("Fetch rebuilt DB (Save local documents before)")
            .setDesc("Restore or reconstruct local database from remote database but use local chunks.")
            .addButton((button) =>
                button
                    .setButtonText("Save and Fetch")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("localOnlyWithChunks");
                    })
            ).addOnUpdate(onlyOnCouchDB);

        new Setting(containerMaintenanceEl)
            .setName("Discard local database to reset or uninstall Self-hosted LiveSync")
            .addButton((button) =>
                button
                    .setButtonText("Discard")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.resetLocalDatabase();
                        await this.plugin.initializeDatabase();
                    })
            );

        this.createEl(containerMaintenanceEl, "h4", { text: "Both databases" });

        new Setting(containerMaintenanceEl)
            .setName("(Beta2) Clean up databases")
            .setDesc("Delete unused chunks to shrink the database. This feature requires disabling 'Use an old adapter for compatibility'")
            .addButton((button) =>
                button.setButtonText("DryRun")
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.dryRunGC();
                    })
            ).addButton((button) =>
                button.setButtonText("Perform cleaning")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        this.closeSetting()
                        await this.plugin.dbGC();
                    })
            ).addOnUpdate(onlyOnCouchDB);

        new Setting(containerMaintenanceEl)
            .setName("Rebuild everything")
            .setDesc("Rebuild local and remote database with local files.")
            .addButton((button) =>
                button
                    .setButtonText("Rebuild")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.vaultAccess.vaultCreate(FLAGMD_REDFLAG2_HR, "");
                        this.plugin.performAppReload();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Rebuild w/o restarting")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await rebuildDB("rebuildBothByThisDevice");
                    })
            )

        addScreenElement("70", containerMaintenanceEl);

        if (this.selectedScreen == "") {
            if (lastVersion != this.editingSettings.lastReadUpdates) {
                if (this.editingSettings.isConfigured) {
                    changeDisplay("100");
                } else {
                    changeDisplay("110")
                }
            } else {
                if (isAnySyncEnabled()) {
                    changeDisplay("20");
                } else {
                    changeDisplay("110")
                }
            }
        } else {
            changeDisplay(this.selectedScreen);
        }
        this.requestUpdate();
    }
}
