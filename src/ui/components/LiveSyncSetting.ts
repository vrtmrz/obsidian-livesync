import { Setting, TextComponent, type ToggleComponent, type DropdownComponent, ButtonComponent, type TextAreaComponent, type ValueComponent } from "obsidian";
import { unique } from "octagonal-wheels/collection";
import { LEVEL_ADVANCED, LEVEL_POWER_USER, statusDisplay, type ConfigurationItem } from "../../lib/src/common/types";
import { type ObsidianLiveSyncSettingTab, type AutoWireOption, wrapMemo, type OnUpdateResult, createStub, findAttrFromParent } from "../ObsidianLiveSyncSettingTab";
import { type AllSettingItemKey, getConfig, type AllSettings, type AllStringItemKey, type AllNumericItemKey, type AllBooleanItemKey } from "../settingConstants";


export class LiveSyncSetting extends Setting {
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
        LiveSyncSetting.env.settingComponents.push(this);
    }

    _createDocStub(key: string, value: string | DocumentFragment) {
        DEV: {
            const paneName = findAttrFromParent(this.settingEl, "data-pane");
            const panelName = findAttrFromParent(this.settingEl, "data-panel");
            const itemName = typeof this.nameBuf == "string" ? this.nameBuf : this.nameBuf.textContent?.toString() ?? "";
            const strValue = typeof value == "string" ? value : value.textContent?.toString() ?? "";

            createStub(itemName, key, strValue, panelName, paneName);
        }
    }

    setDesc(desc: string | DocumentFragment): this {
        this.descBuf = desc;
        DEV: {
            this._createDocStub("desc", desc);
        }
        super.setDesc(desc);
        return this;
    }
    setName(name: string | DocumentFragment): this {
        this.nameBuf = name;
        DEV: {
            this._createDocStub("name", name);
        }
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
        DEV: {
            this._createDocStub("key", key);
            if (conf.obsolete) this._createDocStub("is_obsolete", "true");
            if (conf.level) this._createDocStub("level", conf.level);
        }

        this.holdValue = opt?.holdValue || this.holdValue;
        this.selfKey = key;
        if (conf.obsolete || opt?.obsolete) {
            this.settingEl.toggleClass("sls-setting-obsolete", true);
        }
        if (opt?.onUpdate) this.addOnUpdate(opt.onUpdate);
        const stat = this._getComputedStatus();
        if (stat.visibility === false) {
            this.settingEl.toggleClass("sls-setting-hidden", !stat.visibility);
        }
        return conf;
    }
    autoWireComponent(component: ValueComponent<any>, conf?: ConfigurationItem, opt?: AutoWireOption) {
        this.placeHolderBuf = conf?.placeHolder || opt?.placeHolder || "";
        if (conf?.level == LEVEL_ADVANCED) {
            this.settingEl.toggleClass("sls-setting-advanced", true);
        } else if (conf?.level == LEVEL_POWER_USER) {
            this.settingEl.toggleClass("sls-setting-poweruser", true);
        }
        if (this.placeHolderBuf && component instanceof TextComponent) {
            component.setPlaceholder(this.placeHolderBuf);
        }
        if (opt?.onUpdate) this.addOnUpdate(opt.onUpdate);
    }
    async commitValue<T extends AllSettingItemKey>(value: AllSettings[T]) {
        const key = this.selfKey as T;
        if (key !== undefined) {
            if (value != LiveSyncSetting.env.editingSettings[key]) {
                LiveSyncSetting.env.editingSettings[key] = value;
                if (!this.holdValue) {
                    await LiveSyncSetting.env.saveSettings([key]);
                }
            }
        }
        LiveSyncSetting.env.requestUpdate();
    }
    autoWireText(key: AllStringItemKey, opt?: AutoWireOption) {
        const conf = this.autoWireSetting(key, opt);
        this.addText(text => {
            this.autoWiredComponent = text;
            const setValue = wrapMemo((value: string) => text.setValue(value));
            this.invalidateValue = () => setValue(`${LiveSyncSetting.env.editingSettings[key]}`);
            this.invalidateValue();
            text.onChange(async (value) => {
                await this.commitValue(value);
            });
            if (opt?.isPassword) {
                text.inputEl.setAttribute("type", "password");
                this.hasPassword = true;
            }
            this.autoWireComponent(this.autoWiredComponent, conf, opt);
        });
        return this;
    }
    autoWireTextArea(key: AllStringItemKey, opt?: AutoWireOption) {
        const conf = this.autoWireSetting(key, opt);
        this.addTextArea(text => {
            this.autoWiredComponent = text;
            const setValue = wrapMemo((value: string) => text.setValue(value));
            this.invalidateValue = () => setValue(`${LiveSyncSetting.env.editingSettings[key]}`);
            this.invalidateValue();
            text.onChange(async (value) => {
                await this.commitValue(value);
            });
            if (opt?.isPassword) {
                text.inputEl.setAttribute("type", "password");
                this.hasPassword = true;
            }
            this.autoWireComponent(this.autoWiredComponent, conf, opt);
        });
        return this;
    }
    autoWireNumeric(key: AllNumericItemKey, opt: AutoWireOption & { clampMin?: number; clampMax?: number; acceptZero?: boolean; }) {
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
                if (!lastError) setValue(`${LiveSyncSetting.env.editingSettings[key]}`);
            };
            this.invalidateValue();
            text.onChange(async (TextValue) => {
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
            });
            text.inputEl.setAttr("type", "number");
            this.autoWireComponent(this.autoWiredComponent, conf, opt);
        });
        return this;
    }
    autoWireToggle(key: AllBooleanItemKey, opt?: AutoWireOption) {
        const conf = this.autoWireSetting(key, opt);
        this.addToggle(toggle => {
            this.autoWiredComponent = toggle;
            const setValue = wrapMemo((value: boolean) => toggle.setValue(opt?.invert ? !value : value));
            this.invalidateValue = () => setValue(LiveSyncSetting.env.editingSettings[key] ?? false);
            this.invalidateValue();

            toggle.onChange(async (value) => {
                await this.commitValue(opt?.invert ? !value : value);
            });

            this.autoWireComponent(this.autoWiredComponent, conf, opt);
        });
        return this;
    }
    autoWireDropDown<T extends string>(key: AllStringItemKey, opt: AutoWireOption & { options: Record<T, string>; }) {
        const conf = this.autoWireSetting(key, opt);
        this.addDropdown(dropdown => {
            this.autoWiredComponent = dropdown;
            const setValue = wrapMemo((value: string) => {
                dropdown.setValue(value);
            });

            dropdown
                .addOptions(opt.options);

            this.invalidateValue = () => setValue(LiveSyncSetting.env.editingSettings[key] || "");
            this.invalidateValue();
            dropdown.onChange(async (value) => {
                await this.commitValue(value);
            });
            this.autoWireComponent(this.autoWiredComponent, conf, opt);
        });
        return this;
    }
    addApplyButton(keys: AllSettingItemKey[], text?: string) {
        this.addButton((button) => {
            this.applyButtonComponent = button;
            this.watchDirtyKeys = unique([...keys, ...this.watchDirtyKeys]);
            button.setButtonText(text ?? "Apply");
            button.onClick(async () => {
                await LiveSyncSetting.env.saveSettings(keys);
                LiveSyncSetting.env.reloadAllSettings();
            });
            LiveSyncSetting.env.requestUpdate();
        });
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
            };
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
                        this.settingEl.toggleClass("sls-setting-hidden", !(newConf[k] || false));
                        this.prevStatus[k] = newConf[k];
                        break;
                    case "classes":
                        break;
                    case "disabled":
                        this.setDisabled((newConf[k] || false));
                        this.settingEl.toggleClass("sls-setting-disabled", (newConf[k] || false));
                        this.prevStatus[k] = newConf[k];
                        break;
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
                        break;
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
                        break;
                }
            }
        }
    }
    _onUpdate() {
        if (this.applyButtonComponent) {
            const isDirty = LiveSyncSetting.env.isSomeDirty(this.watchDirtyKeys);
            this.applyButtonComponent.setDisabled(!isDirty);
            if (isDirty) {
                this.applyButtonComponent.setCta();
            } else {
                this.applyButtonComponent.removeCta();
            }
        }
        if (this.selfKey && !LiveSyncSetting.env.isDirty(this.selfKey) && this.invalidateValue) {
            this.invalidateValue();
        }
        if (this.holdValue && this.selfKey) {
            const isDirty = LiveSyncSetting.env.isDirty(this.selfKey);
            const alt = isDirty ? `Original: ${LiveSyncSetting.env.initialSettings![this.selfKey]}` : "";
            this.controlEl.toggleClass("sls-item-dirty", isDirty);
            if (!this.hasPassword) {
                this.nameEl.toggleClass("sls-item-dirty-help", isDirty);
                this.setTooltip(alt, { delay: 10, placement: "right" });
            }
        }
        this._applyOnUpdateHandlers();
    }
}
