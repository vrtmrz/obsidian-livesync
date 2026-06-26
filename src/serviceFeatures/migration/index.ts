import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "@lib/common/logger.ts";
import {
    EVENT_REQUEST_OPEN_P2P,
    EVENT_REQUEST_OPEN_SETTING_WIZARD,
    EVENT_REQUEST_OPEN_SETTINGS,
    EVENT_REQUEST_RUN_DOCTOR,
    EVENT_REQUEST_RUN_FIX_INCOMPLETE,
    eventHub,
} from "@/common/events.ts";
import { $msg } from "@lib/common/i18n.ts";
import { performDoctorConsultation, RebuildOptions } from "@lib/common/configForDoc.ts";
import { isValidPath } from "@/common/utils.ts";
import { isMetaEntry } from "@lib/common/types.ts";
import { isDeletedEntry, isDocContentSame, isLoadedEntry, readAsBlob } from "@lib/common/utils.ts";
import { countCompromisedChunks } from "@lib/pouchdb/negotiation.ts";
import { createObsidianServiceFeature } from "@/types.ts";
import { getSetupManager } from "@/serviceFeatures/setupManager/index.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils.ts";
import { type LogFunction } from "@lib/services/lib/logUtils.ts";

type ErrorInfo = {
    path: string;
    recordedSize: number;
    actualSize: number;
    storageSize: number;
    contentMatched: boolean;
    isConflicted?: boolean;
};

export const useMigrationFeature = createObsidianServiceFeature<
    "API" | "appLifecycle" | "setting" | "database" | "path" | "vault" | "replicator" | "UI" | "keyValueDB",
    "storageAccess" | "fileHandler" | "rebuilder"
