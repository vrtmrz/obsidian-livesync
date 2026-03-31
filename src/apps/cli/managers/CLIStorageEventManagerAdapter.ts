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
import type { Stats } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";

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
 * CLI-specific status adapter (no-op — daemon uses journald for status)
 */
class CLIStatusAdapter implements IStorageEventStatusAdapter {
    updateStatus(_status: { batched: number; processing: number; totalQueued: number }): void {
        // intentional no-op
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
 * CLI-specific watch adapter using chokidar for real-time filesystem monitoring.
 */
class CLIWatchAdapter implements IStorageEventWatchAdapter {
    private _watcher: FSWatcher | undefined;

    constructor(private basePath: string, private watchEnabled: boolean = false) {}

    private _toNodeFile(filePath: string, stats: Stats | undefined): NodeFile {
        return {
            path: path.relative(this.basePath, filePath) as FilePath,
            stat: {
                ctime: stats?.ctimeMs ?? Date.now(),
                mtime: stats?.mtimeMs ?? Date.now(),
                size: stats?.size ?? 0,
                type: "file",
            },
        };
    }

    private _toNodeFileStub(filePath: string): NodeFile {
        return {
            path: path.relative(this.basePath, filePath) as FilePath,
            stat: {
                ctime: Date.now(),
                mtime: Date.now(),
                size: 0,
                type: "file",
            },
        };
    }

    private _toNodeFolder(dirPath: string): NodeFolder {
        return {
            path: path.relative(this.basePath, dirPath) as FilePath,
            isFolder: true,
        };
    }

    async beginWatch(handlers: IStorageEventWatchHandlers): Promise<void> {
        if (!this.watchEnabled) return;
        const watcher = chokidarWatch(this.basePath, {
            ignored: [
                /(^|[/\\])\./,
            ],
            ignoreInitial: true,
            persistent: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100,
            },
        });

        watcher.on("add", (filePath, stats) => {
            const nodeFile = this._toNodeFile(filePath, stats);
            handlers.onCreate(nodeFile);
        });

        watcher.on("change", (filePath, stats) => {
            const nodeFile = this._toNodeFile(filePath, stats);
            handlers.onChange(nodeFile);
        });

        watcher.on("unlink", (filePath) => {
            const nodeFile = this._toNodeFileStub(filePath);
            handlers.onDelete(nodeFile);
        });

        watcher.on("addDir", (dirPath) => {
            const nodeFolder = this._toNodeFolder(dirPath);
            handlers.onCreate(nodeFolder);
        });

        watcher.on("unlinkDir", (dirPath) => {
            const nodeFolder = this._toNodeFolder(dirPath);
            handlers.onDelete(nodeFolder);
        });

        watcher.on("error", (err) => {
            console.error("[CLIWatchAdapter] Fatal watcher error — file watching stopped:", err);
            console.error("[CLIWatchAdapter] Exiting for systemd restart.");
            void watcher.close();
            this._watcher = undefined;
            // Use exit(1) rather than SIGTERM so systemd Restart=on-failure engages.
            process.exit(1);
        });

        await new Promise<void>((resolve) => watcher.once("ready", resolve));
        this._watcher = watcher;
    }

    close(): Promise<void> {
        if (this._watcher) {
            return this._watcher.close();
        }
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

    constructor(basePath: string, watchEnabled: boolean = false) {
        this.typeGuard = new CLITypeGuardAdapter();
        this.persistence = new CLIPersistenceAdapter(basePath);
        this.watch = new CLIWatchAdapter(basePath, watchEnabled);
        this.status = new CLIStatusAdapter();
        this.converter = new CLIConverterAdapter();
    }

    close(): Promise<void> {
        return this.watch.close();
    }
}
