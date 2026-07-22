import { describe, expect, it, vi } from "vitest";
import type { SimpleStore } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { FileReflectionProvenanceRecord } from "@vrtmrz/livesync-commonlib/compat/interfaces/FileReflectionProvenance";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    createFileReflectionProvenance,
    FILE_REFLECTION_PROVENANCE_STORE,
} from "./FileReflectionProvenance";

describe("createFileReflectionProvenance", () => {
    it("uses one reset-scoped host store for exact reflected revisions", async () => {
        const values = new Map<string, FileReflectionProvenanceRecord>();
        const store = {
            get: vi.fn(async (key: string) => values.get(key)),
            set: vi.fn(async (key: string, value: FileReflectionProvenanceRecord) => {
                values.set(key, value);
            }),
            delete: vi.fn(async (key: string) => {
                values.delete(key);
            }),
            keys: vi.fn(async () => [...values.keys()]),
            db: undefined,
        } as unknown as SimpleStore<FileReflectionProvenanceRecord>;
        const openSimpleStore = vi.fn().mockReturnValue(store);
        const path = "note.md" as FilePathWithPrefix;

        const provenance = createFileReflectionProvenance({ openSimpleStore });
        expect(openSimpleStore).toHaveBeenCalledWith(FILE_REFLECTION_PROVENANCE_STORE);
        await provenance.set(path, { revision: "3-displayed", observedStorageMtime: 123.456 });

        expect(openSimpleStore).toHaveBeenCalledTimes(1);
        await expect(provenance.get(path)).resolves.toEqual({
            revision: "3-displayed",
            observedStorageMtime: 123.456,
        });
    });
});
