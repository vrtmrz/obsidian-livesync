import { type IObsidianModule, AbstractObsidianModule } from "../AbstractObsidianModule.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import { EVENT_REQUEST_RELOAD_SETTING_TAB, EVENT_SETTING_SAVED, eventHub } from "../../common/events";
import { type BucketSyncSetting, type ConfigPassphraseStore, type CouchDBConnection, DEFAULT_SETTINGS, type ObsidianLiveSyncSettings, SALT_OF_PASSPHRASE } from "../../lib/src/common/types";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_URGENT } from "octagonal-wheels/common/logger";
import { encrypt, tryDecrypt } from "octagonal-wheels/encryption";
import { setLang } from "../../lib/src/common/i18n";
import { isCloudantURI } from "../../lib/src/pouchdb/utils_couchdb";
export class ModuleObsidianSettings extends AbstractObsidianModule implements IObsidianModule {

    getPassphrase(settings: ObsidianLiveSyncSettings) {
        const methods: Record<ConfigPassphraseStore, (() => Promise<string | false>)> = {
            "": () => Promise.resolve("*"),
            "LOCALSTORAGE": () => Promise.resolve(localStorage.getItem("ls-setting-passphrase") ?? false),
            "ASK_AT_LAUNCH": () => this.plugin.confirm.askString("Passphrase", "passphrase", "")
        }
        const method = settings.configPassphraseStore;
        const methodFunc = method in methods ? methods[method] : methods[""];
        return methodFunc();
    }

    $$saveDeviceAndVaultName(): void {
        const lsKey = "obsidian-live-sync-vaultanddevicename-" + this.plugin.$$getVaultName();
        localStorage.setItem(lsKey, this.plugin.deviceAndVaultName || "");
    }

    usedPassphrase = "";
    $$clearUsedPassphrase(): void {
        this.usedPassphrase = "";
    }


    async decryptConfigurationItem(encrypted: string, passphrase: string) {
        const dec = await tryDecrypt(encrypted, passphrase + SALT_OF_PASSPHRASE, false);
        if (dec) {
            this.usedPassphrase = passphrase;
            return dec;
        }
        return false;
    }


    async encryptConfigurationItem(src: string, settings: ObsidianLiveSyncSettings) {
        if (this.usedPassphrase != "") {
            return await encrypt(src, this.usedPassphrase + SALT_OF_PASSPHRASE, false);
        }

        const passphrase = await this.getPassphrase(settings);
        if (passphrase === false) {
            this._log("Could not determine passphrase to save data.json! You probably make the configuration sure again!", LOG_LEVEL_URGENT);
            return "";
        }
        const dec = await encrypt(src, passphrase + SALT_OF_PASSPHRASE, false);
        if (dec) {
            this.usedPassphrase = passphrase;
            return dec;
        }

        return "";
    }

    get appId() {
        return `${("appId" in this.app ? this.app.appId : "")}`;
    }

    async $$saveSettingData() {
        this.plugin.$$saveDeviceAndVaultName();
        const settings = { ...this.settings };
        settings.deviceAndVaultName = "";
        if (this.usedPassphrase == "" && !await this.getPassphrase(settings)) {
            this._log("Could not determine passphrase for saving data.json! Our data.json have insecure items!", LOG_LEVEL_NOTICE);
        } else {
            if (settings.couchDB_PASSWORD != "" || settings.couchDB_URI != "" || settings.couchDB_USER != "" || settings.couchDB_DBNAME) {
                const connectionSetting: CouchDBConnection & BucketSyncSetting = {
                    couchDB_DBNAME: settings.couchDB_DBNAME,
                    couchDB_PASSWORD: settings.couchDB_PASSWORD,
                    couchDB_URI: settings.couchDB_URI,
                    couchDB_USER: settings.couchDB_USER,
                    accessKey: settings.accessKey,
                    bucket: settings.bucket,
                    endpoint: settings.endpoint,
                    region: settings.region,
                    secretKey: settings.secretKey,
                    useCustomRequestHandler: settings.useCustomRequestHandler
                };
                settings.encryptedCouchDBConnection = await this.encryptConfigurationItem(JSON.stringify(connectionSetting), settings);
                settings.couchDB_PASSWORD = "";
                settings.couchDB_DBNAME = "";
                settings.couchDB_URI = "";
                settings.couchDB_USER = "";
                settings.accessKey = "";
                settings.bucket = "";
                settings.region = "";
                settings.secretKey = "";
                settings.endpoint = "";
            }
            if (settings.encrypt && settings.passphrase != "") {
                settings.encryptedPassphrase = await this.encryptConfigurationItem(settings.passphrase, settings);
                settings.passphrase = "";
            }

        }
        await this.core.saveData(settings);
        eventHub.emitEvent(EVENT_SETTING_SAVED, settings);
    }

