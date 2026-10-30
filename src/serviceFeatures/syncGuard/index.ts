import { collectingChunks, chunkFetchCounts } from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";
import { REMOTE_COUCHDB } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isAnyNote } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import type { LiveSyncCore } from "@/main.ts";
import { getSyncGuardSettings } from "@/modules/services/ObsidianSettingService.ts";
import {
    EVENT_SETTING_SAVED,
    EVENT_SYNC_GUARD_PREFERENCES_CHANGED,
    EVENT_VAULT_REFLECTION_FAILED,
} from "@/common/events";
import type { SyncGuardOverlay } from "./SyncGuardOverlay";
import { SyncGuardState } from "./SyncGuardState";

export type SyncGuardOverlayFactory = (onBypass: () => void) => Pick<SyncGuardOverlay, "update" | "dispose">;

/**
 * Obsidian-only UI policy. The synchronisation service remains fully writable so remote
 * result reflection, conflict resolution, and file-system access can make progress.
 */
export function useSyncGuardFeature(host: LiveSyncCore, createOverlay: SyncGuardOverlayFactory): void {
    const { services } = host;
    let disposed = false;
    let quietTimer: number | undefined;
    let terminalPhaseTimer: number | undefined;
    const readPendingCount = () => {
        const counts = [
            services.replication.replicationResultCount.value,
            services.replication.databaseQueueCount.value,
            services.replication.storageApplyingCount.value,
            services.fileProcessing.processing.value,
            services.fileProcessing.totalQueued.value,
            services.fileProcessing.batched.value,
            services.conflict.conflictProcessQueueCount.value,
            collectingChunks.value,
            chunkFetchCounts.value.initial,
            chunkFetchCounts.value.retrying,
        ];
        return counts.reduce((total, count) => total + Math.max(0, count), 0);
    };
    const stopTimer = () => {
        if (quietTimer !== undefined) compatGlobal.clearTimeout(quietTimer);
        quietTimer = undefined;
    };
    const stopTerminalPhaseTimer = () => {
        if (terminalPhaseTimer !== undefined) compatGlobal.clearTimeout(terminalPhaseTimer);
        terminalPhaseTimer = undefined;
    };

    let guard: SyncGuardState;
    const overlay = createOverlay(() => guard.bypass());
    const checkForUnlock = () => {
        if (disposed) return;
        stopTimer();
        if (guard.presentation.phase !== "applying") return;
        const pending = readPendingCount();
        guard.tick(pending, Date.now());
        if (guard.presentation.phase === "applying" && pending === 0) {
            quietTimer = compatGlobal.setTimeout(checkForUnlock, 2_100);
        }
    };
    guard = new SyncGuardState((presentation) => {
        if (disposed) return;
        overlay.update(presentation);
        checkForUnlock();
    });

    const isEnabled = () => {
        const settings = services.setting.currentSettings();
        return settings.isConfigured && settings.liveSync && settings.remoteType === REMOTE_COUCHDB &&
            getSyncGuardSettings(services.setting).syncGuardEnabled;
    };
    const isCouchDbCatchUp = () => services.replicator.replicationStatics.value.couchDB?.phase === "catch-up";
    const beginCatchUp = () => {
        if (!isEnabled()) {
            guard.disable();
            return;
        }
        // PouchDB briefly reports 'idle' when disposing its progress observer, while
        // the enclosing CouchDB catch-up still owns the previous guard generation.
        // Do not reset that generation on duplicate resume, even before the threshold.
        const sameCatchUp = guard.isCatchUpActive || isCouchDbCatchUp();
        // An explicit bypass must survive this same transient 'idle'.
        if (guard.wasBypassed && sameCatchUp) {
            return;
        }
        // Duplicate resume notifications or a visibility transition must not discard an
        // already active guard and expose a partly reflected Vault to the user.
        if (guard.presentation.phase === "transferring" || guard.presentation.phase === "applying" ||
            guard.presentation.phase === "interrupted") {
            return;
        }
        if (guard.presentation.phase === "observing" && sameCatchUp) {
            return;
        }
        guard.resume(Boolean(isEnabled()), getSyncGuardSettings(services.setting).syncGuardMinimumFiles);
        guard.catchUpActivityChanged(isCouchDbCatchUp(), readPendingCount(), Date.now());
    };
    const onReplicationChanged = () => {
        const phase = services.replicator.replicationStatics.value.couchDB?.phase;
        if (phase === "catch-up") {
            stopTerminalPhaseTimer();
            // Also arm after an internal CouchDB reconnect without an Obsidian resume event.
            if (guard.presentation.phase === "idle" && !guard.wasBypassed && isEnabled()) beginCatchUp();
            guard.catchUpActivityChanged(true, readPendingCount(), Date.now());
        } else if (phase === "continuous") {
            stopTerminalPhaseTimer();
            // Commonlib enters continuous only after a successful pull-only catch-up.
            guard.catchUpSucceeded();
            guard.catchUpActivityChanged(false, readPendingCount(), Date.now());
        } else if ((guard.presentation.phase !== "idle" || guard.isCatchUpActive) && terminalPhaseTimer === undefined) {
            // The one-shot PouchDB progress observer can report 'idle' before the
            // enclosing finite CouchDB pull has finished releasing its resources.
            // This counter is not used to identify the provider; CouchDB phase owns that.
            if (phase === "idle" && services.replicator.finiteReplicationActivityCount.value > 0) return;
            // PouchDB disposes its per-attempt progress observer with phase 'idle' just
            // before Commonlib publishes 'continuous'. When the enclosing finite
            // transfer settles, defer the terminal observation by one event-loop
            // turn so that this internal hand-off never looks like a failure.
            terminalPhaseTimer = compatGlobal.setTimeout(() => {
                terminalPhaseTimer = undefined;
                const current = services.replicator.replicationStatics.value.couchDB?.phase;
                if (!disposed && current !== "catch-up" && current !== "continuous") {
                    guard.catchUpActivityChanged(false, readPendingCount(), Date.now());
                }
            }, 0);
        }
    };
    const onSettingsChanged = () => {
        if (!isEnabled()) guard.disable();
        else guard.updateThreshold(getSyncGuardSettings(services.setting).syncGuardMinimumFiles);
    };
    const onPendingChanged = () => checkForUnlock();
    const onFiniteChanged = () => {
        if (services.replicator.finiteReplicationActivityCount.value === 0) onReplicationChanged();
    };
    const removeReflectionFailureHandler = services.context.events.onEvent(EVENT_VAULT_REFLECTION_FAILED, () => {
        guard.reflectionFailed();
    });
    const removeSettingSavedHandler = services.context.events.onEvent(EVENT_SETTING_SAVED, () => {
        onSettingsChanged();
    });
    const removeSyncGuardPreferencesHandler = services.context.events.onEvent(
        EVENT_SYNC_GUARD_PREFERENCES_CHANGED,
        onSettingsChanged
    );

    const replication = services.replicator.replicationStatics;
    const finite = services.replicator.finiteReplicationActivityCount;
    const pendingSources = [
        services.replication.replicationResultCount,
        services.replication.databaseQueueCount,
        services.replication.storageApplyingCount,
        services.fileProcessing.processing,
        services.fileProcessing.totalQueued,
        services.fileProcessing.batched,
        services.conflict.conflictProcessQueueCount,
        collectingChunks,
        chunkFetchCounts,
    ];
    replication.onChanged(onReplicationChanged);
    finite.onChanged(onFiniteChanged);
    for (const source of pendingSources) source.onChanged(onPendingChanged);

    // Register before the ordinary replication scheduling handler so the first finite pull
    // belongs to the new resume generation even if it starts synchronously.
    services.appLifecycle.onResumed.addHandler(() => {
        beginCatchUp();
        return Promise.resolve(true);
    }, -100);
    services.appLifecycle.onSuspending.addHandler(() => {
        guard.interrupted();
        return Promise.resolve(true);
    });
    services.setting.onSettingRealised.addHandler(() => {
        onSettingsChanged();
        return Promise.resolve(true);
    });
    services.replication.parseSynchroniseResult.addHandler((documents) => {
        if (!disposed) guard.receivedDocuments(documents.filter(isAnyNote).map((doc) => doc._id));
        return Promise.resolve(true);
    });
    services.appLifecycle.onUnload.addHandler(() => {
        disposed = true;
        stopTimer();
        stopTerminalPhaseTimer();
        replication.offChanged(onReplicationChanged);
        finite.offChanged(onFiniteChanged);
        for (const source of pendingSources) source.offChanged(onPendingChanged);
        overlay.dispose();
        removeSettingSavedHandler();
        removeSyncGuardPreferencesHandler();
        removeReflectionFailureHandler();
        return Promise.resolve(true);
    });
}
