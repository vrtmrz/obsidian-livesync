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

describe("ReplicateResultProcessor", () => {
    it("keeps one activity boundary until every replicated document has been applied", async () => {
        const applying = promiseWithResolvers<void>();
        let activityFinished = false;
        const runBoundedRemoteActivity = vi.fn(async (task: () => Promise<void>) => {
            await task();
            activityFinished = true;
        });
        const processSynchroniseResult = vi.fn(async () => applying.promise);
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
                replicator: { runBoundedRemoteActivity },
                vault: {
                    isTargetFile: vi.fn(async () => true),
                    isFileSizeTooLarge: vi.fn(() => false),
                    isValidPath: vi.fn(() => true),
                },
            },
            kvDB: { set: vi.fn(async () => undefined) },
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
});
