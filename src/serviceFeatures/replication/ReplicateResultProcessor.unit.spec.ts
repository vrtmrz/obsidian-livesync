import { promiseWithResolvers } from "octagonal-wheels/promises";
import { reactiveSource } from "octagonal-wheels/dataobject/reactive";
import { describe, expect, it, vi } from "vitest";
import {
    VERSIONING_DOCID,
    type EntryDoc,
    type FilePathWithPrefix,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import * as replicationCompatibility from "@vrtmrz/livesync-commonlib/replication";
import { ENCRYPTED_INTERNAL_METADATA_FEATURE, REMOTE_FEATURE_GENERATION } from "@vrtmrz/livesync-commonlib/replication";
import {
    isValidFilenameInAndroid,
    isValidFilenameInWidows,
} from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import {
    defaultLogger,
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    setGlobalLogFunction,
} from "octagonal-wheels/common/logger";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";
import { LocalDatabaseUnavailableError, RemoteRequestError } from "@vrtmrz/livesync-commonlib/compat/common/LSError";

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
    waitForDatabaseReset?: boolean;
    onVaultReflectionFailure?: () => void;
    getRaw?: (id: string) => Promise<unknown>;
    getDBEntryFromMeta?: (entry: object, ...args: unknown[]) => Promise<unknown>;
    canDeferContentReadFailure?: (reason?: string) => boolean;
    inspectReflection?: (entry: object) => Promise<"reflected" | "policy" | "pending">;
    reconcileScannedDocument?: (entry: object, onFailure: (failure: unknown) => void) => Promise<unknown>;
    applicationReady?: boolean;
    databaseReady?: boolean;
    maxMTimeForReflectEvents?: number;
    isValidPath?: (path: string) => boolean;
    processSynchroniseResult?: (entry: unknown, ...args: unknown[]) => Promise<boolean>;
    setSnapshot?: (key: string, value: unknown) => Promise<unknown>;
    getSnapshot?: (key: string) => Promise<unknown>;
    localVersionInfo?: unknown;
    isTargetFile?: (path: string) => Promise<boolean>;
    databaseId?: string;
    pathNormalizationVersion?: number;
};

function setup(options: SetupOptions = {}) {
    const processSynchroniseResult = vi.fn(options.processSynchroniseResult ?? (async () => true));
    const setSnapshot = vi.fn(options.setSnapshot ?? (async () => undefined));
    const runBoundedLocalApplicationActivity = vi.fn(async (task: () => Promise<void>) => await task());
    const onCloseActiveReplication = vi.fn(async () => true);
    const isReady = vi.fn(() => options.applicationReady ?? true);
    const isValidPath = vi.fn(options.isValidPath ?? (() => true));
    const getDBEntryFromMeta = vi.fn(
        options.getDBEntryFromMeta ?? (async (entry: object) => ({ ...entry, data: "x" }))
    );
    const localPhysicalDatabase = {
        ...(options.databaseId ? { id: vi.fn(async () => options.databaseId) } : {}),
    } as PouchDB.Database<EntryDoc>;
    const core = {
        services: {
            appLifecycle: { isReady, isSuspended: () => false },
            database: { isDatabaseReady: () => options.databaseReady ?? true },
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
                isTargetFile: vi.fn(options.isTargetFile ?? (async () => true)),
                isFileSizeTooLarge: vi.fn(() => false),
                isValidPath,
            },
        },
        kvDB: { set: setSnapshot, get: vi.fn(options.getSnapshot ?? (async () => undefined)) },
        localDatabase: {
            localDatabase: localPhysicalDatabase,
            getRaw: vi.fn(async (id: string) => {
                if (id === VERSIONING_DOCID) {
                    if (options.localVersionInfo === undefined) throw { status: 404 };
                    return options.localVersionInfo;
                }
                if (options.getRaw) return await options.getRaw(id);
                return note(id);
            }),
            getDBEntryFromMeta,
        },
    };
    const processor = new ReplicateResultProcessor(
        {
            onVaultReflectionFailure: options.onVaultReflectionFailure,
            canDeferContentReadFailure: options.canDeferContentReadFailure,
            inspectReflection: options.inspectReflection,
            reconcileScannedDocument: options.reconcileScannedDocument,
            currentSettings: () => ({
                maxMTimeForReflectEvents: options.maxMTimeForReflectEvents ?? 0,
                suspendParseReplicationResult: false,
                pathNormalizationVersion: options.pathNormalizationVersion ?? 0,
            }),
            getKeyValueDB: () => core.kvDB,
            getLocalDatabase: () => core.localDatabase,
            requestActiveReplicatorRetirement: () => {
                void onCloseActiveReplication();
            },
            runLocalApplicationActivity: runBoundedLocalApplicationActivity,
            services: core.services,
        } as never,
        options.waitForDatabaseReset
    );
    return {
        getDBEntryFromMeta,
        isTargetFile: core.services.vault.isTargetFile,
        localPhysicalDatabase,
        localDatabase: core.localDatabase,
        isReady,
        isValidPath,
        onCloseActiveReplication,
        processor,
        replicationResultCount: core.services.replication.replicationResultCount,
        processSynchroniseResult,
        runBoundedLocalApplicationActivity,
    };
}

function failedContentRead(reason = "transport") {
    return vi.fn(async (entry: object, ...args: unknown[]) => {
        const meta = entry as { _id: string; _rev: string };
        const observer = args[3];
        if (typeof observer === "function") {
            observer({ documentId: meta._id, revision: meta._rev, reason });
        }
        return false;
    });
}