    tryDecodeJson(encoded: string | false): object | false {
        try {
            if (!encoded) return false;
            return JSON.parse(encoded);
        } catch {
            return false;
        }
    }

    async $$loadSettings(): Promise<void> {
        const settings = Object.assign({}, DEFAULT_SETTINGS, await this.core.loadData()) as ObsidianLiveSyncSettings;

        if (typeof settings.isConfigured == "undefined") {
            // If migrated, mark true
            if (JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS)) {
                settings.isConfigured = true;
            } else {
                settings.additionalSuffixOfDatabaseName = this.appId;
                settings.isConfigured = false;
            }
        }
        const passphrase = await this.getPassphrase(settings);
        if (passphrase === false) {
            this._log("Could not determine passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL_URGENT);
        } else {
            if (settings.encryptedCouchDBConnection) {
                const keys = [
                    "couchDB_URI",
                    "couchDB_USER",
                    "couchDB_PASSWORD",
                    "couchDB_DBNAME",
                    "accessKey",
                    "bucket",
                    "endpoint",
                    "region",
                    "secretKey"] as (keyof CouchDBConnection | keyof BucketSyncSetting)[];
                const decrypted = this.tryDecodeJson(await this.decryptConfigurationItem(settings.encryptedCouchDBConnection, passphrase)) as (CouchDBConnection & BucketSyncSetting);
                if (decrypted) {
                    for (const key of keys) {
                        if (key in decrypted) {
                            //@ts-ignore
                            settings[key] = decrypted[key]
                        }
                    }
                } else {
                    this._log("Could not decrypt passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL_URGENT);
                    for (const key of keys) {
                        //@ts-ignore
                        settings[key] = "";
                    }
                }
            }
            if (settings.encrypt && settings.encryptedPassphrase) {
                const encrypted = settings.encryptedPassphrase;
                const decrypted = await this.decryptConfigurationItem(encrypted, passphrase);
                if (decrypted) {
                    settings.passphrase = decrypted;
                } else {
                    this._log("Could not decrypt passphrase for reading data.json! DO NOT synchronize with the remote before making sure your configuration is!", LOG_LEVEL_URGENT);
                    settings.passphrase = "";
                }
            }

        }
        this.settings = settings;
        setLang(this.settings.displayLanguage);

        if ("workingEncrypt" in this.settings) delete this.settings.workingEncrypt;
        if ("workingPassphrase" in this.settings) delete this.settings.workingPassphrase;

        // Delete this feature to avoid problems on mobile.
        this.settings.disableRequestURI = true;

        // GC is disabled.
        this.settings.gcDelay = 0;
        // So, use history is always enabled.
        this.settings.useHistory = true;

        const lsKey = "obsidian-live-sync-vaultanddevicename-" + this.plugin.$$getVaultName();
        if (this.settings.deviceAndVaultName != "") {
            if (!localStorage.getItem(lsKey)) {
                this.core.deviceAndVaultName = this.settings.deviceAndVaultName;
                localStorage.setItem(lsKey, this.core.deviceAndVaultName);
                this.settings.deviceAndVaultName = "";
            }
        }
        if (isCloudantURI(this.settings.couchDB_URI) && this.settings.customChunkSize != 0) {
            this._log("Configuration verification founds problems with your configuration. This has been fixed automatically. But you may already have data that cannot be synchronised. If this is the case, please rebuild everything.", LOG_LEVEL_NOTICE)
            this.settings.customChunkSize = 0;
        }
        this.core.deviceAndVaultName = localStorage.getItem(lsKey) || "";
        if (this.core.deviceAndVaultName == "") {
            if (this.settings.usePluginSync) {
                this._log("Device name is not set. Plug-in sync has been disabled.", LOG_LEVEL_NOTICE);
                this.settings.usePluginSync = false;
            }
        }
        // this.core.ignoreFiles = this.settings.ignoreFiles.split(",").map(e => e.trim());
        eventHub.emitEvent(EVENT_REQUEST_RELOAD_SETTING_TAB);
    }
}