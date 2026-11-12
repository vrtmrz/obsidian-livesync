import type { FilePath, UXFileInfoStub, UXInternalFileInfoStub } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { FileEventItem } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IStorageEventManagerAdapter } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import type {
    IStorageEventPersistenceAdapter,
    IStorageEventWatchAdapter,
    IStorageEventStatusAdapter,
    IStorageEventConverterAdapter,
    IStorageEventWatchHandlers,
} from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import type { FileEventItemSentinel } from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import type { NodeFile, NodeFolder } from "@/apps/cli/adapters/NodeTypes";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import type { IgnoreRules } from "@/apps/cli/serviceModules/IgnoreRules";
import { fsPromises as fs, getNodeFileCreationTime, path, type Stats } from "@vrtmrz/livesync-commonlib/node";
import type { CliDiagnosticReporter } from "@/apps/cli/cliOutput";
import { NodeTypeGuardAdapter } from "@/apps/cli/adapters/NodeTypeGuardAdapter";
import type { CLIFileNameSource } from "@/apps/cli/storage/CLIFileNameSource";
import { writeFileAtomically } from "@/apps/cli/runtimeState";
import {
    isIgnoredVaultPath,
    toVaultRelativePath,
    type VaultRelativePath,
    type CLIPathFilterOptions,
} from "@/apps/cli/cliPathFilter";

/**
 * CLI-specific persistence adapter (file-based snapshot)
 */
class CLIPersistenceAdapter implements IStorageEventPersistenceAdapter {
    private snapshotPath: () => string;

    constructor(
        basePath: string,
        private reportDiagnostic: CliDiagnosticReporter = () => undefined,
        snapshotPath?: () => string
    ) {
        this.snapshotPath = snapshotPath ?? (() => path.join(basePath, ".livesync-snapshot.json"));
    }

    async saveSnapshot(snapshot: (FileEventItem | FileEventItemSentinel)[]): Promise<void> {
        try {
            writeFileAtomically(this.snapshotPath(), JSON.stringify(snapshot, null, 2));
        } catch (error) {
            this.reportDiagnostic("Failed to save snapshot:", error);
        }
    }

