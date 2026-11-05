import {
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IConflictService, IVaultService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive";
import { createConflictCheckQueue } from "@vrtmrz/livesync-commonlib/conflicts";

export type ConflictCheckingSettings = Pick<ObsidianLiveSyncSettings, "checkConflictOnlyOnOpen">;

export interface ConflictCheckingDependencies {
    readonly conflict: Pick<
        IConflictService,
        "getOptionalConflictCheckMethod" | "queueCheckFor" | "resolve" | "resolveByNewest"
    >;
    readonly signal: AbortSignal;
    readonly conflictProcessQueueCount: ReactiveSource<number>;
    readonly cancelActiveResolution: (filename: FilePathWithPrefix) => void;
    readonly currentSettings: () => ConflictCheckingSettings;
    readonly vault: Pick<IVaultService, "getActiveFilePath">;
    readonly log: LogFunction;
}

export interface ConflictCheckingHandlers {
    readonly queueCheckForIfOpen: (file: FilePathWithPrefix) => Promise<void>;
    readonly queueCheckFor: (file: FilePathWithPrefix) => Promise<void>;
    /** Wait for active checks; false means the queue was cancelled during shutdown. */
    readonly ensureAllProcessed: () => Promise<boolean>;
}

/** Create conflict-checking handlers while retaining scheduling state privately. */
export function createConflictCheckingHandlers(dependencies: ConflictCheckingDependencies): ConflictCheckingHandlers {
    const conflictQueue = createConflictCheckQueue({
        async process(filename) {
            try {
                await dependencies.conflict.resolve(filename);
            } catch (error) {
                dependencies.log(`Conflict check failed: ${filename}`);
                dependencies.log(error, LOG_LEVEL_VERBOSE);
            }
        },
        // The resolver serialises shared user interactions; independent checks
        // and automatic merges can use the remaining execution slots.
        concurrency: 10,
        onProgress(remaining) {
            // Accepted checks still update their accounting as they settle.
            dependencies.conflictProcessQueueCount.value = remaining;
        },
    });

    const queueCheckForIfOpen = async (file: FilePathWithPrefix): Promise<void> => {
        if (dependencies.signal.aborted) return;
        const path = file;
        if (dependencies.currentSettings().checkConflictOnlyOnOpen) {
            const activeFile: FilePath | undefined = dependencies.vault.getActiveFilePath();
            if (activeFile && activeFile != path) {
                dependencies.log(`${file} is conflicted, merging process has been postponed.`, LOG_LEVEL_NOTICE);
                return;
            }
        }
        await dependencies.conflict.queueCheckFor(path);
    };

    const queueCheckFor = async (file: FilePathWithPrefix): Promise<void> => {
        if (dependencies.signal.aborted) return;
        const optionalConflictResult = await dependencies.conflict.getOptionalConflictCheckMethod(file);
        if (dependencies.signal.aborted) return;
        if (optionalConflictResult == true) {
            // The conflict has been resolved by another process.
            return;
        } else if (optionalConflictResult === "newer") {
            // The conflict should be resolved by the newer entry.
            await dependencies.conflict.resolveByNewest(file);
        } else {
            // The next batch waits for active checks to settle. Cancel the
            // older same-file resolution now so its dialogue cannot hold the
            // replacement behind that wait.
            dependencies.cancelActiveResolution(file);
            conflictQueue.enqueue(file);
        }
    };

    const ensureAllProcessed = (): Promise<boolean> => conflictQueue.waitForIdle();
    const abortQueue = (): void => {
        // Shutdown keeps its existing database-close order. Observe cleanup
        // without making the lifecycle wait for an active resolver.
        void conflictQueue.abort().catch((error) => dependencies.log(error, LOG_LEVEL_VERBOSE));
    };
    if (dependencies.signal.aborted) {
        abortQueue();
    } else {
        dependencies.signal.addEventListener("abort", abortQueue, { once: true });
    }

    return {
        queueCheckForIfOpen,
        queueCheckFor,
        ensureAllProcessed,
    };
}
