// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FileEventType, FilePath, UXFileInfoStub, UXInternalFileInfoStub } from "@lib/common/types";
export type FileEvent = {
    type: FileEventType;
    file: UXFileInfoStub | UXInternalFileInfoStub;
    oldPath?: string;
    cachedData?: string;
    skipBatchWait?: boolean;
    cancelled?: boolean;
};
export declare abstract class StorageEventManager {
    abstract beginWatch(): Promise<void>;
    abstract appendQueue(items: FileEvent[], ctx?: unknown): Promise<void>;
    abstract isWaiting(filename: FilePath): boolean;
    abstract waitForIdle(): Promise<void>;
    abstract restoreState(): Promise<void>;
}
