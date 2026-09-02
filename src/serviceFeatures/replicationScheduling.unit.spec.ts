import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { NO_INTERACTION, type ReplicationOutcome } from "@vrtmrz/livesync-commonlib/replication";
import {
    createReplicationSchedulingContext,
    markInitialOneShotSatisfied,
    resumeReplicationScheduling,
    runPeriodicReplication,
    setExternalPollingMode,
    suspendReplicationScheduling,
    useReplicationScheduling,
    type ReplicationSchedulingTimer,
} from "./replicationScheduling";

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function createControllerHarness(
    overrides: Partial<{
        remoteType: typeof DEFAULT_SETTINGS.remoteType;
        liveSync: boolean;
        syncOnStart: boolean;
        periodicReplication: boolean;
        periodicReplicationInterval: number;
    }> = {}
) {
    const settings = {
        ...DEFAULT_SETTINGS,
        isConfigured: true,
        liveSync: false,
        syncOnStart: true,
        periodicReplication: false,
        periodicReplicationInterval: 60,
        ...overrides,
    };
    const timer: ReplicationSchedulingTimer = {
        enable: vi.fn(),
        disable: vi.fn(),
    };
    const replicateUnattended = vi.fn(async (): Promise<ReplicationOutcome> => ({ status: "completed" }));
    const startContinuous = vi.fn(async (): Promise<ReplicationOutcome> => ({ status: "completed" }));
    const log = vi.fn();
    const context = createReplicationSchedulingContext({
        isReady: vi.fn(() => true),
        isSuspended: vi.fn(() => false),
        currentSettings: vi.fn(() => settings),
        replicateUnattended,
        startContinuous,
        timer,
        log,
    });
    return { context, log, replicateUnattended, settings, startContinuous, timer };
}

