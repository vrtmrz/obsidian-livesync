import { describe, expect, it, vi } from "vitest";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import { createLiveSyncEventHub } from "@vrtmrz/livesync-commonlib/context";
import { DEFAULT_SETTINGS, REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { ContinuousReplicationRequest, ReplicationOutcome } from "@vrtmrz/livesync-commonlib/replication";
import type { HostNetworkState } from "@/common/core/hostNetworkState";
import { useReplicationScheduling } from "./replicationScheduling";

function lifecycleHook() {
    let notify: () => Promise<boolean>;
    return {
        addHandler(handler: typeof notify) {
            notify = handler;
        },
        fire: () => notify(),
    };
}

function createVault() {
    const settings = { ...DEFAULT_SETTINGS, isConfigured: true, liveSync: true, syncOnStart: false };
    const events = createLiveSyncEventHub();
    const networkState = reactiveSource<HostNetworkState>({ online: true });
    const foreground = vi.fn(() => true);
    const appLifecycle = {
        isReady: () => true,
        isSuspended: () => false,
        onResumed: lifecycleHook(),
        onSuspending: lifecycleHook(),
        onUnload: lifecycleHook(),
    };
    const startContinuous = vi.fn(
        async (_request: ContinuousReplicationRequest): Promise<ReplicationOutcome> => ({ status: "completed" })
    );
    const replicateUnattended = vi.fn();
    const setting = {
        currentSettings: () => settings,
        onBeforeRealiseSetting: lifecycleHook(),
        onSettingRealised: lifecycleHook(),
    };
    const replicator = { onBeforeReplicatorPublication: lifecycleHook() };
    const host = {
        services: {
            context: { events, isHostActive: foreground, networkState },
            API: { addLog: vi.fn(), isOnline: true },
            appLifecycle,
            replication: { startContinuous, replicateUnattended },
            replicator,
            setting,
        },
    };
    const { readPendingContinuousStart } = useReplicationScheduling(host as never, () => ({
        enable: vi.fn(),
        disable: vi.fn(),
    }));
    const settle = (reason: "offline" | "remote-transport", failedAt = Date.now()) => {
        startContinuous.mock.lastCall![0].onStartSettled?.({
            status: "failed",
            networkFailure: {
                reason,
                hostOnlineAtFailure: reason !== "offline",
                failedAt,
            },
        });
    };
    const network = (online: boolean, notifiedAt = Date.now()) => {
        networkState.value = { online, notifiedAt };
    };
    return {
        readPendingContinuousStart,
        settings,
        setting,
        replicator,
        appLifecycle,
        events,
        network,
        foreground,
        startContinuous,
        replicateUnattended,
        settle,
    };
}

describe("CouchDB LiveSync after a network return", () => {
    it.each(["offline", "remote-transport"] as const)(
        "restarts one %s start from a fresh online observation without a prior offline observation",
        async (reason) => {
            const vault = createVault();
            await vault.appLifecycle.onResumed.fire();
            const failedAt = Date.now();
            vault.settle(reason, failedAt);
            expect(vault.readPendingContinuousStart()).toEqual({
                reason,
                failedAt,
                hostOnlineAtFailure: reason !== "offline",
            });
            vault.network(true);
            vault.network(true);
            await vi.waitFor(() =>
                expect(vault.startContinuous.mock.calls.map(([request]) => request.trigger)).toEqual([
                    "resume",
                    "online",
                ])
            );
            vault.startContinuous.mock.calls[1][0].onStartSettled?.({ status: "started" });
            expect(vault.readPendingContinuousStart()).toBeUndefined();
            vault.network(false);
            vault.network(true);
            expect(vault.startContinuous).toHaveBeenCalledTimes(2);
            expect(vault.replicateUnattended).not.toHaveBeenCalled();
        }
    );

    it("exposes only the pending failure observation to diagnostic readers", async () => {
        const vault = createVault();
        await vault.appLifecycle.onResumed.fire();
        const observation = { reason: "remote-transport" as const, failedAt: Date.now(), hostOnlineAtFailure: true };
        const providerFailure = { ...observation, requestContext: "provider-only" };
        vault.startContinuous.mock.lastCall![0].onStartSettled?.({ status: "failed", networkFailure: providerFailure });

        const published = vault.readPendingContinuousStart();
        expect(published).toEqual(observation);
        expect(Object.isFrozen(published)).toBe(true);
    });

    it("handles an online event between the actual failure and its delivery", async () => {
        const vault = createVault();
        await vault.appLifecycle.onResumed.fire();
        const failedAt = Date.now();
        vault.network(true);
        vault.settle("remote-transport", failedAt);
        await vi.waitFor(() => expect(vault.startContinuous).toHaveBeenCalledTimes(2));
    });

    it("retries when admission finishes after the online notification", async () => {
        const vault = createVault();
        const admission = promiseWithResolvers<ReplicationOutcome>();
        vault.startContinuous.mockReturnValueOnce(admission.promise);
        await vault.appLifecycle.onResumed.fire();
        vault.settle("offline", 1000);
        vault.network(true, 1000);

        expect(vault.startContinuous).toHaveBeenCalledOnce();
        admission.resolve({ status: "blocked", reason: "not-ready" });

        await vi.waitFor(() =>
            expect(vault.startContinuous.mock.calls.map(([request]) => request.trigger)).toEqual(["resume", "online"])
        );
    });

    it("keeps a second failure pending for the next return without retrying in a loop", async () => {
        const vault = createVault();
        const failedAt = 1000;
        await vault.appLifecycle.onResumed.fire();
        vault.settle("offline", failedAt);
        vault.network(true, failedAt);
        await vi.waitFor(() => expect(vault.startContinuous).toHaveBeenCalledTimes(2));
        // Both starts may fail in the same clock tick. The retry already used this observation.
        vault.settle("remote-transport", failedAt);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(vault.readPendingContinuousStart()?.hostOnlineAtFailure).toBe(true);
        vault.network(false, failedAt + 1);
        expect(vault.startContinuous).toHaveBeenCalledTimes(2);
        vault.network(true, failedAt + 1);
        await vi.waitFor(() => expect(vault.startContinuous).toHaveBeenCalledTimes(3));
    });

    it("ignores a return that preceded the failing request and failures without a network reason", async () => {
        const vault = createVault();
        await vault.appLifecycle.onResumed.fire();
        vault.network(true);
        vault.settle("remote-transport", Date.now() + 1);
        await vault.appLifecycle.onSuspending.fire();
        await vault.appLifecycle.onResumed.fire();
        await vi.waitFor(() => expect(vault.startContinuous).toHaveBeenCalledTimes(2));
        vault.startContinuous.mock.calls[1][0].onStartSettled?.({ status: "failed" });
        vault.network(true);
        expect(vault.readPendingContinuousStart()).toBeUndefined();
        expect(vault.startContinuous).toHaveBeenCalledTimes(2);
    });

    it("lets the normal foreground start consume a recovery pending while hidden", async () => {
        const vault = createVault();
        await vault.appLifecycle.onResumed.fire();
        vault.settle("offline");
        vault.foreground.mockReturnValue(false);
        await vault.appLifecycle.onSuspending.fire();
        vault.network(true);
        expect(vault.startContinuous).toHaveBeenCalledOnce();
        vault.foreground.mockReturnValue(true);
        await vault.appLifecycle.onResumed.fire();
        vault.network(true);
        await vi.waitFor(() =>
            expect(vault.startContinuous.mock.calls.map(([request]) => request.trigger)).toEqual(["resume", "resume"])
        );
    });

    it("prioritises a newer foreground resume when an earlier admission is still pending", async () => {
        const vault = createVault();
        const admission = promiseWithResolvers<ReplicationOutcome>();
        vault.startContinuous.mockReturnValueOnce(admission.promise);
        await vault.appLifecycle.onResumed.fire();
        vault.settle("offline", 1000);
        vault.foreground.mockReturnValue(false);
        await vault.appLifecycle.onSuspending.fire();
        vault.network(true, 1000);
        vault.foreground.mockReturnValue(true);
        await vault.appLifecycle.onResumed.fire();

        expect(vault.startContinuous).toHaveBeenCalledOnce();
        admission.resolve({ status: "blocked", reason: "not-ready" });

        await vi.waitFor(() =>
            expect(vault.startContinuous.mock.calls.map(([request]) => request.trigger)).toEqual(["resume", "resume"])
        );
        expect(vault.readPendingContinuousStart()).toBeUndefined();
    });

    it("discards a failure reported after a newer start has replaced its attempt", async () => {
        const vault = createVault();
        await vault.appLifecycle.onResumed.fire();
        const [oldRequest] = vault.startContinuous.mock.calls[0];
        await vault.appLifecycle.onSuspending.fire();
        await vault.appLifecycle.onResumed.fire();
        await vi.waitFor(() => expect(vault.startContinuous).toHaveBeenCalledTimes(2));

        oldRequest.onStartSettled?.({
            status: "failed",
            networkFailure: { reason: "remote-transport", hostOnlineAtFailure: true, failedAt: 1000 },
        });
        vault.network(true, 1000);

        expect(vault.readPendingContinuousStart()).toBeUndefined();
        expect(vault.startContinuous).toHaveBeenCalledTimes(2);
    });

    it.each(["cancel", "settings", "replicator", "unload"])(
        "discards an old start and late network failures on %s",
        async (why) => {
            const vault = createVault();
            await vault.appLifecycle.onResumed.fire();
            if (why === "cancel") vault.events.emitEvent("replication-abort-requested");
            if (why === "settings") await vault.setting.onBeforeRealiseSetting.fire();
            if (why === "replicator") await vault.replicator.onBeforeReplicatorPublication.fire();
            if (why === "unload") await vault.appLifecycle.onUnload.fire();
            vault.settle("offline");
            vault.network(true);
            expect(vault.startContinuous).toHaveBeenCalledOnce();
        }
    );

    it("does not start Periodic or a different provider on a network event", async () => {
        const vault = createVault();
        await vault.appLifecycle.onResumed.fire();
        vault.settle("offline");
        vault.settings.remoteType = REMOTE_MINIO;
        vault.settings.liveSync = false;
        vault.settings.periodicReplication = true;
        vault.network(true);
        expect(vault.startContinuous).toHaveBeenCalledOnce();
        expect(vault.replicateUnattended).not.toHaveBeenCalled();
    });

    it("does not start a newly selected CouchDB database from the previous database's failure", async () => {
        const vault = createVault();
        await vault.appLifecycle.onResumed.fire();
        vault.settle("offline");
        vault.settings.couchDB_DBNAME = "other-database";
        vault.network(true);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(vault.startContinuous).toHaveBeenCalledOnce();
        expect(vault.readPendingContinuousStart()).toBeUndefined();
    });
});
