import {
    REMOTE_COUCHDB,
    REMOTE_MINIO,
    REMOTE_P2P,
    DEFAULT_SETTINGS,
    LOG_LEVEL_NOTICE,
    type ObsidianLiveSyncSettings,
} from "../../../lib/src/common/types.ts";
import { Menu } from "@/deps.ts";
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
import { activateRemoteConfiguration } from "../../../lib/src/serviceFeatures/remoteConfig.ts";
import { ConnectionStringParser } from "../../../lib/src/common/ConnectionString.ts";
import type { RemoteConfigurationResult } from "../../../lib/src/common/ConnectionString.ts";
import type { RemoteConfiguration } from "../../../lib/src/common/models/setting.type.ts";
import SetupRemote from "../SetupWizard/dialogs/SetupRemote.svelte";
import SetupRemoteCouchDB from "../SetupWizard/dialogs/SetupRemoteCouchDB.svelte";
import SetupRemoteBucket from "../SetupWizard/dialogs/SetupRemoteBucket.svelte";
import SetupRemoteP2P from "../SetupWizard/dialogs/SetupRemoteP2P.svelte";

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

function createRemoteConfigurationId(): string {
    return `remote-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneRemoteConfigurations(
    configs: Record<string, RemoteConfiguration> | undefined
): Record<string, RemoteConfiguration> {
    return Object.fromEntries(Object.entries(configs || {}).map(([id, config]) => [id, { ...config }]));
}

function serializeRemoteConfiguration(settings: ObsidianLiveSyncSettings): string {
    if (settings.remoteType === REMOTE_MINIO) {
        return ConnectionStringParser.serialize({ type: "s3", settings });
    }
    if (settings.remoteType === REMOTE_P2P) {
        return ConnectionStringParser.serialize({ type: "p2p", settings });
    }
    return ConnectionStringParser.serialize({ type: "couchdb", settings });
}

function setEmojiButton(button: any, emoji: string, tooltip: string) {
    button.setButtonText(emoji);
    button.setTooltip(tooltip, { delay: 10, placement: "top" });
    // button.buttonEl.addClass("clickable-icon");
    button.buttonEl.addClass("mod-muted");
    return button;
}

function suggestRemoteConfigurationName(parsed: RemoteConfigurationResult): string {
    if (parsed.type === "couchdb") {
        try {
            const url = new URL(parsed.settings.couchDB_URI);
            return `CouchDB ${url.host}`;
        } catch {
            return "Imported CouchDB";
        }
    }
    if (parsed.type === "s3") {
        return `S3 ${parsed.settings.bucket || parsed.settings.endpoint}`;
    }
    return `P2P ${parsed.settings.P2P_roomID || "Remote"}`;
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
        void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleRemoteServer"), () => {}).then((paneEl) => {
            const actions = new Setting(paneEl).setName("Remote Databases");
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
                    await this.saveAllDirtySettings();
                }

                syncRemoteConfigurationBuffers();
                this.requestUpdate();
            };
            const runRemoteSetup = async (
                baseSettings: ObsidianLiveSyncSettings,
                remoteType?: typeof REMOTE_COUCHDB | typeof REMOTE_MINIO | typeof REMOTE_P2P
            ): Promise<ObsidianLiveSyncSettings | false> => {
                const setupManager = this.core.getModule(SetupManager);
                const dialogManager = setupManager.dialogManager;
                let targetRemoteType = remoteType;

                if (targetRemoteType === undefined) {
                    const method = await dialogManager.openWithExplicitCancel(SetupRemote);
                    if (method === "cancelled") {
                        return false;
                    }
                    targetRemoteType =
                        method === "bucket" ? REMOTE_MINIO : method === "p2p" ? REMOTE_P2P : REMOTE_COUCHDB;
                }

                if (targetRemoteType === REMOTE_MINIO) {
                    const bucketConf = await dialogManager.openWithExplicitCancel(SetupRemoteBucket, baseSettings);
                    if (bucketConf === "cancelled" || typeof bucketConf !== "object") {
                        return false;
                    }
                    return { ...baseSettings, ...bucketConf, remoteType: REMOTE_MINIO };
                }

                if (targetRemoteType === REMOTE_P2P) {
                    const p2pConf = await dialogManager.openWithExplicitCancel(SetupRemoteP2P, baseSettings);
                    if (p2pConf === "cancelled" || typeof p2pConf !== "object") {
                        return false;
                    }
                    return { ...baseSettings, ...p2pConf, remoteType: REMOTE_P2P };
                }

                const couchConf = await dialogManager.openWithExplicitCancel(SetupRemoteCouchDB, baseSettings);
                if (couchConf === "cancelled" || typeof couchConf !== "object") {
                    return false;
                }
                return { ...baseSettings, ...couchConf, remoteType: REMOTE_COUCHDB };
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
                    isEncrypted: nextSettings.encrypt,
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

                let parsed: RemoteConfigurationResult;
                try {
                    parsed = ConnectionStringParser.parse(trimmedURI);
                } catch (ex) {
                    this.services.API.addLog(`Failed to import remote configuration: ${ex}`, LOG_LEVEL_NOTICE);
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
                    uri: ConnectionStringParser.serialize(parsed),
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
                        .setDesc(config.uri.split("@").pop() || ""); // Show host part for privacy

                    if (config.id === this.editingSettings.activeConfigurationId) {
                        row.nameEl.addClass("sls-active-remote-name");
                        row.nameEl.appendText(" (Active)");
                    }

                    row.addButton((btn) =>
                        setEmojiButton(btn, "🔧", "Configure").onClick(async () => {
                            let parsed: RemoteConfigurationResult;
                            try {
                                parsed = ConnectionStringParser.parse(config.uri);
                            } catch (ex) {
                                this.services.API.addLog(
                                    `Failed to parse remote configuration '${config.id}' for editing: ${ex}`,
                                    LOG_LEVEL_NOTICE
                                );
                                return;
                            }
                            const workSettings = createBaseRemoteSettings();
                            if (parsed.type === "couchdb") {
                                workSettings.remoteType = REMOTE_COUCHDB;
                            } else if (parsed.type === "s3") {
                                workSettings.remoteType = REMOTE_MINIO;
                            } else {
                                workSettings.remoteType = REMOTE_P2P;
                            }
                            Object.assign(workSettings, parsed.settings);

                            const nextSettings = await runRemoteSetup(workSettings, workSettings.remoteType);
                            if (!nextSettings) {
                                return;
                            }

                            const nextConfigs = cloneRemoteConfigurations(this.editingSettings.remoteConfigurations);
                            nextConfigs[config.id] = {
                                ...config,
                                uri: serializeRemoteConfiguration(nextSettings),
                                isEncrypted: nextSettings.encrypt,
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
                                        let parsed: RemoteConfigurationResult;
                                        try {
                                            parsed = ConnectionStringParser.parse(config.uri);
                                        } catch (ex) {
                                            this.services.API.addLog(
                                                `Failed to parse remote configuration '${config.id}': ${ex}`,
                                                LOG_LEVEL_NOTICE
                                            );
                                            return;
                                        }
                                        const workSettings = createBaseRemoteSettings();
                                        if (parsed.type === "couchdb") {
                                            workSettings.remoteType = REMOTE_COUCHDB;
                                        } else if (parsed.type === "s3") {
                                            workSettings.remoteType = REMOTE_MINIO;
                                        } else {
                                            workSettings.remoteType = REMOTE_P2P;
                                        }
                                        Object.assign(workSettings, parsed.settings);
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
                                    item.setTitle("🗑 Delete").onClick(async () => {
                                        const confirmed = await this.services.UI.confirm.askYesNoDialog(
                                            `Delete remote configuration '${config.name}'?`,
                                            { title: "Delete Remote Configuration", defaultOption: "No" }
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
    // eslint-disable-next-line no-constant-condition
    if (false) {
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
                            const setupManager = this.core.getModule(SetupManager);
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
    // eslint-disable-next-line no-constant-condition
    if (false) {
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
                            const setupManager = this.core.getModule(SetupManager);
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
    // eslint-disable-next-line no-constant-condition
    if (false) {
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
                            const setupManager = this.core.getModule(SetupManager);
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
