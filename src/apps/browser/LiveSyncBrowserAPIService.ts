import type { LOG_LEVEL } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import type { Confirm } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import type { ICommandCompat } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { InjectableAPIService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableAPIService";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { _fetch } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

declare const MANIFEST_VERSION: string | undefined;
declare const PACKAGE_VERSION: string | undefined;

export interface LiveSyncBrowserAPIServiceOptions {
    confirm: Confirm;
    getSystemVaultName(): string;
    appId?: string;
    isMobile?: () => boolean;
    fetch?: typeof _fetch;
    addLog?: (message: unknown, level: LOG_LEVEL, key?: string) => void;
    addCommand?: <TCommand extends ICommandCompat>(command: TCommand) => TCommand;
    showWindow?: (type: string) => Promise<void>;
    registerWindow?: <T>(type: string, factory: (leaf: T) => unknown) => void;
    addRibbonIcon?: (icon: string, title: string, callback: (event: MouseEvent) => unknown) => HTMLElement;
    registerProtocolHandler?: (action: string, handler: (params: Record<string, string>) => unknown) => void;
    addStatusBarItem?: () => HTMLElement | undefined;
}

/** Browser application implementation of Commonlib's injected host API contract. */
export class LiveSyncBrowserAPIService<T extends ServiceContext> extends InjectableAPIService<T> {
    private readonly options: LiveSyncBrowserAPIServiceOptions;

    constructor(context: T, options: LiveSyncBrowserAPIServiceOptions) {
        super(context);
        this.options = options;
        this.addLog.setHandler((message, level, key) => {
            options.addLog?.(message, level, key);
        });
    }

    get confirm(): Confirm {
        return this.options.confirm;
    }

    getCustomFetchHandler(): FetchHttpHandler {
        return new FetchHttpHandler();
    }

    isMobile(): boolean {
        return this.options.isMobile?.() ?? false;
    }

    showWindow(type: string): Promise<void> {
        return this.options.showWindow?.(type) ?? Promise.resolve();
    }

    getAppID(): string {
        return this.options.appId ?? this.options.getSystemVaultName();
    }

    getSystemVaultName(): string {
        return this.options.getSystemVaultName();
    }

    override getPlatform(): string {
        return "browser";
    }

    getAppVersion(): string {
        return MANIFEST_VERSION ?? "0.0.0";
    }

    getPluginVersion(): string {
        return PACKAGE_VERSION ?? "0.0.0";
    }

    addCommand<TCommand extends ICommandCompat>(command: TCommand): TCommand {
        return this.options.addCommand?.(command) ?? command;
    }

    registerWindow<T>(type: string, factory: (leaf: T) => unknown): void {
        this.options.registerWindow?.(type, factory);
    }

    addRibbonIcon(
        icon: string,
        title: string,
        callback: (event: MouseEvent) => unknown
    ): HTMLElement {
        const element = this.options.addRibbonIcon?.(icon, title, callback);
        if (!element) {
            throw new Error("Ribbon icons are not supported by this browser application");
        }
        return element;
    }

    registerProtocolHandler(
        action: string,
        handler: (params: Record<string, string>) => unknown
    ): void {
        this.options.registerProtocolHandler?.(action, handler);
    }

    override nativeFetch(request: string | Request, options?: RequestInit): Promise<Response> {
        const fetchImplementation = this.options.fetch ?? _fetch;
        return fetchImplementation(request, options);
    }

    addStatusBarItem(): HTMLElement | undefined {
        return this.options.addStatusBarItem?.();
    }
}
