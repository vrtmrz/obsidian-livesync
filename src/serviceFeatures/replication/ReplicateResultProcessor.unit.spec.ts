import { promiseWithResolvers } from "octagonal-wheels/promises";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive";
import { describe, expect, it, vi } from "vitest";
import { VER, type EntryDoc } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    defaultLogger,
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    setGlobalLogFunction,
} from "octagonal-wheels/common/logger";
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
    applicationReady?: boolean;
    processSynchroniseResult?: (entry: unknown) => Promise<boolean>;
    setSnapshot?: (key: string, value: unknown) => Promise<unknown>;
};

function setup(options: SetupOptions = {}) {
    const processSynchroniseResult = vi.fn(options.processSynchroniseResult ?? (async () => true));
    const setSnapshot = vi.fn(options.setSnapshot ?? (async () => undefined));
    const runBoundedLocalApplicationActivity = vi.fn(async (task: () => Promise<void>) => await task());
    const onCloseActiveReplication = vi.fn(async () => true);
    const isReady = vi.fn(() => options.applicationReady ?? true);
    const core = {
        services: {
            appLifecycle: { isReady, isSuspended: () => false },
            path: { getPath: (entry: { path: string }) => entry.path },
            replication: {
                databaseQueueCount: reactiveSource(0),
                storageApplyingCount: reactiveSource(0),
                replicationResultCount: reactiveSource(0),
                processVirtualDocument: vi.fn(async () => false),
                processOptionalSynchroniseResult: vi.fn(async () => false),
                processSynchroniseResult,
            },
            replicator: { onCloseActiveReplication, runBoundedLocalApplicationActivity },
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
    };
    const processor = new ReplicateResultProcessor({
        currentSettings: () => ({ maxMTimeForReflectEvents: 0, suspendParseReplicationResult: false }),
        getKeyValueDB: () => core.kvDB,
        getLocalDatabase: () => core.localDatabase,
        requestActiveReplicatorRetirement: () => {
            void onCloseActiveReplication();
        },
        runLocalApplicationActivity: runBoundedLocalApplicationActivity,
        services: core.services,
    } as never);
    return {
        isReady,
        onCloseActiveReplication,
        processor,
        processSynchroniseResult,
        runBoundedLocalApplicationActivity,
    };
}

describe("ReplicateResultProcessor", () => {
    it("suspends result application while the application is not ready", () => {
        const { isReady, processor } = setup({ applicationReady: false });

        expect(processor.isSuspended).toBe(true);
        expect(isReady).toHaveBeenCalledOnce();
    });

    it("retires active ownership when a newer remote version is observed", async () => {
        const { onCloseActiveReplication, processor } = setup();
        const versionInfo = {
            _id: "versioninfo",
            _rev: "1-test",
            type: "versioninfo",
            version: VER + 1,
        } as unknown as PouchDB.Core.ExistingDocument<EntryDoc>;

        processor.enqueueAll([versionInfo]);

        await vi.waitFor(() => expect(onCloseActiveReplication).toHaveBeenCalledOnce());
    });

    it("scans normal-file metadata without loading chunk documents and requeues it", async () => {
        const documents = [
            { _id: "first", _rev: "1-a", type: "plain", path: "first.md" },
            { _id: "second", _rev: "1-b", type: "plain", path: "second.md" },
        ] as unknown as PouchDB.Core.ExistingDocument<EntryDoc>[];
        const findAllNormalDocs = vi.fn(async function* () {
            yield* documents;
        });
        const getLocalDatabase = vi.fn(() => ({ findAllNormalDocs }));
        const processor = new ReplicateResultProcessor({
            getLocalDatabase,
        } as never);
        const enqueueAll = vi.spyOn(processor, "enqueueAll").mockImplementation(() => undefined);

        await expect(processor.reprocessStoredDocuments()).resolves.toBe(2);

        expect(findAllNormalDocs).toHaveBeenCalledOnce();
        expect(getLocalDatabase).toHaveBeenCalledOnce();
        expect(enqueueAll).toHaveBeenCalledOnce();
        expect(enqueueAll).toHaveBeenCalledWith(documents);
    });

    it("keeps one local application activity until every replicated document has been applied", async () => {
        const applying = promiseWithResolvers<boolean>();
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

        applying.resolve(true);

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
        const applying = promiseWithResolvers<boolean>();
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

        applying.resolve(true);
        await vi.waitFor(() => expect(completedActivities).toBe(2));
    });

    it.each([
        ["returns false", async () => false, undefined],
        ["throws", async () => Promise.reject(new Error("File name too long")), "File name too long"],
    ])("reports when Vault reflection %s", async (_description, processSynchroniseResult, errorMessage) => {
        const log = vi.fn((_message: unknown, _level?: number) => undefined);
        setGlobalLogFunction(log);
        try {
            const { processor } = setup({ processSynchroniseResult });

            processor.enqueueAll([note("unreflectable")]);

            await vi.waitFor(() =>
                expect(log).toHaveBeenCalledWith(
                    "Not all files could be synchronised. Check the affected files. Generate a report to review the detailed log.",
                    LOG_LEVEL_NOTICE,
                    undefined
                )
            );
            expect(log).toHaveBeenCalledWith(
                "[ReplicateResultProcessor] Live replication could not reflect unreflectable.md from the local database to the Vault; this path remains eligible for a later Vault scan.",
                LOG_LEVEL_VERBOSE,
                undefined
            );
            if (errorMessage !== undefined) {
                expect(log).toHaveBeenCalledWith(
                    expect.objectContaining({ message: errorMessage }),
                    LOG_LEVEL_VERBOSE,
                    undefined
                );
            }
            expect(log).not.toHaveBeenCalledWith(
                expect.stringContaining("Processed: unreflectable.md"),
                LOG_LEVEL_DEBUG,
                undefined
            );
        } finally {
            setGlobalLogFunction(defaultLogger);
        }
    });
});
