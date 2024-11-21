import { App, PluginSettingTab, MarkdownRenderer, stringifyYaml } from "../../../deps.ts";
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
    FLAGMD_REDFLAG,
    type ConfigLevel,
    LEVEL_POWER_USER,
    LEVEL_ADVANCED,
    LEVEL_EDGE_CASE,
    type MetaEntry,
    type FilePath,
} from "../../../lib/src/common/types.ts";
import {
    createBlob,
    delay,
    isDocContentSame,
    isObjectDifferent,
    readAsBlob,
    sizeToHumanReadable,
} from "../../../lib/src/common/utils.ts";
import { versionNumberString2Number } from "../../../lib/src/string_and_binary/convert.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import {
    balanceChunkPurgedDBs,
    checkSyncInfo,
    isCloudantURI,
    purgeUnreferencedChunks,
} from "../../../lib/src/pouchdb/utils_couchdb.ts";
import { testCrypt } from "../../../lib/src/encryption/e2ee_v2.ts";
import ObsidianLiveSyncPlugin from "../../../main.ts";
import { getPath, requestToCouchDB, scheduleTask } from "../../../common/utils.ts";
import { request } from "obsidian";
import { addPrefix, shouldBeIgnored, stripAllPrefixes } from "../../../lib/src/string_and_binary/path.ts";
import MultipleRegExpControl from "./MultipleRegExpControl.svelte";
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
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "../../../lib/src/common/rosetta.ts";
import { $t } from "../../../lib/src/common/i18n.ts";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { fireAndForget, yieldNextAnimationFrame } from "octagonal-wheels/promises";
import { confirmWithMessage } from "../../coreObsidian/UILib/dialogs.ts";
import {
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_RELOAD_SETTING_TAB,
    eventHub,
} from "../../../common/events.ts";
import { skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { JournalSyncMinio } from "../../../lib/src/replication/journal/objectstore/JournalSyncMinio.ts";
import { ICHeader, ICXHeader, PSCHeader } from "../../../common/types.ts";
import { HiddenFileSync } from "../../../features/HiddenFileSync/CmdHiddenFileSync.ts";
import { EVENT_REQUEST_SHOW_HISTORY } from "../../../common/obsidianEvents.ts";

export type OnUpdateResult = {
    visibility?: boolean;
    disabled?: boolean;
    classes?: string[];
    isCta?: boolean;
    isWarning?: boolean;
};
type OnUpdateFunc = () => OnUpdateResult;
type UpdateFunction = () => void;

export type AutoWireOption = {
    placeHolder?: string;
    holdValue?: boolean;
    isPassword?: boolean;
    invert?: boolean;
    onUpdate?: OnUpdateFunc;
    obsolete?: boolean;
};

function visibleOnly(cond: () => boolean): OnUpdateFunc {
    return () => ({
        visibility: cond(),
    });
}
function enableOnly(cond: () => boolean): OnUpdateFunc {
    return () => ({
        disabled: !cond(),
    });
}

type OnSavedHandlerFunc<T extends AllSettingItemKey> = (value: AllSettings[T]) => Promise<void> | void;
type OnSavedHandler<T extends AllSettingItemKey> = {
    key: T;
    handler: OnSavedHandlerFunc<T>;
};

function getLevelStr(level: ConfigLevel) {
    return level == LEVEL_POWER_USER
        ? " (Power User)"
        : level == LEVEL_ADVANCED
          ? " (Advanced)"
          : level == LEVEL_EDGE_CASE
            ? " (Edge Case)"
            : "";
}

export function findAttrFromParent(el: HTMLElement, attr: string): string {
    let current: HTMLElement | null = el;
    while (current) {
        const value = current.getAttribute(attr);
        if (value) {
            return value;
        }
        current = current.parentElement;
    }
    return "";
}

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

export function wrapMemo<T>(func: (arg: T) => void) {
    let buf: T | undefined = undefined;
    return (arg: T) => {
        if (buf !== arg) {
            func(arg);
            buf = arg;
        }
    };
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
            this.plugin.$$setDeviceAndVaultName(this.editingSettings?.[key] ?? "");
            this.plugin.$$saveDeviceAndVaultName();
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
        ret.deviceAndVaultName = this.plugin.$$getDeviceAndVaultName();
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
        const replicator = await this.plugin.$anyNewReplicator(trialSetting);
        await replicator.tryConnectRemote(trialSetting);
        const status = await replicator.getRemoteStatus(trialSetting);
        if (status) {
            if (status.estimatedSize) {
                Logger(`Estimated size: ${sizeToHumanReadable(status.estimatedSize)}`, LOG_LEVEL_NOTICE);
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
                if (k === "deviceAndVaultName") continue;
                if (isObjectDifferent(newConf[k], this.initialSettings?.[k])) {
                    // Something has changed
                    if (this.isDirty(k as AllSettingItemKey)) {
                        // And modified.
                        this.plugin.confirm.askInPopup(
                            `config-reloaded-${k}`,
                            `The setting "${getConfName(k as AllSettingItemKey)}" being in editing has been changed from somewhere. We can discard modification and reload by clicking {HERE}. Click elsewhere to ignore changes`,
                            (anchor) => {
                                anchor.text = "HERE";
                                anchor.addEventListener("click", () => {
                                    this.refreshSetting(k as AllSettingItemKey);
                                    this.display();
                                });
                            }
                        );
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

        const setStyle = (el: HTMLElement, styleHead: string, condition: () => boolean) => {
            if (condition()) {
                el.addClass(`${styleHead}-enabled`);
                el.removeClass(`${styleHead}-disabled`);
            } else {
                el.addClass(`${styleHead}-disabled`);
                el.removeClass(`${styleHead}-enabled`);
            }
        };
        setStyle(containerEl, "menu-setting-poweruser", () => this.isConfiguredAs("usePowerUserMode", true));
        setStyle(containerEl, "menu-setting-advanced", () => this.isConfiguredAs("useAdvancedMode", true));
        setStyle(containerEl, "menu-setting-edgecase", () => this.isConfiguredAs("useEdgeCaseMode", true));

        const addScreenElement = (key: string, element: HTMLElement) => {
            if (!(key in this.screenElements)) {
                this.screenElements[key] = [];
            }
            this.screenElements[key].push(element);
        };
        const menuWrapper = this.createEl(containerEl, "div", { cls: "sls-setting-menu-wrapper" });

        if (this.menuEl) {
            this.menuEl.remove();
        }
        this.menuEl = menuWrapper.createDiv("");
        this.menuEl.addClass("sls-setting-menu");
        const menuTabs = this.menuEl.querySelectorAll(".sls-setting-label");
        const selectPane = (event: Event) => {
            const target = event.target as HTMLElement;
            if (target.tagName == "INPUT") {
                const value = target.getAttribute("value");
                if (value && this.selectedScreen != value) {
                    changeDisplay(value);
                }
            }
        };
        const isNeedRebuildLocal = () => {
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
        };
        const isNeedRebuildRemote = () => {
            return this.isSomeDirty([
                "doNotUseFixedRevisionForChunks",
                "handleFilenameCaseSensitive",
                "passphrase",
                "useDynamicIterationCount",
                "usePathObfuscation",
                "encrypt",
            ]);
        };
        const confirmRebuild = async () => {
            if (!(await isPassphraseValid())) {
                Logger(`Passphrase is not valid, please fix it.`, LOG_LEVEL_NOTICE);
                return;
            }
            const OPTION_FETCH = `Fetch from Remote`;
            const OPTION_REBUILD_BOTH = `Rebuild Both from This Device`;
            const OPTION_ONLY_SETTING = `(Danger) Save Only Settings`;
            const OPTION_CANCEL = `Cancel`;
            const title = `Rebuild Required`;
            const note = `Rebuilding Databases are required to apply the changes.. Please select the method to apply the changes.

<details>
<summary>Legends</summary>

| Symbol | Meaning |
|: ------ :| ------- |
| ⇔ | Synchronised or well balanced |
| ⇄ | Synchronise to balance |
| ⇐,⇒ | Transfer to overwrite |
| ⇠,⇢ | Transfer to overwrite from other side |

</details>

## ${OPTION_REBUILD_BOTH}
At a glance:  📄 ⇒¹ 💻 ⇒² 🛰️ ⇢ⁿ 💻 ⇄ⁿ⁺¹ 📄
Reconstruct both the local and remote databases using existing files from this device.
This causes a lockout other devices, and they need to perform fetching. 
## ${OPTION_FETCH}
At a glance: 📄 ⇄² 💻 ⇐¹ 🛰️ ⇔ 💻 ⇔ 📄
Initialise the local database and reconstruct it using data fetched from the remote database.
This case includes the case which you have rebuilt the remote database.
## ${OPTION_ONLY_SETTING}
Store only the settings. **Caution: This may lead to data corruption**; database reconstruction is generally necessary.`;
            const buttons = [
                OPTION_FETCH,
                OPTION_REBUILD_BOTH, // OPTION_REBUILD_REMOTE,
                OPTION_ONLY_SETTING,
                OPTION_CANCEL,
            ];
            const result = await confirmWithMessage(this.plugin, title, note, buttons, OPTION_CANCEL, 0);
            if (result == OPTION_CANCEL) return;
            if (result == OPTION_FETCH) {
                if (!(await checkWorkingPassphrase())) {
                    if (
                        (await this.plugin.confirm.askYesNoDialog("Are you sure to proceed?", {
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
                this.plugin.$$scheduleAppReload();
                this.closeSetting();
                // await rebuildDB("localOnly");
            } else if (result == OPTION_REBUILD_BOTH) {
                await this.plugin.storageAccess.writeFileAuto(FLAGMD_REDFLAG2_HR, "");
                this.plugin.$$scheduleAppReload();
                this.closeSetting();
            } else if (result == OPTION_ONLY_SETTING) {
                await this.plugin.saveSettings();
            }
        };
        this.createEl(
            menuWrapper,
            "div",
            { cls: "sls-setting-menu-buttons" },
            (el) => {
                el.addClass("wizardHidden");
                el.createEl("label", { text: "Changes need to be applied!" });
                void this.addEl(el, "button", { text: "Apply", cls: "mod-warning" }, (buttonEl) => {
                    buttonEl.addEventListener("click", () => fireAndForget(async () => await confirmRebuild()));
                });
            },
            visibleOnly(() => isNeedRebuildLocal() || isNeedRebuildRemote())
        );
        const setLevelClass = (el: HTMLElement, level?: ConfigLevel) => {
            switch (level) {
                case LEVEL_POWER_USER:
                    el.addClass("sls-setting-poweruser");
                    break;
                case LEVEL_ADVANCED:
                    el.addClass("sls-setting-advanced");
                    break;
                case LEVEL_EDGE_CASE:
                    el.addClass("sls-setting-edgecase");
                    break;
                default:
                // NO OP.
            }
        };
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
                        inputEl.addEventListener("change", selectPane);
                        inputEl.addEventListener("click", selectPane);
                    }
                );
            }
            addScreenElement(`${order}`, el);
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

        //@ts-ignore
        const manifestVersion: string = MANIFEST_VERSION || "-";
        //@ts-ignore
        const updateInformation: string = UPDATE_INFO || "";

        const lastVersion = ~~(versionNumberString2Number(manifestVersion) / 1000);

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
        const enableOnlySyncDisabled = enableOnly(() => !isAnySyncEnabled());
        const onlyOnCouchDB = () =>
            ({
                visibility: this.isConfiguredAs("remoteType", REMOTE_COUCHDB),
            }) as OnUpdateResult;
        const onlyOnMinIO = () =>
            ({
                visibility: this.isConfiguredAs("remoteType", REMOTE_MINIO),
            }) as OnUpdateResult;

        // E2EE Function
        const checkWorkingPassphrase = async (): Promise<boolean> => {
            if (this.editingSettings.remoteType == REMOTE_MINIO) return true;

            const settingForCheck: RemoteDBSettings = {
                ...this.editingSettings,
            };
            const replicator = this.plugin.$anyNewReplicator(settingForCheck);
            if (!(replicator instanceof LiveSyncCouchDBReplicator)) return true;

            const db = await replicator.connectRemoteCouchDBWithSetting(
                settingForCheck,
                this.plugin.$$isMobile(),
                true
            );
            if (typeof db === "string") {
                Logger(`ERROR: Failed to check passphrase with the remote server: \n${db}.`, LOG_LEVEL_NOTICE);
                return false;
            } else {
                if (await checkSyncInfo(db.db)) {
                    // Logger("Database connected", LOG_LEVEL_NOTICE);
                    return true;
                } else {
                    Logger(
                        "ERROR: Passphrase is not compatible with the remote server! Please confirm it again!",
                        LOG_LEVEL_NOTICE
                    );
                    return false;
                }
            }
        };
        const isPassphraseValid = async () => {
            if (this.editingSettings.encrypt && this.editingSettings.passphrase == "") {
                Logger("If you enable encryption, you have to set the passphrase", LOG_LEVEL_NOTICE);
                return false;
            }
            if (this.editingSettings.encrypt && !(await testCrypt())) {
                Logger("Your device does not support encryption.", LOG_LEVEL_NOTICE);
                return false;
            }
            return true;
        };

        const rebuildDB = async (
            method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice" | "localOnlyWithChunks"
        ) => {
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
            await this.plugin.$allSuspendAllSync();
            await this.plugin.$allSuspendExtraSync();
            this.reloadAllSettings();
            this.editingSettings.isConfigured = true;
            Logger(
                "All synchronizations have been temporarily disabled. Please enable them after the fetching, if you need them.",
                LOG_LEVEL_NOTICE
            );
            await this.saveAllDirtySettings();
            this.closeSetting();
            await delay(2000);
            await this.plugin.rebuilder.$performRebuildDB(method);
        };
        // Panes

        void addPane(containerEl, "Update Information", "💬", 100, false).then((paneEl) => {
            const informationDivEl = this.createEl(paneEl, "div", { text: "" });

            const tmpDiv = createDiv();
            // tmpDiv.addClass("sls-header-button");
            tmpDiv.addClass("op-warn-info");

            tmpDiv.innerHTML = `<p>Did you come here because of an upgrade notification? Read the version history and, if you are satisfied, press the button. I will bring it out again in the next version.</p><button> OK, I read everything. </button>`;
            if (lastVersion > (this.editingSettings?.lastReadUpdates || 0)) {
                const informationButtonDiv = informationDivEl.appendChild(tmpDiv);
                informationButtonDiv.querySelector("button")?.addEventListener("click", () => {
                    fireAndForget(async () => {
                        this.editingSettings.lastReadUpdates = lastVersion;
                        await this.saveAllDirtySettings();
                        informationButtonDiv.remove();
                    });
                });
            }
            fireAndForget(() =>
                MarkdownRenderer.render(this.plugin.app, updateInformation, informationDivEl, "/", this.plugin)
            );
        });

        void addPane(containerEl, "Setup", "🧙‍♂️", 110, false).then((paneEl) => {
            void addPanel(paneEl, "Quick Setup").then((paneEl) => {
                new Setting(paneEl)
                    .setName("Use the copied setup URI")
                    .setDesc("To setup Self-hosted LiveSync, this method is the most preferred one.")
                    .addButton((text) => {
                        text.setButtonText("Use").onClick(() => {
                            this.closeSetting();
                            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
                        });
                    });

                new Setting(paneEl).setName("Minimal setup").addButton((text) => {
                    text.setButtonText("Start").onClick(async () => {
                        await this.enableMinimalSetup();
                    });
                });
                new Setting(paneEl)
                    .setName("Enable LiveSync on this device as the setup was completed manually")
                    .addOnUpdate(visibleOnly(() => !this.isConfiguredAs("isConfigured", true)))
                    .addButton((text) => {
                        text.setButtonText("Enable").onClick(async () => {
                            this.editingSettings.isConfigured = true;
                            await this.saveAllDirtySettings();
                            this.plugin.$$askReload();
                        });
                    });
            });

            void addPanel(
                paneEl,
                "To setup the other devices",
                undefined,
                visibleOnly(() => this.isConfiguredAs("isConfigured", true))
            ).then((paneEl) => {
                new Setting(paneEl).setName("Copy current settings as a new setup URI").addButton((text) => {
                    text.setButtonText("Copy").onClick(() => {
                        // await this.plugin.addOnSetup.command_copySetupURI();
                        eventHub.emitEvent(EVENT_REQUEST_COPY_SETUP_URI);
                    });
                });
            });
            void addPanel(paneEl, "Reset").then((paneEl) => {
                new Setting(paneEl)
                    .setName("Discard existing settings and databases")
                    .addButton((text) => {
                        text.setButtonText("Discard")
                            .onClick(async () => {
                                if (
                                    (await this.plugin.confirm.askYesNoDialog(
                                        "Do you really want to discard existing settings and databases?",
                                        { defaultOption: "No" }
                                    )) == "yes"
                                ) {
                                    this.editingSettings = { ...this.editingSettings, ...DEFAULT_SETTINGS };
                                    await this.saveAllDirtySettings();
                                    this.plugin.settings = { ...DEFAULT_SETTINGS };
                                    await this.plugin.$$saveSettingData();
                                    await this.plugin.$$resetLocalDatabase();
                                    // await this.plugin.initializeDatabase();
                                    this.plugin.$$askReload();
                                }
                            })
                            .setWarning();
                    })
                    .addOnUpdate(visibleOnly(() => this.isConfiguredAs("isConfigured", true)));
                // }
            });
            void addPanel(paneEl, "Enable extra and advanced features").then((paneEl) => {
                new Setting(paneEl).autoWireToggle("useAdvancedMode");

                new Setting(paneEl).autoWireToggle("usePowerUserMode");
                new Setting(paneEl).autoWireToggle("useEdgeCaseMode");

                this.addOnSaved("useAdvancedMode", () => this.display());
                this.addOnSaved("usePowerUserMode", () => this.display());
                this.addOnSaved("useEdgeCaseMode", () => this.display());
            });
            void addPanel(paneEl, "Online Tips").then((paneEl) => {
                // this.createEl(paneEl, "h3", { text: "Online Tips" });
                const repo = "vrtmrz/obsidian-livesync";
                const topPath = "/docs/troubleshooting.md";
                const rawRepoURI = `https://raw.githubusercontent.com/${repo}/main`;
                this.createEl(
                    paneEl,
                    "div",
                    "",
                    (el) =>
                        (el.innerHTML = `<a href='https://github.com/${repo}/blob/main${topPath}' target="_blank">Open in browser</a>`)
                );
                const troubleShootEl = this.createEl(paneEl, "div", {
                    text: "",
                    cls: "sls-troubleshoot-preview",
                });
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
                    const remoteTroubleShootMD = remoteTroubleShootMDSrc.replace(
                        /\((.*?(.png)|(.jpg))\)/g,
                        `(${rawRepoURI}${basePath}/$1)`
                    );
                    // Render markdown
                    await MarkdownRenderer.render(
                        this.plugin.app,
                        `<a class='sls-troubleshoot-anchor'></a> [Tips and Troubleshooting](${topPath}) [PageTop](${filename})\n\n${remoteTroubleShootMD}`,
                        troubleShootEl,
                        `${rawRepoURI}`,
                        this.plugin
                    );
                    // Menu
                    troubleShootEl
                        .querySelector<HTMLAnchorElement>(".sls-troubleshoot-anchor")
                        ?.parentElement?.setCssStyles({
                            position: "sticky",
                            top: "-1em",
                            backgroundColor: "var(--modal-background)",
                        });
                    // Trap internal links.
                    troubleShootEl.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((anchorEl) => {
                        anchorEl.addEventListener("click", (evt) => {
                            fireAndForget(async () => {
                                const uri = anchorEl.getAttr("data-href");
                                if (!uri) return;
                                if (uri.startsWith("#")) {
                                    evt.preventDefault();
                                    const elements = Array.from(
                                        troubleShootEl.querySelectorAll<HTMLHeadingElement>("[data-heading]")
                                    );
                                    const p = elements.find(
                                        (e) =>
                                            e.getAttr("data-heading")?.toLowerCase().split(" ").join("-") ==
                                            uri.substring(1).toLowerCase()
                                    );
                                    if (p) {
                                        p.setCssStyles({ scrollMargin: "3em" });
                                        p.scrollIntoView({
                                            behavior: "instant",
                                            block: "start",
                                        });
                                    }
                                } else {
                                    evt.preventDefault();
                                    await loadMarkdownPage(uri, basePath);
                                    troubleShootEl.setCssStyles({ scrollMargin: "1em" });
                                    troubleShootEl.scrollIntoView({
                                        behavior: "instant",
                                        block: "start",
                                    });
                                }
                            });
                        });
                    });
                    troubleShootEl.style.minHeight = "";
                };
                void loadMarkdownPage(topPath);
            });
        });
        void addPane(containerEl, "General Settings", "⚙️", 20, false).then((paneEl) => {
            void addPanel(paneEl, "Appearance").then((paneEl) => {
                const languages = Object.fromEntries([
                    ["", "Default"],
                    ...SUPPORTED_I18N_LANGS.map((e) => [e, $t(`lang-${e}`)]),
                ]) as Record<I18N_LANGS, string>;
                new Setting(paneEl).autoWireDropDown("displayLanguage", {
                    options: languages,
                });
                this.addOnSaved("displayLanguage", () => this.display());
                new Setting(paneEl).autoWireToggle("showStatusOnEditor");
                new Setting(paneEl).autoWireToggle("showOnlyIconsOnEditor", {
                    onUpdate: visibleOnly(() => this.isConfiguredAs("showStatusOnEditor", true)),
                });
                new Setting(paneEl).autoWireToggle("showStatusOnStatusbar");
            });
            void addPanel(paneEl, "Logging").then((paneEl) => {
                paneEl.addClass("wizardHidden");

                new Setting(paneEl).autoWireToggle("lessInformationInLog");

                new Setting(paneEl).autoWireToggle("showVerboseLog", {
                    onUpdate: visibleOnly(() => this.isConfiguredAs("lessInformationInLog", false)),
                });
            });
            new Setting(paneEl).setClass("wizardOnly").addButton((button) =>
                button
                    .setButtonText("Next")
                    .setCta()
                    .onClick(() => {
                        this.changeDisplay("0");
                    })
            );
        });
        let checkResultDiv: HTMLDivElement;
        const checkConfig = async (checkResultDiv: HTMLDivElement | undefined) => {
            Logger(`Checking database configuration`, LOG_LEVEL_INFO);
            let isSuccessful = true;
            const emptyDiv = createDiv();
            emptyDiv.innerHTML = "<span></span>";
            checkResultDiv?.replaceChildren(...[emptyDiv]);
            const addResult = (msg: string, classes?: string[]) => {
                const tmpDiv = createDiv();
                tmpDiv.addClass("ob-btn-config-fix");
                if (classes) {
                    tmpDiv.addClasses(classes);
                }
                tmpDiv.innerHTML = `${msg}`;
                checkResultDiv?.appendChild(tmpDiv);
            };
            try {
                if (isCloudantURI(this.editingSettings.couchDB_URI)) {
                    Logger("This feature cannot be used with IBM Cloudant.", LOG_LEVEL_NOTICE);
                    return;
                }
                const r = await requestToCouchDB(
                    this.editingSettings.couchDB_URI,
                    this.editingSettings.couchDB_USER,
                    this.editingSettings.couchDB_PASSWORD,
                    window.origin
                );
                const responseConfig = r.json;

                const addConfigFixButton = (title: string, key: string, value: string) => {
                    if (!checkResultDiv) return;
                    const tmpDiv = createDiv();
                    tmpDiv.addClass("ob-btn-config-fix");
                    tmpDiv.innerHTML = `<label>${title}</label><button>Fix</button>`;
                    const x = checkResultDiv.appendChild(tmpDiv);
                    x.querySelector("button")?.addEventListener("click", () => {
                        fireAndForget(async () => {
                            Logger(`CouchDB Configuration: ${title} -> Set ${key} to ${value}`);
                            const res = await requestToCouchDB(
                                this.editingSettings.couchDB_URI,
                                this.editingSettings.couchDB_USER,
                                this.editingSettings.couchDB_PASSWORD,
                                undefined,
                                key,
                                value
                            );
                            if (res.status == 200) {
                                Logger(`CouchDB Configuration: ${title} successfully updated`, LOG_LEVEL_NOTICE);
                                checkResultDiv.removeChild(x);
                                await checkConfig(checkResultDiv);
                            } else {
                                Logger(`CouchDB Configuration: ${title} failed`, LOG_LEVEL_NOTICE);
                                Logger(res.text, LOG_LEVEL_VERBOSE);
                            }
                        });
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
                    isSuccessful = false;
                    addResult("❗ chttpd.require_valid_user is wrong.");
                    addConfigFixButton("Set chttpd.require_valid_user = true", "chttpd/require_valid_user", "true");
                } else {
                    addResult("✔ chttpd.require_valid_user is ok.");
                }
                if (responseConfig?.chttpd_auth?.require_valid_user != "true") {
                    isSuccessful = false;
                    addResult("❗ chttpd_auth.require_valid_user is wrong.");
                    addConfigFixButton(
                        "Set chttpd_auth.require_valid_user = true",
                        "chttpd_auth/require_valid_user",
                        "true"
                    );
                } else {
                    addResult("✔ chttpd_auth.require_valid_user is ok.");
                }
                // HTTPD check
                //  Check Authentication header
                if (!responseConfig?.httpd["WWW-Authenticate"]) {
                    isSuccessful = false;
                    addResult("❗ httpd.WWW-Authenticate is missing");
                    addConfigFixButton("Set httpd.WWW-Authenticate", "httpd/WWW-Authenticate", 'Basic realm="couchdb"');
                } else {
                    addResult("✔ httpd.WWW-Authenticate is ok.");
                }
                if (responseConfig?.httpd?.enable_cors != "true") {
                    isSuccessful = false;
                    addResult("❗ httpd.enable_cors is wrong");
                    addConfigFixButton("Set httpd.enable_cors", "httpd/enable_cors", "true");
                } else {
                    addResult("✔ httpd.enable_cors is ok.");
                }
                // If the server is not cloudant, configure request size
                if (!isCloudantURI(this.editingSettings.couchDB_URI)) {
                    // REQUEST SIZE
                    if (Number(responseConfig?.chttpd?.max_http_request_size ?? 0) < 4294967296) {
                        isSuccessful = false;
                        addResult("❗ chttpd.max_http_request_size is low)");
                        addConfigFixButton(
                            "Set chttpd.max_http_request_size",
                            "chttpd/max_http_request_size",
                            "4294967296"
                        );
                    } else {
                        addResult("✔ chttpd.max_http_request_size is ok.");
                    }
                    if (Number(responseConfig?.couchdb?.max_document_size ?? 0) < 50000000) {
                        isSuccessful = false;
                        addResult("❗ couchdb.max_document_size is low)");
                        addConfigFixButton("Set couchdb.max_document_size", "couchdb/max_document_size", "50000000");
                    } else {
                        addResult("✔ couchdb.max_document_size is ok.");
                    }
                }
                // CORS check
                //  checking connectivity for mobile
                if (responseConfig?.cors?.credentials != "true") {
                    isSuccessful = false;
                    addResult("❗ cors.credentials is wrong");
                    addConfigFixButton("Set cors.credentials", "cors/credentials", "true");
                } else {
                    addResult("✔ cors.credentials is ok.");
                }
                const ConfiguredOrigins = ((responseConfig?.cors?.origins ?? "") + "").split(",");
                if (
                    responseConfig?.cors?.origins == "*" ||
                    (ConfiguredOrigins.indexOf("app://obsidian.md") !== -1 &&
                        ConfiguredOrigins.indexOf("capacitor://localhost") !== -1 &&
                        ConfiguredOrigins.indexOf("http://localhost") !== -1)
                ) {
                    addResult("✔ cors.origins is ok.");
                } else {
                    addResult("❗ cors.origins is wrong");
                    addConfigFixButton(
                        "Set cors.origins",
                        "cors/origins",
                        "app://obsidian.md,capacitor://localhost,http://localhost"
                    );
                    isSuccessful = false;
                }
                addResult("--Connection check--", ["ob-btn-config-head"]);
                addResult(`Current origin:${window.location.origin}`);

                // Request header check
                const origins = ["app://obsidian.md", "capacitor://localhost", "http://localhost"];
                for (const org of origins) {
                    const rr = await requestToCouchDB(
                        this.editingSettings.couchDB_URI,
                        this.editingSettings.couchDB_USER,
                        this.editingSettings.couchDB_PASSWORD,
                        org
                    );
                    const responseHeaders = Object.fromEntries(
                        Object.entries(rr.headers).map((e) => {
                            e[0] = `${e[0]}`.toLowerCase();
                            return e;
                        })
                    );
                    addResult(`Origin check:${org}`);
                    if (responseHeaders["access-control-allow-credentials"] != "true") {
                        addResult("❗ CORS is not allowing credentials");
                        isSuccessful = false;
                    } else {
                        addResult("✔ CORS credentials OK");
                    }
                    if (responseHeaders["access-control-allow-origin"] != org) {
                        addResult(
                            `⚠ CORS Origin is unmatched:${origin}->${responseHeaders["access-control-allow-origin"]}`
                        );
                    } else {
                        addResult("✔ CORS origin OK");
                    }
                }
                addResult("--Done--", ["ob-btn-config-head"]);
                addResult(
                    "If you have some trouble with Connection-check even though all Config-check has been passed, please check your reverse proxy's configuration.",
                    ["ob-btn-config-info"]
                );
                Logger(`Checking configuration done`, LOG_LEVEL_INFO);
            } catch (ex: any) {
                if (ex?.status == 401) {
                    isSuccessful = false;
                    addResult(`❗ Access forbidden.`);
                    addResult(`We could not continue the test.`);
                    Logger(`Checking configuration done`, LOG_LEVEL_INFO);
                } else {
                    Logger(`Checking configuration failed`, LOG_LEVEL_NOTICE);
                    Logger(ex);
                    isSuccessful = false;
                }
            }
            return isSuccessful;
        };

        void addPane(containerEl, "Remote Configuration", "🛰️", 0, false).then((paneEl) => {
            void addPanel(paneEl, "Remote Server").then((paneEl) => {
                // const containerRemoteDatabaseEl = containerEl.createDiv();
                new Setting(paneEl).autoWireDropDown("remoteType", {
                    holdValue: true,
                    options: {
                        [REMOTE_COUCHDB]: "CouchDB",
                        [REMOTE_MINIO]: "Minio,S3,R2",
                    },
                    onUpdate: enableOnlySyncDisabled,
                });

                void addPanel(paneEl, "Minio,S3,R2", undefined, onlyOnMinIO).then((paneEl) => {
                    const syncWarnMinio = this.createEl(paneEl, "div", {
                        text: "",
                    });
                    const ObjectStorageMessage = `Kindly notice: this is a pretty experimental feature, hence we have some limitations. 
- Append only architecture. It will not shrink used storage if we do not perform a rebuild.
- A bit fragile.
- During the first synchronization, the entire history to date will be transferred. For this reason, it is preferable to do this while connected to a Wi-Fi network.
- From the second, we always transfer only differences.

However, your report is needed to stabilise this. I appreciate you for your great dedication.
`;

                    void MarkdownRenderer.render(
                        this.plugin.app,
                        ObjectStorageMessage,
                        syncWarnMinio,
                        "/",
                        this.plugin
                    );
                    syncWarnMinio.addClass("op-warn-info");

                    new Setting(paneEl).autoWireText("endpoint", { holdValue: true });
                    new Setting(paneEl).autoWireText("accessKey", { holdValue: true });

                    new Setting(paneEl).autoWireText("secretKey", {
                        holdValue: true,
                        isPassword: true,
                    });

                    new Setting(paneEl).autoWireText("region", { holdValue: true });

                    new Setting(paneEl).autoWireText("bucket", { holdValue: true });

                    new Setting(paneEl).autoWireToggle("useCustomRequestHandler", { holdValue: true });
                    new Setting(paneEl).setName("Test Connection").addButton((button) =>
                        button
                            .setButtonText("Test")
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.testConnection(this.editingSettings);
                            })
                    );
                    new Setting(paneEl)
                        .setName("Apply Settings")
                        .setClass("wizardHidden")
                        .addApplyButton([
                            "remoteType",
                            "endpoint",
                            "region",
                            "accessKey",
                            "secretKey",
                            "bucket",
                            "useCustomRequestHandler",
                        ])
                        .addOnUpdate(onlyOnMinIO);
                });

                void addPanel(paneEl, "CouchDB", undefined, onlyOnCouchDB).then((paneEl) => {
                    if (this.plugin.$$isMobile()) {
                        this.createEl(
                            paneEl,
                            "div",
                            {
                                text: `Configured as using non-HTTPS. We cannot connect to the remote. Please set up the credentials and use HTTPS for the remote URI.`,
                            },
                            undefined,
                            visibleOnly(() => !this.editingSettings.couchDB_URI.startsWith("https://"))
                        ).addClass("op-warn");
                    } else {
                        this.createEl(
                            paneEl,
                            "div",
                            {
                                text: `Configured as using non-HTTPS. We might fail on mobile devices.`,
                            },
                            undefined,
                            visibleOnly(() => !this.editingSettings.couchDB_URI.startsWith("https://"))
                        ).addClass("op-warn-info");
                    }

                    this.createEl(
                        paneEl,
                        "div",
                        {
                            text: `These settings are kept locked while any synchronization options are enabled. Disable these options in the "Sync Settings" tab to unlock.`,
                        },
                        undefined,
                        visibleOnly(() => isAnySyncEnabled())
                    ).addClass("sls-setting-hidden");

                    new Setting(paneEl).autoWireText("couchDB_URI", {
                        holdValue: true,
                        onUpdate: enableOnlySyncDisabled,
                    });
                    new Setting(paneEl).autoWireText("couchDB_USER", {
                        holdValue: true,
                        onUpdate: enableOnlySyncDisabled,
                    });
                    new Setting(paneEl).autoWireText("couchDB_PASSWORD", {
                        holdValue: true,
                        isPassword: true,
                        onUpdate: enableOnlySyncDisabled,
                    });
                    new Setting(paneEl).autoWireText("couchDB_DBNAME", {
                        holdValue: true,
                        onUpdate: enableOnlySyncDisabled,
                    });

                    new Setting(paneEl)
                        .setName("Test Database Connection")
                        .setClass("wizardHidden")
                        .setDesc(
                            "Open database connection. If the remote database is not found and you have the privilege to create a database, the database will be created."
                        )
                        .addButton((button) =>
                            button
                                .setButtonText("Test")
                                .setDisabled(false)
                                .onClick(async () => {
                                    await this.testConnection();
                                })
                        );

                    new Setting(paneEl)
                        .setName("Check and fix database configuration")
                        .setDesc("Check the database configuration, and fix if there are any problems.")
                        .addButton((button) =>
                            button
                                .setButtonText("Check")
                                .setDisabled(false)
                                .onClick(async () => {
                                    await checkConfig(checkResultDiv);
                                })
                        );
                    checkResultDiv = this.createEl(paneEl, "div", {
                        text: "",
                    });

                    new Setting(paneEl)
                        .setName("Apply Settings")
                        .setClass("wizardHidden")
                        .addApplyButton([
                            "remoteType",
                            "couchDB_URI",
                            "couchDB_USER",
                            "couchDB_PASSWORD",
                            "couchDB_DBNAME",
                        ])
                        .addOnUpdate(onlyOnCouchDB);
                });
            });
            void addPanel(paneEl, "Notification").then((paneEl) => {
                paneEl.addClass("wizardHidden");
                new Setting(paneEl).autoWireNumeric("notifyThresholdOfRemoteStorageSize", {}).setClass("wizardHidden");
            });

            void addPanel(paneEl, "Confidentiality").then((paneEl) => {
                new Setting(paneEl).autoWireToggle("encrypt", { holdValue: true });

                const isEncryptEnabled = visibleOnly(() => this.isConfiguredAs("encrypt", true));

                new Setting(paneEl).autoWireText("passphrase", {
                    holdValue: true,
                    isPassword: true,
                    onUpdate: isEncryptEnabled,
                });

                new Setting(paneEl).autoWireToggle("usePathObfuscation", {
                    holdValue: true,
                    onUpdate: isEncryptEnabled,
                });
                new Setting(paneEl)
                    .autoWireToggle("useDynamicIterationCount", {
                        holdValue: true,
                        onUpdate: isEncryptEnabled,
                    })
                    .setClass("wizardHidden");
            });

            void addPanel(paneEl, "Fetch settings").then((paneEl) => {
                new Setting(paneEl)
                    .setName("Fetch tweaks from the remote")
                    .setDesc("Fetch other necessary settings from already configured remote.")
                    .addButton((button) =>
                        button
                            .setButtonText("Fetch")
                            .setDisabled(false)
                            .onClick(async () => {
                                const trialSetting = { ...this.initialSettings, ...this.editingSettings };
                                const newTweaks = await this.plugin.$$checkAndAskUseRemoteConfiguration(trialSetting);
                                if (newTweaks.result !== false) {
                                    this.editingSettings = { ...this.editingSettings, ...newTweaks.result };
                                    this.requestUpdate();
                                }
                            })
                    );
            });
            new Setting(paneEl).setClass("wizardOnly").addButton((button) =>
                button
                    .setButtonText("Next")
                    .setCta()
                    .setDisabled(false)
                    .onClick(async () => {
                        if (!(await checkConfig(checkResultDiv))) {
                            if (
                                (await this.plugin.confirm.askYesNoDialog(
                                    "The configuration check has failed. Do you want to continue anyway?",
                                    { defaultOption: "No", title: "Remote Configuration Check Failed" }
                                )) == "no"
                            ) {
                                return;
                            }
                        }
                        const isEncryptionFullyEnabled =
                            !this.editingSettings.encrypt || !this.editingSettings.usePathObfuscation;
                        if (isEncryptionFullyEnabled) {
                            if (
                                (await this.plugin.confirm.askYesNoDialog(
                                    "Enabling End-to-End Encryption and Path Obfuscation is strongly recommended. Do you surely want to continue without encryption?",
                                    { defaultOption: "No", title: "Encryption is not enabled" }
                                )) == "no"
                            ) {
                                return;
                            }
                        }
                        if (!this.editingSettings.encrypt) {
                            this.editingSettings.passphrase = "";
                        }
                        if (!(await isPassphraseValid())) {
                            if (
                                (await this.plugin.confirm.askYesNoDialog(
                                    "End-to-End encryption seems to have trouble. Do you surely want to continue with the current settings?",
                                    { defaultOption: "No", title: "Encryption has some trouble" }
                                )) == "no"
                            ) {
                                return;
                            }
                        }
                        if (isCloudantURI(this.editingSettings.couchDB_URI)) {
                            this.editingSettings = { ...this.editingSettings, ...PREFERRED_SETTING_CLOUDANT };
                        } else if (this.editingSettings.remoteType == REMOTE_MINIO) {
                            this.editingSettings = { ...this.editingSettings, ...PREFERRED_JOURNAL_SYNC };
                        } else {
                            this.editingSettings = { ...this.editingSettings, ...PREFERRED_SETTING_SELF_HOSTED };
                        }
                        if (
                            (await this.plugin.confirm.askYesNoDialog(
                                "Do you want to fetch the tweaks from the remote?",
                                { defaultOption: "Yes", title: "Fetch tweaks" }
                            )) == "yes"
                        ) {
                            const trialSetting = { ...this.initialSettings, ...this.editingSettings };
                            const newTweaks = await this.plugin.$$checkAndAskUseRemoteConfiguration(trialSetting);
                            if (newTweaks.result !== false) {
                                this.editingSettings = { ...this.editingSettings, ...newTweaks.result };
                                this.requestUpdate();
                            } else {
                                // Messages should be already shown.
                            }
                        }
                        changeDisplay("30");
                    })
            );
        });
        void addPane(containerEl, "Sync Settings", "🔄", 30, false).then((paneEl) => {
            if (this.editingSettings.versionUpFlash != "") {
                const c = this.createEl(
                    paneEl,
                    "div",
                    {
                        text: this.editingSettings.versionUpFlash,
                        cls: "op-warn sls-setting-hidden",
                    },
                    (el) => {
                        this.createEl(el, "button", { text: "I got it and updated." }, (e) => {
                            e.addClass("mod-cta");
                            e.addEventListener("click", () => {
                                fireAndForget(async () => {
                                    this.editingSettings.versionUpFlash = "";
                                    await this.saveAllDirtySettings();
                                    c.remove();
                                });
                            });
                        });
                    },
                    visibleOnly(() => !this.isConfiguredAs("versionUpFlash", ""))
                );
            }

            this.createEl(paneEl, "div", {
                text: `Please select and apply any preset item to complete the wizard.`,
                cls: "wizardOnly",
            }).addClasses(["op-warn-info"]);

            void addPanel(paneEl, "Synchronization Preset").then((paneEl) => {
                const options: Record<string, string> =
                    this.editingSettings.remoteType == REMOTE_COUCHDB
                        ? {
                              NONE: "",
                              LIVESYNC: "LiveSync",
                              PERIODIC: "Periodic w/ batch",
                              DISABLE: "Disable all automatic",
                          }
                        : {
                              NONE: "",
                              PERIODIC: "Periodic w/ batch",
                              DISABLE: "Disable all automatic",
                          };

                new Setting(paneEl)
                    .autoWireDropDown("preset", {
                        options: options,
                        holdValue: true,
                    })
                    .addButton((button) => {
                        button.setButtonText("Apply");
                        button.onClick(async () => {
                            // await this.saveSettings(["preset"]);
                            await this.saveAllDirtySettings();
                        });
                    });

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
                        liveSync: true,
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
                            ...presetLiveSync,
                        };
                        Logger("Synchronization setting configured as LiveSync.", LOG_LEVEL_NOTICE);
                    } else if (currentPreset == "PERIODIC") {
                        this.editingSettings = {
                            ...this.editingSettings,
                            ...presetPeriodic,
                        };
                        Logger(
                            "Synchronization setting configured as Periodic sync with batch database update.",
                            LOG_LEVEL_NOTICE
                        );
                    } else {
                        Logger("All synchronizations disabled.", LOG_LEVEL_NOTICE);
                        this.editingSettings = {
                            ...this.editingSettings,
                            ...presetAllDisabled,
                        };
                    }

                    if (this.inWizard) {
                        this.closeSetting();
                        this.inWizard = false;
                        if (!this.editingSettings.isConfigured) {
                            this.editingSettings.isConfigured = true;
                            await this.saveAllDirtySettings();
                            await this.plugin.$$realizeSettingSyncMode();
                            await rebuildDB("localOnly");
                            // this.resetEditingSettings();
                            if (
                                (await this.plugin.confirm.askYesNoDialog(
                                    "All done!, do you want to generate a setup URI to set up other devices?",
                                    { defaultOption: "Yes", title: "Congratulations!" }
                                )) == "yes"
                            ) {
                                eventHub.emitEvent(EVENT_REQUEST_COPY_SETUP_URI);
                            }
                        } else {
                            if (isNeedRebuildLocal() || isNeedRebuildRemote()) {
                                await confirmRebuild();
                            } else {
                                await this.saveAllDirtySettings();
                                await this.plugin.$$realizeSettingSyncMode();
                                this.plugin.$$askReload();
                            }
                        }
                    } else {
                        await this.saveAllDirtySettings();
                        await this.plugin.$$realizeSettingSyncMode();
                    }
                });
            });
            void addPanel(paneEl, "Synchronization Methods").then((paneEl) => {
                paneEl.addClass("wizardHidden");

                // const onlyOnLiveSync = visibleOnly(() => this.isConfiguredAs("syncMode", "LIVESYNC"));
                const onlyOnNonLiveSync = visibleOnly(() => !this.isConfiguredAs("syncMode", "LIVESYNC"));
                const onlyOnPeriodic = visibleOnly(() => this.isConfiguredAs("syncMode", "PERIODIC"));

                const optionsSyncMode =
                    this.editingSettings.remoteType == REMOTE_COUCHDB
                        ? {
                              ONEVENTS: "On events",
                              PERIODIC: "Periodic and On events",
                              LIVESYNC: "LiveSync",
                          }
                        : { ONEVENTS: "On events", PERIODIC: "Periodic and On events" };

                new Setting(paneEl)
                    .autoWireDropDown("syncMode", {
                        //@ts-ignore
                        options: optionsSyncMode,
                    })
                    .setClass("wizardHidden");
                this.addOnSaved("syncMode", async (value) => {
                    this.editingSettings.liveSync = false;
                    this.editingSettings.periodicReplication = false;
                    if (value == "LIVESYNC") {
                        this.editingSettings.liveSync = true;
                    } else if (value == "PERIODIC") {
                        this.editingSettings.periodicReplication = true;
                    }
                    await this.saveSettings(["liveSync", "periodicReplication"]);

                    await this.plugin.$$realizeSettingSyncMode();
                });

                new Setting(paneEl)
                    .autoWireNumeric("periodicReplicationInterval", {
                        clampMax: 5000,
                        onUpdate: onlyOnPeriodic,
                    })
                    .setClass("wizardHidden");

                new Setting(paneEl)
                    .setClass("wizardHidden")
                    .autoWireToggle("syncOnSave", { onUpdate: onlyOnNonLiveSync });
                new Setting(paneEl)
                    .setClass("wizardHidden")
                    .autoWireToggle("syncOnEditorSave", { onUpdate: onlyOnNonLiveSync });
                new Setting(paneEl)
                    .setClass("wizardHidden")
                    .autoWireToggle("syncOnFileOpen", { onUpdate: onlyOnNonLiveSync });
                new Setting(paneEl)
                    .setClass("wizardHidden")
                    .autoWireToggle("syncOnStart", { onUpdate: onlyOnNonLiveSync });
                new Setting(paneEl)
                    .setClass("wizardHidden")
                    .autoWireToggle("syncAfterMerge", { onUpdate: onlyOnNonLiveSync });
            });

            void addPanel(paneEl, "Update thinning").then((paneEl) => {
                paneEl.addClass("wizardHidden");
                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("batchSave");
                new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("batchSaveMinimumDelay", {
                    acceptZero: true,
                    onUpdate: visibleOnly(() => this.isConfiguredAs("batchSave", true)),
                });
                new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("batchSaveMaximumDelay", {
                    acceptZero: true,
                    onUpdate: visibleOnly(() => this.isConfiguredAs("batchSave", true)),
                });
            });

            void addPanel(paneEl, "Deletion Propagation", undefined, undefined, LEVEL_ADVANCED).then((paneEl) => {
                paneEl.addClass("wizardHidden");
                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("trashInsteadDelete");

                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("doNotDeleteFolder");
            });
            void addPanel(paneEl, "Conflict resolution", undefined, undefined, LEVEL_ADVANCED).then((paneEl) => {
                paneEl.addClass("wizardHidden");

                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("resolveConflictsByNewerFile");

                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("checkConflictOnlyOnOpen");

                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("showMergeDialogOnlyOnActive");
            });

            void addPanel(paneEl, "Sync settings via markdown", undefined, undefined, LEVEL_ADVANCED).then((paneEl) => {
                paneEl.addClass("wizardHidden");

                new Setting(paneEl)
                    .autoWireText("settingSyncFile", { holdValue: true })
                    .addApplyButton(["settingSyncFile"]);

                new Setting(paneEl).autoWireToggle("writeCredentialsForSettingSync");

                new Setting(paneEl).autoWireToggle("notifyAllSettingSyncFile");
            });

            void addPanel(paneEl, "Hidden files", undefined, undefined, LEVEL_ADVANCED).then((paneEl) => {
                paneEl.addClass("wizardHidden");

                const LABEL_ENABLED = "🔁 : Enabled";
                const LABEL_DISABLED = "⏹️ : Disabled";

                const hiddenFileSyncSetting = new Setting(paneEl)
                    .setName("Hidden file synchronization")
                    .setClass("wizardHidden");
                const hiddenFileSyncSettingEl = hiddenFileSyncSetting.settingEl;
                const hiddenFileSyncSettingDiv = hiddenFileSyncSettingEl.createDiv("");
                hiddenFileSyncSettingDiv.innerText = this.editingSettings.syncInternalFiles
                    ? LABEL_ENABLED
                    : LABEL_DISABLED;
                if (this.editingSettings.syncInternalFiles) {
                    new Setting(paneEl)
                        .setName("Disable Hidden files sync")
                        .setClass("wizardHidden")
                        .addButton((button) => {
                            button.setButtonText("Disable").onClick(async () => {
                                this.editingSettings.syncInternalFiles = false;
                                await this.saveAllDirtySettings();
                                this.display();
                            });
                        });
                } else {
                    new Setting(paneEl)
                        .setName("Enable Hidden files sync")
                        .setClass("wizardHidden")
                        .addButton((button) => {
                            button.setButtonText("Merge").onClick(async () => {
                                this.closeSetting();
                                // this.resetEditingSettings();
                                await this.plugin.$anyConfigureOptionalSyncFeature("MERGE");
                            });
                        })
                        .addButton((button) => {
                            button.setButtonText("Fetch").onClick(async () => {
                                this.closeSetting();
                                // this.resetEditingSettings();
                                await this.plugin.$anyConfigureOptionalSyncFeature("FETCH");
                            });
                        })
                        .addButton((button) => {
                            button.setButtonText("Overwrite").onClick(async () => {
                                this.closeSetting();
                                // this.resetEditingSettings();
                                await this.plugin.$anyConfigureOptionalSyncFeature("OVERWRITE");
                            });
                        });
                }

                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("syncInternalFilesBeforeReplication", {
                    onUpdate: visibleOnly(() => this.isConfiguredAs("watchInternalFileChanges", true)),
                });

                new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("syncInternalFilesInterval", {
                    clampMin: 10,
                    acceptZero: true,
                });
            });
        });
        void addPane(containerEl, "Selector", "🚦", 33, false, LEVEL_ADVANCED).then((paneEl) => {
            void addPanel(paneEl, "Normal Files").then((paneEl) => {
                paneEl.addClass("wizardHidden");

                const syncFilesSetting = new Setting(paneEl)
                    .setName("Synchronising files")
                    .setDesc(
                        "(RegExp) Empty to sync all files. Set filter as a regular expression to limit synchronising files."
                    )
                    .setClass("wizardHidden");
                new MultipleRegExpControl({
                    target: syncFilesSetting.controlEl,
                    props: {
                        patterns: this.editingSettings.syncOnlyRegEx.split("|[]|"),
                        originals: [...this.editingSettings.syncOnlyRegEx.split("|[]|")],
                        apply: async (newPatterns: string[]) => {
                            this.editingSettings.syncOnlyRegEx = newPatterns
                                .map((e: string) => e.trim())
                                .filter((e) => e != "")
                                .join("|[]|");
                            await this.saveAllDirtySettings();
                            this.display();
                        },
                    },
                });

                const nonSyncFilesSetting = new Setting(paneEl)
                    .setName("Non-Synchronising files")
                    .setDesc(
                        "(RegExp) If this is set, any changes to local and remote files that match this will be skipped."
                    )
                    .setClass("wizardHidden");

                new MultipleRegExpControl({
                    target: nonSyncFilesSetting.controlEl,
                    props: {
                        patterns: this.editingSettings.syncIgnoreRegEx.split("|[]|"),
                        originals: [...this.editingSettings.syncIgnoreRegEx.split("|[]|")],
                        apply: async (newPatterns: string[]) => {
                            this.editingSettings.syncIgnoreRegEx = newPatterns
                                .map((e) => e.trim())
                                .filter((e) => e != "")
                                .join("|[]|");
                            await this.saveAllDirtySettings();
                            this.display();
                        },
                    },
                });
                new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("syncMaxSizeInMB", { clampMin: 0 });

                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("useIgnoreFiles");
                new Setting(paneEl).setClass("wizardHidden").autoWireTextArea("ignoreFiles", {
                    onUpdate: visibleOnly(() => this.isConfiguredAs("useIgnoreFiles", true)),
                });
            });
            void addPanel(paneEl, "Hidden Files", undefined, undefined, LEVEL_ADVANCED).then((paneEl) => {
                const defaultSkipPattern = "\\/node_modules\\/, \\/\\.git\\/, ^\\.git\\/, \\/obsidian-livesync\\/";
                const defaultSkipPatternXPlat =
                    defaultSkipPattern + ",\\/workspace$ ,\\/workspace.json$,\\/workspace-mobile.json$";

                const pat = this.editingSettings.syncInternalFilesIgnorePatterns
                    .split(",")
                    .map((x) => x.trim())
                    .filter((x) => x != "");
                const patSetting = new Setting(paneEl).setName("Ignore patterns").setClass("wizardHidden").setDesc("");

                new MultipleRegExpControl({
                    target: patSetting.controlEl,
                    props: {
                        patterns: pat,
                        originals: [...pat],
                        apply: async (newPatterns: string[]) => {
                            this.editingSettings.syncInternalFilesIgnorePatterns = newPatterns
                                .map((e) => e.trim())
                                .filter((e) => e != "")
                                .join(", ");
                            await this.saveAllDirtySettings();
                            this.display();
                        },
                    },
                });

                const addDefaultPatterns = async (patterns: string) => {
                    const oldList = this.editingSettings.syncInternalFilesIgnorePatterns
                        .split(",")
                        .map((x) => x.trim())
                        .filter((x) => x != "");
                    const newList = patterns
                        .split(",")
                        .map((x) => x.trim())
                        .filter((x) => x != "");
                    const allSet = new Set([...oldList, ...newList]);
                    this.editingSettings.syncInternalFilesIgnorePatterns = [...allSet].join(", ");
                    await this.saveAllDirtySettings();
                    this.display();
                };

                new Setting(paneEl)
                    .setName("Add default patterns")
                    .setClass("wizardHidden")
                    .addButton((button) => {
                        button.setButtonText("Default").onClick(async () => {
                            await addDefaultPatterns(defaultSkipPattern);
                        });
                    })
                    .addButton((button) => {
                        button.setButtonText("Cross-platform").onClick(async () => {
                            await addDefaultPatterns(defaultSkipPatternXPlat);
                        });
                    });
            });
        });

        void addPane(containerEl, "Customization sync", "🔌", 60, false, LEVEL_ADVANCED).then((paneEl) => {
            // With great respect, thank you TfTHacker!
            // Refer: https://github.com/TfTHacker/obsidian42-brat/blob/main/src/features/BetaPlugins.ts
            void addPanel(paneEl, "Customization Sync").then((paneEl) => {
                const enableOnlyOnPluginSyncIsNotEnabled = enableOnly(() =>
                    this.isConfiguredAs("usePluginSync", false)
                );
                const visibleOnlyOnPluginSyncEnabled = visibleOnly(() => this.isConfiguredAs("usePluginSync", true));

                this.createEl(
                    paneEl,
                    "div",
                    {
                        text: "Please set device name to identify this device. This name should be unique among your devices. While not configured, we cannot enable this feature.",
                        cls: "op-warn",
                    },
                    (c) => {},
                    visibleOnly(() => this.isConfiguredAs("deviceAndVaultName", ""))
                );
                this.createEl(
                    paneEl,
                    "div",
                    {
                        text: "We cannot change the device name while this feature is enabled. Please disable this feature to change the device name.",
                        cls: "op-warn-info",
                    },
                    (c) => {},
                    visibleOnly(() => this.isConfiguredAs("usePluginSync", true))
                );

                new Setting(paneEl).autoWireText("deviceAndVaultName", {
                    placeHolder: "desktop",
                    onUpdate: enableOnlyOnPluginSyncIsNotEnabled,
                });

                new Setting(paneEl).autoWireToggle("usePluginSyncV2");

                new Setting(paneEl).autoWireToggle("usePluginSync", {
                    onUpdate: enableOnly(() => !this.isConfiguredAs("deviceAndVaultName", "")),
                });

                new Setting(paneEl).autoWireToggle("autoSweepPlugins", {
                    onUpdate: visibleOnlyOnPluginSyncEnabled,
                });

                new Setting(paneEl).autoWireToggle("autoSweepPluginsPeriodic", {
                    onUpdate: visibleOnly(
                        () =>
                            this.isConfiguredAs("usePluginSync", true) && this.isConfiguredAs("autoSweepPlugins", true)
                    ),
                });
                new Setting(paneEl).autoWireToggle("notifyPluginOrSettingUpdated", {
                    onUpdate: visibleOnlyOnPluginSyncEnabled,
                });

                new Setting(paneEl)
                    .setName("Open")
                    .setDesc("Open the dialog")
                    .addButton((button) => {
                        button
                            .setButtonText("Open")
                            .setDisabled(false)
                            .onClick(() => {
                                // this.plugin.getAddOn<ConfigSync>(ConfigSync.name)?.showPluginSyncModal();
                                // this.plugin.addOnConfigSync.showPluginSyncModal();
                                eventHub.emitEvent(EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG);
                            });
                    })
                    .addOnUpdate(visibleOnlyOnPluginSyncEnabled);
            });
        });

        void addPane(containerEl, "Hatch", "🧰", 50, true).then((paneEl) => {
            // const hatchWarn = this.createEl(paneEl, "div", { text: `To stop the boot up sequence for fixing problems on databases, you can put redflag.md on top of your vault (Rebooting obsidian is required).` });
            // hatchWarn.addClass("op-warn-info");
            void addPanel(paneEl, "Reporting Issue").then((paneEl) => {
                new Setting(paneEl).setName("Make report to inform the issue").addButton((button) =>
                    button
                        .setButtonText("Make report")
                        .setCta()
                        .setDisabled(false)
                        .onClick(async () => {
                            let responseConfig: any = {};
                            const REDACTED = "𝑅𝐸𝐷𝐴𝐶𝑇𝐸𝐷";
                            if (this.editingSettings.remoteType == REMOTE_COUCHDB) {
                                try {
                                    const r = await requestToCouchDB(
                                        this.editingSettings.couchDB_URI,
                                        this.editingSettings.couchDB_USER,
                                        this.editingSettings.couchDB_PASSWORD,
                                        window.origin
                                    );

                                    Logger(JSON.stringify(r.json, null, 2));

                                    responseConfig = r.json;
                                    responseConfig["couch_httpd_auth"].secret = REDACTED;
                                    responseConfig["couch_httpd_auth"].authentication_db = REDACTED;
                                    responseConfig["couch_httpd_auth"].authentication_redirect = REDACTED;
                                    responseConfig["couchdb"].uuid = REDACTED;
                                    responseConfig["admins"] = REDACTED;
                                } catch (ex) {
                                    Logger(ex, LOG_LEVEL_VERBOSE);
                                    responseConfig =
                                        "Requesting information from the remote CouchDB has failed. If you are using IBM Cloudant, this is normal behaviour.";
                                }
                            } else if (this.editingSettings.remoteType == REMOTE_MINIO) {
                                responseConfig = "Object Storage Synchronisation";
                                //
                            }
                            const pluginConfig = JSON.parse(
                                JSON.stringify(this.editingSettings)
                            ) as ObsidianLiveSyncSettings;
                            pluginConfig.couchDB_DBNAME = REDACTED;
                            pluginConfig.couchDB_PASSWORD = REDACTED;
                            const scheme = pluginConfig.couchDB_URI.startsWith("http:")
                                ? "(HTTP)"
                                : pluginConfig.couchDB_URI.startsWith("https:")
                                  ? "(HTTPS)"
                                  : "";
                            pluginConfig.couchDB_URI = isCloudantURI(pluginConfig.couchDB_URI)
                                ? "cloudant"
                                : `self-hosted${scheme}`;
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
                                const endpointScheme = pluginConfig.endpoint.startsWith("http:")
                                    ? "(HTTP)"
                                    : pluginConfig.endpoint.startsWith("https:")
                                      ? "(HTTPS)"
                                      : "";
                                pluginConfig.endpoint = `${endpoint.indexOf(".r2.cloudflarestorage.") !== -1 ? "R2" : "self-hosted?"}(${endpointScheme})`;
                            }
                            const obsidianInfo = `Navigator: ${navigator.userAgent}
FileSystem: ${this.plugin.$$isStorageInsensitive() ? "insensitive" : "sensitive"}`;
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
                new Setting(paneEl).autoWireToggle("writeLogToTheFile");
            });

            void addPanel(paneEl, "Scram Switches").then((paneEl) => {
                new Setting(paneEl).autoWireToggle("suspendFileWatching");
                this.addOnSaved("suspendFileWatching", () => this.plugin.$$askReload());

                new Setting(paneEl).autoWireToggle("suspendParseReplicationResult");
                this.addOnSaved("suspendParseReplicationResult", () => this.plugin.$$askReload());
            });

            void addPanel(paneEl, "Recovery and Repair").then((paneEl) => {
                const addResult = async (
                    path: string,
                    file: FilePathWithPrefix | false,
                    fileOnDB: LoadedEntry | false
                ) => {
                    const storageFileStat = file ? await this.plugin.storageAccess.statHidden(file) : null;
                    resultArea.appendChild(
                        this.createEl(resultArea, "div", {}, (el) => {
                            el.appendChild(this.createEl(el, "h6", { text: path }));
                            el.appendChild(
                                this.createEl(el, "div", {}, (infoGroupEl) => {
                                    infoGroupEl.appendChild(
                                        this.createEl(infoGroupEl, "div", {
                                            text: `Storage : Modified: ${!storageFileStat ? `Missing:` : `${new Date(storageFileStat.mtime).toLocaleString()}, Size:${storageFileStat.size}`}`,
                                        })
                                    );
                                    infoGroupEl.appendChild(
                                        this.createEl(infoGroupEl, "div", {
                                            text: `Database: Modified: ${!fileOnDB ? `Missing:` : `${new Date(fileOnDB.mtime).toLocaleString()}, Size:${fileOnDB.size}`}`,
                                        })
                                    );
                                })
                            );
                            if (fileOnDB && file) {
                                el.appendChild(
                                    this.createEl(el, "button", { text: "Show history" }, (buttonEl) => {
                                        buttonEl.onClickEvent(() => {
                                            eventHub.emitEvent(EVENT_REQUEST_SHOW_HISTORY, {
                                                file: file,
                                                fileOnDB: fileOnDB,
                                            });
                                        });
                                    })
                                );
                            }
                            if (file) {
                                el.appendChild(
                                    this.createEl(el, "button", { text: "Storage -> Database" }, (buttonEl) => {
                                        buttonEl.onClickEvent(async () => {
                                            if (file.startsWith(".")) {
                                                const addOn = this.plugin.getAddOn<HiddenFileSync>(HiddenFileSync.name);
                                                if (addOn) {
                                                    const file = (await addOn.scanInternalFiles()).find(
                                                        (e) => e.path == path
                                                    );
                                                    if (!file) {
                                                        Logger(
                                                            `Failed to find the file in the internal files: ${path}`,
                                                            LOG_LEVEL_NOTICE
                                                        );
                                                        return;
                                                    }
                                                    if (!(await addOn.storeInternalFileToDatabase(file, true))) {
                                                        Logger(
                                                            `Failed to store the file to the database (Hidden file): ${file}`,
                                                            LOG_LEVEL_NOTICE
                                                        );
                                                        return;
                                                    }
                                                }
                                            } else {
                                                if (
                                                    !(await this.plugin.fileHandler.storeFileToDB(
                                                        file as FilePath,
                                                        true
                                                    ))
                                                ) {
                                                    Logger(
                                                        `Failed to store the file to the database: ${file}`,
                                                        LOG_LEVEL_NOTICE
                                                    );
                                                    return;
                                                }
                                            }
                                            el.remove();
                                        });
                                    })
                                );
                            }
                            if (fileOnDB) {
                                el.appendChild(
                                    this.createEl(el, "button", { text: "Database -> Storage" }, (buttonEl) => {
                                        buttonEl.onClickEvent(async () => {
                                            if (fileOnDB.path.startsWith(ICHeader)) {
                                                const addOn = this.plugin.getAddOn<HiddenFileSync>(HiddenFileSync.name);
                                                if (addOn) {
                                                    if (
                                                        !(await addOn.extractInternalFileFromDatabase(
                                                            path as FilePath,
                                                            true
                                                        ))
                                                    ) {
                                                        Logger(
                                                            `Failed to store the file to the database (Hidden file): ${file}`,
                                                            LOG_LEVEL_NOTICE
                                                        );
                                                        return;
                                                    }
                                                }
                                            } else {
                                                if (
                                                    !(await this.plugin.fileHandler.dbToStorage(
                                                        fileOnDB as MetaEntry,
                                                        null,
                                                        true
                                                    ))
                                                ) {
                                                    Logger(
                                                        `Failed to store the file to the storage: ${fileOnDB.path}`,
                                                        LOG_LEVEL_NOTICE
                                                    );
                                                    return;
                                                }
                                            }
                                            el.remove();
                                        });
                                    })
                                );
                            }
                            return el;
                        })
                    );
                };

                const checkBetweenStorageAndDatabase = async (file: FilePathWithPrefix, fileOnDB: LoadedEntry) => {
                    const dataContent = readAsBlob(fileOnDB);
                    const content = createBlob(await this.plugin.storageAccess.readHiddenFileBinary(file));
                    if (await isDocContentSame(content, dataContent)) {
                        Logger(`Compare: SAME: ${file}`);
                    } else {
                        Logger(`Compare: CONTENT IS NOT MATCHED! ${file}`, LOG_LEVEL_NOTICE);
                        void addResult(file, file, fileOnDB);
                    }
                };
                new Setting(paneEl)
                    .setName("Recreate missing chunks for all files")
                    .setDesc(
                        "This will recreate chunks for all files. If there were missing chunks, this may fix the errors."
                    )
                    .addButton((button) =>
                        button
                            .setButtonText("Recreate all")
                            .setCta()
                            .onClick(async () => {
                                await this.plugin.fileHandler.createAllChunks(true);
                            })
                    );
                new Setting(paneEl)
                    .setName("Resolve All conflicted files by the newer one")
                    .setDesc(
                        "Resolve all conflicted files by the newer one. Caution: This will overwrite the older one, and cannot resurrect the overwritten one."
                    )
                    .addButton((button) =>
                        button
                            .setButtonText("Resolve All")
                            .setCta()
                            .onClick(async () => {
                                await this.plugin.rebuilder.resolveAllConflictedFilesByNewerOnes();
                            })
                    );

                new Setting(paneEl)
                    .setName("Verify and repair all files")
                    .setDesc(
                        "Compare the content of files between on local database and storage. If not matched, you will be asked which one you want to keep."
                    )
                    .addButton((button) =>
                        button
                            .setButtonText("Verify all")
                            .setDisabled(false)
                            .setCta()
                            .onClick(async () => {
                                Logger("Start verifying all files", LOG_LEVEL_NOTICE, "verify");
                                const ignorePatterns = this.plugin.settings.syncInternalFilesIgnorePatterns
                                    .replace(/\n| /g, "")
                                    .split(",")
                                    .filter((e) => e)
                                    .map((e) => new RegExp(e, "i"));
                                this.plugin.localDatabase.hashCaches.clear();
                                Logger("Start verifying all files", LOG_LEVEL_NOTICE, "verify");
                                const files = this.plugin.settings.syncInternalFiles
                                    ? await this.plugin.storageAccess.getFilesIncludeHidden(
                                          "/",
                                          undefined,
                                          ignorePatterns
                                      )
                                    : await this.plugin.storageAccess.getFileNames();
                                const documents = [] as FilePath[];

                                const adn = this.plugin.localDatabase.findAllDocs();
                                for await (const i of adn) {
                                    const path = getPath(i);
                                    if (path.startsWith(ICXHeader)) continue;
                                    if (path.startsWith(PSCHeader)) continue;
                                    if (!this.plugin.settings.syncInternalFiles && path.startsWith(ICHeader)) continue;
                                    documents.push(stripAllPrefixes(path));
                                }
                                const allPaths = [...new Set([...documents, ...files])];
                                let i = 0;
                                const incProc = () => {
                                    i++;
                                    if (i % 25 == 0)
                                        Logger(
                                            `Checking ${i}/${files.length} files \n`,
                                            LOG_LEVEL_NOTICE,
                                            "verify-processed"
                                        );
                                };
                                const semaphore = Semaphore(10);
                                const processes = allPaths.map(async (path) => {
                                    try {
                                        if (shouldBeIgnored(path)) {
                                            return incProc();
                                        }
                                        const stat = (await this.plugin.storageAccess.isExistsIncludeHidden(path))
                                            ? await this.plugin.storageAccess.statHidden(path)
                                            : false;
                                        const fileOnStorage = stat != null ? stat : false;
                                        if (!(await this.plugin.$$isTargetFile(path))) return incProc();
                                        const releaser = await semaphore.acquire(1);
                                        if (fileOnStorage && this.plugin.$$isFileSizeExceeded(fileOnStorage.size))
                                            return incProc();
                                        try {
                                            const isHiddenFile = path.startsWith(".");
                                            const dbPath = isHiddenFile ? addPrefix(path, ICHeader) : path;
                                            const fileOnDB = await this.plugin.localDatabase.getDBEntry(dbPath);
                                            if (fileOnDB && this.plugin.$$isFileSizeExceeded(fileOnDB.size))
                                                return incProc();

                                            if (!fileOnDB && fileOnStorage) {
                                                Logger(
                                                    `Compare: Not found on the local database: ${path}`,
                                                    LOG_LEVEL_NOTICE
                                                );
                                                void addResult(path, path, false);
                                                return incProc();
                                            }
                                            if (fileOnDB && !fileOnStorage) {
                                                Logger(`Compare: Not found on the storage: ${path}`, LOG_LEVEL_NOTICE);
                                                void addResult(path, false, fileOnDB);
                                                return incProc();
                                            }
                                            if (fileOnStorage && fileOnDB) {
                                                await checkBetweenStorageAndDatabase(path, fileOnDB);
                                            }
                                        } catch (ex) {
                                            Logger(`Error while processing ${path}`, LOG_LEVEL_NOTICE);
                                            Logger(ex, LOG_LEVEL_VERBOSE);
                                        } finally {
                                            releaser();
                                            incProc();
                                        }
                                    } catch (ex) {
                                        Logger(`Error while processing without semaphore ${path}`, LOG_LEVEL_NOTICE);
                                        Logger(ex, LOG_LEVEL_VERBOSE);
                                    }
                                });
                                await Promise.all(processes);
                                Logger("done", LOG_LEVEL_NOTICE, "verify");
                                // Logger(`${i}/${files.length}\n`, LOG_LEVEL_NOTICE, "verify-processed");
                            })
                    );
                const resultArea = paneEl.createDiv({ text: "" });
                new Setting(paneEl)
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
                                        const idEncoded = await this.plugin.$$path2id(docName as FilePathWithPrefix);
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
                                            const obfuscatedDoc = await this.plugin.localDatabase.getRaw(idEncoded, {
                                                revs_info: true,
                                            });
                                            // Unfortunately we have to delete one of them.
                                            // Just now, save it as a conflicted document.
                                            obfuscatedDoc._revs_info?.shift(); // Drop latest revision.
                                            const previousRev = obfuscatedDoc._revs_info?.shift(); // Use second revision.
                                            if (previousRev) {
                                                newDoc._rev = previousRev.rev;
                                            } else {
                                                //If there are no revisions, set the possibly unique one
                                                newDoc._rev =
                                                    "1-" +
                                                    `00000000000000000000000000000000${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}${~~(Math.random() * 1e9)}`.slice(
                                                        -32
                                                    );
                                            }
                                            const ret = await this.plugin.localDatabase.putRaw(newDoc, { force: true });
                                            if (ret.ok) {
                                                Logger(
                                                    `${docName} has been converted as conflicted document`,
                                                    LOG_LEVEL_NOTICE
                                                );
                                                doc._deleted = true;
                                                if ((await this.plugin.localDatabase.putRaw(doc)).ok) {
                                                    Logger(`Old ${docName} has been deleted`, LOG_LEVEL_NOTICE);
                                                }
                                                await this.plugin.$$queueConflictCheckIfOpen(
                                                    docName as FilePathWithPrefix
                                                );
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
                                                Logger(
                                                    `Something went wrong while converting ${docName}`,
                                                    LOG_LEVEL_NOTICE
                                                );
                                                Logger(ex, LOG_LEVEL_VERBOSE);
                                                // Something wrong.
                                            }
                                        }
                                    }
                                }
                                Logger(`Converting finished`, LOG_LEVEL_NOTICE);
                            })
                    );
            });
            void addPanel(paneEl, "Reset").then((paneEl) => {
                new Setting(paneEl).setName("Back to non-configured").addButton((button) =>
                    button
                        .setButtonText("Back")
                        .setDisabled(false)
                        .onClick(async () => {
                            this.editingSettings.isConfigured = false;
                            await this.saveAllDirtySettings();
                            this.plugin.$$askReload();
                        })
                );

                new Setting(paneEl).setName("Delete all customization sync data").addButton((button) =>
                    button
                        .setButtonText("Delete")
                        .setDisabled(false)
                        .setWarning()
                        .onClick(async () => {
                            Logger(`Deleting customization sync data`, LOG_LEVEL_NOTICE);
                            const entriesToDelete = await this.plugin.localDatabase.allDocsRaw({
                                startkey: "ix:",
                                endkey: "ix:\u{10ffff}",
                                include_docs: true,
                            });
                            const newData = entriesToDelete.rows.map((e) => ({
                                ...e.doc,
                                _deleted: true,
                            }));
                            const r = await this.plugin.localDatabase.bulkDocsRaw(newData as any[]);
                            // Do not care about the result.
                            Logger(
                                `${r.length} items have been removed, to confirm how many items are left, please perform it again.`,
                                LOG_LEVEL_NOTICE
                            );
                        })
                );
            });
        });
        void addPane(containerEl, "Advanced", "🔧", 46, false, LEVEL_ADVANCED).then((paneEl) => {
            void addPanel(paneEl, "Memory cache").then((paneEl) => {
                new Setting(paneEl).autoWireNumeric("hashCacheMaxCount", { clampMin: 10 });
                new Setting(paneEl).autoWireNumeric("hashCacheMaxAmount", { clampMin: 1 });
            });
            void addPanel(paneEl, "Local Database Tweak").then((paneEl) => {
                paneEl.addClass("wizardHidden");

                new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("customChunkSize", { clampMin: 0 });

                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("enableChunkSplitterV2", {
                    onUpdate: enableOnly(() => this.isConfiguredAs("useSegmenter", false)),
                });
                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("useSegmenter", {
                    onUpdate: enableOnly(() => this.isConfiguredAs("enableChunkSplitterV2", false)),
                });
            });

            void addPanel(paneEl, "Transfer Tweak").then((paneEl) => {
                new Setting(paneEl)
                    .setClass("wizardHidden")
                    .autoWireToggle("readChunksOnline", { onUpdate: onlyOnCouchDB });

                new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("concurrencyOfReadChunksOnline", {
                    clampMin: 10,
                    onUpdate: onlyOnCouchDB,
                });

                new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("minimumIntervalOfReadChunksOnline", {
                    clampMin: 10,
                    onUpdate: onlyOnCouchDB,
                });
                // new Setting(paneEl)
                //     .setClass("wizardHidden")
                //     .autoWireToggle("sendChunksBulk", { onUpdate: onlyOnCouchDB })
                // new Setting(paneEl)
                //     .setClass("wizardHidden")
                //     .autoWireNumeric("sendChunksBulkMaxSize", {
                //         clampMax: 100, clampMin: 1, onUpdate: onlyOnCouchDB
                //     })
            });
        });

        void addPane(containerEl, "Power users", "💪", 47, true, LEVEL_POWER_USER).then((paneEl) => {
            void addPanel(paneEl, "Remote Database Tweak").then((paneEl) => {
                new Setting(paneEl).autoWireToggle("useEden").setClass("wizardHidden");
                const onlyUsingEden = visibleOnly(() => this.isConfiguredAs("useEden", true));
                new Setting(paneEl)
                    .autoWireNumeric("maxChunksInEden", { onUpdate: onlyUsingEden })
                    .setClass("wizardHidden");
                new Setting(paneEl)
                    .autoWireNumeric("maxTotalLengthInEden", { onUpdate: onlyUsingEden })
                    .setClass("wizardHidden");
                new Setting(paneEl)
                    .autoWireNumeric("maxAgeInEden", { onUpdate: onlyUsingEden })
                    .setClass("wizardHidden");

                new Setting(paneEl).autoWireToggle("enableCompression").setClass("wizardHidden");
            });

            void addPanel(paneEl, "CouchDB Connection Tweak", undefined, onlyOnCouchDB).then((paneEl) => {
                paneEl.addClass("wizardHidden");

                this.createEl(
                    paneEl,
                    "div",
                    {
                        text: `If you reached the payload size limit when using IBM Cloudant, please decrease batch size and batch limit to a lower value.`,
                    },
                    undefined,
                    onlyOnCouchDB
                ).addClass("wizardHidden");

                new Setting(paneEl)
                    .setClass("wizardHidden")
                    .autoWireNumeric("batch_size", { clampMin: 2, onUpdate: onlyOnCouchDB });
                new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("batches_limit", {
                    clampMin: 2,
                    onUpdate: onlyOnCouchDB,
                });
                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("useTimeouts", { onUpdate: onlyOnCouchDB });
            });
            void addPanel(paneEl, "Configuration Encryption").then((paneEl) => {
                const passphrase_options: Record<ConfigPassphraseStore, string> = {
                    "": "Default",
                    LOCALSTORAGE: "Use a custom passphrase",
                    ASK_AT_LAUNCH: "Ask an passphrase at every launch",
                };

                new Setting(paneEl)
                    .setName("Encrypting sensitive configuration items")
                    .autoWireDropDown("configPassphraseStore", {
                        options: passphrase_options,
                        holdValue: true,
                    })
                    .setClass("wizardHidden");

                new Setting(paneEl)
                    .autoWireText("configPassphrase", { isPassword: true, holdValue: true })
                    .setClass("wizardHidden")
                    .addOnUpdate(() => ({
                        disabled: !this.isConfiguredAs("configPassphraseStore", "LOCALSTORAGE"),
                    }));
                new Setting(paneEl)
                    .addApplyButton(["configPassphrase", "configPassphraseStore"])
                    .setClass("wizardHidden");
            });
            void addPanel(paneEl, "Developer").then((paneEl) => {
                new Setting(paneEl).autoWireToggle("enableDebugTools").setClass("wizardHidden");
            });
        });

        void addPane(containerEl, "Patches", "🩹", 51, false, LEVEL_EDGE_CASE).then((paneEl) => {
            void addPanel(paneEl, "Compatibility (Metadata)").then((paneEl) => {
                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("deleteMetadataOfDeletedFiles");

                new Setting(paneEl)
                    .setClass("wizardHidden")
                    .autoWireNumeric("automaticallyDeleteMetadataOfDeletedFiles", {
                        onUpdate: visibleOnly(() => this.isConfiguredAs("deleteMetadataOfDeletedFiles", true)),
                    });
            });

            void addPanel(paneEl, "Compatibility (Conflict Behaviour)").then((paneEl) => {
                paneEl.addClass("wizardHidden");
                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("disableMarkdownAutoMerge");
                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("writeDocumentsIfConflicted");
            });

            void addPanel(paneEl, "Compatibility (Database structure)").then((paneEl) => {
                new Setting(paneEl).autoWireToggle("useIndexedDBAdapter", { invert: true, holdValue: true });

                new Setting(paneEl)
                    .autoWireToggle("doNotUseFixedRevisionForChunks", { holdValue: true })
                    .setClass("wizardHidden");
                new Setting(paneEl)
                    .autoWireToggle("handleFilenameCaseSensitive", { holdValue: true })
                    .setClass("wizardHidden");

                this.addOnSaved("useIndexedDBAdapter", async () => {
                    await this.saveAllDirtySettings();
                    await rebuildDB("localOnly");
                });
            });

            void addPanel(paneEl, "Compatibility (Internal API Usage)").then((paneEl) => {
                new Setting(paneEl).autoWireToggle("watchInternalFileChanges", { invert: true });
            });

            void addPanel(paneEl, "Edge case addressing (Database)").then((paneEl) => {
                new Setting(paneEl)
                    .autoWireText("additionalSuffixOfDatabaseName", { holdValue: true })
                    .addApplyButton(["additionalSuffixOfDatabaseName"]);

                this.addOnSaved("additionalSuffixOfDatabaseName", async (key) => {
                    Logger("Suffix has been changed. Reopening database...", LOG_LEVEL_NOTICE);
                    await this.plugin.$$initializeDatabase();
                });

                new Setting(paneEl).autoWireDropDown("hashAlg", {
                    options: {
                        "": "Old Algorithm",
                        xxhash32: "xxhash32 (Fast)",
                        xxhash64: "xxhash64 (Fastest)",
                        sha1: "Fallback (Without WebAssembly)",
                    } as Record<HashAlgorithm, string>,
                });
                this.addOnSaved("hashAlg", async () => {
                    await this.plugin.localDatabase._prepareHashFunctions();
                });
            });
            void addPanel(paneEl, "Edge case addressing (Behaviour)").then((paneEl) => {
                new Setting(paneEl).autoWireToggle("doNotSuspendOnFetching");
                new Setting(paneEl).setClass("wizardHidden").autoWireToggle("doNotDeleteFolder");
            });

            void addPanel(paneEl, "Edge case addressing (Processing)").then((paneEl) => {
                new Setting(paneEl).autoWireToggle("disableWorkerForGeneratingChunks");

                new Setting(paneEl).autoWireToggle("processSmallFilesInUIThread", {
                    onUpdate: visibleOnly(() => this.isConfiguredAs("disableWorkerForGeneratingChunks", false)),
                });
            });

            void addPanel(paneEl, "Compatibility (Trouble addressed)").then((paneEl) => {
                new Setting(paneEl).autoWireToggle("disableCheckingConfigMismatch");
            });
        });

        void addPane(containerEl, "Maintenance", "🎛️", 70, true).then((paneEl) => {
            const isRemoteLockedAndDeviceNotAccepted = () => this.plugin?.replicator?.remoteLockedAndDeviceNotAccepted;
            const isRemoteLocked = () => this.plugin?.replicator?.remoteLocked;
            // if (this.plugin?.replicator?.remoteLockedAndDeviceNotAccepted) {
            this.createEl(
                paneEl,
                "div",
                {
                    text: "To prevent unwanted vault corruption, the remote database has been locked for synchronization, and this device was not marked as 'resolved'. It caused by some operations like this. Re-initialized. Local database initialization should be required. Please back your vault up, reset the local database, and press 'Mark this device as resolved'. This warning kept showing until confirming the device is resolved by the replication.",
                    cls: "op-warn",
                },
                (c) => {
                    this.createEl(
                        c,
                        "button",
                        {
                            text: "I'm ready, mark this device 'resolved'",
                            cls: "mod-warning",
                        },
                        (e) => {
                            e.addEventListener("click", () => {
                                fireAndForget(async () => {
                                    await this.plugin.$$markRemoteResolved();
                                    this.display();
                                });
                            });
                        }
                    );
                },
                visibleOnly(isRemoteLockedAndDeviceNotAccepted)
            );
            this.createEl(
                paneEl,
                "div",
                {
                    text: "To prevent unwanted vault corruption, the remote database has been locked for synchronization. (This device is marked 'resolved') When all your devices are marked 'resolved', unlock the database. This warning kept showing until confirming the device is resolved by the replication",
                    cls: "op-warn",
                },
                (c) =>
                    this.createEl(
                        c,
                        "button",
                        {
                            text: "I'm ready, unlock the database",
                            cls: "mod-warning",
                        },
                        (e) => {
                            e.addEventListener("click", () => {
                                fireAndForget(async () => {
                                    await this.plugin.$$markRemoteUnlocked();
                                    this.display();
                                });
                            });
                        }
                    ),
                visibleOnly(isRemoteLocked)
            );

            void addPanel(paneEl, "Scram!").then((paneEl) => {
                new Setting(paneEl)
                    .setName("Lock remote")
                    .setDesc("Lock remote to prevent synchronization with other devices.")
                    .addButton((button) =>
                        button
                            .setButtonText("Lock")
                            .setDisabled(false)
                            .setWarning()
                            .onClick(async () => {
                                await this.plugin.$$markRemoteLocked();
                            })
                    );

                new Setting(paneEl)
                    .setName("Emergency restart")
                    .setDesc("place the flag file to prevent all operation and restart.")
                    .addButton((button) =>
                        button
                            .setButtonText("Flag and restart")
                            .setDisabled(false)
                            .setWarning()
                            .onClick(async () => {
                                await this.plugin.storageAccess.writeFileAuto(FLAGMD_REDFLAG, "");
                                this.plugin.$$performRestart();
                            })
                    );
            });

            void addPanel(paneEl, "Data-complementary Operations").then((paneEl) => {
                new Setting(paneEl)
                    .setName("Resend")
                    .setDesc("Resend all chunks to the remote.")
                    .addButton((button) =>
                        button
                            .setButtonText("Send chunks")
                            .setWarning()
                            .setDisabled(false)
                            .onClick(async () => {
                                if (this.plugin.replicator instanceof LiveSyncCouchDBReplicator) {
                                    await this.plugin.replicator.sendChunks(this.plugin.settings, undefined, true, 0);
                                }
                            })
                    )
                    .addOnUpdate(onlyOnCouchDB);
                new Setting(paneEl)
                    .setName("Reset journal received history")
                    .setDesc(
                        "Initialise journal received history. On the next sync, every item except this device sent will be downloaded again."
                    )
                    .addButton((button) =>
                        button
                            .setButtonText("Reset received")
                            .setWarning()
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                                    ...info,
                                    receivedFiles: new Set(),
                                    knownIDs: new Set(),
                                }));
                                Logger(`Journal received history has been cleared.`, LOG_LEVEL_NOTICE);
                            })
                    )
                    .addOnUpdate(onlyOnMinIO);

                new Setting(paneEl)
                    .setName("Reset journal sent history")
                    .setDesc(
                        "Initialise journal sent history. On the next sync, every item except this device received will be sent again."
                    )
                    .addButton((button) =>
                        button
                            .setButtonText("Reset sent history")
                            .setWarning()
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                                    ...info,
                                    lastLocalSeq: 0,
                                    sentIDs: new Set(),
                                    sentFiles: new Set(),
                                }));
                                Logger(`Journal sent history has been cleared.`, LOG_LEVEL_NOTICE);
                            })
                    )
                    .addOnUpdate(onlyOnMinIO);
            });

            void addPanel(paneEl, "Rebuilding Operations (Local)").then((paneEl) => {
                new Setting(paneEl)
                    .setName("Fetch from remote")
                    .setDesc("Restore or reconstruct local database from remote.")
                    .addButton((button) =>
                        button
                            .setButtonText("Fetch")
                            .setWarning()
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.plugin.storageAccess.writeFileAuto(FLAGMD_REDFLAG3_HR, "");
                                this.plugin.$$performRestart();
                            })
                    )
                    .addButton((button) =>
                        button
                            .setButtonText("Fetch w/o restarting")
                            .setWarning()
                            .setDisabled(false)
                            .onClick(async () => {
                                await rebuildDB("localOnly");
                            })
                    );

                new Setting(paneEl)
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
                    )
                    .addOnUpdate(onlyOnCouchDB);
            });

            void addPanel(paneEl, "Total Overhaul").then((paneEl) => {
                new Setting(paneEl)
                    .setName("Rebuild everything")
                    .setDesc("Rebuild local and remote database with local files.")
                    .addButton((button) =>
                        button
                            .setButtonText("Rebuild")
                            .setWarning()
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.plugin.storageAccess.writeFileAuto(FLAGMD_REDFLAG2_HR, "");
                                this.plugin.$$performRestart();
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
                    );
            });
            void addPanel(paneEl, "Rebuilding Operations (Remote Only)").then((paneEl) => {
                new Setting(paneEl)
                    .setName("Perform compaction")
                    .setDesc(
                        "Compaction discards all of Eden in the non-latest revisions, reducing the storage usage. However, this operation requires the same free space on the remote as the current database."
                    )
                    .addButton((button) =>
                        button
                            .setButtonText("Perform")
                            .setDisabled(false)
                            .onClick(async () => {
                                const replicator = this.plugin.replicator as LiveSyncCouchDBReplicator;
                                Logger(`Compaction has been began`, LOG_LEVEL_NOTICE, "compaction");
                                if (await replicator.compactRemote(this.editingSettings)) {
                                    Logger(`Compaction has been completed!`, LOG_LEVEL_NOTICE, "compaction");
                                } else {
                                    Logger(`Compaction has been failed!`, LOG_LEVEL_NOTICE, "compaction");
                                }
                            })
                    )
                    .addOnUpdate(onlyOnCouchDB);

                new Setting(paneEl)
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
                    );

                new Setting(paneEl)
                    .setName("Reset all journal counter")
                    .setDesc("Initialise all journal history, On the next sync, every item will be received and sent.")
                    .addButton((button) =>
                        button
                            .setButtonText("Reset all")
                            .setWarning()
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.getMinioJournalSyncClient().resetCheckpointInfo();
                                Logger(`Journal exchange history has been cleared.`, LOG_LEVEL_NOTICE);
                            })
                    )
                    .addOnUpdate(onlyOnMinIO);

                new Setting(paneEl)
                    .setName("Purge all journal counter")
                    .setDesc("Purge all sending and downloading cache.")
                    .addButton((button) =>
                        button
                            .setButtonText("Reset all")
                            .setWarning()
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.getMinioJournalSyncClient().resetAllCaches();
                                Logger(`Journal sending and downloading cache has been cleared.`, LOG_LEVEL_NOTICE);
                            })
                    )
                    .addOnUpdate(onlyOnMinIO);

                new Setting(paneEl)
                    .setName("Make empty the bucket")
                    .setDesc("Delete all data on the remote.")
                    .addButton((button) =>
                        button
                            .setButtonText("Delete")
                            .setWarning()
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                                    ...info,
                                    receivedFiles: new Set(),
                                    knownIDs: new Set(),
                                    lastLocalSeq: 0,
                                    sentIDs: new Set(),
                                    sentFiles: new Set(),
                                }));
                                await this.resetRemoteBucket();
                                Logger(`the bucket has been cleared.`, LOG_LEVEL_NOTICE);
                            })
                    )
                    .addOnUpdate(onlyOnMinIO);
            });

            void addPanel(paneEl, "Niches").then((paneEl) => {
                new Setting(paneEl)
                    .setClass("sls-setting-obsolete")
                    .setName("(Obsolete) Clean up databases")
                    .setDesc(
                        "Delete unused chunks to shrink the database. However, this feature could be not effective in some cases. Please use rebuild everything instead."
                    )
                    .addButton((button) =>
                        button
                            .setButtonText("DryRun")
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.dryRunGC();
                            })
                    )
                    .addButton((button) =>
                        button
                            .setButtonText("Perform cleaning")
                            .setDisabled(false)
                            .setWarning()
                            .onClick(async () => {
                                this.closeSetting();
                                await this.dbGC();
                            })
                    )
                    .addOnUpdate(onlyOnCouchDB);
            });
            void addPanel(paneEl, "Reset").then((paneEl) => {
                new Setting(paneEl)
                    .setName("Discard local database to reset or uninstall Self-hosted LiveSync")
                    .addButton((button) =>
                        button
                            .setButtonText("Discard")
                            .setWarning()
                            .setDisabled(false)
                            .onClick(async () => {
                                await this.plugin.$$resetLocalDatabase();
                                await this.plugin.$$initializeDatabase();
                            })
                    );
            });
        });
        void yieldNextAnimationFrame().then(() => {
            if (this.selectedScreen == "") {
                if (lastVersion != this.editingSettings.lastReadUpdates) {
                    if (this.editingSettings.isConfigured) {
                        changeDisplay("100");
                    } else {
                        changeDisplay("110");
                    }
                } else {
                    if (isAnySyncEnabled()) {
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

    async dryRunGC() {
        await skipIfDuplicated("cleanup", async () => {
            const replicator = this.plugin.$$getReplicator();
            if (!(replicator instanceof LiveSyncCouchDBReplicator)) return;
            const remoteDBConn = await replicator.connectRemoteCouchDBWithSetting(
                this.plugin.settings,
                this.plugin.$$isMobile()
            );
            if (typeof remoteDBConn == "string") {
                Logger(remoteDBConn);
                return;
            }
            await purgeUnreferencedChunks(remoteDBConn.db, true, this.plugin.settings, false);
            await purgeUnreferencedChunks(this.plugin.localDatabase.localDatabase, true);
            this.plugin.localDatabase.hashCaches.clear();
        });
    }

    async dbGC() {
        // Lock the remote completely once.
        await skipIfDuplicated("cleanup", async () => {
            const replicator = this.plugin.$$getReplicator();
            if (!(replicator instanceof LiveSyncCouchDBReplicator)) return;
            await this.plugin.$$getReplicator().markRemoteLocked(this.plugin.settings, true, true);
            const remoteDBConnection = await replicator.connectRemoteCouchDBWithSetting(
                this.plugin.settings,
                this.plugin.$$isMobile()
            );
            if (typeof remoteDBConnection == "string") {
                Logger(remoteDBConnection);
                return;
            }
            await purgeUnreferencedChunks(remoteDBConnection.db, false, this.plugin.settings, true);
            await purgeUnreferencedChunks(this.plugin.localDatabase.localDatabase, false);
            this.plugin.localDatabase.hashCaches.clear();
            await balanceChunkPurgedDBs(this.plugin.localDatabase.localDatabase, remoteDBConnection.db);
            this.plugin.localDatabase.refreshSettings();
            Logger(
                "The remote database has been cleaned up! Other devices will be cleaned up on the next synchronisation."
            );
        });
    }

    getMinioJournalSyncClient() {
        const id = this.plugin.settings.accessKey;
        const key = this.plugin.settings.secretKey;
        const bucket = this.plugin.settings.bucket;
        const region = this.plugin.settings.region;
        const endpoint = this.plugin.settings.endpoint;
        const useCustomRequestHandler = this.plugin.settings.useCustomRequestHandler;
        return new JournalSyncMinio(
            id,
            key,
            endpoint,
            bucket,
            this.plugin.simpleStore,
            this.plugin,
            useCustomRequestHandler,
            region
        );
    }
    async resetRemoteBucket() {
        const minioJournal = this.getMinioJournalSyncClient();
        await minioJournal.resetBucket();
    }
}
