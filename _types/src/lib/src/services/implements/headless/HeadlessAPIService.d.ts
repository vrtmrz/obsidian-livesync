// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { InjectableAPIService } from "@lib/services/implements/injectable/InjectableAPIService";
import type { FetchHttpHandler } from "@smithy/fetch-http-handler";
import type { ICommandCompat } from "@lib/services/base/IService";
import type { Confirm } from "@lib/interfaces/Confirm";
/**
 * Headless implementation of Confirm that returns sensible defaults instead
 * of throwing. Dialogs are logged to stderr so the prompts are visible in
 * service logs, and the default/conservative action is taken automatically.
 */
export declare class HeadlessConfirm implements Confirm {
    askYesNo(message: string): Promise<"yes" | "no">;
    askString(title: string, key: string, placeholder: string, isPassword?: boolean): Promise<string | false>;
    askYesNoDialog(message: string, opt: {
        title?: string;
        defaultOption?: "Yes" | "No";
        timeout?: number;
    }): Promise<"yes" | "no">;
    askSelectString(message: string, items: string[]): Promise<string>;
    askSelectStringDialogue<T extends readonly string[]>(message: string, buttons: T, opt: {
        title?: string;
        defaultAction: T[number];
        timeout?: number;
    }): Promise<T[number] | false>;
    askInPopup(key: string, dialogText: string, anchorCallback: (anchor: HTMLAnchorElement) => void): void;
    confirmWithMessage(title: string, contentMd: string, buttons: string[], defaultAction: (typeof buttons)[number], timeout?: number): Promise<(typeof buttons)[number] | false>;
}
export declare class HeadlessAPIService<T extends ServiceContext> extends InjectableAPIService<T> {
    private _confirmInstance;
    private _systemVaultName;
    constructor(context: T);
    get confirm(): Confirm;
    showWindow(type: string): Promise<void>;
    getCustomFetchHandler(): FetchHttpHandler;
    isMobile(): boolean;
    getAppID(): string;
    getAppVersion(): string;
    getPluginVersion(): string;
    getPlatform(): string;
    getCrypto(): Crypto;
    addCommand<TCommand extends ICommandCompat>(command: TCommand): TCommand;
    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    registerWindow(type: string, factory: (leaf: any) => any): void; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    registerProtocolHandler(action: string, handler: (params: Record<string, string>) => any): void; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    addStatusBarItem(): HTMLElement | undefined;
    private toSafeKeyPart;
    private hash32;
    private deriveSystemVaultName;
    getSystemVaultName(): string;
    get isOnline(): boolean;
    nativeFetch(req: string | Request, opts?: RequestInit): Promise<Response>;
}
