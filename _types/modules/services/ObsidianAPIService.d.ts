import { InjectableAPIService } from "@lib/services/implements/injectable/InjectableAPIService";
import type { ObsidianServiceContext } from "@lib/services/implements/obsidian/ObsidianServiceContext";
import { type Command, type ViewCreator } from "obsidian";
import { ObsHttpHandler } from "@/modules/essentialObsidian/APILib/ObsHttpHandler";
import type { Confirm } from "@lib/interfaces/Confirm";
declare module "obsidian" {
    interface App {
        appId?: string;
        isMobile?: boolean;
    }
}
export declare class ObsidianAPIService extends InjectableAPIService<ObsidianServiceContext> {
    _customHandler: ObsHttpHandler | undefined;
    _confirmInstance: Confirm;
    constructor(context: ObsidianServiceContext);
    getCustomFetchHandler(): ObsHttpHandler;
    showWindow(viewType: string): Promise<void>;
    showWindowOnRight(viewType: string): Promise<void>;
    private get app();
    getPlatform(): string;
    isMobile(): boolean;
    getAppID(): string;
    getSystemVaultName(): string;
    getAppVersion(): string;
    getPluginVersion(): string;
    get confirm(): Confirm;
    addCommand<TCommand extends Command>(command: TCommand): TCommand;
    registerWindow(type: string, factory: ViewCreator): void;
    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => void): HTMLElement;
    registerProtocolHandler(action: string, handler: (params: Record<string, string>) => void): void;
    /**
     * In Obsidian, we will use the native `requestUrl` function as the default fetch handler,
     * to address unavoidable CORS issues.
     */
    nativeFetch(req: string | Request, opts?: RequestInit): Promise<Response>;
    addStatusBarItem(): HTMLElement | undefined;
    setInterval(handler: () => void, timeout: number): number;
    getSystemConfigDir(): string;
}
