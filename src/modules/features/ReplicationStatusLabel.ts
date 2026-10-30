import { reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import type { ReplicationStatics } from "@vrtmrz/livesync-commonlib/replication";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

import type { DisposableReactiveValue } from "./StatusBarDisplay.ts";
import type { StatusBarPart } from "./StatusBarRenderer.ts";
import {
    formatRemoteActivityStatusLabel,
    REMOTE_OPERATION_ACTIVITY_ICON,
    REMOTE_REQUEST_ACTIVITY_ICON,
    type RemoteActivityStatus,
} from "./RemoteActivityStatus.ts";

export const FAST_FORWARD_COUNT_LINGER_MS = 3_000;

export type FastForwardCheckedChanges = {
    push?: number;
    pull?: number;
};

function readPositiveCheckedChanges(
    source: ReactiveValue<ReplicationStatics>,
    direction: keyof FastForwardCheckedChanges
): number | undefined {
    const count = source.value.couchDB?.[direction]?.checkedChanges;
    return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : undefined;
}

function copyCheckedChanges(counts: FastForwardCheckedChanges): FastForwardCheckedChanges {
    return { ...counts };
}

/**
 * Briefly displays changing CouchDB push- and pull-feed comparison counts.
 *
 * Unrelated replication-stat changes do not extend the linger or redisplay an
 * expired count. A positive initial snapshot is displayed to late subscribers.
 */
export function createFastForwardCheckedChangesDisplay(
    source: ReactiveValue<ReplicationStatics>,
    lingerMs = FAST_FORWARD_COUNT_LINGER_MS
): DisposableReactiveValue<FastForwardCheckedChanges> {
    const displayed = reactiveSource<FastForwardCheckedChanges>({});
    const linger = Math.max(0, lingerMs);
    const directions: (keyof FastForwardCheckedChanges)[] = ["push", "pull"];
    const lastObserved: FastForwardCheckedChanges = {};
    const clearTimers = new Map<keyof FastForwardCheckedChanges, number>();
    let disposed = false;

    const cancelClear = (direction: keyof FastForwardCheckedChanges) => {
        const timer = clearTimers.get(direction);
        if (timer === undefined) return;
        compatGlobal.clearTimeout(timer);
        clearTimers.delete(direction);
    };
    const scheduleClear = (direction: keyof FastForwardCheckedChanges) => {
        const timer = compatGlobal.setTimeout(() => {
            clearTimers.delete(direction);
            if (disposed) return;
            if (readPositiveCheckedChanges(source, direction) !== lastObserved[direction]) {
                update();
                return;
            }
            const nextDisplayed = copyCheckedChanges(displayed.value);
            delete nextDisplayed[direction];
            displayed.value = nextDisplayed;
        }, linger);
        clearTimers.set(direction, timer);
    };
    const update = () => {
        if (disposed) return;
        const nextDisplayed = copyCheckedChanges(displayed.value);
        let changed = false;
        for (const direction of directions) {
            const nextCount = readPositiveCheckedChanges(source, direction);
            if (nextCount === lastObserved[direction]) continue;
            lastObserved[direction] = nextCount;
            cancelClear(direction);
            if (nextCount === undefined) {
                delete nextDisplayed[direction];
                changed = true;
                continue;
            }
            nextDisplayed[direction] = nextCount;
            scheduleClear(direction);
            changed = true;
        }
        if (changed) displayed.value = nextDisplayed;
    };

    for (const direction of directions) {
        const count = readPositiveCheckedChanges(source, direction);
        if (count === undefined) continue;
        lastObserved[direction] = count;
        displayed.value = { ...displayed.value, [direction]: count };
        scheduleClear(direction);
    }
    source.onChanged(update);

    return {
        get value() {
            return displayed.value;
        },
        onChanged(handler) {
            displayed.onChanged(handler);
        },
        offChanged(handler) {
            displayed.offChanged(handler);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const direction of directions) cancelClear(direction);
            source.offChanged(update);
        },
    };
}

export type ReplicationStatusProjection = {
    icon: string;
    message: string;
    parts: StatusBarPart[];
};

function remainingSequenceLabel(
    key: string,
    lastSyncSeq: number,
    maxSeq: number
): { text: string; part?: StatusBarPart } {
    if (lastSyncSeq === 0) return { text: "" };
    if (lastSyncSeq >= maxSeq) return { text: " (LIVE)", part: { key, text: " (LIVE)" } };
    const remaining = maxSeq - lastSyncSeq;
    return {
        text: " (" + remaining + ")",
        part: { key, text: " (", value: remaining, suffix: ")" },
    };
}

