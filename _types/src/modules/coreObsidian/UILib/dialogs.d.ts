// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { ButtonComponent } from "@/deps.ts";
import { App, FuzzySuggestModal, Modal, Plugin, Component } from "@/deps.ts";
import { type CompatIntervalHandle } from "@lib/common/coreEnvFunctions.ts";
declare class AutoClosableModal extends Modal {
    _closeByUnload(): void;
    constructor(app: App);
    onClose(): void;
}
export declare class InputStringDialog extends AutoClosableModal {
    result: string | false;
    onSubmit: (result: string | false) => void;
    title: string;
    key: string;
    placeholder: string;
    isManuallyClosed: boolean;
    isPassword: boolean;
    constructor(app: App, title: string, key: string, placeholder: string, isPassword: boolean, onSubmit: (result: string | false) => void);
    onOpen(): void;
    onClose(): void;
}
export declare class PopoverSelectString extends FuzzySuggestModal<string> {
    _app: App;
    callback: ((e: string) => void) | undefined;
    getItemsFun: () => string[];
    constructor(app: App, note: string, placeholder: string | undefined, getItemsFun: (() => string[]) | undefined, callback: (e: string) => void);
    getItems(): string[];
    getItemText(item: string): string;
    onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void;
    onClose(): void;
}
export declare class MessageBox<T extends readonly string[]> extends AutoClosableModal {
    plugin: Plugin;
    title: string;
    contentMd: string;
    buttons: T;
    result: string | false;
    isManuallyClosed: boolean;
    defaultAction: string | undefined;
    timeout: number | undefined;
    timer: CompatIntervalHandle | undefined;
    defaultButtonComponent: ButtonComponent | undefined;
    wideButton: boolean;
    onSubmit: (result: string | false) => void;
    component: Component;
    constructor(plugin: Plugin, title: string, contentMd: string, buttons: T, defaultAction: T[number], timeout: number | undefined, wideButton: boolean, onSubmit: (result: T[number] | false) => void);
    onOpen(): void;
    onClose(): void;
}
export declare function confirmWithMessage<T extends readonly string[]>(plugin: Plugin, title: string, contentMd: string, buttons: T, defaultAction: T[number], timeout?: number): Promise<T[number] | false>;
export declare function confirmWithMessageWithWideButton<T extends readonly string[]>(plugin: Plugin, title: string, contentMd: string, buttons: T, defaultAction: T[number], timeout?: number): Promise<T[number] | false>;
export declare const askYesNo: (app: App, message: string) => Promise<"yes" | "no">;
export declare const askSelectString: (app: App, message: string, items: string[]) => Promise<string>;
export declare const askString: (app: App, title: string, key: string, placeholder: string, isPassword?: boolean) => Promise<string | false>;
export {};
