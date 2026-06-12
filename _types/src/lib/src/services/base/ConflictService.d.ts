import type { FilePathWithPrefix } from "@lib/common/models/db.type";
import type { MISSING_OR_ERROR, AUTO_MERGED } from "@lib/common/models/shared.const.symbols";
import type { IConflictService } from "./IService";
import { ServiceBase } from "./ServiceBase";
import type { ServiceContext } from "./ServiceBase";
/**
 * The ConflictService provides methods for handling file conflicts.
 */
export declare abstract class ConflictService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IConflictService {
    /**
     * Get an optional conflict check method for a given file (virtual) path.
     */
    readonly getOptionalConflictCheckMethod: import("@lib/services/lib/HandlerUtils").MultipleHandlerFunction<(path: FilePathWithPrefix) => Promise<boolean | undefined | "newer">, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    /**
     * Queue a check for conflicts if the file is currently open in the editor.
     * @param path The file (virtual) path to check for conflicts.
     */
    abstract queueCheckForIfOpen(path: FilePathWithPrefix): Promise<void>;
    /**
     * Queue a check for conflicts for a given file (virtual) path.
     * @param path The file (virtual) path to check for conflicts.
     */
    abstract queueCheckFor(path: FilePathWithPrefix): Promise<void>;
    /**
     * Ensure all queued file conflict checks are processed.
     */
    abstract ensureAllProcessed(): Promise<boolean>;
    /**
     * Resolve a conflict by user interaction (e.g., showing a modal dialog).
     * @param filename The file (virtual) path with conflict.
     * @param conflictCheckResult The result of the conflict check.
     * @returns A promise that resolves to true if the conflict was resolved, false if not, or undefined if no action was taken.
     */
    readonly resolveByUserInteraction: import("@lib/services/lib/HandlerUtils").MultipleHandlerFunction<(filename: FilePathWithPrefix, conflictCheckResult: import("../../common/types").diff_result) => Promise<boolean | undefined>, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    /**
     * Resolve a conflict by deleting a specific revision.
     * @param path The file (virtual) path with conflict.
     * @param deleteRevision The revision to delete.
     * @param title The title of the conflict (for user display).
     */
    abstract resolveByDeletingRevision(path: FilePathWithPrefix, deleteRevision: string, title: string): Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED>;
    /**
     * Resolve a conflict as several possible strategies.
     * It may involve user interaction (means raising resolveByUserInteraction).
     * @param filename The file (virtual) path to resolve.
     */
    abstract resolve(filename: FilePathWithPrefix): Promise<void>;
    /**
     *  Resolve a conflict by choosing the newest version.
     * @param filename The file (virtual) path to resolve.
     */
    abstract resolveByNewest(filename: FilePathWithPrefix): Promise<boolean>;
    abstract resolveAllConflictedFilesByNewerOnes(): Promise<void>;
    conflictProcessQueueCount: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
}
