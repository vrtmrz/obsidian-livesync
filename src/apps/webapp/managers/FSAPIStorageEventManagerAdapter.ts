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
import type { FSAPIFile, FSAPIFolder } from "../adapters/FSAPITypes";

/**
 * FileSystem API-specific type guard adapter
 */
class FSAPITypeGuardAdapter implements IStorageEventTypeGuardAdapter<FSAPIFile, FSAPIFolder> {
    isFile(file: any): file is FSAPIFile {
        return (
            file && typeof file === "object" && "path" in file && "stat" in file && "handle" in file && !file.isFolder
        );
    }

    isFolder(item: any): item is FSAPIFolder {
        return item && typeof item === "object" && "path" in item && item.isFolder === true && "handle" in item;
    }
}

/**
 * FileSystem API-specific persistence adapter (IndexedDB-based snapshot)
 */
class FSAPIPersistenceAdapter implements IStorageEventPersistenceAdapter {
    private dbName = "livesync-webapp-snapshot";
    private storeName = "snapshots";
    private snapshotKey = "file-events";

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
            console.error("Failed to save snapshot:", error);
        }
    }

    async loadSnapshot(): Promise<(FileEventItem | FileEventItemSentinel)[] | null> {
        try {
            const db = await this.openDB();
            const transaction = db.transaction([this.storeName], "readonly");
            const store = transaction.objectStore(this.storeName);

            const result = await new Promise<(FileEventItem | FileEventItemSentinel)[] | null>((resolve, reject) => {
                const request = store.get(this.snapshotKey);
                request.onsuccess = () => resolve(request.result || null);
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

    updateStatus(status: { batched: number; processing: number; totalQueued: number }): void {
        const now = Date.now();
        if (now - this.lastUpdate > this.updateInterval) {
            if (status.totalQueued > 0 || status.processing > 0) {
                console.log(
                    `[StorageEventManager] Batched: ${status.batched}, Processing: ${status.processing}, Total Queued: ${status.totalQueued}`
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
    private observer: any = null; // FileSystemObserver type

    constructor(private rootHandle: FileSystemDirectoryHandle) {}

    async beginWatch(handlers: IStorageEventWatchHandlers): Promise<void> {
        // Use FileSystemObserver if available (Chrome 124+)
        if (typeof (window as any).FileSystemObserver === "undefined") {
            console.log("[FSAPIWatchAdapter] FileSystemObserver not available, file watching disabled");
            console.log("[FSAPIWatchAdapter] Consider using Chrome 124+ for real-time file watching");
            return Promise.resolve();
        }

        try {
            const FileSystemObserver = (window as any).FileSystemObserver;

            this.observer = new FileSystemObserver(async (records: any[]) => {
                for (const record of records) {
                    const handle = record.root;
                    const changedHandle = record.changedHandle;
                    const relativePathComponents = record.relativePathComponents;
                    const type = record.type; // "appeared", "disappeared", "modified", "moved", "unknown", "errored"

                    // Build relative path
                    const relativePath = relativePathComponents ? relativePathComponents.join("/") : "";

                    // Skip .livesync directory to avoid infinite loops
                    if (relativePath.startsWith(".livesync/") || relativePath === ".livesync") {
                        continue;
                    }

                    console.log(`[FileSystemObserver] ${type}: ${relativePath}`);

                    // Convert to our event handlers
                    try {
                        if (type === "appeared" || type === "modified") {
                            if (changedHandle && changedHandle.kind === "file") {
                                const file = await changedHandle.getFile();
                                const fileInfo = {
                                    path: relativePath as any,
                                    stat: {
                                        size: file.size,
                                        mtime: file.lastModified,
                                        ctime: file.lastModified,
                                        type: "file" as const,
                                    },
                                    handle: changedHandle,
                                };

                                if (type === "appeared") {
                                    await handlers.onCreate(fileInfo, undefined);
                                } else {
                                    await handlers.onChange(fileInfo, undefined);
                                }
                            }
                        } else if (type === "disappeared") {
                            const fileInfo = {
                                path: relativePath as any,
                                stat: {
                                    size: 0,
                                    mtime: Date.now(),
                                    ctime: Date.now(),
                                    type: "file" as const,
                                },
                                handle: null as any,
                            };
                            await handlers.onDelete(fileInfo, undefined);
                        } else if (type === "moved") {
                            // Handle as delete + create
                            // Note: FileSystemObserver provides both old and new paths in some cases
                            // For simplicity, we'll treat it as a modification
                            if (changedHandle && changedHandle.kind === "file") {
                                const file = await changedHandle.getFile();
                                const fileInfo = {
                                    path: relativePath as any,
                                    stat: {
                                        size: file.size,
                                        mtime: file.lastModified,
                                        ctime: file.lastModified,
                                        type: "file" as const,
                                    },
                                    handle: changedHandle,
                                };
                                await handlers.onChange(fileInfo, undefined);
                            }
                        }
                    } catch (error) {
                        console.error(
                            `[FileSystemObserver] Error processing ${type} event for ${relativePath}:`,
                            error
                        );
                    }
                }
            });

            // Start observing
            await this.observer.observe(this.rootHandle, { recursive: true });
            console.log("[FSAPIWatchAdapter] FileSystemObserver started successfully");
        } catch (error) {
            console.error("[FSAPIWatchAdapter] Failed to start FileSystemObserver:", error);
            console.log("[FSAPIWatchAdapter] Falling back to manual sync mode");
        }

        return Promise.resolve();
    }

    async stopWatch(): Promise<void> {
        if (this.observer) {
            try {
                this.observer.disconnect();
                this.observer = null;
                console.log("[FSAPIWatchAdapter] FileSystemObserver stopped");
            } catch (error) {
                console.error("[FSAPIWatchAdapter] Error stopping observer:", error);
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

    constructor(rootHandle: FileSystemDirectoryHandle) {
        this.typeGuard = new FSAPITypeGuardAdapter();
        this.persistence = new FSAPIPersistenceAdapter();
        this.watch = new FSAPIWatchAdapter(rootHandle);
        this.status = new FSAPIStatusAdapter();
        this.converter = new FSAPIConverterAdapter();
    }
}
