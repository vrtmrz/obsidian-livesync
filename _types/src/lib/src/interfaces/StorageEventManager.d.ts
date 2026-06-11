import type { FileEventType, UXFileInfoStub, UXInternalFileInfoStub } from "@lib/common/models/fileaccess.type";
import type { FilePath } from "@lib/common/models/db.type";
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
