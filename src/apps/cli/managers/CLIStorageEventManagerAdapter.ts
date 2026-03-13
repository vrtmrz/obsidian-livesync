import type { FilePath, UXFileInfoStub, UXInternalFileInfoStub } from "@lib/common/types";
import type { FileEventItem } from "@lib/common/types";
import type { IStorageEventManagerAdapter } from "@lib/managers/adapters";
import type {
    IStorageEventTypeGuardAdapter,
    IStorageEventPersistenceAdapter,
    IStorageEventWatchAdapter,
    IStorageEventStatusAdapter,
    IStorageEventConverterAdapter,
    IStorageEventWatchHandlers,
} from "@lib/managers/adapters";
import type { FileEventItemSentinel } from "@lib/managers/StorageEventManager";
import type { NodeFile, NodeFolder } from "../adapters/NodeTypes";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * CLI-specific type guard adapter
 */
class CLITypeGuardAdapter implements IStorageEventTypeGuardAdapter<NodeFile, NodeFolder> {
    isFile(file: any): file is NodeFile {
        return file && typeof file === "object" && "path" in file && "stat" in file && !file.isFolder;
    }

    isFolder(item: any): item is NodeFolder {
        return item && typeof item === "object" && "path" in item && item.isFolder === true;
    }
}

/**
 * CLI-specific persistence adapter (file-based snapshot)
 */
class CLIPersistenceAdapter implements IStorageEventPersistenceAdapter {
    private snapshotPath: string;

    constructor(basePath: string) {
        this.snapshotPath = path.join(basePath, ".livesync-snapshot.json");
    }

    async saveSnapshot(snapshot: (FileEventItem | FileEventItemSentinel)[]): Promise<void> {
        try {
            await fs.writeFile(this.snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
        } catch (error) {
            console.error("Failed to save snapshot:", error);
        }
    }

    async loadSnapshot(): Promise<(FileEventItem | FileEventItemSentinel)[] | null> {
        try {
            const content = await fs.readFile(this.snapshotPath, "utf-8");
            return JSON.parse(content);
        } catch {
            return null;
        }
    }
}

/**
 * CLI-specific status adapter (console logging)
 */
class CLIStatusAdapter implements IStorageEventStatusAdapter {
    private lastUpdate = 0;
    private updateInterval = 5000; // Update every 5 seconds

    updateStatus(status: { batched: number; processing: number; totalQueued: number }): void {
        const now = Date.now();
        if (now - this.lastUpdate > this.updateInterval) {
            if (status.totalQueued > 0 || status.processing > 0) {
                // console.log(
                //     `[StorageEventManager] Batched: ${status.batched}, Processing: ${status.processing}, Total Queued: ${status.totalQueued}`
                // );
            }
            this.lastUpdate = now;
        }
    }
}

/**
 * CLI-specific converter adapter
 */
class CLIConverterAdapter implements IStorageEventConverterAdapter<NodeFile> {
    toFileInfo(file: NodeFile, deleted?: boolean): UXFileInfoStub {
        return {
            name: path.basename(file.path),
            path: file.path,
            stat: file.stat,
            deleted: deleted,
            isFolder: false,
        };
    }

    toInternalFileInfo(p: FilePath): UXInternalFileInfoStub {
        return {
            name: path.basename(p),
            path: p,
            isInternal: true,
            stat: undefined,
        };
    }
}

/**
 * CLI-specific watch adapter (optional file watching with chokidar)
 */
class CLIWatchAdapter implements IStorageEventWatchAdapter {
    constructor(private basePath: string) {}

    async beginWatch(handlers: IStorageEventWatchHandlers): Promise<void> {
        // File watching is not activated in the CLI.
        // Because the CLI is designed for push/pull operations, not real-time sync.
        // console.error("[CLIWatchAdapter] File watching is not enabled in CLI version");
        return Promise.resolve();
    }
}

/**
 * Composite adapter for CLI StorageEventManager
 */
export class CLIStorageEventManagerAdapter implements IStorageEventManagerAdapter<NodeFile, NodeFolder> {
    readonly typeGuard: CLITypeGuardAdapter;
    readonly persistence: CLIPersistenceAdapter;
    readonly watch: CLIWatchAdapter;
    readonly status: CLIStatusAdapter;
    readonly converter: CLIConverterAdapter;

    constructor(basePath: string) {
        this.typeGuard = new CLITypeGuardAdapter();
        this.persistence = new CLIPersistenceAdapter(basePath);
        this.watch = new CLIWatchAdapter(basePath);
        this.status = new CLIStatusAdapter();
        this.converter = new CLIConverterAdapter();
    }
}
