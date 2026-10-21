import { collectingChunks, chunkFetchCounts } from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";
import { REMOTE_COUCHDB } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isAnyNote } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import type { LiveSyncCore } from "@/main.ts";
import { EVENT_SETTING_SAVED, EVENT_VAULT_REFLECTION_FAILED } from "@/common/events";
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
            settings.syncGuardEnabled;
    };
    const beginCatchUp = () => {
        const settings = services.setting.currentSettings();
        if (!isEnabled()) {
            guard.disable();
            return;
        }
        // Duplicate resume notifications or a visibility transition must not discard an
        // already active guard and expose a partly reflected Vault to the user.
        if (guard.presentation.phase === "transferring" || guard.presentation.phase === "applying" ||
            guard.presentation.phase === "interrupted") {
            return;
        }
        if (guard.presentation.phase === "observing" &&
            services.replicator.finiteReplicationActivityCount.value > 0) {
            return;
        }
        guard.resume(Boolean(isEnabled()), settings.syncGuardMinimumFiles);
        guard.finiteActivityChanged(services.replicator.finiteReplicationActivityCount.value > 0, readPendingCount(), Date.now());
    };
    const onFiniteChanged = () => {
        const active = services.replicator.finiteReplicationActivityCount.value > 0;
        // Continuous replication can restart its finite pull following an internal reconnect,
        // without an Obsidian onResumed notification. A new bounded transfer gets its own window.
        if (active && guard.presentation.phase === "idle" && !guard.wasBypassed && isEnabled()) beginCatchUp();
        guard.finiteActivityChanged(active, readPendingCount(), Date.now());
    };
    const onReplicationChanged = () => {
        guard.replicationStatusChanged(services.replicator.replicationStatics.value.syncStatus);
    };
    const onSettingsChanged = () => {
        if (!isEnabled()) guard.disable();
        else guard.updateThreshold(services.setting.currentSettings().syncGuardMinimumFiles);
    };
    const onPendingChanged = () => checkForUnlock();
    const removeReflectionFailureHandler = services.context.events.onEvent(EVENT_VAULT_REFLECTION_FAILED, () => {
        guard.reflectionFailed();
    });
    const removeSettingSavedHandler = services.context.events.onEvent(EVENT_SETTING_SAVED, () => {
        onSettingsChanged();
    });

    const finite = services.replicator.finiteReplicationActivityCount;
    const replication = services.replicator.replicationStatics;
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
    finite.onChanged(onFiniteChanged);
    replication.onChanged(onReplicationChanged);
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
        finite.offChanged(onFiniteChanged);
        replication.offChanged(onReplicationChanged);
        for (const source of pendingSources) source.offChanged(onPendingChanged);
        overlay.dispose();
        removeSettingSavedHandler();
        removeReflectionFailureHandler();
        return Promise.resolve(true);
    });
}
