import type { Confirm, ConfirmActionLayout } from "@vrtmrz/livesync-commonlib/compat/interfaces/Confirm";
import { createNativeElement } from "@/apps/browserDom";

import MessageBox from "./ui/MessageBox.svelte";
import TextInputBox from "./ui/TextInputBox.svelte";

import { mount } from "svelte";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { _activeDocument, compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

function displayMessageBox<T, U extends string[]>(
    message: string,
    buttons: U,
    title: string,
    commit: (ret: U[number]) => T,
    actionLayout: ConfirmActionLayout = "vertical"
): Promise<T> {
    const el = createNativeElement(_activeDocument, "div");
    const p = promiseWithResolvers<T>();
    mount(MessageBox, {
        target: el,
        props: {
            message,
            buttons: buttons as string[],
            title: title,
            actionLayout,
            commit: (action: U[number]) => {
                const ret = commit(action);
                p.resolve(ret);
            },
        },
    });
    _activeDocument.body.appendChild(el);
    void p.promise.finally(() => {
        el.remove();
    });
    return p.promise;
}
function promptForInput(
    title: string,
    key: string,
    placeholder: string,
    isPassword?: boolean
): Promise<string | false> {
    const el = createNativeElement(_activeDocument, "div");
    const p = promiseWithResolvers<string | false>();
    mount(TextInputBox, {
        target: el,
        props: {
            title,
            message: key,
            placeholder,
            isPassword,
            commit: (text: string | false) => {
                p.resolve(text);
            },
        },
    });
    _activeDocument.body.appendChild(el);
    void p.promise.finally(() => {
        el.remove();
    });
    return p.promise;
}

export class BrowserConfirm<T extends ServiceContext> implements Confirm {
    _context: T;
    constructor(context: T) {
        this._context = context;
    }
    askYesNo(message: string): Promise<"yes" | "no"> {
        return displayMessageBox(message, ["Yes", "No"] as const, "Confirm", (action) =>
            action == "Yes" ? "yes" : "no"
        );
    }
    askString(title: string, key: string, placeholder: string, isPassword?: boolean): Promise<string | false> {
        return promptForInput(title, key, placeholder, isPassword);
    }
    askYesNoDialog(
        message: string,
        opt: { title?: string; defaultOption?: "Yes" | "No"; timeout?: number }
    ): Promise<"yes" | "no"> {
        return displayMessageBox(message, ["Yes", "No"] as const, opt.title ?? "Confirm", (action) =>
            action == "Yes" ? "yes" : "no"
        );
    }
    askSelectString(message: string, items: string[]): Promise<string> {
        return displayMessageBox(message, [...items] as const, "Confirm", (action) => action);
    }
    askSelectStringDialogue<T extends readonly string[]>(
        message: string,
        buttons: T,
        opt: { title?: string; defaultAction: T[number]; timeout?: number }
    ): Promise<T[number] | false> {
        return displayMessageBox(message, [...buttons] as const, opt.title ?? "Confirm", (action) => action);
    }
    askInPopup(
        key: string,
        dialogText: string,
        anchorCallback: (anchor: HTMLAnchorElement) => void,
        durationMs: number = 20000
    ): void {
        const existing = _activeDocument.querySelector(`[data-livesync-popup="${CSS.escape(key)}"]`);
        existing?.remove();

        const notice = createNativeElement(_activeDocument, "div");
        notice.className = "livesync-browser-notice";
        notice.dataset.livesyncPopup = key;
        const [beforeText, afterText] = dialogText.split("{HERE}", 2);
        notice.append(beforeText);
        const anchor = createNativeElement(_activeDocument, "a");
        anchor.href = "#";
        anchorCallback(anchor);
        anchor.addEventListener("click", () => notice.remove());
        notice.append(anchor, afterText ?? "");
        _activeDocument.body.appendChild(notice);
        compatGlobal.setTimeout(() => notice.remove(), durationMs);
    }
    confirmWithMessage(
        title: string,
        contentMd: string,
        buttons: string[],
        defaultAction: (typeof buttons)[number],
        timeout?: number,
        actionLayout?: ConfirmActionLayout
    ): Promise<(typeof buttons)[number] | false> {
        return displayMessageBox(
            contentMd,
            [...buttons] as const,
            title ?? "Confirm",
            (action) => action,
            actionLayout
        );
    }
}
