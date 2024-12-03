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
import { $f, setLang } from "../../lib/src/common/i18n.ts";
import { versionNumberString2Number } from "../../lib/src/string_and_binary/convert.ts";
import { cancelAllPeriodicTask, cancelAllTasks } from "octagonal-wheels/concurrency/task";
import { stopAllRunningProcessors } from "octagonal-wheels/concurrency/processor";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";

export class ModuleLiveSyncMain extends AbstractModule implements ICoreModule {
    async $$onLiveSyncReady() {
        if (!(await this.core.$everyOnLayoutReady())) return;
        eventHub.emitEvent(EVENT_LAYOUT_READY);
        if (this.settings.suspendFileWatching || this.settings.suspendParseReplicationResult) {
            const ANSWER_KEEP = "Keep LiveSync disabled";
            const ANSWER_RESUME = "Resume and restart Obsidian";
            const message = `Self-hosted LiveSync has been configured to ignore some events. Is this correct?

| Type | Status | Note |
|:---:|:---:|---|
| Storage Events | ${this.settings.suspendFileWatching ? "suspended" : "active"} | Every modification will be ignored |
| Database Events | ${this.settings.suspendParseReplicationResult ? "suspended" : "active"} | Every synchronised change will be postponed |

Do you want to resume them and restart Obsidian?

> [!DETAILS]-
> These flags are set by the plug-in while rebuilding, or fetching. If the process ends abnormally, it may be kept unintended.
> If you are not sure, you can try to rerun these processes. Make sure to back your vault up.
`;
            if (
                (await this.core.confirm.askSelectStringDialogue(message, [ANSWER_KEEP, ANSWER_RESUME], {
                    defaultAction: ANSWER_KEEP,
                    title: "Scram Enabled",
                })) == ANSWER_RESUME
            ) {
                this.settings.suspendFileWatching = false;
                this.settings.suspendParseReplicationResult = false;
                await this.saveSettings();
                await this.core.$$scheduleAppReload();
                return;
            }
        }
        const isInitialized = await this.core.$$initializeDatabase(false, false);
        if (!isInitialized) {
            //TODO:stop all sync.
            return false;
        }
        if (!(await this.core.$everyOnFirstInitialize())) return;
        await this.core.$$realizeSettingSyncMode();
        fireAndForget(async () => {
            this._log(`Additional safety scan..`, LOG_LEVEL_VERBOSE);
            if (!(await this.core.$allScanStat())) {
                this._log(`Additional safety scan has failed on a module`, LOG_LEVEL_NOTICE);
            } else {
                this._log(`Additional safety scan completed`, LOG_LEVEL_VERBOSE);
            }
        });
    }

    $$wireUpEvents(): void {
        eventHub.onEvent(EVENT_SETTING_SAVED, (settings: ObsidianLiveSyncSettings) => {
            this.localDatabase.settings = settings;
            setLang(settings.displayLanguage);
            eventHub.emitEvent(EVENT_REQUEST_RELOAD_SETTING_TAB);
        });
        eventHub.onEvent(EVENT_SETTING_SAVED, (settings: ObsidianLiveSyncSettings) => {
            fireAndForget(() => this.core.$$realizeSettingSyncMode());
        });
    }

    async $$onLiveSyncLoad(): Promise<void> {
        this.$$wireUpEvents();
        // debugger;
        eventHub.emitEvent(EVENT_PLUGIN_LOADED, this.core);
        this._log("loading plugin");
        if (!(await this.core.$everyOnloadStart())) {
            this._log("Plugin initialisation was cancelled by a module", LOG_LEVEL_NOTICE);
            return;
        }
        // this.addUIs();
        //@ts-ignore
        const manifestVersion: string = MANIFEST_VERSION || "0.0.0";
        //@ts-ignore
        const packageVersion: string = PACKAGE_VERSION || "0.0.0";

        this._log($f`Self-hosted LiveSync${" v"}${manifestVersion} ${packageVersion}`);
        await this.core.$$loadSettings();
        if (!(await this.core.$everyOnloadAfterLoadSettings())) {
            this._log("Plugin initialisation was cancelled by a module", LOG_LEVEL_NOTICE);
            return;
        }
        const lsKey = "obsidian-live-sync-ver" + this.core.$$getVaultName();
        const last_version = localStorage.getItem(lsKey);

        const lastVersion = ~~(versionNumberString2Number(manifestVersion) / 1000);
        if (lastVersion > this.settings.lastReadUpdates && this.settings.isConfigured) {
            this._log($f`LiveSync has updated, please read the changelog!`, LOG_LEVEL_NOTICE);
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
            this.settings.versionUpFlash = $f`LiveSync has been updated, In case of breaking updates, all automatic synchronization has been temporarily disabled. Ensure that all devices are up to date before enabling.`;
            await this.saveSettings();
        }
        localStorage.setItem(lsKey, `${VER}`);
        await this.core.$$openDatabase();
        this.core.$$realizeSettingSyncMode = this.core.$$realizeSettingSyncMode.bind(this);
        // this.$$parseReplicationResult = this.$$parseReplicationResult.bind(this);
        // this.$$replicate = this.$$replicate.bind(this);
        this.core.$$onLiveSyncReady = this.core.$$onLiveSyncReady.bind(this);
        await this.core.$everyOnload();
        await Promise.all(this.core.addOns.map((e) => e.onload()));
    }

    async $$onLiveSyncUnload(): Promise<void> {
        eventHub.emitEvent(EVENT_PLUGIN_UNLOADED);
        await this.core.$allStartOnUnload();
        cancelAllPeriodicTask();
        cancelAllTasks();
        stopAllRunningProcessors();
        await this.core.$allOnUnload();
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
        this._log($f`unloading plugin`);
    }

    async $$realizeSettingSyncMode(): Promise<void> {
        await this.core.$everyBeforeSuspendProcess();
        await this.core.$everyBeforeRealizeSetting();
        this.localDatabase.refreshSettings();
        await this.core.$everyCommitPendingFileEvent();
        await this.core.$everyRealizeSettingSyncMode();
        // disable all sync temporary.
        if (this.core.$$isSuspended()) return;
        await this.core.$everyOnResumeProcess();
        await this.core.$everyAfterResumeProcess();
        await this.core.$everyAfterRealizeSetting();
    }

    $$isReloadingScheduled(): boolean {
        return this.core._totalProcessingCount !== undefined;
    }

    isReady = false;

    $$isReady(): boolean {
        return this.isReady;
    }

    $$markIsReady(): void {
        this.isReady = true;
    }

    $$resetIsReady(): void {
        this.isReady = false;
    }

    _suspended = false;
    $$isSuspended(): boolean {
        return this._suspended || !this.settings?.isConfigured;
    }
    $$setSuspended(value: boolean) {
        this._suspended = value;
    }

    _unloaded = false;
    $$isUnloaded(): boolean {
        return this._unloaded;
    }
}
