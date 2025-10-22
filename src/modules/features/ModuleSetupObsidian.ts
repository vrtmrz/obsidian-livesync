import {
    type ObsidianLiveSyncSettings,
    DEFAULT_SETTINGS,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    REMOTE_P2P,
} from "../../lib/src/common/types.ts";
import { SETTING_KEY_P2P_DEVICE_NAME } from "../../lib/src/common/types.ts";
import { configURIBase } from "../../common/types.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser.js";
import { fireAndForget, generatePatchObj, isObjectDifferent } from "../../lib/src/common/utils.ts";
import {
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_SHOW_SETUP_QR,
    eventHub,
} from "../../common/events.ts";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { $msg } from "../../lib/src/common/i18n.ts";
// import { performDoctorConsultation, RebuildOptions } from "@/lib/src/common/configForDoc.ts";
import type { LiveSyncCore } from "../../main.ts";
import { SvelteDialogManager } from "./SetupWizard/ObsidianSvelteDialog.ts";
import Intro from "./SetupWizard/dialogs/Intro.svelte";
import SelectMethodNewUser from "./SetupWizard/dialogs/SelectMethodNewUser.svelte";
import SelectMethodExisting from "./SetupWizard/dialogs/SelectMethodExisting.svelte";
import ScanQRCode from "./SetupWizard/dialogs/ScanQRCode.svelte";
import UseSetupURI from "./SetupWizard/dialogs/UseSetupURI.svelte";
import OutroNewUser from "./SetupWizard/dialogs/OutroNewUser.svelte";
import OutroExistingUser from "./SetupWizard/dialogs/OutroExistingUser.svelte";
import OutroAskUserMode from "./SetupWizard/dialogs/OutroAskUserMode.svelte";
import SetupRemote from "./SetupWizard/dialogs/SetupRemote.svelte";
import SetupRemoteCouchDB from "./SetupWizard/dialogs/SetupRemoteCouchDB.svelte";
import SetupRemoteBucket from "./SetupWizard/dialogs/SetupRemoteBucket.svelte";
import SetupRemoteP2P from "./SetupWizard/dialogs/SetupRemoteP2P.svelte";
import SetupRemoteE2EE from "./SetupWizard/dialogs/SetupRemoteE2EE.svelte";
import {
    decodeSettingsFromQRCodeData,
    encodeQR,
    encodeSettingsToQRCodeData,
    encodeSettingsToSetupURI,
    OutputFormat,
} from "../../lib/src/API/processSetting.ts";
// import type ObsidianLiveSyncPlugin from "../../main.ts";
export const enum UserMode {
    NewUser = "new-user",
    ExistingUser = "existing-user",
    Unknown = "unknown",
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
    Update = "unknown", // Alias for Unknown for better readability
}

export class SetupManager extends AbstractObsidianModule {
    private dialogManager: SvelteDialogManager = new SvelteDialogManager(this.plugin);

    async startOnBoarding(): Promise<boolean> {
        const isUserNewOrExisting = await this.dialogManager.openWithExplicitCancel(Intro);
        if (isUserNewOrExisting === "new-user") {
            await this.onBoard(UserMode.NewUser);
        } else if (isUserNewOrExisting === "existing-user") {
            await this.onBoard(UserMode.ExistingUser);
        } else if (isUserNewOrExisting === "cancelled") {
            this._log("Onboarding cancelled by user.", LOG_LEVEL_NOTICE);
            return false;
        }
        return false;
    }

