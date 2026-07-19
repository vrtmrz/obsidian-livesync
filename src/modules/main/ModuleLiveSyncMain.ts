import { fireAndForget } from "octagonal-wheels/promises";
import {
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    EVENT_LAYOUT_READY,
    EVENT_PLUGIN_LOADED,
    EVENT_REQUEST_RELOAD_SETTING_TAB,
    EVENT_SETTING_SAVED,
    eventHub,
} from "@/common/events.ts";
import { $msg, setLang } from "@vrtmrz/livesync-commonlib/compat/common/i18n";
import { AbstractModule } from "@/modules/AbstractModule.ts";
import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import type { LiveSyncCore } from "@/main.ts";
import { initialiseWorkerModule } from "@vrtmrz/livesync-commonlib/compat/worker/bgWorker";
import { manifestVersion, packageVersion } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvVars";

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
        await this.services.control.applySettings();
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
            fireAndForget(async () => {
                try {
                    const lang = this.core.services.setting.currentSettings()?.displayLanguage;
                    if (lang !== undefined) {
                        setLang(lang);
                    }
                    if (this.core.services.database.isDatabaseReady()) {
                        await this.core.services.control.applySettings();
                    }
                    eventHub.emitEvent(EVENT_REQUEST_RELOAD_SETTING_TAB);
                } catch (e) {
                    this._log(`Error in Setting Save Event`, LOG_LEVEL_NOTICE);
                    this._log(e, LOG_LEVEL_VERBOSE);
                }
            });
        });
        return Promise.resolve(true);
    }

    async _onLiveSyncLoad(): Promise<boolean> {
        initialiseWorkerModule(this.services.context.events);
        await this.services.appLifecycle.onWireUpEvents();
        // debugger;
        eventHub.emitEvent(EVENT_PLUGIN_LOADED);
        this._log($msg("moduleLiveSyncMain.logLoadingPlugin"));
        if (!(await this.services.appLifecycle.onInitialise())) {
            this._log($msg("moduleLiveSyncMain.logPluginInitCancelled"), LOG_LEVEL_NOTICE);
            return false;
        }
        // this.addUIs();
        this._log($msg("moduleLiveSyncMain.logPluginVersion", { manifestVersion, packageVersion }));
        await this.services.setting.loadSettings();
        if (!(await this.services.appLifecycle.onSettingLoaded())) {
            this._log($msg("moduleLiveSyncMain.logPluginInitCancelled"), LOG_LEVEL_NOTICE);
            return false;
        }
        await this.services.database.openDatabase({
            databaseEvents: this.services.databaseEvents,
            replicator: this.services.replicator,
        });
        // this.core.$$realizeSettingSyncMode = this.core.$$realizeSettingSyncMode.bind(this);
        // this.$$parseReplicationResult = this.$$parseReplicationResult.bind(this);
        // this.$$replicate = this.$$replicate.bind(this);
        // this.core.$$onLiveSyncReady = this.core.$$onLiveSyncReady.bind(this);
        await this.core.services.appLifecycle.onLoaded();
        await Promise.all(this.core.addOns.map((e) => Promise.resolve(e.onload())));
        return true;
    }

    // async _onLiveSyncUnload(): Promise<void> {
    //     eventHub.emitEvent(EVENT_PLUGIN_UNLOADED);
    //     await this.services.appLifecycle.onBeforeUnload();
    //     cancelAllPeriodicTask();
    //     cancelAllTasks();
    //     stopAllRunningProcessors();
    //     await this.services.appLifecycle.onUnload();
    //     this._unloaded = true;
    //     for (const addOn of this.core.addOns) {
    //         addOn.onunload();
    //     }
    //     if (this.localDatabase != null) {
    //         this.localDatabase.onunload();
    //         if (this.core.replicator) {
    //             this.core.replicator?.closeReplication();
    //         }
    //         await this.localDatabase.close();
    //     }
    //     eventHub.emitEvent(EVENT_PLATFORM_UNLOADED);
    //     eventHub.offAll();
    //     this._log($msg("moduleLiveSyncMain.logUnloadingPlugin"));
    //     return;
    // }

    // private async _realizeSettingSyncMode(): Promise<void> {
    //     await this.services.appLifecycle.onSuspending();
    //     await this.services.setting.onBeforeRealiseSetting();
    //     this.localDatabase.refreshSettings();
    //     await this.services.fileProcessing.commitPendingFileEvents();
    //     await this.services.setting.onRealiseSetting();
    //     // disable all sync temporary.
    //     if (this.services.appLifecycle.isSuspended()) return;
    //     await this.services.appLifecycle.onResuming();
    //     await this.services.appLifecycle.onResumed();
    //     await this.services.setting.onSettingRealised();
    //     return;
    // }

    // isReady = false;

    // _isReady(): boolean {
    //     return this.isReady;
    // }

    // _markIsReady(): void {
    //     this.isReady = true;
    // }

    // _resetIsReady(): void {
    //     this.isReady = false;
    // }

    // _suspended = false;
    // _isSuspended(): boolean {
    //     return this._suspended || !this.settings?.isConfigured;
    // }

    // _setSuspended(value: boolean) {
    //     this._suspended = value;
    // }

    // _unloaded = false;
    // _isUnloaded(): boolean {
    //     return this._unloaded;
    // }

    override onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void {
        super.onBindFunction(core, services);
        // services.appLifecycle.isSuspended.setHandler(this._isSuspended.bind(this));
        // services.appLifecycle.setSuspended.setHandler(this._setSuspended.bind(this));
        // services.appLifecycle.isReady.setHandler(this._isReady.bind(this));
        // services.appLifecycle.markIsReady.setHandler(this._markIsReady.bind(this));
        // services.appLifecycle.resetIsReady.setHandler(this._resetIsReady.bind(this));
        // services.appLifecycle.hasUnloaded.setHandler(this._isUnloaded.bind(this));
        services.appLifecycle.onReady.addHandler(this._onLiveSyncReady.bind(this));
        services.appLifecycle.onWireUpEvents.addHandler(this._wireUpEvents.bind(this));
        services.appLifecycle.onLoad.addHandler(this._onLiveSyncLoad.bind(this));
    }
}
