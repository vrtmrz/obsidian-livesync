export interface Rebuilder {
    $performRebuildDB(
        method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice" | "localOnlyWithChunks"
    ): Promise<void>;
    $rebuildRemote(): Promise<void>;
    $rebuildEverything(): Promise<void>;
    $fetchLocal(makeLocalChunkBeforeSync?: boolean): Promise<void>;

    scheduleRebuild(): Promise<void>;
    scheduleFetch(): Promise<void>;
    resolveAllConflictedFilesByNewerOnes(): Promise<void>;
}
