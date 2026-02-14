import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "../../lib/src/common/logger.ts";
import {
    EVENT_REQUEST_OPEN_P2P,
    EVENT_REQUEST_OPEN_SETTING_WIZARD,
    EVENT_REQUEST_OPEN_SETTINGS,
    EVENT_REQUEST_RUN_DOCTOR,
    EVENT_REQUEST_RUN_FIX_INCOMPLETE,
    eventHub,
} from "../../common/events.ts";
import { AbstractModule } from "../AbstractModule.ts";
import { $msg } from "src/lib/src/common/i18n.ts";
import { performDoctorConsultation, RebuildOptions } from "../../lib/src/common/configForDoc.ts";
import { isValidPath } from "../../common/utils.ts";
import { isMetaEntry } from "../../lib/src/common/types.ts";
import { isDeletedEntry, isDocContentSame, isLoadedEntry, readAsBlob } from "../../lib/src/common/utils.ts";
import { countCompromisedChunks } from "../../lib/src/pouchdb/negotiation.ts";
import type { LiveSyncCore } from "../../main.ts";
import { SetupManager } from "../features/SetupManager.ts";

type ErrorInfo = {
    path: string;
    recordedSize: number;
    actualSize: number;
    storageSize: number;
    contentMatched: boolean;
    isConflicted?: boolean;
};

export class ModuleMigration extends AbstractModule {
    async migrateUsingDoctor(skipRebuild: boolean = false, activateReason = "updated", forceRescan = false) {
        const { shouldRebuild, shouldRebuildLocal, isModified, settings } = await performDoctorConsultation(
            this.core,
            this.settings,
            {
                localRebuild: skipRebuild ? RebuildOptions.SkipEvenIfRequired : RebuildOptions.AutomaticAcceptable,
                remoteRebuild: skipRebuild ? RebuildOptions.SkipEvenIfRequired : RebuildOptions.AutomaticAcceptable,
                activateReason,
                forceRescan,
            }
        );
        if (isModified) {
            this.settings = settings;
            await this.core.saveSettings();
        }
        if (!skipRebuild) {
            if (shouldRebuild) {
                await this.core.rebuilder.scheduleRebuild();
                this.services.appLifecycle.performRestart();
                return false;
            } else if (shouldRebuildLocal) {
                await this.core.rebuilder.scheduleFetch();
                this.services.appLifecycle.performRestart();
                return false;
            }
        }
        return true;
    }

    async migrateDisableBulkSend() {
        if (this.settings.sendChunksBulk) {
            this._log($msg("moduleMigration.logBulkSendCorrupted"), LOG_LEVEL_NOTICE);
            this.settings.sendChunksBulk = false;
            this.settings.sendChunksBulkMaxSize = 1;
            await this.saveSettings();
        }
    }

    async initialMessage() {
        const manager = this.core.getModule(SetupManager);
        return await manager.startOnBoarding();
        /*
        const message = $msg("moduleMigration.msgInitialSetup", {
            URI_DOC: $msg("moduleMigration.docUri"),
        });
        const USE_SETUP = $msg("moduleMigration.optionHaveSetupUri");
        const NEXT = $msg("moduleMigration.optionNoSetupUri");

        const ret = await this.core.confirm.askSelectStringDialogue(message, [USE_SETUP, NEXT], {
            title: $msg("moduleMigration.titleWelcome"),
            defaultAction: USE_SETUP,
        });
        if (ret === USE_SETUP) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
            return false;
        } else if (ret == NEXT) {
            return true;
        }
        return false;
        */
    }

