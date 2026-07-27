import {
    StoredFileReflectionProvenance,
    type FileReflectionProvenanceRecord,
} from "@vrtmrz/livesync-commonlib/compat/interfaces/FileReflectionProvenance";
import type { SimpleStore } from "@vrtmrz/livesync-commonlib/compat/common/utils";

export const FILE_REFLECTION_PROVENANCE_STORE = "file-reflection-provenance-v1";

export type FileReflectionProvenanceStoreFactory = {
    openSimpleStore<T>(kind: string): SimpleStore<T>;
};

/**
 * Create the device-local record which links a Vault file to the exact
 * database revision most recently reflected in that Vault.
 *
 * This runs during service composition, before KeyValueDB is opened. The
 * returned namespaced handle is inert until its first operation; normal hosts
 * complete the sequential onSettingLoaded lifecycle before Vault scanning,
 * watching, or replication can invoke it. Operations are never held waiting for
 * readiness; they fail on a lifecycle violation and may fail during reset.
 */
export function createFileReflectionProvenance(keyValueDB: FileReflectionProvenanceStoreFactory) {
    return new StoredFileReflectionProvenance(
        keyValueDB.openSimpleStore<FileReflectionProvenanceRecord>(FILE_REFLECTION_PROVENANCE_STORE)
    );
}
