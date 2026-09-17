import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type LOG_LEVEL,
    type MetaEntry,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { isInternalMetadata } from "@vrtmrz/livesync-commonlib/compat/common/typeUtils";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";

import type { InternalFileInfo } from "@/common/types.ts";
import { getHiddenFileSyncComparisonMTime } from "./hiddenFileSyncState.ts";

export type HiddenFileSyncConflictPath = FilePath | FilePathWithPrefix;

export type HiddenFileSyncRevisionInfo = {
    rev: string;
    status: string;
};

export type HiddenFileSyncRevisionHistory = MetaEntry & {
    _revs_info?: HiddenFileSyncRevisionInfo[];
};

export type HiddenFileSyncJsonResolution = {
    keepRevision?: string;
    mergedText?: string;
};

export type HiddenFileSyncConflictDatabase = {
    scanConflictedEntries(): AsyncIterable<MetaEntry>;
    getDocumentId(path: HiddenFileSyncConflictPath): Promise<DocumentID>;
    loadCurrentMetadata(id: DocumentID): Promise<MetaEntry>;
    loadConflictingMetadata(id: DocumentID, revision: string): Promise<MetaEntry>;
    loadRevisionHistory(id: DocumentID): Promise<HiddenFileSyncRevisionHistory>;
    loadRevisionEntry(path: HiddenFileSyncConflictPath, revision: string): Promise<LoadedEntry | false>;
    mergeJson(
        path: FilePathWithPrefix,
        baseRevision: string,
        currentRevision: string,
        conflictedRevision: string
    ): Promise<string | false>;
    removeRevision(id: DocumentID, revision: string): Promise<unknown>;
    deleteRevision(entry: LoadedEntry): Promise<boolean>;
};

export type HiddenFileSyncConflictStorage = {
    ensureDirectory(path: FilePath): Promise<void>;
    writeFile(path: FilePath, data: string): Promise<UXStat | null>;
    triggerEvent(path: FilePath): Promise<void>;
};

export type HiddenFileSyncConflictReconciliation = {
    storeFile(file: InternalFileInfo, forceWrite?: boolean): Promise<boolean | undefined>;
    extractFile(path: FilePath): Promise<boolean | undefined>;
};

export type HiddenFileSyncConflictInteraction = {
    resolveJsonConflict(
        path: FilePath,
        docs: [LoadedEntry, LoadedEntry],
        apply: (resolution: HiddenFileSyncJsonResolution) => Promise<boolean>
    ): Promise<boolean>;
};

/** Read-only queue counters retained for the real-Obsidian contract tests. */
export type HiddenFileSyncConflictProcessorTestingView = {
    readonly remaining: number;
    readonly totalRemaining: number;
    readonly nowProcessing: number;
};

/** Focused conflict operations exposed through the Hidden File Sync test view. */
export interface HiddenFileSyncConflictTestingView {
    resolveAll(): Promise<void>;
    resolveJson(docA: LoadedEntry, docB: LoadedEntry): Promise<boolean>;
    readonly pendingPaths: readonly HiddenFileSyncConflictPath[];
    readonly processor: HiddenFileSyncConflictProcessorTestingView;
}

export type HiddenFileSyncConflictResolutionDependencies = {
    database: HiddenFileSyncConflictDatabase;
    storage: HiddenFileSyncConflictStorage;
    reconciliation: HiddenFileSyncConflictReconciliation;
    interaction: HiddenFileSyncConflictInteraction;
    shouldOverwrite(path: FilePath): boolean;
    log: LogFunction;
};

export interface HiddenFileSyncConflictResolution {
    queue(path: HiddenFileSyncConflictPath): void;
    resolveAll(): Promise<void>;
    resolveJson(docA: LoadedEntry, docB: LoadedEntry): Promise<boolean>;
    dispose(): void;
    readonly testing: HiddenFileSyncConflictTestingView;
}

type PendingJsonConflict = {
    id: DocumentID;
    doc: MetaEntry;
    path: HiddenFileSyncConflictPath;
    revA: string;
    revB: string;
};

