import { watch as chokidarWatch, type ChokidarOptions, type FSWatcher } from "chokidar";
import { parseFilePath, type FilePath } from "@vrtmrz/livesync-commonlib/storage";
import { getNodeFileCreationTime, path, type Stats } from "@vrtmrz/livesync-commonlib/node";
import type { IStorageEventWatchHandlers } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import type { NodeFile, NodeFolder } from "@/apps/cli/adapters/NodeTypes";
import type { CliDiagnosticReporter } from "@/apps/cli/cliOutput";
import { isIgnoredFilePath } from "@/apps/cli/cliPathFilter";
import {
    asError,
    type CLIFileNameSourceOptions,
    type QueuedWatchEvent,
    type WatchEventType,
} from "./CLIFileNameSource.state";

interface FileNameWatchDependencies {
    readonly basePath: string;
    readonly options: CLIFileNameSourceOptions;
    readonly reportDiagnostic: CliDiagnosticReporter;
    readonly canObserve: () => boolean;
    readonly canDeliver: () => boolean;
    readonly onObservation: (type: WatchEventType, path: FilePath) => void;
    readonly onInvalidPath: () => void;
    readonly onFatalError: (error: Error) => void;
}

/**
 * Owns the source's one native watcher and its synchronisation-delivery buffer.
 *
 * Observation begins before enumeration, whereas delivery starts after startup
 * recovery. Inventory invalidation always runs before sync-only exclusions, so
 * an ignored or rejected event cannot hide a name from collision checks.
 */
export class CLIFileNameSourceWatch {
    // Acquire ownership before awaiting readiness, so close can release a watcher
    // whose initial scan has not completed or whose ready event will never arrive.
    private watcher: FSWatcher | undefined;
    private cancelReadyWait: ((error: Error) => void) | undefined;
    private closed = false;
    // Only eligible startup notifications are retained; live events go straight
    // to handlers after activation, without another long-lived delivery queue.
    private readonly bufferedEvents: QueuedWatchEvent[] = [];
    private handlers: IStorageEventWatchHandlers | undefined;
    // Activation happens once after recovery. Stopping is terminal for delivery,
    // while observation can remain open until accepted shutdown work has drained.
    private deliveryActive = false;
    private deliveryStopped = false;
    private readonly basePath: string;
    private readonly options: CLIFileNameSourceOptions;
    private readonly reportDiagnostic: CliDiagnosticReporter;

    constructor(private readonly dependencies: FileNameWatchDependencies) {
        this.basePath = dependencies.basePath;
        this.options = dependencies.options;
        this.reportDiagnostic = dependencies.reportDiagnostic;
    }

    /** Acquire the watcher immediately so shutdown can cancel even its ready wait. */
    async startObservation(): Promise<void> {
        if (this.closed) {
            throw new Error("The CLI file-name source is closed");
        }
        const watcher = (this.options.watcherFactory ?? chokidarWatch)(this.basePath, this.createWatcherOptions());
        this.watcher = watcher;
        this.attachWatcher(watcher);
        await this.waitForWatcherReady(watcher);
    }

    /**
     * Stop delivery and release observation; this method owns no inventory queue.
     *
     * Return the native close promise directly so synchronous close failures keep
     * their original propagation through preparation cleanup.
     */
    close(): Promise<void> {
        if (this.closed) {
            return Promise.resolve();
        }
        this.closed = true;
        this.stopDelivery();
        this.cancelReadyWait?.(new Error("The CLI file-name source closed before watcher readiness"));
        this.cancelReadyWait = undefined;
        const watcher = this.watcher;
        this.watcher = undefined;
        return watcher ? watcher.close() : Promise.resolve();
    }

    /** Hand off the finite startup buffer synchronously; downstream processing is not awaited. */
    beginDelivery(handlers: IStorageEventWatchHandlers): void {
        if (this.deliveryStopped) {
            throw new Error("Synchronisation delivery has been stopped");
        }
        if (this.deliveryActive) {
            throw new Error("Synchronisation delivery has already started");
        }

        this.handlers = handlers;
        this.deliveryActive = true;
        const buffered = this.bufferedEvents.splice(0);
        for (const event of buffered) {
            if (this.dependencies.canDeliver() && !this.deliveryStopped && event.path !== "") {
                this.deliver(event);
            }
        }
    }

    /** Inventory observation continues while accepted sync work is flushed on shutdown. */
    stopDelivery(): void {
        this.deliveryStopped = true;
        this.handlers = undefined;
        this.bufferedEvents.length = 0;
    }

