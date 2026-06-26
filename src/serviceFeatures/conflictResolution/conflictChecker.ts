import { LOG_LEVEL_NOTICE, type FilePathWithPrefix } from "@lib/common/types";
import { Logger } from "octagonal-wheels/common/logger";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import { sendValue } from "octagonal-wheels/messagepassing/signal";
import type { NecessaryObsidianFeature } from "@/types";

export type ConflictCheckerHost = NecessaryObsidianFeature<"conflict" | "vault" | "setting">;

export const queueConflictCheckIfOpenHandler = async (
    host: ConflictCheckerHost,
    file: FilePathWithPrefix
): Promise<void> => {
    const path = file;
    if (host.services.setting.settings.checkConflictOnlyOnOpen) {
        const af = host.services.vault.getActiveFilePath();
        if (af && af != path) {
            Logger(`${file} is conflicted, merging process has been postponed.`, LOG_LEVEL_NOTICE);
            return;
        }
    }
    await host.services.conflict.queueCheckFor(path);
};

export const queueConflictCheckHandler = async (
    host: ConflictCheckerHost,
    queue: QueueProcessor<FilePathWithPrefix, any>,
    file: FilePathWithPrefix
): Promise<void> => {
    const optionalConflictResult = await host.services.conflict.getOptionalConflictCheckMethod(file);
    if (optionalConflictResult == true) {
        // The conflict has been resolved by another process.
        return;
    } else if (optionalConflictResult === "newer") {
        // The conflict should be resolved by the newer entry.
        await host.services.conflict.resolveByNewest(file);
    } else {
        queue.enqueue(file);
    }
};

export function useConflictChecker(host: ConflictCheckerHost) {
    const { services } = host;

    const conflictResolveQueue = new QueueProcessor(
        async (filenames: FilePathWithPrefix[]) => {
            const filename = filenames[0];
            return await services.conflict.resolve(filename);
        },
        {
            suspended: false,
            batchSize: 1,
            concurrentLimit: 10,
            delay: 0,
            keepResultUntilDownstreamConnected: false,
        }
    ).replaceEnqueueProcessor((queue, newEntity) => {
        const filename = newEntity;
        sendValue("cancel-resolve-conflict:" + filename, true);
        const newQueue = [...queue].filter((e) => e != newEntity);
        return [...newQueue, newEntity];
    });

    const conflictCheckQueue = new QueueProcessor(
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
            totalRemainingReactiveSource: services.conflict.conflictProcessQueueCount,
        }
    );

    services.conflict.queueCheckForIfOpen.setHandler(queueConflictCheckIfOpenHandler.bind(null, host));
    services.conflict.queueCheckFor.setHandler(queueConflictCheckHandler.bind(null, host, conflictCheckQueue));
    services.conflict.ensureAllProcessed.setHandler(() => conflictResolveQueue.waitForAllProcessed());

    return {
        conflictCheckQueue,
        conflictResolveQueue,
    };
}
