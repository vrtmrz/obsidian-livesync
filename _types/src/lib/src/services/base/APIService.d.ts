// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FetchHttpHandler } from "@smithy/fetch-http-handler";
import type { LOG_LEVEL } from "@lib/common/logger";
import type { IAPIService, ICommandCompat } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
import type { Confirm } from "@lib/interfaces/Confirm";
/**
 * The APIService provides methods for interacting with the plug-in's API,
 */
export declare abstract class APIService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IAPIService {
    /**
     * Get a custom fetch handler for making HTTP requests (e.g., S3 without CORS issues).
     */
    abstract getCustomFetchHandler(): FetchHttpHandler;
    /**
     * Add a log entry to the log (Now not used).
     * @param message The log message.
     * @param level The log level.
     * @param key The log key.
     */
    abstract addLog(message: unknown, level: LOG_LEVEL, key: string): void;
    /**
     * Check if the app is running on a mobile device.
     * @returns true if running on mobile, false otherwise.
     */
    abstract isMobile(): boolean;
    /**
     * Show a window (or in Obsidian, a leaf).
     * @param type The type of window to show.
     */
    abstract showWindow(type: string): Promise<void>;
    /**
     * Show a window on the right sidebar when supported.
     * Platforms that do not support sidebars can fall back to showWindow.
     */
    showWindowOnRight(type: string): Promise<void>;
    /**
     * returns App ID. In Obsidian, it is vault ID.
     */
    abstract getAppID(): string;
    /**
     * Returns the vaultName which system has identified, without any additional suffix.
     */
    abstract getSystemVaultName(): string;
    /**
     * Check if the last POST request failed due to payload size.
     */
    abstract getPlatform(): string;
    abstract getAppVersion(): string;
    abstract getPluginVersion(): string;
    abstract getCrypto(): Crypto;
    /**
     * Register a command to the runtime.
     * @param command
     */
    abstract addCommand<TCommand extends ICommandCompat>(command: TCommand): TCommand;
    /**
     * Register a window (or leaf) type to the runtime.
     * @param type
     * @param factory
     */
    abstract registerWindow<T>(type: string, factory: (leaf: T) => unknown): void;
    /**
     * Add a ribbon icon to the UI.
     * @param icon
     * @param title
     * @param callback
     */
    abstract addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement;
    /**
     * Register a protocol handler.
     * @param action The action string for the protocol.
     * @param handler The handler function for the protocol.
     */
    abstract registerProtocolHandler(action: string, handler: (params: Record<string, string>) => unknown): void;
    /**
     * Get the basic UI component for showing a confirmation dialog to the user.
     */
    abstract get confirm(): Confirm;
    requestCount: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
    responseCount: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
    get isOnline(): boolean;
    webCompatFetch(req: string | Request, opts?: RequestInit): Promise<Response>;
    nativeFetch(req: string | Request, opts?: RequestInit): Promise<Response>;
    abstract addStatusBarItem(): HTMLElement | undefined;
    setInterval(handler: () => void, timeout: number): number;
    clearInterval(timerId: number): void;
    /**
     * Get the system configuration directory.
     * This is used for storing configuration files in a consistent location across platforms.
     * @returns
     */
    getSystemConfigDir(): string;
}