export function selectHiddenFileSyncRevisionToDelete(
    currentDoc: MetaEntry,
    currentRevision: string,
    conflictedDoc: MetaEntry,
    conflictedRevision: string
): string {
    const currentMTime = getHiddenFileSyncComparisonMTime(currentDoc, true);
    const conflictedMTime = getHiddenFileSyncComparisonMTime(conflictedDoc, true);
    // Compatibility: an equal mtime keeps the current leaf and deletes the
    // conflicted leaf. A different tie-breaker would alter existing winners.
    return currentMTime < conflictedMTime ? currentRevision : conflictedRevision;
}

export function findHiddenFileSyncMergeBase(
    revisions: readonly HiddenFileSyncRevisionInfo[] | undefined,
    conflictedRevision: string
): string {
    const conflictedGeneration = Number(conflictedRevision.split("-")[0]);
    // Compatibility question: this is the first available lower generation
    // from the current branch, not a proven nearest shared ancestor. Changing
    // it requires a separate conflict-history decision.
    return (
        revisions?.find(({ rev, status }) => status == "available" && Number(rev.split("-")[0]) < conflictedGeneration)
            ?.rev ?? ""
    );
}

class HiddenFileSyncConflictResolutionOwner implements HiddenFileSyncConflictResolution {
    private readonly pendingPaths = new Set<HiddenFileSyncConflictPath>();
    private readonly processor: QueueProcessor<HiddenFileSyncConflictPath, PendingJsonConflict>;
    private disposed = false;
    readonly testing: HiddenFileSyncConflictTestingView;

    constructor(private readonly dependencies: HiddenFileSyncConflictResolutionDependencies) {
        const interactionProcessor = new QueueProcessor<PendingJsonConflict, void>(
            async (results) => {
                const { id, doc, path, revA, revB } = results[0];
                // Compatibility question: these reads intentionally remain
                // outside the catch below. A rejected read can leave the path
                // pending until another lifecycle event reconstructs the owner.
                const docAMerge = await this.dependencies.database.loadRevisionEntry(path, revA);
                const docBMerge = await this.dependencies.database.loadRevisionEntry(path, revB);
                try {
                    if (docAMerge != false && docBMerge != false) {
                        if (await this.resolveJson(docAMerge, docBMerge)) {
                            this.requeue(path);
                        } else {
                            this.finish(path);
                        }
                        return;
                    }
                    await this.resolveByNewerEntry(id, path, doc, revA, revB);
                } catch (error) {
                    this.finish(path);
                    throw error;
                }
            },
            {
                suspended: false,
                batchSize: 1,
                concurrentLimit: 1,
                delay: 10,
                keepResultUntilDownstreamConnected: false,
                yieldThreshold: 10,
            }
        );
        this.processor = new QueueProcessor<HiddenFileSyncConflictPath, PendingJsonConflict>(
            async (paths) => await this.processPath(paths[0]),
            {
                suspended: false,
                batchSize: 1,
                concurrentLimit: 5,
                delay: 10,
                keepResultUntilDownstreamConnected: true,
                yieldThreshold: 10,
                pipeTo: interactionProcessor,
            }
        );
        const pendingPaths = () => [...this.pendingPaths];
        const processor = this.processor;
        const processorView = Object.freeze({
            get remaining() {
                return processor.remaining;
            },
            get totalRemaining() {
                return processor.totalRemaining;
            },
            get nowProcessing() {
                return processor.nowProcessing;
            },
        });
        this.testing = Object.freeze({
            resolveAll: async () => await this.resolveAll(),
            resolveJson: async (docA: LoadedEntry, docB: LoadedEntry) => await this.resolveJson(docA, docB),
            get pendingPaths() {
                return pendingPaths();
            },
            processor: processorView,
        });
    }

    queue(path: HiddenFileSyncConflictPath): void {
        if (this.disposed) return;
        // Compatibility: this deliberately deduplicates exact strings only.
        // Prefixed and unprefixed forms of one path can therefore coexist.
        if (this.pendingPaths.has(path)) return;
        this.pendingPaths.add(path);
        // Compatibility question: if QueueProcessor throws during this
        // synchronous admission, the pending marker is retained. No current
        // caller expects enqueue to throw.
        this.processor.enqueue(path);
    }

