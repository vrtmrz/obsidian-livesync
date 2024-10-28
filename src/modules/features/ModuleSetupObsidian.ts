import { type ObsidianLiveSyncSettings, DEFAULT_SETTINGS, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "../../lib/src/common/types.ts";
import { configURIBase } from "../../common/types.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser.js";
import { decrypt, encrypt } from "../../lib/src/encryption/e2ee_v2.ts";
import { fireAndForget } from "../../lib/src/common/utils.ts";
import { EVENT_REQUEST_COPY_SETUP_URI, EVENT_REQUEST_OPEN_SETUP_URI, eventHub } from "../../common/events.ts";
import { AbstractObsidianModule, type IObsidianModule } from "../AbstractObsidianModule.ts";


export class ModuleSetupObsidian extends AbstractObsidianModule implements IObsidianModule {
    $everyOnload(): Promise<boolean> {
        this.registerObsidianProtocolHandler("setuplivesync", async (conf: any) => await this.setupWizard(conf.settings));

        this.addCommand({
            id: "livesync-copysetupuri",
            name: "Copy settings as a new setup URI",
            callback: () => fireAndForget(this.command_copySetupURI()),
        });
        this.addCommand({
            id: "livesync-copysetupuri-short",
            name: "Copy settings as a new setup URI (With customization sync)",
            callback: () => fireAndForget(this.command_copySetupURIWithSync()),
        });

        this.addCommand({
            id: "livesync-copysetupurifull",
            name: "Copy settings as a new setup URI (Full)",
            callback: () => fireAndForget(this.command_copySetupURIFull()),
        });

        this.addCommand({
            id: "livesync-opensetupuri",
            name: "Use the copied setup URI (Formerly Open setup URI)",
            callback: () => fireAndForget(this.command_openSetupURI()),
        });
        eventHub.onEvent(EVENT_REQUEST_OPEN_SETUP_URI, () => fireAndForget(() => this.command_openSetupURI()));
        eventHub.onEvent(EVENT_REQUEST_COPY_SETUP_URI, () => fireAndForget(() => this.command_copySetupURI()));
        return Promise.resolve(true);
    }

    async command_copySetupURI(stripExtra = true) {
        const encryptingPassphrase = await this.core.confirm.askString("Encrypt your settings", "The passphrase to encrypt the setup URI", "", true);
        if (encryptingPassphrase === false)
            return;
        const setting = { ...this.settings, configPassphraseStore: "", encryptedCouchDBConnection: "", encryptedPassphrase: "" } as Partial<ObsidianLiveSyncSettings>;
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
        this._log("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
    }
    async command_copySetupURIFull() {
        const encryptingPassphrase = await this.core.confirm.askString("Encrypt your settings", "The passphrase to encrypt the setup URI", "", true);
        if (encryptingPassphrase === false)
            return;
        const setting = { ...this.settings, configPassphraseStore: "", encryptedCouchDBConnection: "", encryptedPassphrase: "" };
        const encryptedSetting = encodeURIComponent(await encrypt(JSON.stringify(setting), encryptingPassphrase, false));
        const uri = `${configURIBase}${encryptedSetting}`;
        await navigator.clipboard.writeText(uri);
        this._log("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
    }
    async command_copySetupURIWithSync() {
        await this.command_copySetupURI(false);
    }
    async command_openSetupURI() {
        const setupURI = await this.core.confirm.askString("Easy setup", "Set up URI", `${configURIBase}aaaaa`);
        if (setupURI === false)
            return;
        if (!setupURI.startsWith(`${configURIBase}`)) {
            this._log("Set up URI looks wrong.", LOG_LEVEL_NOTICE);
            return;
        }
        const config = decodeURIComponent(setupURI.substring(configURIBase.length));
        console.dir(config);
        await this.setupWizard(config);
    }
    async setupWizard(confString: string) {
        try {
            const oldConf = JSON.parse(JSON.stringify(this.settings));
            const encryptingPassphrase = await this.core.confirm.askString("Passphrase", "The passphrase to decrypt your setup URI", "", true);
            if (encryptingPassphrase === false)
                return;
            const newConf = await JSON.parse(await decrypt(confString, encryptingPassphrase, false));
            if (newConf) {
                const result = await this.core.confirm.askYesNoDialog("Importing Configuration from the Setup-URI. Are you sure to proceed?", {});
                if (result == "yes") {
                    const newSettingW = Object.assign({}, DEFAULT_SETTINGS, newConf) as ObsidianLiveSyncSettings;
                    this.core.replicator.closeReplication();
                    this.settings.suspendFileWatching = true;
                    console.dir(newSettingW);
                    // Back into the default method once.
                    newSettingW.configPassphraseStore = "";
                    newSettingW.encryptedPassphrase = "";
                    newSettingW.encryptedCouchDBConnection = "";
                    newSettingW.additionalSuffixOfDatabaseName = `${("appId" in this.app ? this.app.appId : "")}`
                    const setupJustImport = "Just import setting";
                    const setupAsNew = "Set it up as secondary or subsequent device";
                    const setupAsMerge = "Secondary device but try keeping local changes";
                    const setupAgain = "Reconfigure and reconstitute the data";
                    const setupManually = "Leave everything to me";
                    newSettingW.syncInternalFiles = false;
                    newSettingW.usePluginSync = false;
                    newSettingW.isConfigured = true;
                    // Migrate completely obsoleted configuration.
                    if (!newSettingW.useIndexedDBAdapter) {
                        newSettingW.useIndexedDBAdapter = true;
                    }

                    const setupType = await this.core.confirm.askSelectStringDialogue("How would you like to set it up?", [setupAsNew, setupAgain, setupAsMerge, setupJustImport, setupManually], { defaultAction: setupAsNew });
                    if (setupType == setupJustImport) {
                        this.core.settings = newSettingW;
                        this.core.$$clearUsedPassphrase();
                        await this.core.saveSettings();
                    } else if (setupType == setupAsNew) {
                        this.core.settings = newSettingW;
                        this.core.$$clearUsedPassphrase();
                        await this.core.rebuilder.$fetchLocal();
                    } else if (setupType == setupAsMerge) {
                        this.core.settings = newSettingW;
                        this.core.$$clearUsedPassphrase();
                        await this.core.rebuilder.$fetchLocal(true);
                    } else if (setupType == setupAgain) {
                        const confirm = "I know this operation will rebuild all my databases with files on this device, and files that are on the remote database and I didn't synchronize to any other devices will be lost and want to proceed indeed.";
                        if (await this.core.confirm.askSelectStringDialogue("Do you really want to do this?", ["Cancel", confirm], { defaultAction: "Cancel" }) != confirm) {
                            return;
                        }
                        this.core.settings = newSettingW;
                        this.core.$$clearUsedPassphrase();
                        await this.core.rebuilder.$rebuildEverything();
                    } else if (setupType == setupManually) {
                        const keepLocalDB = await this.core.confirm.askYesNoDialog("Keep local DB?", { defaultOption: "No" });
                        const keepRemoteDB = await this.core.confirm.askYesNoDialog("Keep remote DB?", { defaultOption: "No" });
                        if (keepLocalDB == "yes" && keepRemoteDB == "yes") {
                            // nothing to do. so peaceful.
                            this.core.settings = newSettingW;
                            this.core.$$clearUsedPassphrase();
                            await this.core.$allSuspendAllSync();
                            await this.core.$allSuspendExtraSync();
                            await this.core.saveSettings();
                            const replicate = await this.core.confirm.askYesNoDialog("Unlock and replicate?", { defaultOption: "Yes" });
                            if (replicate == "yes") {
                                await this.core.$$replicate(true);
                                await this.core.$$markRemoteUnlocked();
                            }
                            this._log("Configuration loaded.", LOG_LEVEL_NOTICE);
                            return;
                        }
                        if (keepLocalDB == "no" && keepRemoteDB == "no") {
                            const reset = await this.core.confirm.askYesNoDialog("Drop everything?", { defaultOption: "No" });
                            if (reset != "yes") {
                                this._log("Cancelled", LOG_LEVEL_NOTICE);
                                this.core.settings = oldConf;
                                return;
                            }
                        }
                        let initDB;
                        this.core.settings = newSettingW;
                        this.core.$$clearUsedPassphrase();
                        await this.core.saveSettings();
                        if (keepLocalDB == "no") {
                            await this.core.$$resetLocalDatabase();
                            await this.core.localDatabase.initializeDatabase();
                            const rebuild = await this.core.confirm.askYesNoDialog("Rebuild the database?", { defaultOption: "Yes" });
                            if (rebuild == "yes") {
                                initDB = this.core.$$initializeDatabase(true);
                            } else {
                                await this.core.$$markRemoteResolved();
                            }
                        }
                        if (keepRemoteDB == "no") {
                            await this.core.$$tryResetRemoteDatabase();
                            await this.core.$$markRemoteLocked();
                        }
                        if (keepLocalDB == "no" || keepRemoteDB == "no") {
                            const replicate = await this.core.confirm.askYesNoDialog("Replicate once?", { defaultOption: "Yes" });
                            if (replicate == "yes") {
                                if (initDB != null) {
                                    await initDB;
                                }
                                await this.core.$$replicate(true);
                            }
                        }
                    }
                }

                this._log("Configuration loaded.", LOG_LEVEL_NOTICE);
            } else {
                this._log("Cancelled.", LOG_LEVEL_NOTICE);
            }
        } catch (ex) {
            this._log("Couldn't parse or decrypt configuration uri.", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
    }


}
