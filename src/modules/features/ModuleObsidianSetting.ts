import { type IObsidianModule, AbstractObsidianModule } from "../AbstractObsidianModule.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser";
import { EVENT_REQUEST_RELOAD_SETTING_TAB, EVENT_SETTING_SAVED, eventHub } from "../../common/events";
import {
    type BucketSyncSetting,
    ChunkAlgorithmNames,
    type ConfigPassphraseStore,
    type CouchDBConnection,
    DEFAULT_SETTINGS,
    type ObsidianLiveSyncSettings,
    SALT_OF_PASSPHRASE,
} from "../../lib/src/common/types";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_URGENT } from "octagonal-wheels/common/logger";
import { encrypt, tryDecrypt } from "octagonal-wheels/encryption";
import { $msg, setLang } from "../../lib/src/common/i18n";
import { isCloudantURI } from "../../lib/src/pouchdb/utils_couchdb";
import { getLanguage } from "obsidian";
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "../../lib/src/common/rosetta.ts";
export class ModuleObsidianSettings extends AbstractObsidianModule implements IObsidianModule {
    async $everyOnLayoutReady(): Promise<boolean> {
        let isChanged = false;
        if (this.settings.displayLanguage == "") {
            const obsidianLanguage = getLanguage();
            if (
                SUPPORTED_I18N_LANGS.indexOf(obsidianLanguage) !== -1 && // Check if the language is supported
                obsidianLanguage != this.settings.displayLanguage && // Check if the language is different from the current setting
                this.settings.displayLanguage != ""
            ) {
                // Check if the current setting is not empty (Means migrated or installed).
                this.settings.displayLanguage = obsidianLanguage as I18N_LANGS;
                isChanged = true;
                setLang(this.settings.displayLanguage);
            } else if (this.settings.displayLanguage == "") {
                this.settings.displayLanguage = "def";
                setLang(this.settings.displayLanguage);
                await this.core.$$saveSettingData();
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
            await this.core.$$saveSettingData();
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

    $$saveDeviceAndVaultName(): void {
        const lsKey = "obsidian-live-sync-vaultanddevicename-" + this.core.$$getVaultName();
        localStorage.setItem(lsKey, this.core.$$getDeviceAndVaultName() || "");
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
            this._log(
                "Failed to obtain passphrase when saving data.json! Please verify the configuration.",
                LOG_LEVEL_URGENT
            );
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
        return `${"appId" in this.app ? this.app.appId : ""}`;
    }

    async $$saveSettingData() {
        this.core.$$saveDeviceAndVaultName();
        const settings = { ...this.settings };
        settings.deviceAndVaultName = "";
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

        const lsKey = "obsidian-live-sync-vaultanddevicename-" + this.core.$$getVaultName();
        if (this.settings.deviceAndVaultName != "") {
            if (!localStorage.getItem(lsKey)) {
                this.core.$$setDeviceAndVaultName(this.settings.deviceAndVaultName);
                this.$$saveDeviceAndVaultName();
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
        this.core.$$setDeviceAndVaultName(localStorage.getItem(lsKey) || "");
        if (this.core.$$getDeviceAndVaultName() == "") {
            if (this.settings.usePluginSync) {
                this._log("Device name missing. Disabling plug-in sync.", LOG_LEVEL_NOTICE);
                this.settings.usePluginSync = false;
            }
        }

        // Splitter configurations have been replaced with chunkSplitterVersion.
        if (this.settings.chunkSplitterVersion == "") {
            if (this.settings.enableChunkSplitterV2) {
                if (this.settings.useSegmenter) {
                    this.settings.chunkSplitterVersion = "v2-segmenter";
                } else {
                    this.settings.chunkSplitterVersion = "v2";
                }
            } else {
                this.settings.chunkSplitterVersion = "";
            }
        } else if (!(this.settings.chunkSplitterVersion in ChunkAlgorithmNames)) {
            this.settings.chunkSplitterVersion = "";
        }

        // this.core.ignoreFiles = this.settings.ignoreFiles.split(",").map(e => e.trim());
        eventHub.emitEvent(EVENT_REQUEST_RELOAD_SETTING_TAB);
    }
}