describe("bounded reflection recovery", () => {
    it("re-evaluates a retained Metadata failure after the same database resumes", async () => {
        const entry = note("metadata-reopened");
        let databaseAvailable = false;
        let applied = false;
        const options: SetupOptions = {
            databaseReady: false,
            canDeferContentReadFailure: (reason) => reason === "local-database",
            getRaw: async () => {
                if (!databaseAvailable) {
                    throw new DOMException("Connection closed", "InvalidStateError");
                }
                return entry;
            },
            processSynchroniseResult: async () => {
                applied = true;
                return true;
            },
            inspectReflection: async () => (applied ? "reflected" : "pending"),
        };
        const { processor, processSynchroniseResult } = setup(options);
        await processor.parseDocumentChange(entry);
        expect(processor.recovery.list()[0]).toMatchObject({ reason: "local-database", automaticAttempted: false });
        await processor.pauseForDatabaseRecovery();
        databaseAvailable = true;
        options.databaseReady = true;
        processor.resumeAfterDatabaseRecovery();
        await processor.retryWaitingReflections("local-database");
        await vi.waitFor(() => {
            expect(processSynchroniseResult).toHaveBeenCalledOnce();
            expect(processor.recovery.list()).toEqual([]);
        });
    });

    it("does not extend local database recovery to Hidden File Metadata", async () => {
        const { processor } = setup({
            canDeferContentReadFailure: () => true,
            getRaw: async () => {
                throw new DOMException("Connection closed", "InvalidStateError");
            },
        });
        await processor.parseDocumentChange(note("i:hidden-file"));
        expect(processor.recovery.list()).toEqual([]);
    });

    it("does not infer a local database origin from an unclassified storage InvalidStateError", async () => {
        const { processor } = setup({
            canDeferContentReadFailure: () => true,
            processSynchroniseResult: async () => {
                throw new DOMException("Storage operation failed", "InvalidStateError");
            },
        });
        await processor.parseDocumentChange(note("unclassified-storage-error"));
        expect(processor.recovery.list()).toEqual([]);
    });

    it.each(["false", "raw rejection", "supplied revision"])(
        "retains per-call local database evidence through later reflection %s",
        async (result) => {
            const entry = note("late-database-refusal");
            const { processor } = setup({
                canDeferContentReadFailure: (reason) => reason === "local-database",
                processSynchroniseResult: async (_entry, ...args) => {
                    const error = new DOMException("Connection closed", "InvalidStateError");
                    const observer = args[0];
                    if (typeof observer === "function") {
                        observer({
                            documentId: entry._id,
                            revision: result === "supplied revision" ? "2-observed" : undefined,
                            reason: "local-database",
                            cause: error,
                        });
                    }
                    if (result === "raw rejection") {
                        throw error;
                    }
                    return false;
                },
            });
            await processor.parseDocumentChange(entry);
            expect(processor.recovery.list()).toEqual([
                expect.objectContaining({
                    documentId: entry._id,
                    revision: result === "supplied revision" ? "2-observed" : entry._rev,
                    reason: "local-database",
                    state: "waiting",
                }),
            ]);
        }
    );

    it("preserves a different pending revision when local Metadata cannot establish the current target", async () => {
        const entry = note("unknown-current");
        const retained = { ...entry, _rev: "2-retained" };
        let databaseAvailable = true;
        const { processor, localDatabase } = setup({
            canDeferContentReadFailure: () => true,
            getRaw: async () => {
                if (!databaseAvailable) {
                    throw new DOMException("Connection closed", "InvalidStateError");
                }
                return retained;
            },
        });
        await processor.registerContentReadFailure(
            { documentId: retained._id, revision: retained._rev, reason: "transport" },
            "received"
        );
        localDatabase.getRaw.mockClear();
        databaseAvailable = false;
        await processor.parseDocumentChange(entry);
        expect(localDatabase.getRaw).toHaveBeenCalledOnce();
        expect(processor.recovery.list()[0]).toMatchObject({
            revision: retained._rev,
            reason: "transport",
            automaticAttempted: false,
        });
    });

    it("retains a typed local database failure thrown after the initial content read", async () => {
        const entry = note("late-database-failure");
        const { processor, getDBEntryFromMeta } = setup({
            canDeferContentReadFailure: (reason) => reason === "local-database",
            processSynchroniseResult: async () => {
                throw LocalDatabaseUnavailableError.fromError(
                    new DOMException("Connection closed", "InvalidStateError")
                );
            },
        });
        await processor.parseDocumentChange(entry);
        expect(getDBEntryFromMeta).toHaveBeenCalledOnce();
        expect(processor.recovery.list()).toEqual([
            expect.objectContaining({
                documentId: entry._id,
                revision: entry._rev,
                reason: "local-database",
                state: "waiting",
            }),
        ]);
    });

    it("does not infer a local database failure from an ordinary reflection refusal", async () => {
        const { processor } = setup({
            canDeferContentReadFailure: () => true,
            processSynchroniseResult: async () => false,
        });
        await processor.parseDocumentChange(note("ordinary-refusal"));
        expect(processor.recovery.list()).toEqual([]);
    });

    it.each([true, false])(
        "delegates logical deletion recovery to the ordinary policy (allowed: %s)",
        async (allowed) => {
            const entry = { ...note("local-deletion"), deleted: true };
            let databaseAvailable = false;
            let applied = false;
            const { processor, getDBEntryFromMeta, processSynchroniseResult } = setup({
                canDeferContentReadFailure: (reason) => reason === "local-database",
                getRaw: async () => {
                    if (!databaseAvailable) {
                        throw new DOMException("Connection closed", "InvalidStateError");
                    }
                    return entry;
                },
                processSynchroniseResult: async () => {
                    applied = allowed;
                    return allowed;
                },
                inspectReflection: async () => (applied ? "reflected" : "pending"),
            });
            await processor.parseDocumentChange(entry);
            expect(processor.recovery.list()[0]).toMatchObject({ state: "waiting", reason: "local-database" });
            databaseAvailable = true;
            await processor.retryWaitingReflections("local-database");
            await vi.waitFor(() => {
                expect(processSynchroniseResult).toHaveBeenCalledExactlyOnceWith(
                    expect.objectContaining({ deleted: true, data: "" }),
                    expect.any(Function)
                );
                expect(processor.recovery.list().some((target) => target.running)).toBe(false);
            });
            expect(getDBEntryFromMeta).not.toHaveBeenCalled();
            if (allowed) {
                expect(processor.recovery.list()).toEqual([]);
            } else {
                expect(processor.recovery.list()[0]).toMatchObject({ state: "review", automaticAttempted: true });
            }
        }
    );

    it.each(["reset", "stop"])("does not reflect a content read which completes after %s", async (transition) => {
        const reading = promiseWithResolvers<void>();
        const releaseRead = promiseWithResolvers<void>();
        const { processor, processSynchroniseResult } = setup({
            canDeferContentReadFailure: () => true,
            getDBEntryFromMeta: async (entry) => {
                reading.resolve();
                await releaseRead.promise;
                return { ...entry, data: "late content" };
            },
        });
        const applying = processor.parseDocumentChange(note("late-content"));
        await reading.promise;
        if (transition === "reset") {
            await processor.completeStartupDatabaseReset();
        } else {
            await processor.stop();
        }
        releaseRead.resolve();
        await applying;
        expect(processSynchroniseResult).not.toHaveBeenCalled();
    });

    it("serialises overlapping automatic and manual admission before their Metadata checks", async () => {
        const entry = note("serial-admission");
        const checking = promiseWithResolvers<void>();
        const releaseCheck = promiseWithResolvers<void>();
        let holdChecks = false;
        const { processor, localDatabase } = setup({
            canDeferContentReadFailure: () => true,
            getRaw: async () => {
                if (holdChecks) {
                    checking.resolve();
                    await releaseCheck.promise;
                }
                return entry;
            },
            getDBEntryFromMeta: failedContentRead(),
        });
        await processor.registerContentReadFailure(
            { documentId: entry._id, revision: entry._rev, reason: "transport" },
            "received"
        );
        localDatabase.getRaw.mockClear();
        holdChecks = true;
        const automatic = processor.retryWaitingReflections();
        await checking.promise;
        const manual = processor.recovery.retry([entry._id]);
        try {
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(localDatabase.getRaw).toHaveBeenCalledOnce();
        } finally {
            holdChecks = false;
            releaseCheck.resolve();
            await Promise.all([automatic, manual]);
        }
        await vi.waitFor(() => expect(processor.recovery.list().every((target) => !target.running)).toBe(true));
    });

    it("does not replace a restored different target with a scan failure observed before restoration", async () => {
        const entry = note("scan-restored-target");
        const loaded = promiseWithResolvers<unknown>();
        const { processor, localDatabase } = setup({
            canDeferContentReadFailure: () => true,
            getSnapshot: async () => loaded.promise,
            getRaw: async () => {
                throw new DOMException("Connection is closing", "InvalidStateError");
            },
        });
        const registration = processor.registerContentReadFailure(
            { documentId: entry._id, revision: entry._rev, reason: "transport" },
            "scan"
        );
        loaded.resolve({
            queued: [],
            processing: [],
            pendingReflections: [
                {
                    documentId: entry._id,
                    revision: "2-retained",
                    source: "received",
                    state: "waiting",
                    automaticAttempted: false,
                    reason: "local-database",
                },
            ],
        });
        await registration;
        expect(localDatabase.getRaw).not.toHaveBeenCalled();
        expect(processor.recovery.list()).toEqual([
            expect.objectContaining({ revision: "2-retained", reason: "local-database", automaticAttempted: false }),
        ]);
    });

    it("continues ordinary queued work held by database recovery without spending an allowance", async () => {
        const { processor, processSynchroniseResult } = setup({
            canDeferContentReadFailure: (reason) => reason === "local-database",
        });
        await processor.pauseForDatabaseRecovery();
        processor.enqueueAll([note("held-ordinary")]);
        expect(processSynchroniseResult).not.toHaveBeenCalled();
        expect(processor.recovery.list()).toEqual([]);
        processor.resumeAfterDatabaseRecovery();
        await processor.retryWaitingReflections("local-database");
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());
        expect(processor.recovery.list()).toEqual([]);
    });

    it.each(["reset", "stop"])(
        "does not enqueue an admission after %s wins its snapshot acknowledgement",
        async (transition) => {
            const saved = promiseWithResolvers<void>();
            const releaseSave = promiseWithResolvers<void>();
            const read = failedContentRead();
            const { processor, replicationResultCount } = setup({
                canDeferContentReadFailure: () => true,
                getDBEntryFromMeta: read,
                setSnapshot: async (_key, value) => {
                    if ((value as { recoveryAttempts?: unknown[] }).recoveryAttempts?.length) {
                        saved.resolve();
                        await releaseSave.promise;
                    }
                },
            });
            await processor.parseDocumentChange(note("transition-protected"));
            const admission = processor.retryWaitingReflections();
            await saved.promise;
            const ending = transition === "reset" ? processor.completeStartupDatabaseReset() : processor.stop();
            releaseSave.resolve();
            await Promise.all([admission, ending]);
            expect(read).toHaveBeenCalledOnce();
            expect(replicationResultCount.value).toBe(0);
            if (transition === "reset") {
                expect(processor.recovery.list()).toEqual([]);
            } else {
                expect(processor.recovery.list()[0]).toMatchObject({
                    state: "review",
                    automaticAttempted: true,
                    running: false,
                });
            }
        }
    );

    it("retains a known revision when its Metadata read loses the local database without re-reading it", async () => {
        const entry = note("metadata-lost");
        const failure = new DOMException("Connection is closing", "InvalidStateError");
        const { processor, localDatabase, getDBEntryFromMeta } = setup({
            canDeferContentReadFailure: (reason) => reason === "local-database",
            getRaw: async () => {
                throw failure;
            },
        });
        await processor.parseDocumentChange(entry);
        expect(localDatabase.getRaw).toHaveBeenCalledOnce();
        expect(getDBEntryFromMeta).not.toHaveBeenCalled();
        expect(processor.recovery.list()).toEqual([
            expect.objectContaining({
                documentId: entry._id,
                revision: entry._rev,
                source: "received",
                state: "waiting",
                reason: "local-database",
                automaticAttempted: false,
                running: false,
            }),
        ]);
    });

    it("records a known content-read target without requiring another Metadata read", async () => {
        const entry = note("known-target");
        const cause = RemoteRequestError.fromError(new Error("Request failed"));
        const snapshots: unknown[] = [];
        const { processor, localDatabase } = setup({
            canDeferContentReadFailure: () => true,
            getRaw: async () => {
                throw cause;
            },
            setSnapshot: async (_key, value) => {
                snapshots.push(structuredClone(value));
            },
        });
        await processor.registerContentReadFailure(
            { documentId: entry._id, revision: entry._rev, reason: "transport", cause },
            "received"
        );
        expect(localDatabase.getRaw).not.toHaveBeenCalled();
        expect(processor.recovery.list()[0]).toMatchObject({ state: "waiting", reason: "transport" });
        const pending = (snapshots[snapshots.length - 1] as { pendingReflections: unknown[] }).pendingReflections[0];
        expect(pending).not.toHaveProperty("cause");
    });

    it("uses only the matching resource signal and shares the consumed allowance across failure reasons", async () => {
        let readReason = "local-database";
        const fail = vi.fn(
            async (entry: object, ...args: unknown[]) => await failedContentRead(readReason)(entry, ...args)
        );
        const { processor, replicationResultCount } = setup({
            canDeferContentReadFailure: () => true,
            getDBEntryFromMeta: fail,
        });
        await processor.parseDocumentChange(note("resource-specific"));
        expect(processor.recovery.list()[0]).toMatchObject({ state: "waiting", automaticAttempted: false });
        await processor.retryWaitingReflections();
        expect(fail).toHaveBeenCalledOnce();
        expect(processor.recovery.list()[0]).toMatchObject({ state: "waiting", automaticAttempted: false });
        readReason = "transport";
        await processor.retryWaitingReflections("local-database");
        await vi.waitFor(() => {
            expect(fail).toHaveBeenCalledTimes(2);
            expect(replicationResultCount.value).toBe(0);
            expect(processor.recovery.list()[0]).toMatchObject({
                reason: "transport",
                state: "review",
                automaticAttempted: true,
                running: false,
            });
        });
        await processor.retryWaitingReflections();
        await processor.pauseForDatabaseRecovery();
        processor.resumeAfterDatabaseRecovery();
        await processor.retryWaitingReflections("local-database");
        expect(fail).toHaveBeenCalledTimes(2);
    });

    it("admits one batch at a time without holding admission through file inspection or execution", async () => {
        const firstInspection = promiseWithResolvers<void>();
        const releaseInspection = promiseWithResolvers<void>();
        const inspected = vi.fn(async () => {
            firstInspection.resolve();
            await releaseInspection.promise;
            return "pending" as const;
        });
        const { processor, getDBEntryFromMeta } = setup({
            canDeferContentReadFailure: () => true,
            inspectReflection: inspected,
        });
        for (const id of ["admitted-first", "admitted-second"]) {
            await processor.registerContentReadFailure(
                { documentId: note(id)._id, revision: "1-test", reason: "transport" },
                "received"
            );
        }
        let admitted = false;
        const admission = processor.retryWaitingReflections().then(() => {
            admitted = true;
        });
        try {
            await firstInspection.promise;
            await vi.waitFor(() => expect(admitted).toBe(true));
            expect(processor.recovery.list()).toEqual([
                expect.objectContaining({ documentId: "admitted-first", automaticAttempted: true, running: true }),
                expect.objectContaining({ documentId: "admitted-second", automaticAttempted: true, running: true }),
            ]);
            expect(getDBEntryFromMeta).not.toHaveBeenCalled();
        } finally {
            releaseInspection.resolve();
            await admission;
        }
        await vi.waitFor(() => expect(processor.recovery.list().every((target) => !target.running)).toBe(true));
    });

    it("retains the newer target when an older ordinary read reports its failure late", async () => {
        const oldEntry = note("ordinary-advancing");
        let current = oldEntry;
        const reading = promiseWithResolvers<void>();
        const releaseRead = promiseWithResolvers<void>();
        const { processor } = setup({
            canDeferContentReadFailure: () => true,
            getRaw: async () => current,
            getDBEntryFromMeta: async (entry, ...args) => {
                reading.resolve();
                await releaseRead.promise;
                return await failedContentRead()(entry, ...args);
            },
        });
        const applying = processor.parseDocumentChange(oldEntry);
        await reading.promise;
        current = { ...oldEntry, _rev: "2-current" };
        await processor.registerContentReadFailure(
            { documentId: current._id, revision: current._rev, reason: "transport" },
            "received"
        );
        releaseRead.resolve();
        await applying;
        expect(processor.recovery.list()[0]).toMatchObject({ revision: current._rev, automaticAttempted: false });
    });

    it("keeps ordinary restored work in the shutdown snapshot without starting it", async () => {
        const load = promiseWithResolvers<unknown>();
        const saved: unknown[] = [];
        const { processor, processSynchroniseResult, runBoundedLocalApplicationActivity } = setup({
            getSnapshot: async () => load.promise,
            setSnapshot: async (_key, value) => {
                saved.push(structuredClone(value));
            },
        });
        const restoring = processor.restoreFromSnapshotOnce();
        const stopping = processor.stop();
        const entry = note("held-on-shutdown");
        load.resolve({ queued: [entry], processing: [] });
        await Promise.all([restoring, stopping]);

        expect(saved[saved.length - 1]).toMatchObject({ queued: [entry], processing: [] });
        expect(processSynchroniseResult).not.toHaveBeenCalled();
        expect(runBoundedLocalApplicationActivity).not.toHaveBeenCalled();
    });

    it("does not refill a restored allowance when the startup scan reports the same revision again", async () => {
        const entry = note("restored-review");
        const { processor, getDBEntryFromMeta } = setup({
            canDeferContentReadFailure: () => true,
            getSnapshot: async () => ({
                queued: [],
                processing: [],
                pendingReflections: [
                    {
                        documentId: entry._id,
                        revision: entry._rev,
                        source: "received",
                        state: "review",
                        automaticAttempted: true,
                        reason: "transport",
                    },
                ],
            }),
        });
        await processor.registerContentReadFailure(
            { documentId: entry._id, revision: entry._rev, reason: "offline" },
            "scan"
        );
        await processor.retryWaitingReflections();
        expect(getDBEntryFromMeta).not.toHaveBeenCalled();
        expect(processor.recovery.list()[0]).toMatchObject({
            state: "review",
            automaticAttempted: true,
            running: false,
        });
    });

    it("serialises an old waiting snapshot before consumption so a late write cannot refund it", async () => {
        const entry = note("ordered-save");
        const firstWriteStarted = promiseWithResolvers<void>();
        const releaseFirstWrite = promiseWithResolvers<void>();
        let first = true;
        let activeWrites = 0;
        let maximumWrites = 0;
        let persisted: { pendingReflections?: { automaticAttempted: boolean }[] } | undefined;
        const read = failedContentRead();
        const { processor, replicationResultCount } = setup({
            canDeferContentReadFailure: () => true,
            getDBEntryFromMeta: read,
            setSnapshot: async (_key, value) => {
                activeWrites++;
                maximumWrites = Math.max(maximumWrites, activeWrites);
                if (first) {
                    first = false;
                    firstWriteStarted.resolve();
                    await releaseFirstWrite.promise;
                }
                persisted = structuredClone(value) as typeof persisted;
                activeWrites--;
            },
        });
        const registration = processor.registerContentReadFailure(
            { documentId: entry._id, revision: entry._rev, reason: "offline" },
            "scan"
        );
        await firstWriteStarted.promise;
        const scheduling = processor.retryWaitingReflections();
        await vi.waitFor(() => expect(processor.recovery.list()[0]?.automaticAttempted).toBe(true));
        expect(read).not.toHaveBeenCalled();
        releaseFirstWrite.resolve();
        await Promise.all([registration, scheduling]);
        await vi.waitFor(() => expect(replicationResultCount.value).toBe(0));
        expect(maximumWrites).toBe(1);
        expect(persisted?.pendingReflections?.[0]?.automaticAttempted).toBe(true);
    });

    it("reconciles a successful independent scan without another content request", async () => {
        let reflected = false;
        const read = failedContentRead();
        const { processor } = setup({
            canDeferContentReadFailure: () => true,
            getDBEntryFromMeta: read,
            inspectReflection: async () => (reflected ? "reflected" : "pending"),
        });
        const entry = note("manual-scan-resolved");
        await processor.parseDocumentChange(entry);
        reflected = true;
        await processor.reconcilePendingDocument(entry._id);
        expect(read).toHaveBeenCalledOnce();
        expect(processor.recovery.list()).toEqual([]);
    });

    it("consumes one automatic attempt even when finite success notifications overlap or repeat", async () => {
        const read = failedContentRead();
        const { processor, replicationResultCount, runBoundedLocalApplicationActivity } = setup({
            canDeferContentReadFailure: () => true,
            getDBEntryFromMeta: read,
        });
        await processor.parseDocumentChange(note("retry-once"));

        await Promise.all([processor.retryWaitingReflections(), processor.retryWaitingReflections()]);
        await vi.waitFor(() => {
            expect(read).toHaveBeenCalledTimes(2);
            expect(replicationResultCount.value).toBe(0);
            expect(processor.recovery.list()[0]).toMatchObject({
                state: "review",
                automaticAttempted: true,
                running: false,
            });
        });
        await processor.retryWaitingReflections();
        await processor.retryWaitingReflections();

        expect(read).toHaveBeenCalledTimes(2);
        await Promise.all(runBoundedLocalApplicationActivity.mock.results.map(({ value }) => value));
    });

    it("clears a recovered revision only after reflection is confirmed", async () => {
        let applied = false;
        const fail = failedContentRead("offline");
        const read = vi.fn(async (entry: object, ...args: unknown[]) => {
            if (read.mock.calls.length === 1) {
                return await fail(entry, ...args);
            }
            return { ...entry, data: "x" };
        });
        const { processor, processSynchroniseResult, replicationResultCount } = setup({
            canDeferContentReadFailure: () => true,
            getDBEntryFromMeta: read,
            processSynchroniseResult: async () => {
                applied = true;
                return true;
            },
            inspectReflection: async () => (applied ? "reflected" : "pending"),
        });
        await processor.parseDocumentChange(note("recover"));
        await processor.retryWaitingReflections();

        await vi.waitFor(() => {
            expect(processSynchroniseResult).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ _id: "recover", _rev: "1-test", data: "x" }),
                expect.any(Function)
            );
            expect(processor.recovery.list()).toEqual([]);
            expect(replicationResultCount.value).toBe(0);
        });
    });

    it("does not equate a true file-handler result with confirmed reflection", async () => {
        const entry = note("inconclusive");
        const { processor, processSynchroniseResult } = setup({
            canDeferContentReadFailure: () => true,
            inspectReflection: async () => "pending",
        });
        await processor.registerContentReadFailure(
            { documentId: entry._id, revision: entry._rev, reason: "offline" },
            "received"
        );
        await processor.retryWaitingReflections();

        await vi.waitFor(() => {
            expect(processSynchroniseResult).toHaveBeenCalledOnce();
            expect(processor.recovery.list()[0]).toMatchObject({
                state: "review",
                automaticAttempted: true,
                running: false,
            });
        });
    });

    it("does not replay consumed recovery work after restart, while ordinary queued work still runs", async () => {
        const entry = note("interrupted");
        const ordinary = note("ordinary");
        const read = vi.fn(async (value: object) => ({ ...value, data: "x" }));
        const { processor, replicationResultCount } = setup({
            canDeferContentReadFailure: () => true,
            getDBEntryFromMeta: read,
            getSnapshot: async () => ({
                queued: [entry, ordinary],
                processing: [entry],
                pendingReflections: [
                    {
                        documentId: entry._id,
                        revision: entry._rev,
                        source: "received",
                        state: "review",
                        automaticAttempted: true,
                        reason: "transport",
                    },
                ],
                recoveryAttempts: [{ documentId: entry._id, revision: entry._rev, kind: "automatic" }],
            }),
        });
        await processor.restoreFromSnapshotOnce();
        await processor.retryWaitingReflections();

        await vi.waitFor(() => expect(replicationResultCount.value).toBe(0));
        expect(read).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ _id: ordinary._id }),
            false,
            true,
            false,
            expect.any(Function)
        );
        expect(processor.recovery.list()).toEqual([
            expect.objectContaining({
                documentId: entry._id,
                state: "review",
                automaticAttempted: true,
                reason: "interrupted",
                running: false,
            }),
        ]);
    });

    it("waits for the durable allowance acknowledgement before starting the recovery read", async () => {
        const saveStarted = promiseWithResolvers<void>();
        const allowSave = promiseWithResolvers<void>();
        const read = failedContentRead();
        const { processor } = setup({
            canDeferContentReadFailure: () => true,
            getDBEntryFromMeta: read,
            setSnapshot: async (_key, value) => {
                if ((value as { recoveryAttempts?: unknown[] }).recoveryAttempts?.length) {
                    saveStarted.resolve();
                    await allowSave.promise;
                }
            },
        });
        await processor.parseDocumentChange(note("save-first"));
        const scheduling = processor.retryWaitingReflections();
        await saveStarted.promise;
        expect(read).toHaveBeenCalledTimes(1);
        allowSave.resolve();
        await scheduling;
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(processor.recovery.list()[0]?.running).toBe(false));
    });

    it("retains review work without making an unrecorded automatic request when saving fails", async () => {
        const read = failedContentRead();
        const { processor, replicationResultCount } = setup({
            canDeferContentReadFailure: () => true,
            getDBEntryFromMeta: read,
            setSnapshot: async (_key, value) => {
                if ((value as { recoveryAttempts?: unknown[] }).recoveryAttempts?.length) {
                    throw new Error("store unavailable");
                }
            },
        });
        await processor.parseDocumentChange(note("save-fails"));
        await processor.retryWaitingReflections();
        await processor.retryWaitingReflections();

        expect(read).toHaveBeenCalledTimes(1);
        expect(replicationResultCount.value).toBe(0);
        expect(processor.recovery.list()[0]).toMatchObject({
            state: "review",
            automaticAttempted: true,
            reason: "snapshot-save-failed",
            running: false,
        });
    });

    it("uses the ordinary scanner policy for scanner-origin recovery", async () => {
        let resolved = false;
        const reconcileScannedDocument = vi.fn(async () => {
            resolved = true;
        });
        const entry = note("scan-origin");
        const { processor, getDBEntryFromMeta, processSynchroniseResult } = setup({
            canDeferContentReadFailure: () => true,
            inspectReflection: async () => (resolved ? "reflected" : "pending"),
            reconcileScannedDocument,
        });
        await processor.registerContentReadFailure(
            { documentId: entry._id, revision: entry._rev, reason: "offline" },
            "scan"
        );
        await processor.retryWaitingReflections();

        await vi.waitFor(() => expect(processor.recovery.list()).toEqual([]));
        expect(reconcileScannedDocument).toHaveBeenCalledOnce();
        expect(getDBEntryFromMeta).not.toHaveBeenCalled();
        expect(processSynchroniseResult).not.toHaveBeenCalled();
    });

    it("keeps a newer revision's unused allowance when the old attempt finishes late", async () => {
        const oldEntry = note("advancing");
        let current = oldEntry;
        const oldReadStarted = promiseWithResolvers<void>();
        const finishOldRead = promiseWithResolvers<void>();
        const fail = failedContentRead();
        const read = vi.fn(async (entry: object, ...args: unknown[]) => {
            if (read.mock.calls.length === 2) {
                oldReadStarted.resolve();
                await finishOldRead.promise;
            }
            return await fail(entry, ...args);
        });
        const { processor, replicationResultCount } = setup({
            canDeferContentReadFailure: () => true,
            getRaw: async () => current,
            getDBEntryFromMeta: read,
        });
        await processor.parseDocumentChange(oldEntry);
        await processor.retryWaitingReflections();
        await oldReadStarted.promise;
        current = { ...oldEntry, _rev: "2-current" };
        await processor.registerContentReadFailure(
            { documentId: current._id, revision: current._rev, reason: "offline" },
            "received"
        );
        finishOldRead.resolve();

        await vi.waitFor(() => expect(replicationResultCount.value).toBe(0));
        expect(processor.recovery.list()[0]).toMatchObject({
            revision: current._rev,
            state: "waiting",
            automaticAttempted: false,
            running: false,
        });
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    });

    it("allows explicit manual retry without replenishing an exhausted allowance", async () => {
        const read = failedContentRead();
        const { processor } = setup({ canDeferContentReadFailure: () => true, getDBEntryFromMeta: read });
        const entry = note("manual");
        await processor.parseDocumentChange(entry);
        await processor.retryWaitingReflections();
        await vi.waitFor(() => expect(processor.recovery.list()[0]?.running).toBe(false));
        await processor.recovery.retry([entry._id]);
        await vi.waitFor(() => {
            expect(read).toHaveBeenCalledTimes(3);
            expect(processor.recovery.list()[0]).toMatchObject({
                state: "review",
                automaticAttempted: true,
                running: false,
            });
        });
        await processor.retryWaitingReflections();
        expect(read).toHaveBeenCalledTimes(3);
    });

    it.each(["missing", "authentication", "configuration", "cancelled", "unavailable"])(
        "does not register %s as an initial automatic recovery target",
        async (reason) => {
            const { processor } = setup({
                canDeferContentReadFailure: () => true,
                getDBEntryFromMeta: failedContentRead(reason),
            });
            await processor.parseDocumentChange(note("terminal"));
            expect(processor.recovery.list()).toEqual([]);
        }
    );

    it("preserves retained targets when reset acknowledgement cannot be saved", async () => {
        let savingFails = false;
        const { processor } = setup({
            canDeferContentReadFailure: () => true,
            getDBEntryFromMeta: failedContentRead(),
            setSnapshot: async () => {
                if (savingFails) {
                    throw new Error("store unavailable");
                }
            },
        });
        await processor.parseDocumentChange(note("reset-protected"));
        const before = processor.recovery.list();
        savingFails = true;
        await expect(processor.completeStartupDatabaseReset()).rejects.toThrow("store unavailable");
        expect(processor.recovery.list()).toEqual(before);
        savingFails = false;
        await processor.completeStartupDatabaseReset();
        expect(processor.recovery.list()).toEqual([]);
    });
});

