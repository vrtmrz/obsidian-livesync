import {
    type ObsidianLiveSyncSettings,
    DEFAULT_SETTINGS,
    KeyIndexOfSettings,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
} from "../../lib/src/common/types.ts";
import { configURIBase, configURIBaseQR } from "../../common/types.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser.js";
import { fireAndForget } from "../../lib/src/common/utils.ts";
import {
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_SHOW_SETUP_QR,
    eventHub,
} from "../../common/events.ts";
import { AbstractObsidianModule, type IObsidianModule } from "../AbstractObsidianModule.ts";
import { decodeAnyArray, encodeAnyArray } from "../../common/utils.ts";
import qrcode from "qrcode-generator";
import { $msg } from "../../lib/src/common/i18n.ts";
import { performDoctorConsultation, RebuildOptions } from "@/lib/src/common/configForDoc.ts";
import { encryptString, decryptString } from "@/lib/src/encryption/stringEncryption.ts";

export class ModuleSetupObsidian extends AbstractObsidianModule implements IObsidianModule {
    $everyOnload(): Promise<boolean> {
        this.registerObsidianProtocolHandler("setuplivesync", async (conf: any) => {
            if (conf.settings) {
                await this.setupWizard(conf.settings);
            } else if (conf.settingsQR) {
                await this.decodeQR(conf.settingsQR);
            }
        });
        this.addCommand({
            id: "livesync-setting-qr",
            name: "Show settings as a QR code",
            callback: () => fireAndForget(this.encodeQR()),
        });

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
        eventHub.onEvent(EVENT_REQUEST_SHOW_SETUP_QR, () => fireAndForget(() => this.encodeQR()));
        return Promise.resolve(true);
    }
    async encodeQR() {
        const settingArr = [];
        const fullIndexes = Object.entries(KeyIndexOfSettings) as [keyof ObsidianLiveSyncSettings, number][];
        for (const [settingKey, index] of fullIndexes) {
            const settingValue = this.settings[settingKey];
            if (index < 0) {
                // This setting should be ignored.
                continue;
            }
            settingArr[index] = settingValue;
        }
        const w = encodeAnyArray(settingArr);
        const qr = qrcode(0, "L");
        const uri = `${configURIBaseQR}${encodeURIComponent(w)}`;
        qr.addData(uri);
        qr.make();
        const img = qr.createSvgTag(3);
        const msg = $msg("Setup.QRCode", { qr_image: img });
        await this.core.confirm.confirmWithMessage("Settings QR Code", msg, ["OK"], "OK");
        return await Promise.resolve(w);
    }
    async decodeQR(qr: string) {
        const settingArr = decodeAnyArray(qr);
        // console.warn(settingArr);
        const fullIndexes = Object.entries(KeyIndexOfSettings) as [keyof ObsidianLiveSyncSettings, number][];
        const newSettings = { ...DEFAULT_SETTINGS } as ObsidianLiveSyncSettings;
        for (const [settingKey, index] of fullIndexes) {
            if (index < 0) {
                // This setting should be ignored.
                continue;
            }
            if (index >= settingArr.length) {
                // Possibly a new setting added.
                continue;
            }
            const settingValue = settingArr[index];
            //@ts-ignore
            newSettings[settingKey] = settingValue;
        }
        await this.applySettingWizard(this.settings, newSettings, "QR Code");
    }
    async command_copySetupURI(stripExtra = true) {
        const encryptingPassphrase = await this.core.confirm.askString(
            "Encrypt your settings",
            "The passphrase to encrypt the setup URI",
            "",
            true
        );
        if (encryptingPassphrase === false) return;
        const setting = {
            ...this.settings,
            configPassphraseStore: "",
            encryptedCouchDBConnection: "",
            encryptedPassphrase: "",
        } as Partial<ObsidianLiveSyncSettings>;
        if (stripExtra) {
            delete setting.pluginSyncExtendedSetting;
        }
        const keys = Object.keys(setting) as (keyof ObsidianLiveSyncSettings)[];
        for (const k of keys) {
            if (
                JSON.stringify(k in setting ? setting[k] : "") ==
                JSON.stringify(k in DEFAULT_SETTINGS ? DEFAULT_SETTINGS[k] : "*")
            ) {
                delete setting[k];
            }
        }
        const encryptedSetting = encodeURIComponent(await encryptString(JSON.stringify(setting), encryptingPassphrase));
        const uri = `${configURIBase}${encryptedSetting} `;
        await navigator.clipboard.writeText(uri);
        this._log("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
    }
    async command_copySetupURIFull() {
        const encryptingPassphrase = await this.core.confirm.askString(
            "Encrypt your settings",
            "The passphrase to encrypt the setup URI",
            "",
            true
        );
        if (encryptingPassphrase === false) return;
        const setting = {
            ...this.settings,
            configPassphraseStore: "",
            encryptedCouchDBConnection: "",
            encryptedPassphrase: "",
        };
        const encryptedSetting = encodeURIComponent(await encryptString(JSON.stringify(setting), encryptingPassphrase));
        const uri = `${configURIBase}${encryptedSetting} `;
        await navigator.clipboard.writeText(uri);
        this._log("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
    }
    async command_copySetupURIWithSync() {
        await this.command_copySetupURI(false);
    }
    async command_openSetupURI() {
        const setupURI = await this.core.confirm.askString("Easy setup", "Set up URI", `${configURIBase} aaaaa`);
        if (setupURI === false) return;
        if (!setupURI.startsWith(`${configURIBase}`)) {
            this._log("Set up URI looks wrong.", LOG_LEVEL_NOTICE);
            return;
        }
        const config = decodeURIComponent(setupURI.substring(configURIBase.length));
        await this.setupWizard(config);
    }
    async askSyncWithRemoteConfig(tryingSettings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings> {
        const buttons = {
            fetch: $msg("Setup.FetchRemoteConf.Buttons.Fetch"),
            no: $msg("Setup.FetchRemoteConf.Buttons.Skip"),
        } as const;
        const fetchRemoteConf = await this.core.confirm.askSelectStringDialogue(
            $msg("Setup.FetchRemoteConf.Message"),
            Object.values(buttons),
            { defaultAction: buttons.fetch, timeout: 0, title: $msg("Setup.FetchRemoteConf.Title") }
        );
        if (fetchRemoteConf == buttons.no) {
            return tryingSettings;
        }

        const newSettings = JSON.parse(JSON.stringify(tryingSettings)) as ObsidianLiveSyncSettings;
        const remoteConfig = await this.core.$$fetchRemotePreferredTweakValues(newSettings);
        if (remoteConfig) {
            this._log("Remote configuration found.", LOG_LEVEL_NOTICE);
            const resultSettings = {
                ...DEFAULT_SETTINGS,
                ...tryingSettings,
                ...remoteConfig,
            } satisfies ObsidianLiveSyncSettings;
            return resultSettings;
        } else {
            this._log("Remote configuration not applied.", LOG_LEVEL_NOTICE);
            return {
                ...DEFAULT_SETTINGS,
                ...tryingSettings,
            } satisfies ObsidianLiveSyncSettings;
        }
    }
    async askPerformDoctor(
        tryingSettings: ObsidianLiveSyncSettings
    ): Promise<{ settings: ObsidianLiveSyncSettings; shouldRebuild: boolean; isModified: boolean }> {
        const buttons = {
            yes: $msg("Setup.Doctor.Buttons.Yes"),
            no: $msg("Setup.Doctor.Buttons.No"),
        } as const;
        const performDoctor = await this.core.confirm.askSelectStringDialogue(
            $msg("Setup.Doctor.Message"),
            Object.values(buttons),
            { defaultAction: buttons.yes, timeout: 0, title: $msg("Setup.Doctor.Title") }
        );
        if (performDoctor == buttons.no) {
            return { settings: tryingSettings, shouldRebuild: false, isModified: false };
        }

        const newSettings = JSON.parse(JSON.stringify(tryingSettings)) as ObsidianLiveSyncSettings;
        const { settings, shouldRebuild, isModified } = await performDoctorConsultation(this.core, newSettings, {
            localRebuild: RebuildOptions.AutomaticAcceptable, // Because we are in the setup wizard, we can skip the confirmation.
            remoteRebuild: RebuildOptions.SkipEvenIfRequired,
            activateReason: "New settings from URI",
        });
        if (isModified) {
            this._log("Doctor has fixed some issues!", LOG_LEVEL_NOTICE);
            return {
                settings: settings,
                shouldRebuild,
                isModified,
            };
        } else {
            this._log("Doctor detected no issues!", LOG_LEVEL_NOTICE);
            return { settings: tryingSettings, shouldRebuild: false, isModified: false };
        }
    }

    async applySettingWizard(
        oldConf: ObsidianLiveSyncSettings,
        newConf: ObsidianLiveSyncSettings,
        method = "Setup URI"
    ) {
        const result = await this.core.confirm.askYesNoDialog(
            "Importing Configuration from the " + method + ". Are you sure to proceed ? ",
            {}
        );
        if (result == "yes") {
            let newSettingW = Object.assign({}, DEFAULT_SETTINGS, newConf) as ObsidianLiveSyncSettings;
            this.core.replicator.closeReplication();
            this.settings.suspendFileWatching = true;
            newSettingW = await this.askSyncWithRemoteConfig(newSettingW);
            const { settings, shouldRebuild, isModified } = await this.askPerformDoctor(newSettingW);
            if (isModified) {
                newSettingW = settings;
            }
            // Back into the default method once.
            newSettingW.configPassphraseStore = "";
            newSettingW.encryptedPassphrase = "";
            newSettingW.encryptedCouchDBConnection = "";
            newSettingW.additionalSuffixOfDatabaseName = `${"appId" in this.app ? this.app.appId : ""} `;
            const setupJustImport = $msg("Setup.Apply.Buttons.OnlyApply");
            const setupAsNew = $msg("Setup.Apply.Buttons.ApplyAndFetch");
            const setupAsMerge = $msg("Setup.Apply.Buttons.ApplyAndMerge");
            const setupAgain = $msg("Setup.Apply.Buttons.ApplyAndRebuild");
            const setupCancel = $msg("Setup.Apply.Buttons.Cancel");
            newSettingW.syncInternalFiles = false;
            newSettingW.usePluginSync = false;
            newSettingW.isConfigured = true;
            // Migrate completely obsoleted configuration.
            if (!newSettingW.useIndexedDBAdapter) {
                newSettingW.useIndexedDBAdapter = true;
            }
            const warn = shouldRebuild ? $msg("Setup.Apply.WarningRebuildRecommended") : "";
            const message = $msg("Setup.Apply.Message", {
                method,
                warn,
            });

            const setupType = await this.core.confirm.askSelectStringDialogue(
                message,
                [setupAsNew, setupAsMerge, setupAgain, setupJustImport, setupCancel],
                { defaultAction: setupAsNew, title: $msg("Setup.Apply.Title", { method }), timeout: 0 }
            );
            if (setupType == setupJustImport) {
                this.core.settings = newSettingW;
                this.core.$$clearUsedPassphrase();
                await this.core.saveSettings();
            } else if (setupType == setupAsNew) {
                this.core.settings = newSettingW;
                this.core.$$clearUsedPassphrase();
                await this.core.saveSettings();
                await this.core.rebuilder.$fetchLocal();
            } else if (setupType == setupAsMerge) {
                this.core.settings = newSettingW;
                this.core.$$clearUsedPassphrase();
                await this.core.saveSettings();
                await this.core.rebuilder.$fetchLocal(true);
            } else if (setupType == setupAgain) {
                const confirm =
                    "This operation will rebuild all databases with files on this device. Any files on the remote database not synced here will be lost.";
                if (
                    (await this.core.confirm.askSelectStringDialogue(
                        "Are you sure you want to do this?",
                        ["Cancel", confirm],
                        { defaultAction: "Cancel" }
                    )) != confirm
                ) {
                    return;
                }
                this.core.settings = newSettingW;
                await this.core.saveSettings();
                this.core.$$clearUsedPassphrase();
                await this.core.rebuilder.$rebuildEverything();
            } else {
                // Explicitly cancel the operation or the dialog was closed.
                this._log("Cancelled", LOG_LEVEL_NOTICE);
                this.core.settings = oldConf;
                return;
            }
            this._log("Configuration loaded.", LOG_LEVEL_NOTICE);
        } else {
            this._log("Cancelled", LOG_LEVEL_NOTICE);
            this.core.settings = oldConf;
            return;
        }
    }
    async setupWizard(confString: string) {
        try {
            const oldConf = JSON.parse(JSON.stringify(this.settings));
            const encryptingPassphrase = await this.core.confirm.askString(
                "Passphrase",
                "The passphrase to decrypt your setup URI",
                "",
                true
            );
            if (encryptingPassphrase === false) return;
            const newConf = await JSON.parse(await decryptString(confString, encryptingPassphrase));
            if (newConf) {
                await this.applySettingWizard(oldConf, newConf);
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
