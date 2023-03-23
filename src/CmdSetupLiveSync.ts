import { EntryDoc, ObsidianLiveSyncSettings, LOG_LEVEL, DEFAULT_SETTINGS } from "./lib/src/types";
import { configURIBase } from "./types";
import { Logger } from "./lib/src/logger";
import { PouchDB } from "./lib/src/pouchdb-browser.js";
import { askSelectString, askYesNo, askString } from "./utils";
import { decrypt, encrypt } from "./lib/src/e2ee_v2";
import { LiveSyncCommands } from "./LiveSyncCommands";

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

    async command_copySetupURI() {
        const encryptingPassphrase = await askString(this.app, "Encrypt your settings", "The passphrase to encrypt the setup URI", "");
        if (encryptingPassphrase === false)
            return;
        const setting = { ...this.settings, configPassphraseStore: "", encryptedCouchDBConnection: "", encryptedPassphrase: "" };
        const keys = Object.keys(setting) as (keyof ObsidianLiveSyncSettings)[];
        for (const k of keys) {
            if (JSON.stringify(k in setting ? setting[k] : "") == JSON.stringify(k in DEFAULT_SETTINGS ? DEFAULT_SETTINGS[k] : "*")) {
                delete setting[k];
            }
        }
        const encryptedSetting = encodeURIComponent(await encrypt(JSON.stringify(setting), encryptingPassphrase, false));
        const uri = `${configURIBase}${encryptedSetting}`;
        await navigator.clipboard.writeText(uri);
        Logger("Setup URI copied to clipboard", LOG_LEVEL.NOTICE);
    }
    async command_copySetupURIFull() {
        const encryptingPassphrase = await askString(this.app, "Encrypt your settings", "The passphrase to encrypt the setup URI", "");
        if (encryptingPassphrase === false)
            return;
        const setting = { ...this.settings, configPassphraseStore: "", encryptedCouchDBConnection: "", encryptedPassphrase: "" };
        const encryptedSetting = encodeURIComponent(await encrypt(JSON.stringify(setting), encryptingPassphrase, false));
        const uri = `${configURIBase}${encryptedSetting}`;
        await navigator.clipboard.writeText(uri);
        Logger("Setup URI copied to clipboard", LOG_LEVEL.NOTICE);
    }
    async command_openSetupURI() {
        const setupURI = await askString(this.app, "Easy setup", "Set up URI", `${configURIBase}aaaaa`);
        if (setupURI === false)
            return;
        if (!setupURI.startsWith(`${configURIBase}`)) {
            Logger("Set up URI looks wrong.", LOG_LEVEL.NOTICE);
            return;
        }
        const config = decodeURIComponent(setupURI.substring(configURIBase.length));
        console.dir(config);
        await this.setupWizard(config);
    }
    async setupWizard(confString: string) {
        try {
            const oldConf = JSON.parse(JSON.stringify(this.settings));
            const encryptingPassphrase = await askString(this.app, "Passphrase", "The passphrase to decrypt your setup URI", "");
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
                    const setupAgain = "Reconfigure and reconstitute the data";
                    const setupManually = "Leave everything to me";

                    const setupType = await askSelectString(this.app, "How would you like to set it up?", [setupAsNew, setupAgain, setupJustImport, setupManually]);
                    if (setupType == setupJustImport) {
                        this.plugin.settings = newSettingW;
                        this.plugin.usedPassphrase = "";
                        await this.plugin.saveSettings();
                    } else if (setupType == setupAsNew) {
                        this.plugin.settings = newSettingW;
                        this.plugin.usedPassphrase = "";
                        await this.plugin.saveSettings();
                        await this.plugin.resetLocalDatabase();
                        await this.plugin.localDatabase.initializeDatabase();
                        await this.plugin.markRemoteResolved();
                        await this.plugin.replicate(true);
                    } else if (setupType == setupAgain) {
                        const confirm = "I know this operation will rebuild all my databases with files on this device, and files that are on the remote database and I didn't synchronize to any other devices will be lost and want to proceed indeed.";
                        if (await askSelectString(this.app, "Do you really want to do this?", ["Cancel", confirm]) != confirm) {
                            return;
                        }
                        this.plugin.settings = newSettingW;
                        this.plugin.usedPassphrase = "";
                        await this.plugin.saveSettings();
                        await this.plugin.resetLocalDatabase();
                        await this.plugin.localDatabase.initializeDatabase();
                        await this.plugin.initializeDatabase(true);
                        await this.plugin.tryResetRemoteDatabase();
                        await this.plugin.markRemoteLocked();
                        await this.plugin.markRemoteResolved();
                        await this.plugin.replicate(true);

                    } else if (setupType == setupManually) {
                        const keepLocalDB = await askYesNo(this.app, "Keep local DB?");
                        const keepRemoteDB = await askYesNo(this.app, "Keep remote DB?");
                        if (keepLocalDB == "yes" && keepRemoteDB == "yes") {
                            // nothing to do. so peaceful.
                            this.plugin.settings = newSettingW;
                            this.plugin.usedPassphrase = "";
                            await this.plugin.saveSettings();
                            const replicate = await askYesNo(this.app, "Unlock and replicate?");
                            if (replicate == "yes") {
                                await this.plugin.replicate(true);
                                await this.plugin.markRemoteUnlocked();
                            }
                            Logger("Configuration loaded.", LOG_LEVEL.NOTICE);
                            return;
                        }
                        if (keepLocalDB == "no" && keepRemoteDB == "no") {
                            const reset = await askYesNo(this.app, "Drop everything?");
                            if (reset != "yes") {
                                Logger("Cancelled", LOG_LEVEL.NOTICE);
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

                Logger("Configuration loaded.", LOG_LEVEL.NOTICE);
            } else {
                Logger("Cancelled.", LOG_LEVEL.NOTICE);
            }
        } catch (ex) {
            Logger("Couldn't parse or decrypt configuration uri.", LOG_LEVEL.NOTICE);
        }
    }
}
