import { describe, expect, it, vi } from "vitest";
import { REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { NO_INTERACTION, type ReplicationOutcome } from "@vrtmrz/livesync-commonlib/replication";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { ModuleReplicationLifecycle } from "./ModuleReplicationLifecycle";
import { getReplicationSchedulingControl, setExternalPollingMode } from "./ReplicationScheduling";

type ResumeHandler = () => Promise<boolean>;

function createResumeHarness(settings: {
    liveSync: boolean;
    syncOnStart: boolean;
    isConfigured?: boolean;
    remoteType?: string;
    P2P_Enabled?: boolean;
}) {
    const resumeHandlers: ResumeHandler[] = [];
    const replicateUnattended = vi.fn(async (): Promise<ReplicationOutcome> => ({ status: "completed" }));
    const startContinuous = vi.fn(async (): Promise<ReplicationOutcome> => ({ status: "completed" }));
    const currentSettings = {
        isConfigured: true,
        periodicReplication: false,
        ...settings,
    };
    const services = {
        context: createServiceContext(),
        API: {
            addLog: vi.fn(),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
            isOnline: true,
        },
        appLifecycle: {
            isReady: vi.fn(() => true),
            isSuspended: vi.fn(() => false),
            onResumed: {
                addHandler: vi.fn((handler: ResumeHandler) => resumeHandlers.push(handler)),
            },
        },
        replication: {
            replicateUnattended,
            startContinuous,
        },
        setting: {
            currentSettings: vi.fn(() => currentSettings),
        },
    };
    const core = {
        _services: services,
        services,
        settings: currentSettings,
    } as any;
    const module = new ModuleReplicationLifecycle(core);
    module.onBindFunction(core, services as never);

    return {
        core,
        module,
        replicateUnattended,
        startContinuous,
        resume: async () => await Promise.all(resumeHandlers.map((handler) => handler())),
    };
}

describe("provider-independent replication resume lifecycle", () => {
    it("starts one unattended OneShot when sync-on-start is enabled", async () => {
        const harness = createResumeHarness({ liveSync: false, syncOnStart: true });

        await harness.resume();

        expect(harness.replicateUnattended).toHaveBeenCalledOnce();
        expect(harness.replicateUnattended).toHaveBeenCalledWith({
            trigger: "resume",
            interaction: NO_INTERACTION,
        });
        expect(harness.startContinuous).not.toHaveBeenCalled();
    });

    it("falls back to sync-on-start when Continuous is not applicable", async () => {
        const harness = createResumeHarness({ liveSync: true, syncOnStart: true });
        harness.startContinuous.mockResolvedValue({
            status: "blocked",
            reason: "capability-not-applicable",
        });

        await harness.resume();

        expect(harness.startContinuous).toHaveBeenCalledWith({
            trigger: "resume",
            interaction: NO_INTERACTION,
        });
        expect(harness.replicateUnattended).toHaveBeenCalledWith({
            trigger: "resume",
            interaction: NO_INTERACTION,
        });
    });

    it("starts Continuous without a finite fallback when it is supported", async () => {
        const harness = createResumeHarness({ liveSync: true, syncOnStart: true });

        await harness.resume();

        expect(harness.startContinuous).toHaveBeenCalledOnce();
        expect(harness.replicateUnattended).not.toHaveBeenCalled();
    });

    it("does not fall back after an actual Continuous failure", async () => {
        const harness = createResumeHarness({ liveSync: true, syncOnStart: true });
        harness.startContinuous.mockResolvedValue({
            status: "failed",
            error: new Error("connection failed"),
        });

        await harness.resume();

        expect(harness.replicateUnattended).not.toHaveBeenCalled();
    });

    it("coalesces concurrent resume callbacks", async () => {
        const harness = createResumeHarness({ liveSync: false, syncOnStart: true });
        let resolveReplication!: (value: { status: "completed" }) => void;
        harness.replicateUnattended.mockImplementationOnce(
            () => new Promise((resolve) => (resolveReplication = resolve))
        );

        const first = harness.resume();
        const second = harness.resume();
        resolveReplication({ status: "completed" });
        await Promise.all([first, second]);

        expect(harness.replicateUnattended).toHaveBeenCalledOnce();
    });

    it("does not block later resume handlers while a OneShot is running", async () => {
        const harness = createResumeHarness({ liveSync: false, syncOnStart: true });
        let resolveReplication!: (value: { status: "completed" }) => void;
        harness.replicateUnattended.mockImplementationOnce(
            () => new Promise((resolve) => (resolveReplication = resolve))
        );

        const resumed = harness.resume();
        await expect(resumed).resolves.toEqual([true]);
        expect(harness.replicateUnattended).toHaveBeenCalledOnce();

        resolveReplication({ status: "completed" });
        await resumed;
    });

    it("skips only the daemon-satisfied OneShot while allowing Continuous", async () => {
        const harness = createResumeHarness({ liveSync: true, syncOnStart: true });
        getReplicationSchedulingControl(harness.core).initialOneShotSatisfied = true;
        harness.startContinuous.mockResolvedValue({
            status: "blocked",
            reason: "capability-not-applicable",
        });

        await harness.resume();

        expect(harness.startContinuous).toHaveBeenCalledOnce();
        expect(harness.replicateUnattended).not.toHaveBeenCalled();
        expect(getReplicationSchedulingControl(harness.core).initialOneShotSatisfied).toBe(false);
    });

    it("does not start lifecycle replication while an external poller owns scheduling", async () => {
        const harness = createResumeHarness({ liveSync: false, syncOnStart: true });
        setExternalPollingMode(harness.core, true);

        await harness.resume();

        expect(harness.startContinuous).not.toHaveBeenCalled();
        expect(harness.replicateUnattended).not.toHaveBeenCalled();
    });

    it("requests the generic finite fallback for P2P when Continuous is not applicable", async () => {
        const harness = createResumeHarness({
            remoteType: REMOTE_P2P,
            P2P_Enabled: true,
            liveSync: true,
            syncOnStart: true,
        });
        harness.startContinuous.mockResolvedValue({
            status: "blocked",
            reason: "capability-not-applicable",
        });
        harness.replicateUnattended.mockResolvedValue({
            status: "blocked",
            reason: "capability-not-implemented",
        });

        await harness.resume();

        expect(harness.startContinuous).toHaveBeenCalledOnce();
        expect(harness.replicateUnattended).toHaveBeenCalledWith({
            trigger: "resume",
            interaction: NO_INTERACTION,
        });
    });
});
