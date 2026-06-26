import { Platform, Notice } from "@/deps.ts";
import { EVENT_SETTING_SAVED, eventHub, EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG } from "@/common/events.ts";
import {
    isPluginMetadata,
    isCustomisationSyncMetadata,
    scheduleTask,
    memoIfNotExist,
    memoObject,
    retrieveMemoObject,
    disposeMemoObject,
} from "@/common/utils.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import { LOG_LEVEL_VERBOSE, LOG_LEVEL_NOTICE } from "@lib/common/types.ts";
import type { FilePath, FilePathWithPrefix, AnyEntry, EntryDoc } from "@lib/common/types.ts";
import { ICXHeader, PERIODIC_PLUGIN_SWEEP } from "@/common/types.ts";
import { fireAndForget } from "@lib/common/utils.ts";

import type { ConfigSyncHost } from "./types.ts";
import type { ConfigSyncState } from "./state.ts";
import { isThisModuleEnabled, scanAllConfigFiles } from "./syncOperations.ts";
import { updatePluginList } from "./pluginScanner.ts";

/**
 * Binds all required events for configuration synchronisation onto the application lifecycle and replicator.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param handlers - Event response triggers.
 */
export function bindConfigSyncEvents(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    handlers: {
        showPluginSyncModal: () => void;
        watchVaultRawEventsAsync: (path: FilePath) => Promise<boolean>;
    }
) {
    eventHub.onEvent(EVENT_SETTING_SAVED, () => {
        // Configuration change handling
    });

    eventHub.onEvent(EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG, () => {
        handlers.showPluginSyncModal();
    });

    host.services.fileProcessing.processOptionalFileEvent.addHandler(async (path: FilePath) => {
        return await handlers.watchVaultRawEventsAsync(path);
    });

    host.services.conflict.getOptionalConflictCheckMethod.addHandler((path: FilePathWithPrefix) => {
        if (isPluginMetadata(path) || isCustomisationSyncMetadata(path)) {
            return Promise.resolve("newer");
        }
        return Promise.resolve(false);
    });

    host.services.replication.processVirtualDocument.addHandler(
        async (docs: PouchDB.Core.ExistingDocument<EntryDoc>) => {
            if (!docs._id.startsWith(ICXHeader)) return false;

            if (isThisModuleEnabled(host)) {
                const path = (docs as AnyEntry).path
                    ? (docs as AnyEntry).path
                    : host.services.path.getPath(docs as AnyEntry);
                await updatePluginList(host, log, state, false, path);
            }

            const settings = host.services.setting.currentSettings();
            if (isThisModuleEnabled(host) && settings.notifyPluginOrSettingUpdated) {
                if (!state.pluginDialog || !state.pluginDialog.isOpened()) {
                    const fragment = createFragment((doc) => {
                        doc.createEl("span", undefined, (a) => {
                            a.appendText("Some configuration has arrived, Press ");
                            a.appendChild(
                                a.createEl("a", undefined, (anchor) => {
                                    anchor.text = "HERE";
                                    anchor.addEventListener("click", () => {
                                        handlers.showPluginSyncModal();
                                    });
                                })
                            );
                            a.appendText(
                                " to open the config sync dialogue , or press elsewhere to dismiss this message."
                            );
                        });
                    });

                    const updatedPluginKey = "popupUpdated-plugins";
                    scheduleTask(updatedPluginKey, 1000, async () => {
                        const popup = await memoIfNotExist(updatedPluginKey, () => new Notice(fragment, 0));
                        //@ts-ignore
                        const isShown = popup?.noticeEl?.isShown();
                        if (!isShown) {
                            memoObject(updatedPluginKey, new Notice(fragment, 0));
                        }
                        scheduleTask(updatedPluginKey + "-close", 20000, () => {
                            const popupClose = retrieveMemoObject<Notice>(updatedPluginKey);
                            if (!popupClose) return;
                            //@ts-ignore
                            if (popupClose?.noticeEl?.isShown()) {
                                popupClose.hide();
                            }
                            disposeMemoObject(updatedPluginKey);
                        });
                    });
                }
            }
            return true;
        }
    );

    host.services.setting.onRealiseSetting.addHandler(async () => {
        state.periodicPluginSweepProcessor?.disable();
        if (!host.services.appLifecycle.isReady()) return true;
        if (host.services.appLifecycle.isSuspended()) return true;
        if (!isThisModuleEnabled(host)) return true;

        const settings = host.services.setting.currentSettings();
        if (settings.autoSweepPlugins) {
            await scanAllConfigFiles(host, log, state, false);
        }
        state.periodicPluginSweepProcessor?.enable(
            settings.autoSweepPluginsPeriodic && !settings.watchInternalFileChanges ? PERIODIC_PLUGIN_SWEEP * 1000 : 0
        );
        return true;
    });

    host.services.appLifecycle.onResuming.addHandler(async () => {
        if (!isThisModuleEnabled(host)) return true;
        if (host.services.appLifecycle.isSuspended()) {
            return true;
        }
        const settings = host.services.setting.currentSettings();
        if (settings.autoSweepPlugins) {
            await scanAllConfigFiles(host, log, state, false);
        }
        state.periodicPluginSweepProcessor?.enable(
            settings.autoSweepPluginsPeriodic && !settings.watchInternalFileChanges ? PERIODIC_PLUGIN_SWEEP * 1000 : 0
        );
        return true;
    });

    host.services.appLifecycle.onResumed.addHandler(() => {
        const q = activeDocument.querySelector(".livesync-ribbon-showcustom");
        q?.toggleClass("sls-hidden", !isThisModuleEnabled(host));
        return Promise.resolve(true);
    });

    host.services.replication.onBeforeReplicate.addHandler(async (showNotice: boolean) => {
        if (!isThisModuleEnabled(host)) return true;
        const settings = host.services.setting.currentSettings();
        if (settings.autoSweepPlugins) {
            await scanAllConfigFiles(host, log, state, showNotice);
        }
        return true;
    });

    host.services.databaseEvents.onDatabaseInitialised.addHandler(async (showNotice: boolean) => {
        if (!isThisModuleEnabled(host)) return true;
        try {
            log("Scanning customisations...");
            await scanAllConfigFiles(host, log, state, showNotice);
            log("Scanning customisations : done");
        } catch (ex) {
            log("Scanning customisations : failed");
            log(ex, LOG_LEVEL_VERBOSE);
        }
        return true;
    });

    host.services.setting.suspendExtraSync.addHandler(() => {
        const settings = host.services.setting.currentSettings();
        if (isThisModuleEnabled(host) || settings.autoSweepPlugins) {
            log(
                "Customisation sync has been temporarily disabled. Please enable it after the fetching, if you need it.",
                LOG_LEVEL_NOTICE
            );
            fireAndForget(() =>
                host.services.setting.applyPartial(
                    {
                        usePluginSync: false,
                        autoSweepPlugins: false,
                    },
                    true
                )
            );
        }
        return Promise.resolve(true);
    });

    host.services.setting.suggestOptionalFeatures.addHandler(
        async (opt: { enableFetch?: boolean; enableOverwrite?: boolean }) => {
            const message = `Would you like to enable **Customisation sync**?

> [!DETAILS]-
> This feature allows you to sync your customisations -- such as configurations, themes, snippets, and plugins -- across your devices in a fully controlled manner, unlike the fully automatic behaviour of hidden file synchronisation.
> 
> You may use this feature alongside hidden file synchronisation. When both features are enabled, items configured as \`Automatic\` in this feature will be managed by **hidden file synchronisation**.
> Do not worry, you will be prompted to enable or keep disabled **hidden file synchronisation** after this dialogue.
`;
            const CHOICE_CUSTOMIZE = "Yes, Enable it";
            const CHOICE_DISABLE = "No, Disable it";
            const CHOICE_DISMISS = "Later";
            const choices = [CHOICE_CUSTOMIZE, CHOICE_DISABLE, CHOICE_DISMISS];

            const ret = await host.services.API.confirm.askSelectStringDialogue(message, choices, {
                defaultAction: CHOICE_DISMISS,
                timeout: 40,
                title: "Customisation sync",
            });
            if (ret == CHOICE_CUSTOMIZE) {
                await configureHiddenFileSync(host, log, state, "CUSTOMIZE");
            } else if (ret == CHOICE_DISABLE) {
                await configureHiddenFileSync(host, log, state, "DISABLE_CUSTOM");
            }
            return true;
        }
    );

    host.services.setting.enableOptionalFeature.addHandler(async (mode: any) => {
        await configureHiddenFileSync(host, log, state, mode);
        return true;
    });
}

