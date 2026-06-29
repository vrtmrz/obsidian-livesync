// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { IAppLifecycleService, ISettingService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
export interface AppLifecycleServiceDependencies {
    settingService: ISettingService;
}
/**
 * The AppLifecycleService provides methods for managing the plug-in's lifecycle events.
 */
export declare abstract class AppLifecycleService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IAppLifecycleService {
    protected readonly settingService: ISettingService;
    constructor(context: T, dependencies: AppLifecycleServiceDependencies);
    /**
     * Event triggered when the plug-in's layout is ready.
     * In Obsidian, it is after the workspace is ready.
     */
    readonly onLayoutReady: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered when the plug-in is being initialized for the first time.
     * This is only called once per plug-in lifecycle.
     */
    readonly onFirstInitialise: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered when the plug-in is fully ready.
     * This is called after all initialisation processes are complete.
     */
    readonly onReady: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered to wire up necessary event listeners.
     * This is typically called during the initialisation phase.
     */
    readonly onWireUpEvents: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered when the plug-in is being initialised.
     */
    readonly onInitialise: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered when the plug-in is loading.
     * This is typically called during the quite early initialisation phase, before everything.
     * In Obsidian, it is in the onload() method of the plugin.
     */
    readonly onLoad: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered when the plug-in's settings have been loaded and applied.
     */
    readonly onSettingLoaded: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered when the plug-in has fully loaded.
     * This is typically called after all initialisation and loading processes are complete.
     */
    readonly onLoaded: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Scan for any startup issues that may affect the plug-in's operation.
     */
    readonly onScanningStartupIssues: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered when the plug-in is unloading (e.g., during app shutdown or plug-in disable).
     * This is typically called during the unload() method of the plugin.
     * Entry point to unload everything.
     */
    readonly onAppUnload: import("@lib/services/lib/HandlerUtils").CollectiveHandlerFunction<() => Promise<undefined[]>, unknown>;
    /**
     * Event triggered before the plug-in is unloaded.
     * This is typically used to perform any necessary cleanup or save state before the plug-in is unloaded.
     */
    readonly onBeforeUnload: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered when the plug-in is being unloaded.
     */
    readonly onUnload: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Perform an immediate restart of the application.
     * Note that this is not graceful, and not only the plug-in. APPLICATION (means Obsidian) will be restarted.
     */
    abstract performRestart(): void;
    /**
     * Ask the user for a restart.
     * @param message Optional message to display to the user when asking for a restart.
     */
    abstract askRestart(message?: string): void;
    /**
     * Schedule a restart of the application.
     * After the current operation is done, the application will be restarted.
     * Note that this is not graceful, and not only the plug-in. APPLICATION (means Obsidian) will be restarted.
     */
    abstract scheduleRestart(): void;
    /**
     * Event triggered when the application is being suspended (e.g., system sleep).
     */
    readonly onSuspending: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered when the application is resuming from a suspended state.
     */
    readonly onResuming: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Event triggered after the application has resumed from a suspended state.
     */
    readonly onResumed: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    private _isSuspended;
    /**
     * Check if the plug-in is currently suspended.
     * Also consider the plug-in as suspended if it is not configured, to prevent any issues before configuration.
     */
    isSuspended(): boolean;
    /**
     * Set the suspension state of the plug-in.
     * @param suspend Set to true to suspend the plug-in, false to resume.
     */
    setSuspended(suspend: boolean): void;
    private _isReady;
    /**
     * Check if the plug-in is ready.
     * A ready plug-in means it has been fully initialised and is operational.
     * If not ready, most operations will be blocked.
     */
    isReady(): boolean;
    /**
     * Mark the plug-in as ready.
     */
    markIsReady(): void;
    /**
     * Reset the ready state of the plug-in.
     */
    resetIsReady(): void;
    /**
     * Check if a restart has been scheduled.
     */
    abstract isReloadingScheduled(): boolean;
    /**
     * Get unresolved error messages.
     */
    readonly getUnresolvedMessages: import("@lib/services/lib/HandlerUtils").CollectiveHandlerFunction<() => Promise<(string | Error)[][]>, unknown>;
}
