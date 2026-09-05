import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";

export type HiddenFileSyncFileSerialiser = <Result>(key: string, operation: () => Promise<Result>) => Promise<Result>;

export type HiddenFileSyncFileSerialisationDependencies = {
    serialiseFileOperation: HiddenFileSyncFileSerialiser;
};

export async function serialiseHiddenFileOperation<Result>(
    dependencies: HiddenFileSyncFileSerialisationDependencies,
    prefixedFileName: FilePathWithPrefix,
    operation: () => Promise<Result>
): Promise<Result> {
    // Compatibility question: this inherited lock uses `file-`, whereas the
    // Commonlib database writer uses `file:`. The two writers therefore do not
    // mutually exclude one another; changing the key needs concurrency tests.
    return await dependencies.serialiseFileOperation(`file-${prefixedFileName}`, operation);
}
