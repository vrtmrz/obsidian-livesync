import { type EntryDoc, type ObsidianLiveSyncSettings, DEFAULT_SETTINGS, LOG_LEVEL_NOTICE } from "./lib/src/types";
import { configURIBase } from "./types";
import { Logger } from "./lib/src/logger";
import { PouchDB } from "./lib/src/pouchdb-browser.js";
import { askSelectString, askYesNo, askString } from "./utils";
import { decrypt, encrypt } from "./lib/src/e2ee_v2";
import { LiveSyncCommands } from "./LiveSyncCommands";
import { delay } from "./lib/src/utils";
import { confirmWithMessage } from "./dialogs";
import { Platform } from "./deps";
import { fetchAllUsedChunks } from "./lib/src/utils_couchdb";

export class SetupLiveSync extends LiveSyncCommands {
    onunload() { }
    onload(): void | Promise<void> {
        this.plugin.registerObsidianProtocolHandler("setuplivesync", async (conf: any) => await this.setupWizard(conf.settings));

        this.plugin.addCommand({
            id: "livesync-copysetupuri",
            name: "Copy the setup URI",
            callback: this.command_copySetupURI.bind(this),
        });
        this.plugin.addCommand({
            id: "livesync-copysetupuri-short",
            name: "Copy the setup URI (With customization sync)",
            callback: this.command_copySetupURIWithSync.bind(this),
        });

        this.plugin.addCommand({
            id: "livesync-copysetupurifull",
            name: "Copy the setup URI (Full)",
            callback: this.command_copySetupURIFull.bind(this),
        });

        this.plugin.addCommand({
            id: "livesync-opensetupuri",
            name: "Open the setup URI",
            callback: this.command_openSetupURI.bind(this),
        });
    }
    onInitializeDatabase(showNotice: boolean) { }
    beforeReplicate(showNotice: boolean) { }
    onResume() { }
    parseReplicationResultItem(docs: PouchDB.Core.ExistingDocument<EntryDoc>): boolean | Promise<boolean> {
        return false;
    }
    async realizeSettingSyncMode() { }

