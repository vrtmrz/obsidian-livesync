import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { createInstanceLogFunction, type LogFunction } from "@lib/services/lib/logUtils";
import { FlagFilesHumanReadable, FlagFilesOriginal } from "@lib/common/models/redflag.const";
import FetchEverything from "../modules/features/SetupWizard/dialogs/FetchEverything.svelte";
import RebuildEverything from "../modules/features/SetupWizard/dialogs/RebuildEverything.svelte";
import { extractObject } from "octagonal-wheels/object";
import { REMOTE_MINIO } from "@lib/common/models/setting.const";
import type { ObsidianLiveSyncSettings } from "@lib/common/models/setting.type";
import { TweakValuesShouldMatchedTemplate } from "@lib/common/models/tweak.definition";

/**
 * Flag file handler interface, similar to target filter pattern.
 */
interface FlagFileHandler {
    priority: number;
    check: () => Promise<boolean>;
    handle: () => Promise<boolean>;
}

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
 * Factory function to create a fetch all flag handler.
 * All logic related to fetch all flag is encapsulated here.
 */
export function createFetchAllFlagHandler(
    host: NecessaryServices<
        "vault" | "fileProcessing" | "tweakValue" | "UI" | "setting" | "appLifecycle",
        "storageAccess" | "rebuilder"
    >,
    log: LogFunction
): FlagFileHandler {
    // Check if fetch all flag is active
    const isFlagActive = async () =>
        (await isFlagFileExist(host, FlagFilesOriginal.FETCH_ALL)) ||
        (await isFlagFileExist(host, FlagFilesHumanReadable.FETCH_ALL));

    // Cleanup fetch all flag files
    const cleanupFlag = async () => {
        await deleteFlagFile(host, log, FlagFilesOriginal.FETCH_ALL);
        await deleteFlagFile(host, log, FlagFilesHumanReadable.FETCH_ALL);
    };

    // Handle the fetch all scheduled operation
    const onScheduled = async () => {
        const method = await host.services.UI.dialogManager.openWithExplicitCancel(FetchEverything);
        if (method === "cancelled") {
            log("Fetch everything cancelled by user.", LOG_LEVEL_NOTICE);
            await cleanupFlag();
            host.services.appLifecycle.performRestart();
            return false;
        }
        const { vault, extra } = method;
        const settings = await host.services.setting.currentSettings();
        // If remote is MinIO, makeLocalChunkBeforeSync is not available. (because no-deduplication on sending).
        const makeLocalChunkBeforeSyncAvailable = settings.remoteType !== REMOTE_MINIO;
        const mapVaultStateToAction = {
            identical: {
                makeLocalChunkBeforeSync: makeLocalChunkBeforeSyncAvailable,
                makeLocalFilesBeforeSync: false,
            },
            independent: {
                makeLocalChunkBeforeSync: false,
                makeLocalFilesBeforeSync: false,
            },
            unbalanced: {
                makeLocalChunkBeforeSync: false,
                makeLocalFilesBeforeSync: true,
            },
            cancelled: {
                makeLocalChunkBeforeSync: false,
                makeLocalFilesBeforeSync: false,
            },
        } as const;

        return await processVaultInitialisation(host, log, async () => {
            const settings = host.services.setting.currentSettings();
            await adjustSettingToRemoteIfNeeded(host, log, extra, settings);
            const vaultStateToAction = mapVaultStateToAction[vault];
            const { makeLocalChunkBeforeSync, makeLocalFilesBeforeSync } = vaultStateToAction;
            log(
                `Fetching everything with settings: makeLocalChunkBeforeSync=${makeLocalChunkBeforeSync}, makeLocalFilesBeforeSync=${makeLocalFilesBeforeSync}`,
                LOG_LEVEL_INFO
            );
            await host.serviceModules.rebuilder.$fetchLocal(makeLocalChunkBeforeSync, !makeLocalFilesBeforeSync);
            await cleanupFlag();
            log("Fetch everything operation completed. Vault files will be gradually synced.", LOG_LEVEL_NOTICE);
            return true;
        });
    };

    return {
        priority: 10,
        check: () => isFlagActive(),
        handle: async () => {
            const res = await onScheduled();
            if (res) {
                return await verifyAndUnlockSuspension(host, log);
            }
            return false;
        },
    };
}

/**
 * Adjust setting to remote configuration.
 * @param config current configuration to retrieve remote preferred config
 * @returns updated configuration if applied, otherwise null.
 */
export async function adjustSettingToRemote(
    host: NecessaryServices<"tweakValue" | "UI" | "setting", any>,
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
                return (config as any)[key] !== value;
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
            } satisfies ObsidianLiveSyncSettings;
            await host.services.setting.applyPartial(config, true);
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
    host: NecessaryServices<"tweakValue" | "UI" | "setting", any>,
    log: LogFunction,
    extra: { preventFetchingConfig: boolean },
    config: ObsidianLiveSyncSettings
) {
    if (extra && extra.preventFetchingConfig) {
        return;
    }

    // Remote configuration fetched and applied.
    if (await adjustSettingToRemote(host, log, config)) {
        config = host.services.setting.currentSettings();
    } else {
        log("Remote configuration not applied.", LOG_LEVEL_NOTICE);
    }
    // log(JSON.stringify(config), LOG_LEVEL_VERBOSE);
}

