import { debounce, Notice, Plugin, TFile, addIcon, TFolder, normalizePath, TAbstractFile, Editor, MarkdownView, PluginManifest, Modal, App, FuzzySuggestModal, Setting } from "obsidian";
import { diff_match_patch } from "diff-match-patch";

import { EntryDoc, LoadedEntry, ObsidianLiveSyncSettings, diff_check_result, diff_result_leaf, EntryBody, LOG_LEVEL, VER, DEFAULT_SETTINGS, diff_result, FLAGMD_REDFLAG, SYNCINFO_ID } from "./lib/src/types";
import { PluginDataEntry, PERIODIC_PLUGIN_SWEEP, PluginList, DevicePluginList } from "./types";
import {
    base64ToString,
    arrayBufferToBase64,
    base64ToArrayBuffer,
    isValidPath,
    versionNumberString2Number,
    runWithLock,
    shouldBeIgnored,
    getProcessingCounts,
    setLockNotifier,
    isPlainText,
    setNoticeClass,
    NewNotice,
    allSettledWithConcurrencyLimit,
    getLocks,
} from "./lib/src/utils";
import { Logger, setLogger } from "./lib/src/logger";
import { LocalPouchDB } from "./LocalPouchDB";
import { LogDisplayModal } from "./LogDisplayModal";
import { ConflictResolveModal } from "./ConflictResolveModal";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { DocumentHistoryModal } from "./DocumentHistoryModal";

//@ts-ignore
import PluginPane from "./PluginPane.svelte";
import { id2path, path2id } from "./utils";
import { decrypt, encrypt } from "./lib/src/e2ee";
const isDebug = false;
setNoticeClass(Notice);
class PluginDialogModal extends Modal {
    plugin: ObsidianLiveSyncPlugin;
    logEl: HTMLDivElement;
    component: PluginPane = null;

    constructor(app: App, plugin: ObsidianLiveSyncPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        if (this.component == null) {
            this.component = new PluginPane({
                target: contentEl,
                props: { plugin: this.plugin },
            });
        }
    }

    onClose() {
        if (this.component != null) {
            this.component.$destroy();
            this.component = null;
        }
    }
}

class InputStringDialog extends Modal {
    result: string | false = false;
    onSubmit: (result: string | boolean) => void;
    title: string;
    key: string;
    placeholder: string;
    isManuallyClosed = false;

    constructor(app: App, title: string, key: string, placeholder: string, onSubmit: (result: string | false) => void) {
        super(app);
        this.onSubmit = onSubmit;
        this.title = title;
        this.placeholder = placeholder;
        this.key = key;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h1", { text: this.title });

        new Setting(contentEl).setName(this.key).addText((text) =>
            text.onChange((value) => {
                this.result = value;
            })
        );

        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText("Ok")
                .setCta()
                .onClick(() => {
                    this.isManuallyClosed = true;
                    this.close();
                })
        ).addButton((btn) =>
            btn
                .setButtonText("Cancel")
                .setCta()
                .onClick(() => {
                    this.close();
                })
        );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (this.isManuallyClosed) {
            this.onSubmit(this.result);
        } else {
            this.onSubmit(false);
        }
    }
}
class PopoverYesNo extends FuzzySuggestModal<string> {
    app: App;
    callback: (e: string) => void = () => { };

    constructor(app: App, note: string, callback: (e: string) => void) {
        super(app);
        this.app = app;
        this.setPlaceholder("y/n) " + note);
        this.callback = callback;
    }

    getItems(): string[] {
        return ["yes", "no"];
    }

    getItemText(item: string): string {
        return item;
    }

    onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
        // debugger;
        this.callback(item);
        this.callback = null;
    }
    onClose(): void {
        setTimeout(() => {
            if (this.callback != null) {
                this.callback("");
            }
        }, 100);
    }
}

const askYesNo = (app: App, message: string): Promise<"yes" | "no"> => {
    return new Promise((res) => {
        const popover = new PopoverYesNo(app, message, (result) => res(result as "yes" | "no"));
        popover.open();
    });
};

const askString = (app: App, title: string, key: string, placeholder: string): Promise<string | false> => {
    return new Promise((res) => {
        const dialog = new InputStringDialog(app, title, key, placeholder, (result) => res(result));
        dialog.open();
    });
};

export default class ObsidianLiveSyncPlugin extends Plugin {
    settings: ObsidianLiveSyncSettings;
    localDatabase: LocalPouchDB;
    logMessage: string[] = [];
    statusBar: HTMLElement;
    statusBar2: HTMLElement;
    suspended: boolean;
    deviceAndVaultName: string;
    isMobile = false;

    setInterval(handler: () => any, timeout?: number): number {
        const timer = window.setInterval(handler, timeout);
        this.registerInterval(timer);
        return timer;
    }

    isRedFlagRaised(): boolean {
        const redflag = this.app.vault.getAbstractFileByPath(normalizePath(FLAGMD_REDFLAG));
        if (redflag != null) {
            return true;
        }
        return false;
    }

    showHistory(file: TFile) {
        if (!this.settings.useHistory) {
            Logger("You have to enable Use History in misc.", LOG_LEVEL.NOTICE);
        } else {
            new DocumentHistoryModal(this.app, this, file).open();
        }
    }

