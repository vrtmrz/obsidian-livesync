import { AbstractModule } from "../AbstractModule.ts";
import { LOG_LEVEL_NOTICE, type FilePathWithPrefix } from "../../lib/src/common/types";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import { sendValue } from "octagonal-wheels/messagepassing/signal";
import type { ICoreModule } from "../ModuleTypes.ts";

export class ModuleConflictChecker extends AbstractModule implements ICoreModule {
    async $$queueConflictCheckIfOpen(file: FilePathWithPrefix): Promise<void> {
        const path = file;
        if (this.settings.checkConflictOnlyOnOpen) {
            const af = this.core.$$getActiveFilePath();
            if (af && af != path) {
                this._log(`${file} is conflicted, merging process has been postponed.`, LOG_LEVEL_NOTICE);
                return;
            }
        }
        await this.core.$$queueConflictCheck(path);
    }

    async $$queueConflictCheck(file: FilePathWithPrefix): Promise<void> {
        const optionalConflictResult = await this.core.$anyGetOptionalConflictCheckMethod(file);
        if (optionalConflictResult == true) {
            // The conflict has been resolved by another process.
            return;
        } else if (optionalConflictResult === "newer") {
            // The conflict should be resolved by the newer entry.
            await this.core.$anyResolveConflictByNewest(file);
        } else {
            this.conflictCheckQueue.enqueue(file);
        }
    }

    $$waitForAllConflictProcessed(): Promise<boolean> {
        return this.conflictResolveQueue.waitForAllProcessed();
    }

    // TODO-> Move to ModuleConflictResolver?
    conflictResolveQueue = new QueueProcessor(
        async (filenames: FilePathWithPrefix[]) => {
            await this.core.$$resolveConflict(filenames[0]);
        },
        {
            suspended: false,
            batchSize: 1,
            concurrentLimit: 1,
            delay: 10,
            keepResultUntilDownstreamConnected: false,
        }
    ).replaceEnqueueProcessor((queue, newEntity) => {
        const filename = newEntity;
        sendValue("cancel-resolve-conflict:" + filename, true);
        const newQueue = [...queue].filter((e) => e != newEntity);
        return [...newQueue, newEntity];
    });

    conflictCheckQueue = // First process - Check is the file actually need resolve -
        new QueueProcessor(
            (files: FilePathWithPrefix[]) => {
                const filename = files[0];
                // const file = await this.core.storageAccess.isExists(filename);
                // if (!file) return [];
                // if (!(file instanceof TFile)) return;
                // if ((file instanceof TFolder)) return [];
                // Check again?
                return Promise.resolve([filename]);
                // this.conflictResolveQueue.enqueueWithKey(filename, { filename, file });
            },
            {
                suspended: false,
                batchSize: 1,
                concurrentLimit: 5,
                delay: 10,
                keepResultUntilDownstreamConnected: true,
                pipeTo: this.conflictResolveQueue,
                totalRemainingReactiveSource: this.core.conflictProcessQueueCount,
            }
        );
}
