import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYNCINFO_ID, VER, type EntryDoc, type LoadedEntry } from "@lib/common/types";
import { createMockServiceHub } from "../mockServiceHub";
import {
    applyReplicateResultToDatabaseInternal,
    checkIsChangeRequiredForDatabaseProcessing,
    createReplicateResultProcessorState,
    enqueueReplicateResult,
    parseReplicateResultDocumentChange,
    processIfNonDocumentChange,
    restoreReplicateResultProcessorSnapshotOnce,
    takeReplicateResultProcessorSnapshot,
    useReplicateResultProcessor,
    createReplicateResultProcessorLog,
    type ReplicateResultProcessorHost,
} from "./replicateResultProcessor";

describe("ReplicateResultProcessor", () => {
    let host: ReplicateResultProcessorHost;
    const log = vi.fn();

    beforeEach(() => {
        host = createMockServiceHub() as unknown as ReplicateResultProcessorHost;
        log.mockClear();
        (host.services.replicator as any).getActiveReplicator = vi.fn();
    });

    it("creates a processor API with closure-scoped state", () => {
        const processor = useReplicateResultProcessor(host);
        expect(processor).toEqual({
            suspend: expect.any(Function),
            resume: expect.any(Function),
            enqueueAll: expect.any(Function),
            restoreFromSnapshotOnce: expect.any(Function),
        });
    });

    it("logs through the host API rather than the global logger", () => {
        const featureLog = createReplicateResultProcessorLog(host);

        featureLog("hello", 16 as any);

        expect(host.services.API.addLog).toHaveBeenCalledWith(expect.stringContaining("hello"), 16, "");
    });

    it("replaces a queued document when the new revision has the same deletion state", () => {
        const state = createReplicateResultProcessorState();
        state.triggerTakeSnapshot = vi.fn();
        const oldDoc = { _id: "note", _rev: "1-old", path: "note.md", type: "plain", deleted: false } as any;
        const newDoc = { _id: "note", _rev: "2-new", path: "note.md", type: "plain", deleted: false } as any;

        enqueueReplicateResult(host, state, log, oldDoc);
        enqueueReplicateResult(host, state, log, newDoc);

        expect(state.queuedChanges).toEqual([newDoc]);
        expect(state.triggerTakeSnapshot).toHaveBeenCalledTimes(2);
    });

    it("keeps both queued document revisions when deletion state differs", () => {
        const state = createReplicateResultProcessorState();
        state.triggerTakeSnapshot = vi.fn();
        const oldDoc = { _id: "note", _rev: "1-old", path: "note.md", type: "plain", deleted: false } as any;
        const deletedDoc = { _id: "note", _rev: "2-new", path: "note.md", type: "plain", deleted: true } as any;

        enqueueReplicateResult(host, state, log, oldDoc);
        enqueueReplicateResult(host, state, log, deletedDoc);

        expect(state.queuedChanges).toEqual([oldDoc, deletedDoc]);
    });

    it("takes and restores a processing snapshot once", async () => {
        const queued = [{ _id: "queued", _rev: "1-a", type: "plain" }] as PouchDB.Core.ExistingDocument<EntryDoc>[];
        const processing = [
            { _id: "processing", _rev: "1-b", type: "plain" },
        ] as PouchDB.Core.ExistingDocument<EntryDoc>[];
        const state = createReplicateResultProcessorState();
        state.queuedChanges = queued.slice();
        state.processingChanges = processing.slice();

        await takeReplicateResultProcessorSnapshot(host, state, log);
        expect(host.services.keyValueDB.kvDB.set).toHaveBeenCalledWith("replicationResultProcessorSnapshot", {
            queued,
            processing,
        });

        (host.services.keyValueDB.kvDB.get as any).mockResolvedValue({ queued, processing });
        const restored = createReplicateResultProcessorState();
        restored.suspended = true;
        restored.triggerTakeSnapshot = vi.fn();
        await restoreReplicateResultProcessorSnapshotOnce(host, restored, log);
        await restoreReplicateResultProcessorSnapshotOnce(host, restored, log);

        expect(host.services.keyValueDB.kvDB.get).toHaveBeenCalledTimes(1);
        expect(restored.queuedChanges.map((e) => e._id)).toEqual(["processing", "queued"]);
    });

    it("processes non-document changes directly", () => {
        const chunk = { _id: "h:chunk", _rev: "1-a" } as any;
        expect(processIfNonDocumentChange(host, log, chunk)).toBe(true);
        expect(host.services.database.localDatabase.onNewLeaf).toHaveBeenCalledWith(chunk);

        expect(processIfNonDocumentChange(host, log, { _id: SYNCINFO_ID } as any)).toBe(true);
        expect(processIfNonDocumentChange(host, log, { _id: "_design/local" } as any)).toBe(true);
    });

    it("closes active replication on an incompatible version document", () => {
        const activeReplicator = { closeReplication: vi.fn() };
        (host.services.replicator.getActiveReplicator as any).mockReturnValue(activeReplicator);

        const result = processIfNonDocumentChange(host, log, {
            _id: "version",
            type: "versioninfo",
            version: VER + 1,
        } as any);

        expect(result).toBe(true);
        expect(activeReplicator.closeReplication).toHaveBeenCalled();
    });

    it("detects whether a database change still needs processing", async () => {
        const dbDoc = { _id: "note", _rev: "2-new", path: "note.md" } as LoadedEntry;
        (host.services.database.localDatabase.getRaw as any).mockResolvedValue({
            _id: "note",
            _rev: "3-latest",
            _revs_info: [{ rev: "2-new" }],
        });

        await expect(checkIsChangeRequiredForDatabaseProcessing(host, log, dbDoc)).resolves.toBe(false);

        (host.services.database.localDatabase.getRaw as any).mockResolvedValue({
            _id: "note",
            _rev: "3-latest",
            _conflicts: ["2-conflict"],
            _revs_info: [{ rev: "2-new" }],
        });
        await expect(checkIsChangeRequiredForDatabaseProcessing(host, log, dbDoc)).resolves.toBe(true);
    });

    it("handles not-found and unexpected errors while checking database processing necessity", async () => {
        const dbDoc = { _id: "note", _rev: "2-new", path: "note.md" } as LoadedEntry;

        (host.services.database.localDatabase.getRaw as any).mockRejectedValue({ status: 404 });
        await expect(checkIsChangeRequiredForDatabaseProcessing(host, log, dbDoc)).resolves.toBe(true);

        (host.services.database.localDatabase.getRaw as any).mockRejectedValue({ status: 500 });
        await expect(checkIsChangeRequiredForDatabaseProcessing(host, log, dbDoc)).resolves.toBe(false);
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining("Failed to get existing document"),
            expect.any(Number)
        );
    });

    it("skips note parsing when the replicated file is too large", async () => {
        const state = createReplicateResultProcessorState();
        const change = {
            _id: "note",
            _rev: "1-a",
            type: "plain",
            path: "note.md",
            size: 100,
        } as any;
        state.processingChanges = [change];
        state.triggerTakeSnapshot = vi.fn();
        (host.services.vault.isFileSizeTooLarge as any).mockReturnValue(true);

        await parseReplicateResultDocumentChange(host, state, log, change);

        expect(host.services.database.localDatabase.getDBEntryFromMeta).not.toHaveBeenCalled();
        expect(state.processingChanges).toEqual([]);
        expect(state.triggerTakeSnapshot).toHaveBeenCalled();
    });

    it("lets virtual document handlers consume replicated documents", async () => {
        const state = createReplicateResultProcessorState();
        const change = {
            _id: "virtual",
            _rev: "1-a",
            type: "plain",
            path: "virtual.md",
            size: 1,
        } as any;
        (host.services.replication.processVirtualDocument as any).mockResolvedValue(true);

        await parseReplicateResultDocumentChange(host, state, log, change);

        expect(host.services.vault.isTargetFile).not.toHaveBeenCalled();
        expect(host.services.database.localDatabase.getDBEntryFromMeta).not.toHaveBeenCalled();
    });

    it("applies gathered replicated documents to storage when no optional processor handles them", async () => {
        const dbDoc = { _id: "note", _rev: "2-new", path: "note.md", type: "plain", size: 1 } as any;
        const fullDoc = { ...dbDoc, data: "hello" };
        (host.services.database.localDatabase.getRaw as any).mockResolvedValue({ _id: "note", _rev: "2-new" });
        (host.services.database.localDatabase.getDBEntryFromMeta as any).mockResolvedValue(fullDoc);
        (host.services.replication.processOptionalSynchroniseResult as any).mockResolvedValue(false);

        await applyReplicateResultToDatabaseInternal(host, log, dbDoc);

        expect(host.services.replication.processSynchroniseResult).toHaveBeenCalledWith(fullDoc);
    });

    it("skips storage application when an optional processor handles the document", async () => {
        const dbDoc = { _id: "note", _rev: "2-new", path: "note.md", type: "plain", size: 1 } as any;
        (host.services.database.localDatabase.getRaw as any).mockResolvedValue({ _id: "note", _rev: "2-new" });
        (host.services.database.localDatabase.getDBEntryFromMeta as any).mockResolvedValue({ ...dbDoc, data: "hello" });
        (host.services.replication.processOptionalSynchroniseResult as any).mockResolvedValue(true);

        await applyReplicateResultToDatabaseInternal(host, log, dbDoc);

        expect(host.services.replication.processSynchroniseResult).not.toHaveBeenCalled();
    });

    it("skips storage application for invalid replicated paths", async () => {
        const dbDoc = { _id: "note", _rev: "2-new", path: "note.md", type: "plain", size: 1 } as any;
        (host.services.database.localDatabase.getRaw as any).mockResolvedValue({ _id: "note", _rev: "2-new" });
        (host.services.database.localDatabase.getDBEntryFromMeta as any).mockResolvedValue({ ...dbDoc, data: "hello" });
        (host.services.replication.processOptionalSynchroniseResult as any).mockResolvedValue(false);
        (host.services.vault.isValidPath as any).mockReturnValue(false);

        await applyReplicateResultToDatabaseInternal(host, log, dbDoc);

        expect(host.services.replication.processSynchroniseResult).not.toHaveBeenCalled();
    });
});
