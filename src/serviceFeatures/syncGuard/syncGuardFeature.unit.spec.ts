import { reactiveSource } from "octagonal-wheels/dataobject/reactive";
import { REMOTE_COUCHDB, type EntryDoc } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { CouchDBReplicationPhase, ReplicationStatics } from "@vrtmrz/livesync-commonlib/replication";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import {
    EVENT_SETTING_SAVED,
    EVENT_SYNC_GUARD_PREFERENCES_CHANGED,
    EVENT_VAULT_REFLECTION_FAILED,
} from "@/common/events";
import { describe, afterEach, expect, it, vi } from "vitest";
import { useSyncGuardFeature } from "./index";
import type { SyncGuardPresentation } from "./SyncGuardState";

function receivedNote(id: string): PouchDB.Core.ExistingDocument<EntryDoc> {
    return {
        _id: id,
        _rev: "1-received",
        path: `${id}.md`,
        ctime: 1,
        mtime: 2,
        size: 1,
        children: [],
        datatype: "plain",
        type: "plain",
        eden: {},
    } as unknown as PouchDB.Core.ExistingDocument<EntryDoc>;
}

function setup(overrides: { enabled?: boolean; minimumFiles?: number } = {}) {
    const onResumed: Array<() => Promise<boolean>> = [];
    const onSuspending: Array<() => Promise<boolean>> = [];
    const onUnload: Array<() => Promise<boolean>> = [];
    const onSettingRealised: Array<() => Promise<boolean>> = [];
    const parseHandlers: Array<(docs: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<boolean>> = [];
    const priority = vi.fn();
    const finiteReplicationActivityCount = reactiveSource(0);
    const replicationStatics = reactiveSource<ReplicationStatics>({
        sent: 0,
        arrived: 0,
        maxPullSeq: 0,
        maxPushSeq: 0,
        lastSyncPullSeq: 0,
        lastSyncPushSeq: 0,
        syncStatus: "NOT_CONNECTED",
    });
    const setCouchDbPhase = (phase: CouchDBReplicationPhase) => {
        replicationStatics.value = { ...replicationStatics.value, couchDB: { phase } };
    };
    const replicationResultCount = reactiveSource(0);
    const databaseQueueCount = reactiveSource(0);
    const storageApplyingCount = reactiveSource(0);
    const processing = reactiveSource(0);
    const totalQueued = reactiveSource(0);
    const batched = reactiveSource(0);
    const conflictProcessQueueCount = reactiveSource(0);
    const settings = {
        syncGuardEnabled: overrides.enabled ?? true,
        syncGuardMinimumFiles: overrides.minimumFiles ?? 2,
    };
    const sharedSettings = {
        isConfigured: true,
        liveSync: true,
        remoteType: REMOTE_COUCHDB,
    };
    const host = {
        services: {
            context: createServiceContext(),
            setting: {
                currentSettings: () => sharedSettings,
                syncGuardSettings: settings,
                onSettingRealised: { addHandler: (fn: () => Promise<boolean>) => onSettingRealised.push(fn) },
            },
            replication: {
                replicationResultCount,
                databaseQueueCount,
                storageApplyingCount,
                parseSynchroniseResult: {
                    addHandler: (fn: (docs: PouchDB.Core.ExistingDocument<EntryDoc>[]) => Promise<boolean>) => {
                        parseHandlers.push(fn);
                    },
                },
            },
            replicator: { finiteReplicationActivityCount, replicationStatics },
            fileProcessing: { processing, totalQueued, batched },
            conflict: { conflictProcessQueueCount },
            appLifecycle: {
                onResumed: {
                    addHandler: (fn: () => Promise<boolean>, prio?: number) => {
                        priority(prio);
                        onResumed.push(fn);
                    },
                },
                onSuspending: { addHandler: (fn: () => Promise<boolean>) => onSuspending.push(fn) },
                onUnload: { addHandler: (fn: () => Promise<boolean>) => onUnload.push(fn) },
            },
        },
    };
    const updates: SyncGuardPresentation[] = [];
    const dispose = vi.fn();
    let bypass: () => void = () => { throw new Error("Guard not composed"); };
    useSyncGuardFeature(host as never, (onBypass) => {
        bypass = onBypass;
        return { update: (p) => updates.push(p), dispose };
    });
    return {
        settings,
        events: host.services.context.events,
        onResumed,
        onSuspending,
        onUnload,
        onSettingRealised,
        parseHandlers,
        priority,
        setCouchDbPhase,
        finiteReplicationActivityCount,
        replicationStatics,
        replicationResultCount,
        databaseQueueCount,
        storageApplyingCount,
        updates,
        bypass: () => bypass(),
        dispose,
    };
}

describe("useSyncGuardFeature", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("observes the initial CouchDB pull ahead of scheduling and unlocks after local queues settle", async () => {
        vi.useFakeTimers();
        const h = setup();
        expect(h.priority).toHaveBeenCalledWith(-100);
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("first"), receivedNote("second")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        h.databaseQueueCount.value = 1;
        h.replicationStatics.value = { ...h.replicationStatics.value, syncStatus: "COMPLETED" };
        h.setCouchDbPhase("continuous");
        expect(h.updates[h.updates.length - 1]?.phase).toBe("applying");
        vi.advanceTimersByTime(5_000);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("applying");
        h.databaseQueueCount.value = 0;
        await vi.advanceTimersByTimeAsync(2_150);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("idle");
        await h.onUnload[0]();
        expect(h.dispose).toHaveBeenCalledOnce();
    });

    it("does not mistake a transient progress-observer idle for a failed catch-up", async () => {
        vi.useFakeTimers();
        const h = setup({ minimumFiles: 1 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("first")]);
        h.databaseQueueCount.value = 1;
        h.setCouchDbPhase("idle"); // PouchDB's per-attempt observer is disposed before the continuous hand-off.
        h.setCouchDbPhase("continuous");
        await vi.advanceTimersByTimeAsync(1);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("applying");
        h.databaseQueueCount.value = 0;
        await vi.advanceTimersByTimeAsync(2_150);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("idle");
        await h.onUnload[0]();
    });

    it("waits for the finite pull to settle when progress temporarily reports idle", async () => {
        vi.useFakeTimers();
        const h = setup({ minimumFiles: 1 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        h.finiteReplicationActivityCount.value = 1;
        await h.parseHandlers[0]([receivedNote("first")]);
        h.setCouchDbPhase("idle");
        await vi.advanceTimersByTimeAsync(5_000); // Resource disposal may be asynchronous.
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        h.finiteReplicationActivityCount.value = 0;
        h.setCouchDbPhase("continuous");
        await vi.advanceTimersByTimeAsync(1);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("applying");
        await h.onUnload[0]();
    });

    it("keeps received-note counting across duplicate resume during transient idle with finite pull active", async () => {
        vi.useFakeTimers();
        const h = setup({ minimumFiles: 3 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        h.finiteReplicationActivityCount.value = 1;
        await h.parseHandlers[0]([receivedNote("first"), receivedNote("second")]);
        h.setCouchDbPhase("idle");
        await h.onResumed[0](); // Must not reset the already observed two notes.
        await h.parseHandlers[0]([receivedNote("third")]);
        expect(h.updates[h.updates.length - 1]).toMatchObject({
            phase: "transferring",
            receivedFiles: 3,
        });
        h.finiteReplicationActivityCount.value = 0;
        h.setCouchDbPhase("continuous");
        expect(h.updates[h.updates.length - 1]?.phase).toBe("applying");
        await h.onUnload[0]();
    });

    it("honours manual bypass across duplicate resume while catch-up reports transient idle", async () => {
        vi.useFakeTimers();
        const h = setup({ minimumFiles: 1 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        h.finiteReplicationActivityCount.value = 1;
        await h.parseHandlers[0]([receivedNote("first")]);
        h.bypass();
        h.setCouchDbPhase("idle");
        await h.onResumed[0]();
        await h.parseHandlers[0]([receivedNote("second")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("idle");
        await h.onUnload[0]();
    });

    it("re-arms protection for a new substantial catch-up after bypass, completion, suspension and resume", async () => {
        const h = setup({ minimumFiles: 2 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("first"), receivedNote("second")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        h.bypass();

        // A duplicate resume before the first transfer finishes must honour the bypass.
        await h.onResumed[0]();
        await h.parseHandlers[0]([receivedNote("third"), receivedNote("fourth")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("idle");

        // Successful hand-off to Continuous retires the bypassed generation.
        h.setCouchDbPhase("continuous");
        await h.onSuspending[0]();
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("new-first"), receivedNote("new-second")]);
        expect(h.updates[h.updates.length - 1]).toMatchObject({
            phase: "transferring",
            receivedFiles: 2,
        });
        await h.onUnload[0]();
    });

    it("re-arms protection after bypassed catch-up fails and later restarts", async () => {
        vi.useFakeTimers();
        const h = setup({ minimumFiles: 1 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        h.finiteReplicationActivityCount.value = 1;
        await h.parseHandlers[0]([receivedNote("failed")]);
        h.bypass();
        h.setCouchDbPhase("idle");
        h.finiteReplicationActivityCount.value = 0;
        await vi.advanceTimersByTimeAsync(1);
        await h.onSuspending[0]();
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("after-restart")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        await h.onUnload[0]();
    });

    it("ignores large P2P finite transfers when CouchDB catch-up is not running", async () => {
        const h = setup({ minimumFiles: 2 });
        await h.onResumed[0]();
        h.finiteReplicationActivityCount.value = 1; // P2P uses only the shared finite counter.
        await h.parseHandlers[0]([receivedNote("peer-first"), receivedNote("peer-second")]);
        h.finiteReplicationActivityCount.value = 0;
        expect(h.updates.some((p) => p.phase === "transferring" || p.phase === "interrupted")).toBe(false);
        // A real CouchDB catch-up must still arm normally in the same session.
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("db-first"), receivedNote("db-second")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        await h.onUnload[0]();
    });

    it("never blocks normal transfers and ignores chunks and duplicate note revisions", async () => {
        const h = setup({ minimumFiles: 3 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("first"), receivedNote("first"), { _id: "h:chunk", _rev: "1-a", type: "leaf" } as never]);
        expect(h.updates.some((p) => p.phase === "transferring")).toBe(false);
        await h.onUnload[0]();
    });

    it("preserves offline access through manual bypass and never re-locks that catch-up", async () => {
        vi.useFakeTimers();
        const h = setup({ minimumFiles: 1 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("first")]);
        h.setCouchDbPhase("idle");
        await vi.advanceTimersByTimeAsync(1);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("interrupted");
        h.bypass();
        expect(h.updates[h.updates.length - 1]?.phase).toBe("idle");
        await h.parseHandlers[0]([receivedNote("second")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("idle");
        await h.onUnload[0]();
    });

    it("never shows a guard when disabled and releases an active guard when the setting is disabled", async () => {
        const h = setup({ enabled: false, minimumFiles: 1 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("first")]);
        expect(h.updates.some((p) => p.phase === "transferring")).toBe(false);
        await h.onUnload[0]();

        const enabled = setup({ minimumFiles: 1 });
        await enabled.onResumed[0]();
        enabled.setCouchDbPhase("catch-up");
        await enabled.parseHandlers[0]([receivedNote("first")]);
        expect(enabled.updates[enabled.updates.length - 1]?.phase).toBe("transferring");
        enabled.settings.syncGuardEnabled = false;
        await enabled.onSettingRealised[0]();
        expect(enabled.updates[enabled.updates.length - 1]?.phase).toBe("idle");
        await enabled.onUnload[0]();
    });

    it("observes an internal LiveSync reconnect even without an application resume notification", async () => {
        const h = setup({ minimumFiles: 1 });
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("after-reconnect")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        h.replicationStatics.value = { ...h.replicationStatics.value, syncStatus: "COMPLETED" };
        h.setCouchDbPhase("continuous");
        expect(h.updates[h.updates.length - 1]?.phase).toBe("applying");
        await h.onUnload[0]();
    });

    it("preserves an active guard across duplicate resume notifications", async () => {
        const h = setup({ minimumFiles: 2 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("first"), receivedNote("second")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        await h.onResumed[0]();
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        h.replicationStatics.value = { ...h.replicationStatics.value, syncStatus: "COMPLETED" };
        h.setCouchDbPhase("continuous");
        expect(h.updates[h.updates.length - 1]?.phase).toBe("applying");
        await h.onUnload[0]();
    });

    it("preserves accumulated files before the threshold when resume fires twice during one pull", async () => {
        const h = setup({ minimumFiles: 3 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("one"), receivedNote("two")]);
        await h.onResumed[0]();
        await h.parseHandlers[0]([receivedNote("three")]);
        expect(h.updates[h.updates.length - 1]).toMatchObject({
            phase: "transferring",
            receivedFiles: 3,
        });
        await h.onUnload[0]();
    });

    it("keeps the guard after a received note could not be written to the Vault", async () => {
        const h = setup({ minimumFiles: 1 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("failed")]);
        h.events.emitEvent(EVENT_VAULT_REFLECTION_FAILED);
        h.replicationStatics.value = { ...h.replicationStatics.value, syncStatus: "COMPLETED" };
        h.setCouchDbPhase("continuous");
        expect(h.updates[h.updates.length - 1]?.phase).toBe("interrupted");
        await h.onUnload[0]();
    });

    it("responds immediately to settings saved by the UI without setting-realised", async () => {
        const h = setup({ minimumFiles: 20 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("one"), receivedNote("two")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("observing");
        h.settings.syncGuardMinimumFiles = 2;
        h.events.emitEvent(EVENT_SYNC_GUARD_PREFERENCES_CHANGED);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        h.settings.syncGuardEnabled = false;
        h.events.emitEvent(EVENT_SYNC_GUARD_PREFERENCES_CHANGED);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("idle");
        await h.onUnload[0]();
    });

    it("re-locks on a new internal catch-up after a bypassed transfer has completed", async () => {
        const h = setup({ minimumFiles: 1 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("first")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        h.bypass();
        h.setCouchDbPhase("continuous");
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("second")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        await h.onUnload[0]();
    });

    it("preserves manual bypass across duplicate resume while the same CouchDB pull remains active", async () => {
        const h = setup({ minimumFiles: 2 });
        await h.onResumed[0]();
        h.setCouchDbPhase("catch-up");
        await h.parseHandlers[0]([receivedNote("first"), receivedNote("second")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("transferring");
        h.bypass();
        await h.onResumed[0]();
        await h.parseHandlers[0]([receivedNote("third"), receivedNote("fourth")]);
        expect(h.updates[h.updates.length - 1]?.phase).toBe("idle");
        await h.onUnload[0]();
    });
});
