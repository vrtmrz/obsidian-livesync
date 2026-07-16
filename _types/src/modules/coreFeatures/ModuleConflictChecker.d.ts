// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 96033e1
import { AbstractModule } from "@/modules/AbstractModule.ts";
import { type FilePathWithPrefix } from "@lib/common/types";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import type { InjectableServiceHub } from "@lib/services/InjectableServices.ts";
import type { LiveSyncCore } from "@/main.ts";
export declare class ModuleConflictChecker extends AbstractModule {
    _queueConflictCheckIfOpen(file: FilePathWithPrefix): Promise<void>;
    _queueConflictCheck(file: FilePathWithPrefix): Promise<void>;
    _waitForAllConflictProcessed(): Promise<boolean>;
    conflictResolveQueue: QueueProcessor<FilePathWithPrefix, unknown>;
    conflictCheckQueue: QueueProcessor<FilePathWithPrefix, FilePathWithPrefix>;
    onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void;
}