    /** Preserve content-stability timing while observing the complete supported listing scope. */
    private createWatcherOptions(): ChokidarOptions {
        return {
            ignored: (candidatePath, stats) => this.isIgnoredDirectory(candidatePath, stats),
            ignoreInitial: true,
            persistent: true,
            followSymlinks: false,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100,
            },
        };
    }

    /** Hidden directories are excluded from enumeration; hidden leaf files still need name coverage. */
    private isIgnoredDirectory(candidatePath: string, stats?: Stats): boolean {
        const relative = this.relativePath(candidatePath);
        if (relative === null || relative === "") {
            return false;
        }
        const segments = relative.split("/");
        if (segments.slice(0, -1).some((segment) => segment.startsWith("."))) {
            return true;
        }
        return Boolean(stats?.isDirectory() && segments[segments.length - 1]?.startsWith("."));
    }

    private attachWatcher(watcher: FSWatcher): void {
        watcher.on("add", (filePath, stats) => this.observe("add", filePath, stats));
        watcher.on("change", (filePath, stats) => this.observe("change", filePath, stats));
        watcher.on("unlink", (filePath) => this.observe("unlink", filePath));
        watcher.on("addDir", (dirPath) => this.observe("addDir", dirPath));
        watcher.on("unlinkDir", (dirPath) => this.observe("unlinkDir", dirPath));
        watcher.on("error", (error) => this.handleWatcherError(watcher, error));
    }

    private waitForWatcherReady(watcher: FSWatcher): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error): void => {
                if (settled) {
                    return;
                }
                settled = true;
                this.cancelReadyWait = undefined;
                if (error) {
                    reject(error);
                } else if (this.closed) {
                    reject(new Error("The CLI file-name source closed before watcher readiness"));
                } else {
                    resolve();
                }
            };
            this.cancelReadyWait = (error) => finish(error);
            watcher.once("ready", () => finish());
        });
    }

    /** Preserve the CLI's fatal-watcher policy: mark names unavailable before process exit. */
    private handleWatcherError(watcher: FSWatcher, error: unknown): void {
        const failure = asError(error);
        this.dependencies.onFatalError(failure);
        this.reportDiagnostic("[CLIFileNameSource] Fatal watcher error — file watching stopped:", failure);
        this.reportDiagnostic("[CLIFileNameSource] Exiting for systemd restart.");
        this.cancelReadyWait?.(failure);
        this.cancelReadyWait = undefined;
        if (this.watcher === watcher) {
            this.watcher = undefined;
        }
        void watcher.close();
        process.exit(1);
    }

    private observe(type: WatchEventType, absolutePath: string, stats?: Stats): void {
        if (!this.dependencies.canObserve()) {
            return;
        }
        const relative = this.relativePath(absolutePath);
        if (relative === null || relative === "") {
            return;
        }

        let filePath: FilePath;
        try {
            filePath = parseFilePath(relative);
        } catch (error) {
            this.reportDiagnostic("[CLIFileNameSource] Ignoring invalid watcher path '" + relative + "':", error);
            this.dependencies.onInvalidPath();
            return;
        }

        // Name coverage is independent of whether synchronisation accepts this event.
        this.dependencies.onObservation(type, filePath);
        // Delivery may be stopped or excluded while name observation remains valid.
        if (this.deliveryStopped || !this.isEligibleForDelivery(filePath)) {
            return;
        }
        const event: QueuedWatchEvent = { type, path: filePath, stats };
        if (!this.deliveryActive) {
            this.bufferedEvents.push(event);
            return;
        }
        this.deliver(event);
    }

    /** These exclusions apply only after inventory invalidation, including operation-time suppression. */
    private isEligibleForDelivery(filePath: FilePath): boolean {
        const relative = String(filePath);
        if (isIgnoredFilePath(filePath, this.options.ignoreRules, this.options.pathFilterOptions)) {
            return false;
        }
        try {
            return !(this.options.suppressEvent?.(relative) ?? false);
        } catch (error) {
            this.reportDiagnostic(
                "[CLIFileNameSource] Could not evaluate event suppression for '" + relative + "':",
                error
            );
            return false;
        }
    }

    private deliver(event: QueuedWatchEvent): void {
        const handlers = this.handlers;
        if (!handlers || this.deliveryStopped) {
            return;
        }
        if (event.type === "add" || event.type === "change" || event.type === "unlink") {
            const file = this.toNodeFile(event.path, event.stats);
            if (event.type === "add") {
                handlers.onCreate(file);
            } else if (event.type === "change") {
                handlers.onChange(file);
            } else {
                handlers.onDelete(file);
            }
            return;
        }

        const folder: NodeFolder = { path: event.path, isFolder: true };
        if (event.type === "addDir") {
            handlers.onCreate(folder);
        } else {
            handlers.onDelete(folder);
        }
    }

    private toNodeFile(filePath: FilePath, stats?: Stats): NodeFile {
        const now = Date.now();
        return {
            path: filePath,
            stat: {
                ctime: stats ? getNodeFileCreationTime(stats) : now,
                mtime: Math.floor(stats?.mtimeMs ?? now),
                size: stats?.size ?? 0,
                type: "file",
            },
        };
    }

    private relativePath(candidatePath: string): string | null {
        const absolute = path.isAbsolute(candidatePath)
            ? path.resolve(candidatePath)
            : path.resolve(this.basePath, candidatePath);
        const relative = path.relative(this.basePath, absolute).replace(/\\/g, "/");
        if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
            return null;
        }
        return relative;
    }
}
