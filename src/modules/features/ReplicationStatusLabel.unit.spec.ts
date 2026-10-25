import { reactiveSource } from "octagonal-wheels/dataobject/reactive";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplicationStatics } from "@vrtmrz/livesync-commonlib/replication";

import {
    FAST_FORWARD_COUNT_LINGER_MS,
    createFastForwardCheckedChangesDisplay,
    projectReplicationStatusLabel,
} from "./ReplicationStatusLabel.ts";

function couchDBProgress(
    phase: "idle" | "one-shot" | "catch-up" | "continuous",
    checkedChanges = 0,
    checking = false
): NonNullable<ReplicationStatics["couchDB"]> {
    return {
        phase,
        pull: { checkedChanges, completedBatches: 0, checking },
        push: { checkedChanges: 0, completedBatches: 0, checking: false },
    };
}

const noNetworkActivity = { remoteOperationCount: 0, trackedRequestCount: 0 };

function stats(overrides: Partial<ReplicationStatics> = {}): ReplicationStatics {
    return {
        sent: 0,
        arrived: 0,
        maxPullSeq: 0,
        maxPushSeq: 0,
        lastSyncPullSeq: 0,
        lastSyncPushSeq: 0,
        syncStatus: "CONNECTED",
        ...overrides,
    };
}

describe("projectReplicationStatusLabel", () => {
    it("exposes the remote-request count as a numeric status item", () => {
        const projection = projectReplicationStatusLabel(stats(), { remoteOperationCount: 1, trackedRequestCount: 12 });
        expect(projection.parts.find((part) => part.key === "network")).toMatchObject({
            text: "📲 🌐",
            value: 12,
            suffix: " ",
        });
    });

    it("preserves the connected label, directions, and remaining-sequence text", () => {
        const projection = projectReplicationStatusLabel(
            stats({
                sent: 4,
                arrived: 2,
                maxPullSeq: 20,
                maxPushSeq: 30,
                lastSyncPullSeq: 17,
                lastSyncPushSeq: 22,
            }),
            { remoteOperationCount: 0, trackedRequestCount: 1 }
        );

        expect(projection.message).toBe("🌐1 Sync: ⚡ ↑ 4 (8) ↓ 2 (3)");
        expect(projection.parts.map((part) => part.key)).toEqual([
            "network",
            "sync",
            "sent",
            "push-remaining",
            "arrived",
            "pull-remaining",
        ]);
        expect(projection.parts[2]).toMatchObject({ key: "sent", text: " ↑ ", value: 4 });
        expect(projection.parts[3]).toMatchObject({ key: "push-remaining", text: " (", value: 8, suffix: ")" });
        expect(projection.parts[4]).toMatchObject({ key: "arrived", text: " ↓ ", value: 2 });
        expect(projection.parts[5]).toMatchObject({ key: "pull-remaining", text: " (", value: 3, suffix: ")" });
    });

    it("keeps the existing status icons when CouchDB is idle or not present", () => {
        const statuses = [
            ["CLOSED", "⏹"],
            ["COMPLETED", "⏹"],
            ["NOT_CONNECTED", "⏹"],
            ["STARTED", "🌀"],
            ["PAUSED", "💤"],
            ["CONNECTED", "⚡"],
            ["JOURNAL_SEND", "📦↑"],
            ["JOURNAL_RECEIVE", "📦↓"],
            ["ERRORED", "⚠"],
        ] as const;

        for (const [syncStatus, icon] of statuses) {
            const idleWithCount = projectReplicationStatusLabel(
                stats({ syncStatus, couchDB: couchDBProgress("idle", 19, true) }),
                noNetworkActivity,
                19
            );
            expect(idleWithCount.icon).toBe(icon);
            expect(idleWithCount.parts.some((part) => part.key === "ff")).toBe(true);

            const withoutCouchDB = projectReplicationStatusLabel(stats({ syncStatus }), noNetworkActivity, 19);
            expect(withoutCouchDB.icon).toBe(icon);
            expect(withoutCouchDB.parts.some((part) => part.key === "ff")).toBe(false);
        }

        const noFastForward = projectReplicationStatusLabel(stats(), noNetworkActivity);
        expect(noFastForward.parts.some((part) => part.key === "ff")).toBe(false);
        expect(noFastForward.message).toBe("Sync: ⚡ ↑ 0 ↓ 0");
    });

    it("shows fast-forward checking with zero arrivals, transferred data, and the final idle count", () => {
        const checking = projectReplicationStatusLabel(
            stats({
                syncStatus: "PAUSED",
                arrived: 0,
                couchDB: couchDBProgress("catch-up", 0, true),
            }),
            noNetworkActivity
        );
        expect(checking.icon).toBe("⏩");
        expect(checking.parts[2]).toMatchObject({ key: "arrived", value: 0 });

        const transferred = projectReplicationStatusLabel(
            stats({
                arrived: 7,
                couchDB: couchDBProgress("continuous", 1200, false),
            }),
            noNetworkActivity,
            1200
        );
        expect(transferred.icon).toBe("⚡");
        expect(transferred.message).toBe("Sync: ⚡ (⏩ 1200) ↑ 0 ↓ 7");
        expect(transferred.parts.map((part) => part.key)).toEqual(["sync", "ff", "sent", "arrived"]);
        expect(transferred.parts[1]).toMatchObject({
            key: "ff",
            text: " (⏩ ",
            value: 1200,
            suffix: ")",
        });

        const idle = projectReplicationStatusLabel(
            stats({
                syncStatus: "CONNECTED",
                arrived: 7,
                couchDB: couchDBProgress("idle", 1200, false),
            }),
            noNetworkActivity,
            1200
        );
        expect(idle.icon).toBe("⚡");
        expect(idle.message).toBe("Sync: ⚡ (⏩ 1200) ↑ 0 ↓ 7");
    });

    it("keeps the error icon ahead of an active CouchDB checking indicator", () => {
        const projection = projectReplicationStatusLabel(
            stats({
                syncStatus: "ERRORED",
                couchDB: {
                    ...couchDBProgress("one-shot", 2, true),
                    push: { checkedChanges: 0, completedBatches: 0, checking: true },
                },
            }),
            noNetworkActivity
        );

        expect(projection.icon).toBe("⚠");
    });
});