describe("ReplicateResultProcessor", () => {
    it("holds new reflection while a database pause waits for already started work", async () => {
        let finish!: () => void;
        const first = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const { processor, processSynchroniseResult } = setup({
            processSynchroniseResult: async () => {
                await first;
                return true;
            },
        });
        const applying = processor.parseDocumentChange(note("running"));
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());
        let paused = false;
        const pause = processor.pauseForDatabaseRecovery().then(() => {
            paused = true;
        });
        processor.enqueueAll([note("held")]);
        await Promise.resolve();
        expect(paused).toBe(false);
        expect(processor.isSuspended).toBe(true);
        finish();
        await applying;
        await pause;
        expect(processSynchroniseResult).toHaveBeenCalledOnce();
        processor.resumeAfterDatabaseRecovery();
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledTimes(2));
    });

    it("retains a terminal transport read failure outside the active queue", async () => {
        const entry = note("pending");
        const snapshots: unknown[] = [];
        const { processor, replicationResultCount, processSynchroniseResult } = setup({
            canDeferContentReadFailure: () => true,
            setSnapshot: async (_key, value) => {
                snapshots.push(structuredClone(value));
            },
            getDBEntryFromMeta: async (_entry, ...args) => {
                const onFailure = args[3];
                if (typeof onFailure === "function") {
                    onFailure({ documentId: entry._id, revision: entry._rev, reason: "transport" });
                }
                return false;
            },
        });

        await processor.parseDocumentChange(entry);

        expect(processSynchroniseResult).not.toHaveBeenCalled();
        expect(replicationResultCount.value).toBe(0);
        expect(snapshots[snapshots.length - 1]).toMatchObject({
            queued: [],
            processing: [],
            pendingReflections: [
                {
                    documentId: entry._id,
                    revision: entry._rev,
                    source: "received",
                    state: "waiting",
                    automaticAttempted: false,
                    reason: "transport",
                },
            ],
        });
    });

    it("does not restore old reflection work while waiting for database replacement", async () => {
        const getSnapshot = vi.fn(async () => ({ queued: [note("old")], processing: [] }));
        const setSnapshot = vi.fn(async () => undefined);
        const { processor, processSynchroniseResult, replicationResultCount } = setup({
            waitForDatabaseReset: true,
            getSnapshot,
            setSnapshot,
        });

        await processor.restoreFromSnapshotOnce();
        processor.resume();
        processor.continueHeldDocuments();

        expect(getSnapshot).not.toHaveBeenCalled();
        expect(setSnapshot).not.toHaveBeenCalled();
        expect(replicationResultCount.value).toBe(0);
        expect(processSynchroniseResult).not.toHaveBeenCalled();
    });

    it("discards the old snapshot after reset and accepts only newly received documents", async () => {
        const getSnapshot = vi.fn(async () => ({ queued: [note("old")], processing: [note("in-flight")] }));
        const setSnapshot = vi.fn(async () => undefined);
        const { processor, processSynchroniseResult, replicationResultCount } = setup({
            waitForDatabaseReset: true,
            getSnapshot,
            setSnapshot,
        });
        await processor.restoreFromSnapshotOnce();
        processor.enqueueAll([note("before-reset")]);
        expect(setSnapshot).not.toHaveBeenCalled();
        expect(replicationResultCount.value).toBe(0);

        await processor.completeStartupDatabaseReset();

        expect(setSnapshot).toHaveBeenCalledWith("replicationResultProcessorSnapshot", { queued: [], processing: [] });
        await processor.restoreFromSnapshotOnce();
        expect(getSnapshot).not.toHaveBeenCalled();
        processor.enqueueAll([note("new")]);
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());
        expect(processSynchroniseResult).toHaveBeenCalledWith(expect.objectContaining({ path: "new.md" }));
    });

    it("keeps reflection blocked if persisting snapshot invalidation fails", async () => {
        const failure = new Error("Snapshot write failed");
        const setSnapshot = vi.fn(async () => undefined).mockRejectedValueOnce(failure);
        const { processor, processSynchroniseResult } = setup({ waitForDatabaseReset: true, setSnapshot });

        await expect(processor.completeStartupDatabaseReset()).rejects.toThrow(failure);
        processor.resume();
        processor.enqueueAll([note("blocked")]);
        expect(processor.isSuspended).toBe(true);
        expect(processSynchroniseResult).not.toHaveBeenCalled();

        await processor.completeStartupDatabaseReset();
        processor.enqueueAll([note("after-retry")]);
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());
        expect(processSynchroniseResult).toHaveBeenCalledWith(expect.objectContaining({ path: "after-retry.md" }));
    });

    it("reports an IndexedDB read error as failed reflection", async () => {
        const onVaultReflectionFailure = vi.fn();
        const { processor, processSynchroniseResult } = setup({
            onVaultReflectionFailure,
            getRaw: async () => {
                throw new Error("IndexedDB read failed");
            },
        });
        processor.enqueueAll([note("unreadable")]);
        await vi.waitFor(() => expect(onVaultReflectionFailure).toHaveBeenCalledOnce());
        expect(processSynchroniseResult).not.toHaveBeenCalled();
    });

    it("reports a thrown document reconstruction as failed reflection", async () => {
        const onVaultReflectionFailure = vi.fn();
        const { processor } = setup({
            onVaultReflectionFailure,
            getDBEntryFromMeta: async () => {
                throw new Error("Cannot read chunks");
            },
        });
        processor.enqueueAll([note("missing-chunks")]);
        await vi.waitFor(() => expect(onVaultReflectionFailure).toHaveBeenCalledOnce());
    });

    it("publishes pending received documents synchronously even if snapshot persistence stalls", () => {
        const { processor, replicationResultCount, processSynchroniseResult } = setup({
            applicationReady: false,
            setSnapshot: async () => new Promise<never>(() => undefined),
        });
        processor.enqueueAll([note("pending")]);
        expect(replicationResultCount.value).toBe(1);
        expect(processSynchroniseResult).not.toHaveBeenCalled();
    });

    it("clears the received-document counter before awaiting an unresponsive snapshot write", async () => {
        const { processor, replicationResultCount, processSynchroniseResult } = setup({
            setSnapshot: async () => new Promise<never>(() => undefined),
        });
        processor.enqueueAll([note("pending")]);
        expect(replicationResultCount.value).toBe(1);
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(replicationResultCount.value).toBe(0));
    });

    it("reports a failed Vault reflection instead of treating an empty queue as success", async () => {
        const onVaultReflectionFailure = vi.fn();
        const { processor, processSynchroniseResult } = setup({
            onVaultReflectionFailure,
            processSynchroniseResult: async () => false,
        });
        processor.enqueueAll([note("unreflected")]);
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(onVaultReflectionFailure).toHaveBeenCalledTimes(1));
    });
    it("does not add a permanent application block when snapshot recovery fails", async () => {
        const { processor } = setup({
            getSnapshot: async () => {
                throw new Error("KV unavailable");
            },
        });
        await expect(processor.restoreFromSnapshotOnce()).rejects.toThrow("KV unavailable");
        expect(processor.isSuspended).toBe(false);
    });

    it("restores pending notes without retaining a past feature rejection in KV", async () => {
        const { processor, processSynchroniseResult, onCloseActiveReplication } = setup({
            databaseId: "same-database",
            getSnapshot: async () => ({
                databaseId: "same-database",
                invalidControlObserved: true,
                observedFeatures: ["future-format-v7"],
                observedGeneration: 14,
                queued: [note("recovered-note")],
                processing: [],
            }),
        });
        await processor.restoreFromSnapshotOnce();
        expect(processor.isSuspended).toBe(false);
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());
        expect(onCloseActiveReplication).not.toHaveBeenCalled();
    });

    it.each([
        ["Windows", isValidFilenameInWidows],
        ["Android", isValidFilenameInAndroid],
    ])("does not reflect a replicated colon path into the %s Vault", async (_platform, validatePath) => {
        const path = "Folder/Poem: Example.md" as FilePathWithPrefix;
        const document = { ...note("colon-path"), path };
        const { getDBEntryFromMeta, isValidPath, processor, processSynchroniseResult } = setup({
            isValidPath: validatePath,
        });

        processor.enqueueAll([document]);

        await vi.waitFor(() => expect(isValidPath).toHaveBeenCalledWith(path));
        await vi.waitFor(() => expect(processor["_processingChanges"]).toHaveLength(0));
        expect(getDBEntryFromMeta).toHaveBeenCalledWith(expect.objectContaining({ path }), false, true);
        expect(processSynchroniseResult).not.toHaveBeenCalled();
    });

    it("resumes another document after in-flight updates to one document fill the application slots", async () => {
        const hotGate = promiseWithResolvers<boolean>();
        const { processor, processSynchroniseResult } = setup({
            processSynchroniseResult: async (entry) => {
                if ((entry as { _id: string })._id === "hot-queue") return await hotGate.promise;
                return true;
            },
        });
        try {
            for (let index = 1; index <= 10; index++) {
                // A queued duplicate is coalesced; a new notification for a document
                // already being processed can occupy another application slot.
                processor.enqueueAll([note("hot-queue")]);
                await vi.waitFor(() => expect(processor["_processingChanges"]).toHaveLength(index));
            }
            processor.enqueueAll([note("unrelated-queue")]);
            await vi.waitFor(() => {
                expect(processor["_semaphore"].waiting).toBeGreaterThan(0);
                expect(processSynchroniseResult).toHaveBeenCalledTimes(1);
            });
            expect(processor["_queuedChanges"].map((entry) => entry._id)).toEqual(["unrelated-queue"]);
        } finally {
            hotGate.resolve(true);
            await vi.waitFor(() => {
                expect(processor["_processingChanges"]).toHaveLength(0);
                expect(processor["_queuedChanges"]).toHaveLength(0);
            });
        }
        expect(processSynchroniseResult).toHaveBeenCalledTimes(11);
        expect(
            processSynchroniseResult.mock.calls.some(([entry]) => (entry as { _id: string })._id === "unrelated-queue")
        ).toBe(true);
    });

    it("suspends result application while the application is not ready", () => {
        const { isReady, processor } = setup({ applicationReady: false });

        expect(processor.isSuspended).toBe(true);
        expect(isReady).toHaveBeenCalledOnce();
    });

    it("applies documents held before readiness once the application becomes ready", async () => {
        const { isReady, processor, processSynchroniseResult } = setup({ applicationReady: false });
        processor.enqueueAll([note("held")]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(processSynchroniseResult).not.toHaveBeenCalled();
        expect(processor["_queuedChanges"]).toHaveLength(1);

        isReady.mockReturnValue(true);
        processor.continueHeldDocuments();

        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());
        expect(processor["_queuedChanges"]).toHaveLength(0);
    });

    it("keeps an explicit suspension when the application becomes ready", async () => {
        const { isReady, processor, processSynchroniseResult } = setup({ applicationReady: false });
        processor.suspend();
        processor.enqueueAll([note("held")]);

        isReady.mockReturnValue(true);
        processor.continueHeldDocuments();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(processSynchroniseResult).not.toHaveBeenCalled();
        expect(processor["_queuedChanges"]).toHaveLength(1);

        processor.resume();
        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());
    });

    it("applies results in remediation mode, which never reports readiness", () => {
        const { processor } = setup({
            applicationReady: false,
            maxMTimeForReflectEvents: Date.parse("2026-09-01T00:00:00Z"),
        });

        expect(processor.isSuspended).toBe(false);
    });

    it("holds results in remediation mode while the local database is being rebuilt", () => {
        const { processor } = setup({
            applicationReady: false,
            databaseReady: false,
            maxMTimeForReflectEvents: Date.parse("2026-09-01T00:00:00Z"),
        });

        expect(processor.isSuspended).toBe(true);
    });

    it("still skips a document modified after the limit while the application is unready", async () => {
        const maxMTimeForReflectEvents = Date.parse("2026-09-01T00:00:00Z");
        const { processor, processSynchroniseResult } = setup({
            applicationReady: false,
            maxMTimeForReflectEvents,
        });

        const tooRecent = {
            ...note("too-recent"),
            mtime: maxMTimeForReflectEvents + 1,
        } as PouchDB.Core.ExistingDocument<EntryDoc>;
        processor.enqueueAll([tooRecent]);

        await vi.waitFor(() => {
            expect(processor["_queuedChanges"]).toHaveLength(0);
            expect(processor["_processingChanges"]).toHaveLength(0);
        });
        expect(processSynchroniseResult).not.toHaveBeenCalled();
    });

    it("retires active ownership when a newer remote version is observed", async () => {
        const { onCloseActiveReplication, processor } = setup();
        const versionInfo = {
            _id: VERSIONING_DOCID,
            _rev: "1-test",
            type: "versioninfo",
            version: REMOTE_FEATURE_GENERATION + 1,
        } as unknown as PouchDB.Core.ExistingDocument<EntryDoc>;

        processor.enqueueAll([versionInfo]);

        await vi.waitFor(() => expect(onCloseActiveReplication).toHaveBeenCalledOnce());
    });

    it("continues applying documents after restoring a legacy local version document", async () => {
        const { onCloseActiveReplication, processor, processSynchroniseResult } = setup({
            localVersionInfo: {
                _id: VERSIONING_DOCID,
                type: "versioninfo",
                version: 11,
            },
        });

        await processor.restoreFromSnapshotOnce();
        processor.enqueueAll([note("legacy-database-note")]);

        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());
        expect(processor.isSuspended).toBe(false);
        expect(onCloseActiveReplication).not.toHaveBeenCalled();
    });

    it("continues when a newly received feature is supported", async () => {
        const { onCloseActiveReplication, processor, processSynchroniseResult } = setup();
        const versionInfo = {
            _id: VERSIONING_DOCID,
            _rev: "2-supported",
            type: "versioninfo",
            version: REMOTE_FEATURE_GENERATION,
            used_features: [ENCRYPTED_INTERNAL_METADATA_FEATURE],
        } as PouchDB.Core.ExistingDocument<EntryDoc>;

        processor.enqueueAll([versionInfo, note("supported-update")]);

        await vi.waitFor(() => expect(processSynchroniseResult).toHaveBeenCalledOnce());
        expect(onCloseActiveReplication).not.toHaveBeenCalled();
    });

    it.each([
        ["local version 0 and remote version 1", 0, ["nfc-path-identity-v1"], true],
        ["local version 1 and remote version 0", 1, [], true],
        ["both use version 1", 1, ["nfc-path-identity-v1"], false],
        ["both use version 0", 0, [], false],
    ] as const)(
        "checks path identity compatibility for %s",
        (_description, localVersion, remoteFeatures, shouldRetire) => {
            const originalAssessment = replicationCompatibility.assessRemoteFeatureDocument;
            const assessmentSpy = vi
                .spyOn(replicationCompatibility, "assessRemoteFeatureDocument")
                .mockImplementation((document) => {
                    const assessment = originalAssessment(document);
                    if (
                        assessment.status !== "unknown-features" ||
                        assessment.identifiers.length !== 1 ||
                        assessment.identifiers[0] !== "nfc-path-identity-v1"
                    ) {
                        return assessment;
                    }
                    return { status: "supported", usedFeatures: ["nfc-path-identity-v1"] };
                });

            try {
                const { onCloseActiveReplication, processor } = setup({ pathNormalizationVersion: localVersion });
                processor.enqueueAll([
                    {
                        _id: VERSIONING_DOCID,
                        _rev: "2-path-identity",
                        type: "versioninfo",
                        version: REMOTE_FEATURE_GENERATION,
                        used_features: [...remoteFeatures],
                    } as PouchDB.Core.ExistingDocument<EntryDoc>,
                ]);

                if (shouldRetire) {
                    expect(onCloseActiveReplication).toHaveBeenCalledOnce();
                } else {
                    expect(onCloseActiveReplication).not.toHaveBeenCalled();
                }
            } finally {
                assessmentSpy.mockRestore();
            }
        }
    );

    it("keeps the existing older-generation gate for local path identity version 1", () => {
        const { onCloseActiveReplication, processor } = setup({ pathNormalizationVersion: 1 });
        processor.enqueueAll([
            {
                _id: VERSIONING_DOCID,
                _rev: "1-legacy-path-identity",
                type: "versioninfo",
                version: 11,
            } as PouchDB.Core.ExistingDocument<EntryDoc>,
        ]);

        expect(onCloseActiveReplication).not.toHaveBeenCalled();
    });

    it("reports unknown feature identifiers and requests Replicator retirement", () => {
        const logger = vi.fn();
        setGlobalLogFunction(logger);
        try {
            const { processor, onCloseActiveReplication } = setup();
            processor.enqueueAll([
                {
                    _id: VERSIONING_DOCID,
                    _rev: "1-unknown",
                    type: "versioninfo",
                    version: REMOTE_FEATURE_GENERATION,
                    used_features: ["future-format-v7"],
                } as PouchDB.Core.ExistingDocument<EntryDoc>,
            ]);
            expect(onCloseActiveReplication).toHaveBeenCalledOnce();
            expect(logger).toHaveBeenCalledWith(
                expect.stringContaining("future-format-v7"),
                LOG_LEVEL_NOTICE,
                undefined
            );
        } finally {
            setGlobalLogFunction(defaultLogger);
        }
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
