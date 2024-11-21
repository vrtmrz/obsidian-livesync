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
import type { ICoreModule } from "../ModuleTypes.ts";
import type { LiveSyncCouchDBReplicator } from "../../lib/src/replication/couchdb/LiveSyncReplicator.ts";
import { fetchAllUsedChunks } from "../../lib/src/pouchdb/utils_couchdb.ts";

export class ModuleRebuilder extends AbstractModule implements ICoreModule, Rebuilder {
    $everyOnload(): Promise<boolean> {
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

    async askUsingOptionalFeature(opt: { enableFetch?: boolean; enableOverwrite?: boolean }) {
        if (
            (await this.core.confirm.askYesNoDialog(
                "Do you want to enable extra features? If you are new to Self-hosted LiveSync, try the core feature first!",
                { title: "Enable extra features", defaultOption: "No", timeout: 15 }
            )) == "yes"
        ) {
            await this.core.$allAskUsingOptionalSyncFeature(opt);
        }
    }

    async rebuildRemote() {
        await this.core.$allSuspendExtraSync();
        this.core.settings.isConfigured = true;

        await this.core.$$realizeSettingSyncMode();
        await this.core.$$markRemoteLocked();
        await this.core.$$tryResetRemoteDatabase();
        await this.core.$$markRemoteLocked();
        await delay(500);
        await this.askUsingOptionalFeature({ enableOverwrite: true });
        await delay(1000);
        await this.core.$$replicateAllToServer(true);
        await delay(1000);
        await this.core.$$replicateAllToServer(true, true);
    }
    $rebuildRemote(): Promise<void> {
        return this.rebuildRemote();
    }

    async rebuildEverything() {
        await this.core.$allSuspendExtraSync();
        await this.askUseNewAdapter();
        this.core.settings.isConfigured = true;
        await this.core.$$realizeSettingSyncMode();
        await this.resetLocalDatabase();
        await delay(1000);
        await this.core.$$initializeDatabase(true);
        await this.core.$$markRemoteLocked();
        await this.core.$$tryResetRemoteDatabase();
        await this.core.$$markRemoteLocked();
        await delay(500);
        // We do not have any other devices' data, so we do not need to ask for overwriting.
        await this.askUsingOptionalFeature({ enableOverwrite: false });
        await delay(1000);
        await this.core.$$replicateAllToServer(true);
        await delay(1000);
        await this.core.$$replicateAllToServer(true, true);
    }

    $rebuildEverything(): Promise<void> {
        return this.rebuildEverything();
    }

    $fetchLocal(makeLocalChunkBeforeSync?: boolean): Promise<void> {
        return this.fetchLocal(makeLocalChunkBeforeSync);
    }

    async scheduleRebuild(): Promise<void> {
        try {
            await this.core.storageAccess.writeFileAuto(FLAGMD_REDFLAG2_HR, "");
        } catch (ex) {
            this._log("Could not create red_flag_rebuild.md", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        this.core.$$performRestart();
    }
    async scheduleFetch(): Promise<void> {
        try {
            await this.core.storageAccess.writeFileAuto(FLAGMD_REDFLAG3_HR, "");
        } catch (ex) {
            this._log("Could not create red_flag_fetch.md", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        this.core.$$performRestart();
    }

    async $$tryResetRemoteDatabase(): Promise<void> {
        await this.core.replicator.tryResetRemoteDatabase(this.settings);
    }

    async $$tryCreateRemoteDatabase(): Promise<void> {
        await this.core.replicator.tryCreateRemoteDatabase(this.settings);
    }

    async $$resetLocalDatabase(): Promise<void> {
        this.core.storageAccess.clearTouched();
        await this.localDatabase.resetDatabase();
    }

    async suspendAllSync() {
        this.core.settings.liveSync = false;
        this.core.settings.periodicReplication = false;
        this.core.settings.syncOnSave = false;
        this.core.settings.syncOnEditorSave = false;
        this.core.settings.syncOnStart = false;
        this.core.settings.syncOnFileOpen = false;
        this.core.settings.syncAfterMerge = false;
        await this.core.$allSuspendExtraSync();
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
        await this.core.$$performFullScan(true);
        await this.core.$everyBeforeReplicate(false); //TODO: Check actual need of this.
        await this.core.saveSettings();
    }
    async askUseNewAdapter() {
        if (!this.core.settings.useIndexedDBAdapter) {
            const message = `Now this core has been configured to use the old database adapter for keeping compatibility. Do you want to deactivate it?`;
            const CHOICE_YES = "Yes, disable and use latest";
            const CHOICE_NO = "No, keep compatibility";
            const choices = [CHOICE_YES, CHOICE_NO];

            const ret = await this.core.confirm.confirmWithMessage(
                "Database adapter",
                message,
                choices,
                CHOICE_YES,
                10
            );
            if (ret == CHOICE_YES) {
                this.core.settings.useIndexedDBAdapter = true;
            }
        }
    }
    async fetchLocal(makeLocalChunkBeforeSync?: boolean) {
        await this.core.$allSuspendExtraSync();
        await this.askUseNewAdapter();
        this.core.settings.isConfigured = true;
        await this.suspendReflectingDatabase();
        await this.core.$$realizeSettingSyncMode();
        await this.resetLocalDatabase();
        await delay(1000);
        await this.core.$$openDatabase();
        // this.core.isReady = true;
        this.core.$$markIsReady();
        if (makeLocalChunkBeforeSync) {
            await this.core.fileHandler.createAllChunks(true);
        }
        await this.core.$$markRemoteResolved();
        await delay(500);
        await this.core.$$replicateAllFromServer(true);
        await delay(1000);
        await this.core.$$replicateAllFromServer(true);
        await this.resumeReflectingDatabase();
        await this.askUsingOptionalFeature({ enableFetch: true });
    }
    async fetchLocalWithRebuild() {
        return await this.fetchLocal(true);
    }

    async $allSuspendAllSync(): Promise<boolean> {
        await this.suspendAllSync();
        return true;
    }

    async resetLocalDatabase() {
        if (this.core.settings.isConfigured && this.core.settings.additionalSuffixOfDatabaseName == "") {
            // Discard the non-suffixed database
            await this.core.$$resetLocalDatabase();
        }
        const suffix = (await this.core.$anyGetAppId()) || "";
        this.core.settings.additionalSuffixOfDatabaseName = suffix;
        await this.core.$$resetLocalDatabase();
    }
    async fetchRemoteChunks() {
        if (
            !this.core.settings.doNotSuspendOnFetching &&
            this.core.settings.readChunksOnline &&
            this.core.settings.remoteType == REMOTE_COUCHDB
        ) {
            this._log(`Fetching chunks`, LOG_LEVEL_NOTICE);
            const replicator = this.core.$$getReplicator() as LiveSyncCouchDBReplicator;
            const remoteDB = await replicator.connectRemoteCouchDBWithSetting(
                this.settings,
                this.core.$$isMobile(),
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
            await this.core.$anyResolveConflictByNewest(file);
        }
        this._log(`Done!`, LOG_LEVEL_NOTICE, "resolveAllConflictedFilesByNewerOnes");
    }
}