    async resolveAll(): Promise<void> {
        // Creating the iterator and awaiting the completed pipeline remain
        // outside the catch. Only iteration failures are logged and swallowed
        // by this operation.
        const conflicted = this.dependencies.database.scanConflictedEntries();
        // Do not suspend ordinary conflict admission during the scan.
        // QueueProcessor v2 can lose its resume event when scan completion
        // races with the suspended pump, leaving every admitted path pending.
        try {
            for await (const doc of conflicted) {
                if (!("_conflicts" in doc)) continue;
                if (isInternalMetadata(doc._id)) {
                    this.queue(doc.path);
                }
            }
        } catch (error) {
            this.log("something went wrong on resolving all conflicted internal files");
            this.log(error, LOG_LEVEL_VERBOSE);
        }
        await this.processor.waitForAllProcessed();
    }

    async resolveJson(docA: LoadedEntry, docB: LoadedEntry): Promise<boolean> {
        this.log("Opening data-merging dialog", LOG_LEVEL_VERBOSE);
        const docs: [LoadedEntry, LoadedEntry] = [docA, docB];
        const storageFilePath = stripAllPrefixes(docA.path);
        const displayFilename = `${storageFilePath}`;
        return await this.dependencies.interaction.resolveJsonConflict(
            storageFilePath,
            docs,
            async ({ keepRevision: keep, mergedText: result }) => {
                try {
                    let needFlush = false;
                    if (!result && !keep) {
                        this.log(`Skipped merging: ${displayFilename}`);
                        return false;
                    }
                    // Compatibility question: the selected revision is not
                    // validated against these two documents. An unknown value
                    // consequently deletes both revisions without writing a
                    // merged result. The sequential effects are also not
                    // transactional, so an earlier deletion survives a later
                    // failure.
                    for (const doc of docs) {
                        if (doc._rev != keep) {
                            if (await this.dependencies.database.deleteRevision(doc)) {
                                this.log(`Conflicted revision has been deleted: ${displayFilename}`);
                                needFlush = true;
                            }
                        }
                    }
                    if (!keep && result) {
                        await this.dependencies.storage.ensureDirectory(storageFilePath);
                        const stat = await this.dependencies.storage.writeFile(storageFilePath, result);
                        if (!stat) {
                            throw new Error("Stat failed");
                        }
                        const mtime = getHiddenFileSyncComparisonMTime(stat);
                        // Compatibility: interactive merged text forces the
                        // database write, whereas automatic merge below uses
                        // the writer's default admission policy.
                        await this.dependencies.reconciliation.storeFile(
                            {
                                path: storageFilePath,
                                mtime,
                                ctime: stat.ctime ?? mtime,
                                size: stat.size ?? 0,
                            },
                            true
                        );
                        await this.dependencies.storage.triggerEvent(storageFilePath);
                        this.log(`STORAGE <-- DB:${displayFilename}: written (hidden,merged)`);
                    }
                    if (needFlush) {
                        if (await this.dependencies.reconciliation.extractFile(storageFilePath)) {
                            this.log(`STORAGE --> DB:${displayFilename}: extracted (hidden,merged)`);
                        } else {
                            this.log(`STORAGE --> DB:${displayFilename}: extracted (hidden,merged) Failed`);
                        }
                    }
                    return true;
                } catch (error) {
                    this.log("Could not merge conflicted json");
                    this.log(error, LOG_LEVEL_VERBOSE);
                    return false;
                }
            }
        );
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        // QueueProcessor termination cascades downstream, but cannot cancel an
        // already-running database operation or dialogue callback.
        this.processor.terminate();
        this.pendingPaths.clear();
    }

