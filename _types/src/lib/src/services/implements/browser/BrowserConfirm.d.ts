// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { Confirm } from "@lib/interfaces/Confirm";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
export declare class BrowserConfirm<T extends ServiceContext> implements Confirm {
    _context: T;
    constructor(context: T);
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
