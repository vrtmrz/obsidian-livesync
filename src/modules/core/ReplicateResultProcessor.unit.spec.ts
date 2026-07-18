import { promiseWithResolvers } from "octagonal-wheels/promises";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import { describe, expect, it, vi } from "vitest";
import type { EntryDoc } from "@lib/common/types";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";

function note(id: string): PouchDB.Core.ExistingDocument<EntryDoc> {
    return {
        _id: id,
        _rev: "1-test",
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

type SetupOptions = {
    processSynchroniseResult?: (entry: unknown) => Promise<void>;
    setSnapshot?: (key: string, value: unknown) => Promise<unknown>;
    isSuspended?: () => boolean;
};

function setup(options: SetupOptions = {}) {
    const processSynchroniseResult = vi.fn(options.processSynchroniseResult ?? (async () => undefined));
    const setSnapshot = vi.fn(options.setSnapshot ?? (async () => undefined));
    const runBoundedRemoteActivity = vi.fn(async (task: () => Promise<void>) => await task());
    const core = {
        services: {
            appLifecycle: { isReady: true, isSuspended: options.isSuspended ?? (() => false) },
            path: { getPath: (entry: { path: string }) => entry.path },
            replication: {
                databaseQueueCount: reactiveSource(0),
                storageApplyingCount: reactiveSource(0),
                replicationResultCount: reactiveSource(0),
                processVirtualDocument: vi.fn(async () => false),
                processOptionalSynchroniseResult: vi.fn(async () => false),
                processSynchroniseResult,
            },
            replicator: { runBoundedRemoteActivity },
            vault: {
                isTargetFile: vi.fn(async () => true),
                isFileSizeTooLarge: vi.fn(() => false),
                isValidPath: vi.fn(() => true),
            },
        },
        kvDB: { set: setSnapshot },
        localDatabase: {
            getRaw: vi.fn(async (id: string) => ({ _id: id, _rev: "1-test" })),
            getDBEntryFromMeta: vi.fn(async (entry: object) => ({ ...entry, data: "x" })),
        },
        replicator: { closeReplication: vi.fn() },
    };
    const processor = new ReplicateResultProcessor({
        core,
        settings: { maxMTimeForReflectEvents: 0, suspendParseReplicationResult: false },
    } as never);
    return { processor, processSynchroniseResult, runBoundedRemoteActivity, setSnapshot };
}

describe("ReplicateResultProcessor", () => {
    it("keeps one activity boundary until every replicated document has been applied", async () => {
        const applying = promiseWithResolvers<void>();
        let activityFinished = false;
        const { processor, processSynchroniseResult, runBoundedRemoteActivity } = setup({
            processSynchroniseResult: async () => applying.promise,
        });
        runBoundedRemoteActivity.mockImplementation(async (task: () => Promise<void>) => {
            await task();
            activityFinished = true;
        });

        processor.enqueueAll([note("one"), note("two")]);

        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledTimes(2));
        expect(runBoundedRemoteActivity).toHaveBeenCalledTimes(1);
        expect(runBoundedRemoteActivity).toHaveBeenCalledWith(expect.any(Function), {
            label: "replicated-document-application",
        });
        expect(activityFinished).toBe(false);

        applying.resolve();

        await vi.waitFor(() => expect(activityFinished).toBe(true));
    });

    it("does not reject document application when the final recovery snapshot fails", async () => {
        let activityFinished = false;
        const { processor, runBoundedRemoteActivity } = setup({
            setSnapshot: async () => Promise.reject(new Error("snapshot failed")),
        });
        runBoundedRemoteActivity.mockImplementation(async (task: () => Promise<void>) => {
            await task();
            activityFinished = true;
        });

        processor.enqueueAll([note("one")]);

        await vi.waitFor(() => expect(activityFinished).toBe(true));
    });

    it("releases and reacquires the activity around application-level suspension", async () => {
        const applying = promiseWithResolvers<void>();
        let suspended = false;
        let completedActivities = 0;
        const { processor, processSynchroniseResult, runBoundedRemoteActivity } = setup({
            processSynchroniseResult: async () => applying.promise,
            isSuspended: () => suspended,
        });
        runBoundedRemoteActivity.mockImplementation(async (task: () => Promise<void>) => {
            await task();
            completedActivities++;
        });
        processor.enqueueAll([note("one")]);
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());

        suspended = true;
        processor.resume();

        await vi.waitFor(() => expect(completedActivities).toBe(1));

        suspended = false;
        processor.resume();
        await vi.waitFor(() => expect(runBoundedRemoteActivity).toHaveBeenCalledTimes(2));

        applying.resolve();
        await vi.waitFor(() => expect(completedActivities).toBe(2));
    });
});