    private async processPath(path: HiddenFileSyncConflictPath): Promise<PendingJsonConflict[]> {
        try {
            const id = await this.dependencies.database.getDocumentId(path);
            const doc = await this.dependencies.database.loadCurrentMetadata(id);
            if (doc._conflicts === undefined || doc._conflicts.length == 0) {
                this.finish(path);
                return [];
            }
            this.log(`Hidden file conflicted:${path}`);
            // Compatibility: sorting mutates the loaded Metadata object before
            // it is forwarded to the manual-resolution stage.
            const conflicts = doc._conflicts.sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
            const revA = doc._rev!;
            const revB = conflicts[0];

            if (path.endsWith(".json")) {
                const revisionHistory = await this.dependencies.database.loadRevisionHistory(id);
                const commonBase = findHiddenFileSyncMergeBase(revisionHistory._revs_info, revB);
                const result = await this.dependencies.database.mergeJson(doc.path, commonBase, revA, revB);
                if (result) {
                    this.log(`Object merge:${path}`, LOG_LEVEL_INFO);
                    const filename = stripAllPrefixes(path);
                    await this.dependencies.storage.ensureDirectory(filename);
                    const stat = await this.dependencies.storage.writeFile(filename, result);
                    if (!stat) {
                        throw new Error(`HiddenFileSyncConflictResolution: Failed to stat file ${filename}`);
                    }
                    await this.dependencies.reconciliation.storeFile({ path: filename, ...stat });
                    // Compatibility question: extraction is attempted before
                    // the conflicted branch is removed, so its conflict guard
                    // normally refuses it. Requeueing eventually reflects the
                    // winner; changing the order needs a separate decision.
                    await this.dependencies.reconciliation.extractFile(filename);
                    await this.dependencies.database.removeRevision(id, revB);
                    this.requeue(path);
                    return [];
                }
                this.log(`Object merge is not applicable.`, LOG_LEVEL_VERBOSE);
                if (this.dependencies.shouldOverwrite(stripAllPrefixes(path))) {
                    this.log(`Overwrite rule applied for conflicted hidden file: ${path}`, LOG_LEVEL_INFO);
                    await this.resolveByNewerEntry(id, path, doc, revA, revB);
                    return [];
                }
                return [{ path, revA, revB, id, doc }];
            }
            await this.resolveByNewerEntry(id, path, doc, revA, revB);
            return [];
        } catch (error) {
            this.finish(path);
            this.log(`Failed to resolve conflict (Hidden): ${path}`);
            this.log(error, LOG_LEVEL_VERBOSE);
            return [];
        }
    }

    private async resolveByNewerEntry(
        id: DocumentID,
        path: HiddenFileSyncConflictPath,
        currentDoc: MetaEntry,
        currentRevision: string,
        conflictedRevision: string
    ): Promise<void> {
        const conflictedDoc = await this.dependencies.database.loadConflictingMetadata(id, conflictedRevision);
        const revisionToDelete = selectHiddenFileSyncRevisionToDelete(
            currentDoc,
            currentRevision,
            conflictedDoc,
            conflictedRevision
        );
        // Compatibility: the database result is ignored. The following conflict
        // read, rather than the deletion response, decides settlement.
        await this.dependencies.database.removeRevision(id, revisionToDelete);
        this.log(`Older one has been deleted:${path}`);
        const current = await this.dependencies.database.loadCurrentMetadata(id);
        if (current._conflicts?.length === 0) {
            await this.dependencies.reconciliation.extractFile(stripAllPrefixes(path));
            this.finish(path);
        } else {
            // Compatibility: an absent _conflicts field is not considered
            // settled here, although the main path treats it as conflict-free.
            this.requeue(path);
        }
    }

    private finish(path: HiddenFileSyncConflictPath): void {
        this.pendingPaths.delete(path);
    }

    private requeue(path: HiddenFileSyncConflictPath): void {
        this.finish(path);
        this.queue(path);
    }

    private log(message: unknown, level?: LOG_LEVEL, key?: string): void {
        this.dependencies.log(message, level, key);
    }
}

export function createHiddenFileSyncConflictResolution(
    dependencies: HiddenFileSyncConflictResolutionDependencies
): HiddenFileSyncConflictResolution {
    return new HiddenFileSyncConflictResolutionOwner(dependencies);
}