    async command_copySetupURI(stripExtra = true) {
        const encryptingPassphrase = await askString(this.app, "Encrypt your settings", "The passphrase to encrypt the setup URI", "", true);
        if (encryptingPassphrase === false)
            return;
        const setting = { ...this.settings, configPassphraseStore: "", encryptedCouchDBConnection: "", encryptedPassphrase: "" };
        if (stripExtra) {
            delete setting.pluginSyncExtendedSetting;
        }
        const keys = Object.keys(setting) as (keyof ObsidianLiveSyncSettings)[];
        for (const k of keys) {
            if (JSON.stringify(k in setting ? setting[k] : "") == JSON.stringify(k in DEFAULT_SETTINGS ? DEFAULT_SETTINGS[k] : "*")) {
                delete setting[k];
            }
        }
        const encryptedSetting = encodeURIComponent(await encrypt(JSON.stringify(setting), encryptingPassphrase, false));
        const uri = `${configURIBase}${encryptedSetting}`;
        await navigator.clipboard.writeText(uri);
        Logger("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
    }
    async command_copySetupURIFull() {
        const encryptingPassphrase = await askString(this.app, "Encrypt your settings", "The passphrase to encrypt the setup URI", "", true);
        if (encryptingPassphrase === false)
            return;
        const setting = { ...this.settings, configPassphraseStore: "", encryptedCouchDBConnection: "", encryptedPassphrase: "" };
        const encryptedSetting = encodeURIComponent(await encrypt(JSON.stringify(setting), encryptingPassphrase, false));
        const uri = `${configURIBase}${encryptedSetting}`;
        await navigator.clipboard.writeText(uri);
        Logger("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
    }
    async command_copySetupURIWithSync() {
        this.command_copySetupURI(false);
    }
    async command_openSetupURI() {
        const setupURI = await askString(this.app, "Easy setup", "Set up URI", `${configURIBase}aaaaa`);
        if (setupURI === false)
            return;
        if (!setupURI.startsWith(`${configURIBase}`)) {
            Logger("Set up URI looks wrong.", LOG_LEVEL_NOTICE);
            return;
        }
        const config = decodeURIComponent(setupURI.substring(configURIBase.length));
        console.dir(config);
        await this.setupWizard(config);
    }
    async setupWizard(confString: string) {
        try {
            const oldConf = JSON.parse(JSON.stringify(this.settings));
            const encryptingPassphrase = await askString(this.app, "Passphrase", "The passphrase to decrypt your setup URI", "", true);
            if (encryptingPassphrase === false)
                return;
            const newConf = await JSON.parse(await decrypt(confString, encryptingPassphrase, false));
            if (newConf) {
                const result = await askYesNo(this.app, "Importing LiveSync's conf, OK?");
                if (result == "yes") {
                    const newSettingW = Object.assign({}, DEFAULT_SETTINGS, newConf) as ObsidianLiveSyncSettings;
                    this.plugin.replicator.closeReplication();
                    this.settings.suspendFileWatching = true;
                    console.dir(newSettingW);
                    // Back into the default method once.
                    newSettingW.configPassphraseStore = "";
                    newSettingW.encryptedPassphrase = "";
                    newSettingW.encryptedCouchDBConnection = "";
                    const setupJustImport = "Just import setting";
                    const setupAsNew = "Set it up as secondary or subsequent device";
                    const setupAsMerge = "Secondary device but try keeping local changes";
                    const setupAgain = "Reconfigure and reconstitute the data";
                    const setupManually = "Leave everything to me";
                    newSettingW.syncInternalFiles = false;
                    newSettingW.usePluginSync = false;
                    // Migrate completely obsoleted configuration.
                    if (!newSettingW.useIndexedDBAdapter) {
                        newSettingW.useIndexedDBAdapter = true;
                    }

                    const setupType = await askSelectString(this.app, "How would you like to set it up?", [setupAsNew, setupAgain, setupAsMerge, setupJustImport, setupManually]);
                    if (setupType == setupJustImport) {
                        this.plugin.settings = newSettingW;
                        this.plugin.usedPassphrase = "";
                        await this.plugin.saveSettings();
                    } else if (setupType == setupAsNew) {
                        this.plugin.settings = newSettingW;
                        this.plugin.usedPassphrase = "";
                        await this.fetchLocal();
                    } else if (setupType == setupAsMerge) {
                        this.plugin.settings = newSettingW;
                        this.plugin.usedPassphrase = "";
                        await this.fetchLocalWithKeepLocal();
                    } else if (setupType == setupAgain) {
                        const confirm = "I know this operation will rebuild all my databases with files on this device, and files that are on the remote database and I didn't synchronize to any other devices will be lost and want to proceed indeed.";
                        if (await askSelectString(this.app, "Do you really want to do this?", ["Cancel", confirm]) != confirm) {
                            return;
                        }
                        this.plugin.settings = newSettingW;
                        this.plugin.usedPassphrase = "";
                        await this.rebuildEverything();
                    } else if (setupType == setupManually) {
                        const keepLocalDB = await askYesNo(this.app, "Keep local DB?");
                        const keepRemoteDB = await askYesNo(this.app, "Keep remote DB?");
                        if (keepLocalDB == "yes" && keepRemoteDB == "yes") {
                            // nothing to do. so peaceful.
                            this.plugin.settings = newSettingW;
                            this.plugin.usedPassphrase = "";
                            this.suspendAllSync();
                            this.suspendExtraSync();
                            await this.plugin.saveSettings();
                            const replicate = await askYesNo(this.app, "Unlock and replicate?");
                            if (replicate == "yes") {
                                await this.plugin.replicate(true);
                                await this.plugin.markRemoteUnlocked();
                            }
                            Logger("Configuration loaded.", LOG_LEVEL_NOTICE);
                            return;
                        }
                        if (keepLocalDB == "no" && keepRemoteDB == "no") {
                            const reset = await askYesNo(this.app, "Drop everything?");
                            if (reset != "yes") {
                                Logger("Cancelled", LOG_LEVEL_NOTICE);
                                this.plugin.settings = oldConf;
                                return;
                            }
                        }
                        let initDB;
                        this.plugin.settings = newSettingW;
                        this.plugin.usedPassphrase = "";
                        await this.plugin.saveSettings();
                        if (keepLocalDB == "no") {
                            await this.plugin.resetLocalDatabase();
                            await this.plugin.localDatabase.initializeDatabase();
                            const rebuild = await askYesNo(this.app, "Rebuild the database?");
                            if (rebuild == "yes") {
                                initDB = this.plugin.initializeDatabase(true);
                            } else {
                                await this.plugin.markRemoteResolved();
                            }
                        }
                        if (keepRemoteDB == "no") {
                            await this.plugin.tryResetRemoteDatabase();
                            await this.plugin.markRemoteLocked();
                        }
                        if (keepLocalDB == "no" || keepRemoteDB == "no") {
                            const replicate = await askYesNo(this.app, "Replicate once?");
                            if (replicate == "yes") {
                                if (initDB != null) {
                                    await initDB;
                                }
                                await this.plugin.replicate(true);
                            }
                        }
                    }
                }

                Logger("Configuration loaded.", LOG_LEVEL_NOTICE);
            } else {
                Logger("Cancelled.", LOG_LEVEL_NOTICE);
            }
        } catch (ex) {
            Logger("Couldn't parse or decrypt configuration uri.", LOG_LEVEL_NOTICE);
        }
    }

    suspendExtraSync() {
        Logger("Hidden files and plugin synchronization have been temporarily disabled. Please enable them after the fetching, if you need them.", LOG_LEVEL_NOTICE)
        this.plugin.settings.syncInternalFiles = false;
        this.plugin.settings.usePluginSync = false;
        this.plugin.settings.autoSweepPlugins = false;
    }
    async askHiddenFileConfiguration(opt: { enableFetch?: boolean, enableOverwrite?: boolean }) {
        this.plugin.addOnSetup.suspendExtraSync();
        const message = `Would you like to enable \`Hidden File Synchronization\` or \`Customization sync\`?
${opt.enableFetch ? " - Fetch: Use files stored from other devices. \n" : ""}${opt.enableOverwrite ? "- Overwrite: Use files from this device. \n" : ""}- Custom: Synchronize only customization files with a dedicated interface.
- Keep them disabled: Do not use hidden file synchronization.
Of course, we are able to disable these features.`
        const CHOICE_FETCH = "Fetch";
        const CHOICE_OVERWRITE = "Overwrite";
        const CHOICE_CUSTOMIZE = "Custom";
        const CHOICE_DISMISS = "keep them disabled";
        const choices = [];
        if (opt?.enableFetch) {
            choices.push(CHOICE_FETCH);
        }
        if (opt?.enableOverwrite) {
            choices.push(CHOICE_OVERWRITE);
        }
        choices.push(CHOICE_CUSTOMIZE);
        choices.push(CHOICE_DISMISS);

        const ret = await confirmWithMessage(this.plugin, "Hidden file sync", message, choices, CHOICE_DISMISS, 40);
        if (ret == CHOICE_FETCH) {
            await this.configureHiddenFileSync("FETCH");
        } else if (ret == CHOICE_OVERWRITE) {
            await this.configureHiddenFileSync("OVERWRITE");
        } else if (ret == CHOICE_DISMISS) {
            await this.configureHiddenFileSync("DISABLE");
        } else if (ret == CHOICE_CUSTOMIZE) {
            await this.configureHiddenFileSync("CUSTOMIZE");
        }
    }
    async configureHiddenFileSync(mode: "FETCH" | "OVERWRITE" | "MERGE" | "DISABLE" | "CUSTOMIZE") {
        this.plugin.addOnSetup.suspendExtraSync();
        if (mode == "DISABLE") {
            this.plugin.settings.syncInternalFiles = false;
            this.plugin.settings.usePluginSync = false;
            await this.plugin.saveSettings();
            return;
        }
        if (mode != "CUSTOMIZE") {
            Logger("Gathering files for enabling Hidden File Sync", LOG_LEVEL_NOTICE);
            if (mode == "FETCH") {
                await this.plugin.addOnHiddenFileSync.syncInternalFilesAndDatabase("pullForce", true);
            } else if (mode == "OVERWRITE") {
                await this.plugin.addOnHiddenFileSync.syncInternalFilesAndDatabase("pushForce", true);
            } else if (mode == "MERGE") {
                await this.plugin.addOnHiddenFileSync.syncInternalFilesAndDatabase("safe", true);
            }
            this.plugin.settings.syncInternalFiles = true;
            await this.plugin.saveSettings();
            Logger(`Done! Restarting the app is strongly recommended!`, LOG_LEVEL_NOTICE);
        } else if (mode == "CUSTOMIZE") {
            if (!this.plugin.deviceAndVaultName) {
                let name = await askString(this.app, "Device name", "Please set this device name", `desktop`);
                if (!name) {
                    if (Platform.isAndroidApp) {
                        name = "android-app"
                    } else if (Platform.isIosApp) {
                        name = "ios"
                    } else if (Platform.isMacOS) {
                        name = "macos"
                    } else if (Platform.isMobileApp) {
                        name = "mobile-app"
                    } else if (Platform.isMobile) {
                        name = "mobile"
                    } else if (Platform.isSafari) {
                        name = "safari"
                    } else if (Platform.isDesktop) {
                        name = "desktop"
                    } else if (Platform.isDesktopApp) {
                        name = "desktop-app"
                    } else {
                        name = "unknown"
                    }
                    name = name + Math.random().toString(36).slice(-4);
                }
                this.plugin.deviceAndVaultName = name;
            }
            this.plugin.settings.usePluginSync = true;
            await this.plugin.saveSettings();
            await this.plugin.addOnConfigSync.scanAllConfigFiles(true);
        }

    }

    suspendAllSync() {
        this.plugin.settings.liveSync = false;
        this.plugin.settings.periodicReplication = false;
        this.plugin.settings.syncOnSave = false;
        this.plugin.settings.syncOnEditorSave = false;
        this.plugin.settings.syncOnStart = false;
        this.plugin.settings.syncOnFileOpen = false;
        this.plugin.settings.syncAfterMerge = false;
        //this.suspendExtraSync();
    }
    async suspendReflectingDatabase() {
        if (this.plugin.settings.doNotSuspendOnFetching) return;
        Logger(`Suspending reflection: Database and storage changes will not be reflected in each other until completely finished the fetching.`, LOG_LEVEL_NOTICE);
        this.plugin.settings.suspendParseReplicationResult = true;
        this.plugin.settings.suspendFileWatching = true;
        await this.plugin.saveSettings();
    }
    async resumeReflectingDatabase() {
        if (this.plugin.settings.doNotSuspendOnFetching) return;
        Logger(`Database and storage reflection has been resumed!`, LOG_LEVEL_NOTICE);
        this.plugin.settings.suspendParseReplicationResult = false;
        this.plugin.settings.suspendFileWatching = false;
        await this.plugin.syncAllFiles(true);
        await this.plugin.loadQueuedFiles();
        this.plugin.procQueuedFiles();
        await this.plugin.saveSettings();

    }
    async askUseNewAdapter() {
        if (!this.plugin.settings.useIndexedDBAdapter) {
            const message = `Now this plugin has been configured to use the old database adapter for keeping compatibility. Do you want to deactivate it?`;
            const CHOICE_YES = "Yes, disable and use latest";
            const CHOICE_NO = "No, keep compatibility";
            const choices = [CHOICE_YES, CHOICE_NO];

            const ret = await confirmWithMessage(this.plugin, "Database adapter", message, choices, CHOICE_YES, 10);
            if (ret == CHOICE_YES) {
                this.plugin.settings.useIndexedDBAdapter = false;
            }
        }
    }
    async fetchRemoteChunks() {
        if (!this.plugin.settings.doNotSuspendOnFetching && this.plugin.settings.readChunksOnline) {
            Logger(`Fetching chunks`, LOG_LEVEL_NOTICE);
            const remoteDB = await this.plugin.getReplicator().connectRemoteCouchDBWithSetting(this.settings, this.plugin.getIsMobile(), true);
            if (typeof remoteDB == "string") {
                Logger(remoteDB, LOG_LEVEL_NOTICE);
            } else {
                await fetchAllUsedChunks(this.localDatabase.localDatabase, remoteDB.db);
            }
            Logger(`Fetching chunks done`, LOG_LEVEL_NOTICE);
        }
    }
    async fetchLocal() {
        this.suspendExtraSync();
        this.askUseNewAdapter();
        await this.suspendReflectingDatabase();
        await this.plugin.realizeSettingSyncMode();
        await this.plugin.resetLocalDatabase();
        await delay(1000);
        await this.plugin.markRemoteResolved();
        await this.plugin.openDatabase();
        this.plugin.isReady = true;
        await delay(500);
        await this.plugin.replicateAllFromServer(true);
        await delay(1000);
        await this.plugin.replicateAllFromServer(true);
        await this.fetchRemoteChunks();
        await this.resumeReflectingDatabase();
        await this.askHiddenFileConfiguration({ enableFetch: true });
    }
    async fetchLocalWithKeepLocal() {
        this.suspendExtraSync();
        this.askUseNewAdapter();
        await this.suspendReflectingDatabase();
        await this.plugin.realizeSettingSyncMode();
        await this.plugin.resetLocalDatabase();
        await delay(1000);
        await this.plugin.initializeDatabase(true);
        await this.plugin.markRemoteResolved();
        await this.plugin.openDatabase();
        this.plugin.isReady = true;
        await delay(500);
        await this.plugin.replicateAllFromServer(true);
        await delay(1000);
        await this.plugin.replicateAllFromServer(true);
        await this.fetchRemoteChunks();
        await this.resumeReflectingDatabase();
        await this.askHiddenFileConfiguration({ enableFetch: true });
    }
    async rebuildRemote() {
        this.suspendExtraSync();
        await this.plugin.realizeSettingSyncMode();
        await this.plugin.markRemoteLocked();
        await this.plugin.tryResetRemoteDatabase();
        await this.plugin.markRemoteLocked();
        await delay(500);
        await this.askHiddenFileConfiguration({ enableOverwrite: true });
        await delay(1000);
        await this.plugin.replicateAllToServer(true);
        await delay(1000);
        await this.plugin.replicateAllToServer(true);
    }
    async rebuildEverything() {
        this.suspendExtraSync();
        this.askUseNewAdapter();
        await this.plugin.realizeSettingSyncMode();
        await this.plugin.resetLocalDatabase();
        await delay(1000);
        await this.plugin.initializeDatabase(true);
        await this.plugin.markRemoteLocked();
        await this.plugin.tryResetRemoteDatabase();
        await this.plugin.markRemoteLocked();
        await delay(500);
        await this.askHiddenFileConfiguration({ enableOverwrite: true });
        await delay(1000);
        await this.plugin.replicateAllToServer(true);
        await delay(1000);
        await this.plugin.replicateAllToServer(true);

    }
}
