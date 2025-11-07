import { type ObsidianLiveSyncSettings, LOG_LEVEL_NOTICE } from "../../lib/src/common/types.ts";
import { configURIBase } from "../../common/types.ts";
// import { PouchDB } from "../../lib/src/pouchdb/pouchdb-browser.js";
import { fireAndForget } from "../../lib/src/common/utils.ts";
import {
    EVENT_REQUEST_COPY_SETUP_URI,
    EVENT_REQUEST_OPEN_P2P_SETTINGS,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_SHOW_SETUP_QR,
    eventHub,
} from "../../common/events.ts";
import { AbstractObsidianModule } from "../AbstractObsidianModule.ts";
import { $msg } from "../../lib/src/common/i18n.ts";
// import { performDoctorConsultation, RebuildOptions } from "@/lib/src/common/configForDoc.ts";
import type { LiveSyncCore } from "../../main.ts";
import {
    encodeQR,
    encodeSettingsToQRCodeData,
    encodeSettingsToSetupURI,
    OutputFormat,
} from "../../lib/src/API/processSetting.ts";
import { SetupManager, UserMode } from "./SetupManager.ts";

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
        eventHub.onEvent(EVENT_REQUEST_OPEN_P2P_SETTINGS, () =>
            fireAndForget(() => {
                return this._setupManager.onP2PManualSetup(UserMode.Update, this.settings, false);
            })
        );
        return Promise.resolve(true);
    }
    async encodeQR() {
        const settingString = encodeSettingsToQRCodeData(this.settings);
        const codeSVG = encodeQR(settingString, OutputFormat.SVG);
        if (codeSVG == "") {
            return "";
        }
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

    // TODO: Where to implement these?

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

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.handleOnLoaded(this._everyOnload.bind(this));
    }
}