    async askAgainForSetupURI() {
        const message = $msg("moduleMigration.msgRecommendSetupUri", { URI_DOC: $msg("moduleMigration.docUri") });
        const USE_MINIMAL = $msg("moduleMigration.optionSetupWizard");
        const USE_P2P = $msg("moduleMigration.optionSetupViaP2P");
        const USE_SETUP = $msg("moduleMigration.optionManualSetup");
        const NEXT = $msg("moduleMigration.optionRemindNextLaunch");

        const ret = await this.core.confirm.askSelectStringDialogue(message, [USE_MINIMAL, USE_SETUP, USE_P2P, NEXT], {
            title: $msg("moduleMigration.titleRecommendSetupUri"),
            defaultAction: USE_MINIMAL,
        });
        if (ret === USE_MINIMAL) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETTING_WIZARD);
            return false;
        }
        if (ret === USE_P2P) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_P2P);
            return false;
        }
        if (ret === USE_SETUP) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETTINGS);
            return false;
        } else if (ret == NEXT) {
            return false;
        }
        return false;
    }

    async hasIncompleteDocs(force: boolean = false): Promise<boolean> {
        const incompleteDocsChecked = (await this.core.kvDB.get<boolean>("checkIncompleteDocs")) || false;
        if (incompleteDocsChecked && !force) {
            this._log("Incomplete docs check already done, skipping.", LOG_LEVEL_VERBOSE);
            return Promise.resolve(true);
        }

        this._log("Checking for incomplete documents...", LOG_LEVEL_NOTICE, "check-incomplete");

        const errorFiles = [] as ErrorInfo[];
        for await (const metaDoc of this.localDatabase.findAllNormalDocs({ conflicts: true })) {
            const path = this.getPath(metaDoc);

            if (!isValidPath(path)) {
                continue;
            }
            if (!(await this.services.vault.isTargetFile(path))) {
                continue;
            }
            if (!isMetaEntry(metaDoc)) {
                continue;
            }

            const doc = await this.localDatabase.getDBEntryFromMeta(metaDoc);
            if (!doc || !isLoadedEntry(doc)) {
                continue;
            }
            if (isDeletedEntry(doc)) {
                continue;
            }
            const isConflicted = metaDoc?._conflicts && metaDoc._conflicts.length > 0;

            let storageFileContent;
            try {
                storageFileContent = await this.core.storageAccess.readHiddenFileBinary(path);
            } catch (e) {
                Logger(`Failed to read file ${path}: Possibly unprocessed or missing`);
                Logger(e, LOG_LEVEL_VERBOSE);
                continue;
            }
            // const storageFileBlob = createBlob(storageFileContent);
            const sizeOnStorage = storageFileContent.byteLength;
            const recordedSize = doc.size;
            const docBlob = readAsBlob(doc);
            const actualSize = docBlob.size;
            if (
                recordedSize !== actualSize ||
                sizeOnStorage !== actualSize ||
                sizeOnStorage !== recordedSize ||
                isConflicted
            ) {
                const contentMatched = await isDocContentSame(doc.data, storageFileContent);
                errorFiles.push({
                    path,
                    recordedSize,
                    actualSize,
                    storageSize: sizeOnStorage,
                    contentMatched,
                    isConflicted,
                });
                Logger(
                    `Size mismatch for ${path}: ${recordedSize} (DB Recorded) , ${actualSize} (DB Stored) , ${sizeOnStorage} (Storage Stored), ${contentMatched ? "Content Matched" : "Content Mismatched"} ${isConflicted ? "Conflicted" : "Not Conflicted"}`
                );
            }
        }
        if (errorFiles.length == 0) {
            Logger("No size mismatches found", LOG_LEVEL_NOTICE);
            await this.core.kvDB.set("checkIncompleteDocs", true);
            return Promise.resolve(true);
        }
        Logger(`Found ${errorFiles.length} size mismatches`, LOG_LEVEL_NOTICE);
        // We have to repair them following rules and situations:
        // A. DB Recorded != DB Stored
        //   A.1. DB Recorded == Storage Stored
        //        Possibly recoverable from storage. Just overwrite the DB content with storage content.
        //   A.2. Neither
        //        Probably it cannot be resolved on this device. Even if the storage content is larger than DB Recorded, it possibly corrupted.
        //        We do not fix it automatically. Leave it as is. Possibly other device can do this.
        // B. DB Recorded == DB Stored ,  < Storage Stored
        //   Very fragile, if DB Recorded size is less than Storage Stored size, we possibly repair the content (The issue was `unexpectedly shortened file`).
        //   We do not fix it automatically, but it will be automatically overwritten in other process.
        // C. DB Recorded == DB Stored ,  > Storage Stored
        //   Probably restored by the user by resolving A or B on other device, We should overwrite the storage
        //   Also do not fix it automatically. It should be overwritten by replication.
        const recoverable = errorFiles.filter((e) => {
            return e.recordedSize === e.storageSize && !e.isConflicted;
        });
        const unrecoverable = errorFiles.filter((e) => {
            return e.recordedSize !== e.storageSize || e.isConflicted;
        });
        const fileInfo = (e: (typeof errorFiles)[0]) => {
            return `${e.path} (M: ${e.recordedSize}, A: ${e.actualSize}, S: ${e.storageSize}) ${e.isConflicted ? "(Conflicted)" : ""}`;
        };
        const messageUnrecoverable =
            unrecoverable.length > 0
                ? $msg("moduleMigration.fix0256.messageUnrecoverable", {
                      filesNotRecoverable: unrecoverable.map((e) => `- ${fileInfo(e)}`).join("\n"),
                  })
                : "";

        const message = $msg("moduleMigration.fix0256.message", {
            files: recoverable.map((e) => `- ${fileInfo(e)}`).join("\n"),
            messageUnrecoverable,
        });
        const CHECK_IT_LATER = $msg("moduleMigration.fix0256.buttons.checkItLater");
        const FIX = $msg("moduleMigration.fix0256.buttons.fix");
        const DISMISS = $msg("moduleMigration.fix0256.buttons.DismissForever");
        const ret = await this.core.confirm.askSelectStringDialogue(message, [CHECK_IT_LATER, FIX, DISMISS], {
            title: $msg("moduleMigration.fix0256.title"),
            defaultAction: CHECK_IT_LATER,
        });
        if (ret == FIX) {
            for (const file of recoverable) {
                // Overwrite the database with the files on the storage
                const stubFile = this.core.storageAccess.getFileStub(file.path);
                if (stubFile == null) {
                    Logger(`Could not find stub file for ${file.path}`, LOG_LEVEL_NOTICE);
                    continue;
                }

                stubFile.stat.mtime = Date.now();
                const result = await this.core.fileHandler.storeFileToDB(stubFile, true, false);
                if (result) {
                    Logger(`Successfully restored ${file.path} from storage`);
                } else {
                    Logger(`Failed to restore ${file.path} from storage`, LOG_LEVEL_NOTICE);
                }
            }
        } else if (ret === DISMISS) {
            // User chose to dismiss the issue
            await this.core.kvDB.set("checkIncompleteDocs", true);
        }

        return Promise.resolve(true);
    }

    async hasCompromisedChunks(): Promise<boolean> {
        Logger(`Checking for compromised chunks...`, LOG_LEVEL_VERBOSE);
        if (!this.settings.encrypt) {
            // If not encrypted, we do not need to check for compromised chunks.
            return true;
        }
        // Check local database for compromised chunks
        const localCompromised = await countCompromisedChunks(this.localDatabase.localDatabase);
        const remote = this.services.replicator.getActiveReplicator();
        const remoteCompromised = this.core.managers.networkManager.isOnline
            ? await remote?.countCompromisedChunks()
            : 0;
        if (localCompromised === false) {
            Logger(`Failed to count compromised chunks in local database`, LOG_LEVEL_NOTICE);
            return false;
        }
        if (remoteCompromised === false) {
            Logger(`Failed to count compromised chunks in remote database`, LOG_LEVEL_NOTICE);
            return false;
        }
        if (remoteCompromised === 0 && localCompromised === 0) {
            return true;
        }
        Logger(
            `Found compromised chunks : ${localCompromised} in local, ${remoteCompromised} in remote`,
            LOG_LEVEL_NOTICE
        );
        const title = $msg("moduleMigration.insecureChunkExist.title");
        const msg = $msg("moduleMigration.insecureChunkExist.message");
        const REBUILD = $msg("moduleMigration.insecureChunkExist.buttons.rebuild");
        const FETCH = $msg("moduleMigration.insecureChunkExist.buttons.fetch");
        const DISMISS = $msg("moduleMigration.insecureChunkExist.buttons.later");
        const buttons = [REBUILD, FETCH, DISMISS];
        if (remoteCompromised != 0) {
            buttons.splice(buttons.indexOf(FETCH), 1);
        }
        const result = await this.core.confirm.askSelectStringDialogue(msg, buttons, {
            title,
            defaultAction: DISMISS,
            timeout: 0,
        });
        if (result === REBUILD) {
            // Rebuild the database
            await this.core.rebuilder.scheduleRebuild();
            this.services.appLifecycle.performRestart();
            return false;
        } else if (result === FETCH) {
            // Fetch the latest data from remote
            await this.core.rebuilder.scheduleFetch();
            this.services.appLifecycle.performRestart();
            return false;
        } else {
            // User chose to dismiss the issue
            this._log($msg("moduleMigration.insecureChunkExist.laterMessage"), LOG_LEVEL_NOTICE);
        }
        return true;
    }

    async _everyOnFirstInitialize(): Promise<boolean> {
        if (!this.localDatabase.isReady) {
            this._log($msg("moduleMigration.logLocalDatabaseNotReady"), LOG_LEVEL_NOTICE);
            return false;
        }
        if (this.settings.isConfigured) {
            if (!(await this.hasCompromisedChunks())) {
                return false;
            }
            if (!(await this.hasIncompleteDocs())) {
                return false;
            }
            if (!(await this.migrateUsingDoctor(false))) {
                return false;
            }
            // await this.migrationCheck();
            await this.migrateDisableBulkSend();
        }
        if (!this.settings.isConfigured) {
            // if (!(await this.initialMessage()) || !(await this.askAgainForSetupURI())) {
            //     this._log($msg("moduleMigration.logSetupCancelled"), LOG_LEVEL_NOTICE);
            //     return false;
            // }
            if (!(await this.initialMessage())) {
                this._log($msg("moduleMigration.logSetupCancelled"), LOG_LEVEL_NOTICE);
                return false;
            }
            if (!(await this.migrateUsingDoctor(true))) {
                return false;
            }
        }
        return true;
    }
    _everyOnLayoutReady(): Promise<boolean> {
        eventHub.onEvent(EVENT_REQUEST_RUN_DOCTOR, async (reason) => {
            await this.migrateUsingDoctor(false, reason, true);
        });
        eventHub.onEvent(EVENT_REQUEST_RUN_FIX_INCOMPLETE, async () => {
            await this.hasIncompleteDocs(true);
        });
        return Promise.resolve(true);
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        super.onBindFunction(core, services);
        services.appLifecycle.onLayoutReady.addHandler(this._everyOnLayoutReady.bind(this));
        services.appLifecycle.onFirstInitialise.addHandler(this._everyOnFirstInitialize.bind(this));
    }
}
