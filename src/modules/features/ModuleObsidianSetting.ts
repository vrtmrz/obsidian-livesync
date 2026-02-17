// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import { EVENT_REQUEST_RELOAD_SETTING_TAB, EVENT_SETTING_SAVED, eventHub } from "../../common/events.ts";
import {
    type BucketSyncSetting,
    ChunkAlgorithmNames,
    type ConfigPassphraseStore,
    type CouchDBConnection,
    DEFAULT_SETTINGS,
    type ObsidianLiveSyncSettings,
    SALT_OF_PASSPHRASE,
    SETTING_KEY_P2P_DEVICE_NAME,
} from "../../lib/src/common/types";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_URGENT } from "octagonal-wheels/common/logger";
import { $msg, setLang } from "../../lib/src/common/i18n.ts";
import { isCloudantURI } from "../../lib/src/pouchdb/utils_couchdb.ts";
import { getLanguage } from "@/deps.ts";
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "../../lib/src/common/rosetta.ts";
import { decryptString, encryptString } from "@/lib/src/encryption/stringEncryption.ts";
import type { LiveSyncCore } from "../../main.ts";
import { AbstractModule } from "../AbstractModule.ts";
export class ModuleObsidianSettings extends AbstractModule {
    async _everyOnLayoutReady(): Promise<boolean> {
        let isChanged = false;
        if (this.settings.displayLanguage == "") {
            const obsidianLanguage = getLanguage();
            if (
                SUPPORTED_I18N_LANGS.indexOf(obsidianLanguage) !== -1 && // Check if the language is supported
                obsidianLanguage != this.settings.displayLanguage // Check if the language is different from the current setting
            ) {
                // Check if the current setting is not empty (Means migrated or installed).
                this.settings.displayLanguage = obsidianLanguage as I18N_LANGS;
                isChanged = true;
                setLang(this.settings.displayLanguage);
            } else if (this.settings.displayLanguage == "") {
                this.settings.displayLanguage = "def";
                setLang(this.settings.displayLanguage);
                await this.services.setting.saveSettingData();
            }
        }
        if (isChanged) {
            const revert = $msg("dialog.yourLanguageAvailable.btnRevertToDefault");
            if (
                (await this.core.confirm.askSelectStringDialogue($msg(`dialog.yourLanguageAvailable`), ["OK", revert], {
                    defaultAction: "OK",
                    title: $msg(`dialog.yourLanguageAvailable.Title`),
                })) == revert
            ) {
                this.settings.displayLanguage = "def";
                setLang(this.settings.displayLanguage);
            }
            await this.services.setting.saveSettingData();
        }
        return true;
    }
    getPassphrase(settings: ObsidianLiveSyncSettings) {
        const methods: Record<ConfigPassphraseStore, () => Promise<string | false>> = {
            "": () => Promise.resolve("*"),
            LOCALSTORAGE: () => Promise.resolve(localStorage.getItem("ls-setting-passphrase") ?? false),
            ASK_AT_LAUNCH: () => this.core.confirm.askString("Passphrase", "passphrase", ""),
        };
        const method = settings.configPassphraseStore;
        const methodFunc = method in methods ? methods[method] : methods[""];
        return methodFunc();
    }

    _saveDeviceAndVaultName(): void {
        const lsKey = "obsidian-live-sync-vaultanddevicename-" + this.services.vault.getVaultName();
        localStorage.setItem(lsKey, this.services.setting.getDeviceAndVaultName() || "");
    }

    usedPassphrase = "";
    private _clearUsedPassphrase(): void {
        this.usedPassphrase = "";
    }

    async decryptConfigurationItem(encrypted: string, passphrase: string) {
        const dec = await decryptString(encrypted, passphrase + SALT_OF_PASSPHRASE);
        if (dec) {
            this.usedPassphrase = passphrase;
            return dec;
        }
        return false;
    }