    async onload() {
        setLogger(this.addLog.bind(this)); // Logger moved to global.
        Logger("loading plugin");
        const lsname = "obsidian-live-sync-ver" + this.app.vault.getName();
        const last_version = localStorage.getItem(lsname);
        await this.loadSettings();
        //@ts-ignore
        if (this.app.isMobile) {
            this.isMobile = true;
            this.settings.disableRequestURI = true;
        }
        if (last_version && Number(last_version) < VER) {
            this.settings.liveSync = false;
            this.settings.syncOnSave = false;
            this.settings.syncOnStart = false;
            this.settings.syncOnFileOpen = false;
            this.settings.periodicReplication = false;
            this.settings.versionUpFlash = "I changed specifications incompatiblly, so when you enable sync again, be sure to made version up all nother devides.";
            this.saveSettings();
        }
        localStorage.setItem(lsname, `${VER}`);
        await this.openDatabase();

        addIcon(
            "replicate",
            `<g transform="matrix(1.15 0 0 1.15 -8.31 -9.52)" fill="currentColor" fill-rule="evenodd">
            <path d="m85 22.2c-0.799-4.74-4.99-8.37-9.88-8.37-0.499 0-1.1 0.101-1.6 0.101-2.4-3.03-6.09-4.94-10.3-4.94-6.09 0-11.2 4.14-12.8 9.79-5.59 1.11-9.78 6.05-9.78 12 0 6.76 5.39 12.2 12 12.2h29.9c5.79 0 10.1-4.74 10.1-10.6 0-4.84-3.29-8.88-7.68-10.2zm-2.99 14.7h-29.5c-2.3-0.202-4.29-1.51-5.29-3.53-0.899-2.12-0.699-4.54 0.698-6.46 1.2-1.61 2.99-2.52 4.89-2.52 0.299 0 0.698 0 0.998 0.101l1.8 0.303v-2.02c0-3.63 2.4-6.76 5.89-7.57 0.599-0.101 1.2-0.202 1.8-0.202 2.89 0 5.49 1.62 6.79 4.24l0.598 1.21 1.3-0.504c0.599-0.202 1.3-0.303 2-0.303 1.3 0 2.5 0.404 3.59 1.11 1.6 1.21 2.6 3.13 2.6 5.15v1.61h2c2.6 0 4.69 2.12 4.69 4.74-0.099 2.52-2.2 4.64-4.79 4.64z"/>
            <path d="m53.2 49.2h-41.6c-1.8 0-3.2 1.4-3.2 3.2v28.6c0 1.8 1.4 3.2 3.2 3.2h15.8v4h-7v6h24v-6h-7v-4h15.8c1.8 0 3.2-1.4 3.2-3.2v-28.6c0-1.8-1.4-3.2-3.2-3.2zm-2.8 29h-36v-23h36z"/>
            <path d="m73 49.2c1.02 1.29 1.53 2.97 1.53 4.56 0 2.97-1.74 5.65-4.39 7.04v-4.06l-7.46 7.33 7.46 7.14v-4.06c7.66-1.98 12.2-9.61 10-17-0.102-0.297-0.205-0.595-0.307-0.892z"/>
            <path d="m24.1 43c-0.817-0.991-1.53-2.97-1.53-4.56 0-2.97 1.74-5.65 4.39-7.04v4.06l7.46-7.33-7.46-7.14v4.06c-7.66 1.98-12.2 9.61-10 17 0.102 0.297 0.205 0.595 0.307 0.892z"/>
           </g>`
        );
        addIcon(
            "view-log",
            `<g transform="matrix(1.28 0 0 1.28 -131 -411)" fill="currentColor" fill-rule="evenodd">
        <path d="m103 330h76v12h-76z"/>
        <path d="m106 346v44h70v-44zm45 16h-20v-8h20z"/>
       </g>`
        );
        this.addRibbonIcon("replicate", "Replicate", async () => {
            await this.replicate(true);
        });

        this.addRibbonIcon("view-log", "Show log", () => {
            new LogDisplayModal(this.app, this).open();
        });

        this.statusBar = this.addStatusBarItem();
        this.statusBar.addClass("syncstatusbar");
        this.refreshStatusText = this.refreshStatusText.bind(this);

        this.statusBar2 = this.addStatusBarItem();
        // this.watchVaultChange = debounce(this.watchVaultChange.bind(this), delay, false);
        // this.watchVaultDelete = debounce(this.watchVaultDelete.bind(this), delay, false);
        // this.watchVaultRename = debounce(this.watchVaultRename.bind(this), delay, false);

        this.watchVaultChange = this.watchVaultChange.bind(this);
        this.watchVaultCreate = this.watchVaultCreate.bind(this);
        this.watchVaultDelete = this.watchVaultDelete.bind(this);
        this.watchVaultRename = this.watchVaultRename.bind(this);
        this.watchWorkspaceOpen = debounce(this.watchWorkspaceOpen.bind(this), 1000, false);
        this.watchWindowVisiblity = debounce(this.watchWindowVisiblity.bind(this), 1000, false);

        this.parseReplicationResult = this.parseReplicationResult.bind(this);

        this.periodicSync = this.periodicSync.bind(this);
        this.setPeriodicSync = this.setPeriodicSync.bind(this);

        this.getPluginList = this.getPluginList.bind(this);
        // this.registerWatchEvents();
        this.addSettingTab(new ObsidianLiveSyncSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(async () => {
            if (this.localDatabase.isReady)
                try {
                    if (this.isRedFlagRaised()) {
                        this.settings.batchSave = false;
                        this.settings.liveSync = false;
                        this.settings.periodicReplication = false;
                        this.settings.syncOnSave = false;
                        this.settings.syncOnStart = false;
                        this.settings.syncOnFileOpen = false;
                        this.settings.autoSweepPlugins = false;
                        this.settings.usePluginSync = false;
                        this.settings.suspendFileWatching = true;
                        await this.saveSettings();
                        await this.openDatabase();
                        const warningMessage = "The red flag is raised! The whole initialize steps are skipped, and any file changes are not captured.";
                        Logger(warningMessage, LOG_LEVEL.NOTICE);
                        this.setStatusBarText(warningMessage);
                    } else {
                        if (this.settings.suspendFileWatching) {
                            Logger("'Suspend file watching' turned on. Are you sure this is what you intended? Every modification on the vault will be ignored.", LOG_LEVEL.NOTICE);
                        }
                        const isInitalized = await this.initializeDatabase();
                        if (!isInitalized) {
                            //TODO:stop all sync.
                            return false;
                        }
                    }
                    await this.realizeSettingSyncMode();
                    this.registerWatchEvents();
                    if (this.settings.syncOnStart) {
                        this.localDatabase.openReplication(this.settings, false, false, this.parseReplicationResult);
                    }
                } catch (ex) {
                    Logger("Error while loading Self-hosted LiveSync", LOG_LEVEL.NOTICE);
                    Logger(ex, LOG_LEVEL.VERBOSE);
                }
        });
        const configURIBase = "obsidian://setuplivesync?settings=";
        this.addCommand({
            id: "livesync-copysetupuri",
            name: "Copy setup URI (beta)",
            callback: async () => {
                const encryptingPassphrase = await askString(this.app, "Encrypt your settings", "Passphrase", "");
                if (encryptingPassphrase === false) return;
                const encryptedSetting = encodeURIComponent(await encrypt(JSON.stringify(this.settings), encryptingPassphrase));
                const uri = `${configURIBase}${encryptedSetting}`;
                await navigator.clipboard.writeText(uri);
                Logger("Setup URI copied to clipboard", LOG_LEVEL.NOTICE);
            },
        });
        this.addCommand({
            id: "livesync-opensetupuri",
            name: "Open setup URI (beta)",
            callback: async () => {
                const setupURI = await askString(this.app, "Set up manually", "Set up URI", `${configURIBase}aaaaa`);
                if (setupURI === false) return;
                if (!setupURI.startsWith(`${configURIBase}`)) {
                    Logger("Set up URI looks wrong.", LOG_LEVEL.NOTICE);
                    return;
                }
                const config = decodeURIComponent(setupURI.substring(configURIBase.length));
                console.dir(config)
                await setupwizard(config);
            },
        });
        const setupwizard = async (confString: string) => {
            try {
                const oldConf = JSON.parse(JSON.stringify(this.settings));
                const encryptingPassphrase = await askString(this.app, "Passphrase", "Passphrase for your settings", "");
                if (encryptingPassphrase === false) return;
                const newconf = await JSON.parse(await decrypt(confString, encryptingPassphrase));
                if (newconf) {
                    const result = await askYesNo(this.app, "Importing LiveSync's conf, OK?");
                    if (result == "yes") {
                        const newSettingW = Object.assign({}, this.settings, newconf);
                        // stopping once.
                        this.localDatabase.closeReplication();
                        this.settings.suspendFileWatching = true;
                        console.dir(newSettingW);
                        const keepLocalDB = await askYesNo(this.app, "Keep local DB?");
                        const keepRemoteDB = await askYesNo(this.app, "Keep remote DB?");
                        if (keepLocalDB == "yes" && keepRemoteDB == "yes") {
                            // nothing to do. so peaceful.
                            this.settings = newSettingW;
                            await this.saveSettings();
                            const replicate = await askYesNo(this.app, "Unlock and replicate?");
                            if (replicate == "yes") {
                                await this.replicate(true);
                                await this.markRemoteUnlocked();
                            }
                            Logger("Configuration loaded.", LOG_LEVEL.NOTICE);
                            return;
                        }
                        if (keepLocalDB == "no" && keepRemoteDB == "no") {
                            const reset = await askYesNo(this.app, "Drop everything?");
                            if (reset != "yes") {
                                Logger("Cancelled", LOG_LEVEL.NOTICE);
                                this.settings = oldConf;
                                return;
                            }
                        }
                        let initDB;
                        await this.saveSettings();
                        if (keepLocalDB == "no") {
                            this.resetLocalOldDatabase();
                            this.resetLocalDatabase();
                            this.localDatabase.initializeDatabase();
                            const rebuild = await askYesNo(this.app, "Rebuild the database?");
                            if (rebuild == "yes") {
                                initDB = this.initializeDatabase(true);
                            } else {
                                this.markRemoteResolved();
                            }
                        }
                        if (keepRemoteDB == "no") {
                            await this.tryResetRemoteDatabase();
                            await this.markRemoteLocked();
                        }
                        if (keepLocalDB == "no" || keepRemoteDB == "no") {
                            const replicate = await askYesNo(this.app, "Replicate once?");
                            if (replicate == "yes") {
                                if (initDB != null) {
                                    await initDB;
                                }
                                await this.replicate(true);
                            }
                        }
                    }

                    Logger("Configuration loaded.", LOG_LEVEL.NOTICE);
                } else {
                    Logger("Cancelled.", LOG_LEVEL.NOTICE);
                }
            } catch (ex) {
                Logger("Couldn't parse or decrypt configuration uri.", LOG_LEVEL.NOTICE);
            }
        };
        this.registerObsidianProtocolHandler("setuplivesync", async (conf: any) => {
            await setupwizard(conf.settings);
        });
        this.addCommand({
            id: "livesync-replicate",
            name: "Replicate now",
            callback: async () => {
                await this.replicate();
            },
        });
        this.addCommand({
            id: "livesync-dump",
            name: "Dump informations of this doc ",
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.localDatabase.getDBEntry(view.file.path, {}, true, false);
            },
        });
        this.addCommand({
            id: "livesync-checkdoc-conflicted",
            name: "Resolve if conflicted.",
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                await this.showIfConflicted(view.file);
            },
        });
        this.addCommand({
            id: "livesync-gc",
            name: "garbage collect now",
            callback: () => {
                this.garbageCollect();
            },
        });
        this.addCommand({
            id: "livesync-toggle",
            name: "Toggle LiveSync",
            callback: async () => {
                if (this.settings.liveSync) {
                    this.settings.liveSync = false;
                    Logger("LiveSync Disabled.", LOG_LEVEL.NOTICE);
                } else {
                    this.settings.liveSync = true;
                    Logger("LiveSync Enabled.", LOG_LEVEL.NOTICE);
                }
                await this.realizeSettingSyncMode();
                this.saveSettings();
            },
        });
        this.addCommand({
            id: "livesync-suspendall",
            name: "Toggle All Sync.",
            callback: async () => {
                if (this.suspended) {
                    this.suspended = false;
                    Logger("Self-hosted LiveSync resumed", LOG_LEVEL.NOTICE);
                } else {
                    this.suspended = true;
                    Logger("Self-hosted LiveSync suspended", LOG_LEVEL.NOTICE);
                }
                await this.realizeSettingSyncMode();
                this.saveSettings();
            },
        });
        this.addCommand({
            id: "livesync-history",
            name: "Show history",
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.showHistory(view.file);
            },
        });
        this.triggerRealizeSettingSyncMode = debounce(this.triggerRealizeSettingSyncMode.bind(this), 1000);
        this.triggerCheckPluginUpdate = debounce(this.triggerCheckPluginUpdate.bind(this), 3000);
        setLockNotifier(() => {
            this.refreshStatusText();
        });
        this.addCommand({
            id: "livesync-plugin-dialog",
            name: "Show Plugins and their settings",
            callback: () => {
                this.showPluginSyncModal();
            },
        });
    }

    pluginDialog: PluginDialogModal = null;

    showPluginSyncModal() {
        if (this.pluginDialog != null) {
            this.pluginDialog.open();
        } else {
            this.pluginDialog = new PluginDialogModal(this.app, this);
            this.pluginDialog.open();
        }
    }

    hidePluginSyncModal() {
        if (this.pluginDialog != null) {
            this.pluginDialog.close();
            this.pluginDialog = null;
        }
    }

    onunload() {
        this.hidePluginSyncModal();
        if (this.localDatabase != null) {
            this.localDatabase.onunload();
        }
        if (this.gcTimerHandler != null) {
            clearTimeout(this.gcTimerHandler);
            this.gcTimerHandler = null;
        }
        this.clearPeriodicSync();
        this.clearPluginSweep();
        if (this.localDatabase != null) {
            this.localDatabase.closeReplication();
            this.localDatabase.close();
        }
        window.removeEventListener("visibilitychange", this.watchWindowVisiblity);
        Logger("unloading plugin");
    }

    async openDatabase() {
        if (this.localDatabase != null) {
            this.localDatabase.close();
        }
        const vaultName = this.app.vault.getName();
        Logger("Open Database...");
        //@ts-ignore
        const isMobile = this.app.isMobile;
        this.localDatabase = new LocalPouchDB(this.settings, vaultName, isMobile);
        this.localDatabase.updateInfo = () => {
            this.refreshStatusText();
        };
        return await this.localDatabase.initializeDatabase();
    }

    async garbageCollect() {
        await this.localDatabase.garbageCollect();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.settings.workingEncrypt = this.settings.encrypt;
        this.settings.workingPassphrase = this.settings.passphrase;
        // Delete this feature to avoid problems on mobile.
        this.settings.disableRequestURI = true;
        // Temporary disabled
        // TODO: If a new GC is created, a new default value must be created.
        this.settings.gcDelay = 0;

        const lsname = "obsidian-live-sync-vaultanddevicename-" + this.app.vault.getName();
        if (this.settings.deviceAndVaultName != "") {
            if (!localStorage.getItem(lsname)) {
                this.deviceAndVaultName = this.settings.deviceAndVaultName;
                localStorage.setItem(lsname, this.deviceAndVaultName);
                this.settings.deviceAndVaultName = "";
            }
        }
        this.deviceAndVaultName = localStorage.getItem(lsname) || "";
    }

    triggerRealizeSettingSyncMode() {
        (async () => await this.realizeSettingSyncMode())();
    }

    async saveSettings() {
        const lsname = "obsidian-live-sync-vaultanddevicename-" + this.app.vault.getName();

        localStorage.setItem(lsname, this.deviceAndVaultName || "");
        await this.saveData(this.settings);
        this.localDatabase.settings = this.settings;
        this.triggerRealizeSettingSyncMode();
    }

    gcTimerHandler: any = null;

    gcHook() {
        if (this.settings.gcDelay == 0) return;
        if (this.settings.useHistory) return;
        const GC_DELAY = this.settings.gcDelay * 1000; // if leaving opening window, try GC,
        if (this.gcTimerHandler != null) {
            clearTimeout(this.gcTimerHandler);
            this.gcTimerHandler = null;
        }
        this.gcTimerHandler = setTimeout(() => {
            this.gcTimerHandler = null;
            this.garbageCollect();
        }, GC_DELAY);
    }

    registerWatchEvents() {
        this.registerEvent(this.app.vault.on("modify", this.watchVaultChange));
        this.registerEvent(this.app.vault.on("delete", this.watchVaultDelete));
        this.registerEvent(this.app.vault.on("rename", this.watchVaultRename));
        this.registerEvent(this.app.vault.on("create", this.watchVaultCreate));
        this.registerEvent(this.app.workspace.on("file-open", this.watchWorkspaceOpen));
        window.addEventListener("visibilitychange", this.watchWindowVisiblity);
    }

    watchWindowVisiblity() {
        this.watchWindowVisiblityAsync();
    }

    async watchWindowVisiblityAsync() {
        if (this.settings.suspendFileWatching) return;
        // if (this.suspended) return;
        const isHidden = document.hidden;
        await this.applyBatchChange();
        if (isHidden) {
            this.localDatabase.closeReplication();
            this.clearPeriodicSync();
        } else {
            // suspend all temporary.
            if (this.suspended) return;
            if (this.settings.autoSweepPlugins) {
                await this.sweepPlugin(false);
            }
            if (this.settings.liveSync) {
                this.localDatabase.openReplication(this.settings, true, false, this.parseReplicationResult);
            }
            if (this.settings.syncOnStart) {
                this.localDatabase.openReplication(this.settings, false, false, this.parseReplicationResult);
            }
            if (this.settings.periodicReplication) {
                this.setPeriodicSync();
            }
        }
        this.gcHook();
    }

    watchWorkspaceOpen(file: TFile) {
        if (this.settings.suspendFileWatching) return;
        this.watchWorkspaceOpenAsync(file);
    }

    async watchWorkspaceOpenAsync(file: TFile) {
        await this.applyBatchChange();
        if (file == null) {
            return;
        }
        if (this.settings.syncOnFileOpen && !this.suspended) {
            await this.replicate();
        }
        await this.showIfConflicted(file);
        this.gcHook();
    }

    watchVaultCreate(file: TFile, ...args: any[]) {
        if (this.settings.suspendFileWatching) return;
        this.watchVaultChangeAsync(file, ...args);
    }

    watchVaultChange(file: TAbstractFile, ...args: any[]) {
        if (!(file instanceof TFile)) {
            return;
        }
        if (this.settings.suspendFileWatching) return;

        // If batchsave is enabled, queue all changes and do nothing.
        if (this.settings.batchSave) {
            ~(async () => {
                const meta = await this.localDatabase.getDBEntryMeta(file.path);
                if (meta != false) {
                    const localMtime = ~~(file.stat.mtime / 1000);
                    const docMtime = ~~(meta.mtime / 1000);
                    if (localMtime !== docMtime) {
                        // Perhaps we have to modify (to using newer doc), but we don't be sure to every device's clock is adjusted.
                        this.batchFileChange = Array.from(new Set([...this.batchFileChange, file.path]));
                        this.refreshStatusText();
                    }
                }
            })();
            return;
        }
        this.watchVaultChangeAsync(file, ...args);
    }

    async applyBatchChange() {
        if (!this.settings.batchSave || this.batchFileChange.length == 0) {
            return;
        }
        return await runWithLock("batchSave", false, async () => {
            const batchItems = JSON.parse(JSON.stringify(this.batchFileChange)) as string[];
            this.batchFileChange = [];
            const promises = batchItems.map(async (e) => {
                try {
                    const f = this.app.vault.getAbstractFileByPath(normalizePath(e));
                    if (f && f instanceof TFile) {
                        await this.updateIntoDB(f);
                        Logger(`Batch save:${e}`);
                    }
                } catch (ex) {
                    Logger(`Batch save error:${e}`, LOG_LEVEL.NOTICE);
                    Logger(ex, LOG_LEVEL.VERBOSE);
                }
            });
            this.refreshStatusText();
            await allSettledWithConcurrencyLimit(promises, 3);
            return;
        });
    }

    batchFileChange: string[] = [];

    async watchVaultChangeAsync(file: TFile, ...args: any[]) {
        if (file instanceof TFile) {
            await this.updateIntoDB(file);
            this.gcHook();
        }
    }

    watchVaultDelete(file: TAbstractFile) {
        // When save is delayed, it should be cancelled.
        this.batchFileChange = this.batchFileChange.filter((e) => e == file.path);
        if (this.settings.suspendFileWatching) return;
        this.watchVaultDeleteAsync(file).then(() => { });
    }

    async watchVaultDeleteAsync(file: TAbstractFile) {
        if (file instanceof TFile) {
            await this.deleteFromDB(file);
        } else if (file instanceof TFolder) {
            await this.deleteFolderOnDB(file);
        }
        this.gcHook();
    }

    GetAllFilesRecursively(file: TAbstractFile): TFile[] {
        if (file instanceof TFile) {
            return [file];
        } else if (file instanceof TFolder) {
            const result: TFile[] = [];
            for (const v of file.children) {
                result.push(...this.GetAllFilesRecursively(v));
            }
            return result;
        } else {
            Logger(`Filetype error:${file.path}`, LOG_LEVEL.NOTICE);
            throw new Error(`Filetype error:${file.path}`);
        }
    }

    watchVaultRename(file: TAbstractFile, oldFile: any) {
        if (this.settings.suspendFileWatching) return;
        this.watchVaultRenameAsync(file, oldFile).then(() => { });
    }

    getFilePath(file: TAbstractFile): string {
        if (file instanceof TFolder) {
            if (file.isRoot()) return "";
            return this.getFilePath(file.parent) + "/" + file.name;
        }
        if (file instanceof TFile) {
            return this.getFilePath(file.parent) + "/" + file.name;
        }

        return this.getFilePath(file.parent) + "/" + file.name;
    }

    async watchVaultRenameAsync(file: TAbstractFile, oldFile: any) {
        Logger(`${oldFile} renamed to ${file.path}`, LOG_LEVEL.VERBOSE);
        try {
            await this.applyBatchChange();
        } catch (ex) {
            Logger(ex);
        }
        if (file instanceof TFolder) {
            const newFiles = this.GetAllFilesRecursively(file);
            // for guard edge cases. this won't happen and each file's event will be raise.
            for (const i of newFiles) {
                try {
                    const newFilePath = normalizePath(this.getFilePath(i));
                    const newFile = this.app.vault.getAbstractFileByPath(newFilePath);
                    if (newFile instanceof TFile) {
                        Logger(`save ${newFile.path} into db`);
                        await this.updateIntoDB(newFile);
                    }
                } catch (ex) {
                    Logger(ex);
                }
            }
            Logger(`delete below ${oldFile} from db`);
            await this.deleteFromDBbyPath(oldFile);
        } else if (file instanceof TFile) {
            try {
                Logger(`file save ${file.path} into db`);
                await this.updateIntoDB(file);
                Logger(`deleted ${oldFile} into db`);
                await this.deleteFromDBbyPath(oldFile);
            } catch (ex) {
                Logger(ex);
            }
        }
        this.gcHook();
    }

    addLogHook: () => void = null;
    //--> Basic document Functions
    notifies: { [key: string]: { notice: Notice; timer: NodeJS.Timeout; count: number } } = {};

    lastLog = "";
    // eslint-disable-next-line require-await
    async addLog(message: any, level: LOG_LEVEL = LOG_LEVEL.INFO) {
        if (level == LOG_LEVEL.DEBUG && !isDebug) {
            return;
        }
        if (level < LOG_LEVEL.INFO && this.settings && this.settings.lessInformationInLog) {
            return;
        }
        if (this.settings && !this.settings.showVerboseLog && level == LOG_LEVEL.VERBOSE) {
            return;
        }
        const valutName = this.app.vault.getName();
        const timestamp = new Date().toLocaleString();
        const messagecontent = typeof message == "string" ? message : message instanceof Error ? `${message.name}:${message.message}` : JSON.stringify(message, null, 2);
        const newmessage = timestamp + "->" + messagecontent;

        this.logMessage = [].concat(this.logMessage).concat([newmessage]).slice(-100);
        console.log(valutName + ":" + newmessage);
        this.setStatusBarText(null, messagecontent.substring(0, 30));
        // if (message instanceof Error) {
        //     console.trace(message);
        // }

        if (level >= LOG_LEVEL.NOTICE) {
            if (messagecontent in this.notifies) {
                clearTimeout(this.notifies[messagecontent].timer);
                this.notifies[messagecontent].count++;
                this.notifies[messagecontent].notice.setMessage(`(${this.notifies[messagecontent].count}):${messagecontent}`);
                this.notifies[messagecontent].timer = setTimeout(() => {
                    const notify = this.notifies[messagecontent].notice;
                    delete this.notifies[messagecontent];
                    try {
                        notify.hide();
                    } catch (ex) {
                        // NO OP
                    }
                }, 5000);
            } else {
                const notify = new Notice(messagecontent, 0);
                this.notifies[messagecontent] = {
                    count: 0,
                    notice: notify,
                    timer: setTimeout(() => {
                        delete this.notifies[messagecontent];
                        notify.hide();
                    }, 5000),
                };
            }
        }
        if (this.addLogHook != null) this.addLogHook();
    }

    async ensureDirectory(fullpath: string) {
        const pathElements = fullpath.split("/");
        pathElements.pop();
        let c = "";
        for (const v of pathElements) {
            c += v;
            try {
                await this.app.vault.createFolder(c);
            } catch (ex) {
                // basically skip exceptions.
                if (ex.message && ex.message == "Folder already exists.") {
                    // especialy this message is.
                } else {
                    Logger("Folder Create Error");
                    Logger(ex);
                }
            }
            c += "/";
        }
    }

    async doc2storage_create(docEntry: EntryBody, force?: boolean) {
        const pathSrc = id2path(docEntry._id);
        if (shouldBeIgnored(pathSrc)) {
            return;
        }
        const doc = await this.localDatabase.getDBEntry(pathSrc, { rev: docEntry._rev });
        if (doc === false) return;
        const path = id2path(doc._id);
        if (doc.datatype == "newnote") {
            const bin = base64ToArrayBuffer(doc.data);
            if (bin != null) {
                if (!isValidPath(path)) {
                    Logger(`The file that having platform dependent name has been arrived. This file has skipped: ${path}`, LOG_LEVEL.NOTICE);
                    return;
                }
                await this.ensureDirectory(path);
                try {
                    const newfile = await this.app.vault.createBinary(normalizePath(path), bin, {
                        ctime: doc.ctime,
                        mtime: doc.mtime,
                    });
                    Logger("live : write to local (newfile:b) " + path);
                    this.app.vault.trigger("create", newfile);
                } catch (ex) {
                    Logger("could not write to local (newfile:bin) " + path, LOG_LEVEL.NOTICE);
                    Logger(ex, LOG_LEVEL.VERBOSE);
                }
            }
        } else if (doc.datatype == "plain") {
            if (!isValidPath(path)) {
                Logger(`The file that having platform dependent name has been arrived. This file has skipped: ${path}`, LOG_LEVEL.NOTICE);
                return;
            }
            await this.ensureDirectory(path);
            try {
                const newfile = await this.app.vault.create(normalizePath(path), doc.data, {
                    ctime: doc.ctime,
                    mtime: doc.mtime,
                });
                Logger("live : write to local (newfile:p) " + path);
                this.app.vault.trigger("create", newfile);
            } catch (ex) {
                Logger("could not write to local (newfile:plain) " + path, LOG_LEVEL.NOTICE);
                Logger(ex, LOG_LEVEL.VERBOSE);
            }
        } else {
            Logger("live : New data imcoming, but we cound't parse that." + doc.datatype, LOG_LEVEL.NOTICE);
        }
    }

    async deleteVaultItem(file: TFile | TFolder) {
        const dir = file.parent;
        if (this.settings.trashInsteadDelete) {
            await this.app.vault.trash(file, false);
        } else {
            await this.app.vault.delete(file);
        }
        Logger(`deleted:${file.path}`);
        Logger(`other items:${dir.children.length}`);
        if (dir.children.length == 0) {
            if (!this.settings.doNotDeleteFolder) {
                Logger(`all files deleted by replication, so delete dir`);
                await this.deleteVaultItem(dir);
            }
        }
    }

    async doc2storage_modify(docEntry: EntryBody, file: TFile, force?: boolean) {
        const pathSrc = id2path(docEntry._id);
        if (shouldBeIgnored(pathSrc)) {
            return;
        }
        if (docEntry._deleted) {
            //basically pass.
            //but if there are no docs left, delete file.
            const lastDocs = await this.localDatabase.getDBEntry(pathSrc);
            if (lastDocs === false) {
                await this.deleteVaultItem(file);
            } else {
                // it perhaps delete some revisions.
                // may be we have to reload this
                await this.pullFile(pathSrc, null, true);
                Logger(`delete skipped:${lastDocs._id}`);
            }
            return;
        }
        const localMtime = ~~(file.stat.mtime / 1000);
        const docMtime = ~~(docEntry.mtime / 1000);
        if (localMtime < docMtime || force) {
            const doc = await this.localDatabase.getDBEntry(pathSrc);
            let msg = "livesync : newer local files so write to local:" + file.path;
            if (force) msg = "livesync : force write to local:" + file.path;
            if (doc === false) return;
            const path = id2path(doc._id);
            if (doc.datatype == "newnote") {
                const bin = base64ToArrayBuffer(doc.data);
                if (bin != null) {
                    if (!isValidPath(path)) {
                        Logger(`The file that having platform dependent name has been arrived. This file has skipped: ${path}`, LOG_LEVEL.NOTICE);
                        return;
                    }
                    await this.ensureDirectory(path);
                    try {
                        await this.app.vault.modifyBinary(file, bin, { ctime: doc.ctime, mtime: doc.mtime });
                        Logger(msg);
                        this.app.vault.trigger("modify", file);
                    } catch (ex) {
                        Logger("could not write to local (modify:bin) " + path, LOG_LEVEL.NOTICE);
                    }
                }
            } else if (doc.datatype == "plain") {
                if (!isValidPath(path)) {
                    Logger(`The file that having platform dependent name has been arrived. This file has skipped: ${path}`, LOG_LEVEL.NOTICE);
                    return;
                }
                await this.ensureDirectory(path);
                try {
                    await this.app.vault.modify(file, doc.data, { ctime: doc.ctime, mtime: doc.mtime });
                    Logger(msg);
                    this.app.vault.trigger("modify", file);
                } catch (ex) {
                    Logger("could not write to local (modify:plain) " + path, LOG_LEVEL.NOTICE);
                }
            } else {
                Logger("live : New data imcoming, but we cound't parse that.:" + doc.datatype + "-", LOG_LEVEL.NOTICE);
            }
        } else if (localMtime > docMtime) {
            // newer local file.
            // ?
        } else {
            //Nothing have to op.
            //eq.case
        }
    }

    async handleDBChanged(change: EntryBody) {
        const targetFile = this.app.vault.getAbstractFileByPath(id2path(change._id));
        if (targetFile == null) {
            if (change._deleted) {
                return;
            }
            const doc = change;
            await this.doc2storage_create(doc);
        } else if (targetFile instanceof TFile) {
            const doc = change;
            const file = targetFile;
            await this.doc2storage_modify(doc, file);
            if (!this.settings.checkConflictOnlyOnOpen) {
                this.queueConflictedCheck(file);
            } else {
                const af = app.workspace.getActiveFile();
                if (af && af.path == file.path) {
                    this.queueConflictedCheck(file);
                }
            }
        } else {
            Logger(`${id2path(change._id)} is already exist as the folder`);
        }
    }

    queuedFiles: {
        entry: EntryBody;
        missingChildren: string[];
        timeout?: number;
        done?: boolean;
        warned?: boolean;
    }[] = [];
    chunkWaitTimeout = 60000;

    async saveQueuedFiles() {
        const saveData = JSON.stringify(this.queuedFiles.filter((e) => !e.done).map((e) => e.entry._id));
        const lsname = "obsidian-livesync-queuefiles-" + this.app.vault.getName();
        localStorage.setItem(lsname, saveData);
    }
    async loadQueuedFiles() {
        const lsname = "obsidian-livesync-queuefiles-" + this.app.vault.getName();
        const ids = JSON.parse(localStorage.getItem(lsname) || "[]") as string[];
        const ret = await this.localDatabase.localDatabase.allDocs({ keys: ids, include_docs: true });
        for (const doc of ret.rows) {
            if (doc.doc && !this.queuedFiles.some((e) => e.entry._id == doc.doc._id)) {
                await this.parseIncomingDoc(doc.doc as PouchDB.Core.ExistingDocument<EntryBody & PouchDB.Core.AllDocsMeta>);
            }
        }
    }
    async procQueuedFiles() {
        await runWithLock("procQueue", false, async () => {
            this.saveQueuedFiles();
            for (const queue of this.queuedFiles) {
                if (queue.done) continue;
                const now = new Date().getTime();
                if (queue.missingChildren.length == 0) {
                    queue.done = true;
                    if (isValidPath(id2path(queue.entry._id))) {
                        Logger(`Applying ${queue.entry._id} (${queue.entry._rev}) change...`);
                        await this.handleDBChanged(queue.entry);
                    }
                } else if (now > queue.timeout) {
                    if (!queue.warned) Logger(`Timed out: ${queue.entry._id} could not collect ${queue.missingChildren.length} chunks. plugin keeps watching, but you have to check the file after the replication.`, LOG_LEVEL.NOTICE);
                    queue.warned = true;
                    continue;
                }
            }
            this.queuedFiles = this.queuedFiles.filter((e) => !e.done);
            this.saveQueuedFiles();
        });
    }
    parseIncomingChunk(chunk: PouchDB.Core.ExistingDocument<EntryDoc>) {
        const now = new Date().getTime();
        let isNewFileCompleted = false;

        for (const queue of this.queuedFiles) {
            if (queue.done) continue;
            if (queue.missingChildren.indexOf(chunk._id) !== -1) {
                queue.missingChildren = queue.missingChildren.filter((e) => e != chunk._id);
                queue.timeout = now + this.chunkWaitTimeout;
            }
            if (queue.missingChildren.length == 0) {
                for (const e of this.queuedFiles) {
                    if (e.entry._id == queue.entry._id && e.entry.mtime < queue.entry.mtime) {
                        e.done = true;
                    }
                }
                isNewFileCompleted = true;
            }
        }
        if (isNewFileCompleted) this.procQueuedFiles();
    }
    async parseIncomingDoc(doc: PouchDB.Core.ExistingDocument<EntryBody>) {
        const skipOldFile = this.settings.skipOlderFilesOnSync && false; //patched temporary.
        if (skipOldFile) {
            const info = this.app.vault.getAbstractFileByPath(id2path(doc._id));

            if (info && info instanceof TFile) {
                const localMtime = ~~((info as TFile).stat.mtime / 1000);
                const docMtime = ~~(doc.mtime / 1000);
                //TODO: some margin required.
                if (localMtime >= docMtime) {
                    Logger(`${doc._id} Skipped, older than storage.`, LOG_LEVEL.VERBOSE);
                    return;
                }
            }
        }
        const now = new Date().getTime();
        const newQueue = {
            entry: doc,
            missingChildren: [] as string[],
            timeout: now + this.chunkWaitTimeout,
        };
        if ("children" in doc) {
            const c = await this.localDatabase.localDatabase.allDocs({ keys: doc.children, include_docs: false });
            const missing = c.rows.filter((e) => "error" in e).map((e) => e.key);
            Logger(`${doc._id}(${doc._rev}) Queued (waiting ${missing.length} items)`, LOG_LEVEL.VERBOSE);
            newQueue.missingChildren = missing;
            this.queuedFiles.push(newQueue);
        } else {
            this.queuedFiles.push(newQueue);
        }
        this.saveQueuedFiles();
        this.procQueuedFiles();
    }
    periodicSyncHandler: number = null;

    //---> Sync
    async parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): Promise<void> {
        this.refreshStatusText();
        for (const change of docs) {
            if (change._id.startsWith("ps:")) {
                if (this.settings.notifyPluginOrSettingUpdated) {
                    this.triggerCheckPluginUpdate();
                }
                continue;
            }
            if (change._id.startsWith("h:")) {
                await this.parseIncomingChunk(change);
                continue;
            }
            if (change._id == SYNCINFO_ID) {
                continue;
            }
            if (change.type != "leaf" && change.type != "versioninfo" && change.type != "milestoneinfo" && change.type != "nodeinfo") {
                await this.parseIncomingDoc(change);
                continue;
            }
            if (change.type == "versioninfo") {
                if (change.version > VER) {
                    this.localDatabase.closeReplication();
                    Logger(`Remote database updated to incompatible version. update your self-hosted-livesync plugin.`, LOG_LEVEL.NOTICE);
                }
            }
            this.gcHook();
        }
    }

    triggerCheckPluginUpdate() {
        (async () => await this.checkPluginUpdate())();
    }

    async checkPluginUpdate() {
        if (!this.settings.usePluginSync) return;
        await this.sweepPlugin(false);
        const { allPlugins, thisDevicePlugins } = await this.getPluginList();
        const arrPlugins = Object.values(allPlugins);
        let updateFound = false;
        for (const plugin of arrPlugins) {
            const ownPlugin = thisDevicePlugins[plugin.manifest.id];
            if (ownPlugin) {
                const remoteVersion = versionNumberString2Number(plugin.manifest.version);
                const ownVersion = versionNumberString2Number(ownPlugin.manifest.version);
                if (remoteVersion > ownVersion) {
                    updateFound = true;
                }
                if (((plugin.mtime / 1000) | 0) > ((ownPlugin.mtime / 1000) | 0) && (plugin.dataJson ?? "") != (ownPlugin.dataJson ?? "")) {
                    updateFound = true;
                }
            }
        }
        if (updateFound) {
            const fragment = createFragment((doc) => {
                doc.createEl("a", null, (a) => {
                    a.text = "There're some new plugins or their settings";
                    a.addEventListener("click", () => this.showPluginSyncModal());
                });
            });
            NewNotice(fragment, 10000);
        } else {
            Logger("Everything is up to date.", LOG_LEVEL.NOTICE);
        }
    }

    clearPeriodicSync() {
        if (this.periodicSyncHandler != null) {
            clearInterval(this.periodicSyncHandler);
            this.periodicSyncHandler = null;
        }
    }

    setPeriodicSync() {
        if (this.settings.periodicReplication && this.settings.periodicReplicationInterval > 0) {
            this.clearPeriodicSync();
            this.periodicSyncHandler = this.setInterval(async () => await this.periodicSync(), Math.max(this.settings.periodicReplicationInterval, 30) * 1000);
        }
    }

    async periodicSync() {
        await this.replicate();
    }

    periodicPluginSweepHandler: number = null;

    clearPluginSweep() {
        if (this.periodicPluginSweepHandler != null) {
            clearInterval(this.periodicPluginSweepHandler);
            this.periodicPluginSweepHandler = null;
        }
    }

    setPluginSweep() {
        if (this.settings.autoSweepPluginsPeriodic) {
            this.clearPluginSweep();
            this.periodicPluginSweepHandler = this.setInterval(async () => await this.periodicPluginSweep(), PERIODIC_PLUGIN_SWEEP * 1000);
        }
    }

    async periodicPluginSweep() {
        await this.sweepPlugin(false);
    }

    async realizeSettingSyncMode() {
        this.localDatabase.closeReplication();
        this.clearPeriodicSync();
        this.clearPluginSweep();
        await this.applyBatchChange();
        // disable all sync temporary.
        if (this.suspended) return;
        if (this.settings.autoSweepPlugins) {
            await this.sweepPlugin(false);
        }
        if (this.settings.liveSync) {
            this.localDatabase.openReplication(this.settings, true, false, this.parseReplicationResult);
            this.refreshStatusText();
        }
        this.setPeriodicSync();
        this.setPluginSweep();
    }

    lastMessage = "";

    refreshStatusText() {
        const sent = this.localDatabase.docSent;
        const arrived = this.localDatabase.docArrived;
        let w = "";
        switch (this.localDatabase.syncStatus) {
            case "CLOSED":
            case "COMPLETED":
            case "NOT_CONNECTED":
                w = "⏹";
                break;
            case "STARTED":
                w = "🌀";
                break;
            case "PAUSED":
                w = "💤";
                break;
            case "CONNECTED":
                w = "⚡";
                break;
            case "ERRORED":
                w = "⚠";
                break;
            default:
                w = "?";
        }
        this.statusBar.title = this.localDatabase.syncStatus;
        let waiting = "";
        if (this.settings.batchSave) {
            waiting = " " + this.batchFileChange.map((e) => "🛫").join("");
            waiting = waiting.replace(/(🛫){10}/g, "🚀");
        }
        let queued = "";
        const queue = Object.entries(this.queuedFiles).filter((e) => !e[1].warned);
        const queuedCount = queue.length;

        if (queuedCount) {
            const pieces = queue.map((e) => e[1].missingChildren).reduce((prev, cur) => prev + cur.length, 0);
            queued = ` 🧩 ${queuedCount} (${pieces})`;
        }
        const procs = getProcessingCounts();
        const procsDisp = procs == 0 ? "" : ` ⏳${procs}`;
        const message = `Sync:${w} ↑${sent} ↓${arrived}${waiting}${procsDisp}${queued}`;
        const locks = getLocks();
        const pendingTask = locks.pending.length
            ? "\nPending: " +
            Object.entries(locks.pending.reduce((p, c) => ({ ...p, [c]: (p[c] ?? 0) + 1 }), {} as { [key: string]: number }))
                .map((e) => `${e[0]}${e[1] == 1 ? "" : `(${e[1]})`}`)
                .join(", ")
            : "";

        const runningTask = locks.running.length
            ? "\nRunning: " +
            Object.entries(locks.running.reduce((p, c) => ({ ...p, [c]: (p[c] ?? 0) + 1 }), {} as { [key: string]: number }))
                .map((e) => `${e[0]}${e[1] == 1 ? "" : `(${e[1]})`}`)
                .join(", ")
            : "";
        this.setStatusBarText(message + pendingTask + runningTask);
    }

    logHideTimer: NodeJS.Timeout = null;
    setStatusBarText(message: string = null, log: string = null) {
        if (!this.statusBar) return;
        const newMsg = typeof message == "string" ? message : this.lastMessage;
        const newLog = typeof log == "string" ? log : this.lastLog;
        if (`${this.lastMessage}-${this.lastLog}` != `${newMsg}-${newLog}`) {
            this.statusBar.setText(newMsg.split("\n")[0]);

            if (this.settings.showStatusOnEditor) {
                const root = document.documentElement;
                root.style.setProperty("--slsmessage", '"' + (newMsg + "\n" + newLog).split("\n").join("\\a ") + '"');
            } else {
                const root = document.documentElement;
                root.style.setProperty("--slsmessage", '""');
            }
            if (this.logHideTimer != null) {
                clearTimeout(this.logHideTimer);
            }
            this.logHideTimer = setTimeout(() => this.setStatusBarText(null, ""), 3000);
            this.lastMessage = newMsg;
            this.lastLog = newLog;
        }
    }
    updateStatusBarText() { }

    async replicate(showMessage?: boolean) {
        if (this.settings.versionUpFlash != "") {
            NewNotice("Open settings and check message, please.");
            return;
        }
        await this.applyBatchChange();
        if (this.settings.autoSweepPlugins) {
            await this.sweepPlugin(false);
        }
        await this.loadQueuedFiles();
        this.localDatabase.openReplication(this.settings, false, showMessage, this.parseReplicationResult);
    }

    async initializeDatabase(showingNotice?: boolean) {
        if (await this.openDatabase()) {
            if (this.localDatabase.isReady) {
                await this.syncAllFiles(showingNotice);
            }
            return true;
        } else {
            return false;
        }
    }

    async replicateAllToServer(showingNotice?: boolean) {
        if (this.settings.autoSweepPlugins) {
            await this.sweepPlugin(showingNotice);
        }
        return await this.localDatabase.replicateAllToServer(this.settings, showingNotice);
    }

    async markRemoteLocked() {
        return await this.localDatabase.markRemoteLocked(this.settings, true);
    }

    async markRemoteUnlocked() {
        return await this.localDatabase.markRemoteLocked(this.settings, false);
    }

    async markRemoteResolved() {
        return await this.localDatabase.markRemoteResolved(this.settings);
    }

    async syncAllFiles(showingNotice?: boolean) {
        // synchronize all files between database and storage.
        let notice: Notice = null;
        if (showingNotice) {
            notice = NewNotice("Initializing", 0);
        }

        const filesStorage = this.app.vault.getFiles();
        const filesStorageName = filesStorage.map((e) => e.path);
        const wf = await this.localDatabase.localDatabase.allDocs();
        const filesDatabase = wf.rows.filter((e) => !e.id.startsWith("h:") && !e.id.startsWith("ps:") && e.id != "obsydian_livesync_version").map((e) => id2path(e.id));

        const onlyInStorage = filesStorage.filter((e) => filesDatabase.indexOf(e.path) == -1);
        const onlyInDatabase = filesDatabase.filter((e) => filesStorageName.indexOf(e) == -1);

        const onlyInStorageNames = onlyInStorage.map((e) => e.path);

        const syncFiles = filesStorage.filter((e) => onlyInStorageNames.indexOf(e.path) == -1);
        Logger("Initialize and checking database files");
        Logger("Updating database by new files");
        this.setStatusBarText(`UPDATE DATABASE`);

        const runAll = async <T>(procedurename: string, objects: T[], callback: (arg: T) => Promise<void>) => {
            const count = objects.length;
            Logger(procedurename);
            let i = 0;
            // let lastTicks = performance.now() + 2000;
            let workProcs = 0;
            const procs = objects.map(async (e) => {
                try {
                    workProcs++;
                    await callback(e);
                    i++;
                    if (i % 25 == 0) {
                        const notify = `${procedurename} : ${workProcs}/${count} (Pending:${workProcs})`;
                        if (notice != null) notice.setMessage(notify);
                        Logger(notify);
                        this.setStatusBarText(notify);
                    }
                } catch (ex) {
                    Logger(`Error while ${procedurename}`, LOG_LEVEL.NOTICE);
                    Logger(ex);
                } finally {
                    workProcs--;
                }
            });

            await allSettledWithConcurrencyLimit(procs, 10);
            Logger(`${procedurename} done.`);
        };
        await runAll("UPDATE DATABASE", onlyInStorage, async (e) => {
            Logger(`Update into ${e.path}`);
            await this.updateIntoDB(e);
        });
        await runAll("UPDATE STORAGE", onlyInDatabase, async (e) => {
            Logger(`Pull from db:${e}`);
            await this.pullFile(e, filesStorage, false, null, false);
        });
        await runAll("CHECK FILE STATUS", syncFiles, async (e) => {
            await this.syncFileBetweenDBandStorage(e, filesStorage);
        });
        this.setStatusBarText(`NOW TRACKING!`);
        Logger("Initialized,NOW TRACKING!");
        if (showingNotice) {
            notice.hide();
            Logger("Initialize done!", LOG_LEVEL.NOTICE);
        }
    }

    async deleteFolderOnDB(folder: TFolder) {
        Logger(`delete folder:${folder.path}`);
        await this.localDatabase.deleteDBEntryPrefix(folder.path + "/");
        for (const v of folder.children) {
            const entry = v as TFile & TFolder;
            Logger(`->entry:${entry.path}`, LOG_LEVEL.VERBOSE);
            if (entry.children) {
                Logger(`->is dir`, LOG_LEVEL.VERBOSE);
                await this.deleteFolderOnDB(entry);
                try {
                    if (this.settings.trashInsteadDelete) {
                        await this.app.vault.trash(entry, false);
                    } else {
                        await this.app.vault.delete(entry);
                    }
                } catch (ex) {
                    if (ex.code && ex.code == "ENOENT") {
                        //NO OP.
                    } else {
                        Logger(`error while delete folder:${entry.path}`, LOG_LEVEL.NOTICE);
                        Logger(ex);
                    }
                }
            } else {
                Logger(`->is file`, LOG_LEVEL.VERBOSE);
                await this.deleteFromDB(entry);
            }
        }
        try {
            if (this.settings.trashInsteadDelete) {
                await this.app.vault.trash(folder, false);
            } else {
                await this.app.vault.delete(folder);
            }
        } catch (ex) {
            if (ex.code && ex.code == "ENOENT") {
                //NO OP.
            } else {
                Logger(`error while delete filder:${folder.path}`, LOG_LEVEL.NOTICE);
                Logger(ex);
            }
        }
    }

    async renameFolder(folder: TFolder, oldFile: any) {
        for (const v of folder.children) {
            const entry = v as TFile & TFolder;
            if (entry.children) {
                await this.deleteFolderOnDB(entry);
                if (this.settings.trashInsteadDelete) {
                    await this.app.vault.trash(entry, false);
                } else {
                    await this.app.vault.delete(entry);
                }
            } else {
                await this.deleteFromDB(entry);
            }
        }
    }

    // --> conflict resolving
    async getConflictedDoc(path: string, rev: string): Promise<false | diff_result_leaf> {
        try {
            const doc = await this.localDatabase.getDBEntry(path, { rev: rev }, false, false);
            if (doc === false) return false;
            let data = doc.data;
            if (doc.datatype == "newnote") {
                data = base64ToString(doc.data);
            } else if (doc.datatype == "plain") {
                data = doc.data;
            }
            return {
                ctime: doc.ctime,
                mtime: doc.mtime,
                rev: rev,
                data: data,
            };
        } catch (ex) {
            if (ex.status && ex.status == 404) {
                return false;
            }
        }
        return false;
    }

    /**
     * Getting file conflicted status.
     * @param path the file location
     * @returns true -> resolved, false -> nothing to do, or check result.
     */
    async getConflictedStatus(path: string): Promise<diff_check_result> {
        const test = await this.localDatabase.getDBEntry(path, { conflicts: true }, false, false);
        if (test === false) return false;
        if (test == null) return false;
        if (!test._conflicts) return false;
        if (test._conflicts.length == 0) return false;
        // should be one or more conflicts;
        const leftLeaf = await this.getConflictedDoc(path, test._rev);
        const rightLeaf = await this.getConflictedDoc(path, test._conflicts[0]);
        if (leftLeaf == false) {
            // what's going on..
            Logger(`could not get current revisions:${path}`, LOG_LEVEL.NOTICE);
            return false;
        }
        if (rightLeaf == false) {
            // Conflicted item could not load, delete this.
            await this.localDatabase.deleteDBEntry(path, { rev: test._conflicts[0] });
            await this.pullFile(path, null, true);
            Logger(`could not get old revisions, automaticaly used newer one:${path}`, LOG_LEVEL.NOTICE);
            return true;
        }
        // first,check for same contents
        if (leftLeaf.data == rightLeaf.data) {
            let leaf = leftLeaf;
            if (leftLeaf.mtime > rightLeaf.mtime) {
                leaf = rightLeaf;
            }
            await this.localDatabase.deleteDBEntry(path, { rev: leaf.rev });
            await this.pullFile(path, null, true);
            Logger(`automaticaly merged:${path}`);
            return true;
        }
        if (this.settings.resolveConflictsByNewerFile) {
            const lmtime = ~~(leftLeaf.mtime / 1000);
            const rmtime = ~~(rightLeaf.mtime / 1000);
            let loser = leftLeaf;
            if (lmtime > rmtime) {
                loser = rightLeaf;
            }
            await this.localDatabase.deleteDBEntry(path, { rev: loser.rev });
            await this.pullFile(path, null, true);
            Logger(`Automaticaly merged (newerFileResolve) :${path}`, LOG_LEVEL.NOTICE);
            return true;
        }
        // make diff.
        const dmp = new diff_match_patch();
        const diff = dmp.diff_main(leftLeaf.data, rightLeaf.data);
        dmp.diff_cleanupSemantic(diff);
        Logger(`conflict(s) found:${path}`);
        return {
            left: leftLeaf,
            right: rightLeaf,
            diff: diff,
        };
    }

    showMergeDialog(file: TFile, conflictCheckResult: diff_result): Promise<boolean> {
        return new Promise((res, rej) => {
            Logger("open conflict dialog", LOG_LEVEL.VERBOSE);
            new ConflictResolveModal(this.app, conflictCheckResult, async (selected) => {
                const testDoc = await this.localDatabase.getDBEntry(file.path, { conflicts: true });
                if (testDoc === false) {
                    Logger("Missing file..", LOG_LEVEL.VERBOSE);
                    return res(true);
                }
                if (!testDoc._conflicts) {
                    Logger("Nothing have to do with this conflict", LOG_LEVEL.VERBOSE);
                    return res(true);
                }
                const toDelete = selected;
                const toKeep = conflictCheckResult.left.rev != toDelete ? conflictCheckResult.left.rev : conflictCheckResult.right.rev;
                if (toDelete == "") {
                    //concat both,
                    // write data,and delete both old rev.
                    const p = conflictCheckResult.diff.map((e) => e[1]).join("");
                    await this.localDatabase.deleteDBEntry(file.path, { rev: conflictCheckResult.left.rev });
                    await this.localDatabase.deleteDBEntry(file.path, { rev: conflictCheckResult.right.rev });
                    await this.app.vault.modify(file, p);
                    await this.updateIntoDB(file);
                    await this.pullFile(file.path);
                    Logger("concat both file");
                    setTimeout(() => {
                        //resolved, check again.
                        this.showIfConflicted(file);
                    }, 500);
                } else if (toDelete == null) {
                    Logger("Leave it still conflicted");
                } else {
                    Logger(`resolved conflict:${file.path}`);
                    await this.localDatabase.deleteDBEntry(file.path, { rev: toDelete });
                    await this.pullFile(file.path, null, true, toKeep);
                    setTimeout(() => {
                        //resolved, check again.
                        this.showIfConflicted(file);
                    }, 500);
                }

                return res(true);
            }).open();
        });
    }

    conflictedCheckFiles: string[] = [];

    // queueing the conflicted file check
    conflictedCheckTimer: number;

    queueConflictedCheck(file: TFile) {
        this.conflictedCheckFiles = this.conflictedCheckFiles.filter((e) => e != file.path);
        this.conflictedCheckFiles.push(file.path);
        if (this.conflictedCheckTimer != null) {
            window.clearTimeout(this.conflictedCheckTimer);
        }
        this.conflictedCheckTimer = window.setTimeout(async () => {
            this.conflictedCheckTimer = null;
            const checkFiles = JSON.parse(JSON.stringify(this.conflictedCheckFiles)) as string[];
            for (const filename of checkFiles) {
                try {
                    const file = this.app.vault.getAbstractFileByPath(filename);
                    if (file != null && file instanceof TFile) {
                        await this.showIfConflicted(file);
                    }
                } catch (ex) {
                    Logger(ex);
                }
            }
        }, 1000);
    }

    async showIfConflicted(file: TFile) {
        await runWithLock("conflicted", false, async () => {
            const conflictCheckResult = await this.getConflictedStatus(file.path);
            if (conflictCheckResult === false) {
                //nothign to do.
                return;
            }
            if (conflictCheckResult === true) {
                //auto resolved, but need check again;
                Logger("conflict:Automatically merged, but we have to check it again");
                setTimeout(() => {
                    this.showIfConflicted(file);
                }, 500);
                return;
            }
            //there conflicts, and have to resolve ;
            await this.showMergeDialog(file, conflictCheckResult);
        });
    }

    async pullFile(filename: string, fileList?: TFile[], force?: boolean, rev?: string, waitForReady = true) {
        const targetFile = this.app.vault.getAbstractFileByPath(id2path(filename));
        if (targetFile == null) {
            //have to create;
            const doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : null, false, waitForReady);
            if (doc === false) return;
            await this.doc2storage_create(doc, force);
        } else if (targetFile instanceof TFile) {
            //normal case
            const file = targetFile;
            const doc = await this.localDatabase.getDBEntry(filename, rev ? { rev: rev } : null, false, waitForReady);
            if (doc === false) return;
            await this.doc2storage_modify(doc, file, force);
        } else {
            Logger(`target files:${filename} is exists as the folder`);
            //something went wrong..
        }
        //when to opened file;
    }

    async syncFileBetweenDBandStorage(file: TFile, fileList?: TFile[]) {
        const doc = await this.localDatabase.getDBEntryMeta(file.path);
        if (doc === false) return;

        const storageMtime = ~~(file.stat.mtime / 1000);
        const docMtime = ~~(doc.mtime / 1000);
        const dK = `${file.path}-diff`;
        const isLastDiff = (await this.localDatabase.kvDB.get<{ storageMtime: number; docMtime: number }>(dK)) || { storageMtime: 0, docMtime: 0 };
        if (isLastDiff.docMtime == docMtime && isLastDiff.storageMtime == storageMtime) {
            // Logger("CHECKED       :" + file.path, LOG_LEVEL.VERBOSE);
        } else {
            if (storageMtime > docMtime) {
                //newer local file.
                Logger("STORAGE -> DB :" + file.path);
                Logger(`${storageMtime} > ${docMtime}`);
                await this.updateIntoDB(file);
            } else if (storageMtime < docMtime) {
                //newer database file.
                Logger("STORAGE <- DB :" + file.path);
                Logger(`${storageMtime} < ${docMtime}`);
                const docx = await this.localDatabase.getDBEntry(file.path, null, false, false);
                if (docx != false) {
                    await this.doc2storage_modify(docx, file);
                }
            } else {
                // Logger("EVEN :" + file.path, LOG_LEVEL.VERBOSE);
                // Logger(`${storageMtime} = ${docMtime}`, LOG_LEVEL.VERBOSE);
                //eq.case
            }
            await this.localDatabase.kvDB.set(dK, { storageMtime, docMtime });
        }
    }

    async updateIntoDB(file: TFile) {
        if (shouldBeIgnored(file.path)) {
            return;
        }
        await this.localDatabase.waitForGCComplete();
        let content = "";
        let datatype: "plain" | "newnote" = "newnote";
        if (!isPlainText(file.name)) {
            const contentBin = await this.app.vault.readBinary(file);
            content = await arrayBufferToBase64(contentBin);
            datatype = "newnote";
        } else {
            content = await this.app.vault.read(file);
            datatype = "plain";
        }
        const fullpath = path2id(file.path);
        const d: LoadedEntry = {
            _id: fullpath,
            data: content,
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            size: file.stat.size,
            children: [],
            datatype: datatype,
        };
        //upsert should locked
        const isNotChanged = await runWithLock("file:" + fullpath, false, async () => {
            const old = await this.localDatabase.getDBEntry(fullpath, null, false, false);
            if (old !== false) {
                const oldData = { data: old.data, deleted: old._deleted };
                const newData = { data: d.data, deleted: d._deleted };
                if (JSON.stringify(oldData) == JSON.stringify(newData)) {
                    Logger("not changed:" + fullpath + (d._deleted ? " (deleted)" : ""), LOG_LEVEL.VERBOSE);
                    return true;
                }
                // d._rev = old._rev;
            }
            return false;
        });
        if (isNotChanged) return;
        await this.localDatabase.putDBEntry(d);
        this.queuedFiles = this.queuedFiles.map((e) => ({ ...e, ...(e.entry._id == d._id ? { done: true } : {}) }));

        Logger("put database:" + fullpath + "(" + datatype + ") ");
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
    }

    async deleteFromDB(file: TFile) {
        const fullpath = file.path;
        Logger(`deleteDB By path:${fullpath}`);
        await this.deleteFromDBbyPath(fullpath);
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
    }

    async deleteFromDBbyPath(fullpath: string) {
        await this.localDatabase.deleteDBEntry(fullpath);
        if (this.settings.syncOnSave && !this.suspended) {
            await this.replicate();
        }
    }

    async resetLocalDatabase() {
        await this.localDatabase.resetDatabase();
    }
    async resetLocalOldDatabase() {
        await this.localDatabase.resetLocalOldDatabase();
    }

    async tryResetRemoteDatabase() {
        await this.localDatabase.tryResetRemoteDatabase(this.settings);
    }

    async tryCreateRemoteDatabase() {
        await this.localDatabase.tryCreateRemoteDatabase(this.settings);
    }

    async getPluginList(): Promise<{ plugins: PluginList; allPlugins: DevicePluginList; thisDevicePlugins: DevicePluginList }> {
        const db = this.localDatabase.localDatabase;
        const docList = await db.allDocs<PluginDataEntry>({ startkey: `ps:`, endkey: `ps;`, include_docs: false });
        const oldDocs: PluginDataEntry[] = ((await Promise.all(docList.rows.map(async (e) => await this.localDatabase.getDBEntry(e.id)))).filter((e) => e !== false) as LoadedEntry[]).map((e) => JSON.parse(e.data));
        const plugins: { [key: string]: PluginDataEntry[] } = {};
        const allPlugins: { [key: string]: PluginDataEntry } = {};
        const thisDevicePlugins: { [key: string]: PluginDataEntry } = {};
        for (const v of oldDocs) {
            if (typeof plugins[v.deviceVaultName] === "undefined") {
                plugins[v.deviceVaultName] = [];
            }
            plugins[v.deviceVaultName].push(v);
            allPlugins[v._id] = v;
            if (v.deviceVaultName == this.deviceAndVaultName) {
                thisDevicePlugins[v.manifest.id] = v;
            }
        }
        return { plugins, allPlugins, thisDevicePlugins };
    }

    async sweepPlugin(showMessage = false) {
        if (!this.settings.usePluginSync) return;
        if (!this.localDatabase.isReady) return;
        await runWithLock("sweepplugin", true, async () => {
            const logLevel = showMessage ? LOG_LEVEL.NOTICE : LOG_LEVEL.INFO;
            if (!this.deviceAndVaultName) {
                Logger("You have to set your device and vault name.", LOG_LEVEL.NOTICE);
                return;
            }
            Logger("Scanning plugins", logLevel);
            const db = this.localDatabase.localDatabase;
            const oldDocs = await db.allDocs({
                startkey: `ps:${this.deviceAndVaultName}-`,
                endkey: `ps:${this.deviceAndVaultName}.`,
                include_docs: true,
            });
            // Logger("OLD DOCS.", LOG_LEVEL.VERBOSE);
            // sweep current plugin.
            // @ts-ignore
            const pl = this.app.plugins;
            const manifests: PluginManifest[] = Object.values(pl.manifests);
            for (const m of manifests) {
                Logger(`Reading plugin:${m.name}(${m.id})`, LOG_LEVEL.VERBOSE);
                const path = normalizePath(m.dir) + "/";
                const adapter = this.app.vault.adapter;
                const files = ["manifest.json", "main.js", "styles.css", "data.json"];
                const pluginData: { [key: string]: string } = {};
                for (const file of files) {
                    const thePath = path + file;
                    if (await adapter.exists(thePath)) {
                        pluginData[file] = await adapter.read(thePath);
                    }
                }
                let mtime = 0;
                if (await adapter.exists(path + "/data.json")) {
                    mtime = (await adapter.stat(path + "/data.json")).mtime;
                }
                const p: PluginDataEntry = {
                    _id: `ps:${this.deviceAndVaultName}-${m.id}`,
                    dataJson: pluginData["data.json"],
                    deviceVaultName: this.deviceAndVaultName,
                    mainJs: pluginData["main.js"],
                    styleCss: pluginData["styles.css"],
                    manifest: m,
                    manifestJson: pluginData["manifest.json"],
                    mtime: mtime,
                    type: "plugin",
                };
                const d: LoadedEntry = {
                    _id: p._id,
                    data: JSON.stringify(p),
                    ctime: mtime,
                    mtime: mtime,
                    size: 0,
                    children: [],
                    datatype: "plain",
                };
                Logger(`check diff:${m.name}(${m.id})`, LOG_LEVEL.VERBOSE);
                await runWithLock("plugin-" + m.id, false, async () => {
                    const old = await this.localDatabase.getDBEntry(p._id, null, false, false);
                    if (old !== false) {
                        const oldData = { data: old.data, deleted: old._deleted };
                        const newData = { data: d.data, deleted: d._deleted };
                        if (JSON.stringify(oldData) == JSON.stringify(newData)) {
                            oldDocs.rows = oldDocs.rows.filter((e) => e.id != d._id);
                            Logger(`Nothing changed:${m.name}`);
                            return;
                        }
                    }
                    await this.localDatabase.putDBEntry(d);
                    oldDocs.rows = oldDocs.rows.filter((e) => e.id != d._id);
                    Logger(`Plugin saved:${m.name}`, logLevel);
                });
                //remove saved plugin data.
            }
            Logger(`Deleting old plugins`, LOG_LEVEL.VERBOSE);
            const delDocs = oldDocs.rows.map((e) => {
                e.doc._deleted = true;
                return e.doc;
            });
            await db.bulkDocs(delDocs);
            Logger(`Scan plugin done.`, logLevel);
        });
    }

    async applyPluginData(plugin: PluginDataEntry) {
        await runWithLock("plugin-" + plugin.manifest.id, false, async () => {
            const pluginTargetFolderPath = normalizePath(plugin.manifest.dir) + "/";
            const adapter = this.app.vault.adapter;
            // @ts-ignore
            const stat = this.app.plugins.enabledPlugins.has(plugin.manifest.id) == true;
            if (stat) {
                // @ts-ignore
                await this.app.plugins.unloadPlugin(plugin.manifest.id);
                Logger(`Unload plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
            }
            if (plugin.dataJson) await adapter.write(pluginTargetFolderPath + "data.json", plugin.dataJson);
            Logger("wrote:" + pluginTargetFolderPath + "data.json", LOG_LEVEL.NOTICE);
            if (stat) {
                // @ts-ignore
                await this.app.plugins.loadPlugin(plugin.manifest.id);
                Logger(`Load plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
            }
        });
    }

    async applyPlugin(plugin: PluginDataEntry) {
        await runWithLock("plugin-" + plugin.manifest.id, false, async () => {
            // @ts-ignore
            const stat = this.app.plugins.enabledPlugins.has(plugin.manifest.id) == true;
            if (stat) {
                // @ts-ignore
                await this.app.plugins.unloadPlugin(plugin.manifest.id);
                Logger(`Unload plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
            }

            const pluginTargetFolderPath = normalizePath(plugin.manifest.dir) + "/";
            const adapter = this.app.vault.adapter;
            if ((await adapter.exists(pluginTargetFolderPath)) === false) {
                await adapter.mkdir(pluginTargetFolderPath);
            }
            await adapter.write(pluginTargetFolderPath + "main.js", plugin.mainJs);
            await adapter.write(pluginTargetFolderPath + "manifest.json", plugin.manifestJson);
            if (plugin.styleCss) await adapter.write(pluginTargetFolderPath + "styles.css", plugin.styleCss);
            if (stat) {
                // @ts-ignore
                await this.app.plugins.loadPlugin(plugin.manifest.id);
                Logger(`Load plugin:${plugin.manifest.id}`, LOG_LEVEL.NOTICE);
            }
        });
    }
}
