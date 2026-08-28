import { LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import {
    isReplicationCompleted,
    NO_INTERACTION,
    type ContinuousReplicationRequest,
    type ReplicationOutcome,
    type UnattendedOneShotRequest,
} from "@vrtmrz/livesync-commonlib/replication";
import { PeriodicProcessor } from "@/common/PeriodicProcessor";

type ReplicationSchedulingSettings = Pick<
    ObsidianLiveSyncSettings,
    "isConfigured" | "liveSync" | "syncOnStart" | "periodicReplication" | "periodicReplicationInterval"
>;

/** Timer operations required by the scheduling state owner. */
export interface ReplicationSchedulingTimer {
    enable(intervalMs: number): void;
    disable(): void;
}

/** Daemon-only controls which do not expose mutable scheduling state. */
export interface ReplicationSchedulingControl {
    /** Let an external daemon poller become, or cease to be, the recurring-work owner. */
    setExternalPollingMode(enabled: boolean): void;
    /** Consume the next resume-triggered OneShot because the daemon has already converged once. */
    markInitialOneShotSatisfied(): void;
}

interface ReplicationSchedulingDependencies {
    isReady(): boolean;
    isSuspended(): boolean;
    currentSettings(): ReplicationSchedulingSettings;
    replicateUnattended(request: UnattendedOneShotRequest): Promise<ReplicationOutcome>;
    startContinuous(request: ContinuousReplicationRequest): Promise<ReplicationOutcome>;
    timer: ReplicationSchedulingTimer;
    log(error: unknown): void;
}

interface ReplicationSchedulingState {
    externalPolling: boolean;
    continuousOwnsRecurring: boolean;
    initialOneShotSatisfied: boolean;
    lifecycleAllowsScheduling: boolean;
    lifecycleGeneration: number;
    resumeOperation: Promise<void> | undefined;
    runningResumeGeneration: number | undefined;
    queuedResumeGeneration: number | undefined;
}

/** Private state and collaborators owned by the replication scheduling serviceFeature. */
interface ReplicationSchedulingContext {
    readonly dependencies: ReplicationSchedulingDependencies;
    readonly state: ReplicationSchedulingState;
}

function isCapabilityUnavailable(result: ReplicationOutcome): boolean {
    return (
        result.status === "blocked" &&
        (result.reason === "capability-not-applicable" || result.reason === "capability-not-implemented")
    );
}

/** Construct the independently testable context owned by the serviceFeature. */
export function createReplicationSchedulingContext(
    dependencies: ReplicationSchedulingDependencies
): ReplicationSchedulingContext {
    return {
        dependencies,
        state: {
            externalPolling: false,
            continuousOwnsRecurring: false,
            initialOneShotSatisfied: false,
            // AppLifecycleService does not expose physical visibility as
            // isSuspended(). Keep the observed state in this private context.
            lifecycleAllowsScheduling: false,
            lifecycleGeneration: 0,
            resumeOperation: undefined,
            runningResumeGeneration: undefined,
            queuedResumeGeneration: undefined,
        },
    };
}

function canRunPeriodic(context: ReplicationSchedulingContext, settings: ReplicationSchedulingSettings): boolean {
    const { dependencies, state } = context;
    return (
        state.lifecycleAllowsScheduling &&
        !state.externalPolling &&
        !state.continuousOwnsRecurring &&
        dependencies.isReady() &&
        !dependencies.isSuspended() &&
        settings.isConfigured === true &&
        settings.periodicReplication === true
    );
}

function reconcilePeriodic(context: ReplicationSchedulingContext): void {
    const { dependencies } = context;
    const settings = dependencies.currentSettings();
    if (canRunPeriodic(context, settings)) {
        dependencies.timer.enable(settings.periodicReplicationInterval * 1000);
    } else {
        dependencies.timer.disable();
    }
}

function setContinuousOwnership(context: ReplicationSchedulingContext, ownsRecurring: boolean): void {
    const { state } = context;
    if (state.continuousOwnsRecurring === ownsRecurring) return;
    state.continuousOwnsRecurring = ownsRecurring;
    reconcilePeriodic(context);
}

function isCurrentLifecycleGeneration(context: ReplicationSchedulingContext, generation: number): boolean {
    return generation === context.state.lifecycleGeneration;
}

function canRunResume(context: ReplicationSchedulingContext, generation: number): boolean {
    const { dependencies, state } = context;
    return (
        isCurrentLifecycleGeneration(context, generation) &&
        state.lifecycleAllowsScheduling &&
        !state.externalPolling &&
        dependencies.isReady() &&
        !dependencies.isSuspended()
    );
}

async function runAfterResume(context: ReplicationSchedulingContext, generation: number): Promise<void> {
    if (!canRunResume(context, generation)) return;

    const { dependencies, state } = context;
    const settings = dependencies.currentSettings();
    if (!settings.isConfigured) {
        setContinuousOwnership(context, false);
        return;
    }

    const skipOneShot = state.initialOneShotSatisfied;
    // This marker belongs to one resume attempt. Consume it before any network
    // await so an exceptional Continuous start cannot suppress a later retry.
    state.initialOneShotSatisfied = false;
    if (settings.liveSync) {
        setContinuousOwnership(context, true);
        let result: ReplicationOutcome;
        try {
            result = await dependencies.startContinuous({
                trigger: "resume",
                interaction: NO_INTERACTION,
            });
        } catch (error) {
            if (isCurrentLifecycleGeneration(context, generation)) {
                setContinuousOwnership(context, false);
            }
            throw error;
        }
        if (!isReplicationCompleted(result) && isCurrentLifecycleGeneration(context, generation)) {
            setContinuousOwnership(context, false);
        }
        // A suspend/resume may have started a new lifecycle generation while
        // Continuous was settling. Do not let the obsolete result schedule a
        // finite fallback for the new generation.
        if (isCapabilityUnavailable(result) && canRunResume(context, generation)) {
            const currentSettings = dependencies.currentSettings();
            if (
                currentSettings.isConfigured &&
                currentSettings.liveSync &&
                currentSettings.syncOnStart &&
                !skipOneShot
            ) {
                await dependencies.replicateUnattended({
                    trigger: "resume",
                    interaction: NO_INTERACTION,
                });
            }
        }
        return;
    }

    setContinuousOwnership(context, false);
    if (settings.syncOnStart && !skipOneShot) {
        await dependencies.replicateUnattended({
            trigger: "resume",
            interaction: NO_INTERACTION,
        });
    }
}

function scheduleAfterResume(context: ReplicationSchedulingContext): void {
    const { dependencies, state } = context;
    const requestedGeneration = state.lifecycleGeneration;
    if (state.resumeOperation) {
        // Duplicate notifications within one generation share the current
        // operation. A later lifecycle generation must run after it.
        if (state.runningResumeGeneration !== requestedGeneration) {
            state.queuedResumeGeneration = requestedGeneration;
        }
        return;
    }
    state.runningResumeGeneration = requestedGeneration;
    state.resumeOperation = runAfterResume(context, requestedGeneration)
        .catch((error: unknown) => {
            dependencies.log(error);
        })
        .finally(() => {
            state.resumeOperation = undefined;
            state.runningResumeGeneration = undefined;
            const queuedGeneration = state.queuedResumeGeneration;
            state.queuedResumeGeneration = undefined;
            if (queuedGeneration === state.lifecycleGeneration && state.lifecycleAllowsScheduling) {
                scheduleAfterResume(context);
            }
        });
}

/** Schedule eligible work after the application has resumed. */
export function resumeReplicationScheduling(context: ReplicationSchedulingContext): void {
    const { state } = context;
    if (!state.lifecycleAllowsScheduling) {
        state.lifecycleGeneration += 1;
    }
    state.lifecycleAllowsScheduling = true;
    // runAfterResume executes synchronously until its first await. A Continuous
    // request therefore reserves ownership before Periodic is reconciled.
    scheduleAfterResume(context);
    reconcilePeriodic(context);
}

/** Stop generic Periodic scheduling before the application suspends. */
export function suspendReplicationScheduling(context: ReplicationSchedulingContext): void {
    context.state.lifecycleAllowsScheduling = false;
    context.state.queuedResumeGeneration = undefined;
    context.dependencies.timer.disable();
}

/** Stop generic Periodic scheduling while settings and provider bindings change. */
export function prepareReplicationSchedulingForSettings(context: ReplicationSchedulingContext): void {
    context.dependencies.timer.disable();
}

/** Reconcile generic Periodic scheduling after settings have settled. */
export function realiseReplicationScheduling(context: ReplicationSchedulingContext): void {
    reconcilePeriodic(context);
}

/** Prevent later timer callbacks from scheduling new work during unload. */
export function unloadReplicationScheduling(context: ReplicationSchedulingContext): void {
    context.state.lifecycleAllowsScheduling = false;
    context.state.queuedResumeGeneration = undefined;
    context.dependencies.timer.disable();
}

/** Execute one timer callback if Periodic still owns recurring work. */
export async function runPeriodicReplication(context: ReplicationSchedulingContext): Promise<void> {
    const { dependencies } = context;
    // Clearing an interval does not retract a callback which is already queued.
    // Recheck ownership and lifecycle state at execution time.
    if (!canRunPeriodic(context, dependencies.currentSettings())) return;
    await dependencies.replicateUnattended({
        trigger: "periodic",
        interaction: NO_INTERACTION,
    });
}

/** Declare that an external poller has become, or ceased to be, the recurring-work owner. */
export function setExternalPollingMode(context: ReplicationSchedulingContext, enabled: boolean): void {
    if (context.state.externalPolling === enabled) return;
    context.state.externalPolling = enabled;
    reconcilePeriodic(context);
}

/** Consume the next resume-triggered OneShot because the daemon has already converged once. */
export function markInitialOneShotSatisfied(context: ReplicationSchedulingContext): void {
    context.state.initialOneShotSatisfied = true;
}

type ReplicationSchedulingHost = NecessaryServices<
    "API" | "appLifecycle" | "control" | "replication" | "setting",
    never
>;

type ReplicationSchedulingTimerFactory = (process: () => Promise<void>) => ReplicationSchedulingTimer;

/**
 * Compose host lifecycle bindings around one private scheduling context.
 *
 * The returned view is intentionally limited to daemon scheduling controls.
 * @param host Narrow service container used to bind scheduling to the host lifecycle.
 * @param createTimer Timer adapter factory, replaceable by focused tests.
 * @returns Commands which let the CLI daemon declare its scheduling ownership.
 */
export function useReplicationScheduling(
    host: ReplicationSchedulingHost,
    createTimer: ReplicationSchedulingTimerFactory = (process) => new PeriodicProcessor(host, process)
): ReplicationSchedulingControl {
    const services = host.services;
    const log = createInstanceLogFunction("SF:ReplicationScheduling", services.API);
    let context!: ReplicationSchedulingContext;
    const timer = createTimer(async () => await runPeriodicReplication(context));
    context = createReplicationSchedulingContext({
        isReady: () => services.appLifecycle.isReady(),
        isSuspended: () => services.appLifecycle.isSuspended(),
        currentSettings: () => services.setting.currentSettings(),
        replicateUnattended: (request) => services.replication.replicateUnattended(request),
        startContinuous: (request) => services.replication.startContinuous(request),
        timer,
        log: (error) => log(error, LOG_LEVEL_VERBOSE),
    });

    services.appLifecycle.onUnload.addHandler(() => {
        unloadReplicationScheduling(context);
        return Promise.resolve(true);
    });
    services.setting.onBeforeRealiseSetting.addHandler(() => {
        prepareReplicationSchedulingForSettings(context);
        return Promise.resolve(true);
    });
    services.setting.onSettingRealised.addHandler(() => {
        realiseReplicationScheduling(context);
        return Promise.resolve(true);
    });
    services.appLifecycle.onSuspending.addHandler(() => {
        suspendReplicationScheduling(context);
        return Promise.resolve(true);
    });
    services.appLifecycle.onResumed.addHandler(() => {
        resumeReplicationScheduling(context);
        return Promise.resolve(true);
    });

    return Object.freeze({
        setExternalPollingMode: (enabled: boolean) => setExternalPollingMode(context, enabled),
        markInitialOneShotSatisfied: () => markInitialOneShotSatisfied(context),
    });
}
