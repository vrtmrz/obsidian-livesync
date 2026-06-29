// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { IFileProcessingService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
/**
 * File processing service handles file events and processes them accordingly.
 */
export declare class FileProcessingService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IFileProcessingService {
    /**
     * Process a file event item by the registered handlers.
     */
    readonly processFileEvent: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(item: import("../../common/types").FileEventItem) => Promise<boolean>>;
    /**
     * Process a file event item optionally, if any handler is registered.
     * i.e., hidden files synchronisation or customisation sync.
     */
    readonly processOptionalFileEvent: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(path: import("../../common/types").FilePath) => Promise<boolean>>;
    /**
     * Commit any pending file events that have been queued for processing.
     */
    readonly commitPendingFileEvents: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    batched: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
    totalQueued: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
    processing: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
    totalStorageFileEventCount: number;
    onStorageFileEvent(): void;
}
