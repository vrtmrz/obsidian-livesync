import { LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import type { ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import { REMOTE_COUCHDB, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { EVENT_PLUGIN_UNLOADED } from "@vrtmrz/livesync-commonlib/compat/events/coreEvents";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import {
    CAPABILITY_UNAVAILABLE_REASONS,
    EVENT_REPLICATION_ABORT_REQUESTED,
    isReplicationCompleted,
    NO_INTERACTION,
    type ContinuousReplicationNetworkFailure,
    type ContinuousReplicationRequest,
    type ReplicationOutcome,
    type UnattendedOneShotRequest,
} from "@vrtmrz/livesync-commonlib/replication";
import { PeriodicProcessor } from "@/common/PeriodicProcessor";
import { secondsToMilliseconds } from "@/common/core/time";
import type { HostNetworkState } from "@/common/core/hostNetworkState";
import { getCouchDBReplicatorConfigurationIdentity } from "@/common/core/replication/configurationIdentity";

/** Timer operations required by the scheduling state owner. */
export interface ReplicationSchedulingTimer {
    enable(intervalMs: number): void;
    disable(): void;
}

/** Controls used by the daemon when it owns recurring work. */
export interface ReplicationSchedulingControl {
    /** Let an external daemon poller become, or cease to be, the recurring-work owner. */
    setExternalPollingMode(enabled: boolean): void;
    /** Consume the next resume-triggered OneShot because the daemon has already converged once. */
    markInitialOneShotSatisfied(): void;
}

export interface ReplicationSchedulingViews {
    readonly replicationScheduling: ReplicationSchedulingControl;
    readonly readPendingContinuousStart: () => ContinuousReplicationNetworkFailure | undefined;
}

interface ReplicationSchedulingDependencies {
    isReady(): boolean;
    isSuspended(): boolean;
    isHostActive?: () => boolean;
    readonly networkState?: ReactiveValue<HostNetworkState>;
    currentSettings(): ObsidianLiveSyncSettings;
    replicateUnattended(request: UnattendedOneShotRequest): Promise<ReplicationOutcome>;
    startContinuous(request: ContinuousReplicationRequest): Promise<ReplicationOutcome>;
    timer: ReplicationSchedulingTimer;
    log(error: unknown): void;
}

interface CouchDBStartAttempt {
    /** Private provider identity, used only for comparison while this Vault remains open. */
    readonly configurationIdentity: string;
    readonly networkAtStart: HostNetworkState;
    readonly failure?: ContinuousReplicationNetworkFailure;
}

interface ReplicationSchedulingState {
    continuousStart?: CouchDBStartAttempt;
    externalPolling: boolean;
    continuousOwnsRecurring: boolean;
    initialOneShotSatisfied: boolean;
    lifecycleAllowsScheduling: boolean;
    lifecycleGeneration: number;
    resumeWorkRunning: boolean;
    resumeQueued: boolean;
    unloading: boolean;
}

interface ReplicationSchedulingContext {
    readonly dependencies: ReplicationSchedulingDependencies;
    readonly state: Readonly<ReplicationSchedulingState>;
    updateState(update: Partial<ReplicationSchedulingState>): void;
}

function isCapabilityUnavailable(result: ReplicationOutcome): boolean {
    return (
        result.status === "blocked" &&
        (result.reason === CAPABILITY_UNAVAILABLE_REASONS.NOT_APPLICABLE ||
            result.reason === CAPABILITY_UNAVAILABLE_REASONS.NOT_IMPLEMENTED)
    );
}

/** Construct the independently testable context owned by the serviceFeature. */
export function createReplicationSchedulingContext(
    dependencies: ReplicationSchedulingDependencies
): ReplicationSchedulingContext {
    let state: Readonly<ReplicationSchedulingState> = {
        externalPolling: false,
        continuousOwnsRecurring: false,
        initialOneShotSatisfied: false,
        // Suspension and foreground visibility are distinct in the host lifecycle.
        lifecycleAllowsScheduling: false,
        lifecycleGeneration: 0,
        resumeWorkRunning: false,
        resumeQueued: false,
        unloading: false,
    };
    return {
        dependencies,
        get state() {
            return state;
        },
        updateState(update) {
            state = { ...state, ...update };
        },
    };
}

function canRunPeriodic(context: ReplicationSchedulingContext, settings: ObsidianLiveSyncSettings): boolean {
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
        dependencies.timer.enable(secondsToMilliseconds(settings.periodicReplicationInterval));
    } else {
        dependencies.timer.disable();
    }
}

function setContinuousOwnership(context: ReplicationSchedulingContext, ownsRecurring: boolean): void {
    const { state } = context;
    if (state.continuousOwnsRecurring === ownsRecurring) return;
    context.updateState({ continuousOwnsRecurring: ownsRecurring });
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

function retryStartAfterNetworkReturn(context: ReplicationSchedulingContext): void {
    const { state, dependencies } = context;
    const attempt = state.continuousStart;
    const network = dependencies.networkState?.value;
    // A retry starts from the observation that triggered it, which cannot trigger another retry.
    if (
        !attempt?.failure ||
        !network?.online ||
        network === attempt.networkAtStart ||
        network.notifiedAt === undefined ||
        network.notifiedAt < attempt.failure.failedAt
    ) {
        return;
    }
    if (
        state.resumeWorkRunning ||
        !canRunResume(context, state.lifecycleGeneration) ||
        !dependencies.isHostActive?.()
    ) {
        return;
    }
    const settings = dependencies.currentSettings();
    if (
        settings.isConfigured &&
        settings.liveSync &&
        settings.remoteType === REMOTE_COUCHDB &&
        getCouchDBReplicatorConfigurationIdentity(settings) === attempt.configurationIdentity
    ) {
        scheduleAfterResume(context, "online");
    } else {
        context.updateState({ continuousStart: undefined });
    }
}

function startContinuous(
    context: ReplicationSchedulingContext,
    trigger: "resume" | "online",
    settings: ObsidianLiveSyncSettings
) {
    const { dependencies } = context;
    const request: ContinuousReplicationRequest = { trigger, interaction: NO_INTERACTION };
    const networkAtStart = dependencies.networkState?.value;
    if (settings.remoteType !== REMOTE_COUCHDB || !dependencies.isHostActive || !networkAtStart) {
        return dependencies.startContinuous(request);
    }
    const attempt: CouchDBStartAttempt = {
        configurationIdentity: getCouchDBReplicatorConfigurationIdentity(settings),
        networkAtStart,
    };
    context.updateState({ continuousStart: attempt });
    return dependencies.startContinuous({
        ...request,
        onStartSettled(result) {
            if (context.state.continuousStart !== attempt) {
                return;
            }
            if (result.status === "failed" && result.networkFailure) {
                const { reason, hostOnlineAtFailure, failedAt } = result.networkFailure;
                context.updateState({
                    continuousStart: { ...attempt, failure: Object.freeze({ reason, hostOnlineAtFailure, failedAt }) },
                });
                retryStartAfterNetworkReturn(context);
            } else {
                context.updateState({ continuousStart: undefined });
            }
        },
    });
}

async function runAfterResume(
    context: ReplicationSchedulingContext,
    generation: number,
    trigger: "resume" | "online"
): Promise<void> {
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
    context.updateState({ initialOneShotSatisfied: false });
    if (settings.liveSync) {
        setContinuousOwnership(context, true);
        let result: ReplicationOutcome;
        try {
            result = await startContinuous(context, trigger, settings);
        } catch (error) {
            if (!context.state.resumeQueued) {
                setContinuousOwnership(context, false);
            }
            throw error;
        }
        if (!isReplicationCompleted(result) && !context.state.resumeQueued) {
            setContinuousOwnership(context, false);
        }
        // A suspend/resume may have started a new lifecycle generation while
        // Continuous was settling. Do not let the obsolete result schedule a
        // finite fallback for the new generation.
        if (trigger === "resume" && isCapabilityUnavailable(result) && canRunResume(context, generation)) {
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

function scheduleAfterResume(context: ReplicationSchedulingContext, trigger: "resume" | "online" = "resume"): void {
    const { dependencies, state } = context;
    if (state.resumeWorkRunning) {
        return;
    }
    const requestedGeneration = state.lifecycleGeneration;
    context.updateState({ resumeWorkRunning: true, resumeQueued: false });
    void runAfterResume(context, requestedGeneration, trigger)
        .catch((error: unknown) => {
            dependencies.log(error);
        })
        .finally(() => {
            const latest = context.state;
            context.updateState({ resumeWorkRunning: false });
            if (latest.resumeQueued) {
                scheduleAfterResume(context);
            } else {
                retryStartAfterNetworkReturn(context);
            }
        });
}

/** Schedule eligible work after the application has resumed. */
export function resumeReplicationScheduling(context: ReplicationSchedulingContext): void {
    const { state } = context;
    if (state.unloading) {
        return;
    }
    if (!state.lifecycleAllowsScheduling) {
        context.updateState({
            lifecycleGeneration: state.lifecycleGeneration + 1,
            lifecycleAllowsScheduling: true,
            resumeQueued: state.resumeWorkRunning,
        });
    }
    // runAfterResume executes synchronously until its first await. A Continuous
    // request therefore reserves ownership before Periodic is reconciled.
    scheduleAfterResume(context);
    reconcilePeriodic(context);
}

/** Stop generic Periodic scheduling before the application suspends. */
export function suspendReplicationScheduling(context: ReplicationSchedulingContext): void {
    context.updateState({ lifecycleAllowsScheduling: false, resumeQueued: false });
    context.dependencies.timer.disable();
}

/** Stop generic Periodic scheduling while settings and provider bindings change. */
export function prepareReplicationSchedulingForSettings(context: ReplicationSchedulingContext): void {
    context.updateState({ continuousStart: undefined });
    context.dependencies.timer.disable();
}

/** Reconcile generic Periodic scheduling after settings have settled. */
export function realiseReplicationScheduling(context: ReplicationSchedulingContext): void {
    reconcilePeriodic(context);
}

/** Prevent later timer callbacks from scheduling new work during unload. */
export function unloadReplicationScheduling(context: ReplicationSchedulingContext): void {
    if (context.state.unloading) {
        return;
    }
    context.updateState({
        continuousStart: undefined,
        lifecycleAllowsScheduling: false,
        resumeQueued: false,
        unloading: true,
    });
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
    context.updateState({
        externalPolling: enabled,
        continuousStart: enabled ? undefined : context.state.continuousStart,
    });
    reconcilePeriodic(context);
}

/** Consume the next resume-triggered OneShot because the daemon has already converged once. */
export function markInitialOneShotSatisfied(context: ReplicationSchedulingContext): void {
    context.updateState({ initialOneShotSatisfied: true });
}

// Network recovery needs host network observations and the current foreground state.
// Headless hosts use their own scheduling triggers and omit these capabilities.
type ReplicationSchedulingHost = NecessaryServices<
    "API" | "appLifecycle" | "control" | "replication" | "replicator" | "setting",
    never
> & { services: { context: { isHostActive?(): boolean; readonly networkState?: ReactiveValue<HostNetworkState> } } };

type ReplicationSchedulingTimerFactory = (process: () => Promise<void>) => ReplicationSchedulingTimer;

/**
 * Compose host lifecycle bindings around one private scheduling context.
 *
 * @param host Narrow service container used to bind scheduling to the host lifecycle.
 * @param createTimer Timer adapter factory, replaceable by focused tests.
 * @returns Daemon scheduling controls and read-only network recovery state.
 */
export function useReplicationScheduling(
    host: ReplicationSchedulingHost,
    createTimer: ReplicationSchedulingTimerFactory = (process) => new PeriodicProcessor(host, process)
): ReplicationSchedulingViews {
    const services = host.services;
    const networkState = services.context.networkState;
    const log = createInstanceLogFunction("SF:ReplicationScheduling", services.API);
    let context!: ReplicationSchedulingContext;
    const timer = createTimer(async () => await runPeriodicReplication(context));
    context = createReplicationSchedulingContext({
        isReady: () => services.appLifecycle.isReady(),
        isSuspended: () => services.appLifecycle.isSuspended(),
        isHostActive: services.context.isHostActive?.bind(services.context),
        networkState,
        currentSettings: () => services.setting.currentSettings(),
        replicateUnattended: (request) => services.replication.replicateUnattended(request),
        startContinuous: (request) => services.replication.startContinuous(request),
        timer,
        log: (error) => log(error, LOG_LEVEL_VERBOSE),
    });

    const onNetworkChanged = () => retryStartAfterNetworkReturn(context);
    networkState?.onChanged(onNetworkChanged);
    const forgetStart = () => {
        context.updateState({ continuousStart: undefined });
    };
    const releaseAbort = services.context.events.onEvent(EVENT_REPLICATION_ABORT_REQUESTED, () => {
        context.updateState({ continuousStart: undefined, resumeQueued: false });
    });
    const releaseUnload = services.context.events.onEvent(EVENT_PLUGIN_UNLOADED, () => {
        unloadReplicationScheduling(context);
    });
    services.replicator.onBeforeReplicatorPublication.addHandler(() => {
        forgetStart();
        return Promise.resolve(true);
    });
    services.appLifecycle.onUnload.addHandler(() => {
        releaseAbort();
        releaseUnload();
        networkState?.offChanged(onNetworkChanged);
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
        readPendingContinuousStart: () => context.state.continuousStart?.failure,
        replicationScheduling: Object.freeze({
            setExternalPollingMode: (enabled: boolean) => setExternalPollingMode(context, enabled),
            markInitialOneShotSatisfied: () => markInitialOneShotSatisfied(context),
        }),
    });
}