/**
 * Process vault initialisation with suspending file watching and sync.
 * @param proc process to be executed during initialisation, should return true if can be continued, false if app is unable to continue the process.
 * @param keepSuspending  whether to keep suspending file watching after the process.
 * @returns result of the process, or false if error occurs.
 */
export async function processVaultInitialisation(
    host: NecessaryServices<"setting", any>,
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
    host: NecessaryServices<"setting" | "appLifecycle" | "UI", any>,
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

/**
 * Factory function to create a rebuild flag handler.
 * All logic related to rebuild flag is encapsulated here.
 */
export function createRebuildFlagHandler(
    host: NecessaryServices<"setting" | "appLifecycle" | "UI" | "tweakValue", "storageAccess" | "rebuilder">,
    log: LogFunction
) {
    // Check if rebuild flag is active
    const isFlagActive = async () =>
        (await isFlagFileExist(host, FlagFilesOriginal.REBUILD_ALL)) ||
        (await isFlagFileExist(host, FlagFilesHumanReadable.REBUILD_ALL));

    // Cleanup rebuild flag files
    const cleanupFlag = async () => {
        await deleteFlagFile(host, log, FlagFilesOriginal.REBUILD_ALL);
        await deleteFlagFile(host, log, FlagFilesHumanReadable.REBUILD_ALL);
    };

    // Handle the rebuild everything scheduled operation
    const onScheduled = async () => {
        const method = await host.services.UI.dialogManager.openWithExplicitCancel(RebuildEverything);
        if (method === "cancelled") {
            log("Rebuild everything cancelled by user.", LOG_LEVEL_NOTICE);
            await cleanupFlag();
            host.services.appLifecycle.performRestart();
            return false;
        }
        const { extra } = method;
        const settings = host.services.setting.currentSettings();
        await adjustSettingToRemoteIfNeeded(host, log, extra, settings);
        return await processVaultInitialisation(host, log, async () => {
            await host.serviceModules.rebuilder.$rebuildEverything();
            await cleanupFlag();
            log("Rebuild everything operation completed.", LOG_LEVEL_NOTICE);
            return true;
        });
    };

    return {
        priority: 20,
        check: () => isFlagActive(),
        handle: async () => {
            const res = await onScheduled();
            if (res) {
                return await verifyAndUnlockSuspension(host, log);
            }
            return false;
        },
    };
}

/**
 * Factory function to create a suspend all flag handler.
 * All logic related to suspend flag is encapsulated here.
 */
export function createSuspendFlagHandler(
    host: NecessaryServices<"setting", "storageAccess">,
    log: LogFunction
): FlagFileHandler {
    // Check if suspend flag is active
    const isFlagActive = async () => await isFlagFileExist(host, FlagFilesOriginal.SUSPEND_ALL);

    // Handle the suspend all scheduled operation
    const onScheduled = async () => {
        log("SCRAM is detected. All operations are suspended.", LOG_LEVEL_NOTICE);
        return await processVaultInitialisation(
            host,
            log,
            async () => {
                log(
                    "All operations are suspended as per SCRAM.\nLogs will be written to the file. This might be a performance impact.",
                    LOG_LEVEL_NOTICE
                );
                await host.services.setting.applyPartial({ writeLogToTheFile: true }, true);
                return Promise.resolve(false);
            },
            true
        );
    };

    return {
        priority: 5,
        check: () => isFlagActive(),
        handle: () => onScheduled(),
    };
}

export function flagHandlerToEventHandler(flagHandler: FlagFileHandler) {
    return async () => {
        if (await flagHandler.check()) {
            return await flagHandler.handle();
        }
        return true;
    };
}

export function useRedFlagFeatures(
    host: NecessaryServices<
        "API" | "appLifecycle" | "UI" | "setting" | "tweakValue" | "fileProcessing" | "vault",
        "storageAccess" | "rebuilder"
    >
) {
    const log = createInstanceLogFunction("SF:RedFlag", host.services.API);
    const handlerFetch = createFetchAllFlagHandler(host, log);
    const handlerRebuild = createRebuildFlagHandler(host, log);
    const handlerSuspend = createSuspendFlagHandler(host, log);
    host.services.appLifecycle.onLayoutReady.addHandler(flagHandlerToEventHandler(handlerFetch), handlerFetch.priority);
    host.services.appLifecycle.onLayoutReady.addHandler(
        flagHandlerToEventHandler(handlerRebuild),
        handlerRebuild.priority
    );
    host.services.appLifecycle.onLayoutReady.addHandler(
        flagHandlerToEventHandler(handlerSuspend),
        handlerSuspend.priority
    );
}
