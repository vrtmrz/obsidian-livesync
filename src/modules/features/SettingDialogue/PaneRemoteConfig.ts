import {
    DEFAULT_SETTINGS,
    LOG_LEVEL_NOTICE,
    type ObsidianLiveSyncSettings,
    LOG_LEVEL_VERBOSE,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { Menu, type ButtonComponent } from "@/deps.ts";
import { $msg } from "@/common/translation";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
// import { visibleOnly } from "./SettingPane.ts";
import InfoPanel from "./InfoPanel.svelte";
import { writable } from "svelte/store";
import { SveltePanel } from "./SveltePanel.ts";
import { getE2EEConfigSummary } from "./settingUtils.ts";
import { SetupManager, UserMode } from "@/modules/features/SetupManager.ts";
import { OnDialogSettingsDefault, type AllSettings } from "./settingConstants.ts";
import {
    activateRemoteConfiguration,
    createRemoteConfigurationId,
    defaultRemoteProviderRegistry,
    suggestRemoteConfigurationName,
    type BuiltInRemoteConfiguration,
    type RemoteConfiguration,
} from "@vrtmrz/livesync-commonlib/remote-configurations";
import { syncActivatedRemoteSettings } from "./remoteConfigBuffer.ts";

function getSettingsFromEditingSettings(editingSettings: AllSettings): ObsidianLiveSyncSettings {
    const workObj = { ...editingSettings } as ObsidianLiveSyncSettings;
    const keys = Object.keys(OnDialogSettingsDefault) as (keyof ObsidianLiveSyncSettings)[];
    for (const k of keys) {
        delete workObj[k];
    }
    return workObj;
}
function cloneRemoteConfigurations(
    configs: Record<string, RemoteConfiguration> | undefined
): Record<string, RemoteConfiguration> {
    return Object.fromEntries(Object.entries(configs || {}).map(([id, config]) => [id, { ...config }]));
}

function serializeRemoteConfiguration(settings: ObsidianLiveSyncSettings): string {
    const type = defaultRemoteProviderRegistry.typeForRemoteType(settings.remoteType);
    if (!type) throw new Error(`Unsupported remote type: ${settings.remoteType}`);
    const configuration = defaultRemoteProviderRegistry.configurationFromSettings(type, settings);
    return defaultRemoteProviderRegistry.serialise(configuration);
}

function describeRemoteConfiguration(uri: string): string {
    try {
        const configuration = defaultRemoteProviderRegistry.parse(uri);
        return defaultRemoteProviderRegistry.suggestName(configuration);
    } catch {
        return "";
    }
}

function setEmojiButton(button: ButtonComponent, emoji: string, tooltip: string) {
    button.setButtonText(emoji);
    button.setTooltip(tooltip, { delay: 10, placement: "top" });
    // button.buttonEl.addClass("clickable-icon");
    button.buttonEl.addClass("mod-muted");
    return button;
}

export function paneRemoteConfig(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel, addPane }: PageFunctions
): void {
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
                            const setupManager = this.core.getModule(SetupManager);
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
                            const setupManager = this.core.getModule(SetupManager);
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
        // TODO: very WIP. need to refactor the UI.
        void addPanel(paneEl, $msg("Connection settings"), () => {}).then((paneEl) => {
            const actions = new Setting(paneEl).setName($msg("Saved connections"));
            // actions.addButton((button) =>
            //     button
            //         .setButtonText("Change Remote and Setup")
            //         .setCta()
            //         .onClick(async () => {
            //             const setupManager = this.core.getModule(SetupManager);
            //             const originalSettings = getSettingsFromEditingSettings(this.editingSettings);
            //             await setupManager.onSelectServer(originalSettings, UserMode.Update);
            //         })
            // );

            // Connection List
            const listContainer = paneEl.createDiv({ cls: "sls-remote-list" });
            const syncRemoteConfigurationBuffers = () => {
                const currentConfigs = cloneRemoteConfigurations(this.core.settings.remoteConfigurations);
                this.editingSettings.remoteConfigurations = currentConfigs;
                this.editingSettings.activeConfigurationId = this.core.settings.activeConfigurationId;
                if (this.initialSettings) {
                    this.initialSettings.remoteConfigurations = cloneRemoteConfigurations(currentConfigs);
                    this.initialSettings.activeConfigurationId = this.core.settings.activeConfigurationId;
                }
            };
            const persistRemoteConfigurations = async (synchroniseActiveRemote: boolean = false) => {
                await this.services.setting.updateSettings((currentSettings) => {
                    currentSettings.remoteConfigurations = cloneRemoteConfigurations(
                        this.editingSettings.remoteConfigurations
                    );
                    currentSettings.activeConfigurationId = this.editingSettings.activeConfigurationId;
                    if (synchroniseActiveRemote && currentSettings.activeConfigurationId) {
                        const activated = activateRemoteConfiguration(
                            currentSettings,
                            currentSettings.activeConfigurationId
                        );
                        if (activated) {
                            return activated;
                        }
                    }
                    return currentSettings;
                }, true);

                if (synchroniseActiveRemote) {
                    // Keep both buffers aligned with the newly activated remote before saving any remaining dirty keys.
                    syncActivatedRemoteSettings(this.editingSettings, this.core.settings);
                    if (this.initialSettings) {
                        syncActivatedRemoteSettings(this.initialSettings, this.core.settings);
                    }
                    await this.saveAllDirtySettings();
                }

                syncRemoteConfigurationBuffers();
                this.requestUpdate();
            };
            const runRemoteSetup = async (
                baseSettings: ObsidianLiveSyncSettings,
                type?: BuiltInRemoteConfiguration["type"]
            ): Promise<ObsidianLiveSyncSettings | false> => {
                const setupManager = this.core.getModule(SetupManager);
                return await setupManager.configureRemoteForSettings(baseSettings, type);
            };
            const createBaseRemoteSettings = (): ObsidianLiveSyncSettings => ({
                ...DEFAULT_SETTINGS,
                ...getSettingsFromEditingSettings(this.editingSettings),
            });
            const createNewRemoteSettings = (): ObsidianLiveSyncSettings => ({
                ...DEFAULT_SETTINGS,
                encrypt: this.editingSettings.encrypt,
                usePathObfuscation: this.editingSettings.usePathObfuscation,
                passphrase: this.editingSettings.passphrase,
                configPassphraseStore: this.editingSettings.configPassphraseStore,
            });
            const addRemoteConfiguration = async () => {
                const name = await this.services.UI.confirm.askString("Remote name", "Display name", "New Remote");
                if (name === false) {
                    return;
                }
                const nextSettings = await runRemoteSetup(createNewRemoteSettings());
                if (!nextSettings) {
                    return;
                }
                const id = createRemoteConfigurationId();
                const configs = cloneRemoteConfigurations(this.editingSettings.remoteConfigurations);
                configs[id] = {
                    id,
                    name: name.trim() || "New Remote",
                    uri: serializeRemoteConfiguration(nextSettings),
                    isEncrypted: false,
                };
                this.editingSettings.remoteConfigurations = configs;
                if (!this.editingSettings.activeConfigurationId) {
                    this.editingSettings.activeConfigurationId = id;
                }
                await persistRemoteConfigurations(this.editingSettings.activeConfigurationId === id);
                refreshList();
            };
            const importRemoteConfiguration = async () => {
                const importedURI = await this.services.UI.confirm.askString(
                    "Import connection",
                    "Paste a connection string",
                    ""
                );
                if (importedURI === false) {
                    return;
                }

                const trimmedURI = importedURI.trim();
                if (trimmedURI === "") {
                    return;
                }

                let parsed: BuiltInRemoteConfiguration;
                try {
                    parsed = defaultRemoteProviderRegistry.parse(trimmedURI);
                } catch (ex) {
                    this.services.API.addLog(`Failed to import remote configuration!`, LOG_LEVEL_NOTICE);
                    this.services.API.addLog(ex, LOG_LEVEL_VERBOSE);
                    return;
                }

                const defaultName = suggestRemoteConfigurationName(parsed);
                const name = await this.services.UI.confirm.askString("Remote name", "Display name", defaultName);
                if (name === false) {
                    return;
                }

                const id = createRemoteConfigurationId();
                const configs = cloneRemoteConfigurations(this.editingSettings.remoteConfigurations);
                configs[id] = {
                    id,
                    name: name.trim() || defaultName,
                    uri: defaultRemoteProviderRegistry.serialise(parsed),
                    isEncrypted: false,
                };
                this.editingSettings.remoteConfigurations = configs;
                if (!this.editingSettings.activeConfigurationId) {
                    this.editingSettings.activeConfigurationId = id;
                }
                await persistRemoteConfigurations(this.editingSettings.activeConfigurationId === id);
                refreshList();
            };
            actions.addButton((button) =>
                setEmojiButton(button, "➕", "Add new connection").onClick(async () => {
                    await addRemoteConfiguration();
                })
            );
            actions.addButton((button) =>
                setEmojiButton(button, "📥", "Import connection").onClick(async () => {
                    await importRemoteConfiguration();
                })
            );
            const refreshList = () => {
                listContainer.empty();
                const configs = this.editingSettings.remoteConfigurations || {};
                for (const config of Object.values(configs)) {
                    const row = new Setting(listContainer)
                        .setName(config.name)
                        .setDesc(describeRemoteConfiguration(config.uri));

                    if (config.id === this.editingSettings.activeConfigurationId) {
                        row.nameEl.addClass("sls-active-remote-name");
                        row.nameEl.appendText(" (Active)");
                    }

                    row.addButton((btn) =>
                        setEmojiButton(btn, "🔧", "Configure").onClick(async () => {
                            let parsed: BuiltInRemoteConfiguration;
                            try {
                                parsed = defaultRemoteProviderRegistry.parse(config.uri);
                            } catch (ex) {
                                this.services.API.addLog(
                                    `Failed to parse remote configuration '${config.id}' for editing!`,
                                    LOG_LEVEL_NOTICE
                                );
                                this.services.API.addLog(ex, LOG_LEVEL_VERBOSE);
                                return;
                            }
                            const workSettings = createBaseRemoteSettings();
                            defaultRemoteProviderRegistry.applyConfiguration(workSettings, parsed);

                            const nextSettings = await runRemoteSetup(workSettings, parsed.type);
                            if (!nextSettings) {
                                return;
                            }

                            const nextConfigs = cloneRemoteConfigurations(this.editingSettings.remoteConfigurations);
                            nextConfigs[config.id] = {
                                ...config,
                                uri: serializeRemoteConfiguration(nextSettings),
                                isEncrypted: false,
                            };
                            this.editingSettings.remoteConfigurations = nextConfigs;
                            await persistRemoteConfigurations(config.id === this.editingSettings.activeConfigurationId);
                            refreshList();
                        })
                    );
                    row.addButton((btn) =>
                        btn
                            .setButtonText("✅")
                            .setTooltip("Activate", { delay: 10, placement: "top" })
                            .setDisabled(config.id === this.editingSettings.activeConfigurationId)
                            .onClick(async () => {
                                this.editingSettings.activeConfigurationId = config.id;
                                await persistRemoteConfigurations(true);
                                refreshList();
                            })
                    );

                    row.addButton((btn) =>
                        setEmojiButton(btn, "…", "More actions").onClick(() => {
                            const menu = new Menu()
                                .addItem((item) => {
                                    item.setTitle("🪪 Rename").onClick(async () => {
                                        const nextName = await this.services.UI.confirm.askString(
                                            "Remote name",
                                            "Display name",
                                            config.name
                                        );
                                        if (nextName === false) {
                                            return;
                                        }
                                        const nextConfigs = cloneRemoteConfigurations(
                                            this.editingSettings.remoteConfigurations
                                        );
                                        nextConfigs[config.id] = {
                                            ...config,
                                            name: nextName.trim() || config.name,
                                        };
                                        this.editingSettings.remoteConfigurations = nextConfigs;
                                        await persistRemoteConfigurations();
                                        refreshList();
                                    });
                                })
                                .addItem((item) => {
                                    item.setTitle("📤 Export").onClick(async () => {
                                        await this.services.UI.promptCopyToClipboard(
                                            `Remote configuration: ${config.name}`,
                                            config.uri
                                        );
                                    });
                                })
                                .addItem((item) => {
                                    item.setTitle("🧬 Duplicate").onClick(async () => {
                                        const nextName = await this.services.UI.confirm.askString(
                                            "Duplicate remote",
                                            "Display name",
                                            `${config.name} (Copy)`
                                        );
                                        if (nextName === false) {
                                            return;
                                        }

                                        const nextId = createRemoteConfigurationId();
                                        const nextConfigs = cloneRemoteConfigurations(
                                            this.editingSettings.remoteConfigurations
                                        );
                                        nextConfigs[nextId] = {
                                            ...config,
                                            id: nextId,
                                            name: nextName.trim() || `${config.name} (Copy)`,
                                        };
                                        this.editingSettings.remoteConfigurations = nextConfigs;
                                        await persistRemoteConfigurations();
                                        refreshList();
                                    });
                                })
                                .addSeparator()
                                .addItem((item) => {
                                    item.setTitle("📡 Fetch remote settings").onClick(async () => {
                                        let parsed: BuiltInRemoteConfiguration;
                                        try {
                                            parsed = defaultRemoteProviderRegistry.parse(config.uri);
                                        } catch (ex) {
                                            this.services.API.addLog(
                                                `Failed to parse remote configuration '${config.id}' for fetching settings!`,
                                                LOG_LEVEL_NOTICE
                                            );
                                            this.services.API.addLog(ex, LOG_LEVEL_VERBOSE);
                                            return;
                                        }
                                        const workSettings = createBaseRemoteSettings();
                                        defaultRemoteProviderRegistry.applyConfiguration(workSettings, parsed);
                                        const newTweaks =
                                            await this.services.tweakValue.checkAndAskUseRemoteConfiguration(
                                                workSettings
                                            );
                                        if (newTweaks.result !== false) {
                                            this.editingSettings = { ...this.editingSettings, ...newTweaks.result };
                                            this.requestUpdate();
                                        }
                                    });
                                })
                                .addSeparator()
                                .addItem((item) => {
                                    item.setTitle($msg("🗑 Delete")).onClick(async () => {
                                        const confirmed = await this.services.UI.confirm.askYesNoDialog(
                                            $msg("Delete remote configuration '${name}'?", { name: config.name }),
                                            { title: $msg("Delete Remote Configuration"), defaultOption: "No" }
                                        );
                                        if (confirmed !== "yes") {
                                            return;
                                        }

                                        const nextConfigs = cloneRemoteConfigurations(
                                            this.editingSettings.remoteConfigurations
                                        );
                                        delete nextConfigs[config.id];
                                        this.editingSettings.remoteConfigurations = nextConfigs;

                                        let syncActiveRemote = false;
                                        if (this.editingSettings.activeConfigurationId === config.id) {
                                            const nextActiveId = Object.keys(nextConfigs)[0] || "";
                                            this.editingSettings.activeConfigurationId = nextActiveId;
                                            syncActiveRemote = nextActiveId !== "";
                                        }

                                        await persistRemoteConfigurations(syncActiveRemote);
                                        refreshList();
                                    });
                                });
                            const rect = btn.buttonEl.getBoundingClientRect();
                            menu.showAtPosition({ x: rect.left, y: rect.bottom });
                        })
                    );
                }
            };
            refreshList();
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
