/**
 * Host-owned scheduling state shared by the lifecycle coordinator and the
 * CLI daemon. It deliberately contains policy state only; provider choice and
 * replication execution remain in ReplicationService.
 */
export interface ReplicationSchedulingControl {
    /** The daemon owns recurring polling and suppresses host automation. */
    externalPolling: boolean;
    /** A Continuous start is pending or accepted and therefore owns recurring synchronisation. */
    continuousOwnsRecurring: boolean;
    /** The daemon's initial convergence satisfies the next resume OneShot. */
    initialOneShotSatisfied: boolean;
    /** Registered by the periodic module so the daemon can remove an old timer. */
    disablePeriodic?: () => void;
    /** Reconcile the periodic timer after recurring ownership changes. */
    refreshPeriodic?: () => void;
}

const controls = new WeakMap<object, ReplicationSchedulingControl>();

export function getReplicationSchedulingControl(owner: object): ReplicationSchedulingControl {
    let control = controls.get(owner);
    if (!control) {
        control = {
            externalPolling: false,
            continuousOwnsRecurring: false,
            initialOneShotSatisfied: false,
        };
        controls.set(owner, control);
    }
    return control;
}

export function setContinuousSchedulingOwnership(owner: object, ownsRecurring: boolean): void {
    const control = getReplicationSchedulingControl(owner);
    if (control.continuousOwnsRecurring === ownsRecurring) return;
    control.continuousOwnsRecurring = ownsRecurring;
    control.refreshPeriodic?.();
}

export function setExternalPollingMode(owner: object, enabled: boolean): void {
    const control = getReplicationSchedulingControl(owner);
    control.externalPolling = enabled;
    if (enabled) control.disablePeriodic?.();
}

export function markInitialOneShotSatisfied(owner: object): void {
    getReplicationSchedulingControl(owner).initialOneShotSatisfied = true;
}
