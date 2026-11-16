import { UnicodeResolvingNodeStorageAdapter } from "@vrtmrz/livesync-commonlib/node";
import type { UXDataWriteOptions } from "@vrtmrz/livesync-commonlib/compat/common/types";

/** Ends the invalidation fence even if the filesystem operation fails partially. */
export type StorageMutationCompletion = () => void;
/** Begin observation before I/O and optionally return its matching completion callback. */
export type StorageMutationInvalidator = (paths: readonly string[]) => StorageMutationCompletion | void;

/** Adds inventory invalidation around the shared CLI storage mutation boundary. */
export class ObservedNodeStorageAdapter extends UnicodeResolvingNodeStorageAdapter {
    constructor(
        basePath: string,
        getPathNormalizationVersion: () => number = () => 0,
        isCaseInsensitive: () => boolean = () => false,
        private readonly onMutation?: StorageMutationInvalidator
    ) {
        super(basePath, getPathNormalizationVersion, isCaseInsensitive);
    }

    private async runMutation<T>(paths: readonly string[], operation: () => Promise<T>): Promise<T> {
        // Capture one completion for this operation. Nested storage methods can
        // create their own tokens; the source waits for all tokens in its boundary.
        let complete: StorageMutationCompletion | void;
        try {
            complete = this.onMutation?.(paths);
        } catch {
            // A failed observation hook must not suppress the requested filesystem I/O.
            complete = undefined;
        }

        try {
            return await operation();
        } finally {
            // Failed I/O may still have changed names, so completion always runs.
            try {
                complete?.();
            } catch {
                // Inventory bookkeeping must not change the storage operation's result.
            }
        }
    }

    override async write(
        path: string,
        data: string,
        options?: UXDataWriteOptions,
        caseInsensitive?: boolean
    ): Promise<void> {
        return await this.runMutation([path], async () => await super.write(path, data, options, caseInsensitive));
    }

    override async writeBinary(
        path: string,
        data: ArrayBuffer,
        options?: UXDataWriteOptions,
        caseInsensitive?: boolean
    ): Promise<void> {
        return await this.runMutation(
            [path],
            async () => await super.writeBinary(path, data, options, caseInsensitive)
        );
    }

    override async append(
        path: string,
        data: string,
        options?: UXDataWriteOptions,
        caseInsensitive?: boolean
    ): Promise<void> {
        return await this.runMutation([path], async () => await super.append(path, data, options, caseInsensitive));
    }

    override async mkdir(path: string, caseInsensitive?: boolean): Promise<void> {
        return await this.runMutation([path], async () => await super.mkdir(path, caseInsensitive));
    }

    override async remove(path: string, caseInsensitive?: boolean): Promise<void> {
        return await this.runMutation([path], async () => await super.remove(path, caseInsensitive));
    }

    override async rename(sourcePath: string, targetPath: string, caseInsensitive?: boolean): Promise<void> {
        return await this.runMutation(
            [sourcePath, targetPath],
            async () => await super.rename(sourcePath, targetPath, caseInsensitive)
        );
    }
}