/**
 * Configures the customisation synchronisation status.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param mode - The sync activation mode option.
 */
export async function configureHiddenFileSync(
    host: ConfigSyncHost,
    log: LogFunction,
    state: ConfigSyncState,
    mode: "DISABLE" | "CUSTOMIZE" | "DISABLE_CUSTOM"
) {
    if (mode == "DISABLE") {
        await host.services.setting.applyPartial(
            {
                usePluginSync: false,
            },
            true
        );
        return;
    }

    if (mode == "CUSTOMIZE") {
        if (!host.services.setting.getDeviceAndVaultName()) {
            let name = await host.services.API.confirm.askString(
                "Device name",
                "Please set this device name",
                "desktop"
            );
            if (!name) {
                if (Platform.isAndroidApp) {
                    name = "android-app";
                } else if (Platform.isIosApp) {
                    name = "ios";
                } else if (Platform.isMacOS) {
                    name = "macos";
                } else if (Platform.isMobileApp) {
                    name = "mobile-app";
                } else if (Platform.isMobile) {
                    name = "mobile";
                } else if (Platform.isSafari) {
                    name = "safari";
                } else if (Platform.isDesktop) {
                    name = "desktop";
                } else if (Platform.isDesktopApp) {
                    name = "desktop-app";
                } else {
                    name = "unknown";
                }
                name = name + Math.random().toString(36).slice(-4);
            }
            host.services.setting.setDeviceAndVaultName(name);
        }
        await host.services.setting.applyPartial(
            {
                usePluginSync: true,
                useAdvancedMode: true,
            },
            true
        );
        await scanAllConfigFiles(host, log, state, true);
    }
}
