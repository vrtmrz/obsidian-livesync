import { fireAndForget } from "octagonal-wheels/promises";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, VER, type ObsidianLiveSyncSettings } from "../../lib/src/common/types.ts";
import {
    EVENT_LAYOUT_READY,
    EVENT_PLUGIN_LOADED,
    EVENT_PLUGIN_UNLOADED,
    EVENT_REQUEST_RELOAD_SETTING_TAB,
    EVENT_SETTING_SAVED,
    eventHub,
} from "../../common/events.ts";
import { $msg, setLang } from "../../lib/src/common/i18n.ts";
import { versionNumberString2Number } from "../../lib/src/string_and_binary/convert.ts";
import { cancelAllPeriodicTask, cancelAllTasks } from "octagonal-wheels/concurrency/task";
import { stopAllRunningProcessors } from "octagonal-wheels/concurrency/processor";
import { AbstractModule } from "../AbstractModule.ts";
import { EVENT_PLATFORM_UNLOADED } from "../../lib/src/PlatformAPIs/base/APIBase.ts";
import type { InjectableServiceHub } from "../../lib/src/services/InjectableServices.ts";
import type { LiveSyncCore } from "../../main.ts";

export class ModuleLiveSyncMain extends AbstractModule {
    async _onLiveSyncReady() {
        if (!(await this.core.services.appLifecycle.onLayoutReady())) return false;
        eventHub.emitEvent(EVENT_LAYOUT_READY);
        if (this.settings.suspendFileWatching || this.settings.suspendParseReplicationResult) {
            const ANSWER_KEEP = $msg("moduleLiveSyncMain.optionKeepLiveSyncDisabled");
            const ANSWER_RESUME = $msg("moduleLiveSyncMain.optionResumeAndRestart");
            const message = $msg("moduleLiveSyncMain.msgScramEnabled", {
                fileWatchingStatus: this.settings.suspendFileWatching ? "suspended" : "active",
                parseReplicationStatus: this.settings.suspendParseReplicationResult ? "suspended" : "active",
            });
            if (
                (await this.core.confirm.askSelectStringDialogue(message, [ANSWER_KEEP, ANSWER_RESUME], {
                    defaultAction: ANSWER_KEEP,
                    title: $msg("moduleLiveSyncMain.titleScramEnabled"),
                })) == ANSWER_RESUME
            ) {
                this.settings.suspendFileWatching = false;
                this.settings.suspendParseReplicationResult = false;
                await this.saveSettings();
                this.services.appLifecycle.scheduleRestart();
                return false;
            }
        }
        const isInitialized = await this.services.databaseEvents.initialiseDatabase(false, false);
        if (!isInitialized) {
            //TODO:stop all sync.
            return false;
        }
        if (!(await this.core.services.appLifecycle.onFirstInitialise())) return false;
        // await this.core.$$realizeSettingSyncMode();
        await this.services.setting.onRealiseSetting();
        fireAndForget(async () => {
            this._log($msg("moduleLiveSyncMain.logAdditionalSafetyScan"), LOG_LEVEL_VERBOSE);
            if (!(await this.services.appLifecycle.onScanningStartupIssues())) {
                this._log($msg("moduleLiveSyncMain.logSafetyScanFailed"), LOG_LEVEL_NOTICE);
            } else {
                this._log($msg("moduleLiveSyncMain.logSafetyScanCompleted"), LOG_LEVEL_VERBOSE);
            }
        });
        return true;
    }

    _wireUpEvents() {
        eventHub.onEvent(EVENT_SETTING_SAVED, (settings: ObsidianLiveSyncSettings) => {
            this.localDatabase.settings = settings;
            setLang(settings.displayLanguage);
            eventHub.emitEvent(EVENT_REQUEST_RELOAD_SETTING_TAB);
        });
        eventHub.onEvent(EVENT_SETTING_SAVED, (settings: ObsidianLiveSyncSettings) => {
            fireAndForget(() => this.core.services.setting.onRealiseSetting());
        });
        return Promise.resolve(true);
    }

