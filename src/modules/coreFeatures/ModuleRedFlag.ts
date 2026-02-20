import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { normalizePath } from "../../deps.ts";
import {
    FlagFilesHumanReadable,
    FlagFilesOriginal,
    REMOTE_MINIO,
    TweakValuesShouldMatchedTemplate,
    type ObsidianLiveSyncSettings,
} from "../../lib/src/common/types.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { LiveSyncCore } from "../../main.ts";
import FetchEverything from "../features/SetupWizard/dialogs/FetchEverything.svelte";
import RebuildEverything from "../features/SetupWizard/dialogs/RebuildEverything.svelte";
import { extractObject } from "octagonal-wheels/object";
import { SvelteDialogManagerBase } from "@lib/UI/svelteDialog.ts";
import type { ServiceContext } from "@lib/services/base/ServiceBase.ts";

export class ModuleRedFlag extends AbstractModule {
    async isFlagFileExist(path: string) {
        const redflag = await this.core.storageAccess.isExists(normalizePath(path));
        if (redflag) {
            return true;
        }
        return false;
    }

    async deleteFlagFile(path: string) {
        try {
            const isFlagged = await this.core.storageAccess.isExists(normalizePath(path));
            if (isFlagged) {
                await this.core.storageAccess.delete(path, true);
            }
        } catch (ex) {
            this._log(`Could not delete ${path}`);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
    }

    isSuspendFlagActive = async () => await this.isFlagFileExist(FlagFilesOriginal.SUSPEND_ALL);
    isRebuildFlagActive = async () =>
        (await this.isFlagFileExist(FlagFilesOriginal.REBUILD_ALL)) ||
        (await this.isFlagFileExist(FlagFilesHumanReadable.REBUILD_ALL));
    isFetchAllFlagActive = async () =>
        (await this.isFlagFileExist(FlagFilesOriginal.FETCH_ALL)) ||
        (await this.isFlagFileExist(FlagFilesHumanReadable.FETCH_ALL));

    async cleanupRebuildFlag() {
        await this.deleteFlagFile(FlagFilesOriginal.REBUILD_ALL);
        await this.deleteFlagFile(FlagFilesHumanReadable.REBUILD_ALL);
    }

    async cleanupFetchAllFlag() {
        await this.deleteFlagFile(FlagFilesOriginal.FETCH_ALL);
        await this.deleteFlagFile(FlagFilesHumanReadable.FETCH_ALL);
    }
    // dialogManager = new SvelteDialogManagerBase(this.core);
    get dialogManager(): SvelteDialogManagerBase<ServiceContext> {
        return this.core.services.UI.dialogManager;
    }

    /**
     * Adjust setting to remote if needed.
     * @param extra result of dialogues that may contain preventFetchingConfig flag (e.g, from FetchEverything or RebuildEverything)
     * @param config current configuration to retrieve remote preferred config
     */
    async adjustSettingToRemoteIfNeeded(extra: { preventFetchingConfig: boolean }, config: ObsidianLiveSyncSettings) {
        if (extra && extra.preventFetchingConfig) {
            return;
        }

        // Remote configuration fetched and applied.
        if (await this.adjustSettingToRemote(config)) {
            config = this.core.settings;
        } else {
            this._log("Remote configuration not applied.", LOG_LEVEL_NOTICE);
        }
        console.debug(config);
    }

    /**
     * Adjust setting to remote configuration.
     * @param config current configuration to retrieve remote preferred config
     * @returns updated configuration if applied, otherwise null.
     */
    async adjustSettingToRemote(config: ObsidianLiveSyncSettings) {
        // Fetch remote configuration unless prevented.
        const SKIP_FETCH = "Skip and proceed";
        const RETRY_FETCH = "Retry (recommended)";
        let canProceed = false;
        do {
            const remoteTweaks = await this.services.tweakValue.fetchRemotePreferred(config);
            if (!remoteTweaks) {
                const choice = await this.core.confirm.askSelectStringDialogue(
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
                    this._log(
                        "Remote configuration matches local configuration. No changes applied.",
                        LOG_LEVEL_NOTICE
                    );
                } else {
                    await this.core.confirm.askSelectStringDialogue(
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
                this.core.settings = config;
                await this.core.services.setting.saveSettingData();
                this._log("Remote configuration applied.", LOG_LEVEL_NOTICE);
                canProceed = true;
                return this.core.settings;
            }
        } while (!canProceed);
    }

    /**
     * Process vault initialisation with suspending file watching and sync.
     * @param proc process to be executed during initialisation, should return true if can be continued, false if app is unable to continue the process.
     * @param keepSuspending  whether to keep suspending file watching after the process.
     * @returns result of the process, or false if error occurs.
     */
    async processVaultInitialisation(proc: () => Promise<boolean>, keepSuspending = false) {
        try {
            // Disable batch saving and file watching during initialisation.
            this.settings.batchSave = false;
            await this.services.setting.suspendAllSync();
            await this.services.setting.suspendExtraSync();
            this.settings.suspendFileWatching = true;
            await this.saveSettings();
            try {
                const result = await proc();
                return result;
            } catch (ex) {
                this._log("Error during vault initialisation process.", LOG_LEVEL_NOTICE);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        } catch (ex) {
            this._log("Error during vault initialisation.", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return false;
        } finally {
            if (!keepSuspending) {
                // Re-enable file watching after initialisation.
                this.settings.suspendFileWatching = false;
                await this.saveSettings();
            }
        }
    }

    /**
     * Handle the rebuild everything scheduled operation.
     * @returns true if can be continued, false if app restart is needed.
     */
    async onRebuildEverythingScheduled() {
        const method = await this.dialogManager.openWithExplicitCancel(RebuildEverything);
        if (method === "cancelled") {
            // Clean up the flag file and restart the app.
            this._log("Rebuild everything cancelled by user.", LOG_LEVEL_NOTICE);
            await this.cleanupRebuildFlag();
            this.services.appLifecycle.performRestart();
            return false;
        }
        const { extra } = method;
        await this.adjustSettingToRemoteIfNeeded(extra, this.settings);
        return await this.processVaultInitialisation(async () => {
            await this.core.rebuilder.$rebuildEverything();
            await this.cleanupRebuildFlag();
            this._log("Rebuild everything operation completed.", LOG_LEVEL_NOTICE);
            return true;
        });
    }
    /**
     * Handle the fetch all scheduled operation.
     * @returns true if can be continued, false if app restart is needed.
     */
    async onFetchAllScheduled() {
        const method = await this.dialogManager.openWithExplicitCancel(FetchEverything);
        if (method === "cancelled") {
            this._log("Fetch everything cancelled by user.", LOG_LEVEL_NOTICE);
            // Clean up the flag file and restart the app.
            await this.cleanupFetchAllFlag();
            this.services.appLifecycle.performRestart();
            return false;
        }
        const { vault, extra } = method;
        // If remote is MinIO, makeLocalChunkBeforeSync is not available. (because no-deduplication on sending).
        const makeLocalChunkBeforeSyncAvailable = this.settings.remoteType !== REMOTE_MINIO;
        const mapVaultStateToAction = {
            identical: {
                // If both are identical, no need to make local files/chunks before sync,
                // Just for the efficiency, chunks should be made before sync.
                makeLocalChunkBeforeSync: makeLocalChunkBeforeSyncAvailable,
                makeLocalFilesBeforeSync: false,
            },
            independent: {
                // If both are independent, nothing needs to be made before sync.
                // Respect the remote state.
                makeLocalChunkBeforeSync: false,
                makeLocalFilesBeforeSync: false,
            },
            unbalanced: {
                // If both are unbalanced, local files should be made before sync to avoid data loss.
                // Then, chunks should be made before sync for the efficiency, but also the metadata made and should be detected as conflicting.
                makeLocalChunkBeforeSync: false,
                makeLocalFilesBeforeSync: true,
            },
            cancelled: {
                // Cancelled case, not actually used.
                makeLocalChunkBeforeSync: false,
                makeLocalFilesBeforeSync: false,
            },
        } as const;

        return await this.processVaultInitialisation(async () => {
            await this.adjustSettingToRemoteIfNeeded(extra, this.settings);
            // Okay, proceed to fetch everything.
            const { makeLocalChunkBeforeSync, makeLocalFilesBeforeSync } = mapVaultStateToAction[vault];
            this._log(
                `Fetching everything with settings: makeLocalChunkBeforeSync=${makeLocalChunkBeforeSync}, makeLocalFilesBeforeSync=${makeLocalFilesBeforeSync}`,
                LOG_LEVEL_INFO
            );
            await this.core.rebuilder.$fetchLocal(makeLocalChunkBeforeSync, !makeLocalFilesBeforeSync);
            await this.cleanupFetchAllFlag();
            this._log("Fetch everything operation completed. Vault files will be gradually synced.", LOG_LEVEL_NOTICE);
            return true;
        });
    }

    async onSuspendAllScheduled() {
        this._log("SCRAM is detected. All operations are suspended.", LOG_LEVEL_NOTICE);
        return await this.processVaultInitialisation(async () => {
            this._log(
                "All operations are suspended as per SCRAM.\nLogs will be written to the file. This might be a performance impact.",
                LOG_LEVEL_NOTICE
            );
            this.settings.writeLogToTheFile = true;
            await this.core.services.setting.saveSettingData();
            return Promise.resolve(false);
        }, true);
    }

    async verifyAndUnlockSuspension() {
        if (!this.settings.suspendFileWatching) {
            return true;
        }
        if (
            (await this.core.confirm.askYesNoDialog(
                "Do you want to resume file and database processing, and restart obsidian now?",
                { defaultOption: "Yes", timeout: 15 }
            )) != "yes"
        ) {
            // TODO: Confirm actually proceed to next process.
            return true;
        }
        this.settings.suspendFileWatching = false;
        await this.saveSettings();
        this.services.appLifecycle.performRestart();
        return false;
    }

    private async processFlagFilesOnStartup(): Promise<boolean> {
        const isFlagSuspensionActive = await this.isSuspendFlagActive();
        const isFlagRebuildActive = await this.isRebuildFlagActive();
        const isFlagFetchAllActive = await this.isFetchAllFlagActive();
        // TODO: Address the case when both flags are active (very unlikely though).
        // if(isFlagFetchAllActive && isFlagRebuildActive) {
        //     const message = "Rebuild everything and Fetch everything flags are both detected.";
        //     await this.core.confirm.askSelectStringDialogue(
        //         "Both Rebuild Everything and Fetch Everything flags are detected. Please remove one of them and restart the app.",
        //         ["OK"] as const,)
        if (isFlagFetchAllActive) {
            const res = await this.onFetchAllScheduled();
            if (res) {
                return await this.verifyAndUnlockSuspension();
            }
            return false;
        }
        if (isFlagRebuildActive) {
            const res = await this.onRebuildEverythingScheduled();
            if (res) {
                return await this.verifyAndUnlockSuspension();
            }
            return false;
        }
        if (isFlagSuspensionActive) {
            const res = await this.onSuspendAllScheduled();
            return res;
        }
        return true;
    }

    async _everyOnLayoutReady(): Promise<boolean> {
        try {
            const flagProcessResult = await this.processFlagFilesOnStartup();
            return flagProcessResult;
        } catch (ex) {
            this._log("Something went wrong on FlagFile Handling", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        return true;
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        super.onBindFunction(core, services);
        services.appLifecycle.onLayoutReady.addHandler(this._everyOnLayoutReady.bind(this));
    }
}
