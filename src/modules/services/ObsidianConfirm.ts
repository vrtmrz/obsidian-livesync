import { type App, type Plugin, Notice } from "@/deps";
import { scheduleTask, memoIfNotExist, memoObject, retrieveMemoObject, disposeMemoObject } from "@/common/utils";
import { $msg } from "@/lib/src/common/i18n";
import type { Confirm } from "@/lib/src/interfaces/Confirm";
import type { ObsidianServiceContext } from "@/lib/src/services/implements/obsidian/ObsidianServiceContext";
import {
    askYesNo,
    askString,
    confirmWithMessageWithWideButton,
    askSelectString,
    confirmWithMessage,
} from "../coreObsidian/UILib/dialogs";

export class ObsidianConfirm<T extends ObsidianServiceContext = ObsidianServiceContext> implements Confirm {
    private _context: T;
    get _app(): App {
        return this._context.app;
    }
    get _plugin(): Plugin {
        return this._context.plugin;
    }
    constructor(context: T) {
        this._context = context;
    }
    askYesNo(message: string): Promise<"yes" | "no"> {
        return askYesNo(this._app, message);
    }
    askString(title: string, key: string, placeholder: string, isPassword: boolean = false): Promise<string | false> {
        return askString(this._app, title, key, placeholder, isPassword);
    }

    async askYesNoDialog(
        message: string,
        opt: { title?: string; defaultOption?: "Yes" | "No"; timeout?: number } = { title: "Confirmation" }
    ): Promise<"yes" | "no"> {
        const defaultTitle = $msg("moduleInputUIObsidian.defaultTitleConfirmation");
        const yesLabel = $msg("moduleInputUIObsidian.optionYes");
        const noLabel = $msg("moduleInputUIObsidian.optionNo");
        const defaultOption = opt.defaultOption === "Yes" ? yesLabel : noLabel;
        const ret = await confirmWithMessageWithWideButton(
            this._plugin,
            opt.title || defaultTitle,
            message,
            [yesLabel, noLabel],
            defaultOption,
            opt.timeout
        );
        return ret === yesLabel ? "yes" : "no";
    }

    askSelectString(message: string, items: string[]): Promise<string> {
        return askSelectString(this._app, message, items);
    }

    askSelectStringDialogue<T extends readonly string[]>(
        message: string,
        buttons: T,
        opt: { title?: string; defaultAction: T[number]; timeout?: number }
    ): Promise<T[number] | false> {
        const defaultTitle = $msg("moduleInputUIObsidian.defaultTitleSelect");
        return confirmWithMessageWithWideButton(
            this._plugin,
            opt.title || defaultTitle,
            message,
            buttons,
            opt.defaultAction,
            opt.timeout
        );
    }

    askInPopup(key: string, dialogText: string, anchorCallback: (anchor: HTMLAnchorElement) => void) {
        const fragment = createFragment((doc) => {
            const [beforeText, afterText] = dialogText.split("{HERE}", 2);
            doc.createEl("span", undefined, (a) => {
                a.appendText(beforeText);
                a.appendChild(
                    a.createEl("a", undefined, (anchor) => {
                        anchorCallback(anchor);
                    })
                );
                a.appendText(afterText);
            });
        });
        const popupKey = "popup-" + key;
        scheduleTask(popupKey, 1000, async () => {
            const popup = await memoIfNotExist(popupKey, () => new Notice(fragment, 0));
            const isShown = popup?.noticeEl?.isShown();
            if (!isShown) {
                memoObject(popupKey, new Notice(fragment, 0));
            }
            scheduleTask(popupKey + "-close", 20000, () => {
                const popup = retrieveMemoObject<Notice>(popupKey);
                if (!popup) return;
                if (popup?.noticeEl?.isShown()) {
                    popup.hide();
                }
                disposeMemoObject(popupKey);
            });
        });
    }

    confirmWithMessage(
        title: string,
        contentMd: string,
        buttons: string[],
        defaultAction: (typeof buttons)[number],
        timeout?: number
    ): Promise<(typeof buttons)[number] | false> {
        return confirmWithMessage(this._plugin, title, contentMd, buttons, defaultAction, timeout);
    }
}
