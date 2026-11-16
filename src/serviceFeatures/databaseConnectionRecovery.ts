import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import { isInvalidStateError } from "@vrtmrz/livesync-commonlib/compat/services/base/DatabaseService";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

type RecoveryHost = NecessaryServices<
    "API" | "database" | "databaseEvents" | "appLifecycle" | "fileProcessing" | "replicator" | "setting",
    never
>;

export interface DatabaseRecoveryDispatch {
    pauseDispatch(): Promise<void>;
    resumeDispatch(): void;
}

/** Compose connection recovery only for hosts which keep accepting file events while dispatch is held. */
export function useDatabaseConnectionRecovery(
    host: RecoveryHost,
    dispatch: DatabaseRecoveryDispatch,
    isVisible: () => boolean
): void {
    const { services } = host;
    const { database, databaseEvents, appLifecycle } = services;
    const log = createInstanceLogFunction("SF:DatabaseConnectionRecovery", services.API);
    let running: Promise<boolean> | undefined;
    let lostDatabase: LiveSyncLocalDB | undefined;
    let attemptedSinceResume = false;
    let stopping = false;
    let paused = false;
    let recoveryFailed = false;

    function reportFailure(error?: unknown): false {
        recoveryFailed = true;
        log(
            "Local database access could not be restored. Please restart Obsidian to resume synchronisation.",
            LOG_LEVEL_NOTICE
        );
        if (error) {
            log(error, LOG_LEVEL_VERBOSE);
        }
        return false;
    }

    async function resumePendingWork(resumeReplication: boolean): Promise<boolean> {
        if (stopping) {
            return false;
        }
        lostDatabase = undefined;
        paused = false;
        dispatch.resumeDispatch();
        if (!(await services.fileProcessing.commitPendingFileEvents())) {
            paused = true;
            await dispatch.pauseDispatch();
            return reportFailure();
        }
        if (stopping) {
            return false;
        }
        if (!(await databaseEvents.onAfterDatabaseRecovery())) {
            return reportFailure();
        }
        if (resumeReplication && isVisible() && !appLifecycle.isSuspended()) {
            await appLifecycle.onResuming();
            await appLifecycle.onResumed();
        }
        return !stopping;
    }

    async function checkAndRecover(resumeReplication: boolean): Promise<boolean> {
        if (stopping || recoveryFailed || !appLifecycle.isReady() || !services.setting.currentSettings().isConfigured) {
            return false;
        }
        const selected = database.localDatabaseDirect;
        if (!selected || (!selected.isReady && selected !== lostDatabase)) {
            return false;
        }
        if (selected !== lostDatabase) {
            try {
                const healthy = await database.checkDatabaseConnection();
                return healthy && paused ? await resumePendingWork(resumeReplication) : healthy;
            } catch (error) {
                if (database.localDatabaseDirect !== selected) {
                    return false;
                }
                if (!isInvalidStateError(error)) {
                    return reportFailure(error);
                }
                lostDatabase = selected;
            }
        }

        // Invalidate readiness without clearing application readiness: foreground events still need to run.
        selected.isReady = false;
        paused = true;
        const dispatchedWork = dispatch.pauseDispatch();
        const suspended = await appLifecycle.onSuspending();
        const retired = await services.replicator.onCloseActiveReplication();
        await dispatchedWork;
        if (stopping) {
            return false;
        }
        if (!suspended || !retired) {
            return reportFailure();
        }
        if (!isVisible()) {
            return false;
        }
        if (attemptedSinceResume) {
            return reportFailure();
        }
        attemptedSinceResume = true;

        const reopened = await database.reopenDatabase(selected, {
            databaseEvents,
            replicator: services.replicator,
        });
        if (stopping) {
            return false;
        }
        if (!reopened) {
            // An explicit lifecycle transition may have won the owner lock. Never close its replacement.
            if (database.localDatabaseDirect !== selected && (await database.checkDatabaseConnection())) {
                return await resumePendingWork(resumeReplication);
            }
            return reportFailure();
        }
        return await resumePendingWork(resumeReplication);
    }

    function requestCheck(resumeReplication: boolean): Promise<boolean> {
        if (running) {
            return running;
        }
        const operation = checkAndRecover(resumeReplication).catch(reportFailure);
        running = operation;
        void operation.finally(() => {
            if (running === operation) {
                running = undefined;
            }
        });
        return operation;
    }

    databaseEvents.onBeforeDatabaseResume.addHandler(() => {
        // The host invokes this once per hidden-to-visible transition, not for every focus event.
        if (!running) {
            attemptedSinceResume = false;
            if (lostDatabase) {
                recoveryFailed = false;
            }
        }
        return requestCheck(false);
    });
    database.onLocalDatabaseError.addHandler(async (selected, error) => {
        if (stopping || selected !== database.localDatabaseDirect || !isInvalidStateError(error)) {
            return true;
        }
        return await requestCheck(true);
    });
    appLifecycle.onBeforeUnload.addHandler(() => {
        stopping = true;
        // Existing shutdown flush must be allowed to settle and retain failed operations.
        if (paused) {
            dispatch.resumeDispatch();
        }
        return Promise.resolve(true);
    }, -100);
}