    async loadSnapshot(): Promise<(FileEventItem | FileEventItemSentinel)[] | null> {
        try {
            const content = await fs.readFile(this.snapshotPath(), "utf-8");
            return JSON.parse(content) as (FileEventItem | FileEventItemSentinel)[];
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
    /** Retain the handle owned by this adapter so normal unload can close its watcher. */
    private _watcher: FSWatcher | undefined;

    constructor(
        private readonly basePath: string,
        private ignoreRules?: IgnoreRules,
        private watchEnabled: boolean = false,
        private reportDiagnostic: CliDiagnosticReporter = () => undefined,
        private readonly pathFilterOptions: CLIPathFilterOptions = {},
        private nameSource?: CLIFileNameSource
    ) {}

    // Bind conversion to the selected root; event callbacks cannot substitute a different root.
    private _toVaultRelativePath(candidatePath: string): VaultRelativePath | undefined {
        return toVaultRelativePath(this.basePath, candidatePath);
    }

    // Unlike an ignored-callback probe, an invalid emitted event is unexpected.
    // Report it and let the caller omit that event while later valid events continue.
    private _getEventPath(candidatePath: string): VaultRelativePath | undefined {
        const relativePath = this._toVaultRelativePath(candidatePath);
        if (relativePath === undefined) {
            this.reportDiagnostic(
                "[CLIWatchAdapter] File watcher event was ignored because its path is not valid within the selected Vault.",
                { path: candidatePath, vaultPath: this.basePath }
            );
        }
        return relativePath;
    }

    // Deleted files still have a lexical event path, so conversion must not require filesystem existence.
    private _toNodeFile(filePath: string, stats: Stats | undefined): NodeFile | false {
        const relativePath = this._getEventPath(filePath);
        if (relativePath === undefined) {
            return false;
        }
        return {
            path: relativePath,
            stat: {
                // Floor to integer milliseconds; Linux fs.Stats.*Ms carry sub-millisecond
                // precision, and timestamps are stored as integer ms everywhere else.
                ctime: stats ? getNodeFileCreationTime(stats) : Date.now(),
                mtime: Math.floor(stats?.mtimeMs ?? Date.now()),
                size: stats?.size ?? 0,
                type: "file",
            },
        };
    }

    private _toNodeFolder(dirPath: string): NodeFolder | false {
        const relativePath = this._getEventPath(dirPath);
        // The empty relative path is a valid root-folder event, so test the failure sentinel explicitly.
        if (relativePath === undefined) {
            return false;
        }
        return {
            path: relativePath,
            isFolder: true,
        };
    }

    async beginWatch(handlers: IStorageEventWatchHandlers): Promise<void> {
        if (!this.watchEnabled) return;
        if (this.nameSource) {
            await this.nameSource.beginWatch(handlers);
            return;
        }
        // Chokidar may probe ancestors of the root; exclude those candidates quietly.
        // Entry exclusions see only the rebased path, preserving Vaults beneath hidden parents.
        const ignored = (candidatePath: string): boolean => {
            const relativePath = this._toVaultRelativePath(candidatePath);
            return (
                relativePath === undefined || isIgnoredVaultPath(relativePath, this.ignoreRules, this.pathFilterOptions)
            );
        };

        const watcher = chokidarWatch(this.basePath, {
            ignored,
            ignoreInitial: true,
            persistent: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100,
            },
        });

        watcher.on("add", (filePath, stats) => {
            const nodeFile = this._toNodeFile(filePath, stats);
            if (nodeFile !== false) {
                handlers.onCreate(nodeFile);
            }
        });

        watcher.on("change", (filePath, stats) => {
            const nodeFile = this._toNodeFile(filePath, stats);
            if (nodeFile !== false) {
                handlers.onChange(nodeFile);
            }
        });

        watcher.on("unlink", (filePath) => {
            const nodeFile = this._toNodeFile(filePath, undefined);
            if (nodeFile !== false) {
                handlers.onDelete(nodeFile);
            }
        });

        watcher.on("addDir", (dirPath) => {
            const nodeFolder = this._toNodeFolder(dirPath);
            if (nodeFolder !== false) {
                handlers.onCreate(nodeFolder);
            }
        });

        watcher.on("unlinkDir", (dirPath) => {
            const nodeFolder = this._toNodeFolder(dirPath);
            if (nodeFolder !== false) {
                handlers.onDelete(nodeFolder);
            }
        });

        watcher.on("error", (err) => {
            this.reportDiagnostic("[CLIWatchAdapter] Fatal watcher error — file watching stopped:", err);
            this.reportDiagnostic("[CLIWatchAdapter] Exiting for systemd restart.");
            void watcher.close();
            this._watcher = undefined;
            // Use exit(1) rather than SIGTERM so systemd Restart=on-failure engages.
            process.exit(1);
        });

        // Complete watch startup only after Chokidar has finished its initial discovery.
        await new Promise<void>((resolve) => watcher.once("ready", resolve));
        this._watcher = watcher;
    }

    close(): Promise<void> {
        if (this.nameSource) {
            return this.nameSource.close();
        }
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
    readonly typeGuard: NodeTypeGuardAdapter;
    readonly persistence: CLIPersistenceAdapter;
    readonly watch: CLIWatchAdapter;
    readonly status: CLIStatusAdapter;
    readonly converter: CLIConverterAdapter;

    constructor(
        basePath: string,
        ignoreRules?: IgnoreRules,
        watchEnabled: boolean = false,
        reportDiagnostic: CliDiagnosticReporter = () => undefined,
        snapshotPath?: () => string,
        pathFilterOptions?: CLIPathFilterOptions,
        nameSource?: CLIFileNameSource
    ) {
        this.typeGuard = new NodeTypeGuardAdapter();
        this.persistence = new CLIPersistenceAdapter(basePath, reportDiagnostic, snapshotPath);
        this.watch = new CLIWatchAdapter(
            basePath,
            ignoreRules,
            watchEnabled,
            reportDiagnostic,
            pathFilterOptions,
            nameSource
        );
        this.status = new CLIStatusAdapter();
        this.converter = new CLIConverterAdapter();
    }

    close(): Promise<void> {
        return this.watch.close();
    }
}
