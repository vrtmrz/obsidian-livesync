import type { FilePath, UXFileInfoStub, UXInternalFileInfoStub } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { FileEventItem } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IStorageEventManagerAdapter } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import type {
    IStorageEventTypeGuardAdapter,
    IStorageEventPersistenceAdapter,
    IStorageEventWatchAdapter,
    IStorageEventStatusAdapter,
    IStorageEventConverterAdapter,
    IStorageEventWatchHandlers,
} from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import type { FileEventItemSentinel } from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import type { FSAPIFile, FSAPIFolder } from "@/apps/webapp/adapters/FSAPITypes";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { WebAppLog } from "../WebAppLog";

type FileSystemObserverRecord = {
    changedHandle?: FileSystemFileHandle | FileSystemDirectoryHandle;
    relativePathComponents?: readonly string[];
    type: "appeared" | "disappeared" | "modified" | "moved" | "unknown" | "errored";
};

type FileSystemObserverInstance = {
    observe(handle: FileSystemDirectoryHandle, options: { recursive: boolean }): Promise<void>;
    disconnect(): void;
};

type FileSystemObserverConstructor = new (
    callback: (records: readonly FileSystemObserverRecord[]) => void | Promise<void>
) => FileSystemObserverInstance;

type GlobalWithFileSystemObserver = typeof compatGlobal & {
    FileSystemObserver?: FileSystemObserverConstructor;
};

/**
 * FileSystem API-specific type guard adapter
 */
class FSAPITypeGuardAdapter implements IStorageEventTypeGuardAdapter<FSAPIFile, FSAPIFolder> {
    isFile(file: unknown): file is FSAPIFile {
        return !!(
            file &&
            typeof file === "object" &&
            "path" in file &&
            "stat" in file &&
            "handle" in file &&
            !(file as { isFolder?: boolean }).isFolder
        );
    }

    isFolder(item: unknown): item is FSAPIFolder {
        return !!(
            item &&
            typeof item === "object" &&
            "path" in item &&
            (item as { isFolder?: boolean }).isFolder === true &&
            "handle" in item
        );
    }
}

/**
 * FileSystem API-specific persistence adapter (IndexedDB-based snapshot)
 */
class FSAPIPersistenceAdapter implements IStorageEventPersistenceAdapter {
    private dbName = "livesync-webapp-snapshot";
    private storeName = "snapshots";
    private snapshotKey = "file-events";

    constructor(private readonly addLog: WebAppLog) {}

