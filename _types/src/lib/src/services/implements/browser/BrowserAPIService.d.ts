import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { InjectableAPIService } from "@lib/services/implements/injectable/InjectableAPIService";
import type { FetchHttpHandler } from "@smithy/fetch-http-handler";
import type { ICommandCompat } from "../../base/IService";
import type { Confirm } from "@lib/interfaces/Confirm";
export declare const PACKAGE_VERSION: string;
export declare const MANIFEST_VERSION: string;
export declare class BrowserAPIService<T extends ServiceContext> extends InjectableAPIService<T> {
    _confirmInstance: Confirm;
    private commandBar;
    private commandButtons;
    private logPanel;
    private logViewport;
    private readonly maxLogLines;
    private windowFactories;
    private windowInstances;
    private windowRoot;
    private windowTabs;
    private windowBody;
    private windowPanels;
    private activeWindowType;
    constructor(context: T);
    get confirm(): Confirm;
    showWindow(type: string): Promise<void>;
    getCustomFetchHandler(): FetchHttpHandler;
    isMobile(): boolean;
    getAppID(): string;
    getSystemVaultName: import("../../lib/HandlerUtils").HandlerFunction<() => string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    getAppVersion(): string;
    getPluginVersion(): string;
    getPlatform(): string;
    getCrypto(): Crypto;
    nativeFetch(req: string | Request, opts?: RequestInit): Promise<Response>;
    private ensureLogPanel;
    private formatLogLine;
    private appendLog;
    private ensureCommandBar;
    private ensureWindowHost;
    private ensureWindowTab;
    private ensureWindowPanel;
    private activateWindow;
    private createLeafShim;
    private evaluateEnabled;
    private executeCommand;
    private refreshCommandStates;
    addCommand<TCommand extends ICommandCompat>(command: TCommand): TCommand;
    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement; // eslint-disable-line @typescript-eslint/no-explicit-any
    registerWindow(type: string, factory: (leaf: any) => any): void; // eslint-disable-line @typescript-eslint/no-explicit-any
    registerProtocolHandler(action: string, handler: (params: Record<string, string>) => any): void; // eslint-disable-line @typescript-eslint/no-explicit-any
    addStatusBarItem(): HTMLElement | undefined;
}
