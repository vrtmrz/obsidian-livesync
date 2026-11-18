import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

type RecoveryHost = NecessaryServices<
    "API" | "database" | "databaseEvents" | "appLifecycle" | "fileProcessing" | "replicator" | "setting",
    never
>;

type RecoveryServices = Pick<
    RecoveryHost["services"],
    "database" | "databaseEvents" | "appLifecycle" | "fileProcessing" | "replicator" | "setting"
>;

export interface DatabaseRecoveryDispatch {
    pauseDispatch(): Promise<void>;
    resumeDispatch(): void;
}

/** Mutable state and the host capabilities owned by one recovery composition. */
export interface DatabaseConnectionRecoveryContext {
    readonly services: RecoveryServices;
    readonly dispatch: DatabaseRecoveryDispatch;
    /** Host activity phase for recovery work; readiness and explicit suspension have separate owners. */
    readonly isHostActive: () => boolean;
    readonly log: ReturnType<typeof createInstanceLogFunction>;
    running: Promise<boolean> | undefined;
    lostDatabase: LiveSyncLocalDB | undefined;
    attemptedSinceResume: boolean;
    stopping: boolean;
    paused: boolean;
    recoveryFailed: boolean;
}

/** Create the state and dependencies shared by one set of registered recovery handlers. */
export function createDatabaseConnectionRecoveryContext(
    host: RecoveryHost,
    dispatch: DatabaseRecoveryDispatch,
    isHostActive: () => boolean
): DatabaseConnectionRecoveryContext {
    const { services } = host;
    return {
        services,
        dispatch,
        isHostActive,
        log: createInstanceLogFunction("SF:DatabaseConnectionRecovery", services.API),
        running: undefined,
        lostDatabase: undefined,
        attemptedSinceResume: false,
        stopping: false,
        paused: false,
        recoveryFailed: false,
    };
}

function reportFailure(context: DatabaseConnectionRecoveryContext, error?: unknown): false {
    context.recoveryFailed = true;
    const log = context.log;
    log(
        "Local database access could not be restored. Please restart Obsidian to resume synchronisation.",
        LOG_LEVEL_NOTICE
    );
    if (error) {
        log(error, LOG_LEVEL_VERBOSE);
    }
    return false;
}

/** Resume dispatch and retained file work before allowing replication lifecycle handlers to resume. */
async function resumePendingWork(
    context: DatabaseConnectionRecoveryContext,
    resumeReplication: boolean
): Promise<boolean> {
    const isHostActive = context.isHostActive;
    if (context.stopping) {
        return false;
    }
    context.lostDatabase = undefined;
    context.paused = false;
    context.dispatch.resumeDispatch();
    if (!(await context.services.fileProcessing.commitPendingFileEvents())) {
        context.paused = true;
        await context.dispatch.pauseDispatch();
        return reportFailure(context);
    }
    if (context.stopping) {
        return false;
    }
    if (!(await context.services.databaseEvents.onAfterDatabaseRecovery())) {
        return reportFailure(context);
    }
    if (resumeReplication && isHostActive() && !context.services.appLifecycle.isSuspended()) {
        await context.services.appLifecycle.onResuming();
        await context.services.appLifecycle.onResumed();
    }
    return !context.stopping;
}

/** Read the current connection, then pause, drain, and replace only a failed current owner. */
async function ensureDatabaseConnection(
    context: DatabaseConnectionRecoveryContext,
    resumeReplication: boolean
): Promise<boolean> {
    const { services } = context;
    const isHostActive = context.isHostActive;
    const log = context.log;
    if (
        context.stopping ||
        context.recoveryFailed ||
        !services.appLifecycle.isReady() ||
        !services.setting.currentSettings().isConfigured
    ) {
        return false;
    }
    const selected = services.database.localDatabaseDirect;
    if (!selected || (!selected.isReady && selected !== context.lostDatabase)) {
        return false;
    }
    if (selected === context.lostDatabase) {
        return await replaceLostDatabase(context, selected, resumeReplication);
    }
    let readable: boolean;
    try {
        readable = await services.database.canReadCurrentDatabaseInfo();
    } catch (error) {
        if (services.database.localDatabaseDirect !== selected) {
            return false;
        }
        log(error, LOG_LEVEL_VERBOSE);
        context.lostDatabase = selected;
        return await replaceLostDatabase(context, selected, resumeReplication);
    }
    if (!readable) {
        return false;
    }
    if (context.paused) {
        return await resumePendingWork(context, resumeReplication);
    }
    // A failed transaction can settle while its connection remains usable. Publish that
    // availability so retained work can use its existing allowance without replacing the Pouch.
    if (isHostActive() && !(await services.databaseEvents.onAfterDatabaseRecovery())) {
        return reportFailure(context);
    }
    return true;
}