    async encryptConfigurationItem(src: string, settings: ObsidianLiveSyncSettings) {
        if (this.usedPassphrase != "") {
            return await encryptString(src, this.usedPassphrase + SALT_OF_PASSPHRASE);
        }

        const passphrase = await this.getPassphrase(settings);
        if (passphrase === false) {
            this._log(
                "Failed to obtain passphrase when saving data.json! Please verify the configuration.",
                LOG_LEVEL_URGENT
            );
            return "";
        }
        const dec = await encryptString(src, passphrase + SALT_OF_PASSPHRASE);
        if (dec) {
            this.usedPassphrase = passphrase;
            return dec;
        }

        return "";
    }

    get appId() {
        return this.services.API.getAppID();
    }

    async _saveSettingData() {
        this.services.setting.saveDeviceAndVaultName();
        const settings = { ...this.settings };
        settings.deviceAndVaultName = "";
        if (settings.P2P_DevicePeerName && settings.P2P_DevicePeerName.trim() !== "") {
            console.log("Saving device peer name to small config");
            this.services.config.setSmallConfig(SETTING_KEY_P2P_DEVICE_NAME, settings.P2P_DevicePeerName.trim());
            settings.P2P_DevicePeerName = "";
        }
        if (this.usedPassphrase == "" && !(await this.getPassphrase(settings))) {
            this._log("Failed to retrieve passphrase. data.json contains unencrypted items!", LOG_LEVEL_NOTICE);
        } else {
            if (
                settings.couchDB_PASSWORD != "" ||
                settings.couchDB_URI != "" ||
                settings.couchDB_USER != "" ||
                settings.couchDB_DBNAME
            ) {
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
                    useCustomRequestHandler: settings.useCustomRequestHandler,
                    bucketCustomHeaders: settings.bucketCustomHeaders,
                    couchDB_CustomHeaders: settings.couchDB_CustomHeaders,
                    useJWT: settings.useJWT,
                    jwtKey: settings.jwtKey,
                    jwtAlgorithm: settings.jwtAlgorithm,
                    jwtKid: settings.jwtKid,
                    jwtExpDuration: settings.jwtExpDuration,
                    jwtSub: settings.jwtSub,
                    useRequestAPI: settings.useRequestAPI,
                    bucketPrefix: settings.bucketPrefix,
                    forcePathStyle: settings.forcePathStyle,
                };
                settings.encryptedCouchDBConnection = await this.encryptConfigurationItem(
                    JSON.stringify(connectionSetting),
                    settings
                );
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

    async _decryptSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings> {
        const passphrase = await this.getPassphrase(settings);
        if (passphrase === false) {
            this._log("No passphrase found for data.json! Verify configuration before syncing.", LOG_LEVEL_URGENT);
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
                    "secretKey",
                ] as (keyof CouchDBConnection | keyof BucketSyncSetting)[];
                const decrypted = this.tryDecodeJson(
                    await this.decryptConfigurationItem(settings.encryptedCouchDBConnection, passphrase)
                ) as CouchDBConnection & BucketSyncSetting;
                if (decrypted) {
                    for (const key of keys) {
                        if (key in decrypted) {
                            //@ts-ignore
                            settings[key] = decrypted[key];
                        }
                    }
                } else {
                    this._log(
                        "Failed to decrypt passphrase from data.json! Ensure configuration is correct before syncing with remote.",
                        LOG_LEVEL_URGENT
                    );
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
                    this._log(
                        "Failed to decrypt passphrase from data.json! Ensure configuration is correct before syncing with remote.",
                        LOG_LEVEL_URGENT
                    );
                    settings.passphrase = "";
                }
            }
        }
        return settings;
    }

