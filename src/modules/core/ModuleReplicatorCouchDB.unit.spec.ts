import { describe, expect, it, vi } from "vitest";
import { REMOTE_COUCHDB, REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ModuleReplicatorCouchDB } from "./ModuleReplicatorCouchDB.ts";

function createModule(
    settings: { liveSync: boolean; syncOnStart: boolean; remoteType?: typeof REMOTE_COUCHDB | typeof REMOTE_MINIO },
    isReplicationReady = true
) {
    const openReplication = vi.fn(async () => true);
    const runFiniteReplicationActivity = vi.fn(async (task: () => unknown) => await task());
    const services = {
        API: {
            addLog: vi.fn(),
            addCommand: vi.fn(),
            registerWindow: vi.fn(),
            addRibbonIcon: vi.fn(),
            registerProtocolHandler: vi.fn(),
        },
        appLifecycle: {
            isSuspended: vi.fn(() => false),
            isReady: vi.fn(() => true),
        },
        replication: {
            isReplicationReady: vi.fn(async () => isReplicationReady),
        },
        replicator: {
            runFiniteReplicationActivity,
        },
        setting: {
            saveSettingData: vi.fn(async () => undefined),
        },
    };
    const core = {
        _services: services,
        services,
        settings: {
            remoteType: REMOTE_COUCHDB,
            ...settings,
        },
        replicator: { openReplication },
    } as any;
    return {
        module: new ModuleReplicatorCouchDB(core),
        openReplication,
        runFiniteReplicationActivity,
    };
}

describe("ModuleReplicatorCouchDB resume replication activity", () => {
    it("exposes start-up one-shot replication as finite replication activity", async () => {
        const { module, openReplication, runFiniteReplicationActivity } = createModule({
            liveSync: false,
            syncOnStart: true,
        });

        await module._everyAfterResumeProcess();

        await vi.waitFor(() => expect(openReplication).toHaveBeenCalledOnce());
        expect(runFiniteReplicationActivity).toHaveBeenCalledWith(expect.any(Function), {
            label: "replication",
        });
        expect(openReplication).toHaveBeenCalledWith(expect.any(Object), false, false, false);
    });

    it("does not wrap the unbounded continuous channel in another finite activity", async () => {
        const { module, openReplication, runFiniteReplicationActivity } = createModule({
            liveSync: true,
            syncOnStart: false,
        });

        await module._everyAfterResumeProcess();

        await vi.waitFor(() => expect(openReplication).toHaveBeenCalledOnce());
        expect(runFiniteReplicationActivity).not.toHaveBeenCalled();
        expect(openReplication).toHaveBeenCalledWith(expect.any(Object), true, false, false);
    });

    it("does not start a one-shot activity when start-up readiness fails", async () => {
        const { module, openReplication, runFiniteReplicationActivity } = createModule(
            {
                liveSync: false,
                syncOnStart: true,
            },
            false
        );

        await module._everyAfterResumeProcess();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(runFiniteReplicationActivity).not.toHaveBeenCalled();
        expect(openReplication).not.toHaveBeenCalled();
    });

    it("does not start CouchDB replication for a registered Journal provider", async () => {
        const { module, openReplication } = createModule({
            liveSync: true,
            syncOnStart: true,
            remoteType: REMOTE_MINIO,
        });

        await expect(module._anyNewReplicator()).resolves.toBe(false);
        await module._everyAfterResumeProcess();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(openReplication).not.toHaveBeenCalled();
    });
});
