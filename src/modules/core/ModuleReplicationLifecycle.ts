import { LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import {
    isReplicationCompleted,
    NO_INTERACTION,
    type ReplicationOutcome,
} from "@vrtmrz/livesync-commonlib/replication";
import { AbstractModule } from "@/modules/AbstractModule";
import type { LiveSyncCore } from "@/main";
import {
    getReplicationSchedulingControl,
    markInitialOneShotSatisfied,
    setContinuousSchedulingOwnership,
    setExternalPollingMode,
} from "./ReplicationScheduling";

function isCapabilityUnavailable(result: ReplicationOutcome): boolean {
    return (
        result.status === "blocked" &&
        (result.reason === "capability-not-applicable" || result.reason === "capability-not-implemented")
    );
}

/**
 * Coordinates application resume with the active provider's typed roles.
 * Provider implementations do not subscribe to the application lifecycle.
 */
export class ModuleReplicationLifecycle extends AbstractModule {
    private readonly schedulingControl = getReplicationSchedulingControl(this.core);
    private resumePromise?: Promise<boolean>;

    private async runAfterResume(): Promise<boolean> {
        if (this.schedulingControl.externalPolling) return true;
        if (this.services.appLifecycle.isSuspended()) return true;
        if (!this.services.appLifecycle.isReady()) return true;

        const settings = this.services.setting.currentSettings();
        if (!settings.isConfigured) {
            setContinuousSchedulingOwnership(this.core, false);
            return true;
        }

        const skipOneShot = this.schedulingControl.initialOneShotSatisfied;
        if (settings.liveSync) {
            // Reserve recurring ownership before the asynchronous start so a
            // later resume handler cannot enable Periodic in the meantime.
            setContinuousSchedulingOwnership(this.core, true);
            const result = await this.services.replication.startContinuous({
                trigger: "resume",
                interaction: NO_INTERACTION,
            });
            if (!isReplicationCompleted(result)) {
                setContinuousSchedulingOwnership(this.core, false);
            }
            // The daemon's initial finite convergence must not suppress a
            // supported Continuous start. It only suppresses the fallback
            // OneShot when Continuous is unavailable.
            this.schedulingControl.initialOneShotSatisfied = false;
            if (isCapabilityUnavailable(result) && settings.syncOnStart && !skipOneShot) {
                await this.services.replication.replicateUnattended({
                    trigger: "resume",
                    interaction: NO_INTERACTION,
                });
            }
            return true;
        }

        setContinuousSchedulingOwnership(this.core, false);
        if (settings.syncOnStart && !skipOneShot) {
            await this.services.replication.replicateUnattended({
                trigger: "resume",
                interaction: NO_INTERACTION,
            });
        }
        this.schedulingControl.initialOneShotSatisfied = false;
        return true;
    }

    private _everyAfterResumeProcess(): Promise<boolean> {
        if (!this.resumePromise) {
            // The lifecycle event is a short notification boundary. Keep the
            // long-running OneShot/Continuous start coalesced internally, but
            // let later resume handlers (P2P, periodic scheduling, and other
            // modules) continue without waiting for network work to settle.
            this.resumePromise = this.runAfterResume()
                .catch((error) => {
                    this._log(error, LOG_LEVEL_VERBOSE);
                    return true;
                })
                .finally(() => {
                    this.resumePromise = undefined;
                });
        }
        return Promise.resolve(true);
    }

    /**
     * Let a CLI daemon own recurring polling without a duplicate lifecycle or
     * generic periodic scheduler. This is intentionally narrower than a
     * provider or Replicator control API.
     */
    setExternalPollingMode(enabled: boolean): void {
        setExternalPollingMode(this.core, enabled);
    }

    /** Mark the daemon's initial finite convergence for the next resume. */
    markInitialOneShotSatisfied(): void {
        markInitialOneShotSatisfied(this.core);
    }

    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onResumed.addHandler(this._everyAfterResumeProcess.bind(this));
    }
}