    private async openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
        });
    }

    async saveSnapshot(snapshot: (FileEventItem | FileEventItemSentinel)[]): Promise<void> {
        try {
            const db = await this.openDB();
            const transaction = db.transaction([this.storeName], "readwrite");
            const store = transaction.objectStore(this.storeName);

            await new Promise<void>((resolve, reject) => {
                const request = store.put(snapshot, this.snapshotKey);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            db.close();
        } catch (error) {
            this.addLog(`Failed to save snapshot: ${String(error)}`, LOG_LEVEL_NOTICE, "fsapi-snapshot");
        }
    }

    async loadSnapshot(): Promise<(FileEventItem | FileEventItemSentinel)[] | null> {
        try {
            const db = await this.openDB();
            const transaction = db.transaction([this.storeName], "readonly");
            const store = transaction.objectStore(this.storeName);

            const result = await new Promise<(FileEventItem | FileEventItemSentinel)[] | null>((resolve, reject) => {
                const request = store.get(this.snapshotKey);
                request.onsuccess = () =>
                    resolve((request.result as (FileEventItem | FileEventItemSentinel)[] | undefined) ?? null);
                request.onerror = () => reject(request.error);
            });

            db.close();
            return result;
        } catch {
            return null;
        }
    }
}

/**
 * FileSystem API-specific status adapter (console logging)
 */
class FSAPIStatusAdapter implements IStorageEventStatusAdapter {
    private lastUpdate = 0;
    private updateInterval = 5000; // Update every 5 seconds

    constructor(private readonly addLog: WebAppLog) {}

    updateStatus(status: { batched: number; processing: number; totalQueued: number }): void {
        const now = Date.now();
        if (now - this.lastUpdate > this.updateInterval) {
            if (status.totalQueued > 0 || status.processing > 0) {
                this.addLog(
                    `Batched: ${status.batched}, Processing: ${status.processing}, Total queued: ${status.totalQueued}`,
                    LOG_LEVEL_VERBOSE,
                    "storage-events"
                );
            }
            this.lastUpdate = now;
        }
    }
}

/**
 * FileSystem API-specific converter adapter
 */
class FSAPIConverterAdapter implements IStorageEventConverterAdapter<FSAPIFile> {
    toFileInfo(file: FSAPIFile, deleted?: boolean): UXFileInfoStub {
        const pathParts = file.path.split("/");
        const name = pathParts[pathParts.length - 1] || file.handle.name;

        return {
            name: name,
            path: file.path,
            stat: file.stat,
            deleted: deleted,
            isFolder: false,
        };
    }

    toInternalFileInfo(p: FilePath): UXInternalFileInfoStub {
        const pathParts = p.split("/");
        const name = pathParts[pathParts.length - 1] || "";

        return {
            name: name,
            path: p,
            isInternal: true,
            stat: undefined,
        };
    }
}

/**
 * FileSystem API-specific watch adapter using FileSystemObserver (Chrome only)
 */
class FSAPIWatchAdapter implements IStorageEventWatchAdapter {
    private observer: FileSystemObserverInstance | null = null;

    constructor(
        private rootHandle: FileSystemDirectoryHandle,
        private readonly addLog: WebAppLog
    ) {}

    async beginWatch(handlers: IStorageEventWatchHandlers): Promise<void> {
        // Use FileSystemObserver if available (Chrome 124+)
        const FileSystemObserver = (compatGlobal as GlobalWithFileSystemObserver).FileSystemObserver;
        if (!FileSystemObserver) {
            this.addLog("FileSystemObserver is not available; file watching is disabled", LOG_LEVEL_INFO, "fsapi-watch");
            this.addLog("Chrome 124 or later supports real-time file watching", LOG_LEVEL_INFO, "fsapi-watch");
            return Promise.resolve();
        }

        try {
            this.observer = new FileSystemObserver(async (records) => {
                for (const record of records) {
                    const changedHandle = record.changedHandle;
                    const relativePathComponents = record.relativePathComponents;
                    const type = record.type; // "appeared", "disappeared", "modified", "moved", "unknown", "errored"

                    // Build relative path
                    const relativePath = relativePathComponents ? relativePathComponents.join("/") : "";

                    // Skip .livesync directory to avoid infinite loops
                    if (relativePath.startsWith(".livesync/") || relativePath === ".livesync") {
                        continue;
                    }

                    this.addLog(`${type}: ${relativePath}`, LOG_LEVEL_VERBOSE, "filesystem-observer");

                    // Convert to our event handlers
                    try {
                        if (type === "appeared" || type === "modified") {
                            if (changedHandle && changedHandle.kind === "file") {
                                const file = await changedHandle.getFile();
                                const fileInfo = {
                                    path: relativePath,
                                    stat: {
                                        size: file.size,
                                        mtime: file.lastModified,
                                        ctime: file.lastModified,
                                        type: "file" as const,
                                    },
                                    handle: changedHandle,
                                };

                                if (type === "appeared") {
                                    handlers.onCreate(fileInfo, undefined);
                                } else {
                                    handlers.onChange(fileInfo, undefined);
                                }
                            }
                        } else if (type === "disappeared") {
                            const fileInfo = {
                                path: relativePath,
                                stat: {
                                    size: 0,
                                    mtime: Date.now(),
                                    ctime: Date.now(),
                                    type: "file" as const,
                                },
                                handle: null as unknown as FileSystemFileHandle, // No handle available for disappeared files
                            };
                            handlers.onDelete(fileInfo, undefined);
                        } else if (type === "moved") {
                            // Handle as delete + create
                            // Note: FileSystemObserver provides both old and new paths in some cases
                            // For simplicity, we'll treat it as a modification
                            if (changedHandle && changedHandle.kind === "file") {
                                const file = await changedHandle.getFile();
                                const fileInfo = {
                                    path: relativePath,
                                    stat: {
                                        size: file.size,
                                        mtime: file.lastModified,
                                        ctime: file.lastModified,
                                        type: "file" as const,
                                    },
                                    handle: changedHandle,
                                };
                                handlers.onChange(fileInfo, undefined);
                            }
                        }
                    } catch (error) {
                        this.addLog(
                            `Error processing ${type} event for ${relativePath}: ${String(error)}`,
                            LOG_LEVEL_NOTICE,
                            "filesystem-observer"
                        );
                    }
                }
            });

            // Start observing
            await this.observer.observe(this.rootHandle, { recursive: true });
            this.addLog("FileSystemObserver started successfully", LOG_LEVEL_INFO, "fsapi-watch");
        } catch (error) {
            this.addLog(`Failed to start FileSystemObserver: ${String(error)}`, LOG_LEVEL_NOTICE, "fsapi-watch");
            this.addLog("Falling back to manual sync mode", LOG_LEVEL_INFO, "fsapi-watch");
        }

        return Promise.resolve();
    }

    async stopWatch(): Promise<void> {
        if (this.observer) {
            try {
                this.observer.disconnect();
                this.observer = null;
                this.addLog("FileSystemObserver stopped", LOG_LEVEL_INFO, "fsapi-watch");
            } catch (error) {
                this.addLog(`Error stopping observer: ${String(error)}`, LOG_LEVEL_NOTICE, "fsapi-watch");
            }
        }
    }
}

/**
 * Composite adapter for FileSystem API StorageEventManager
 */
export class FSAPIStorageEventManagerAdapter implements IStorageEventManagerAdapter<FSAPIFile, FSAPIFolder> {
    readonly typeGuard: FSAPITypeGuardAdapter;
    readonly persistence: FSAPIPersistenceAdapter;
    readonly watch: FSAPIWatchAdapter;
    readonly status: FSAPIStatusAdapter;
    readonly converter: FSAPIConverterAdapter;

    constructor(rootHandle: FileSystemDirectoryHandle, addLog: WebAppLog) {
        this.typeGuard = new FSAPITypeGuardAdapter();
        this.persistence = new FSAPIPersistenceAdapter(addLog);
        this.watch = new FSAPIWatchAdapter(rootHandle, addLog);
        this.status = new FSAPIStatusAdapter(addLog);
        this.converter = new FSAPIConverterAdapter();
    }
}
