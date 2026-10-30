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
                { push: 19, pull: 19 }
            );
            expect(idleWithCount.icon).toBe(icon);
            expect(idleWithCount.parts.some((part) => part.key === "ff-push")).toBe(true);
            expect(idleWithCount.parts.some((part) => part.key === "ff-pull")).toBe(true);

            const withoutCouchDB = projectReplicationStatusLabel(stats({ syncStatus }), noNetworkActivity, {
                push: 19,
                pull: 19,
            });
            expect(withoutCouchDB.icon).toBe(icon);
            expect(withoutCouchDB.parts.some((part) => part.key.startsWith("ff-"))).toBe(false);
        }

        const noFastForward = projectReplicationStatusLabel(stats(), noNetworkActivity);
        expect(noFastForward.parts.some((part) => part.key.startsWith("ff-"))).toBe(false);
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
            { pull: 1200 }
        );
        expect(transferred.icon).toBe("⚡");
        expect(transferred.message).toBe("Sync: ⚡ (⏩↓ 1200) ↑ 0 ↓ 7");
        expect(transferred.parts.map((part) => part.key)).toEqual(["sync", "ff-pull", "sent", "arrived"]);
        expect(transferred.parts[1]).toMatchObject({
            key: "ff-pull",
            text: " (⏩↓ ",
            value: 1200,
            suffix: ")",
            title: "Compared CouchDB pull feed entries",
        });

        const pushChecking = projectReplicationStatusLabel(
            stats({
                couchDB: {
                    phase: "continuous",
                    push: { checkedChanges: 71975, completedBatches: 2878, checking: true },
                },
            }),
            noNetworkActivity,
            { push: 71975 }
        );
        expect(pushChecking.icon).toBe("⏩");
        expect(pushChecking.message).toBe("Sync: ⏩ (⏩↑ 71975) ↑ 0 ↓ 0");
        expect(pushChecking.parts[1]).toMatchObject({ key: "ff-push", value: 71975 });

        const bothChecking = projectReplicationStatusLabel(
            stats({ couchDB: couchDBProgress("continuous", 10, true) }),
            noNetworkActivity,
            { push: 71975, pull: 10 }
        );
        expect(bothChecking.message).toBe("Sync: ⏩ (⏩↑ 71975) (⏩↓ 10) ↑ 0 ↓ 0");

        const idle = projectReplicationStatusLabel(
            stats({
                syncStatus: "CONNECTED",
                arrived: 7,
                couchDB: couchDBProgress("idle", 1200, false),
            }),
            noNetworkActivity,
            { pull: 1200 }
        );
        expect(idle.icon).toBe("⚡");
        expect(idle.message).toBe("Sync: ⚡ (⏩↓ 1200) ↑ 0 ↓ 7");
    });

    it("keeps the error icon ahead of an active CouchDB checking indicator", () => {
        const projection = projectReplicationStatusLabel(
            stats({
                syncStatus: "ERRORED",
                couchDB: {
                    ...couchDBProgress("one-shot", 2, true),
                    push: { checkedChanges: 2, completedBatches: 1, checking: true },
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

        expect(display.value).toEqual({ pull: 1200 });
        vi.advanceTimersByTime(1000);
        source.value = stats({
            sent: 3,
            couchDB: couchDBProgress("idle", 1200, false),
        });
        expect(display.value).toEqual({ pull: 1200 });
        vi.advanceTimersByTime(FAST_FORWARD_COUNT_LINGER_MS - 1001);
        expect(display.value).toEqual({ pull: 1200 });

        source.value = stats({
            sent: 4,
            couchDB: couchDBProgress("idle", 1200, false),
        });
        vi.advanceTimersByTime(1);
        expect(display.value).toEqual({});

        source.value = stats({
            syncStatus: "PAUSED",
            couchDB: couchDBProgress("continuous", 1200, true),
        });
        expect(display.value).toEqual({});

        source.value = stats({
            couchDB: couchDBProgress("continuous", 1201, true),
        });
        expect(display.value).toEqual({ pull: 1201 });

        source.value = stats({
            couchDB: couchDBProgress("one-shot", 0, true),
        });
        expect(display.value).toEqual({});

        source.value = stats();
        expect(display.value).toEqual({});
        display.dispose();
    });

    it("clears its timer and subscription when disposed", () => {
        const source = reactiveSource(stats({ couchDB: couchDBProgress("catch-up", 5, true) }));
        const display = createFastForwardCheckedChangesDisplay(source);

        display.dispose();
        vi.advanceTimersByTime(FAST_FORWARD_COUNT_LINGER_MS);
        source.value = stats({ couchDB: couchDBProgress("continuous", 6, true) });

        expect(display.value).toEqual({ pull: 5 });
    });

    it("does not display progress for providers without CouchDB replication state", () => {
        const source = reactiveSource(stats());
        const display = createFastForwardCheckedChangesDisplay(source);

        expect(display.value).toEqual({});
        source.value = stats({ couchDB: { phase: "continuous" } });
        expect(display.value).toEqual({});
        display.dispose();
    });

    it("tracks push and pull independently and expires only the direction that stopped changing", () => {
        const source = reactiveSource(
            stats({
                couchDB: {
                    phase: "catch-up",
                    pull: { checkedChanges: 4, completedBatches: 1, checking: true },
                    push: { checkedChanges: 40, completedBatches: 2, checking: true },
                },
            })
        );
        const display = createFastForwardCheckedChangesDisplay(source, 100);

        expect(display.value).toEqual({ push: 40, pull: 4 });
        vi.advanceTimersByTime(50);
        source.value = stats({
            couchDB: {
                phase: "catch-up",
                pull: { checkedChanges: 4, completedBatches: 1, checking: true },
                push: { checkedChanges: 41, completedBatches: 2, checking: true },
            },
        });
        expect(display.value).toEqual({ push: 41, pull: 4 });

        vi.advanceTimersByTime(50);
        expect(display.value).toEqual({ push: 41 });
        vi.advanceTimersByTime(50);
        expect(display.value).toEqual({});
        display.dispose();
    });
});
