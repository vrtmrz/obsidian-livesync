import {
    LOG_LEVEL_NOTICE,
    type FilePath,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IConflictService, IVaultService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";

export type ConflictCheckingSettings = Pick<ObsidianLiveSyncSettings, "checkConflictOnlyOnOpen">;

export interface ConflictCheckingDependencies {
    readonly conflict: Pick<
        IConflictService,
        "getOptionalConflictCheckMethod" | "queueCheckFor" | "resolve" | "resolveByNewest"
    >;
    readonly conflictProcessQueueCount: ReactiveSource<number>;
    readonly currentSettings: () => ConflictCheckingSettings;
    readonly vault: Pick<IVaultService, "getActiveFilePath">;
    readonly log: LogFunction;
}

export interface ConflictCheckingHandlers {
    readonly queueCheckForIfOpen: (file: FilePathWithPrefix) => Promise<void>;
    readonly queueCheckFor: (file: FilePathWithPrefix) => Promise<void>;
    readonly ensureAllProcessed: () => Promise<boolean>;
}

/**
 * Create conflict-checking handlers and retain both queue processors privately.
 * The returned operations do not expose queue state to a host or consumer.
 */
export function createConflictCheckingHandlers(dependencies: ConflictCheckingDependencies): ConflictCheckingHandlers {
    const conflictResolveQueue = new QueueProcessor<FilePathWithPrefix, void>(
        async (filenames: FilePathWithPrefix[]) => {
            const filename = filenames[0];
            return await dependencies.conflict.resolve(filename);
        },
        {
            suspended: false,
            batchSize: 1,
            // No need to limit concurrency to `1` here, subsequent process will handle it,
            // and some cases do not need to be synchronised (for example, auto-merge).
            // Global concurrency is limited by the resolver with the UI.
            concurrentLimit: 10,
            delay: 0,
            keepResultUntilDownstreamConnected: false,
        }
    ).replaceEnqueueProcessor((queue, newEntity) => {
        const newQueue = [...queue].filter((entry) => entry != newEntity);
        return [...newQueue, newEntity];
    });

    const conflictCheckQueue = new QueueProcessor<FilePathWithPrefix, FilePathWithPrefix>(
        (files: FilePathWithPrefix[]) => {
            const filename = files[0];
            return Promise.resolve([filename]);
        },
        {
            suspended: false,
            batchSize: 1,
            concurrentLimit: 10,
            delay: 0,
            keepResultUntilDownstreamConnected: true,
            pipeTo: conflictResolveQueue,
            totalRemainingReactiveSource: dependencies.conflictProcessQueueCount,
        }
    );

    const queueCheckForIfOpen = async (file: FilePathWithPrefix): Promise<void> => {
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
        const optionalConflictResult = await dependencies.conflict.getOptionalConflictCheckMethod(file);
        if (optionalConflictResult == true) {
            // The conflict has been resolved by another process.
            return;
        } else if (optionalConflictResult === "newer") {
            // The conflict should be resolved by the newer entry.
            await dependencies.conflict.resolveByNewest(file);
        } else {
            conflictCheckQueue.enqueue(file);
        }
    };

    const ensureAllProcessed = (): Promise<boolean> => conflictResolveQueue.waitForAllProcessed();

    return {
        queueCheckForIfOpen,
        queueCheckFor,
        ensureAllProcessed,
    };
}