    /**
     * This method mutates the settings object.
     * @param settings
     * @returns
     */
    _adjustSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings> {
        // Adjust settings as needed

        // Delete this feature to avoid problems on mobile.
        settings.disableRequestURI = true;

        // GC is disabled.
        settings.gcDelay = 0;
        // So, use history is always enabled.
        settings.useHistory = true;

        if ("workingEncrypt" in settings) delete settings.workingEncrypt;
        if ("workingPassphrase" in settings) delete settings.workingPassphrase;
        // Splitter configurations have been replaced with chunkSplitterVersion.
        if (settings.chunkSplitterVersion == "") {
            if (settings.enableChunkSplitterV2) {
                if (settings.useSegmenter) {
                    settings.chunkSplitterVersion = "v2-segmenter";
                } else {
                    settings.chunkSplitterVersion = "v2";
                }
            } else {
                settings.chunkSplitterVersion = "";
            }
        } else if (!(settings.chunkSplitterVersion in ChunkAlgorithmNames)) {
            settings.chunkSplitterVersion = "";
        }
        return Promise.resolve(settings);
    }

    async _loadSettings(): Promise<void> {
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

        this.settings = await this.services.setting.decryptSettings(settings);

        setLang(this.settings.displayLanguage);

        await this.services.setting.adjustSettings(this.settings);

        const lsKey = "obsidian-live-sync-vaultanddevicename-" + this.services.vault.getVaultName();
        if (this.settings.deviceAndVaultName != "") {
            if (!localStorage.getItem(lsKey)) {
                this.services.setting.setDeviceAndVaultName(this.settings.deviceAndVaultName);
                this.services.setting.saveDeviceAndVaultName();
                this.settings.deviceAndVaultName = "";
            }
        }
        if (isCloudantURI(this.settings.couchDB_URI) && this.settings.customChunkSize != 0) {
            this._log(
                "Configuration issues detected and automatically resolved. However, unsynchronized data may exist. Consider rebuilding if necessary.",
                LOG_LEVEL_NOTICE
            );
            this.settings.customChunkSize = 0;
        }
        this.services.setting.setDeviceAndVaultName(localStorage.getItem(lsKey) || "");
        if (this.services.setting.getDeviceAndVaultName() == "") {
            if (this.settings.usePluginSync) {
                this._log("Device name missing. Disabling plug-in sync.", LOG_LEVEL_NOTICE);
                this.settings.usePluginSync = false;
            }
        }

        // this.core.ignoreFiles = this.settings.ignoreFiles.split(",").map(e => e.trim());
        eventHub.emitEvent(EVENT_REQUEST_RELOAD_SETTING_TAB);
    }

    private _currentSettings(): ObsidianLiveSyncSettings {
        return this.settings;
    }
    private _updateSettings(updateFn: (settings: ObsidianLiveSyncSettings) => ObsidianLiveSyncSettings): Promise<void> {
        try {
            const updated = updateFn(this.settings);
            this.settings = updated;
        } catch (ex) {
            this._log("Error in update function: " + ex, LOG_LEVEL_URGENT);
            return Promise.reject(ex);
        }
        return Promise.resolve();
    }
    private _applyPartial(partial: Partial<ObsidianLiveSyncSettings>): Promise<void> {
        try {
            this.settings = { ...this.settings, ...partial };
        } catch (ex) {
            this._log("Error in applying partial settings: " + ex, LOG_LEVEL_URGENT);
            return Promise.reject(ex);
        }
        return Promise.resolve();
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        super.onBindFunction(core, services);
        services.appLifecycle.onLayoutReady.addHandler(this._everyOnLayoutReady.bind(this));
        services.setting.clearUsedPassphrase.setHandler(this._clearUsedPassphrase.bind(this));
        services.setting.decryptSettings.setHandler(this._decryptSettings.bind(this));
        services.setting.adjustSettings.setHandler(this._adjustSettings.bind(this));
        services.setting.loadSettings.setHandler(this._loadSettings.bind(this));
        services.setting.currentSettings.setHandler(this._currentSettings.bind(this));
        services.setting.updateSettings.setHandler(this._updateSettings.bind(this));
        services.setting.applyPartial.setHandler(this._applyPartial.bind(this));
        services.setting.saveDeviceAndVaultName.setHandler(this._saveDeviceAndVaultName.bind(this));
        services.setting.saveSettingData.setHandler(this._saveSettingData.bind(this));
    }
}