    async onBoard(userMode: UserMode): Promise<boolean> {
        const originalSetting = userMode === UserMode.NewUser ? DEFAULT_SETTINGS : this.core.settings;
        if (userMode === UserMode.NewUser) {
            //Ask how to apply initial setup
            const method = await this.dialogManager.openWithExplicitCancel(SelectMethodNewUser);
            if (method === "use-setup-uri") {
                await this.onUseSetupURI(userMode);
            } else if (method === "configure-manually") {
                await this.onConfigureManually(originalSetting, userMode);
            } else if (method === "cancelled") {
                this._log("Onboarding cancelled by user.", LOG_LEVEL_NOTICE);
                return false;
            }
        } else if (userMode === UserMode.ExistingUser) {
            const method = await this.dialogManager.openWithExplicitCancel(SelectMethodExisting);
            if (method === "use-setup-uri") {
                await this.onUseSetupURI(userMode);
            } else if (method === "configure-manually") {
                await this.onConfigureManually(originalSetting, userMode);
            } else if (method === "scan-qr-code") {
                await this.onPromptQRCodeInstruction();
            } else if (method === "cancelled") {
                this._log("Onboarding cancelled by user.", LOG_LEVEL_NOTICE);
                return false;
            }
        }
        return false;
    }

    async onUseSetupURI(userMode: UserMode, setupURI: string = ""): Promise<boolean> {
        const newSetting = await this.dialogManager.openWithExplicitCancel(UseSetupURI, setupURI);
        if (newSetting === "cancelled") {
            this._log("Setup URI dialog cancelled.", LOG_LEVEL_NOTICE);
            return false;
        }
        this._log("Setup URI dialog closed.", LOG_LEVEL_VERBOSE);
        return await this.confirmApplySettingsFromWizard(newSetting, userMode);
    }
    async onCouchDBManualSetup(
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate = true
    ): Promise<boolean> {
        const originalSetting = JSON.parse(JSON.stringify(currentSetting)) as ObsidianLiveSyncSettings;
        const baseSetting = JSON.parse(JSON.stringify(originalSetting)) as ObsidianLiveSyncSettings;
        const couchConf = await this.dialogManager.openWithExplicitCancel(SetupRemoteCouchDB, originalSetting);
        if (couchConf === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await this.onBoard(userMode);
        }
        const newSetting = { ...baseSetting, ...couchConf } as ObsidianLiveSyncSettings;
        if (activate) {
            newSetting.remoteType = REMOTE_COUCHDB;
        }
        return await this.confirmApplySettingsFromWizard(newSetting, userMode, activate);
    }

