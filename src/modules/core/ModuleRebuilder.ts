import { delay } from "octagonal-wheels/promises";
import {
    FLAGMD_REDFLAG2_HR,
    FLAGMD_REDFLAG3_HR,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    REMOTE_COUCHDB,
    REMOTE_MINIO,
} from "../../lib/src/common/types.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { Rebuilder } from "../interfaces/DatabaseRebuilder.ts";
import type { LiveSyncCouchDBReplicator } from "../../lib/src/replication/couchdb/LiveSyncReplicator.ts";
import { fetchAllUsedChunks } from "@/lib/src/pouchdb/chunks.ts";
import { EVENT_DATABASE_REBUILT, eventHub } from "src/common/events.ts";
import type { LiveSyncCore } from "../../main.ts";

export class ModuleRebuilder extends AbstractModule implements Rebuilder {
    private _everyOnload(): Promise<boolean> {
        this.core.rebuilder = this;
        return Promise.resolve(true);
    }
    async $performRebuildDB(
        method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice" | "localOnlyWithChunks"
    ): Promise<void> {
        if (method == "localOnly") {
            await this.$fetchLocal();
        }
        if (method == "localOnlyWithChunks") {
            await this.$fetchLocal(true);
        }
        if (method == "remoteOnly") {
            await this.$rebuildRemote();
        }
        if (method == "rebuildBothByThisDevice") {
            await this.$rebuildEverything();
        }
    }

    async informOptionalFeatures() {
        await this.core.services.UI.showMarkdownDialog(
            "All optional features are disabled",
            `Customisation Sync and Hidden File Sync will all be disabled.
Please enable them from the settings screen after setup is complete.`,
            ["OK"]
        );
    }
    async askUsingOptionalFeature(opt: { enableFetch?: boolean; enableOverwrite?: boolean }) {
        if (
            (await this.core.confirm.askYesNoDialog(
                "Do you want to enable extra features? If you are new to Self-hosted LiveSync, try the core feature first!",
                { title: "Enable extra features", defaultOption: "No", timeout: 15 }
            )) == "yes"
        ) {
            await this.services.setting.suggestOptionalFeatures(opt);
        }
    }

    async rebuildRemote() {
        await this.services.setting.suspendExtraSync();
        this.core.settings.isConfigured = true;

        await this.services.setting.realiseSetting();
        await this.services.remote.markLocked();
        await this.services.remote.tryResetDatabase();
        await this.services.remote.markLocked();
        await delay(500);
        // await this.askUsingOptionalFeature({ enableOverwrite: true });
        await delay(1000);
        await this.services.remote.replicateAllToRemote(true);
        await delay(1000);
        await this.services.remote.replicateAllToRemote(true, true);
        await this.informOptionalFeatures();
    }
    $rebuildRemote(): Promise<void> {
        return this.rebuildRemote();
    }

    async rebuildEverything() {
        await this.services.setting.suspendExtraSync();
        // await this.askUseNewAdapter();
        this.core.settings.isConfigured = true;
        await this.services.setting.realiseSetting();
        await this.resetLocalDatabase();
        await delay(1000);
        await this.services.databaseEvents.initialiseDatabase(true, true, true);
        await this.services.remote.markLocked();
        await this.services.remote.tryResetDatabase();
        await this.services.remote.markLocked();
        await delay(500);
        // We do not have any other devices' data, so we do not need to ask for overwriting.
        // await this.askUsingOptionalFeature({ enableOverwrite: false });
        await delay(1000);
        await this.services.remote.replicateAllToRemote(true);
        await delay(1000);
        await this.services.remote.replicateAllToRemote(true, true);
        await this.informOptionalFeatures();
    }

    $rebuildEverything(): Promise<void> {
        return this.rebuildEverything();
    }

    $fetchLocal(makeLocalChunkBeforeSync?: boolean, preventMakeLocalFilesBeforeSync?: boolean): Promise<void> {
        return this.fetchLocal(makeLocalChunkBeforeSync, preventMakeLocalFilesBeforeSync);
    }