/** Projects the existing replication labels into reusable numeric status items. */
export function projectReplicationStatusLabel(
    stats: ReplicationStatics,
    networkStatus: RemoteActivityStatus,
    fastForwardCounts?: FastForwardCheckedChanges
): ReplicationStatusProjection {
    const { sent, arrived, maxPullSeq, maxPushSeq, lastSyncPullSeq, lastSyncPushSeq } = stats;
    const networkActivity = formatRemoteActivityStatusLabel(networkStatus);
    let pushRemaining: { text: string; part?: StatusBarPart } = { text: "" };
    let pullRemaining: { text: string; part?: StatusBarPart } = { text: "" };
    let icon: string;
    switch (stats.syncStatus) {
        case "CLOSED":
        case "COMPLETED":
        case "NOT_CONNECTED":
            icon = "⏹";
            break;
        case "STARTED":
            icon = "🌀";
            break;
        case "PAUSED":
            icon = "💤";
            break;
        case "CONNECTED":
        case "JOURNAL_SEND":
        case "JOURNAL_RECEIVE":
            icon = stats.syncStatus === "JOURNAL_SEND" ? "📦↑" : stats.syncStatus === "JOURNAL_RECEIVE" ? "📦↓" : "⚡";
            pushRemaining = remainingSequenceLabel("push-remaining", lastSyncPushSeq, maxPushSeq);
            pullRemaining = remainingSequenceLabel("pull-remaining", lastSyncPullSeq, maxPullSeq);
            break;
        case "ERRORED":
            icon = "⚠";
            break;
        default:
            icon = "?";
    }

    const couchDB = stats.couchDB;
    const isFastForwardChecking =
        stats.syncStatus !== "ERRORED" &&
        couchDB !== undefined &&
        couchDB.phase !== "idle" &&
        (couchDB.pull?.checking === true || couchDB.push?.checking === true);
    if (isFastForwardChecking) icon = "⏩";

    const visibleFastForwardCounts: FastForwardCheckedChanges = {};
    if (couchDB !== undefined) {
        for (const direction of ["push", "pull"] as const) {
            const count = fastForwardCounts?.[direction];
            if (typeof count === "number" && Number.isFinite(count) && count > 0) {
                visibleFastForwardCounts[direction] = count;
            }
        }
    }
    const fastForwardLabels = (["push", "pull"] as const)
        .filter((direction) => visibleFastForwardCounts[direction] !== undefined)
        .map((direction) => ` (⏩${direction === "push" ? "↑" : "↓"} ${visibleFastForwardCounts[direction]})`);
    const fastForwardLabel = fastForwardLabels.join("");

    const parts: StatusBarPart[] = [];
    if (networkStatus.trackedRequestCount > 0) {
        parts.push({
            key: "network",
            text:
                (networkStatus.remoteOperationCount > 0 ? `${REMOTE_OPERATION_ACTIVITY_ICON} ` : "") +
                REMOTE_REQUEST_ACTIVITY_ICON,
            value: networkStatus.trackedRequestCount,
            suffix: " ",
        });
    } else if (networkActivity !== "") {
        parts.push({ key: "network", text: networkActivity });
    }
    parts.push({ key: "sync", text: "Sync: " + icon });
    for (const direction of ["push", "pull"] as const) {
        const count = visibleFastForwardCounts[direction];
        if (count === undefined) continue;
        parts.push({
            key: `ff-${direction}`,
            text: ` (⏩${direction === "push" ? "↑" : "↓"} `,
            value: count,
            suffix: ")",
            title: `Compared CouchDB ${direction} feed entries`,
        });
    }
    parts.push({ key: "sent", text: " ↑ ", value: sent });
    if (pushRemaining.part !== undefined) parts.push(pushRemaining.part);
    parts.push({ key: "arrived", text: " ↓ ", value: arrived });
    if (pullRemaining.part !== undefined) parts.push(pullRemaining.part);

    return {
        icon,
        message:
            networkActivity +
            "Sync: " +
            icon +
            fastForwardLabel +
            " ↑ " +
            sent +
            pushRemaining.text +
            " ↓ " +
            arrived +
            pullRemaining.text,
        parts,
    };
}