    async onBucketManualSetup(
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate = true
    ): Promise<boolean> {
        const bucketConf = await this.dialogManager.openWithExplicitCancel(SetupRemoteBucket, currentSetting);
        if (bucketConf === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await this.onBoard(userMode);
        }
        const newSetting = { ...currentSetting, ...bucketConf } as ObsidianLiveSyncSettings;
        if (activate) {
            newSetting.remoteType = REMOTE_MINIO;
        }
        return await this.confirmApplySettingsFromWizard(newSetting, userMode, activate);
    }
    async onP2PManualSetup(
        userMode: UserMode,
        currentSetting: ObsidianLiveSyncSettings,
        activate = true
    ): Promise<boolean> {
        const p2pConf = await this.dialogManager.openWithExplicitCancel(SetupRemoteP2P, currentSetting);
        if (p2pConf === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await this.onBoard(userMode);
        }
        const newSetting = { ...currentSetting, ...p2pConf.info } as ObsidianLiveSyncSettings;
        if (activate) {
            newSetting.remoteType = REMOTE_P2P;
        }
        return await this.confirmApplySettingsFromWizard(newSetting, userMode, activate, () => {
            this.services.config.setSmallConfig(SETTING_KEY_P2P_DEVICE_NAME, p2pConf.devicePeerId);
        });
    }
    async onlyE2EEConfiguration(userMode: UserMode, currentSetting: ObsidianLiveSyncSettings): Promise<boolean> {
        const e2eeConf = await this.dialogManager.openWithExplicitCancel(SetupRemoteE2EE, currentSetting);
        if (e2eeConf === "cancelled") {
            this._log("E2EE configuration cancelled.", LOG_LEVEL_NOTICE);
            return await false;
        }
        const newSetting = {
            ...currentSetting,
            ...e2eeConf,
        } as ObsidianLiveSyncSettings;
        return await this.confirmApplySettingsFromWizard(newSetting, userMode);
    }
    async onConfigureManually(originalSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean> {
        const e2eeConf = await this.dialogManager.openWithExplicitCancel(SetupRemoteE2EE, originalSetting);
        if (e2eeConf === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            return await this.onBoard(userMode);
        }
        const currentSetting = {
            ...originalSetting,
            ...e2eeConf,
        } as ObsidianLiveSyncSettings;
        return await this.selectServer(currentSetting, userMode);
    }

    async selectServer(currentSetting: ObsidianLiveSyncSettings, userMode: UserMode): Promise<boolean> {
        const method = await this.dialogManager.openWithExplicitCancel(SetupRemote);
        if (method === "couchdb") {
            return await this.onCouchDBManualSetup(userMode, currentSetting, true);
        } else if (method === "bucket") {
            return await this.onBucketManualSetup(userMode, currentSetting, true);
        } else if (method === "p2p") {
            return await this.onP2PManualSetup(userMode, currentSetting, true);
        } else if (method === "cancelled") {
            this._log("Manual configuration cancelled.", LOG_LEVEL_NOTICE);
            if (userMode !== UserMode.Unknown) {
                return await this.onBoard(userMode);
            }
        }
        // Should not reach here.
        return false;
    }
    async confirmApplySettingsFromWizard(
        newConf: ObsidianLiveSyncSettings,
        _userMode: UserMode,
        activate: boolean = true,
        extra: () => void = () => {}
    ): Promise<boolean> {
        let userMode = _userMode;
        // let rebuildRequired = true;
        if (userMode === UserMode.Unknown) {
            if (isObjectDifferent(this.settings, newConf, true) === false) {
                this._log("No changes in settings detected. Skipping applying settings from wizard.", LOG_LEVEL_NOTICE);
                return true;
            }
            const patch = generatePatchObj(this.settings, newConf);
            console.log(`Changes:`);
            console.dir(patch);
            if (!activate) {
                extra();
                await this.applySetting(newConf, UserMode.ExistingUser);
                this._log("Setting Applied", LOG_LEVEL_NOTICE);
                return true;
            }
            const userModeResult = await this.dialogManager.openWithExplicitCancel(OutroAskUserMode);
            if (userModeResult === "new-user") {
                userMode = UserMode.NewUser;
            } else if (userModeResult === "existing-user") {
                userMode = UserMode.ExistingUser;
            } else if (userModeResult === "compatible-existing-user") {
                extra();
                await this.applySetting(newConf, UserMode.ExistingUser);
                this._log("Settings from wizard applied.", LOG_LEVEL_NOTICE);
                return true;
            } else if (userModeResult === "cancelled") {
                this._log("User cancelled applying settings from wizard.", LOG_LEVEL_NOTICE);
                return false;
            }
        }
        const component = userMode === UserMode.NewUser ? OutroNewUser : OutroExistingUser;
        const confirm = await this.dialogManager.openWithExplicitCancel(component);
        if (confirm === "cancelled") {
            this._log("User cancelled applying settings from wizard..", LOG_LEVEL_NOTICE);
            return false;
        }
        if (confirm) {
            extra();
            await this.applySetting(newConf, userMode);
            if (userMode === UserMode.NewUser) {
                // For new users, schedule a rebuild everything.
                await this.core.rebuilder.scheduleRebuild();
            } else {
                // For existing users, schedule a fetch.
                await this.core.rebuilder.scheduleFetch();
            }
        }
        // Settings applied, but may require rebuild to take effect.
        return false;
    }

    async onPromptQRCodeInstruction(): Promise<boolean> {
        const qrResult = await this.dialogManager.open(ScanQRCode);
        this._log("QR Code dialog closed.", LOG_LEVEL_VERBOSE);
        // Result is not used, but log it for debugging.
        this._log(`QR Code result: ${qrResult}`, LOG_LEVEL_VERBOSE);
        // QR Code instruction dialog never yields settings directly.
        return false;
    }

    async decodeQR(qr: string) {
        const newSettings = decodeSettingsFromQRCodeData(qr);
        return await this.confirmApplySettingsFromWizard(newSettings, UserMode.Unknown);
    }

    async applySetting(newConf: ObsidianLiveSyncSettings, userMode: UserMode) {
        const newSetting = {
            ...this.core.settings,
            ...newConf,
        };
        this.core.settings = newSetting;
        this.services.setting.clearUsedPassphrase();
        await this.services.setting.saveSettingData();
        return true;
    }
}

export class ModuleSetupObsidian extends AbstractObsidianModule {
    private _setupManager!: SetupManager;
    private _everyOnload(): Promise<boolean> {
        this._setupManager = this.plugin.getModule(SetupManager);
        this.registerObsidianProtocolHandler("setuplivesync", async (conf: any) => {
            if (conf.settings) {
                await this._setupManager.onUseSetupURI(
                    UserMode.Unknown,
                    `${configURIBase}${encodeURIComponent(conf.settings)}`
                );
            } else if (conf.settingsQR) {
                await this._setupManager.decodeQR(conf.settingsQR);
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
        const settingString = encodeSettingsToQRCodeData(this.settings);
        const codeSVG = encodeQR(settingString, OutputFormat.SVG);
        const msg = $msg("Setup.QRCode", { qr_image: codeSVG });
        await this.core.confirm.confirmWithMessage("Settings QR Code", msg, ["OK"], "OK");
        return await Promise.resolve(codeSVG);
    }

    async askEncryptingPassphrase(): Promise<string | false> {
        const encryptingPassphrase = await this.core.confirm.askString(
            "Encrypt your settings",
            "The passphrase to encrypt the setup URI",
            "",
            true
        );
        return encryptingPassphrase;
    }

    async command_copySetupURI(stripExtra = true) {
        const encryptingPassphrase = await this.askEncryptingPassphrase();
        if (encryptingPassphrase === false) return;
        const encryptedURI = await encodeSettingsToSetupURI(
            this.settings,
            encryptingPassphrase,
            [...((stripExtra ? ["pluginSyncExtendedSetting"] : []) as (keyof ObsidianLiveSyncSettings)[])],
            true
        );
        if (await this.services.UI.promptCopyToClipboard("Setup URI", encryptedURI)) {
            this._log("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
        }
        // await navigator.clipboard.writeText(encryptedURI);
    }

    async command_copySetupURIFull() {
        const encryptingPassphrase = await this.askEncryptingPassphrase();
        if (encryptingPassphrase === false) return;
        const encryptedURI = await encodeSettingsToSetupURI(this.settings, encryptingPassphrase, [], false);
        await navigator.clipboard.writeText(encryptedURI);
        this._log("Setup URI copied to clipboard", LOG_LEVEL_NOTICE);
    }

    async command_copySetupURIWithSync() {
        await this.command_copySetupURI(false);
    }
    async command_openSetupURI() {
        await this._setupManager.onUseSetupURI(UserMode.Unknown);
    }

    // async askSyncWithRemoteConfig(tryingSettings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings> {
    //     const buttons = {
    //         fetch: $msg("Setup.FetchRemoteConf.Buttons.Fetch"),
    //         no: $msg("Setup.FetchRemoteConf.Buttons.Skip"),
    //     } as const;
    //     const fetchRemoteConf = await this.core.confirm.askSelectStringDialogue(
    //         $msg("Setup.FetchRemoteConf.Message"),
    //         Object.values(buttons),
    //         { defaultAction: buttons.fetch, timeout: 0, title: $msg("Setup.FetchRemoteConf.Title") }
    //     );
    //     if (fetchRemoteConf == buttons.no) {
    //         return tryingSettings;
    //     }

    //     const newSettings = JSON.parse(JSON.stringify(tryingSettings)) as ObsidianLiveSyncSettings;
    //     const remoteConfig = await this.services.tweakValue.fetchRemotePreferred(newSettings);
    //     if (remoteConfig) {
    //         this._log("Remote configuration found.", LOG_LEVEL_NOTICE);
    //         const resultSettings = {
    //             ...DEFAULT_SETTINGS,
    //             ...tryingSettings,
    //             ...remoteConfig,
    //         } satisfies ObsidianLiveSyncSettings;
    //         return resultSettings;
    //     } else {
    //         this._log("Remote configuration not applied.", LOG_LEVEL_NOTICE);
    //         return {
    //             ...DEFAULT_SETTINGS,
    //             ...tryingSettings,
    //         } satisfies ObsidianLiveSyncSettings;
    //     }
    // }
    // async askPerformDoctor(
    //     tryingSettings: ObsidianLiveSyncSettings
    // ): Promise<{ settings: ObsidianLiveSyncSettings; shouldRebuild: boolean; isModified: boolean }> {
    //     const buttons = {
    //         yes: $msg("Setup.Doctor.Buttons.Yes"),
    //         no: $msg("Setup.Doctor.Buttons.No"),
    //     } as const;
    //     const performDoctor = await this.core.confirm.askSelectStringDialogue(
    //         $msg("Setup.Doctor.Message"),
    //         Object.values(buttons),
    //         { defaultAction: buttons.yes, timeout: 0, title: $msg("Setup.Doctor.Title") }
    //     );
    //     if (performDoctor == buttons.no) {
    //         return { settings: tryingSettings, shouldRebuild: false, isModified: false };
    //     }

    //     const newSettings = JSON.parse(JSON.stringify(tryingSettings)) as ObsidianLiveSyncSettings;
    //     const { settings, shouldRebuild, isModified } = await performDoctorConsultation(this.core, newSettings, {
    //         localRebuild: RebuildOptions.AutomaticAcceptable, // Because we are in the setup wizard, we can skip the confirmation.
    //         remoteRebuild: RebuildOptions.SkipEvenIfRequired,
    //         activateReason: "New settings from URI",
    //     });
    //     if (isModified) {
    //         this._log("Doctor has fixed some issues!", LOG_LEVEL_NOTICE);
    //         return {
    //             settings,
    //             shouldRebuild,
    //             isModified,
    //         };
    //     } else {
    //         this._log("Doctor detected no issues!", LOG_LEVEL_NOTICE);
    //         return { settings: tryingSettings, shouldRebuild: false, isModified: false };
    //     }
    // }

    // async applySettingWizard(
    //     oldConf: ObsidianLiveSyncSettings,
    //     newConf: ObsidianLiveSyncSettings,
    //     method = "Setup URI"
    // ) {
    //     const result = await this.core.confirm.askYesNoDialog(
    //         "Importing Configuration from the " + method + ". Are you sure to proceed ? ",
    //         {}
    //     );
    //     if (result == "yes") {
    //         let newSettingW = Object.assign({}, DEFAULT_SETTINGS, newConf) as ObsidianLiveSyncSettings;
    //         this.core.replicator.closeReplication();
    //         this.settings.suspendFileWatching = true;
    //         newSettingW = await this.askSyncWithRemoteConfig(newSettingW);
    //         const { settings, shouldRebuild, isModified } = await this.askPerformDoctor(newSettingW);
    //         if (isModified) {
    //             newSettingW = settings;
    //         }
    //         // Back into the default method once.
    //         newSettingW.configPassphraseStore = "";
    //         newSettingW.encryptedPassphrase = "";
    //         newSettingW.encryptedCouchDBConnection = "";
    //         newSettingW.additionalSuffixOfDatabaseName = `${"appId" in this.app ? this.app.appId : ""} `;
    //         const setupJustImport = $msg("Setup.Apply.Buttons.OnlyApply");
    //         const setupAsNew = $msg("Setup.Apply.Buttons.ApplyAndFetch");
    //         const setupAsMerge = $msg("Setup.Apply.Buttons.ApplyAndMerge");
    //         const setupAgain = $msg("Setup.Apply.Buttons.ApplyAndRebuild");
    //         const setupCancel = $msg("Setup.Apply.Buttons.Cancel");
    //         newSettingW.syncInternalFiles = false;
    //         newSettingW.usePluginSync = false;
    //         newSettingW.isConfigured = true;
    //         // Migrate completely obsoleted configuration.
    //         if (!newSettingW.useIndexedDBAdapter) {
    //             newSettingW.useIndexedDBAdapter = true;
    //         }
    //         const warn = shouldRebuild ? $msg("Setup.Apply.WarningRebuildRecommended") : "";
    //         const message = $msg("Setup.Apply.Message", {
    //             method,
    //             warn,
    //         });

    //         const setupType = await this.core.confirm.askSelectStringDialogue(
    //             message,
    //             [setupAsNew, setupAsMerge, setupAgain, setupJustImport, setupCancel],
    //             { defaultAction: setupAsNew, title: $msg("Setup.Apply.Title", { method }), timeout: 0 }
    //         );
    //         if (setupType == setupJustImport) {
    //             this.core.settings = newSettingW;
    //             this.services.setting.clearUsedPassphrase();
    //             await this.core.saveSettings();
    //         } else if (setupType == setupAsNew) {
    //             this.core.settings = newSettingW;
    //             this.services.setting.clearUsedPassphrase();
    //             await this.core.saveSettings();
    //             await this.core.rebuilder.$fetchLocal();
    //         } else if (setupType == setupAsMerge) {
    //             this.core.settings = newSettingW;
    //             this.services.setting.clearUsedPassphrase();
    //             await this.core.saveSettings();
    //             await this.core.rebuilder.$fetchLocal(true);
    //         } else if (setupType == setupAgain) {
    //             const confirm =
    //                 "This operation will rebuild all databases with files on this device. Any files on the remote database not synced here will be lost.";
    //             if (
    //                 (await this.core.confirm.askSelectStringDialogue(
    //                     "Are you sure you want to do this?",
    //                     ["Cancel", confirm],
    //                     { defaultAction: "Cancel" }
    //                 )) != confirm
    //             ) {
    //                 return;
    //             }
    //             this.core.settings = newSettingW;
    //             await this.core.saveSettings();
    //             this.services.setting.clearUsedPassphrase();
    //             await this.core.rebuilder.$rebuildEverything();
    //         } else {
    //             // Explicitly cancel the operation or the dialog was closed.
    //             this._log("Cancelled", LOG_LEVEL_NOTICE);
    //             this.core.settings = oldConf;
    //             return;
    //         }
    //         this._log("Configuration loaded.", LOG_LEVEL_NOTICE);
    //     } else {
    //         this._log("Cancelled", LOG_LEVEL_NOTICE);
    //         this.core.settings = oldConf;
    //         return;
    //     }
    // }
    // async setupWizard(confString: string) {
    //     try {
    //         const oldConf = JSON.parse(JSON.stringify(this.settings));
    //         const encryptingPassphrase = await this.core.confirm.askString(
    //             "Passphrase",
    //             "The passphrase to decrypt your setup URI",
    //             "",
    //             true
    //         );
    //         if (encryptingPassphrase === false) return;
    //         const newConf = await JSON.parse(await decryptString(confString, encryptingPassphrase));
    //         if (newConf) {
    //             await this.applySettingWizard(oldConf, newConf);
    //             this._log("Configuration loaded.", LOG_LEVEL_NOTICE);
    //         } else {
    //             this._log("Cancelled.", LOG_LEVEL_NOTICE);
    //         }
    //     } catch (ex) {
    //         this._log("Couldn't parse or decrypt configuration uri.", LOG_LEVEL_NOTICE);
    //         this._log(ex, LOG_LEVEL_VERBOSE);
    //     }
    // }

    // async askHowToApplySetupURI() {
    //     const method = await this.dialogManager.openWithExplicitCancel(OutroAskUserMode);
    //     if( method === "new-user") {
    //         return UserMode.NewUser;
    //     }
    // }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.handleOnLoaded(this._everyOnload.bind(this));
    }
}