    async scheduleRebuild(): Promise<void> {
        try {
            await this.core.storageAccess.writeFileAuto(FLAGMD_REDFLAG2_HR, "");
        } catch (ex) {
            this._log("Could not create red_flag_rebuild.md", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        this.services.appLifecycle.performRestart();
    }
    async scheduleFetch(): Promise<void> {
        try {
            await this.core.storageAccess.writeFileAuto(FLAGMD_REDFLAG3_HR, "");
        } catch (ex) {
            this._log("Could not create red_flag_fetch.md", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        this.services.appLifecycle.performRestart();
    }

    private async _tryResetRemoteDatabase(): Promise<void> {
        await this.core.replicator.tryResetRemoteDatabase(this.settings);
    }

    private async _tryCreateRemoteDatabase(): Promise<void> {
        await this.core.replicator.tryCreateRemoteDatabase(this.settings);
    }

    private async _resetLocalDatabase(): Promise<boolean> {
        this.core.storageAccess.clearTouched();
        return await this.localDatabase.resetDatabase();
    }

    async suspendAllSync() {
        this.core.settings.liveSync = false;
        this.core.settings.periodicReplication = false;
        this.core.settings.syncOnSave = false;
        this.core.settings.syncOnEditorSave = false;
        this.core.settings.syncOnStart = false;
        this.core.settings.syncOnFileOpen = false;
        this.core.settings.syncAfterMerge = false;
        await this.services.setting.suspendExtraSync();
    }
    async suspendReflectingDatabase() {
        if (this.core.settings.doNotSuspendOnFetching) return;
        if (this.core.settings.remoteType == REMOTE_MINIO) return;
        this._log(
            `Suspending reflection: Database and storage changes will not be reflected in each other until completely finished the fetching.`,
            LOG_LEVEL_NOTICE
        );
        this.core.settings.suspendParseReplicationResult = true;
        this.core.settings.suspendFileWatching = true;
        await this.core.saveSettings();
    }
    async resumeReflectingDatabase() {
        if (this.core.settings.doNotSuspendOnFetching) return;
        if (this.core.settings.remoteType == REMOTE_MINIO) return;
        this._log(`Database and storage reflection has been resumed!`, LOG_LEVEL_NOTICE);
        this.core.settings.suspendParseReplicationResult = false;
        this.core.settings.suspendFileWatching = false;
        await this.services.vault.scanVault(true);
        await this.services.replication.onBeforeReplicate(false); //TODO: Check actual need of this.
        await this.core.saveSettings();
    }
    // No longer needed, both adapters have each advantages and disadvantages.
    // async askUseNewAdapter() {
    //     if (!this.core.settings.useIndexedDBAdapter) {
    //         const message = `Now this core has been configured to use the old database adapter for keeping compatibility. Do you want to deactivate it?`;
    //         const CHOICE_YES = "Yes, disable and use latest";
    //         const CHOICE_NO = "No, keep compatibility";
    //         const choices = [CHOICE_YES, CHOICE_NO];
    //
    //         const ret = await this.core.confirm.confirmWithMessage(
    //             "Database adapter",
    //             message,
    //             choices,
    //             CHOICE_YES,
    //             10
    //         );
    //         if (ret == CHOICE_YES) {
    //             this.core.settings.useIndexedDBAdapter = true;
    //         }
    //     }
    // }
    async fetchLocal(makeLocalChunkBeforeSync?: boolean, preventMakeLocalFilesBeforeSync?: boolean) {
        await this.services.setting.suspendExtraSync();
        // await this.askUseNewAdapter();
        this.core.settings.isConfigured = true;
        await this.suspendReflectingDatabase();
        await this.services.setting.realiseSetting();
        await this.resetLocalDatabase();
        await delay(1000);
        await this.services.database.openDatabase();
        // this.core.isReady = true;
        this.services.appLifecycle.markIsReady();
        if (makeLocalChunkBeforeSync) {
            await this.core.fileHandler.createAllChunks(true);
        } else if (!preventMakeLocalFilesBeforeSync) {
            await this.services.databaseEvents.initialiseDatabase(true, true, true);
        } else {
            // Do not create local file entries before sync (Means use remote information)
        }
        await this.services.remote.markResolved();
        await delay(500);
        await this.services.remote.replicateAllFromRemote(true);
        await delay(1000);
        await this.services.remote.replicateAllFromRemote(true);
        await this.resumeReflectingDatabase();
        await this.informOptionalFeatures();
        // No longer enable
        // await this.askUsingOptionalFeature({ enableFetch: true });
    }
    async fetchLocalWithRebuild() {
        return await this.fetchLocal(true);
    }

    private async _allSuspendAllSync(): Promise<boolean> {
        await this.suspendAllSync();
        return true;
    }

    async resetLocalDatabase() {
        if (this.core.settings.isConfigured && this.core.settings.additionalSuffixOfDatabaseName == "") {
            // Discard the non-suffixed database
            await this.services.database.resetDatabase();
        }
        const suffix = this.services.API.getAppID() || "";
        this.core.settings.additionalSuffixOfDatabaseName = suffix;
        await this.services.database.resetDatabase();
        eventHub.emitEvent(EVENT_DATABASE_REBUILT);
    }
    async fetchRemoteChunks() {
        if (
            !this.core.settings.doNotSuspendOnFetching &&
            this.core.settings.readChunksOnline &&
            this.core.settings.remoteType == REMOTE_COUCHDB
        ) {
            this._log(`Fetching chunks`, LOG_LEVEL_NOTICE);
            const replicator = this.services.replicator.getActiveReplicator() as LiveSyncCouchDBReplicator;
            const remoteDB = await replicator.connectRemoteCouchDBWithSetting(
                this.settings,
                this.services.API.isMobile(),
                true
            );
            if (typeof remoteDB == "string") {
                this._log(remoteDB, LOG_LEVEL_NOTICE);
            } else {
                await fetchAllUsedChunks(this.localDatabase.localDatabase, remoteDB.db);
            }
            this._log(`Fetching chunks done`, LOG_LEVEL_NOTICE);
        }
    }
    async resolveAllConflictedFilesByNewerOnes() {
        this._log(`Resolving conflicts by newer ones`, LOG_LEVEL_NOTICE);
        const files = this.core.storageAccess.getFileNames();

        let i = 0;
        for (const file of files) {
            if (i++ % 10)
                this._log(
                    `Check and Processing ${i} / ${files.length}`,
                    LOG_LEVEL_NOTICE,
                    "resolveAllConflictedFilesByNewerOnes"
                );
            await this.services.conflict.resolveByNewest(file);
        }
        this._log(`Done!`, LOG_LEVEL_NOTICE, "resolveAllConflictedFilesByNewerOnes");
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.handleOnLoaded(this._everyOnload.bind(this));
        services.database.handleResetDatabase(this._resetLocalDatabase.bind(this));
        services.remote.handleTryResetDatabase(this._tryResetRemoteDatabase.bind(this));
        services.remote.handleTryCreateDatabase(this._tryCreateRemoteDatabase.bind(this));
        services.setting.handleSuspendAllSync(this._allSuspendAllSync.bind(this));
    }
}
