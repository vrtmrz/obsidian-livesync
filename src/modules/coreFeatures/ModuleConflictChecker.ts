import { AbstractModule } from "../AbstractModule.ts";
import { LOG_LEVEL_NOTICE, type FilePathWithPrefix } from "../../lib/src/common/types";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import { sendValue } from "octagonal-wheels/messagepassing/signal";
import type { InjectableServiceHub } from "../../lib/src/services/InjectableServices.ts";
import type { LiveSyncCore } from "../../main.ts";

export class ModuleConflictChecker extends AbstractModule {
    async _queueConflictCheckIfOpen(file: FilePathWithPrefix): Promise<void> {
        const path = file;
        if (this.settings.checkConflictOnlyOnOpen) {
            const af = this.services.vault.getActiveFilePath();
            if (af && af != path) {
                this._log(`${file} is conflicted, merging process has been postponed.`, LOG_LEVEL_NOTICE);
                return;
            }
        }
        await this.services.conflict.queueCheckFor(path);
    }

    async _queueConflictCheck(file: FilePathWithPrefix): Promise<void> {
        const optionalConflictResult = await this.services.conflict.getOptionalConflictCheckMethod(file);
        if (optionalConflictResult == true) {
            // The conflict has been resolved by another process.
            return;
        } else if (optionalConflictResult === "newer") {
            // The conflict should be resolved by the newer entry.
            await this.services.conflict.resolveByNewest(file);
        } else {
            this.conflictCheckQueue.enqueue(file);
        }
    }

    _waitForAllConflictProcessed(): Promise<boolean> {
        return this.conflictResolveQueue.waitForAllProcessed();
    }

    // TODO-> Move to ModuleConflictResolver?
    conflictResolveQueue = new QueueProcessor(
        async (filenames: FilePathWithPrefix[]) => {
            const filename = filenames[0];
            return await this.services.conflict.resolve(filename);
        },
        {
            suspended: false,
            batchSize: 1,
            // No need to limit concurrency to `1` here, subsequent process will handle it,
            // And, some cases, we do not need to synchronised. (e.g., auto-merge available).
            // Therefore, limiting global concurrency is performed on resolver with the UI.
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

    conflictCheckQueue = // First process - Check is the file actually need resolve -
        new QueueProcessor(
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
                pipeTo: this.conflictResolveQueue,
                totalRemainingReactiveSource: this.core.conflictProcessQueueCount,
            }
        );
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void {
        services.conflict.queueCheckForIfOpen.setHandler(this._queueConflictCheckIfOpen.bind(this));
        services.conflict.queueCheckFor.setHandler(this._queueConflictCheck.bind(this));
        services.conflict.ensureAllProcessed.setHandler(this._waitForAllConflictProcessed.bind(this));
    }
}