/** Pause and drain only a failed owned connection before its existing serialised replacement. */
async function replaceLostDatabase(
    context: DatabaseConnectionRecoveryContext,
    selected: LiveSyncLocalDB,
    resumeReplication: boolean
): Promise<boolean> {
    const { services } = context;
    // Invalidate readiness without clearing application readiness: foreground events still need to run.
    selected.isReady = false;
    selected.stopReads();
    context.paused = true;
    const dispatchedWork = context.dispatch.pauseDispatch();
    const suspended = await services.appLifecycle.onSuspending();
    const retired = await services.replicator.onCloseActiveReplication();
    await dispatchedWork;
    if (context.stopping) {
        return false;
    }
    if (!suspended || !retired) {
        return reportFailure(context);
    }
    if (!context.isHostActive()) {
        return false;
    }
    if (context.attemptedSinceResume) {
        return reportFailure(context);
    }
    context.attemptedSinceResume = true;

    const reopened = await services.database.reopenDatabase(selected, {
        databaseEvents: services.databaseEvents,
        replicator: services.replicator,
    });
    if (context.stopping) {
        return false;
    }
    if (!reopened) {
        // An explicit lifecycle transition may have won the owner lock. Never close its replacement.
        if (
            services.database.localDatabaseDirect !== selected &&
            (await services.database.canReadCurrentDatabaseInfo())
        ) {
            return await resumePendingWork(context, resumeReplication);
        }
        return reportFailure(context);
    }
    return await resumePendingWork(context, resumeReplication);
}

/** Share an in-flight inspection and recovery attempt between simultaneous error and resume signals. */
export function requestDatabaseConnectionRecovery(
    context: DatabaseConnectionRecoveryContext,
    resumeReplication: boolean
): Promise<boolean> {
    if (context.running) {
        return context.running;
    }
    const operation = ensureDatabaseConnection(context, resumeReplication).catch((error) =>
        reportFailure(context, error)
    );
    context.running = operation;
    void operation.finally(() => {
        if (context.running === operation) {
            context.running = undefined;
        }
    });
    return operation;
}

function handleBeforeDatabaseResume(context: DatabaseConnectionRecoveryContext): Promise<boolean> {
    // The host invokes this once per hidden-to-visible transition, not for every focus event.
    if (!context.running) {
        context.attemptedSinceResume = false;
        if (context.lostDatabase) {
            context.recoveryFailed = false;
        }
    }
    return requestDatabaseConnectionRecovery(context, false);
}

async function handleLocalDatabaseError(
    context: DatabaseConnectionRecoveryContext,
    selected: LiveSyncLocalDB
): Promise<boolean> {
    if (context.stopping || selected !== context.services.database.localDatabaseDirect) {
        return true;
    }
    return await requestDatabaseConnectionRecovery(context, true);
}

function handleBeforeUnload(context: DatabaseConnectionRecoveryContext): Promise<boolean> {
    context.stopping = true;
    // Existing shutdown flush must be allowed to settle and retain failed operations.
    if (context.paused) {
        context.dispatch.resumeDispatch();
    }
    return Promise.resolve(true);
}

/** Compose connection recovery only for hosts which keep accepting file events while dispatch is held. */
export function useDatabaseConnectionRecovery(
    host: RecoveryHost,
    dispatch: DatabaseRecoveryDispatch,
    isHostActive: () => boolean
): void {
    const context = createDatabaseConnectionRecoveryContext(host, dispatch, isHostActive);
    const { services } = context;

    services.databaseEvents.onBeforeDatabaseResume.addHandler(() => handleBeforeDatabaseResume(context));
    services.database.onLocalDatabaseError.addHandler((selected) => handleLocalDatabaseError(context, selected));
    services.appLifecycle.onBeforeUnload.addHandler(() => handleBeforeUnload(context), -100);
}