describe("createFastForwardCheckedChangesDisplay", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("uses the initial snapshot, expires unchanged counts, and only reappears for new progress", () => {
        const source = reactiveSource(
            stats({
                couchDB: couchDBProgress("catch-up", 1200, true),
            })
        );
        const display = createFastForwardCheckedChangesDisplay(source);

        expect(display.value).toBe(1200);
        vi.advanceTimersByTime(1000);
        source.value = stats({
            sent: 3,
            couchDB: couchDBProgress("idle", 1200, false),
        });
        expect(display.value).toBe(1200);
        vi.advanceTimersByTime(FAST_FORWARD_COUNT_LINGER_MS - 1001);
        expect(display.value).toBe(1200);

        source.value = stats({
            sent: 4,
            couchDB: couchDBProgress("idle", 1200, false),
        });
        vi.advanceTimersByTime(1);
        expect(display.value).toBeUndefined();

        source.value = stats({
            syncStatus: "PAUSED",
            couchDB: couchDBProgress("continuous", 1200, true),
        });
        expect(display.value).toBeUndefined();

        source.value = stats({
            couchDB: couchDBProgress("continuous", 1201, true),
        });
        expect(display.value).toBe(1201);

        source.value = stats({
            couchDB: couchDBProgress("one-shot", 0, true),
        });
        expect(display.value).toBeUndefined();

        source.value = stats();
        expect(display.value).toBeUndefined();
        display.dispose();
    });

    it("clears its timer and subscription when disposed", () => {
        const source = reactiveSource(stats({ couchDB: couchDBProgress("catch-up", 5, true) }));
        const display = createFastForwardCheckedChangesDisplay(source);

        display.dispose();
        vi.advanceTimersByTime(FAST_FORWARD_COUNT_LINGER_MS);
        source.value = stats({ couchDB: couchDBProgress("continuous", 6, true) });

        expect(display.value).toBe(5);
    });

    it("does not display progress for providers without CouchDB replication state", () => {
        const source = reactiveSource(stats());
        const display = createFastForwardCheckedChangesDisplay(source);

        expect(display.value).toBeUndefined();
        source.value = stats({ couchDB: { phase: "continuous" } });
        expect(display.value).toBeUndefined();
        display.dispose();
    });
});
