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

function readPositiveCheckedChanges(source: ReactiveValue<ReplicationStatics>): number | undefined {
    const count = source.value.couchDB?.pull?.checkedChanges;
    return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : undefined;
}

/**
 * Briefly displays changing CouchDB pull-feed comparison counts.
 *
 * Unrelated replication-stat changes do not extend the linger or redisplay an
 * expired count. A positive initial snapshot is displayed to late subscribers.
 */
export function createFastForwardCheckedChangesDisplay(
    source: ReactiveValue<ReplicationStatics>,
    lingerMs = FAST_FORWARD_COUNT_LINGER_MS
): DisposableReactiveValue<number | undefined> {
    const displayed = reactiveSource<number | undefined>(undefined);
    const linger = Math.max(0, lingerMs);
    let lastObserved = readPositiveCheckedChanges(source);
    let clearTimer: number | undefined;
    let disposed = false;

    const cancelClear = () => {
        if (clearTimer === undefined) return;
        compatGlobal.clearTimeout(clearTimer);
        clearTimer = undefined;
    };
    const scheduleClear = () => {
        clearTimer = compatGlobal.setTimeout(() => {
            clearTimer = undefined;
            if (disposed) return;
            if (readPositiveCheckedChanges(source) !== lastObserved) {
                update();
                return;
            }
            displayed.value = undefined;
        }, linger);
    };
    const update = () => {
        if (disposed) return;
        const nextCount = readPositiveCheckedChanges(source);
        if (nextCount === lastObserved) return;
        lastObserved = nextCount;
        cancelClear();
        if (nextCount === undefined) {
            displayed.value = undefined;
            return;
        }
        displayed.value = nextCount;
        scheduleClear();
    };

    if (lastObserved !== undefined) {
        displayed.value = lastObserved;
        scheduleClear();
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
            cancelClear();
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
    fastForwardCount?: number
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

    const visibleFastForwardCount =
        couchDB !== undefined &&
        typeof fastForwardCount === "number" &&
        Number.isFinite(fastForwardCount) &&
        fastForwardCount > 0
            ? fastForwardCount
            : undefined;
    const fastForwardLabel = visibleFastForwardCount === undefined ? "" : " (⏩ " + visibleFastForwardCount + ")";

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
    if (visibleFastForwardCount !== undefined) {
        parts.push({
            key: "ff",
            text: " (⏩ ",
            value: visibleFastForwardCount,
            suffix: ")",
            title: "Compared CouchDB feed entries",
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
