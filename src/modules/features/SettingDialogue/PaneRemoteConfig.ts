import {
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    REMOTE_P2P,
    type ObsidianLiveSyncSettings,
} from "../../../lib/src/common/types.ts";
import { $msg } from "../../../lib/src/common/i18n.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
// import { visibleOnly } from "./SettingPane.ts";
import InfoPanel from "./InfoPanel.svelte";
import { writable } from "svelte/store";
import { SveltePanel } from "./SveltePanel.ts";
import {
    getBucketConfigSummary,
    getP2PConfigSummary,
    getCouchDBConfigSummary,
    getE2EEConfigSummary,
} from "./settingUtils.ts";
import { SETTING_KEY_P2P_DEVICE_NAME } from "../../../lib/src/common/types.ts";
import { SetupManager, UserMode } from "../SetupManager.ts";
import { OnDialogSettingsDefault, type AllSettings } from "./settingConstants.ts";

function getSettingsFromEditingSettings(editingSettings: AllSettings): ObsidianLiveSyncSettings {
    const workObj = { ...editingSettings } as ObsidianLiveSyncSettings;
    const keys = Object.keys(OnDialogSettingsDefault);
    for (const k of keys) {
        delete (workObj as any)[k];
    }
    return workObj;
}
const toggleActiveSyncClass = (el: HTMLElement, isActive: () => boolean) => {
    if (isActive()) {
        el.addClass("active-pane");
    } else {
        el.removeClass("active-pane");
    }
    return {};
};