describe("replication scheduling context", () => {
    it("starts a configured unattended OneShot without exposing the operation to the lifecycle handler", async () => {
        const { context, replicateUnattended } = createControllerHarness();

        expect(resumeReplicationScheduling(context)).toBeUndefined();

        await vi.waitFor(() => expect(replicateUnattended).toHaveBeenCalledOnce());
        expect(replicateUnattended).toHaveBeenCalledWith({
            trigger: "resume",
            interaction: NO_INTERACTION,
        });
    });

    it("reserves Continuous ownership before reconciling the periodic timer", async () => {
        const timeline: string[] = [];
        const continuous = createDeferred<ReplicationOutcome>();
        const { context, startContinuous, timer } = createControllerHarness({
            liveSync: true,
            periodicReplication: true,
        });
        vi.mocked(timer.disable).mockImplementation(() => {
            timeline.push("timer-disabled");
        });
        startContinuous.mockImplementation(() => {
            timeline.push("continuous-started");
            return continuous.promise;
        });

        resumeReplicationScheduling(context);

        expect(timeline[0]).toBe("timer-disabled");
        expect(timeline).toContain("continuous-started");
        expect(timer.enable).not.toHaveBeenCalled();

        continuous.resolve({ status: "completed" });
        await vi.waitFor(() => expect(startContinuous).toHaveBeenCalledOnce());
    });

    it("restores Periodic and falls back to OneShot when Continuous is not applicable", async () => {
        const { context, replicateUnattended, startContinuous, timer } = createControllerHarness({
            liveSync: true,
            periodicReplication: true,
            periodicReplicationInterval: 45,
        });
        startContinuous.mockResolvedValue({
            status: "blocked",
            reason: "capability-not-applicable",
        });

        resumeReplicationScheduling(context);

        await vi.waitFor(() => expect(replicateUnattended).toHaveBeenCalledOnce());
        expect(timer.enable).toHaveBeenCalledWith(45_000);
    });

    it("schedules migrated Object Storage syncOnStart through unattended OneShot", async () => {
        const { context, replicateUnattended, startContinuous } = createControllerHarness({
            remoteType: REMOTE_MINIO,
            liveSync: true,
            syncOnStart: true,
        });
        startContinuous.mockResolvedValue({
            status: "blocked",
            reason: "capability-not-applicable",
        });

        resumeReplicationScheduling(context);

        await vi.waitFor(() => expect(replicateUnattended).toHaveBeenCalledOnce());
        expect(replicateUnattended).toHaveBeenCalledWith({
            trigger: "resume",
            interaction: NO_INTERACTION,
        });
    });

    it("does not run a finite fallback after Continuous starts successfully", async () => {
        const { context, replicateUnattended, startContinuous } = createControllerHarness({ liveSync: true });

        resumeReplicationScheduling(context);

        await vi.waitFor(() => expect(startContinuous).toHaveBeenCalledOnce());
        expect(replicateUnattended).not.toHaveBeenCalled();
    });

    it("does not run a finite fallback after an actual Continuous failure", async () => {
        const { context, replicateUnattended, startContinuous } = createControllerHarness({ liveSync: true });
        startContinuous.mockResolvedValue({
            status: "failed",
            error: new Error("connection failed"),
        });

        resumeReplicationScheduling(context);

        await vi.waitFor(() => expect(startContinuous).toHaveBeenCalledOnce());
        expect(replicateUnattended).not.toHaveBeenCalled();
    });

    it("coalesces concurrent resume notifications", async () => {
        const replication = createDeferred<ReplicationOutcome>();
        const { context, replicateUnattended } = createControllerHarness();
        replicateUnattended.mockImplementation(() => replication.promise);

        resumeReplicationScheduling(context);
        resumeReplicationScheduling(context);

        expect(replicateUnattended).toHaveBeenCalledOnce();
        replication.resolve({ status: "completed" });
        await vi.waitFor(() => expect(replicateUnattended).toHaveBeenCalledOnce());
    });

    it("runs a fresh lifecycle generation instead of applying a stale Continuous fallback", async () => {
        const firstContinuous = createDeferred<ReplicationOutcome>();
        const { context, replicateUnattended, startContinuous, timer } = createControllerHarness({
            liveSync: true,
            periodicReplication: true,
        });
        startContinuous
            .mockImplementationOnce(() => firstContinuous.promise)
            .mockResolvedValueOnce({ status: "completed" });

        resumeReplicationScheduling(context);
        suspendReplicationScheduling(context);
        resumeReplicationScheduling(context);
        firstContinuous.resolve({
            status: "blocked",
            reason: "capability-not-applicable",
        });

        await vi.waitFor(() => expect(startContinuous).toHaveBeenCalledTimes(2));
        expect(replicateUnattended).not.toHaveBeenCalled();
        expect(timer.enable).not.toHaveBeenCalled();
    });

    it("lets the daemon suppress scheduling through the focused control view", async () => {
        const { context, replicateUnattended, startContinuous, timer } = createControllerHarness({
            liveSync: true,
            periodicReplication: true,
        });

        setExternalPollingMode(context, true);
        resumeReplicationScheduling(context);

        expect(timer.disable).toHaveBeenCalled();
        expect(startContinuous).not.toHaveBeenCalled();
        expect(replicateUnattended).not.toHaveBeenCalled();
    });

    it("consumes the daemon's initial OneShot marker without suppressing a Continuous attempt", async () => {
        const { context, replicateUnattended, startContinuous } = createControllerHarness({ liveSync: true });
        startContinuous.mockResolvedValue({
            status: "blocked",
            reason: "capability-not-applicable",
        });

        markInitialOneShotSatisfied(context);
        resumeReplicationScheduling(context);

        await vi.waitFor(() => expect(startContinuous).toHaveBeenCalledOnce());
        expect(replicateUnattended).not.toHaveBeenCalled();
    });

    it("consumes the daemon marker even when the first Continuous attempt throws", async () => {
        const { context, log, replicateUnattended, startContinuous } = createControllerHarness({ liveSync: true });
        startContinuous.mockRejectedValueOnce(new Error("start failed")).mockResolvedValueOnce({
            status: "blocked",
            reason: "capability-not-applicable",
        });

        markInitialOneShotSatisfied(context);
        resumeReplicationScheduling(context);
        await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());

        resumeReplicationScheduling(context);

        await vi.waitFor(() => expect(startContinuous).toHaveBeenCalledTimes(2));
        expect(replicateUnattended).toHaveBeenCalledOnce();
    });

    it("runs the periodic callback through the unattended replication boundary", async () => {
        const { context, replicateUnattended } = createControllerHarness({
            syncOnStart: false,
            periodicReplication: true,
        });

        resumeReplicationScheduling(context);

        await runPeriodicReplication(context);

        expect(replicateUnattended).toHaveBeenCalledWith({
            trigger: "periodic",
            interaction: NO_INTERACTION,
        });
    });

    it("ignores a queued periodic callback before resume and after suspension", async () => {
        const { context, replicateUnattended, timer } = createControllerHarness({
            syncOnStart: false,
            periodicReplication: true,
        });

        await runPeriodicReplication(context);
        expect(replicateUnattended).not.toHaveBeenCalled();

        resumeReplicationScheduling(context);
        expect(timer.enable).toHaveBeenCalledWith(60_000);

        suspendReplicationScheduling(context);
        await runPeriodicReplication(context);
        expect(replicateUnattended).not.toHaveBeenCalled();
    });

    it("ignores a queued periodic callback while external polling owns recurring work", async () => {
        const { context, replicateUnattended } = createControllerHarness({
            syncOnStart: false,
            periodicReplication: true,
        });
        resumeReplicationScheduling(context);

        setExternalPollingMode(context, true);
        await runPeriodicReplication(context);

        expect(replicateUnattended).not.toHaveBeenCalled();
    });

    it("ignores a queued periodic callback while Continuous owns recurring work", async () => {
        const continuous = createDeferred<ReplicationOutcome>();
        const { context, replicateUnattended, startContinuous } = createControllerHarness({
            liveSync: true,
            syncOnStart: false,
            periodicReplication: true,
        });
        startContinuous.mockImplementation(() => continuous.promise);
        resumeReplicationScheduling(context);

        await runPeriodicReplication(context);

        expect(replicateUnattended).not.toHaveBeenCalled();
        continuous.resolve({ status: "completed" });
    });
});

