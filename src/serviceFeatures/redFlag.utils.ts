import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { type LogFunction } from "@lib/services/lib/logUtils";
import { extractObject } from "octagonal-wheels/object";
import { REMOTE_P2P } from "@lib/common/models/setting.const";
import type { ObsidianLiveSyncSettings } from "@lib/common/models/setting.type";
import { TweakValuesShouldMatchedTemplate } from "@lib/common/models/tweak.definition";

export async function isFlagFileExist(host: NecessaryServices<never, "storageAccess">, path: string) {
    const redFlagExist = await host.serviceModules.storageAccess.isExists(
        host.serviceModules.storageAccess.normalisePath(path)
    );
    if (redFlagExist) {
        return true;
    }
    return false;
}

export async function deleteFlagFile(host: NecessaryServices<never, "storageAccess">, log: LogFunction, path: string) {
    try {
        const isFlagged = await host.serviceModules.storageAccess.isExists(
            host.serviceModules.storageAccess.normalisePath(path)
        );
        if (isFlagged) {
            await host.serviceModules.storageAccess.delete(path, true);
        }
    } catch (ex) {
        log(`Could not delete ${path}`);
        log(ex, LOG_LEVEL_VERBOSE);
    }
}

/**
 * Adjust setting to remote configuration.
 * @param config current configuration to retrieve remote preferred config
 * @returns updated configuration if applied, otherwise null.
 */
export async function adjustSettingToRemote(
    host: NecessaryServices<"tweakValue" | "UI" | "setting", never>,
    log: LogFunction,
    config: ObsidianLiveSyncSettings
) {
    // Fetch remote configuration unless prevented.
    const SKIP_FETCH = "Skip and proceed";
    const RETRY_FETCH = "Retry (recommended)";
    let canProceed = false;
    do {
        const remoteTweaks = await host.services.tweakValue.fetchRemotePreferred(config);
        if (!remoteTweaks) {
            const choice = await host.services.UI.confirm.askSelectStringDialogue(
                "Could not fetch configuration from remote. If you are new to the Self-hosted LiveSync, this might be expected. If not, you should check your network or server settings.",
                [SKIP_FETCH, RETRY_FETCH] as const,
                {
                    defaultAction: RETRY_FETCH,
                    timeout: 0,
                    title: "Fetch Remote Configuration Failed",
                }
            );
            if (choice === SKIP_FETCH) {
                canProceed = true;
            }
        } else {
            const necessary = extractObject(TweakValuesShouldMatchedTemplate, remoteTweaks);
            // Check if any necessary tweak value is different from current config.
            const differentItems = Object.entries(necessary).filter(([key, value]) => {
                return config[key as keyof ObsidianLiveSyncSettings] !== value;
            });
            if (differentItems.length === 0) {
                log("Remote configuration matches local configuration. No changes applied.", LOG_LEVEL_NOTICE);
            } else {
                await host.services.UI.confirm.askSelectStringDialogue(
                    "Your settings differed slightly from the server's. The plug-in has supplemented the incompatible parts with the server settings!",
                    ["OK"] as const,
                    {
                        defaultAction: "OK",
                        timeout: 0,
                    }
                );
            }

            config = {
                ...config,
                ...Object.fromEntries(differentItems),
            };
            await host.services.setting.applyExternalSettings(config, true);
            log("Remote configuration applied.", LOG_LEVEL_NOTICE);
            canProceed = true;
            const updatedConfig = host.services.setting.currentSettings();
            return updatedConfig;
        }
    } while (!canProceed);
}

/**
 * Adjust setting to remote if needed.
 * @param extra result of dialogues that may contain preventFetchingConfig flag (e.g, from FetchEverything or RebuildEverything)
 * @param config current configuration to retrieve remote preferred config
 */
export async function adjustSettingToRemoteIfNeeded(
    host: NecessaryServices<"tweakValue" | "UI" | "setting", never>,
    log: LogFunction,
    extra: { preventFetchingConfig: boolean },
    config: ObsidianLiveSyncSettings
) {
    if (extra && extra.preventFetchingConfig) {
        return;
    }

    // P2P has no centralised remote configuration; skip to avoid a spurious
    // "Failed to connect to the remote server" error dialog.
    if (config.remoteType === REMOTE_P2P) {
        log("Remote configuration fetch skipped (P2P mode).", LOG_LEVEL_INFO);
        return;
    }

    // Remote configuration fetched and applied.
    if (await adjustSettingToRemote(host, log, config)) {
        config = host.services.setting.currentSettings();
    } else {
        log("Remote configuration not applied.", LOG_LEVEL_NOTICE);
    }
}

/**
 * Process vault initialisation with suspending file watching and sync.
 * @param proc process to be executed during initialisation, should return true if can be continued, false if app is unable to continue the process.
 * @param keepSuspending  whether to keep suspending file watching after the process.
 * @returns result of the process, or false if error occurs.
 */
export async function processVaultInitialisation(
    host: NecessaryServices<"setting", never>,
    log: LogFunction,
    proc: () => Promise<boolean>,
    keepSuspending = false
) {
    try {
        // Disable batch saving and file watching during initialisation.
        await host.services.setting.applyPartial({ batchSave: false }, false);
        await host.services.setting.suspendAllSync();
        await host.services.setting.suspendExtraSync();
        await host.services.setting.applyPartial({ suspendFileWatching: true }, true);
        try {
            const result = await proc();
            return result;
        } catch (ex) {
            log("Error during vault initialisation process.", LOG_LEVEL_NOTICE);
            log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    } catch (ex) {
        log("Error during vault initialisation.", LOG_LEVEL_NOTICE);
        log(ex, LOG_LEVEL_VERBOSE);
        return false;
    } finally {
        if (!keepSuspending) {
            // Re-enable file watching after initialisation.
            await host.services.setting.applyPartial({ suspendFileWatching: false }, true);
        }
    }
}

export async function verifyAndUnlockSuspension(
    host: NecessaryServices<"setting" | "appLifecycle" | "UI", never>,
    log: LogFunction
) {
    if (!host.services.setting.currentSettings().suspendFileWatching) {
        return true;
    }
    if (
        (await host.services.UI.confirm.askYesNoDialog(
            "Do you want to resume file and database processing, and restart obsidian now?",
            { defaultOption: "Yes", timeout: 15 }
        )) != "yes"
    ) {
        // TODO: Confirm actually proceed to next process.
        return true;
    }
    await host.services.setting.applyPartial({ suspendFileWatching: false }, true);
    host.services.appLifecycle.performRestart();
    return false;
}