    async _onLiveSyncLoad(): Promise<boolean> {
        await this.services.appLifecycle.onWireUpEvents();
        // debugger;
        eventHub.emitEvent(EVENT_PLUGIN_LOADED, this.core);
        this._log($msg("moduleLiveSyncMain.logLoadingPlugin"));
        if (!(await this.services.appLifecycle.onInitialise())) {
            this._log($msg("moduleLiveSyncMain.logPluginInitCancelled"), LOG_LEVEL_NOTICE);
            return false;
        }
        // this.addUIs();
        //@ts-ignore
        const manifestVersion: string = MANIFEST_VERSION || "0.0.0";
        //@ts-ignore
        const packageVersion: string = PACKAGE_VERSION || "0.0.0";

        this._log($msg("moduleLiveSyncMain.logPluginVersion", { manifestVersion, packageVersion }));
        await this.services.setting.loadSettings();
        if (!(await this.services.appLifecycle.onSettingLoaded())) {
            this._log($msg("moduleLiveSyncMain.logPluginInitCancelled"), LOG_LEVEL_NOTICE);
            return false;
        }
        const lsKey = "obsidian-live-sync-ver" + this.services.vault.getVaultName();
        const last_version = localStorage.getItem(lsKey);

        const lastVersion = ~~(versionNumberString2Number(manifestVersion) / 1000);
        if (lastVersion > this.settings.lastReadUpdates && this.settings.isConfigured) {
            this._log($msg("moduleLiveSyncMain.logReadChangelog"), LOG_LEVEL_NOTICE);
        }

        //@ts-ignore
        if (this.isMobile) {
            this.settings.disableRequestURI = true;
        }
        if (last_version && Number(last_version) < VER) {
            this.settings.liveSync = false;
            this.settings.syncOnSave = false;
            this.settings.syncOnEditorSave = false;
            this.settings.syncOnStart = false;
            this.settings.syncOnFileOpen = false;
            this.settings.syncAfterMerge = false;
            this.settings.periodicReplication = false;
            this.settings.versionUpFlash = $msg("moduleLiveSyncMain.logVersionUpdate");
            await this.saveSettings();
        }
        localStorage.setItem(lsKey, `${VER}`);
        await this.services.database.openDatabase();
        // this.core.$$realizeSettingSyncMode = this.core.$$realizeSettingSyncMode.bind(this);
        // this.$$parseReplicationResult = this.$$parseReplicationResult.bind(this);
        // this.$$replicate = this.$$replicate.bind(this);
        // this.core.$$onLiveSyncReady = this.core.$$onLiveSyncReady.bind(this);
        await this.core.services.appLifecycle.onLoaded();
        await Promise.all(this.core.addOns.map((e) => e.onload()));
        return true;
    }

    async _onLiveSyncUnload(): Promise<void> {
        eventHub.emitEvent(EVENT_PLUGIN_UNLOADED);
        await this.services.appLifecycle.onBeforeUnload();
        cancelAllPeriodicTask();
        cancelAllTasks();
        stopAllRunningProcessors();
        await this.services.appLifecycle.onUnload();
        this._unloaded = true;
        for (const addOn of this.core.addOns) {
            addOn.onunload();
        }
        if (this.localDatabase != null) {
            this.localDatabase.onunload();
            if (this.core.replicator) {
                this.core.replicator?.closeReplication();
            }
            await this.localDatabase.close();
        }
        eventHub.emitEvent(EVENT_PLATFORM_UNLOADED);
        eventHub.offAll();
        this._log($msg("moduleLiveSyncMain.logUnloadingPlugin"));
        return;
    }

    private async _realizeSettingSyncMode(): Promise<void> {
        await this.services.appLifecycle.onSuspending();
        await this.services.setting.onBeforeRealiseSetting();
        this.localDatabase.refreshSettings();
        await this.services.fileProcessing.commitPendingFileEvents();
        await this.services.setting.onRealiseSetting();
        // disable all sync temporary.
        if (this.services.appLifecycle.isSuspended()) return;
        await this.services.appLifecycle.onResuming();
        await this.services.appLifecycle.onResumed();
        await this.services.setting.onSettingRealised();
        return;
    }

    _isReloadingScheduled(): boolean {
        return this.core._totalProcessingCount !== undefined;
    }

    isReady = false;

    _isReady(): boolean {
        return this.isReady;
    }

    _markIsReady(): void {
        this.isReady = true;
    }

    _resetIsReady(): void {
        this.isReady = false;
    }

    _suspended = false;
    _isSuspended(): boolean {
        return this._suspended || !this.settings?.isConfigured;
    }

    _setSuspended(value: boolean) {
        this._suspended = value;
    }

    _unloaded = false;
    _isUnloaded(): boolean {
        return this._unloaded;
    }

    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void {
        super.onBindFunction(core, services);
        services.appLifecycle.handleIsSuspended(this._isSuspended.bind(this));
        services.appLifecycle.handleSetSuspended(this._setSuspended.bind(this));
        services.appLifecycle.handleIsReady(this._isReady.bind(this));
        services.appLifecycle.handleMarkIsReady(this._markIsReady.bind(this));
        services.appLifecycle.handleResetIsReady(this._resetIsReady.bind(this));
        services.appLifecycle.handleHasUnloaded(this._isUnloaded.bind(this));
        services.appLifecycle.handleIsReloadingScheduled(this._isReloadingScheduled.bind(this));
        services.appLifecycle.handleOnReady(this._onLiveSyncReady.bind(this));
        services.appLifecycle.handleOnWireUpEvents(this._wireUpEvents.bind(this));
        services.appLifecycle.handleOnLoad(this._onLiveSyncLoad.bind(this));
        services.appLifecycle.handleOnAppUnload(this._onLiveSyncUnload.bind(this));
        services.setting.handleRealiseSetting(this._realizeSettingSyncMode.bind(this));
    }
}