export function paneRemoteConfig(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel, addPane }: PageFunctions
): void {
    const remoteNameMap = {
        [REMOTE_COUCHDB]: $msg("obsidianLiveSyncSettingTab.optionCouchDB"),
        [REMOTE_MINIO]: $msg("obsidianLiveSyncSettingTab.optionMinioS3R2"),
        [REMOTE_P2P]: "Only Peer-to-Peer",
    } as const;

    {
        /* E2EE */
        const E2EEInitialProps = {
            info: getE2EEConfigSummary({ ...this.editingSettings }),
        };
        const E2EESummaryWritable = writable(E2EEInitialProps);
        const updateE2EESummary = () => {
            E2EESummaryWritable.set({
                info: getE2EEConfigSummary(this.editingSettings),
            });
        };
        void addPanel(paneEl, "E2EE Configuration", () => {}).then((paneEl) => {
            new SveltePanel(InfoPanel, paneEl, E2EESummaryWritable);
            const setupButton = new Setting(paneEl).setName("Configure E2EE");
            setupButton
                .addButton((button) =>
                    button
                        .onClick(async () => {
                            const setupManager = this.plugin.getModule(SetupManager);
                            const originalSettings = getSettingsFromEditingSettings(this.editingSettings);
                            await setupManager.onlyE2EEConfiguration(UserMode.Update, originalSettings);
                            updateE2EESummary();
                        })
                        .setButtonText("Configure")
                        .setWarning()
                )
                .addButton((button) =>
                    button
                        .onClick(async () => {
                            const setupManager = this.plugin.getModule(SetupManager);
                            const originalSettings = getSettingsFromEditingSettings(this.editingSettings);
                            await setupManager.onConfigureManually(originalSettings, UserMode.Update);
                            updateE2EESummary();
                        })
                        .setButtonText("Configure And Change Remote")
                        .setWarning()
                );
            updateE2EESummary();
        });
    }
    {
        void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleRemoteServer"), () => {}).then((paneEl) => {
            const setting = new Setting(paneEl).setName("Active Remote Configuration");

            const el = setting.controlEl.createDiv({});
            el.setText(`${remoteNameMap[this.editingSettings.remoteType] || " - "}`);
            setting.addButton((button) =>
                button
                    .setButtonText("Change Remote and Setup")
                    .setCta()
                    .onClick(async () => {
                        const setupManager = this.plugin.getModule(SetupManager);
                        const originalSettings = getSettingsFromEditingSettings(this.editingSettings);
                        await setupManager.onSelectServer(originalSettings, UserMode.Update);
                    })
            );
        });
    }
    {
        const initialProps = {
            info: getCouchDBConfigSummary(this.editingSettings),
        };
        const summaryWritable = writable(initialProps);
        const updateSummary = () => {
            summaryWritable.set({
                info: getCouchDBConfigSummary(this.editingSettings),
            });
        };
        void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleCouchDB"), () => {}).then((paneEl) => {
            new SveltePanel(InfoPanel, paneEl, summaryWritable);
            const setupButton = new Setting(paneEl).setName("Configure Remote");
            setupButton
                .addButton((button) =>
                    button
                        .setButtonText("Configure")
                        .setCta()
                        .onClick(async () => {
                            const setupManager = this.plugin.getModule(SetupManager);
                            const originalSettings = getSettingsFromEditingSettings(this.editingSettings);
                            await setupManager.onCouchDBManualSetup(
                                UserMode.Update,
                                originalSettings,
                                this.editingSettings.remoteType === REMOTE_COUCHDB
                            );

                            updateSummary();
                        })
                )
                .addOnUpdate(() =>
                    toggleActiveSyncClass(paneEl, () => this.editingSettings.remoteType === REMOTE_COUCHDB)
                );
        });
    }
    {
        const initialProps = {
            info: getBucketConfigSummary(this.editingSettings),
        };
        const summaryWritable = writable(initialProps);
        const updateSummary = () => {
            summaryWritable.set({
                info: getBucketConfigSummary(this.editingSettings),
            });
        };
        void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleMinioS3R2"), () => {}).then((paneEl) => {
            new SveltePanel(InfoPanel, paneEl, summaryWritable);
            const setupButton = new Setting(paneEl).setName("Configure Remote");
            setupButton
                .addButton((button) =>
                    button
                        .setButtonText("Configure")
                        .setCta()
                        .onClick(async () => {
                            const setupManager = this.plugin.getModule(SetupManager);
                            const originalSettings = getSettingsFromEditingSettings(this.editingSettings);
                            await setupManager.onBucketManualSetup(
                                UserMode.Update,
                                originalSettings,
                                this.editingSettings.remoteType === REMOTE_MINIO
                            );
                            //TODO
                            updateSummary();
                        })
                )
                .addOnUpdate(() =>
                    toggleActiveSyncClass(paneEl, () => this.editingSettings.remoteType === REMOTE_MINIO)
                );
        });
    }
    {
        const getDevicePeerId = () => this.services.config.getSmallConfig(SETTING_KEY_P2P_DEVICE_NAME) || "";
        const initialProps = {
            info: getP2PConfigSummary(this.editingSettings, {
                "Device Peer ID": getDevicePeerId(),
            }),
        };
        const summaryWritable = writable(initialProps);
        const updateSummary = () => {
            summaryWritable.set({
                info: getP2PConfigSummary(this.editingSettings, {
                    "Device Peer ID": getDevicePeerId(),
                }),
            });
        };
        void addPanel(paneEl, "Peer-to-Peer Synchronisation", () => {}).then((paneEl) => {
            new SveltePanel(InfoPanel, paneEl, summaryWritable);
            const setupButton = new Setting(paneEl).setName("Configure Remote");
            setupButton
                .addButton((button) =>
                    button
                        .setButtonText("Configure")
                        .setCta()
                        .onClick(async () => {
                            const setupManager = this.plugin.getModule(SetupManager);
                            const originalSettings = getSettingsFromEditingSettings(this.editingSettings);
                            await setupManager.onP2PManualSetup(
                                UserMode.Update,
                                originalSettings,
                                this.editingSettings.remoteType === REMOTE_P2P
                            );
                            //TODO
                            updateSummary();
                        })
                )
                .addOnUpdate(() =>
                    toggleActiveSyncClass(
                        paneEl,
                        () => this.editingSettings.remoteType === REMOTE_P2P || this.editingSettings.P2P_Enabled
                    )
                );
        });
    }

    // new Setting(paneEl)
    //     .setDesc("Generate ES256 Keypair for testing")
    //     .addButton((button) =>
    //         button.setButtonText("Generate").onClick(async () => {
    //             const crypto = await getWebCrypto();
    //             const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    //                 "sign",
    //                 "verify",
    //             ]);
    //             const pubKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);
    //             const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    //             const encodedPublicKey = await arrayBufferToBase64Single(pubKey);
    //             const encodedPrivateKey = await arrayBufferToBase64Single(privateKey);

    //             const privateKeyPem = `> -----BEGIN PRIVATE KEY-----\n> ${encodedPrivateKey}\n> -----END PRIVATE KEY-----`;
    //             const publicKeyPem = `> -----BEGIN PUBLIC KEY-----\\n${encodedPublicKey}\\n-----END PUBLIC KEY-----`;

    //             const title = $msg("Setting.GenerateKeyPair.Title");
    //             const msg = $msg("Setting.GenerateKeyPair.Desc", {
    //                 public_key: publicKeyPem,
    //                 private_key: privateKeyPem,
    //             });
    //             await MarkdownRenderer.render(
    //                 this.plugin.app,
    //                 "## " + title + "\n\n" + msg,
    //                 generatedKeyDivEl,
    //                 "/",
    //                 this.plugin
    //             );
    //         })
    //     )
    //     .addOnUpdate(
    //         combineOnUpdate(
    //             this.enableOnlySyncDisabled,
    //             visibleOnly(() => this.editingSettings.useJWT)
    //         )
    //     );

    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleNotification"), () => {}).then((paneEl) => {
        paneEl.addClass("wizardHidden");
        new Setting(paneEl).autoWireNumeric("notifyThresholdOfRemoteStorageSize", {}).setClass("wizardHidden");
    });

    // new Setting(paneEl).setClass("wizardOnly").addButton((button) =>
    //     button
    //         .setButtonText($msg("obsidianLiveSyncSettingTab.buttonNext"))
    //         .setCta()
    //         .setDisabled(false)
    //         .onClick(async () => {
    //             if (!(await checkConfig(checkResultDiv))) {
    //                 if (
    //                     (await this.plugin.confirm.askYesNoDialog(
    //                         $msg("obsidianLiveSyncSettingTab.msgConfigCheckFailed"),
    //                         {
    //                             defaultOption: "No",
    //                             title: $msg("obsidianLiveSyncSettingTab.titleRemoteConfigCheckFailed"),
    //                         }
    //                     )) == "no"
    //                 ) {
    //                     return;
    //                 }
    //             }
    //             const isEncryptionFullyEnabled =
    //                 !this.editingSettings.encrypt || !this.editingSettings.usePathObfuscation;
    //             if (isEncryptionFullyEnabled) {
    //                 if (
    //                     (await this.plugin.confirm.askYesNoDialog(
    //                         $msg("obsidianLiveSyncSettingTab.msgEnableEncryptionRecommendation"),
    //                         {
    //                             defaultOption: "No",
    //                             title: $msg("obsidianLiveSyncSettingTab.titleEncryptionNotEnabled"),
    //                         }
    //                     )) == "no"
    //                 ) {
    //                     return;
    //                 }
    //             }
    //             if (!this.editingSettings.encrypt) {
    //                 this.editingSettings.passphrase = "";
    //             }
    //             if (!(await this.isPassphraseValid())) {
    //                 if (
    //                     (await this.plugin.confirm.askYesNoDialog(
    //                         $msg("obsidianLiveSyncSettingTab.msgInvalidPassphrase"),
    //                         {
    //                             defaultOption: "No",
    //                             title: $msg("obsidianLiveSyncSettingTab.titleEncryptionPassphraseInvalid"),
    //                         }
    //                     )) == "no"
    //                 ) {
    //                     return;
    //                 }
    //             }
    //             if (isCloudantURI(this.editingSettings.couchDB_URI)) {
    //                 this.editingSettings = { ...this.editingSettings, ...PREFERRED_SETTING_CLOUDANT };
    //             } else if (this.editingSettings.remoteType == REMOTE_MINIO) {
    //                 this.editingSettings = { ...this.editingSettings, ...PREFERRED_JOURNAL_SYNC };
    //             } else {
    //                 this.editingSettings = { ...this.editingSettings, ...PREFERRED_SETTING_SELF_HOSTED };
    //             }
    //             if (
    //                 (await this.plugin.confirm.askYesNoDialog(
    //                     $msg("obsidianLiveSyncSettingTab.msgFetchConfigFromRemote"),
    //                     { defaultOption: "Yes", title: $msg("obsidianLiveSyncSettingTab.titleFetchConfig") }
    //                 )) == "yes"
    //             ) {
    //                 const trialSetting = { ...this.initialSettings, ...this.editingSettings };
    //                 const newTweaks = await this.services.tweakValue.checkAndAskUseRemoteConfiguration(trialSetting);
    //                 if (newTweaks.result !== false) {
    //                     this.editingSettings = { ...this.editingSettings, ...newTweaks.result };
    //                     this.requestUpdate();
    //                 } else {
    //                     // Messages should be already shown.
    //                 }
    //             }
    //             this.changeDisplay("30");
    //         })
    // );
}