describe("replication scheduling serviceFeature", () => {
    it("binds lifecycle handlers and exposes only daemon scheduling controls", async () => {
        const handlers: Record<string, () => Promise<boolean>> = {};
        const timer: ReplicationSchedulingTimer = {
            enable: vi.fn(),
            disable: vi.fn(),
        };
        let periodicProcess!: () => Promise<void>;
        const replicateUnattended = vi.fn(async (): Promise<ReplicationOutcome> => ({ status: "completed" }));
        const addHandler = (name: string) =>
            vi.fn((handler: () => Promise<boolean>) => {
                handlers[name] = handler;
                return () => undefined;
            });
        const services = {
            context: {},
            API: { addLog: vi.fn() },
            appLifecycle: {
                isReady: vi.fn(() => true),
                isSuspended: vi.fn(() => false),
                onResumed: { addHandler: addHandler("resumed") },
                onSuspending: { addHandler: addHandler("suspending") },
                onUnload: { addHandler: addHandler("unload") },
            },
            control: { hasUnloaded: vi.fn(() => false) },
            replication: {
                replicateUnattended,
                startContinuous: vi.fn(async (): Promise<ReplicationOutcome> => ({ status: "completed" })),
            },
            setting: {
                currentSettings: vi.fn(() => ({
                    ...DEFAULT_SETTINGS,
                    isConfigured: true,
                    liveSync: false,
                    syncOnStart: true,
                    periodicReplication: true,
                })),
                onBeforeRealiseSetting: { addHandler: addHandler("before-setting") },
                onSettingRealised: { addHandler: addHandler("setting-realised") },
            },
        };

        const control = useReplicationScheduling({ services, serviceModules: {} } as never, (process) => {
            periodicProcess = process;
            return timer;
        });

        expect(Object.keys(control).sort()).toEqual(["markInitialOneShotSatisfied", "setExternalPollingMode"]);
        expect(Object.keys(handlers).sort()).toEqual([
            "before-setting",
            "resumed",
            "setting-realised",
            "suspending",
            "unload",
        ]);

        await expect(handlers.resumed()).resolves.toBe(true);
        await vi.waitFor(() => expect(replicateUnattended).toHaveBeenCalledOnce());

        replicateUnattended.mockClear();
        await periodicProcess();
        expect(replicateUnattended).toHaveBeenCalledWith({
            trigger: "periodic",
            interaction: NO_INTERACTION,
        });

        control.setExternalPollingMode(true);
        expect(timer.disable).toHaveBeenCalled();
    });
});
