import { describe, expect, it, vi } from "vitest";
import type { EntryDoc } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";

describe("ReplicateResultProcessor target-filter reprocessing", () => {
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
});