>((host) => {
    const services = host.services;
    const serviceModules = host.serviceModules;
    const log: LogFunction = createInstanceLogFunction("Migration", services.API);

    const migrateUsingDoctor = async (
        skipRebuild: boolean = false,
        activateReason = "updated",
        forceRescan = false
    ) => {
        const env = { confirm: services.UI.confirm };
        const { shouldRebuild, shouldRebuildLocal, isModified, settings } = await performDoctorConsultation(
            env,
            services.setting.settings,
            {
                localRebuild: skipRebuild ? RebuildOptions.SkipEvenIfRequired : RebuildOptions.AutomaticAcceptable,
                remoteRebuild: skipRebuild ? RebuildOptions.SkipEvenIfRequired : RebuildOptions.AutomaticAcceptable,
                activateReason,
                forceRescan,
            }
        );
        if (isModified) {
            await services.setting.applyExternalSettings(settings, true);
        }
        if (!skipRebuild) {
            if (shouldRebuild) {
                await serviceModules.rebuilder.scheduleRebuild();
                services.appLifecycle.performRestart();
                return false;
            } else if (shouldRebuildLocal) {
                await serviceModules.rebuilder.scheduleFetch();
                services.appLifecycle.performRestart();
                return false;
            }
        }
        return true;
    };

    const migrateDisableBulkSend = async () => {
        if (services.setting.settings.sendChunksBulk) {
            log($msg("moduleMigration.logBulkSendCorrupted"), LOG_LEVEL_NOTICE);
            await services.setting.applyExternalSettings(
                {
                    ...services.setting.settings,
                    sendChunksBulk: false,
                    sendChunksBulkMaxSize: 1,
                },
                true
            );
        }
    };

    const initialMessage = async () => {
        return await getSetupManager().startOnBoarding();
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const askAgainForSetupURI = async () => {
        const message = $msg("moduleMigration.msgRecommendSetupUri", { URI_DOC: $msg("moduleMigration.docUri") });
        const USE_MINIMAL = $msg("moduleMigration.optionSetupWizard");
        const USE_P2P = $msg("moduleMigration.optionSetupViaP2P");
        const USE_SETUP = $msg("moduleMigration.optionManualSetup");
        const NEXT = $msg("moduleMigration.optionRemindNextLaunch");

        const ret = await services.UI.confirm.askSelectStringDialogue(
            message,
            [USE_MINIMAL, USE_SETUP, USE_P2P, NEXT],
            {
                title: $msg("moduleMigration.titleRecommendSetupUri"),
                defaultAction: USE_MINIMAL,
            }
        );
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
    };

    const hasIncompleteDocs = async (force: boolean = false): Promise<boolean> => {
        const kvDB = services.keyValueDB.kvDB;
        const incompleteDocsChecked = (await kvDB.get<boolean>("checkIncompleteDocs")) || false;
        if (incompleteDocsChecked && !force) {
            log("Incomplete docs check already done, skipping.", LOG_LEVEL_VERBOSE);
            return Promise.resolve(true);
        }

        log("Checking for incomplete documents...", LOG_LEVEL_NOTICE, "check-incomplete");

        const errorFiles = [] as ErrorInfo[];
        for await (const metaDoc of services.database.localDatabase.findAllNormalDocs({ conflicts: true })) {
            const path = services.path.getPath(metaDoc);

            if (!isValidPath(path)) {
                continue;
            }
            if (!(await services.vault.isTargetFile(path))) {
                continue;
            }
            if (!isMetaEntry(metaDoc)) {
                continue;
            }

            const doc = await services.database.localDatabase.getDBEntryFromMeta(metaDoc);
            if (!doc || !isLoadedEntry(doc)) {
                continue;
            }
            if (isDeletedEntry(doc)) {
                continue;
            }
            const isConflicted = metaDoc?._conflicts && metaDoc._conflicts.length > 0;

            let storageFileContent;
            try {
                storageFileContent = await serviceModules.storageAccess.readHiddenFileBinary(path);
            } catch (e) {
                Logger(`Failed to read file ${path}: Possibly unprocessed or missing`);
                Logger(e, LOG_LEVEL_VERBOSE);
                continue;
            }
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
            await kvDB.set("checkIncompleteDocs", true);
            return Promise.resolve(true);
        }
        Logger(`Found ${errorFiles.length} size mismatches`, LOG_LEVEL_NOTICE);
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
        const ret = await services.UI.confirm.askSelectStringDialogue(message, [CHECK_IT_LATER, FIX, DISMISS], {
            title: $msg("moduleMigration.fix0256.title"),
            defaultAction: CHECK_IT_LATER,
        });
        if (ret == FIX) {
            for (const file of recoverable) {
                const stubFile = await serviceModules.storageAccess.getFileStub(file.path);
                if (stubFile == null) {
                    Logger(`Could not find stub file for ${file.path}`, LOG_LEVEL_NOTICE);
                    continue;
                }

                stubFile.stat.mtime = Date.now();
                const result = await serviceModules.fileHandler.storeFileToDB(stubFile, true, false);
                if (result) {
                    Logger(`Successfully restored ${file.path} from storage`);
                } else {
                    Logger(`Failed to restore ${file.path} from storage`, LOG_LEVEL_NOTICE);
                }
            }
        } else if (ret === DISMISS) {
            await kvDB.set("checkIncompleteDocs", true);
        }

        return Promise.resolve(true);
    };

    const hasCompromisedChunks = async (): Promise<boolean> => {
        Logger(`Checking for compromised chunks...`, LOG_LEVEL_VERBOSE);
        if (!services.setting.settings.encrypt) {
            return true;
        }
        const localCompromised = await countCompromisedChunks(services.database.localDatabase.localDatabase);
        const remote = services.replicator.getActiveReplicator();
        const remoteCompromised = services.API.isOnline ? await remote?.countCompromisedChunks() : 0;
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
        const result = await services.UI.confirm.askSelectStringDialogue(msg, buttons, {
            title,
            defaultAction: DISMISS,
            timeout: 0,
        });
        if (result === REBUILD) {
            await serviceModules.rebuilder.scheduleRebuild();
            services.appLifecycle.performRestart();
            return false;
        } else if (result === FETCH) {
            await serviceModules.rebuilder.scheduleFetch();
            services.appLifecycle.performRestart();
            return false;
        } else {
            log($msg("moduleMigration.insecureChunkExist.laterMessage"), LOG_LEVEL_NOTICE);
        }
        return true;
    };

    const everyOnFirstInitialize = async (): Promise<boolean> => {
        if (!services.database.localDatabase.isReady) {
            log($msg("moduleMigration.logLocalDatabaseNotReady"), LOG_LEVEL_NOTICE);
            return false;
        }
        if (services.setting.settings.isConfigured) {
            if (!(await hasCompromisedChunks())) {
                return false;
            }
            if (!(await hasIncompleteDocs())) {
                return false;
            }
            if (!(await migrateUsingDoctor(false))) {
                return false;
            }
            await migrateDisableBulkSend();
        }
        if (!services.setting.settings.isConfigured) {
            if (!(await initialMessage())) {
                log($msg("moduleMigration.logSetupCancelled"), LOG_LEVEL_NOTICE);
                return false;
            }
            if (!(await migrateUsingDoctor(true))) {
                return false;
            }
        }
        return true;
    };

    const everyOnLayoutReady = async (): Promise<boolean> => {
        eventHub.onEvent(EVENT_REQUEST_RUN_DOCTOR, async (reason) => {
            await migrateUsingDoctor(false, reason, true);
        });
        eventHub.onEvent(EVENT_REQUEST_RUN_FIX_INCOMPLETE, async () => {
            await hasIncompleteDocs(true);
        });
        return Promise.resolve(true);
    };

    services.appLifecycle.onLayoutReady.addHandler(everyOnLayoutReady);
    services.appLifecycle.onFirstInitialise.addHandler(everyOnFirstInitialize);

    return {};
});
