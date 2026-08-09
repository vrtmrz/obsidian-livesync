import { promiseWithResolvers } from "octagonal-wheels/promises";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive";
import { describe, expect, it, vi } from "vitest";
import type { EntryDoc } from "@vrtmrz/livesync-commonlib/compat/common/types";
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
};

function setup(options: SetupOptions = {}) {
    const processSynchroniseResult = vi.fn(options.processSynchroniseResult ?? (async () => undefined));
    const setSnapshot = vi.fn(options.setSnapshot ?? (async () => undefined));
    const runBoundedLocalApplicationActivity = vi.fn(async (task: () => Promise<void>) => await task());
    const core = {
        services: {
            appLifecycle: { isReady: true, isSuspended: () => false },
            path: { getPath: (entry: { path: string }) => entry.path },
            replication: {
                databaseQueueCount: reactiveSource(0),
                storageApplyingCount: reactiveSource(0),
                replicationResultCount: reactiveSource(0),
                processVirtualDocument: vi.fn(async () => false),
                processOptionalSynchroniseResult: vi.fn(async () => false),
                processSynchroniseResult,
            },
            replicator: { runBoundedLocalApplicationActivity },
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
    return { processor, processSynchroniseResult, runBoundedLocalApplicationActivity };
}

describe("ReplicateResultProcessor", () => {
    it("scans normal-file metadata without loading chunk documents and requeues it", async () => {
        const documents = [
            { _id: "first", _rev: "1-a", type: "plain", path: "first.md" },
            { _id: "second", _rev: "1-b", type: "plain", path: "second.md" },
        ] as unknown as PouchDB.Core.ExistingDocument<EntryDoc>[];
        const findAllNormalDocs = vi.fn(async function* () {
            yield* documents;
        });
        const processor = new ReplicateResultProcessor({
            core: { localDatabase: { findAllNormalDocs } },
        } as never);
        const enqueueAll = vi.spyOn(processor, "enqueueAll").mockImplementation(() => undefined);

        await expect(processor.reprocessStoredDocuments()).resolves.toBe(2);

        expect(findAllNormalDocs).toHaveBeenCalledOnce();
        expect(enqueueAll).toHaveBeenCalledOnce();
        expect(enqueueAll).toHaveBeenCalledWith(documents);
    });

    it("keeps one local application activity until every replicated document has been applied", async () => {
        const applying = promiseWithResolvers<void>();
        let activityFinished = false;
        const { processor, processSynchroniseResult, runBoundedLocalApplicationActivity } = setup({
            processSynchroniseResult: async () => applying.promise,
        });
        runBoundedLocalApplicationActivity.mockImplementation(async (task: () => Promise<void>) => {
            await task();
            activityFinished = true;
        });

        processor.enqueueAll([note("one"), note("two")]);

        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledTimes(2));
        expect(runBoundedLocalApplicationActivity).toHaveBeenCalledTimes(1);
        expect(runBoundedLocalApplicationActivity).toHaveBeenCalledWith(expect.any(Function), {
            label: "replicated-document-application",
        });
        expect(activityFinished).toBe(false);

        applying.resolve();

        await vi.waitFor(() => expect(activityFinished).toBe(true));
    });

    it("settles local application activity when the final recovery snapshot fails", async () => {
        let activityFinished = false;
        const { processor, runBoundedLocalApplicationActivity } = setup({
            setSnapshot: async () => Promise.reject(new Error("snapshot failed")),
        });
        runBoundedLocalApplicationActivity.mockImplementation(async (task: () => Promise<void>) => {
            await task();
            activityFinished = true;
        });

        processor.enqueueAll([note("one")]);

        await vi.waitFor(() => expect(activityFinished).toBe(true));
    });

    it("releases and reacquires local application activity around processing suspension", async () => {
        const applying = promiseWithResolvers<void>();
        let completedActivities = 0;
        const { processor, processSynchroniseResult, runBoundedLocalApplicationActivity } = setup({
            processSynchroniseResult: async () => applying.promise,
        });
        runBoundedLocalApplicationActivity.mockImplementation(async (task: () => Promise<void>) => {
            await task();
            completedActivities++;
        });
        processor.enqueueAll([note("one")]);
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());

        processor.suspend();
        await vi.waitFor(() => expect(completedActivities).toBe(1));

        processor.resume();
        await vi.waitFor(() => expect(runBoundedLocalApplicationActivity).toHaveBeenCalledTimes(2));

        applying.resolve();
        await vi.waitFor(() => expect(completedActivities).toBe(2));
    });
});
